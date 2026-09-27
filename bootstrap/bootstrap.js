import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { compile, createRuntime } from '../src/index.js';
import { assembleSelfHosted } from './assemble-self.js';

const here = dirname(fileURLToPath(import.meta.url));
export const coreSource = (await readFile(join(here, 'core.pseudo'), 'utf8')).replace(/\r\n/g, '\n');
export const assemblerSource = (await readFile(join(here, 'assembler.pseudo'), 'utf8')).replace(/\r\n/g, '\n');

function abiPrefix(binary) {
  let offset = 8;
  while (offset < binary.length) {
    const section = binary[offset++];
    let size = 0, shift = 0, byte;
    do { byte = binary[offset++]; size |= (byte & 127) << shift; shift += 7; } while (byte & 128);
    offset += size;
    if (section === 2) return binary.slice(0, offset);
  }
  throw new Error('Seed module has no import section');
}

export async function compileWith(compiledCore, compiledAssembler, source) {
  const result = await createRuntime(compiledCore, { inputLines: [source.replace(/\r\n/g, '\n')], maxSteps: 10000000 }).run();
  if (result.status !== 'completed') throw new Error(`Compiler stopped with status ${result.status}`);
  return assembleSelfHosted(result.output, compiledAssembler);
}

export async function bootstrap() {
  const seedCore = compile(coreSource);
  const seedAssembler = compile(assemblerSource);
  const firstCore = await compileWith(seedCore, seedAssembler, coreSource);
  const firstAssembler = await compileWith(seedCore, seedAssembler, assemblerSource);
  const expectedPrefix = abiPrefix(compile('').binary);
  assert.deepEqual(firstCore.binary.slice(0, expectedPrefix.length), expectedPrefix, 'embedded assembler ABI must match the runtime ABI');
  const secondCore = await compileWith(firstCore, firstAssembler, coreSource);
  const secondAssembler = await compileWith(firstCore, firstAssembler, assemblerSource);
  assert.deepEqual(firstCore.binary, secondCore.binary, 'compiler must reproduce its own WebAssembly');
  assert.deepEqual(firstCore.strings, secondCore.strings, 'compiler must reproduce its own string table');
  assert.deepEqual(firstAssembler.binary, secondAssembler.binary, 'assembler must reproduce its own WebAssembly');
  assert.deepEqual(firstAssembler.strings, secondAssembler.strings, 'assembler must reproduce its own string table');
  return { ...firstCore, assembler: firstAssembler };
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  const compiled = await bootstrap();
  const outputDir = join(here, 'build');
  const metadata = ({ strings, types, classes, routines }) => JSON.stringify({ strings, types, classes, routines });
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'core.wasm'), compiled.binary);
  await writeFile(join(outputDir, 'core.json'), metadata(compiled));
  await writeFile(join(outputDir, 'assembler.wasm'), compiled.assembler.binary);
  await writeFile(join(outputDir, 'assembler.json'), metadata(compiled.assembler));
  console.log(`Self-hosted compiler and assembler reproduced themselves (${compiled.binary.length} + ${compiled.assembler.binary.length} bytes).`);
}
