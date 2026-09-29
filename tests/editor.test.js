import test from 'node:test';
import assert from 'node:assert/strict';
import { completions, diagnosticRange, diagnosticAtOffset, nextDiagnostic } from '../web/editor-intelligence.js';
import { lineStartOffset, moveSelectedLines } from '../web/editor-operations.js';

test('go to line offsets include blank lines', () => {
  const source = 'first\n\nthird';
  assert.equal(lineStartOffset(source, 1), 0);
  assert.equal(lineStartOffset(source, 2), 6);
  assert.equal(lineStartOffset(source, 3), 7);
});

test('moving a line repeatedly keeps the caret on that line', () => {
  const source = 'one\ntwo\nthree\n';
  const up = moveSelectedLines(source, 5, 5, -1);
  assert.deepEqual(up, { text: 'two\none\nthree\n', start: 1, end: 1 });
  const back = moveSelectedLines(up.text, up.start, up.end, 1);
  assert.deepEqual(back, { text: source, start: 5, end: 5 });
  assert.equal(moveSelectedLines(source, 0, 0, -1), null);
  assert.equal(moveSelectedLines('one\ntwo', 5, 5, 1), null);
});

test('moving selected lines excludes the line after a selected newline', () => {
  const source = 'one\ntwo\nthree\nfour';
  const moved = moveSelectedLines(source, 4, 14, 1);
  assert.deepEqual(moved, { text: 'one\nfour\ntwo\nthree', start: 9, end: 18 });
  assert.deepEqual(moveSelectedLines(moved.text, moved.start, moved.end, -1), { text: source, start: 4, end: 13 });
});

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

test('explicit diagnostic spans underline only the affected text', () => {
  const source = 'OUTPUT arr[8] somerandomshit';
  const bounds = { line: 1, column: 12, endColumn: 13, message: 'index' };
  const syntax = { line: 1, column: 15, endColumn: 29, message: 'operator' };
  assert.equal(source.slice(...diagnosticRange(source, bounds)), '8');
  assert.equal(source.slice(...diagnosticRange(source, syntax)), 'somerandomshit');
  assert.equal(diagnosticAtOffset(source, [bounds, syntax], source.indexOf('arr')), null);
  assert.equal(diagnosticAtOffset(source, [bounds, syntax], source.indexOf('8')), bounds);
});

test('problem navigation wraps forward and backward through exact ranges', () => {
  const source = 'OUTPUT arr[8] somerandomshit';
  const issues = [{ line: 1, column: 12, endColumn: 13 }, { line: 1, column: 15, endColumn: 29 }];
  assert.equal(nextDiagnostic(source, issues, 0).issue, issues[0]);
  assert.equal(nextDiagnostic(source, issues, 11).issue, issues[1]);
  assert.equal(nextDiagnostic(source, issues, 14).issue, issues[0]);
  assert.equal(nextDiagnostic(source, issues, 14, true).issue, issues[0]);
  assert.equal(nextDiagnostic(source, issues, 11, true).issue, issues[1]);
});
