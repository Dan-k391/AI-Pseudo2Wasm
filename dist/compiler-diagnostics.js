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

export function diagnosticsFromError(error, source) {
  const reports = Array.isArray(error?.diagnostics) && error.diagnostics.length ? error.diagnostics : [error];
  const seen = new Set();
  return reports.map(report => diagnosticFromError(report, source)).filter(issue => {
    const key = `${issue.line}:${issue.column}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    receive({ id, name, source, issues, issue }) {
      const current = pending.get(name);
      if (!current || current.id !== id || current.source !== source) return false;
      pending.delete(name);
      publish(name, issues || (issue ? [issue] : []));
      return true;
    },
    outstanding() { return [...pending.entries()].map(([name, request]) => ({ name, ...request })); },
    forget(name) { pending.delete(name); },
  };
}
