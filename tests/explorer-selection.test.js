import test from 'node:test';
import assert from 'node:assert/strict';
import { selectExplorerFiles, moveExplorerFiles } from '../web/explorer-selection.js';

const order = ['one.pseudo', 'two.pseudo', 'three.pseudo', 'four.pseudo', 'five.pseudo'];

test('Ctrl click toggles files without losing other selections', () => {
  const first = selectExplorerFiles(order, [], null, 'two.pseudo');
  const added = selectExplorerFiles(order, first.selected, first.anchor, 'four.pseudo', { toggle: true });
  assert.deepEqual(added.selected, ['two.pseudo', 'four.pseudo']);
  const removed = selectExplorerFiles(order, added.selected, added.anchor, 'two.pseudo', { toggle: true });
  assert.deepEqual(removed.selected, ['four.pseudo']);
});

test('Shift click selects the range from its anchor in both directions', () => {
  assert.deepEqual(selectExplorerFiles(order, ['two.pseudo'], 'two.pseudo', 'four.pseudo', { shift: true }).selected, ['two.pseudo', 'three.pseudo', 'four.pseudo']);
  assert.deepEqual(selectExplorerFiles(order, ['four.pseudo'], 'four.pseudo', 'two.pseudo', { shift: true }).selected, ['two.pseudo', 'three.pseudo', 'four.pseudo']);
});

test('dragging a selection moves it as an ordered group', () => {
  assert.deepEqual(moveExplorerFiles(order, ['four.pseudo', 'two.pseudo'], 'five.pseudo', true), ['one.pseudo', 'three.pseudo', 'five.pseudo', 'two.pseudo', 'four.pseudo']);
  assert.deepEqual(moveExplorerFiles(order, ['two.pseudo', 'three.pseudo'], 'three.pseudo', false), order);
});
