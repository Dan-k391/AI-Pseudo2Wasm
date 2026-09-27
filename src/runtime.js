import { PseudoError } from './parser.js';
import { MemoryString, StringMemory } from './string-memory.js';
import { CellMemory } from './cell-memory.js';

class InputRequired extends Error {
  constructor(label, line) { super(`Input required for ${label}`); this.name = 'InputRequired'; this.label = label; this.line = line; }
}

const scalar = value => value && value.__enum ? value.name : value instanceof MemoryString ? value.toString() : value;
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
function show(value) {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof MemoryString) return value.toString();
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}/${value.getUTCFullYear()}`;
  if (value instanceof Set) return `{${[...value].map(show).join(', ')}}`;
  if (value && value.__enum) return value.name;
  if (value && value.__array) return `[${value.data.map(show).join(', ')}]`;
  if (value && value.__object) return `<${value.__class}>`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
const clone = value => {
  if (value instanceof MemoryString) return value;
  if (value instanceof Set) return new Set([...value].map(clone));
  if (value instanceof Date) return new Date(value);
  if (value && value.__array) return { ...value, data: value.data.map(clone) };
  if (value && typeof value === 'object' && !value.__ref && !value.__object && !value.__enum && !value.__pointer) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
};

export function createRuntime(compiled, options = {}) {
  const { strings, types, classes, routines } = compiled;
  const globals = new Map(), scopes = [globals], output = [], pendingThis = [], frames = [];
  const nameIds = new Map();
  const canonicalIds = strings.map((value, index) => {
    if (!nameIds.has(value)) nameIds.set(value, index);
    return nameIds.get(value);
  });
  const activeCells = new Array(strings.length), activeRefs = new Array(strings.length), scopeChanges = [];
  const routineParamIds = routines.map(routine => routine.params.map(param => nameIds.get(param.name)));
  const files = Object.fromEntries(Object.entries(options.files || {}).map(([k, v]) => [k, String(v)]));
  const records = clone(options.records || {}), handles = new Map();
  const input = Array.isArray(options.inputLines) ? [...options.inputLines] : (String(options.input || '') ? String(options.input).replace(/\r/g, '').replace(/\n$/, '').split('\n') : []);
  let inputPos = 0, steps = 0, line = 1, wasm = null, stringMemory = null, cellMemory = null;
  const text = value => stringMemory.from(value);
  let randomState = (options.seed ?? (Math.random() * 0x100000000)) >>> 0;
  const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 0x100000000; };
  const today = options.today ? new Date(options.today) : new Date();
  const maxSteps = options.maxSteps ?? 250000;
  const name = i => strings[i];
  const fail = message => { throw new PseudoError(message, line, 1); };
  const parseType = i => { try { return JSON.parse(name(i)); } catch { return { kind: 'named', name: name(i) }; } };
  const resolveType = type => {
    if (!type) return null;
    if (type.kind === 'named' && types[type.name]) return resolveType(types[type.name]);
    return type;
  };
  function defaultValue(type, bounds = []) {
    if (type?.kind === 'named' && classes[type.name]) return null;
    type = resolveType(type);
    if (!type) return null;
    if (type.kind === 'array') {
      const ranges = [];
      for (let i = 0; i < type.ranges.length; i++) {
        const bound = expression => expression.kind === 'name' ? cell(expression.name).value : expression.value;
        const lo = Number(bounds[i * 2] ?? bound(type.ranges[i].lo));
        const hi = Number(bounds[i * 2 + 1] ?? bound(type.ranges[i].hi));
        if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo || hi - lo > 100000) fail('Invalid array bounds');
        ranges.push([lo, hi]);
      }
      const size = ranges.reduce((n, [lo, hi]) => n * (hi - lo + 1), 1);
      if (size > 1000000) fail('Array is too large');
      return { __array: true, ranges, of: type.of, data: Array.from({ length: size }, () => defaultValue(type.of)) };
    }
    if (type.kind === 'record') {
      const record = {};
      for (const d of type.fields) if (d.kind === 'declare') for (const n of d.names) record[n] = defaultValue(d.type);
      return record;
    }
    if (type.kind === 'set') return new Set();
    if (type.kind === 'pointer') return null;
    if (type.kind === 'enum') return { __enum: true, name: type.values[0], ordinal: 0 };
    switch (type.name) {
      case 'INTEGER': case 'REAL': return 0;
      case 'STRING': case 'CHAR': return text('');
      case 'BOOLEAN': return false;
      case 'DATE': return new Date(Date.UTC(1970, 0, 1));
      default: fail(`Unknown type ${type.name}`);
    }
  }
  function matches(type, value) {
    if (type?.kind === 'named' && classes[type.name]) return value === null || (value?.__object && (value.__class === type.name || (() => { for (let c = value.__class; c; c = classes[c]?.parent) if (c === type.name) return true; return false; })()));
    type = resolveType(type);
    if (!type || value === null) return true;
    if (type.kind === 'array') return !!value?.__array;
    if (type.kind === 'record') return !!value && typeof value === 'object' && !value.__array;
    if (type.kind === 'set') return value instanceof Set;
    if (type.kind === 'pointer') return !!value?.__pointer;
    if (type.kind === 'enum') return !!value?.__enum && type.values.includes(value.name);
    switch (type.name) {
      case 'INTEGER': return Number.isInteger(value);
      case 'REAL': return isNumber(value);
      case 'STRING': return typeof value === 'string' || value instanceof MemoryString;
      case 'CHAR': return (typeof value === 'string' || value instanceof MemoryString) && value.length === 1;
      case 'BOOLEAN': return typeof value === 'boolean';
      case 'DATE': return value instanceof Date && !Number.isNaN(+value);
      default: return true;
    }
  }
  function cell(key) {
    const id = nameIds.get(key);
    if (id !== undefined && activeCells[id]) return activeCells[id];
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(key)) return scopes[i].get(key);
    for (let i = scopes.length - 1; i >= 0; i--) {
      const self = scopes[i].get('$THIS')?.value;
      if (self && Object.hasOwn(self.fields, key)) return self.fields[key];
    }
    fail(`Undeclared identifier ${key}`);
  }
  function bind(scope, key, slot, id = nameIds.get(key), reference = undefined) {
    scope.set(key, slot);
    if (id !== undefined) {
      if (scope !== globals) scopeChanges.push(id, activeCells[id], activeRefs[id]);
      activeCells[id] = slot;
      activeRefs[id] = reference;
    }
  }
  const cellById = id => activeCells[canonicalIds[id]] || cell(name(id));
  const read = ref => ref.value;
  const write = (ref, value) => {
    if (ref.constant) fail('Cannot assign to a constant');
    if (!matches(ref.type, value)) fail(`Expected ${ref.type?.name || ref.type?.kind}, got ${show(value)}`);
    ref.value = clone(text(value));
    cellMemory.sync(ref);
  };
  function indexCell(target, indices) {
    if (!target?.__array) fail('Indexing requires an array');
    if (indices.length !== target.ranges.length) fail(`Expected ${target.ranges.length} array indices`);
    let offset = 0;
    for (let i = 0; i < indices.length; i++) {
      const [lo, hi] = target.ranges[i], idx = Number(indices[i]);
      if (!Number.isInteger(idx) || idx < lo || idx > hi) fail(`Array index ${show(indices[i])} is outside ${lo}:${hi}`);
      offset = offset * (hi - lo + 1) + idx - lo;
    }
    return { type: target.of, get value() { return target.data[offset]; }, set value(v) { target.data[offset] = v; } };
  }
  function fieldCell(target, key) {
    if (target?.__object) target = target.fields;
    if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) fail(`Unknown field ${key}`);
    const slot = target[key];
    if (slot && typeof slot === 'object' && Object.hasOwn(slot, 'type') && Object.hasOwn(slot, 'value')) return slot;
    return { type: null, get value() { return target[key]; }, set value(v) { target[key] = v; } };
  }
  const numerical = (a, b, op) => { if (!isNumber(a) || !isNumber(b)) fail(`${op} needs numbers`); return [a, b]; };
  const same = (a, b) => {
    if (a?.__enum && b?.__enum) return a.name === b.name;
    if (a instanceof Date && b instanceof Date) return +a === +b;
    return scalar(a) === scalar(b);
  };
  const binary = (op, a, b) => {
    if (op === 9) return stringMemory.concat(a instanceof MemoryString ? a : show(a), b instanceof MemoryString ? b : show(b));
    a = scalar(a); b = scalar(b);
    switch (op) {
      case 0: return Boolean(a) || Boolean(b);
      case 1: return Boolean(a) && Boolean(b);
      case 2: return same(a, b);
      case 3: return !same(a, b);
      case 4: return a < b;
      case 5: return a <= b;
      case 6: return a > b;
      case 7: return a >= b;
      case 8: return b instanceof Set ? (b.has(a) || [...b].some(item => same(item, a))) : fail('IN needs a set on the right');
      case 10: numerical(a, b, '+'); return a + b;
      case 11: numerical(a, b, '-'); return a - b;
      case 12: numerical(a, b, '*'); return a * b;
      case 13: numerical(a, b, '/'); if (b === 0) fail('Division by zero'); return a / b;
      case 14: numerical(a, b, 'DIV'); if (b === 0) fail('Division by zero'); return Math.trunc(a / b);
      case 15: numerical(a, b, 'MOD'); if (b === 0) fail('Division by zero'); return a % b;
      default: fail(`Unknown operator ${op}`);
    }
  };
  const date = value => { if (!(value instanceof Date)) fail('Expected DATE'); return value; };
  const integer = value => { if (!Number.isInteger(value)) fail('Expected INTEGER'); return value; };
  const string = value => { if (value instanceof MemoryString) return value.toString(); if (typeof value !== 'string') fail('Expected STRING'); return value; };
  function builtin(key, a) {
    switch (key) {
      case 'LENGTH': return a[0] instanceof MemoryString ? a[0].length : string(a[0]).length;
      case 'LEFT': return string(a[0]).slice(0, integer(a[1]));
      case 'RIGHT': return string(a[0]).slice(-integer(a[1]));
      case 'MID': return string(a[0]).substr(integer(a[1]) - 1, integer(a[2]));
      case 'UCASE': case 'TO_UPPER': return string(a[0]).toUpperCase();
      case 'LCASE': case 'TO_LOWER': return string(a[0]).toLowerCase();
      case 'NUM_TO_STR': return show(a[0]);
      case 'STR_TO_NUM': { const raw = string(a[0]); if (!/^[-+]?\d+(?:\.\d+)?$/.test(raw)) fail('Invalid numeric string'); return Number(raw); }
      case 'IS_NUM': return /^[-+]?\d+(?:\.\d+)?$/.test(string(a[0]));
      case 'ASC': return string(a[0]).codePointAt(0);
      case 'CHR': return String.fromCodePoint(integer(a[0]));
      case 'INT': return Math.trunc(Number(a[0]));
      case 'RAND': return random();
      case 'DAY': return date(a[0]).getUTCDate();
      case 'MONTH': return date(a[0]).getUTCMonth() + 1;
      case 'YEAR': return date(a[0]).getUTCFullYear();
      case 'DAYINDEX': return date(a[0]).getUTCDay() + 1;
      case 'SETDATE': { const [day, month, year] = a.map(integer); const d = new Date(Date.UTC(year, month - 1, day)); if (d.getUTCDate() !== day || d.getUTCMonth() !== month - 1) fail('Invalid date'); return d; }
      case 'TODAY': return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      case 'EOF': { const h = handles.get(show(a[0])); if (!h) fail('File is not open'); return h.pos >= h.lines.length; }
      default: fail(`Unknown function ${key}`);
    }
  }
  function fileOp(op, a) {
    const filename = show(a[0]);
    if (op === 0) {
      const mode = show(a[1]);
      if (!['READ', 'WRITE', 'APPEND', 'RANDOM'].includes(mode)) fail(`Invalid file mode ${mode}`);
      if (handles.has(filename)) fail(`File ${filename} is already open`);
      if (mode === 'READ' && !Object.hasOwn(files, filename)) fail(`File ${filename} does not exist`);
      if (mode === 'WRITE') files[filename] = '';
      if (mode === 'RANDOM') records[filename] ??= [];
      handles.set(filename, { mode, pos: mode === 'APPEND' ? (files[filename] || '').split('\n').length : 0, lines: (files[filename] || '').replace(/\n$/, '').split('\n').filter((_, i, arr) => arr.length > 1 || arr[0] !== '') });
      return null;
    }
    const h = handles.get(filename); if (!h) fail(`File ${filename} is not open`);
    if (op === 1) { handles.delete(filename); return null; }
    if (op === 2) { if (h.mode !== 'READ') fail('READFILE needs READ mode'); if (h.pos >= h.lines.length) fail('End of file'); write(a[1], h.lines[h.pos++]); return null; }
    if (op === 3) { if (!['WRITE', 'APPEND'].includes(h.mode)) fail('WRITEFILE needs WRITE or APPEND mode'); files[filename] = (files[filename] || '') + string(a[1]) + '\n'; return null; }
    if (h.mode !== 'RANDOM') fail('Record operation needs RANDOM mode');
    if (op === 4) { h.pos = integer(a[1]); if (h.pos < 0) fail('Invalid record address'); return null; }
    if (op === 5) { if (h.pos >= records[filename].length) fail('Record does not exist'); write(a[1], records[filename][h.pos++]); return null; }
    if (op === 6) { records[filename][h.pos++] = clone(a[1]); return null; }
    return null;
  }
  function findMethod(className, method) {
    for (let c = className; c; c = classes[c]?.parent) {
      if (classes[c]?.methods[method]) return classes[c].methods[method];
    }
    fail(`Unknown method ${method}`);
  }
  function invokeMethod(object, method) {
    const info = findMethod(object.__super || object.__class, method);
    if (!wasm) fail('WebAssembly module is not ready');
    return info;
  }
  const prepareMethodArgs = (info, args) => args.map((arg, i) => {
    const reference = cellMemory.lookup(arg);
    if (info.params[i]?.byref || !reference) return arg;
    const value = reference.cell.value;
    if (reference.transient) cellMemory.release(arg);
    return value;
  });
  for (const [typeName, type] of Object.entries(types)) if (type.kind === 'enum') {
    type.values.forEach((item, ordinal) => bind(globals, item, { type: { kind: 'enum', values: type.values }, value: { __enum: true, typeName, name: item, ordinal }, constant: true }));
  }
  const env = {
    tick(n) { line = n; if (++steps > maxSteps) fail(`Execution limit (${maxSteps.toLocaleString()} steps) reached`); },
    num: n => n, str: i => stringMemory.literal(i) || text(name(i)), bool: n => !!n,
    get: i => read(cellById(i)), set: (i, v) => write(cellById(i), v),
    declare(i, typeId, value) {
      const key = name(i), scope = scopes.at(-1);
      if (scope.has(key)) fail(`${key} is already declared`);
      const type = parseType(typeId), constant = name(typeId) === '$CONSTANT';
      if (constant) bind(scope, key, { type: null, value: clone(text(value)), constant: true });
      else if (Array.isArray(value) && resolveType(type)?.kind === 'set') bind(scope, key, { type, value: new Set(value), constant: false });
      else bind(scope, key, { type, value: text(value), constant: false });
    },
    loopVar(i, typeId, value) {
      const key = name(i), scope = scopes.at(-1), type = parseType(typeId);
      if (scope.has(key)) {
        const slot = scope.get(key);
        if (slot.constant) fail(`Cannot reset constant ${key}`);
        slot.value = clone(text(value));
        cellMemory.sync(slot);
      } else bind(scope, key, { type, value: clone(text(value)), constant: false });
    },
    binary, unary(op, value) {
      if (op === 0) { if (typeof value !== 'boolean') fail('NOT needs a BOOLEAN'); return !value; }
      if (op === 1) return -Number(value);
      if (op === 2) return +Number(value);
      if (op === 3) {
        const target = cellMemory.has(value) ? cellMemory.cell(value) : value;
        if (cellMemory.has(value)) cellMemory.release(value);
        return { __pointer: true, cell: target };
      }
      fail('Unknown unary operator');
    },
    truth(v) { if (typeof v !== 'boolean') fail('Condition needs a BOOLEAN'); return v ? 1 : 0; },
    args: () => [], push: (a, v) => { a.push(v); return a; }, builtin: (i, a) => text(builtin(name(i), a)),
    output: a => { const lineText = a.map(show).join(''); output.push(lineText); options.onOutput?.(lineText); },
    input(ref) {
      if (inputPos >= input.length) {
        if (options.interactive) throw new InputRequired(cellMemory.has(ref) ? cellMemory.label(ref) : 'value', line);
        fail('INPUT needs another line');
      }
      const target = cellMemory.has(ref) ? cellMemory.cell(ref) : ref;
      const raw = input[inputPos++], type = resolveType(target.type);
      let value = raw;
      if (type?.name === 'INTEGER') value = Number(raw);
      if (type?.name === 'REAL') value = Number(raw);
      if (type?.name === 'BOOLEAN') value = raw.toUpperCase() === 'TRUE';
      if (type?.name === 'DATE') { const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); value = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date(raw); }
      write(target, text(value));
      if (cellMemory.has(ref)) cellMemory.release(ref);
    },
    index: (v, a) => read(indexCell(v, a)), setIndex: (v, a, x) => write(indexCell(v, a), x),
    field: (v, i) => read(fieldCell(v, name(i))), setField: (v, i, x) => write(fieldCell(v, name(i)), x),
    enter(i, a) {
      const routine = routines[i], scope = new Map();
      if (a.length !== routine.params.length) fail(`${routine.name} expects ${routine.params.length} argument${routine.params.length === 1 ? '' : 's'}`);
      scope.changeMark = scopeChanges.length;
      scopes.push(scope);
      if (routine.className) {
        const self = pendingThis.pop(); if (!self) fail('Method needs an object');
        bind(scope, '$THIS', { value: self });
        bind(scope, 'SUPER', { value: { ...self, __super: classes[routine.className].parent } });
      }
      let borrowed = null;
      routine.params.forEach((param, j) => {
        if (param.byref) {
          const reference = cellMemory.lookup(a[j]);
          if (!reference) fail(`${param.name} needs BYREF argument`);
          bind(scope, param.name, reference.cell, routineParamIds[i][j], a[j]);
          if (reference.transient) (borrowed ??= []).push(a[j]);
        }
        else { if (!matches(param.type, a[j])) fail(`Invalid argument for ${param.name}`); bind(scope, param.name, { type: param.type, value: clone(text(a[j])), constant: false }, routineParamIds[i][j]); }
      });
      frames.push(routine, borrowed);
    },
    leave(value) {
      const borrowed = frames.pop(), routine = frames.pop();
      if (routine.kind === 'function' && (value === null || !matches(routine.returns, value))) fail(`${routine.name} must return ${routine.returns?.name || routine.returns?.kind}`);
      const scope = scopes.pop();
      while (scopeChanges.length > scope.changeMark) {
        const previousRef = scopeChanges.pop(), previousCell = scopeChanges.pop(), id = scopeChanges.pop();
        activeCells[id] = previousCell;
        activeRefs[id] = previousRef;
      }
      if (borrowed) for (const reference of borrowed) cellMemory.release(reference);
      return value;
    },
    create: (i, bounds) => defaultValue(parseType(i), bounds),
    fileOp, forContinue(current, end, step) { if (!isNumber(step) || step === 0) fail('FOR STEP must be a nonzero number'); return step > 0 ? current <= end : current >= end; },
    caseMatches(v, lo, hi, range) { v = scalar(v); lo = scalar(lo); hi = scalar(hi); return range ? v >= lo && v <= hi : same(v, lo); },
    refName: i => activeRefs[canonicalIds[i]] === undefined ? cellMemory.promote(cellById(i), name(i)) : cellMemory.retain(activeRefs[canonicalIds[i]]),
    refIndex: (v, a) => cellMemory.alias(indexCell(v, a), 'array element'),
    refField: (v, i) => cellMemory.alias(fieldCell(v, name(i)), name(i)),
    deref(v) { if (!v?.__pointer) fail('Cannot dereference non-pointer'); return read(v.cell); },
    setDeref(v, x) { if (!v?.__pointer) fail('Cannot dereference non-pointer'); write(v.cell, x); },
    newObject(i, args) {
      const className = name(i), definition = classes[className]; if (!definition) fail(`Unknown class ${className}`);
      const fields = {}; const lineage = [];
      for (let c = className; c; c = classes[c]?.parent) lineage.unshift(c);
      for (const c of lineage) for (const decl of classes[c].fields) for (const key of decl.names) fields[key] = { type: decl.type, value: defaultValue(decl.type), constant: false };
      const object = { __object: true, __class: className, fields };
      if (definition.methods.NEW) { const method = definition.methods.NEW; pendingThis.push(object); wasm.exports[method.exportName](prepareMethodArgs(method, args)); }
      return object;
    },
    callMethod(object, i, args) {
      if (!object?.__object) fail('Method call needs an object');
      const method = invokeMethod(object, name(i)); pendingThis.push(object);
      return wasm.exports[method.exportName](prepareMethodArgs(method, args));
    },
  };
  // A BYREF externref carries an address into the module's linear memory.
  const baseWriteFile = env.fileOp;
  env.fileOp = (op, args) => {
    const reference = (op === 2 || op === 5) && cellMemory.has(args[1]) ? args[1] : null;
    if (reference !== null) args[1] = cellMemory.cell(reference);
    try { return baseWriteFile(op, args); }
    finally { if (reference !== null) cellMemory.release(reference); }
  };
  return {
    env, output, files, records,
    get steps() { return steps; }, get line() { return line; },
    async run() {
      try {
        const result = await WebAssembly.instantiate(compiled.binary, { env });
        wasm = result.instance || result;
        stringMemory = new StringMemory(wasm.exports.memory || new WebAssembly.Memory({ initial: 1 }), compiled.literalStrings || strings, !!wasm.exports.memory);
        cellMemory = new CellMemory(stringMemory);
        wasm.exports.main();
        cellMemory.syncAll();
        return { status: 'completed', output: [...output], files: { ...files }, records: stringMemory.plain(records), steps, binary: compiled.binary, memory: stringMemory.memory, stringBytes: stringMemory.top };
      } catch (error) {
        if (error instanceof InputRequired) {
          cellMemory?.syncAll();
          return { status: 'waiting', output: [...output], files: { ...files }, records: stringMemory.plain(records), steps, line: error.line, label: error.label, binary: compiled.binary };
        }
        if (error instanceof PseudoError) throw error;
        throw new PseudoError(error.message, line, 1);
      }
    },
  };
}
