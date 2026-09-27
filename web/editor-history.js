export function createEditorHistory(limit = 100) {
  const files = new Map();
  const state = name => {
    if (!files.has(name)) files.set(name, { undo: [], redo: [], mergeKey: '', lastEdit: 0 });
    return files.get(name);
  };
  const snapshot = (text, selection) => ({ text, start: selection.start, end: selection.end });
  return {
    record(name, before, after, selection, mergeKey = '', now = Date.now()) {
      if (before === after) return;
      const entry = state(name);
      const merge = mergeKey && entry.mergeKey === mergeKey && now - entry.lastEdit < 750 && entry.undo.length && !entry.redo.length;
      if (!merge) {
        entry.undo.push(snapshot(before, selection));
        if (entry.undo.length > limit) entry.undo.shift();
      }
      entry.redo.length = 0;
      entry.mergeKey = mergeKey;
      entry.lastEdit = now;
    },
    undo(name, text, selection) {
      const entry = state(name), previous = entry.undo.pop();
      if (!previous) return null;
      entry.redo.push(snapshot(text, selection));
      entry.mergeKey = '';
      return previous;
    },
    redo(name, text, selection) {
      const entry = state(name), next = entry.redo.pop();
      if (!next) return null;
      entry.undo.push(snapshot(text, selection));
      entry.mergeKey = '';
      return next;
    },
    canUndo(name) { return !!state(name).undo.length; },
    canRedo(name) { return !!state(name).redo.length; },
    rename(oldName, newName) { if (files.has(oldName)) { files.set(newName, files.get(oldName)); files.delete(oldName); } },
    delete(name) { files.delete(name); },
  };
}
