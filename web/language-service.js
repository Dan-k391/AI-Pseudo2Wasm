// A tolerant, document-wide editor analysis. It does not execute or lower code;
// the self-hosted compiler remains the authority for generated WebAssembly.
const binaryWords = new Set(['AND', 'OR', 'IN', 'DIV', 'MOD']);
const binarySymbols = new Set(['+', '-', '*', '/', '&', '=', '<', '>', '<=', '>=', '<>']);
const matchingOpen = { ')': '(', ']': '[' };
const closerFor = { IF: 'ENDIF', WHILE: 'ENDWHILE', FOR: 'NEXT', REPEAT: 'UNTIL', CASE: 'ENDCASE', TYPE: 'ENDTYPE', CLASS: 'ENDCLASS', FUNCTION: 'ENDFUNCTION', PROCEDURE: 'ENDPROCEDURE' };
const openerFor = Object.fromEntries(Object.entries(closerFor).map(([open, close]) => [close, open]));

function report(token, message, code) {
  return { line: token.line, column: token.column, endColumn: token.column + Math.max(1, token.end - token.start), message, code, source: 'editor' };
}

function scan(source) {
  const rows = [], issues = [];
  let offset = 0;
  for (const [index, text] of source.replace(/\r\n/g, '\n').split('\n').entries()) {
    const line = index + 1, tokens = [];
    let pos = 0;
    const add = (kind, start, end) => tokens.push({ kind, text: text.slice(start, end), upper: text.slice(start, end).toUpperCase(), start: offset + start, end: offset + end, line, column: start + 1 });
    while (pos < text.length) {
      const char = text[pos], start = pos;
      if (/\s/.test(char)) { pos++; continue; }
      if (char === '/' && text[pos + 1] === '/') break;
      if (char === '"' || char === "'") {
        const quote = char;
        pos++;
        let closed = false;
        while (pos < text.length) {
          if (text[pos] === '\\' && text[pos + 1] === 'n') { pos += 2; continue; }
          if (text[pos++] === quote) {
            if (text[pos] === quote) { pos++; continue; }
            closed = true; break;
          }
        }
        add('string', start, pos);
        if (!closed) issues.push(report(tokens.at(-1), 'Unterminated string literal.', 'unterminated-string'));
        continue;
      }
      if (/[A-Za-z_]/.test(char)) {
        pos++;
        while (pos < text.length && /[A-Za-z0-9_]/.test(text[pos])) pos++;
        add('identifier', start, pos);
        continue;
      }
      if (/\d/.test(char)) {
        const date = /^\d{1,2}\/\d{1,2}\/\d{4}(?!\d)/.exec(text.slice(pos));
        if (date) { pos += date[0].length; add('date', start, pos); continue; }
        pos++;
        while (pos < text.length && /\d/.test(text[pos])) pos++;
        if (text[pos] === '.' && /\d/.test(text[pos + 1] || '')) {
          pos++;
          while (pos < text.length && /\d/.test(text[pos])) pos++;
        }
        add('number', start, pos);
        continue;
      }
      const pair = text.slice(pos, pos + 2);
      if (['<-', '<=', '>=', '<>'].includes(pair)) { pos += 2; add('symbol', start, pos); if (pair === '<-') tokens.at(-1).upper = '←'; continue; }
      pos++;
      add('symbol', start, pos);
      if (!'←:,.()[]+-*/^&=<>'.includes(char)) issues.push(report(tokens.at(-1), `Unexpected character ${JSON.stringify(char)}.`, 'unexpected-character'));
    }
    rows.push(tokens);
    offset += text.length + 1;
  }
  return { rows, issues };
}

function firstHead(tokens) {
  const skip = tokens[0]?.upper === 'PUBLIC' || tokens[0]?.upper === 'PRIVATE' ? 1 : 0;
  return tokens[skip]?.upper;
}

function blockDiagnostics(rows) {
  const stack = [], issues = [];
  for (const row of rows) {
    const skip = row[0]?.upper === 'PUBLIC' || row[0]?.upper === 'PRIVATE' ? 1 : 0;
    const token = row[skip], head = token?.upper;
    if (!head) continue;
    if (head === 'ELSE') {
      if (stack.at(-1)?.kind !== 'IF') issues.push(report(token, 'ELSE needs a matching IF.', 'unmatched-block'));
      else if (stack.at(-1).elseSeen) issues.push(report(token, 'This IF already has an ELSE.', 'duplicate-else'));
      else stack.at(-1).elseSeen = true;
      continue;
    }
    if (openerFor[head]) {
      const expected = openerFor[head];
      if (stack.at(-1)?.kind !== expected) issues.push(report(token, `${head} needs a matching ${expected}.`, 'unmatched-block'));
      else stack.pop();
      continue;
    }
    if (head === 'CASE' && row[skip + 1]?.upper !== 'OF') continue;
    if (head === 'TYPE' && row.some(item => item.upper === '=')) continue;
    if (closerFor[head]) stack.push({ kind: head, token, elseSeen: false });
  }
  for (const entry of stack) issues.push(report(entry.token, `Missing ${closerFor[entry.kind]} for this ${entry.kind}.`, 'missing-block-end'));
  return issues;
}

function staticInteger(tokens, constants) {
  if (tokens.length === 1 && tokens[0].kind === 'number' && /^\d+$/.test(tokens[0].text)) return Number(tokens[0].text);
  if (tokens.length === 1 && tokens[0].kind === 'identifier') return constants.get(tokens[0].upper);
  if (tokens.length === 2 && ['-', '+'].includes(tokens[0].text) && tokens[1].kind === 'number' && /^\d+$/.test(tokens[1].text))
    return Number(`${tokens[0].text}${tokens[1].text}`);
  return undefined;
}

function dimensions(tokens, from, constants) {
  const open = tokens.findIndex((token, index) => index >= from && token.text === '[');
  if (open < 0) return null;
  let close = tokens.findIndex((token, index) => index > open && token.text === ']');
  if (close < 0) close = tokens.length;
  const dims = [], content = tokens.slice(open + 1, close);
  let start = 0;
  for (let i = 0; i <= content.length; i++) if (i === content.length || content[i].text === ',') {
    const dimension = content.slice(start, i), colon = dimension.findIndex(token => token.text === ':');
    if (colon < 0) return null;
    const lo = staticInteger(dimension.slice(0, colon), constants), hi = staticInteger(dimension.slice(colon + 1), constants);
    dims.push(lo === undefined || hi === undefined ? null : { lo, hi });
    start = i + 1;
  }
  return dims;
}

function collectArrays(rows) {
  const constants = new Map(), aliases = new Map(), arrays = new Map();
  for (const row of rows) {
    const head = firstHead(row);
    if (head !== 'CONSTANT') continue;
    const value = row.findIndex(token => token.text === '=' || token.upper === '←');
    if (row[1]?.kind === 'identifier' && value > 1) {
      const number = staticInteger(row.slice(value + 1), constants);
      if (number !== undefined) constants.set(row[1].upper, number);
    }
  }
  for (const row of rows) if (firstHead(row) === 'TYPE' && row.some(token => token.upper === 'ARRAY')) {
    const name = row[1], marker = row.findIndex(token => token.upper === 'ARRAY');
    if (name?.kind === 'identifier') aliases.set(name.upper, dimensions(row, marker, constants));
  }
  for (const row of rows) {
    if (firstHead(row) !== 'DECLARE') continue;
    const colon = row.findIndex(token => token.text === ':');
    if (colon < 0) continue;
    const type = row[colon + 1];
    const dims = type?.upper === 'ARRAY' ? dimensions(row, colon + 1, constants) : aliases.get(type?.upper);
    if (!dims) continue;
    for (const token of row.slice(1, colon)) if (token.kind === 'identifier') {
      arrays.set(token.upper, arrays.has(token.upper) ? null : dims);
    }
  }
  return { arrays, constants };
}

function indexDiagnostics(rows, arrays, constants) {
  const issues = [];
  for (const row of rows) {
    if (['DECLARE', 'TYPE', 'DEFINE'].includes(firstHead(row))) continue;
    for (let i = 0; i < row.length - 2; i++) {
      const name = row[i], bounds = arrays.get(name.upper);
      if (name.kind !== 'identifier' || !bounds || row[i + 1].text !== '[') continue;
      let depth = 1, close = i + 2;
      while (close < row.length && depth) { if (row[close].text === '[') depth++; if (row[close].text === ']') depth--; close++; }
      if (depth) continue;
      const values = row.slice(i + 2, close - 1), parts = [];
      let start = 0, nested = 0;
      for (let j = 0; j <= values.length; j++) {
        if (j === values.length || (values[j].text === ',' && nested === 0)) { parts.push(values.slice(start, j)); start = j + 1; }
        else if (values[j].text === '(' || values[j].text === '[') nested++;
        else if (values[j].text === ')' || values[j].text === ']') nested--;
      }
      parts.forEach((part, dimension) => {
        const value = staticInteger(part, constants), limit = bounds[dimension];
        if (value !== undefined && limit && (value < limit.lo || value > limit.hi)) {
          issues.push(report(part.find(token => token.kind === 'number' || token.kind === 'identifier') || part[0],
            `Index ${value} is outside ${limit.lo}:${limit.hi} for ${name.text}.`, 'array-bounds'));
        }
      });
      i = close - 1;
    }
  }
  return issues;
}

function expressionSlices(row) {
  const head = firstHead(row);
  const output = row.findIndex(token => token.upper === 'OUTPUT');
  if (output >= 0) return [row.slice(output + 1)];
  if (head === 'IF') {
    const then = row.findIndex(token => token.upper === 'THEN');
    return [row.slice(1, then < 0 ? row.length : then)];
  }
  if (['WHILE', 'UNTIL', 'RETURN', 'CALL'].includes(head)) return [row.slice(1)];
  const arrow = row.findIndex(token => token.upper === '←');
  if (arrow >= 0 && head !== 'FOR' && head !== 'CONSTANT') return [row.slice(arrow + 1)];
  if (head === 'WRITEFILE') {
    const comma = row.findIndex(token => token.text === ',');
    if (comma >= 0) return [row.slice(comma + 1)];
  }
  return [];
}

function expressionDiagnostics(tokens) {
  if (!tokens.length) return [];
  const issues = [], stack = [];
  let expectsValue = true, previous = null, member = false;
  for (const token of tokens) {
    const value = token.upper;
    if (binaryWords.has(value)) {
      if (expectsValue) issues.push(report(token, `Expected a value before ${token.text}.`, 'missing-operand'));
      expectsValue = true;
    } else if (value === 'NOT' && expectsValue) {
      // Prefix boolean operator.
    } else if (value === 'NEW' && expectsValue) {
      // Object creation starts with a type name.
    } else if (token.text === '(' || token.text === '[') {
      if (token.text === '[' && expectsValue) issues.push(report(token, 'An index needs an array value before [.', 'unexpected-token'));
      if (token.text === '(' && !expectsValue && !['identifier', 'symbol'].includes(previous?.kind))
        issues.push(report(token, 'Expected an operator before (.', 'missing-operator'));
      stack.push({ token, kind: token.text, call: !expectsValue && token.text === '(', empty: true });
      expectsValue = true;
    } else if (token.text === ')' || token.text === ']') {
      const open = stack.pop();
      if (!open || open.kind !== matchingOpen[token.text]) issues.push(report(token, `Unmatched ${token.text}.`, 'unmatched-delimiter'));
      else if (expectsValue && !(open.call && open.empty)) issues.push(report(token, `Expected a value before ${token.text}.`, 'missing-operand'));
      expectsValue = false;
    } else if (token.text === ',') {
      if (expectsValue) issues.push(report(token, 'Expected a value before comma.', 'missing-operand'));
      if (stack.length) stack.at(-1).empty = false;
      expectsValue = true;
    } else if (token.text === '.') {
      if (expectsValue) issues.push(report(token, 'Expected a value before the field name.', 'missing-operand'));
      expectsValue = true; member = true;
    } else if (token.text === '^') {
      if (expectsValue) { /* Prefix address operator. */ }
      else expectsValue = false; // Pointer dereference.
    } else if (binarySymbols.has(value)) {
      if (expectsValue && value !== '+' && value !== '-') issues.push(report(token, `Expected a value before ${token.text}.`, 'missing-operand'));
      expectsValue = true;
    } else if (['identifier', 'number', 'date', 'string'].includes(token.kind)) {
      if (!expectsValue) issues.push(report(token, `Expected an operator or comma before ${token.text}.`, 'missing-operator'));
      expectsValue = false; member = false;
      if (stack.length) stack.at(-1).empty = false;
    } else {
      issues.push(report(token, `Unexpected token ${token.text}.`, 'unexpected-token'));
    }
    previous = token;
  }
  if (expectsValue && previous && !member && !issues.some(issue => issue.column === previous.column && issue.line === previous.line))
    issues.push(report(previous, 'Expected an expression here.', 'missing-operand'));
  for (const entry of stack) issues.push(report(entry.token, `Missing ${entry.kind === '(' ? ')' : ']'} to close this expression.`, 'missing-delimiter'));
  return issues;
}

export function analyzeSource(source) {
  const { rows, issues } = scan(source);
  const { arrays, constants } = collectArrays(rows);
  issues.push(...blockDiagnostics(rows), ...indexDiagnostics(rows, arrays, constants));
  for (const row of rows) for (const tokens of expressionSlices(row)) issues.push(...expressionDiagnostics(tokens));
  const seen = new Set();
  return issues.filter(issue => {
    const key = `${issue.line}:${issue.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.line - b.line || a.column - b.column).slice(0, 100);
}
