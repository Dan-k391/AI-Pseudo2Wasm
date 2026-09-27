import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createRuntime } from '../src/runtime.js';

if (!process.argv[2]) {
  console.error('Usage: npm run selfhost:run -- <program.wasm> [input values...]');
  process.exitCode = 1;
} else {
  try {
    const wasmPath = resolve(process.argv[2]);
    const extension = extname(wasmPath);
    const metadataPath = extension ? wasmPath.slice(0, -extension.length) + '.meta.json' : wasmPath + '.meta.json';
    const [binary, metadata] = await Promise.all([readFile(wasmPath), readFile(metadataPath, 'utf8')]);
    const compiled = { binary: new Uint8Array(binary), ...JSON.parse(metadata) };
    const result = await createRuntime(compiled, { inputLines: process.argv.slice(3) }).run();
    for (const line of result.output) console.log(line);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
