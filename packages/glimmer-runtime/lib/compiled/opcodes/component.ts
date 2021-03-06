import { Opcode, OpcodeJSON, UpdatingOpcode } from '../../opcodes';
import { Assert } from './vm';
import { Component, ComponentManager, ComponentDefinition } from '../../component/interfaces';
import { PublicVM, VM, UpdatingVM } from '../../vm';
import { CompiledArgs, EvaluatedArgs } from '../../compiled/expressions/args';
import { Templates } from '../../syntax/core';
import { layoutFor } from '../../compiler';
import { DynamicScope } from '../../environment';
import { InternedString, Opaque, dict } from 'glimmer-util';
import { Reference, ReferenceCache, isConst } from 'glimmer-reference';

export type DynamicComponentFactory<T> = (args: EvaluatedArgs, vm: PublicVM) => Reference<ComponentDefinition<T>>;

export class PutComponentDefinitionOpcode extends Opcode {
  public type = "put-component-definition";
  private factory: DynamicComponentFactory<Opaque>;

  constructor({ factory }: { factory: DynamicComponentFactory<Opaque> }) {
    super();
    this.factory = factory;
  }

  evaluate(vm: VM) {
    let reference = this.factory.call(undefined, vm.frame.getArgs(), vm);
    vm.frame.setDynamicComponent(reference);
  }
}

export interface OpenDynamicComponentOptions {
  shadow: InternedString[];
  templates: Templates;
}

export class OpenDynamicComponentOpcode extends Opcode {
  public type = "open-dynamic-component";
  public shadow: InternedString[];
  public templates: Templates;

  constructor({ shadow, templates }: OpenDynamicComponentOptions) {
    super();
    this.shadow = shadow;
    this.templates = templates;
  }

  evaluate(vm: VM) {
    vm.pushDynamicScope();

    let { shadow, templates } = this;
    let args = vm.frame.getArgs();
    let dynamicScope = vm.dynamicScope();
    let definitionRef = vm.frame.getDynamicComponent();
    let cache, definition;

    if (isConst(definitionRef)) {
      definition = definitionRef.value();
    } else {
      cache = new ReferenceCache(definitionRef);
      definition = cache.peek();
    }

    let manager = definition.manager;
    let component = manager.create(definition, args, dynamicScope);
    let selfRef = vm.env.rootReferenceFor(manager.getSelf(component));
    let destructor = manager.getDestructor(component);

    let callerScope = vm.scope();

    // pass through the list of outer attributes to shadow from the
    // invocation site, as well as the component definition as internal
    // arguments.
    args.internal = args.internal || dict<any>();
    args.internal['shadow'] = shadow;
    args.internal['definition'] = definition;
    args.internal['component'] = component;

    let layout = layoutFor(definition, vm.env);

    if (destructor) vm.newDestroyable(destructor);
    vm.pushRootScope(selfRef, layout.symbols);
    vm.invokeLayout({ templates, args, shadow, layout, callerScope });
    vm.env.didCreate(component, manager);

    if (!isConst(definitionRef)) {
      vm.updateWith(new Assert(cache));
    }

    vm.updateWith(new UpdateComponentOpcode({ name: definition.name, component, manager, args, dynamicScope }));
  }

  toJSON(): OpcodeJSON {
    return {
      guid: this._guid,
      type: this.type,
      args: ["$DYNAMIC_COMPONENT"]
    };
  }
}

export interface OpenComponentOptions {
  definition: ComponentDefinition<any>;
  args: CompiledArgs;
  shadow: InternedString[];
  templates: Templates;
}

export class OpenComponentOpcode extends Opcode {
  public type = "open-component";
  public definition: ComponentDefinition<Opaque>;
  public args: CompiledArgs;
  public shadow: InternedString[];
  public templates: Templates;

  constructor({ definition, args, shadow, templates }: OpenComponentOptions) {
    super();
    this.definition = definition;
    this.args = args;
    this.shadow = shadow;
    this.templates = templates;
  }

  evaluate(vm: VM) {
    vm.pushDynamicScope();

    let { args: rawArgs, shadow, definition, templates } = this;
    let args = rawArgs.evaluate(vm);
    let dynamicScope = vm.dynamicScope();

    let manager = definition.manager;
    let component = manager.create(definition, args, dynamicScope);
    let selfRef = vm.env.rootReferenceFor(manager.getSelf(component));
    let destructor = manager.getDestructor(component);

    let callerScope = vm.scope();

    // pass through the list of outer attributes to shadow from the
    // invocation site, as well as the component definition as internal
    // arguments.
    args.internal = args.internal || dict<any>();
    args.internal['shadow'] = shadow;
    args.internal['definition'] = definition;
    args.internal['component'] = component;

    let layout = layoutFor(definition, vm.env);

    if (destructor) vm.newDestroyable(destructor);
    vm.pushRootScope(selfRef, layout.symbols);
    vm.invokeLayout({ templates, args, shadow, layout, callerScope });
    vm.env.didCreate(component, manager);
    vm.updateWith(new UpdateComponentOpcode({ name: definition.name, component, manager, args, dynamicScope }));
  }

  toJSON(): OpcodeJSON {
    return {
      guid: this._guid,
      type: this.type,
      args: [JSON.stringify(this.definition.name)]
    };
  }
}

export class UpdateComponentOpcode extends UpdatingOpcode {
  public type = "update-component";

  private name: string;
  private component: Component;
  private manager: ComponentManager<Opaque>;
  private args: EvaluatedArgs;
  private dynamicScope: DynamicScope;

  constructor({ name, component, manager, args, dynamicScope } : { name: string, component: Component, manager: ComponentManager<any>, args: EvaluatedArgs, dynamicScope: DynamicScope }) {
    super();
    this.name = name;
    this.component = component;
    this.manager = manager;
    this.args = args;
    this.dynamicScope = dynamicScope;
  }

  evaluate(vm: UpdatingVM) {
    let { component, manager, args, dynamicScope } = this;
    manager.update(component, args, dynamicScope);
    vm.env.didUpdate(component, manager);
  }

  toJSON(): OpcodeJSON {
    return {
      guid: this._guid,
      type: this.type,
      args: [JSON.stringify(this.name)]
    };
  }
}

export class DidCreateElementOpcode extends Opcode {
  public type = "did-create-element";

  evaluate(vm: VM) {
    let args = vm.frame.getArgs();
    let internal = args.internal;
    let definition: ComponentDefinition<Opaque> = internal['definition'];
    let manager = definition.manager;
    let component: Component = internal['component'];

    manager.didCreateElement(component, vm.stack().element, vm.stack().elementOperations);
  }

  toJSON(): OpcodeJSON {
    return {
      guid: this._guid,
      type: this.type,
      args: ["$ARGS"]
    };
  }
}

// Slow path for non-specialized component invocations. Uses an internal
// named lookup on the args.
export class ShadowAttributesOpcode extends Opcode {
  public type = "shadow-attributes";

  evaluate(vm: VM) {
    let args = vm.frame.getArgs();
    let internal = args.internal;
    let shadow: InternedString[] = internal['shadow'];
    // let definition: ComponentDefinition<any> = internal['definition'];

    let named = args.named;

    if (!shadow) return;

    shadow.forEach(name => {
      vm.stack().setAttribute(name, named.get(name));
    });
  }

  toJSON(): OpcodeJSON {
    return {
      guid: this._guid,
      type: this.type,
      args: ["$ARGS"]
    };
  }
}

export class CloseComponentOpcode extends Opcode {
  public type = "close-component";

  evaluate(vm: VM) {
    vm.popScope();
    vm.popDynamicScope();
  }
}
