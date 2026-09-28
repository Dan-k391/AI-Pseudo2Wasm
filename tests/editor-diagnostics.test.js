import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticCoordinator, diagnosticFromError, diagnosticsFromError } from '../web/compiler-diagnostics.js';
import { compileSelfHosted, loadSelfHostedCompiler } from '../bootstrap/compile.js';

test('late diagnostics never replace the newest snapshot', () => {
  const reports = [];
  const coordinator = createDiagnosticCoordinator((name, issues) => reports.push({ name, issues }));
  const old = coordinator.request('main.pseudo', 'BOGUS');
  const other = coordinator.request('other.pseudo', 'OUTPUT 1');
  const latest = coordinator.request('main.pseudo', 'OUTPUT 2');
  assert.equal(coordinator.receive({ ...old, issue: { line: 1, message: 'old' } }), false);
  assert.equal(coordinator.receive({ ...other, issue: null }), true);
  assert.equal(coordinator.receive({ ...latest, issue: null }), true);
  assert.deepEqual(reports, [
    { name: 'other.pseudo', issues: [] },
    { name: 'main.pseudo', issues: [] },
  ]);
});

test('editor diagnostic uses the same self-hosted failure and source location as Compile', async () => {
  const compiler = await loadSelfHostedCompiler();
  const source = 'OUTPUT "before"\n  BOGUS\n';
  await assert.rejects(compileSelfHosted(source, compiler), error => {
    const issue = diagnosticFromError(error, source);
    assert.equal(issue.line, 2);
    assert.equal(issue.column, 3);
    assert.equal(issue.message, error.message);
    assert.match(issue.message, /Unrecognized or unsupported statement/);
    return true;
  });
});

test('compiler reports independent source errors and their exact columns together', async () => {
  const compiler = await loadSelfHostedCompiler();
  const source = '  BOGUS\nOUTPUT 1\n    ALSOBOGUS\n';
  await assert.rejects(compileSelfHosted(source, compiler), error => {
    const issues = diagnosticsFromError(error, source);
    assert.deepEqual(issues.map(({ line, column }) => [line, column]), [[1, 3], [3, 5]]);
    assert.match(issues[0].message, /BOGUS/);
    assert.match(issues[1].message, /ALSOBOGUS/);
    return true;
  });
});

test('diagnostic coordinator publishes multiple issues and ignores stale results', () => {
  const reports = [];
  const coordinator = createDiagnosticCoordinator((name, issues) => reports.push({ name, issues }));
  const old = coordinator.request('main.pseudo', 'BOGUS');
  const latest = coordinator.request('main.pseudo', 'BOGUS\nALSOBOGUS');
  const issues = [{ line: 1, column: 1, message: 'first' }, { line: 2, column: 1, message: 'second' }];
  assert.equal(coordinator.receive({ ...old, issues: [] }), false);
  assert.equal(coordinator.receive({ ...latest, issues }), true);
  assert.deepEqual(reports, [{ name: 'main.pseudo', issues }]);
});
