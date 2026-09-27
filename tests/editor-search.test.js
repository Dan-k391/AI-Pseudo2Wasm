import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatches, replaceMatches } from '../web/editor-search.js';

test('find handles string literals, case, whole words and regular expressions', () => {
  assert.deepEqual(findMatches('OUTPUT "Ada"\nOUTPUT "ada"', 'ada').matches.map(match => match.start), [8, 21]);
  assert.deepEqual(findMatches('cat scatter cat', 'cat', { wholeWord: true }).matches.map(match => match.start), [0, 12]);
  assert.equal(findMatches('a A', 'a', { caseSensitive: true }).matches.length, 1);
  assert.deepEqual(findMatches('A1 B2', '([A-Z])(\\d)', { regex: true }).matches.map(match => match.groups), [['A', '1'], ['B', '2']]);
  assert.ok(findMatches('text', '[', { regex: true }).error);
});

test('replace current and all preserve literal dollars and support capture groups', () => {
  const matches = findMatches('abc ABC abc', 'abc').matches;
  assert.equal(replaceMatches('abc ABC abc', matches, '$&', { current: 1 }).source, 'abc $& abc');
  assert.equal(replaceMatches('abc ABC abc', matches, 'z', { all: true }).source, 'z z z');
  const regexMatches = findMatches('X7 Y8', '([A-Z])(\\d)', { regex: true }).matches;
  assert.equal(replaceMatches('X7 Y8', regexMatches, '$2-$1', { regex: true, all: true }).source, '7-X 8-Y');
});
