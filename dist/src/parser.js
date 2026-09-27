export class PseudoError extends Error {
  constructor(message, line = 1, column = 1) {
    super(message);
    this.name = 'PseudoError';
    this.line = line;
    this.column = column;
  }
}

export function tokenize(source) {
  const out = [];
  let i = 0, line = 1, column = 1;
  const add = (type, value, l = line, c = column) => out.push({ type, value, line: l, column: c });
  const advance = () => { const ch = source[i++]; if (ch === '\n') { line++; column = 1; } else column++; return ch; };
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\r') { advance(); continue; }
    if (ch === '\n') { add('eol', '\n'); advance(); continue; }
    if (ch === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') advance(); continue; }
    if (ch === '"' || ch === "'") {
      const l = line, c = column, quote = advance();
      let value = '', closed = false;
      while (i < source.length && source[i] !== '\n') {
        const a = advance();
        if (a === quote) {
          if (source[i] === quote) { advance(); value += quote; }
          else { closed = true; break; }
        } else if (a === '\\' && source[i] === 'n') { advance(); value += '\n'; }
        else value += a;
      }
      if (!closed) throw new PseudoError('Unterminated string', l, c);
      add('str', value, l, c); continue;
    }
    if (/[0-9]/.test(ch)) {
      const date = source.slice(i).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/);
      if (date) {
        const l = line, c = column;
        for (let j = 0; j < date[0].length; j++) advance();
        add('date', [Number(date[1]), Number(date[2]), Number(date[3])], l, c);
        continue;
      }
    }
    if (/[0-9]/.test(ch)) {
      const l = line, c = column; let value = '';
      while (i < source.length && /[0-9]/.test(source[i])) value += advance();
      if (source[i] === '.' && /[0-9]/.test(source[i + 1] || '')) { value += advance(); while (i < source.length && /[0-9]/.test(source[i])) value += advance(); }
      add('num', Number(value), l, c); continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const l = line, c = column; let value = '';
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) value += advance();
      add('id', value.toUpperCase(), l, c); continue;
    }
    const l = line, c = column;
    const two = source.slice(i, i + 2);
    if (['<-', '<=', '>=', '<>'].includes(two)) { advance(); advance(); add('sym', two === '<-' ? '←' : two, l, c); continue; }
    if ('←:,.()[]+-*/^&=<>'.includes(ch)) { advance(); add('sym', ch, l, c); continue; }
    throw new PseudoError(`Unexpected character ${JSON.stringify(ch)}`, l, c);
  }
  add('eol', '\n'); add('eof', '<EOF>');
  return out;
}

const PRECEDENCE = { OR: 1, AND: 2, '=': 3, '<>': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, IN: 3, '&': 4, '+': 5, '-': 5, '*': 6, '/': 6, DIV: 6, MOD: 6 };
const BUILTIN_TYPES = new Set(['INTEGER', 'REAL', 'STRING', 'CHAR', 'BOOLEAN', 'DATE']);

export class Parser {
  constructor(source) { this.tokens = tokenize(source); this.pos = 0; }
  get t() { return this.tokens[this.pos]; }
  peek(offset = 1) { return this.tokens[this.pos + offset]; }
  at(value) { return this.t.value === value; }
  take() { return this.tokens[this.pos++]; }
  error(message, t = this.t) { throw new PseudoError(message, t.line, t.column); }
  expect(value) { if (!this.at(value)) this.error(`Expected ${value}, found ${this.t.value}`); return this.take(); }
  id() { if (this.t.type !== 'id') this.error(`Expected identifier, found ${this.t.value}`); return this.take().value; }
  eol() { if (!this.at('\n') && !this.at('<EOF>')) this.error(`Expected end of line, found ${this.t.value}`); while (this.at('\n')) this.take(); }
  skipEol() { while (this.at('\n')) this.take(); }
  parse() {
    const body = []; this.skipEol();
    while (!this.at('<EOF>')) { body.push(this.statement()); this.skipEol(); }
    return { kind: 'program', body };
  }
  block(stops) {
    const body = []; this.skipEol();
    while (!this.at('<EOF>') && !stops.has(this.t.value)) { body.push(this.statement()); this.skipEol(); }
    return body;
  }
  type() {
    if (this.at('ARRAY')) {
      this.take(); this.expect('[');
      const ranges = [];
      do { const lo = this.expr(); this.expect(':'); const hi = this.expr(); ranges.push({ lo, hi }); if (!this.at(',')) break; this.take(); } while (true);
      this.expect(']'); this.expect('OF');
      return { kind: 'array', ranges, of: this.type() };
    }
    if (this.at('SET')) { this.take(); this.expect('OF'); return { kind: 'set', of: this.type() }; }
    if (this.at('^')) { this.take(); return { kind: 'pointer', to: this.type() }; }
    const name = this.id(); return { kind: 'named', name };
  }
  args() {
    this.expect('('); const args = [];
    if (!this.at(')')) do { args.push(this.expr()); if (!this.at(',')) break; this.take(); } while (true);
    this.expect(')'); return args;
  }
  expr(min = 0) {
    const start = this.t; let left;
    if (this.t.type === 'num' || this.t.type === 'str') { const x = this.take(); left = { kind: 'literal', value: x.value, line: x.line }; }
    else if (this.t.type === 'date') { const x = this.take(); left = { kind: 'date', value: x.value, line: x.line }; }
    else if (this.at('TRUE') || this.at('FALSE') || this.at('NULL')) { const x = this.take(); left = { kind: 'literal', value: x.value === 'NULL' ? null : x.value === 'TRUE', line: x.line }; }
    else if (this.at('(')) { this.take(); left = this.expr(); this.expect(')'); }
    else if (['NOT', '-', '+', '^'].includes(this.t.value)) { const op = this.take().value; left = { kind: 'unary', op, arg: this.expr(7), line: start.line }; }
    else if (this.at('NEW')) { this.take(); const name = this.id(); const args = this.at('(') ? this.args() : []; left = { kind: 'new', name, args, line: start.line }; }
    else if (this.t.type === 'id') { left = { kind: 'name', name: this.take().value, line: start.line }; }
    else this.error(`Expected expression, found ${this.t.value}`);
    while (true) {
      if (this.at('(')) { left = { kind: 'call', target: left, args: this.args(), line: left.line }; continue; }
      if (this.at('[')) { this.take(); const indices = [this.expr()]; while (this.at(',')) { this.take(); indices.push(this.expr()); } this.expect(']'); left = { kind: 'index', target: left, indices, line: left.line }; continue; }
      if (this.at('.')) { this.take(); left = { kind: 'field', target: left, name: this.id(), line: left.line }; continue; }
      if (this.at('^')) { this.take(); left = { kind: 'deref', target: left, line: left.line }; continue; }
      const op = this.t.value, prec = PRECEDENCE[op] || 0;
      if (prec <= min) break;
      this.take(); left = { kind: 'binary', op, left, right: this.expr(prec), line: left.line };
    }
    return left;
  }
  statement() {
    const start = this.t; let node;
    switch (start.value) {
      case 'DECLARE': {
        this.take(); const names = [this.id()]; while (this.at(',')) { this.take(); names.push(this.id()); }
        this.expect(':'); node = { kind: 'declare', names, type: this.type() }; this.eol(); break;
      }
      case 'CONSTANT': {
        this.take(); const name = this.id(); this.expect('='); node = { kind: 'constant', name, value: this.expr() }; this.eol(); break;
      }
      case 'TYPE': {
        this.take(); const name = this.id();
        if (this.at('=')) {
          this.take();
          if (this.at('(')) { this.take(); const values = [this.id()]; while (this.at(',')) { this.take(); values.push(this.id()); } this.expect(')'); node = { kind: 'type', name, type: { kind: 'enum', values } }; }
          else node = { kind: 'type', name, type: this.type() };
          this.eol();
        } else {
          this.eol(); const fields = this.block(new Set(['ENDTYPE'])); this.expect('ENDTYPE'); this.eol();
          node = { kind: 'type', name, type: { kind: 'record', fields } };
        }
        break;
      }
      case 'DEFINE': {
        this.take(); const name = this.id(), values = this.args(); this.expect(':'); const type = this.type(); this.eol(); node = { kind: 'define', name, values, type }; break;
      }
      case 'IF': {
        this.take(); const condition = this.expr(); this.expect('THEN'); this.eol();
        const then = this.block(new Set(['ELSE', 'ENDIF'])); let other = [];
        if (this.at('ELSE')) { this.take(); this.eol(); other = this.block(new Set(['ENDIF'])); }
        this.expect('ENDIF'); this.eol(); node = { kind: 'if', condition, then, other }; break;
      }
      case 'WHILE': {
        this.take(); const condition = this.expr(); if (this.at('DO')) this.take(); this.eol();
        const body = this.block(new Set(['ENDWHILE'])); this.expect('ENDWHILE'); this.eol(); node = { kind: 'while', condition, body }; break;
      }
      case 'REPEAT': {
        this.take(); this.eol(); const body = this.block(new Set(['UNTIL'])); this.expect('UNTIL'); const condition = this.expr(); this.eol(); node = { kind: 'repeat', body, condition }; break;
      }
      case 'FOR': {
        this.take(); const name = this.id(); this.expect('←'); const from = this.expr(); this.expect('TO'); const to = this.expr();
        let step = { kind: 'literal', value: 1, line: start.line }; if (this.at('STEP')) { this.take(); step = this.expr(); }
        this.eol(); const body = this.block(new Set(['NEXT'])); this.expect('NEXT'); if (this.t.type === 'id') this.take(); this.eol();
        node = { kind: 'for', name, from, to, step, body }; break;
      }
      case 'CASE': {
        this.take(); this.expect('OF'); const value = this.expr(); this.eol(); const arms = [];
        this.skipEol();
        while (!this.at('ENDCASE') && !this.at('<EOF>')) {
          const col = this.t.column; let lo = null, hi = null, otherwise = false;
          if (this.at('OTHERWISE')) { otherwise = true; this.take(); }
          else { lo = this.expr(); if (this.at('TO')) { this.take(); hi = this.expr(); } }
          this.expect(':'); const body = [];
          if (!this.at('\n')) body.push(this.statement()); else this.eol();
          while (!this.at('ENDCASE') && !this.at('<EOF>') && this.t.column > col) { body.push(this.statement()); this.skipEol(); }
          arms.push({ lo, hi, otherwise, body }); this.skipEol();
        }
        this.expect('ENDCASE'); this.eol(); node = { kind: 'case', value, arms }; break;
      }
      case 'FUNCTION': case 'PROCEDURE': {
        const kind = this.take().value.toLowerCase(), name = this.id(); this.expect('('); const params = [];
        if (!this.at(')')) do {
          let byref = false; if (this.at('BYREF') || this.at('BYVAL')) byref = this.take().value === 'BYREF';
          const pname = this.id(); this.expect(':'); params.push({ name: pname, type: this.type(), byref });
          if (!this.at(',')) break; this.take();
        } while (true);
        this.expect(')'); let returns = null; if (this.at('RETURNS')) { this.take(); returns = this.type(); }
        this.eol(); const end = kind === 'function' ? 'ENDFUNCTION' : 'ENDPROCEDURE';
        const body = this.block(new Set([end])); this.expect(end); this.eol(); node = { kind, name, params, returns, body }; break;
      }
      case 'CLASS': {
        this.take(); const name = this.id(); let parent = null; if (this.at('INHERITS')) { this.take(); parent = this.id(); }
        this.eol(); const members = this.block(new Set(['ENDCLASS'])); this.expect('ENDCLASS'); this.eol(); node = { kind: 'class', name, parent, members }; break;
      }
      case 'PUBLIC': case 'PRIVATE': {
        const access = this.take().value;
        if (this.t.type === 'id' && this.peek()?.value === ':') {
          const name = this.id(); this.expect(':'); const type = this.type(); this.eol();
          node = { kind: 'declare', names: [name], type, access };
        } else { node = this.statement(); node.access = access; }
        break;
      }
      case 'OUTPUT': {
        this.take(); const values = [this.expr()]; while (this.at(',')) { this.take(); values.push(this.expr()); }
        this.eol(); node = { kind: 'output', values }; break;
      }
      case 'INPUT': {
        this.take(); const targets = [this.expr()]; while (this.at(',')) { this.take(); targets.push(this.expr()); }
        this.eol(); node = { kind: 'input', targets }; break;
      }
      case 'CALL': { this.take(); const call = this.expr(); this.eol(); node = { kind: 'callstmt', call }; break; }
      case 'RETURN': { this.take(); const value = this.at('\n') ? null : this.expr(); this.eol(); node = { kind: 'return', value }; break; }
      case 'OPENFILE': {
        this.take(); const file = this.expr(); this.expect('FOR'); const mode = this.id(); this.eol(); node = { kind: 'file', op: 'OPENFILE', args: [file], mode }; break;
      }
      case 'CLOSEFILE': case 'READFILE': case 'WRITEFILE': case 'SEEK': case 'GETRECORD': case 'PUTRECORD': {
        const op = this.take().value; const args = [this.expr()]; while (this.at(',')) { this.take(); args.push(this.expr()); }
        this.eol(); node = { kind: 'file', op, args }; break;
      }
      default: {
        const left = this.expr();
        if (this.at('←')) { this.take(); const value = this.expr(); this.eol(); node = { kind: 'assign', target: left, value }; }
        else { this.eol(); node = { kind: 'callstmt', call: left }; }
      }
    }
    node.line = start.line; return node;
  }
}

export function parse(source) { return new Parser(source).parse(); }
export { BUILTIN_TYPES };
