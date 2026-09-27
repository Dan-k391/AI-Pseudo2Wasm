import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import { createRuntime } from '../src/runtime.js';
import { assembleSelfHosted } from './assemble-self.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadSelfHostedCompiler() {
  const [binary, metadata, assemblerBinary, assemblerMetadata] = await Promise.all([
    readFile(join(here, 'build', 'core.wasm')),
    readFile(join(here, 'build', 'core.json'), 'utf8'),
    readFile(join(here, 'build', 'assembler.wasm')),
    readFile(join(here, 'build', 'assembler.json'), 'utf8'),
  ]);
  return {
    binary: new Uint8Array(binary), ...JSON.parse(metadata),
    assembler: { binary: new Uint8Array(assemblerBinary), ...JSON.parse(assemblerMetadata) },
  };
}

export async function compileSelfHosted(source, compiler) {
  const result = await createRuntime(compiler, {
    inputLines: [source.replace(/\r\n/g, '\n')],
    maxSteps: 10000000,
  }).run();
  if (result.status !== 'completed') throw new Error(`Compiler stopped with status ${result.status}`);
  if (!compiler.assembler) throw new Error('Self-hosted assembler is missing');
  return assembleSelfHosted(result.output, compiler.assembler);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: npm run selfhost:compile -- <source.pseudo> [output.wasm]');
    process.exitCode = 1;
  } else {
    try {
      const outputPath = resolve(process.argv[3] || inputPath.replace(/\.pseudo$/i, '') + '.wasm');
      const source = await readFile(inputPath, 'utf8');
      const compiler = await loadSelfHostedCompiler();
      const result = await compileSelfHosted(source, compiler);
      await writeFile(outputPath, result.binary);
      const extension = extname(outputPath);
      const metadataPath = extension ? outputPath.slice(0, -extension.length) + '.meta.json' : outputPath + '.meta.json';
      await writeFile(metadataPath, JSON.stringify({ strings: result.strings, types: result.types, classes: result.classes, routines: result.routines }, null, 2));
      console.log(`Compiled ${inputPath} with self-hosted core → ${outputPath} (${result.binary.length} bytes)`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
