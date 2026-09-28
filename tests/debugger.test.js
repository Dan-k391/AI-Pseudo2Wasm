import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSelfHosted, loadSelfHostedCompiler } from '../bootstrap/compile.js';
import { createRuntime } from '../src/runtime.js';

const compiler = await loadSelfHostedCompiler();

test('debug builds use self-hosted WASM and pause before a statement', async () => {
  const source = 'DECLARE X : INTEGER\nX ← 3\nOUTPUT X';
  const compiled = await compileSelfHosted(source, compiler, { debug: true });
  assert.notEqual(compiled.native, true);
  const paused = await createRuntime(compiled, { onStep: line => line === 3 }).run();
  assert.equal(paused.status, 'paused');
  assert.equal(paused.line, 3);
  assert.equal(paused.steps, 3);
  assert.deepEqual(paused.output, []);
  assert.deepEqual(paused.state.globals, [{ name: 'X', value: '3', type: 'INTEGER' }]);
  const finished = await createRuntime(compiled).run();
  assert.deepEqual(finished.output, ['3']);
});

test('continuing past a breakpoint replays deterministically to the next visit', async () => {
  const source = 'DECLARE I : INTEGER\nFOR I ← 1 TO 3\n  OUTPUT I\nNEXT I';
  const compiled = await compileSelfHosted(source, compiler, { debug: true });
  const first = await createRuntime(compiled, { onStep: line => line === 3 }).run();
  const second = await createRuntime(compiled, { onStep: (line, step) => step > first.steps && line === 3 }).run();
  assert.equal(first.status, 'paused');
  assert.equal(second.status, 'paused');
  assert.equal(second.line, 3);
  assert.ok(second.steps > first.steps);
  assert.deepEqual(first.output, []);
  assert.deepEqual(second.output, ['1']);
  assert.equal(second.state.globals.find(item => item.name === 'I')?.value, '2');
});

test('paused state includes routine locals and call stack', async () => {
  const source = 'FUNCTION Double(N : INTEGER) RETURNS INTEGER\n DECLARE Result : INTEGER\n Result ← N * 2\n RETURN Result\nENDFUNCTION\nDECLARE X : INTEGER\nX ← Double(4)\nOUTPUT X';
  const compiled = await compileSelfHosted(source, compiler, { debug: true });
  const paused = await createRuntime(compiled, { onStep: line => line === 4 }).run();
  assert.equal(paused.status, 'paused');
  assert.deepEqual(paused.state.stack, ['DOUBLE']);
  assert.equal(paused.state.locals.find(item => item.name === 'N')?.value, '4');
  assert.equal(paused.state.locals.find(item => item.name === 'RESULT')?.value, '8');
});

test('debugger waits for INPUT and resumes without duplicating prior output', async () => {
  const source = 'DECLARE X : INTEGER\nOUTPUT "go"\nINPUT X\nOUTPUT X';
  const compiled = await compileSelfHosted(source, compiler, { debug: true });
  const first = await createRuntime(compiled, { onStep: line => line === 3 }).run();
  assert.equal(first.status, 'paused');
  assert.deepEqual(first.output, ['go']);
  const waiting = await createRuntime(compiled, { interactive: true, onStep: (line, step) => step > first.steps && line === 4 }).run();
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.line, 3);
  const second = await createRuntime(compiled, { inputLines: ['7'], onStep: (line, step) => step > first.steps && line === 4 }).run();
  assert.equal(second.status, 'paused');
  assert.deepEqual(second.output, ['go']);
  assert.equal(second.state.globals.find(item => item.name === 'X')?.value, '7');
});
