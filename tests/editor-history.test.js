import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorHistory } from '../web/editor-history.js';

test('undo and redo keep separate histories for open files', () => {
  const history = createEditorHistory();
  history.record('a.pseudo', 'A', 'AB', { start: 1, end: 1 }, 'insertText', 1000);
  history.record('b.pseudo', 'X', 'XY', { start: 1, end: 1 }, 'insertText', 1000);
  assert.deepEqual(history.undo('a.pseudo', 'AB', { start: 2, end: 2 }), { text: 'A', start: 1, end: 1 });
  assert.deepEqual(history.redo('a.pseudo', 'A', { start: 1, end: 1 }), { text: 'AB', start: 2, end: 2 });
  assert.deepEqual(history.undo('b.pseudo', 'XY', { start: 2, end: 2 }), { text: 'X', start: 1, end: 1 });
});

test('nearby typing merges and a new edit clears redo', () => {
  const history = createEditorHistory();
  history.record('main', '', 'a', { start: 0, end: 0 }, 'insertText', 1000);
  history.record('main', 'a', 'ab', { start: 1, end: 1 }, 'insertText', 1200);
  assert.equal(history.undo('main', 'ab', { start: 2, end: 2 }).text, '');
  assert.equal(history.canRedo('main'), true);
  history.record('main', '', 'z', { start: 0, end: 0 }, 'insertText', 2000);
  assert.equal(history.canRedo('main'), false);
});
