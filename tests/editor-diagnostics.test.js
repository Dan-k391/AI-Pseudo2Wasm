import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticCoordinator, diagnosticFromError, diagnosticsFromError, mergeDiagnostics } from '../web/compiler-diagnostics.js';
import { analyzeSource } from '../web/language-service.js';
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

test('line 3 reports the literal index and adjacent name independently', async () => {
  const compiler = await loadSelfHostedCompiler();
  const source = 'DECLARE arr: ARRAY[1:5] OF BOOLEAN\n\nOUTPUT arr[8] somerandomshit\n\nshit\n\nfuck';
  const editor = analyzeSource(source);
  assert.deepEqual(editor.map(issue => [issue.line, issue.column, issue.code]), [
    [3, 12, 'array-bounds'], [3, 15, 'missing-operator'],
  ]);
  await assert.rejects(compileSelfHosted(source, compiler), error => {
    const merged = mergeDiagnostics(editor, diagnosticsFromError(error, source));
    assert.deepEqual(merged.map(issue => [issue.line, issue.column]), [
      [3, 12], [3, 15], [5, 1], [7, 1],
    ]);
    assert.match(merged[1].message, /operator or comma/);
    return true;
  });
});

test('analysis ignores strings and comments and keeps valid field access', () => {
  const source = 'TYPE Item\n DECLARE Value : INTEGER\nENDTYPE\nDECLARE A : ARRAY[1:5] OF Item\nOUTPUT A[2].Value\nOUTPUT "A[8] stray" // A[9] stray';
  assert.deepEqual(analyzeSource(source), []);
});

test('partial editor results remain fresh until compiler diagnostics arrive', () => {
  const reports = [];
  const coordinator = createDiagnosticCoordinator((name, issues) => reports.push(issues));
  const first = coordinator.request('main.pseudo', 'OUTPUT arr[8]');
  assert.equal(coordinator.receive({ ...first, issues: [{ message: 'bounds' }], partial: true }), true);
  const newer = coordinator.request('main.pseudo', 'OUTPUT arr[4]');
  assert.equal(coordinator.receive({ ...first, issues: [{ message: 'old compiler error' }] }), false);
  assert.equal(coordinator.receive({ ...newer, issues: [] }), true);
  assert.deepEqual(reports, [[{ message: 'bounds' }], []]);
});
