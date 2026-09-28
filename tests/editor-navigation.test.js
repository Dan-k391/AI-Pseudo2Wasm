import assert from 'node:assert/strict';
import { indexSource, renameSymbol } from '../web/editor-navigation.js';

let count = 0;
function check(name, run) { run(); count++; console.log(`✓ ${name}`); }
const token = (source, needle, occurrence = 0) => {
  let offset = -1;
  for (let i = 0; i <= occurrence; i++) offset = source.indexOf(needle, offset + 1);
  if (offset < 0) throw new Error(`Missing ${needle}`);
  return offset;
};

check('finds a variable definition and its code references', () => {
  const source = 'DECLARE Count : INTEGER\nCount ← 1\nOUTPUT Count';
  const item = indexSource(source).at(token(source, 'Count', 2));
  assert.equal(item.definition.line, 1);
  assert.deepEqual(item.references.map(x => x.line), [2, 3]);
});

check('describes declarations for hover without a complete parse', () => {
  const source = 'DECLARE Grid : ARRAY[1:5] OF BOOLEAN\nOUTPUT Grid[2]';
  const result = indexSource(source).describe(token(source, 'Grid', 1));
  assert.equal(result.kind, 'declare');
  assert.equal(result.type, 'ARRAY[1:5] OF BOOLEAN');
  assert.equal(result.definition.line, 1);
});

check('keeps parameters and globals with the same name separate', () => {
  const source = 'DECLARE X : INTEGER\nPROCEDURE Test(X : INTEGER)\n OUTPUT X\nENDPROCEDURE\nOUTPUT X';
  const index = indexSource(source);
  assert.equal(index.at(token(source, 'X', 2)).definition.line, 2);
  assert.deepEqual(index.at(token(source, 'X', 2)).references.map(x => x.line), [3]);
  assert.equal(index.at(token(source, 'X', 3)).definition.line, 1);
});

check('ignores identifiers inside strings and comments', () => {
  const source = 'DECLARE Name : STRING\nOUTPUT "Name" // Name\nOUTPUT Name';
  const index = indexSource(source);
  assert.equal(index.at(token(source, 'Name', 1)), null);
  assert.equal(index.at(token(source, 'Name', 2)), null);
  assert.deepEqual(index.at(token(source, 'Name', 3)).references.map(x => x.line), [3]);
});

check('resolves routines and members to their owning class', () => {
  const source = 'CLASS Counter\n PUBLIC PROCEDURE Increment()\n ENDPROCEDURE\nENDCLASS\nDECLARE C : Counter\nCALL C.Increment()';
  const index = indexSource(source);
  assert.equal(index.at(token(source, 'Increment', 1)).definition.line, 2);
  assert.equal(index.at(token(source, 'Counter', 1)).definition.line, 1);
});

check('works on incomplete code without needing a successful parse', () => {
  const source = 'DECLARE Value : INTEGER\nIF Value >\n OUTPUT Value';
  assert.deepEqual(indexSource(source).at(token(source, 'Value', 2)).references.map(x => x.line), [2, 3]);
});

check('renames only a resolved symbol and preserves strings and shadowed parameters', () => {
  const source = 'DECLARE X : INTEGER\nPROCEDURE Test(X : INTEGER)\n OUTPUT X\nENDPROCEDURE\nOUTPUT X, "X"';
  const result = indexSource(source).at(token(source, 'X', 0));
  assert.equal(renameSymbol(source, result, 'Score'), 'DECLARE Score : INTEGER\nPROCEDURE Test(X : INTEGER)\n OUTPUT X\nENDPROCEDURE\nOUTPUT Score, "X"');
});

console.log(`${count} navigation tests passed`);
