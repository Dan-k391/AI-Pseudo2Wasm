export function diagnosticFromError(error, source) {
  const line = Math.max(1, Number(error?.line) || 1);
  const text = source.split('\n')[line - 1] || '';
  const first = text.search(/\S/);
  return {
    line,
    column: Math.max(1, Number(error?.column) || (first < 0 ? 1 : first + 1)),
    message: error?.message || 'Compilation failed',
  };
}

// A response is valid only for the exact snapshot most recently requested for
// that file. Different files may be diagnosed concurrently.
export function createDiagnosticCoordinator(publish) {
  const pending = new Map();
  let nextId = 0;
  return {
    request(name, source) {
      const id = ++nextId;
      pending.set(name, { id, source });
      return { id, name, source };
    },
    receive({ id, name, source, issue }) {
      const current = pending.get(name);
      if (!current || current.id !== id || current.source !== source) return false;
      pending.delete(name);
      publish(name, issue ? [issue] : []);
      return true;
    },
    outstanding() { return [...pending.entries()].map(([name, request]) => ({ name, ...request })); },
    forget(name) { pending.delete(name); },
  };
}
