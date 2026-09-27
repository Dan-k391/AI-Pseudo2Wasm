// Stable host import ABI shared by both compiler backends.
const I32 = 0x7f, F64 = 0x7c, REF = 0x6f;

export const IMPORTS = [
  ['tick', [I32], []], ['num', [F64], [REF]], ['str', [I32], [REF]], ['bool', [I32], [REF]],
  ['get', [I32], [REF]], ['set', [I32, REF], []], ['declare', [I32, I32, REF], []],
  ['binary', [I32, REF, REF], [REF]], ['unary', [I32, REF], [REF]], ['truth', [REF], [I32]],
  ['args', [], [REF]], ['push', [REF, REF], [REF]], ['builtin', [I32, REF], [REF]],
  ['output', [REF], []], ['input', [REF], []], ['index', [REF, REF], [REF]],
  ['setIndex', [REF, REF, REF], []], ['field', [REF, I32], [REF]], ['setField', [REF, I32, REF], []],
  ['enter', [I32, REF], []], ['leave', [REF], [REF]], ['create', [I32, REF], [REF]],
  ['fileOp', [I32, REF], [REF]], ['forContinue', [REF, REF, REF], [I32]],
  ['caseMatches', [REF, REF, REF, I32], [I32]], ['refName', [I32], [REF]],
  ['refIndex', [REF, REF], [REF]], ['refField', [REF, I32], [REF]],
  ['deref', [REF], [REF]], ['setDeref', [REF, REF], []],
  ['newObject', [I32, REF], [REF]], ['callMethod', [REF, I32, REF], [REF]],
  ['loopVar', [I32, I32, REF], []],
];

export const BINARY = ['OR', 'AND', '=', '<>', '<', '<=', '>', '>=', 'IN', '&', '+', '-', '*', '/', 'DIV', 'MOD'];
