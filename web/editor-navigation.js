// A tolerant editor index: incomplete code remains navigable while it is being typed.
const wordChar = /[A-Za-z0-9_]/;
const keywords = new Set(`DECLARE CONSTANT TYPE ENDTYPE DEFINE CLASS ENDCLASS PUBLIC PRIVATE INHERITS FUNCTION ENDFUNCTION PROCEDURE ENDPROCEDURE RETURNS RETURN BYREF BYVAL CALL NEW SUPER OUTPUT INPUT OPENFILE CLOSEFILE READFILE WRITEFILE GETRECORD PUTRECORD SEEK FOR TO STEP NEXT WHILE ENDWHILE REPEAT UNTIL IF THEN ELSE ENDIF CASE OF OTHERWISE ENDCASE AND OR NOT IN DIV MOD TRUE FALSE NULL INTEGER REAL BOOLEAN CHAR STRING DATE ARRAY SET READ WRITE APPEND RANDOM`.split(' '));

function scan(source) {
  const tokens = [], lines = [[]];
  let i = 0, line = 1, column = 1;
  const add = (kind, start, end, value) => { const token = { kind, start, end, value, line, column, index: tokens.length }; tokens.push(token); lines.at(-1).push(token); };
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\n') { i++; line++; column = 1; lines.push([]); continue; }
    if (ch === '\r' || ch === ' ' || ch === '\t') { i++; column++; continue; }
    if (ch === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') { i++; column++; } continue; }
    if (ch === '"' || ch === "'") {
      const quote = ch; i++; column++;
      while (i < source.length && source[i] !== '\n') {
        if (source[i] === quote) { i++; column++; if (source[i] !== quote) break; }
        i++; column++;
      }
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < source.length && wordChar.test(source[i])) { i++; column++; }
      add('id', start, i, source.slice(start, i).toUpperCase());
      // add() needs the token's original column, not its ending column.
      tokens.at(-1).column -= i - start;
      continue;
    }
    add('sym', i, i + 1, ch); i++; column++;
    tokens.at(-1).column--;
  }
  return { tokens, lines };
}

function findToken(tokens, offset) {
  return tokens.find(token => token.kind === 'id' && offset >= token.start && offset < token.end)
    || tokens.find(token => token.kind === 'id' && offset === token.end);
}

export function indexSource(source) {
  const { tokens, lines } = scan(source), definitions = [], definitionAt = new Map(), context = new Map();
  let currentClass = null, currentRoutine = null;
  let nextScope = 1;
  const define = (token, kind, scope, type = null) => {
    if (!token || token.kind !== 'id') return;
    const entry = { token, name: token.value, kind, scope, type };
    definitions.push(entry); definitionAt.set(token.start, entry);
    return entry;
  };
  for (const row of lines) {
    const words = row.filter(token => token.kind === 'id');
    const head = words[0]?.value;
    if (head === 'ENDCLASS' || head === 'ENDTYPE') currentClass = null;
    if (head === 'ENDFUNCTION' || head === 'ENDPROCEDURE') currentRoutine = null;
    if (head === 'CLASS' || head === 'TYPE') {
      const name = words[1];
      define(name, head.toLowerCase(), 'global');
      currentClass = name?.value || null;
    }
    const routineIndex = words.findIndex(token => token.value === 'FUNCTION' || token.value === 'PROCEDURE');
    if (routineIndex >= 0) {
      const name = words[routineIndex + 1], owner = currentClass || 'global';
      define(name, 'routine', owner);
      currentRoutine = `${owner}:${name?.value || '?'}:${nextScope++}`;
    }
    for (const token of row) context.set(token.start, { className: currentClass, routine: currentRoutine });
    if (routineIndex >= 0) {
      const open = row.findIndex(token => token.value === '('), close = row.findIndex((token, i) => i > open && token.value === ')');
      if (open >= 0) {
        const end = close < 0 ? row.length : close;
        for (let i = open + 1; i < end; i++) {
          if (row[i].kind === 'id' && row[i + 1]?.value === ':') define(row[i], 'parameter', currentRoutine, row[i + 2]?.value);
        }
      }
    }
    if (head === 'DECLARE' || head === 'CONSTANT') {
      const colon = row.findIndex(token => token.value === ':');
      const type = colon < 0 ? null : row.slice(colon + 1).filter(token => token.kind === 'id').at(-1)?.value;
      for (let i = 1; i < row.length && (colon < 0 || i < colon); i++) {
        if (row[i].kind === 'id' && (i === 1 || row[i - 1]?.value === ','))
          define(row[i], head.toLowerCase(), currentRoutine || currentClass || 'global', type);
      }
    }
    if (head === 'FOR' && words[1] && !definitions.some(entry => entry.name === words[1].value && entry.scope === (currentRoutine || currentClass || 'global')))
      define(words[1], 'loop', currentRoutine || currentClass || 'global');
  }
  const byName = new Map();
  for (const definition of definitions) {
    if (!byName.has(definition.name)) byName.set(definition.name, []);
    byName.get(definition.name).push(definition);
  }
  const resolve = token => {
    if (!token || keywords.has(token.value)) return null;
    if (definitionAt.has(token.start)) return definitionAt.get(token.start);
    const candidates = byName.get(token.value) || [];
    if (!candidates.length) return null;
    const index = token.index, previous = tokens[index - 1];
    const place = context.get(token.start) || {};
    if (previous?.value === '.') {
      const ownerToken = tokens[index - 2], owner = resolve(ownerToken);
      const ownerType = owner?.type;
      const member = candidates.find(entry => entry.scope === ownerType);
      return member || null;
    }
    return candidates.find(entry => entry.scope === place.routine)
      || candidates.find(entry => entry.scope === place.className)
      || candidates.find(entry => entry.scope === 'global') || null;
  };
  const at = offset => {
    const token = findToken(tokens, offset), definition = resolve(token);
    if (!definition) return null;
    const references = tokens.filter(item => item.kind === 'id' && item.value === definition.name && resolve(item) === definition && item.start !== definition.token.start);
    return { name: definition.name, token, definition: definition.token, kind: definition.kind, references };
  };
  return { at, definitions };
}

export function renameSymbol(source, result, newName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) throw new Error('Enter a valid identifier.');
  if (keywords.has(newName.toUpperCase())) throw new Error('A language keyword cannot be used as a name.');
  const locations = [result.definition, ...result.references].sort((a, b) => b.start - a.start);
  let renamed = source;
  for (const token of locations) renamed = renamed.slice(0, token.start) + newName + renamed.slice(token.end);
  return renamed;
}
