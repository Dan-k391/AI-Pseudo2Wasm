import test from 'node:test';
import assert from 'node:assert/strict';
import { completions, diagnosticRange, diagnosticAtOffset } from '../web/editor-intelligence.js';

test('completion offers keywords, builtins, and declarations', () => {
  const source = 'DECLARE Counter : INTEGER\nOUTPUT Cou';
  assert.equal(completions(source, source.length).items[0].label, 'Counter');
  assert.ok(completions('OUT', 3).items.some(item => item.insert === 'OUTPUT'));
  assert.ok(completions('MI', 2).items.some(item => item.insert === 'MID'));
});

test('completion offers virtual filenames and ignores comments', () => {
  const source = 'OPENFILE "da';
  assert.deepEqual(completions(source, source.length, ['data.txt']).items.map(item => item.insert), ['data.txt']);
  assert.equal(completions('// OUT', 6), null);
});

test('member completion follows the declared record type', () => {
  const source = 'TYPE Student\n  DECLARE Name : STRING\nENDTYPE\nTYPE Other\n  DECLARE Score : INTEGER\nENDTYPE\nDECLARE S : Student\nOUTPUT S.';
  const choices = completions(source, source.length).items.map(item => item.label);
  assert.ok(choices.includes('Name'));
  assert.ok(!choices.includes('Score'));
});

test('block snippets select a meaningful placeholder after insertion', () => {
  for (const keyword of ['IF', 'FOR', 'WHILE', 'REPEAT', 'CASE', 'FUNCTION', 'PROCEDURE', 'TYPE', 'CLASS']) {
    const snippet = completions(keyword, keyword.length).items.find(item => item.kind === 'snippet');
    assert.ok(snippet, `${keyword} snippet exists`);
    assert.match(snippet.insert.slice(...snippet.select), /^(?:condition|Index|value|Name)$/);
  }
});

test('error range selects the token at the parser location', () => {
  const source = 'DECLARE X : INTEGER\nOUTPUT @';
  const range = diagnosticRange(source, { line: 2, column: 8 });
  assert.equal(source.slice(...range), '@');
  assert.equal(diagnosticRange(source, { line: 9, column: 1 }), null);
});

test('diagnostic hover belongs to the underlined token, not its entire line', () => {
  const source = 'OUTPUT BAD + OTHER';
  const issues = [{ line: 1, column: 8, message: 'first' }, { line: 1, column: 14, message: 'second' }];
  assert.equal(diagnosticAtOffset(source, issues, 7), issues[0]);
  assert.equal(diagnosticAtOffset(source, issues, 9), issues[0]);
  assert.equal(diagnosticAtOffset(source, issues, 10), null);
  assert.equal(diagnosticAtOffset(source, issues, 13), issues[1]);
  assert.equal(diagnosticAtOffset(source, issues, 3), null);
});
