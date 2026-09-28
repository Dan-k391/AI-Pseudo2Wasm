import { performance } from 'node:perf_hooks';
import { compile, createRuntime } from '../src/index.js';
import { compileSelfHosted, loadSelfHostedCompiler } from '../bootstrap/compile.js';

const source = `DECLARE Total : INTEGER
DECLARE I : INTEGER
FOR I ← 1 TO 1000000
  Total ← Total + I
NEXT I
OUTPUT Total
`;
const compiler = await loadSelfHostedCompiler();
const compatible = compile(source), native = await compileSelfHosted(source, compiler);
const release = await compileSelfHosted(source, compiler, { release: true });
if (native.nativeBackend !== 'selfhosted') throw new Error('Expected self-hosted native lowering');
if (release.nativeBackend !== 'selfhosted' || !release.release) throw new Error('Expected self-hosted release lowering');
const timed = async module => {
  const start = performance.now();
  const result = await createRuntime(module, { maxSteps: 5000000 }).run();
  if (result.output[0] !== '500000500000') throw new Error('Output mismatch');
  return performance.now() - start;
};
const samples = { native: [], release: [], compatible: [] };
for (let i = 0; i < 12; i++) {
  const order = i % 2 ? [['native', native], ['release', release], ['compatible', compatible]] : [['compatible', compatible], ['release', release], ['native', native]];
  for (const [name, module] of order) {
    const ms = await timed(module);
    if (i >= 2) samples[name].push(ms);
  }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(`Native median: ${median(samples.native).toFixed(2)} ms`);
console.log(`Release median: ${median(samples.release).toFixed(2)} ms (${(median(samples.native) / median(samples.release)).toFixed(2)}× guarded speed)`);
console.log(`Compatibility median: ${median(samples.compatible).toFixed(2)} ms`);
console.log(`Native module sizes: guarded ${native.binary.length} bytes; release ${release.binary.length} bytes`);
