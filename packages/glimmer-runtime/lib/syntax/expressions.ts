import {
  Value as ValueSyntax,
  GetNamedParameter as AttrSyntax,
  Concat as ConcatSyntax,
  Get as GetSyntax,
  HasBlock as HasBlockSyntax,
  Helper as HelperSyntax,
  Unknown as UnknownSyntax
} from './core';

import {
  Expressions as SerializedExpressions,
  Expression as SerializedExpression
} from 'glimmer-wire-format';

const {
  isAttr,
  isConcat,
  isGet,
  isHasBlock,
  isHelper,
  isUnknown,
  isValue
} = SerializedExpressions;

export default function(sexp: SerializedExpression): any {
  if (isValue(sexp)) {
    return ValueSyntax.fromSpec(sexp);
  } else {
    if (isAttr(sexp)) return AttrSyntax.fromSpec(sexp);
    if (isConcat(sexp)) return ConcatSyntax.fromSpec(sexp);
    if (isGet(sexp)) return GetSyntax.fromSpec(sexp);
    if (isHelper(sexp)) return HelperSyntax.fromSpec(sexp);
    if (isUnknown(sexp)) return UnknownSyntax.fromSpec(sexp);
    if (isHasBlock(sexp)) return HasBlockSyntax.fromSpec(sexp);
  }
};
