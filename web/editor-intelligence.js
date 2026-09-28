const keywords = `DECLARE CONSTANT TYPE ENDTYPE DEFINE CLASS ENDCLASS PUBLIC PRIVATE INHERITS FUNCTION ENDFUNCTION PROCEDURE ENDPROCEDURE RETURNS RETURN BYREF BYVAL CALL NEW SUPER OUTPUT INPUT OPENFILE CLOSEFILE READFILE WRITEFILE GETRECORD PUTRECORD SEEK FOR TO STEP NEXT WHILE ENDWHILE REPEAT UNTIL IF THEN ELSE ENDIF CASE OF OTHERWISE ENDCASE AND OR NOT IN DIV MOD TRUE FALSE NULL INTEGER REAL BOOLEAN CHAR STRING DATE ARRAY SET READ WRITE APPEND RANDOM`.split(' ');
const builtins = `LENGTH LEFT RIGHT MID UCASE LCASE TO_UPPER TO_LOWER NUM_TO_STR STR_TO_NUM IS_NUM ASC CHR INT RAND DAY MONTH YEAR DAYINDEX SETDATE TODAY EOF`.split(' ');
const snippets = [
  ['IF', 'IF condition THEN\n  \nENDIF', 'condition'],
  ['FOR', 'FOR Index ← 1 TO 10\n  \nNEXT Index', 'Index'],
  ['WHILE', 'WHILE condition\n  \nENDWHILE', 'condition'],
  ['REPEAT', 'REPEAT\n  \nUNTIL condition', 'condition'],
  ['CASE', 'CASE OF value\n  OTHERWISE : OUTPUT value\nENDCASE', 'value'],
  ['FUNCTION', 'FUNCTION Name() RETURNS INTEGER\n  RETURN 0\nENDFUNCTION', 'Name'],
  ['PROCEDURE', 'PROCEDURE Name()\n  \nENDPROCEDURE', 'Name'],
  ['TYPE', 'TYPE Name\n  DECLARE Field : INTEGER\nENDTYPE', 'Name'],
  ['CLASS', 'CLASS Name\n  PUBLIC PROCEDURE NEW()\n  ENDPROCEDURE\nENDCLASS', 'Name'],
];

function symbols(source) {
  const found = new Map();
  const add = (name, kind, detail = '') => {
    if (!found.has(name.toUpperCase())) found.set(name.toUpperCase(), { label: name, insert: name, kind, detail });
  };
  for (const match of source.matchAll(/\b(?:DECLARE|CONSTANT|TYPE|CLASS|FUNCTION|PROCEDURE|DEFINE)\s+([A-Za-z_][\w]*)/gi)) add(match[1], /FUNCTION|PROCEDURE/i.test(match[0].split(/\s+/)[0]) ? 'routine' : 'symbol');
  for (const match of source.matchAll(/\b(?:BYREF|BYVAL)?\s*([A-Za-z_][\w]*)\s*:\s*(?:INTEGER|REAL|BOOLEAN|CHAR|STRING|DATE|ARRAY|SET|[A-Za-z_]\w*)/gi)) add(match[1], 'parameter');
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) if (!keywords.includes(match[1].toUpperCase())) add(match[1], 'routine');
  return [...found.values()];
}

function members(source, owner) {
  const items = [];
  const add = (label, kind) => items.push({ label, insert: label, kind, detail: kind === 'routine' ? 'Method' : 'Field' });
  const declaration = [...source.matchAll(/\bDECLARE\s+([A-Za-z_]\w*)\s*:\s*(?:ARRAY\s*\[[^\]]+\]\s+OF\s+)?([A-Za-z_]\w*)/gi)].find(match => match[1].toLowerCase() === owner.toLowerCase());
  const typeName = declaration?.[2] || owner;
  const block = new RegExp(`\\b(?:TYPE|CLASS)\\s+${typeName}\\b([\\s\\S]*?)\\b(?:ENDTYPE|ENDCLASS)`, 'i').exec(source)?.[1] || '';
  for (const match of block.matchAll(/\b(?:DECLARE|PUBLIC|PRIVATE)\s+([A-Za-z_]\w*)\s*:/gi)) add(match[1], 'field');
  for (const match of block.matchAll(/\b(?:FUNCTION|PROCEDURE)\s+([A-Za-z_]\w*)\s*\(/gi)) add(match[1], 'routine');
  for (const match of source.matchAll(new RegExp(`\\b${owner}(?:\\[[^\\]\\n]+\\])?\\.([A-Za-z_]\\w*)`, 'gi'))) add(match[1], 'field');
  return items;
}

export function completions(source, cursor, fileNames = []) {
  const before = source.slice(0, cursor), line = before.slice(before.lastIndexOf('\n') + 1);
  if (/\/\/[^\n]*$/.test(line)) return null;
  const fileContext = /\b(?:OPENFILE|CLOSEFILE|READFILE|WRITEFILE|GETRECORD|PUTRECORD|SEEK|EOF)\s*\(?\s*"[^"]*$/i.test(line);
  if (fileContext) {
    const prefix = line.slice(line.lastIndexOf('"') + 1);
    const items = fileNames.filter(name => name.toLowerCase().startsWith(prefix.toLowerCase())).map(name => ({ label: name, insert: name, kind: 'file', detail: 'Virtual file' }));
    return { start: cursor - prefix.length, end: cursor, items };
  }
  if ((line.match(/"/g) || []).length % 2 || (line.match(/'/g) || []).length % 2) return null;
  const word = /[A-Za-z_][\w]*$/.exec(before), prefix = word?.[0] || '';
  const start = cursor - prefix.length;
  const member = /([A-Za-z_]\w*)(?:\[[^\]\n]+\])?\.$/.exec(before.slice(0, start));
  let items;
  if (member) {
    items = members(source, member[1]);
  } else {
    items = [
      ...symbols(source),
      ...builtins.map(label => ({ label, insert: label, kind: 'function', detail: 'Built-in function' })),
      ...keywords.map(label => ({ label, insert: label, kind: 'keyword', detail: 'CAIE pseudocode' })),
      ...snippets.map(([label, insert, placeholder]) => ({ label: `${label} block`, insert, select: [insert.indexOf(placeholder), insert.indexOf(placeholder) + placeholder.length], kind: 'snippet', detail: 'Code block' })),
    ];
  }
  const unique = new Map();
  for (const item of items) {
    if (!item.label.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    if (item.insert.toLowerCase() === prefix.toLowerCase() && item.kind !== 'snippet') continue;
    unique.set(`${item.label.toUpperCase()}:${item.kind}`, item);
  }
  const rank = kind => ({ symbol: 0, parameter: 0, routine: 0, field: 0, function: 1, keyword: 2, snippet: 3 }[kind] ?? 4);
  return { start, end: cursor, items: [...unique.values()].sort((a, b) => rank(a.kind) - rank(b.kind) || a.label.localeCompare(b.label)).slice(0, 30) };
}

export function diagnosticRange(source, issue) {
  const lines = source.split('\n'), line = Math.max(1, Number(issue.line) || 1);
  if (line > lines.length) return null;
  const text = lines[line - 1], base = lines.slice(0, line - 1).reduce((sum, part) => sum + part.length + 1, 0);
  if (!text.length) return null;
  const column = Math.max(0, Math.min(text.length - 1, (Number(issue.column) || 1) - 1));
  const explicitEnd = Number(issue.endColumn);
  if (Number.isInteger(explicitEnd) && explicitEnd > column + 1)
    return [base + column, base + Math.min(text.length, explicitEnd - 1)];
  let start = column;
  if (/\s/.test(text[start])) start = Math.max(0, Math.min(text.search(/\S/), text.length - 1));
  if (start < 0) return null;
  const token = /^[\w]+|^\S/.exec(text.slice(start));
  return [base + start, base + start + (token?.[0].length || 1)];
}

export function diagnosticAtOffset(source, issues, offset) {
  for (const issue of issues) {
    const range = diagnosticRange(source, issue);
    if (range && offset >= range[0] && offset < range[1]) return issue;
  }
  return null;
}

export function nextDiagnostic(source, issues, offset, backwards = false) {
  const ordered = issues.map(issue => ({ issue, range: diagnosticRange(source, issue) }))
    .filter(entry => entry.range)
    .sort((a, b) => a.range[0] - b.range[0]);
  if (!ordered.length) return null;
  if (backwards) return ordered.findLast(entry => entry.range[0] < offset) || ordered.at(-1);
  return ordered.find(entry => entry.range[0] > offset) || ordered[0];
}
