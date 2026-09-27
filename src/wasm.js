import { PseudoError } from './parser.js';
import { IMPORTS, BINARY } from './abi.js';

const REF = 0x6f;
const enc = new TextEncoder();
const u = n => { const out = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n); return out; };
const s = n => { const out = []; let more = true; while (more) { let b = n & 127; n >>= 7; const sign = !!(b & 64); more = !((n === 0 && !sign) || (n === -1 && sign)); if (more) b |= 128; out.push(b); } return out; };
const bytes = a => [...u(a.length), ...a];
const utf = str => bytes([...enc.encode(str)]);
const section = (id, body) => [id, ...bytes(body)];
const f64 = n => { const buffer = new ArrayBuffer(8); new DataView(buffer).setFloat64(0, n, true); return [...new Uint8Array(buffer)]; };

const UNARY = ['NOT', '-', '+', '^'];
const FILES = ['OPENFILE', 'CLOSEFILE', 'READFILE', 'WRITEFILE', 'SEEK', 'GETRECORD', 'PUTRECORD'];

export function compileAst(ast) {
  const strings = [], ids = new Map(), types = {}, classes = {}, routines = [];
  const intern = value => { value = String(value); if (!ids.has(value)) { ids.set(value, strings.length); strings.push(value); } return ids.get(value); };
  const functions = new Map();
  for (const n of ast.body) {
    if (n.kind === 'type') types[n.name] = n.type;
    if (n.kind === 'class') {
      classes[n.name] = { parent: n.parent, fields: n.members.filter(x => x.kind === 'declare'), methods: {} };
      for (const m of n.members) if (m.kind === 'function' || m.kind === 'procedure') {
        const exportName = `${n.name}.${m.name}`;
        classes[n.name].methods[m.name] = { exportName, access: m.access || 'PUBLIC', params: m.params, returns: m.returns };
        routines.push({ ...m, exportName, className: n.name });
      }
    }
    if (n.kind === 'function' || n.kind === 'procedure') { functions.set(n.name, n); routines.push({ ...n, exportName: n.name }); }
  }
  const importId = Object.fromEntries(IMPORTS.map((x, i) => [x[0], i]));
  const routineIndex = new Map(routines.map((x, i) => [x.exportName, IMPORTS.length + i]));
  class Code {
    constructor(isMain = false) { this.a = []; this.locals = 0; this.isMain = isMain; }
    emit(...x) { this.a.push(...x); }
    i(n) { this.emit(0x41, ...s(n)); }
    num(n) { this.emit(0x44, ...f64(n)); this.call('num'); }
    call(name) { this.emit(0x10, ...u(importId[name])); }
    local() { return (this.isMain ? 0 : 1) + this.locals++; }
    getLocal(n) { this.emit(0x20, ...u(n)); }
    setLocal(n) { this.emit(0x21, ...u(n)); }
    drop() { this.emit(0x1a); }
    nil() { this.emit(0xd0, REF); }
    arglist(args, byref = []) {
      this.call('args');
      args.forEach((arg, i) => { if (byref[i]) this.ref(arg); else this.expr(arg); this.call('push'); });
    }
    methodArgs(args) {
      this.call('args');
      args.forEach(arg => { if (['name', 'field', 'index'].includes(arg.kind)) this.ref(arg); else this.expr(arg); this.call('push'); });
    }
    ref(n) {
      if (n.kind === 'name') { this.i(intern(n.name)); this.call('refName'); }
      else if (n.kind === 'field') { this.expr(n.target); this.i(intern(n.name)); this.call('refField'); }
      else if (n.kind === 'index') { this.expr(n.target); this.arglist(n.indices); this.call('refIndex'); }
      else throw new PseudoError('BYREF and INPUT need a variable, field, or array element', n.line);
    }
    expr(n) {
      switch (n.kind) {
        case 'literal':
          if (typeof n.value === 'number') this.num(n.value);
          else if (typeof n.value === 'string') { this.i(intern(n.value)); this.call('str'); }
          else if (typeof n.value === 'boolean') { this.i(n.value ? 1 : 0); this.call('bool'); }
          else this.nil(); break;
        case 'date': this.i(intern('SETDATE')); this.arglist(n.value.map(value => ({ kind: 'literal', value, line: n.line }))); this.call('builtin'); break;
        case 'name': this.i(intern(n.name)); this.call('get'); break;
        case 'unary': this.i(UNARY.indexOf(n.op)); if (n.op === '^') this.ref(n.arg); else this.expr(n.arg); this.call('unary'); break;
        case 'binary':
          if (n.op === 'AND' || n.op === 'OR') {
            this.expr(n.left); this.call('truth'); this.emit(0x04, REF);
            if (n.op === 'AND') { this.expr(n.right); this.call('truth'); this.call('bool'); } else { this.i(1); this.call('bool'); }
            this.emit(0x05);
            if (n.op === 'AND') { this.i(0); this.call('bool'); } else { this.expr(n.right); this.call('truth'); this.call('bool'); }
            this.emit(0x0b);
          } else { this.i(BINARY.indexOf(n.op)); this.expr(n.left); this.expr(n.right); this.call('binary'); }
          break;
        case 'index': this.expr(n.target); this.arglist(n.indices); this.call('index'); break;
        case 'field': this.expr(n.target); this.i(intern(n.name)); this.call('field'); break;
        case 'deref': this.expr(n.target); this.call('deref'); break;
        case 'new': this.i(intern(n.name)); this.methodArgs(n.args); this.call('newObject'); break;
        case 'call': {
          if (n.target.kind === 'name' && functions.has(n.target.name)) {
            const fn = functions.get(n.target.name); this.arglist(n.args, fn.params.map(p => p.byref));
            this.emit(0x10, ...u(routineIndex.get(n.target.name)));
          } else if (n.target.kind === 'field') {
            this.expr(n.target.target); this.i(intern(n.target.name)); this.methodArgs(n.args); this.call('callMethod');
          } else if (n.target.kind === 'name') {
            this.i(intern(n.target.name)); this.arglist(n.args); this.call('builtin');
          } else throw new PseudoError('Invalid call target', n.line);
          break;
        }
        default: throw new PseudoError(`Unsupported expression ${n.kind}`, n.line);
      }
    }
    assign(target, value) {
      if (target.kind === 'name') { this.i(intern(target.name)); this.expr(value); this.call('set'); }
      else if (target.kind === 'field') { this.expr(target.target); this.i(intern(target.name)); this.expr(value); this.call('setField'); }
      else if (target.kind === 'index') { this.expr(target.target); this.arglist(target.indices); this.expr(value); this.call('setIndex'); }
      else if (target.kind === 'deref') { this.expr(target.target); this.expr(value); this.call('setDeref'); }
      else throw new PseudoError('Invalid assignment target', target.line);
    }
    stmt(n) {
      this.i(n.line || 1); this.call('tick');
      switch (n.kind) {
        case 'declare':
          for (const name of n.names) {
            this.i(intern(name)); this.i(intern(JSON.stringify(n.type))); this.i(intern(JSON.stringify(n.type)));
            this.arrayRanges(n.type); this.call('create'); this.call('declare');
          } break;
        case 'constant': this.i(intern(n.name)); this.i(intern('$CONSTANT')); this.expr(n.value); this.call('declare'); break;
        case 'define': this.i(intern(n.name)); this.i(intern(JSON.stringify(n.type))); this.arglist(n.values); this.call('builtinDefine'); break;
        case 'type': case 'class': case 'function': case 'procedure': break;
        case 'assign': this.assign(n.target, n.value); break;
        case 'output': this.arglist(n.values); this.call('output'); break;
        case 'input': for (const t of n.targets) { this.ref(t); this.call('input'); } break;
        case 'callstmt': this.expr(n.call.kind === 'name' && functions.has(n.call.name) ? { kind: 'call', target: n.call, args: [], line: n.line } : n.call); this.drop(); break;
        case 'return':
          if (this.isMain) throw new PseudoError('RETURN outside a function or procedure', n.line);
          if (n.value) this.expr(n.value); else this.nil(); this.call('leave'); this.emit(0x0f); break;
        case 'if':
          this.expr(n.condition); this.call('truth'); this.emit(0x04, 0x40);
          n.then.forEach(x => this.stmt(x)); if (n.other.length) { this.emit(0x05); n.other.forEach(x => this.stmt(x)); }
          this.emit(0x0b); break;
        case 'while':
          this.emit(0x02, 0x40, 0x03, 0x40);
          this.i(n.line); this.call('tick'); this.expr(n.condition); this.call('truth'); this.emit(0x45, 0x0d, 0x01);
          n.body.forEach(x => this.stmt(x)); this.emit(0x0c, 0x00, 0x0b, 0x0b); break;
        case 'repeat':
          this.emit(0x03, 0x40); n.body.forEach(x => this.stmt(x));
          this.i(n.line); this.call('tick'); this.expr(n.condition); this.call('truth'); this.emit(0x45, 0x0d, 0x00, 0x0b); break;
        case 'for': {
          const end = this.local(), step = this.local();
          this.i(intern(n.name)); this.expr(n.from); this.call('set');
          this.expr(n.to); this.setLocal(end); this.expr(n.step); this.setLocal(step);
          this.emit(0x02, 0x40, 0x03, 0x40);
          this.i(n.line); this.call('tick');
          this.i(intern(n.name)); this.call('get'); this.getLocal(end); this.getLocal(step); this.call('forContinue');
          this.emit(0x45, 0x0d, 0x01); n.body.forEach(x => this.stmt(x));
          this.i(intern(n.name)); this.i(BINARY.indexOf('+')); this.i(intern(n.name)); this.call('get'); this.getLocal(step); this.call('binary'); this.call('set');
          this.emit(0x0c, 0x00, 0x0b, 0x0b); break;
        }
        case 'case': {
          const value = this.local(); this.expr(n.value); this.setLocal(value);
          const writeArm = index => {
            if (index >= n.arms.length) return;
            const arm = n.arms[index];
            if (arm.otherwise) { arm.body.forEach(x => this.stmt(x)); return; }
            this.getLocal(value); this.expr(arm.lo); if (arm.hi) this.expr(arm.hi); else this.nil(); this.i(arm.hi ? 1 : 0); this.call('caseMatches');
            this.emit(0x04, 0x40); arm.body.forEach(x => this.stmt(x)); this.emit(0x05); writeArm(index + 1); this.emit(0x0b);
          };
          writeArm(0); break;
        }
        case 'file': {
          this.i(FILES.indexOf(n.op));
          this.call('args');
          for (let k = 0; k < n.args.length; k++) {
            if ((n.op === 'READFILE' || n.op === 'GETRECORD') && k === 1) this.ref(n.args[k]);
            else this.expr(n.args[k]);
            this.call('push');
          }
          if (n.mode) { this.i(intern(n.mode)); this.call('str'); this.call('push'); }
          this.call('fileOp'); this.drop(); break;
        }
        default: throw new PseudoError(`Unsupported statement ${n.kind}`, n.line);
      }
    }
    arrayRanges(type) {
      this.call('args');
      if (type.kind === 'named' && types[type.name]) type = types[type.name];
      if (type.kind === 'array') for (const r of type.ranges) { this.expr(r.lo); this.call('push'); this.expr(r.hi); this.call('push'); }
    }
    body(nodes, fnId) {
      if (!this.isMain) { this.i(fnId); this.getLocal(0); this.call('enter'); }
      nodes.forEach(x => this.stmt(x));
      if (!this.isMain) { this.nil(); this.call('leave'); }
      this.emit(0x0b);
      const localDecl = this.locals ? [0x01, ...u(this.locals), REF] : [0x00];
      return bytes([...localDecl, ...this.a]);
    }
  }
  // DEFINE uses the ordinary declaration path: a set value comes from the arguments list.
  importId.builtinDefine = importId.declare;
  const bodies = routines.map((n, i) => new Code().body(n.body, i));
  const mainNodes = ast.body.filter(n => !['function', 'procedure', 'class', 'type'].includes(n.kind));
  const main = new Code(true).body(mainNodes, -1);
  const typeSigs = IMPORTS.map(x => [x[1], x[2]]).concat([[[REF], [REF]], [[], []]]);
  const typeSection = section(1, [...u(typeSigs.length), ...typeSigs.flatMap(([params, result]) => [0x60, ...bytes(params), ...bytes(result)])]);
  const importSection = section(2, [...u(IMPORTS.length), ...IMPORTS.flatMap((x, i) => [...utf('env'), ...utf(x[0]), 0x00, ...u(i)])]);
  const functionSection = section(3, [...u(routines.length + 1), ...routines.map(() => IMPORTS.length), IMPORTS.length + 1]);
  const exports = routines.map((n, i) => [n.exportName, IMPORTS.length + i]).concat([['main', IMPORTS.length + routines.length]]);
  const exportSection = section(7, [...u(exports.length), ...exports.flatMap(([name, index]) => [...utf(name), 0x00, ...u(index)])]);
  const codeSection = section(10, [...u(bodies.length + 1), ...bodies.flat(), ...main]);
  const binary = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, ...typeSection, ...importSection, ...functionSection, ...exportSection, ...codeSection]);
  return { binary, strings, types, classes, routines, ast };
}
