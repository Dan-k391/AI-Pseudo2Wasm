import { parse, PseudoError } from './parser.js';

// Optional lowering for memory-representable programs. The self-hosted
// compiler still validates and assembles every source before this runs.
class Unsupported extends Error {}
const unsupported = message => { throw new Unsupported(message); };
const I32 = 0x7f, F64 = 0x7c;
const textEncoder = new TextEncoder();
const u = value => { const out = []; do { let byte = value & 127; value = Math.floor(value / 128); out.push(byte | (value ? 128 : 0)); } while (value); return out; };
const s = value => { const out = []; let more = true; while (more) { let byte = value & 127; value >>= 7; const sign = !!(byte & 64); more = !((value === 0 && !sign) || (value === -1 && sign)); out.push(byte | (more ? 128 : 0)); } return out; };
const encoded = value => [...textEncoder.encode(value)];
const sized = body => [...u(body.length), ...body];
const section = (id, body) => [id, ...sized(body)];
const f64 = value => { const buffer = new ArrayBuffer(8); new DataView(buffer).setFloat64(0, value, true); return [...new Uint8Array(buffer)]; };
const align = value => (value + 7) & ~7;
function sameLayout(a, b) {
  if (a.kind !== b.kind || a.size !== b.size) return false;
  if (a.kind === 'scalar') return a.name === b.name;
  if (a.kind === 'array') return a.ranges.length === b.ranges.length && a.ranges.every((range, i) => range.lo === b.ranges[i].lo && range.hi === b.ranges[i].hi) && sameLayout(a.element, b.element);
  if (a.kind === 'record') return a.fields.size === b.fields.size && [...a.fields].every(([name, field]) => b.fields.has(name) && field.offset === b.fields.get(name).offset && sameLayout(field.type, b.fields.get(name).type));
  return false;
}
const imports = [
  ['emitNumber', [F64], []], ['emitBoolean', [I32], []], ['emitText', [I32, I32], []],
  ['endLine', [], []], ['readNumber', [I32, I32], [F64]], ['fail', [I32, I32], []], ['limit', [], [I32]],
  ['numberToString', [F64], [F64]], ['emitString', [F64], []], ['readString', [I32], [F64]],
  ['random', [], [F64]], ['upper', [F64], [F64]], ['lower', [F64], [F64]], ['stringLength', [F64], [F64]],
];

function constNumber(node, constants) {
  if (node?.kind === 'literal' && typeof node.value === 'number') return node.value;
  if (node?.kind === 'name' && constants.has(node.name)) return constants.get(node.name);
  if (node?.kind === 'unary' && ['+', '-'].includes(node.op)) return (node.op === '-' ? -1 : 1) * constNumber(node.arg, constants);
  if (node?.kind === 'binary' && ['+', '-', '*', 'DIV', 'MOD'].includes(node.op)) {
    const a = constNumber(node.left, constants), b = constNumber(node.right, constants);
    return ({ '+': () => a + b, '-': () => a - b, '*': () => a * b, DIV: () => Math.trunc(a / b), MOD: () => a % b })[node.op]();
  }
  unsupported('Dynamic array bound');
}

function makeTypes(ast) {
  const aliases = new Map(), constants = new Map();
  for (const node of ast.body) {
    if (node.kind === 'type') aliases.set(node.name, node.type);
    if (node.kind === 'constant') {
      try { constants.set(node.name, constNumber(node.value, constants)); } catch { unsupported('Non-numeric constant'); }
    }
  }
  const cache = new Map(), resolving = new Set();
  const layout = type => {
    if (!type) unsupported('Missing type');
    if (type.kind === 'named') {
      if (['INTEGER', 'REAL', 'BOOLEAN', 'STRING'].includes(type.name)) return { kind: 'scalar', name: type.name, size: 8 };
      if (!aliases.has(type.name)) unsupported(`Unsupported type ${type.name}`);
      if (cache.has(type.name)) return cache.get(type.name);
      if (resolving.has(type.name)) unsupported('Recursive value type');
      resolving.add(type.name);
      const result = layout(aliases.get(type.name));
      resolving.delete(type.name); cache.set(type.name, result); return result;
    }
    if (type.kind === 'array') {
      const element = layout(type.of), ranges = type.ranges.map(range => {
        const lo = constNumber(range.lo, constants), hi = constNumber(range.hi, constants);
        if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo || hi - lo > 100000) unsupported('Invalid array bounds');
        return { lo, hi, length: hi - lo + 1 };
      });
      const count = ranges.reduce((n, range) => n * range.length, 1);
      if (count > 1000000) unsupported('Array too large');
      return { kind: 'array', element, ranges, size: count * element.size };
    }
    if (type.kind === 'record') {
      const fields = new Map(); let size = 0;
      for (const declaration of type.fields) {
        if (declaration.kind !== 'declare') unsupported('Unsupported record field');
        const fieldType = layout(declaration.type);
        for (const name of declaration.names) { fields.set(name, { type: fieldType, offset: size }); size += fieldType.size; }
      }
      return { kind: 'record', fields, size };
    }
    unsupported(`Unsupported type ${type.kind}`);
  };
  return { layout, constants };
}

function nestedStatements(nodes, visit) {
  for (const node of nodes) {
    visit(node);
    if (node.kind === 'if') { nestedStatements(node.then, visit); nestedStatements(node.other, visit); }
    if (node.kind === 'while' || node.kind === 'repeat' || node.kind === 'for') nestedStatements(node.body, visit);
    if (node.kind === 'case') for (const arm of node.arms) nestedStatements(arm.body, visit);
  }
}
function alwaysReturns(nodes) {
  return nodes.some(node => node.kind === 'return'
    || node.kind === 'if' && alwaysReturns(node.then) && alwaysReturns(node.other)
    || node.kind === 'case' && node.arms.some(arm => arm.otherwise) && node.arms.every(arm => alwaysReturns(arm.body)));
}
function containsConcat(value) {
  if (Array.isArray(value)) return value.some(containsConcat);
  if (!value || typeof value !== 'object') return false;
  if (value.kind === 'binary' && value.op === '&') return true;
  return Object.values(value).some(containsConcat);
}
function expensiveStringLoop(nodes, constants) {
  for (const node of nodes) {
    if (node.kind === 'for' && containsConcat(node.body)) {
      try { if (Math.abs(constNumber(node.to, constants) - constNumber(node.from, constants)) > 256) return true; }
      catch { return true; }
    }
    if ((node.kind === 'while' || node.kind === 'repeat') && containsConcat(node.body)) return true;
    if (node.kind === 'if' && (expensiveStringLoop(node.then, constants) || expensiveStringLoop(node.other, constants))) return true;
    if (node.kind === 'case' && node.arms.some(arm => expensiveStringLoop(arm.body, constants))) return true;
    if (node.kind === 'for' && expensiveStringLoop(node.body, constants)) return true;
  }
  return false;
}

function collectSymbols(nodes, types, globals, isMain = false) {
  const symbols = new Map(); let size = 0;
  const add = (name, type, constant = false) => {
    if (symbols.has(name)) unsupported(`Duplicate ${name}`);
    symbols.set(name, { name, type, offset: size, constant }); size += type.size;
  };
  for (const node of nodes) {
    if (node.kind === 'declare') for (const name of node.names) add(name, types.layout(node.type));
    if (node.kind === 'constant') add(node.name, { kind: 'scalar', name: Number.isInteger(types.constants.get(node.name)) ? 'INTEGER' : 'REAL', size: 8 }, true);
  }
  nestedStatements(nodes, node => {
    if (node.kind === 'declare' && !nodes.includes(node)) unsupported('Nested declaration');
    if (node.kind === 'for' && !symbols.has(node.name) && !globals?.has(node.name)) add(node.name, { kind: 'scalar', name: 'INTEGER', size: 8 });
  });
  return { symbols, size: align(size), isMain };
}

class Code {
  constructor(unit, context) { this.unit = unit; this.context = context; this.code = []; this.locals = []; this.line = 1; }
  emit(...bytes) { this.code.push(...bytes); }
  i(value) { this.emit(0x41, ...s(value)); }
  number(value) { this.emit(0x44, ...f64(value)); }
  local(type) { const index = this.context.params.length + this.locals.length; this.locals.push(type); return index; }
  get(index) { this.emit(0x20, ...u(index)); }
  set(index) { this.emit(0x21, ...u(index)); }
  tee(index) { this.emit(0x22, ...u(index)); }
  global(index) { this.emit(0x23, ...u(index)); }
  setGlobal(index) { this.emit(0x24, ...u(index)); }
  call(index) { this.emit(0x10, ...u(index)); }
  fail(code) { this.i(code); this.i(this.line); this.call(5); this.emit(0x00); }
  truth() { this.number(0); this.emit(0x62); }
  tick(line) {
    this.line = line || this.line;
    this.i(this.line); this.setGlobal(2);
    this.global(1); this.i(1); this.emit(0x6a); this.setGlobal(1);
    this.global(1); this.global(3); this.emit(0x4b, 0x04, 0x40);
    this.fail(1); this.emit(0x0b);
  }
  symbol(name) { return this.context.symbols.get(name) || this.unit.globals.symbols.get(name) || unsupported(`Unknown ${name}`); }
  address(node) {
    if (node.kind === 'name') {
      const symbol = this.symbol(node.name);
      if (symbol.byref) this.get(symbol.paramIndex);
      else if (this.context.symbols.has(node.name) && !this.context.isMain) { this.get(this.context.baseLocal); this.i(symbol.offset); this.emit(0x6a); }
      else this.i(this.unit.globalBase + symbol.offset);
      return symbol.type;
    }
    if (node.kind === 'field') {
      const owner = this.address(node.target);
      if (owner.kind !== 'record') unsupported('Field of non-record');
      const field = owner.fields.get(node.name); if (!field) unsupported('Unknown record field');
      this.i(field.offset); this.emit(0x6a); return field.type;
    }
    if (node.kind === 'index') {
      const owner = this.address(node.target);
      if (owner.kind !== 'array' || node.indices.length !== owner.ranges.length) unsupported('Invalid array index');
      const indexLocal = this.local(I32), floatLocal = this.local(F64);
      this.i(0);
      for (let j = 0; j < owner.ranges.length; j++) {
        const range = owner.ranges[j];
        this.i(range.length); this.emit(0x6c);
        const indexType = this.expression(node.indices[j]); if (indexType.kind !== 'scalar' || indexType.name === 'BOOLEAN') unsupported('Non-numeric index');
        this.set(floatLocal);
        this.get(floatLocal); this.number(range.lo); this.emit(0x63, 0x04, 0x40); this.fail(2); this.emit(0x0b);
        this.get(floatLocal); this.number(range.hi); this.emit(0x64, 0x04, 0x40); this.fail(2); this.emit(0x0b);
        this.get(floatLocal); this.emit(0x9d); this.get(floatLocal); this.emit(0x62, 0x04, 0x40); this.fail(2); this.emit(0x0b);
        this.get(floatLocal); this.emit(0xaa); this.set(indexLocal);
        this.get(indexLocal); this.i(range.lo); this.emit(0x6b, 0x6a);
      }
      this.i(owner.element.size); this.emit(0x6c, 0x6a); return owner.element;
    }
    unsupported(`Unsupported lvalue ${node.kind}`);
  }
  typeOf(node) {
    if (node.kind === 'name') return this.symbol(node.name).type;
    if (node.kind === 'field') { const owner = this.typeOf(node.target); return owner.kind === 'record' ? owner.fields.get(node.name)?.type || unsupported('Unknown field') : unsupported('Not a record'); }
    if (node.kind === 'index') { const owner = this.typeOf(node.target); return owner.kind === 'array' ? owner.element : unsupported('Not an array'); }
    if (node.kind === 'literal') return typeof node.value === 'number' ? { kind: 'scalar', name: Number.isInteger(node.value) ? 'INTEGER' : 'REAL', size: 8 } : typeof node.value === 'boolean' ? { kind: 'scalar', name: 'BOOLEAN', size: 8 } : typeof node.value === 'string' ? { kind: 'scalar', name: 'STRING', size: 8 } : unsupported('Unsupported literal');
    if (node.kind === 'unary') return node.op === 'NOT' ? { kind: 'scalar', name: 'BOOLEAN', size: 8 } : this.typeOf(node.arg);
    if (node.kind === 'binary') return ['=', '<>', '<', '<=', '>', '>=', 'AND', 'OR'].includes(node.op) ? { kind: 'scalar', name: 'BOOLEAN', size: 8 } : { kind: 'scalar', name: node.op === '&' ? 'STRING' : node.op === '/' ? 'REAL' : 'INTEGER', size: 8 };
    if (node.kind === 'call') {
      const routine = this.unit.routineMap.get(node.target.name);
      if (routine) return routine.returnType || unsupported('Procedure has no value');
      const builtin = node.target.kind === 'name' ? node.target.name : '';
      if (['NUM_TO_STR', 'UCASE', 'LCASE', 'TO_UPPER', 'TO_LOWER'].includes(builtin)) return { kind: 'scalar', name: 'STRING', size: 8 };
      if (['RAND', 'INT', 'LENGTH'].includes(builtin)) return { kind: 'scalar', name: builtin === 'INT' || builtin === 'LENGTH' ? 'INTEGER' : 'REAL', size: 8 };
      unsupported('Unsupported call');
    }
    unsupported(`Unsupported expression ${node.kind}`);
  }
  expression(node) {
    if (node.kind === 'literal') {
      if (typeof node.value === 'number' || typeof node.value === 'boolean') { this.number(Number(node.value)); return this.typeOf(node); }
      if (typeof node.value === 'string') { this.number(this.unit.stringMap.get(node.value).offset); return this.typeOf(node); }
      unsupported('Unsupported literal');
    }
    if (['name', 'field', 'index'].includes(node.kind)) {
      const type = this.address(node);
      if (type.kind !== 'scalar') unsupported('Aggregate value expression');
      this.emit(0x2b, 0x03, 0x00); return type;
    }
    if (node.kind === 'unary') {
      const type = this.expression(node.arg);
      if (type.kind !== 'scalar') unsupported('Aggregate unary expression');
      if (node.op === 'NOT') { if (type.name !== 'BOOLEAN') unsupported('NOT needs BOOLEAN'); this.truth(); this.emit(0x45, 0xb7); return { kind: 'scalar', name: 'BOOLEAN', size: 8 }; }
      if (type.name === 'BOOLEAN') unsupported('Numeric unary needs number');
      if (node.op === '-') this.emit(0x9a);
      else if (node.op !== '+') unsupported('Pointer expression');
      return type;
    }
    if (node.kind === 'binary') {
      const op = node.op;
      if (op === '&') {
        if (this.typeOf(node.left).name !== 'STRING' || this.typeOf(node.right).name !== 'STRING') unsupported('String concatenation types');
        this.expression(node.left); this.expression(node.right); this.call(this.unit.concatIndex);
        return { kind: 'scalar', name: 'STRING', size: 8 };
      }
      if (op === 'AND' || op === 'OR') {
        if (this.typeOf(node.left).name !== 'BOOLEAN' || this.typeOf(node.right).name !== 'BOOLEAN') unsupported('Boolean operator types');
        this.expression(node.left); this.truth(); this.emit(0x04, F64);
        if (op === 'AND') { this.expression(node.right); this.truth(); this.emit(0xb7); }
        else this.number(1);
        this.emit(0x05);
        if (op === 'AND') this.number(0);
        else { this.expression(node.right); this.truth(); this.emit(0xb7); }
        this.emit(0x0b); return { kind: 'scalar', name: 'BOOLEAN', size: 8 };
      }
      const leftType = this.typeOf(node.left), rightType = this.typeOf(node.right);
      if (leftType.kind !== 'scalar' || rightType.kind !== 'scalar' || (leftType.name === 'BOOLEAN') !== (rightType.name === 'BOOLEAN')) unsupported('Mixed operator types');
      if (leftType.name === 'BOOLEAN' && !['=', '<>'].includes(op)) unsupported('Boolean arithmetic');
      if (leftType.name === 'STRING') {
        if (!['=', '<>'].includes(op) || rightType.name !== 'STRING') unsupported('String comparison operator');
        this.expression(node.left); this.expression(node.right); this.call(this.unit.equalsIndex);
        if (op === '<>') { this.number(0); this.emit(0x61, 0xb7); }
        return { kind: 'scalar', name: 'BOOLEAN', size: 8 };
      }
      if (['DIV', 'MOD'].includes(op) && (leftType.name !== 'INTEGER' || rightType.name !== 'INTEGER')) unsupported('Non-integer DIV/MOD');
      this.expression(node.left); this.expression(node.right);
      const simple = { '+': 0xa0, '-': 0xa1, '*': 0xa2, '/': 0xa3, '=': 0x61, '<>': 0x62, '<': 0x63, '<=': 0x65, '>': 0x64, '>=': 0x66 };
      if (['/', 'DIV', 'MOD'].includes(op)) {
        const b = this.local(F64), a = this.local(F64);
        this.set(b); this.set(a);
        this.get(b); this.number(0); this.emit(0x61, 0x04, 0x40); this.fail(3); this.emit(0x0b);
        this.get(a); this.get(b); this.emit(0xa3);
        if (op === 'DIV') this.emit(0x9d);
        if (op === 'MOD') { this.emit(0x9d); this.get(b); this.emit(0xa2); this.get(a); this.emit(0xa1, 0x9a); }
      } else if (simple[op] !== undefined) {
        this.emit(simple[op]);
        if (['=', '<>', '<', '<=', '>', '>='].includes(op)) this.emit(0xb7);
      } else unsupported(`Unsupported operator ${op}`);
      return this.typeOf(node);
    }
    if (node.kind === 'call') {
      if (node.target.kind !== 'name') unsupported('Method call');
      const routine = this.unit.routineMap.get(node.target.name);
      if (!routine) {
        const builtin = node.target.name;
        if (builtin === 'RAND' && !node.args.length) { this.call(10); return this.typeOf(node); }
        if (builtin === 'INT' && node.args.length === 1) { if (this.typeOf(node.args[0]).name === 'BOOLEAN') unsupported('INT BOOLEAN'); this.expression(node.args[0]); this.emit(0x9d); return this.typeOf(node); }
        if (builtin === 'NUM_TO_STR' && node.args.length === 1) { if (this.typeOf(node.args[0]).name === 'STRING') unsupported('NUM_TO_STR STRING'); this.expression(node.args[0]); this.call(7); return this.typeOf(node); }
        if (['UCASE', 'TO_UPPER', 'LCASE', 'TO_LOWER'].includes(builtin) && node.args.length === 1) { if (this.typeOf(node.args[0]).name !== 'STRING') unsupported('Case conversion type'); this.expression(node.args[0]); this.call(['UCASE', 'TO_UPPER'].includes(builtin) ? 11 : 12); return this.typeOf(node); }
        if (builtin === 'LENGTH' && node.args.length === 1) { if (this.typeOf(node.args[0]).name !== 'STRING') unsupported('LENGTH type'); this.expression(node.args[0]); this.call(13); return this.typeOf(node); }
        unsupported('Unknown routine');
      }
      if (node.args.length !== routine.node.params.length) unsupported('Argument count');
      for (let j = 0; j < node.args.length; j++) {
        const param = routine.node.params[j], expected = routine.paramTypes[j];
        if (param.byref) {
          const actual = this.address(node.args[j]);
          if (!sameLayout(actual, expected)) unsupported('BYREF type mismatch');
        } else {
          const actual = this.expression(node.args[j]);
          if (actual.kind !== 'scalar' || expected.kind !== 'scalar' || (actual.name === 'BOOLEAN') !== (expected.name === 'BOOLEAN') || (actual.name === 'STRING') !== (expected.name === 'STRING')) unsupported('Argument type mismatch');
          this.validateValue(expected);
        }
      }
      this.call(imports.length + routine.index);
      return routine.returnType || { kind: 'scalar', name: 'REAL', size: 8 };
    }
    unsupported(`Unsupported expression ${node.kind}`);
  }
  validateValue(type) {
    if (type.kind !== 'scalar') unsupported('Whole aggregate assignment');
    if (type.name === 'STRING') return;
    const value = this.local(F64); this.set(value);
    this.get(value); this.emit(0x99); this.number(Infinity); this.emit(0x63, 0x45, 0x04, 0x40); this.fail(4); this.emit(0x0b);
    if (type.name === 'INTEGER') {
      this.get(value); this.emit(0x9d); this.get(value); this.emit(0x62, 0x04, 0x40); this.fail(5); this.emit(0x0b);
    }
    this.get(value);
  }
  storeValue(type) {
    this.validateValue(type);
    this.emit(0x39, 0x03, 0x00);
  }
  assign(target, value) {
    const type = this.address(target), actual = this.typeOf(value);
    if (type.kind !== 'scalar' || actual.kind !== 'scalar' || (type.name === 'BOOLEAN') !== (actual.name === 'BOOLEAN') || (type.name === 'STRING') !== (actual.name === 'STRING')) unsupported('Assignment type mismatch');
    if (target.kind === 'name' && this.symbol(target.name).constant) unsupported('Constant assignment');
    this.expression(value); this.storeValue(type);
  }
  statement(node) {
    this.tick(node.line);
    switch (node.kind) {
      case 'declare': return;
      case 'constant': {
        const type = this.address({ kind: 'name', name: node.name });
        this.expression(node.value); this.storeValue(type); return;
      }
      case 'assign': this.assign(node.target, node.value); return;
      case 'output': {
        for (const value of node.values) {
          if (value.kind === 'literal' && typeof value.value === 'string') {
            const literal = this.unit.stringMap.get(value.value); this.i(literal.offset + 4); this.i(literal.length); this.call(2);
          } else {
            const type = this.expression(value);
            if (type.kind !== 'scalar') unsupported('Aggregate output');
            if (type.name === 'BOOLEAN') { this.truth(); this.call(1); }
            else if (type.name === 'STRING') this.call(8);
            else this.call(0);
          }
        }
        this.call(3); return;
      }
      case 'input': {
        for (const target of node.targets) {
          const type = this.address(target);
          if (type.kind !== 'scalar') unsupported('Aggregate input');
          const label = target.kind === 'name' ? target.name : 'value';
          let labelIndex = this.unit.inputNames.indexOf(label);
          if (labelIndex < 0) labelIndex = this.unit.inputNames.push(label) - 1;
          if (type.name === 'STRING') { this.i(labelIndex); this.call(9); this.storeValue(type); }
          else { this.i(type.name === 'BOOLEAN' ? 2 : type.name === 'INTEGER' ? 0 : 1); this.i(labelIndex); this.call(4); this.storeValue(type); }
        }
        return;
      }
      case 'callstmt': this.expression(node.call); this.emit(0x1a); return;
      case 'return': {
        if (this.context.isMain) unsupported('Return in main');
        if (node.value) {
          const type = this.expression(node.value);
          if (type.kind !== 'scalar' || !this.context.returnType || (type.name === 'BOOLEAN') !== (this.context.returnType.name === 'BOOLEAN') || (type.name === 'STRING') !== (this.context.returnType.name === 'STRING')) unsupported('Return type');
          this.validateValue(this.context.returnType);
        } else this.number(0);
        this.set(this.context.resultLocal); this.get(this.context.baseLocal); this.setGlobal(0);
        this.get(this.context.resultLocal); this.emit(0x0f); return;
      }
      case 'if': {
        if (this.typeOf(node.condition).name !== 'BOOLEAN') unsupported('IF condition type');
        this.expression(node.condition); this.truth(); this.emit(0x04, 0x40);
        node.then.forEach(child => this.statement(child));
        if (node.other.length) { this.emit(0x05); node.other.forEach(child => this.statement(child)); }
        this.emit(0x0b); return;
      }
      case 'while': {
        if (this.typeOf(node.condition).name !== 'BOOLEAN') unsupported('WHILE condition type');
        this.emit(0x02, 0x40, 0x03, 0x40); this.tick(node.line);
        this.expression(node.condition); this.truth(); this.emit(0x45, 0x0d, 0x01);
        node.body.forEach(child => this.statement(child)); this.emit(0x0c, 0x00, 0x0b, 0x0b); return;
      }
      case 'repeat': {
        if (this.typeOf(node.condition).name !== 'BOOLEAN') unsupported('UNTIL condition type');
        this.emit(0x03, 0x40); node.body.forEach(child => this.statement(child)); this.tick(node.line);
        this.expression(node.condition); this.truth(); this.emit(0x45, 0x0d, 0x00, 0x0b); return;
      }
      case 'for': {
        const variable = { kind: 'name', name: node.name }, type = this.typeOf(variable);
        if (type.kind !== 'scalar' || type.name === 'BOOLEAN') unsupported('FOR variable type');
        const end = this.local(F64), step = this.local(F64);
        this.assign(variable, node.from); this.expression(node.to); this.set(end); this.expression(node.step); this.set(step);
        this.get(step); this.number(0); this.emit(0x61, 0x04, 0x40); this.fail(6); this.emit(0x0b);
        this.emit(0x02, 0x40, 0x03, 0x40); this.tick(node.line);
        this.get(step); this.number(0); this.emit(0x64, 0x04, I32);
        this.expression(variable); this.get(end); this.emit(0x65, 0x05);
        this.expression(variable); this.get(end); this.emit(0x66, 0x0b);
        this.emit(0x45, 0x0d, 0x01);
        node.body.forEach(child => this.statement(child));
        this.address(variable); this.expression(variable); this.get(step); this.emit(0xa0); this.storeValue(type);
        this.emit(0x0c, 0x00, 0x0b, 0x0b); return;
      }
      case 'case': {
        const value = this.local(F64), matched = this.local(I32);
        this.expression(node.value); this.set(value); this.i(0); this.set(matched);
        for (const arm of node.arms) {
          this.get(matched); this.emit(0x45);
          if (!arm.otherwise) {
            this.get(value); this.expression(arm.lo);
            if (arm.hi) { this.emit(0x65); this.get(value); this.expression(arm.hi); this.emit(0x64, 0x71); }
            else this.emit(0x61);
            this.emit(0x71);
          }
          this.emit(0x04, 0x40); this.i(1); this.set(matched);
          arm.body.forEach(child => this.statement(child)); this.emit(0x0b);
        }
        return;
      }
      default: unsupported(`Unsupported statement ${node.kind}`);
    }
  }
  finish(resultType = null) {
    if (resultType) {
      this.number(0); this.set(this.context.resultLocal);
      this.get(this.context.baseLocal); this.setGlobal(0);
      this.get(this.context.resultLocal);
    }
    this.emit(0x0b);
    const declarations = [];
    for (const type of this.locals) declarations.push(1, type);
    return sized([...u(this.locals.length), ...declarations, ...this.code]);
  }
}

function framePrologue(code, context) {
  code.global(0); code.set(context.baseLocal);
  code.global(0); code.i(context.size); code.emit(0x6a); code.setGlobal(0);
  code.global(0); code.i(code.unit.heapBase); code.emit(0x4b, 0x04, 0x40); code.fail(7); code.emit(0x0b);
  if (context.size) { code.get(context.baseLocal); code.i(0); code.i(context.size); code.emit(0xfc, 0x0b, 0x00); }
  for (const symbol of context.symbols.values()) {
    if (symbol.paramIndex === undefined || symbol.byref) continue;
    code.get(context.baseLocal); code.i(symbol.offset); code.emit(0x6a);
    code.get(symbol.paramIndex); code.emit(0x39, 0x03, 0x00);
  }
}

function collectText(nodes, stringMap, data) {
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'literal' && typeof value.value === 'string' && !stringMap.has(value.value)) {
      const bytes = encoded(value.value);
      stringMap.set(value.value, { offset: 8 + data.length, length: bytes.length });
      const length = bytes.length;
      data.push(length & 255, (length >>> 8) & 255, (length >>> 16) & 255, (length >>> 24) & 255, ...bytes);
      while (data.length & 3) data.push(0);
    }
    for (const [key, child] of Object.entries(value)) if (key !== 'value' || value.kind !== 'literal') visit(child);
  };
  visit(nodes);
}

function concatBody() {
  const code = new Code(null, { params: [F64, F64] });
  const left = code.local(I32), right = code.local(I32), leftSize = code.local(I32), rightSize = code.local(I32), start = code.local(I32), end = code.local(I32);
  code.get(0); code.emit(0xaa); code.set(left);
  code.get(1); code.emit(0xaa); code.set(right);
  code.get(left); code.emit(0x28, 0x02, 0x00); code.set(leftSize);
  code.get(right); code.emit(0x28, 0x02, 0x00); code.set(rightSize);
  code.global(4); code.set(start);
  code.get(start); code.i(4); code.emit(0x6a); code.get(leftSize); code.emit(0x6a); code.get(rightSize); code.emit(0x6a);
  code.i(3); code.emit(0x6a); code.i(-4); code.emit(0x71); code.set(end);
  code.get(end); code.setGlobal(4);
  code.get(end); code.emit(0x3f, 0x00); code.i(16); code.emit(0x74, 0x4b, 0x04, 0x40);
  code.get(end); code.emit(0x3f, 0x00); code.i(16); code.emit(0x74, 0x6b);
  code.i(65535); code.emit(0x6a); code.i(16); code.emit(0x76, 0x40, 0x00, 0x1a, 0x0b);
  code.get(start); code.get(leftSize); code.get(rightSize); code.emit(0x6a, 0x36, 0x02, 0x00);
  code.get(start); code.i(4); code.emit(0x6a); code.get(left); code.i(4); code.emit(0x6a); code.get(leftSize); code.emit(0xfc, 0x0a, 0x00, 0x00);
  code.get(start); code.i(4); code.emit(0x6a); code.get(leftSize); code.emit(0x6a);
  code.get(right); code.i(4); code.emit(0x6a); code.get(rightSize); code.emit(0xfc, 0x0a, 0x00, 0x00);
  code.get(start); code.emit(0xb8, 0x0b);
  return sized([...u(code.locals.length), ...code.locals.flatMap(type => [1, type]), ...code.code]);
}

function equalsBody() {
  const code = new Code(null, { params: [F64, F64] });
  const left = code.local(I32), right = code.local(I32), length = code.local(I32), position = code.local(I32);
  code.get(0); code.emit(0xaa); code.set(left);
  code.get(1); code.emit(0xaa); code.set(right);
  code.get(left); code.emit(0x28, 0x02, 0x00); code.tee(length);
  code.get(right); code.emit(0x28, 0x02, 0x00); code.emit(0x47, 0x04, 0x40);
  code.number(0); code.emit(0x0f, 0x0b);
  code.i(0); code.set(position);
  code.emit(0x02, 0x40, 0x03, 0x40);
  code.get(position); code.get(length); code.emit(0x49, 0x45, 0x0d, 0x01);
  code.get(left); code.i(4); code.emit(0x6a); code.get(position); code.emit(0x6a, 0x2d, 0x00, 0x00);
  code.get(right); code.i(4); code.emit(0x6a); code.get(position); code.emit(0x6a, 0x2d, 0x00, 0x00);
  code.emit(0x47, 0x04, 0x40); code.number(0); code.emit(0x0f, 0x0b);
  code.get(position); code.i(1); code.emit(0x6a); code.set(position);
  code.emit(0x0c, 0x00, 0x0b, 0x0b);
  code.number(1); code.emit(0x0b);
  return sized([...u(code.locals.length), ...code.locals.flatMap(type => [1, type]), ...code.code]);
}

function nativeBinary(ast) {
  const types = makeTypes(ast);
  const top = ast.body.filter(node => !['type', 'function', 'procedure', 'class'].includes(node.kind));
  if (ast.body.some(node => node.kind === 'class')) unsupported('Classes use compatibility backend');
  const routines = ast.body.filter(node => ['function', 'procedure'].includes(node.kind));
  if (expensiveStringLoop(top, types.constants) || routines.some(routine => expensiveStringLoop(routine.body, types.constants))) unsupported('Repeated string growth uses compatibility backend');
  const globals = collectSymbols(top, types, null, true);
  const stringMap = new Map(), data = [];
  collectText(top, stringMap, data);
  for (const routine of routines) collectText(routine.body, stringMap, data);
  const globalBase = align(8 + data.length), frameBase = align(globalBase + globals.size), heapBase = align(frameBase + 1048576);
  const routineMap = new Map();
  for (const [index, node] of routines.entries()) {
    if (routineMap.has(node.name)) unsupported('Duplicate routine');
    const paramTypes = node.params.map(param => types.layout(param.type));
    const returnType = node.returns ? types.layout(node.returns) : null;
    if (returnType && returnType.kind !== 'scalar') unsupported('Aggregate return value');
    if (node.kind === 'function' && !returnType) unsupported('Missing return type');
    if (node.kind === 'function' && !alwaysReturns(node.body)) unsupported('Function can fall through');
    const params = paramTypes.map((type, i) => {
      if (!node.params[i].byref && type.kind !== 'scalar') unsupported('Composite BYVAL parameter');
      return node.params[i].byref ? I32 : F64;
    });
    const localSymbols = collectSymbols(node.body, types, globals.symbols);
    const symbols = new Map(); let offset = 0;
    for (let i = 0; i < node.params.length; i++) {
      const param = node.params[i], type = paramTypes[i];
      if (symbols.has(param.name) || localSymbols.symbols.has(param.name)) unsupported('Duplicate parameter');
      symbols.set(param.name, { name: param.name, type, byref: param.byref, paramIndex: i, offset });
      if (!param.byref) offset += type.size;
    }
    for (const [name, symbol] of localSymbols.symbols) symbols.set(name, { ...symbol, offset: offset + symbol.offset });
    const frameSize = align(offset + localSymbols.size);
    if (frameSize > 1048576) unsupported('Routine frame exceeds native stack capacity');
    routineMap.set(node.name, { node, index, params, paramTypes, returnType, symbols, size: frameSize });
  }
  const unit = { globals, globalBase, frameBase, heapBase, routineMap, stringMap, inputNames: [], concatIndex: imports.length + routines.length, equalsIndex: imports.length + routines.length + 1 };
  const bodies = [];
  for (const routine of routineMap.values()) {
    const context = { params: routine.params, symbols: routine.symbols, size: routine.size, returnType: routine.returnType, isMain: false };
    const code = new Code(unit, context);
    context.baseLocal = code.local(I32); context.resultLocal = code.local(F64);
    framePrologue(code, context);
    routine.node.body.forEach(node => code.statement(node));
    bodies.push(code.finish({ kind: 'scalar' }));
  }
  const mainContext = { params: [], symbols: globals.symbols, size: 0, isMain: true };
  const main = new Code(unit, mainContext);
  main.call(6); main.setGlobal(3);
  top.forEach(node => main.statement(node));
  bodies.push(concatBody(), equalsBody(), main.finish());
  const typeSigs = imports.map(([, params, results]) => [params, results]);
  for (const routine of routineMap.values()) typeSigs.push([routine.params, [F64]]);
  typeSigs.push([[F64, F64], [F64]]);
  typeSigs.push([[F64, F64], [F64]]);
  typeSigs.push([[], []]);
  const typeSection = section(1, [...u(typeSigs.length), ...typeSigs.flatMap(([params, results]) => [0x60, ...sized(params), ...sized(results)])]);
  const importSection = section(2, [...u(imports.length), ...imports.flatMap(([name], index) => [...sized(encoded('env')), ...sized(encoded(name)), 0x00, ...u(index)])]);
  const functionSection = section(3, [...u(bodies.length), ...bodies.flatMap((_, index) => u(imports.length + index))]);
  const memoryPages = Math.max(1, Math.ceil((heapBase + 65536) / 65536));
  const memorySection = section(5, [1, 0, ...u(memoryPages)]);
  const globalValues = [frameBase, 0, 1, 250000, heapBase];
  const globalSection = section(6, [...u(globalValues.length), ...globalValues.flatMap(value => [I32, 1, 0x41, ...s(value), 0x0b])]);
  const exports = [...routines.map((node, index) => [node.name, 0, imports.length + index]), ['main', 0, imports.length + routines.length + 2], ['memory', 2, 0], ['steps', 3, 1], ['line', 3, 2], ['heapTop', 3, 4]];
  const exportSection = section(7, [...u(exports.length), ...exports.flatMap(([name, kind, index]) => [...sized(encoded(name)), kind, ...u(index)])]);
  const codeSection = section(10, [...u(bodies.length), ...bodies.flat()]);
  const dataSection = data.length ? section(11, [1, 0, 0x41, 8, 0x0b, ...sized(data)]) : [];
  const binary = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, ...typeSection, ...importSection, ...functionSection, ...memorySection, ...globalSection, ...exportSection, ...codeSection, ...dataSection]);
  if (!WebAssembly.validate(binary)) throw new Error('Native lowering emitted invalid WebAssembly');
  return { binary, native: true, nativeLabels: unit.inputNames, nativeGlobalBase: globalBase, nativeFrameBase: frameBase, nativeDataEnd: 8 + data.length };
}

export function tryNativeLower(source, compatibility, diagnostic = null) {
  try { return { ...compatibility, ...nativeBinary(parse(source)) }; }
  catch (error) {
    if (error instanceof Unsupported || error instanceof PseudoError) { if (diagnostic) diagnostic.reason = error.message; return null; }
    throw error;
  }
}
