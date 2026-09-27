import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../src/index.js';
import { advancedExamples } from '../web/examples.js';

for (const example of advancedExamples) {
  test(`${example.name} compiles to valid WebAssembly`, () => {
    assert.equal(WebAssembly.validate(compile(example.code).binary), true);
  });
}

test('memoized Fibonacci example reaches F(20) = 6765', async () => {
  const result = await run(advancedExamples[0].code, { maxSteps: 250000 });
  assert.equal(result.status, 'completed');
  assert.equal(result.output.at(-1), 'F(20) = 6765');
});

test('eight queens example finds all 92 solutions', async () => {
  const result = await run(advancedExamples[1].code, { maxSteps: 250000 });
  assert.equal(result.status, 'completed');
  assert.equal(result.output.at(-1), 'Solutions: 92');
  assert.equal(result.output.length, 10);
});

test('N queens example also solves a four-by-four board', async () => {
  const source = advancedExamples[1].code.replace('CONSTANT N = 8', 'CONSTANT N = 4');
  const result = await run(source, { maxSteps: 250000 });
  assert.equal(result.output.at(-1), 'Solutions: 2');
});

test('Minesweeper waits for terminal input, then accepts a flag and quit', async () => {
  const source = advancedExamples[2].code;
  const waiting = await run(source, { interactive: true, inputLines: [], seed: 123, maxSteps: 250000 });
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.label, 'ACTION');
  assert.equal(waiting.output[0], 'ASCII MINESWEEPER — 5 mines hidden');
  const done = await run(source, { inputLines: ['F', '1', '1', 'Q'], seed: 123, maxSteps: 250000 });
  assert.equal(done.status, 'completed');
  assert.ok(done.output.includes('Game ended.'));
});
