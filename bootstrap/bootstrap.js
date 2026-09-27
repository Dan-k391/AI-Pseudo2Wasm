import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { compile, createRuntime } from '../src/index.js';
import { assembleSelfHosted } from './assemble-self.js';
import { lowerSelfHostedNative } from '../src/selfhost.js';

const here = dirname(fileURLToPath(import.meta.url));
export const coreSource = (await readFile(join(here, 'core.pseudo'), 'utf8')).replace(/\r\n/g, '\n');
export const assemblerSource = (await readFile(join(here, 'assembler.pseudo'), 'utf8')).replace(/\r\n/g, '\n');
export const nativeSource = (await readFile(join(here, 'native.pseudo'), 'utf8')).replace(/\r\n/g, '\n');

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

async function compileIR(compiledCore, source) {
  const result = await createRuntime(compiledCore, { inputLines: [source], maxSteps: 20000000 }).run();
  if (result.status !== 'completed') throw new Error(`Compiler stopped with status ${result.status}`);
  return result.output;
}

export async function bootstrap() {
  const seedCore = compile(coreSource);
  const seedAssembler = compile(assemblerSource);
  const firstCore = await compileWith(seedCore, seedAssembler, coreSource);
  const firstAssembler = await compileWith(seedCore, seedAssembler, assemblerSource);
  const seedNative = await compileWith(seedCore, seedAssembler, nativeSource);
  const expectedPrefix = abiPrefix(compile('').binary);
  assert.deepEqual(firstCore.binary.slice(0, expectedPrefix.length), expectedPrefix, 'embedded assembler ABI must match the runtime ABI');
  const secondCore = await compileWith(firstCore, firstAssembler, coreSource);
  const secondAssembler = await compileWith(firstCore, firstAssembler, assemblerSource);
  const native = await compileWith(firstCore, firstAssembler, nativeSource);
  assert.deepEqual(firstCore.binary, secondCore.binary, 'compiler must reproduce its own WebAssembly');
  assert.deepEqual(firstCore.strings, secondCore.strings, 'compiler must reproduce its own string table');
  assert.deepEqual(firstAssembler.binary, secondAssembler.binary, 'assembler must reproduce its own WebAssembly');
  assert.deepEqual(firstAssembler.strings, secondAssembler.strings, 'assembler must reproduce its own string table');
  assert.deepEqual(seedNative.binary, native.binary, 'native lowerer must compile identically through the self-hosted compiler');
  assert.deepEqual(seedNative.strings, native.strings, 'native lowerer string table must match');

  const sources = { core: coreSource, assembler: assemblerSource, native: nativeSource };
  const compatibility = { core: firstCore, assembler: firstAssembler, native };
  const ir = {};
  const nativeStages = {};
  for (const name of Object.keys(sources)) {
    ir[name] = await compileIR(firstCore, sources[name]);
    nativeStages[name] = await lowerSelfHostedNative(['M:NATIVE_BOOTSTRAP', ...ir[name]], native);
    assert.ok(nativeStages[name], `${name} must lower to native WebAssembly`);
  }
  for (const name of Object.keys(sources)) {
    const rebuiltIR = await compileIR(nativeStages.core, sources[name]);
    assert.deepEqual(rebuiltIR, ir[name], `native compiler must reproduce ${name} IR`);
    const rebuiltNative = await lowerSelfHostedNative(['M:NATIVE_BOOTSTRAP', ...rebuiltIR], nativeStages.native);
    assert.deepEqual(rebuiltNative.binary, nativeStages[name].binary, `native stages must reproduce ${name} WebAssembly`);
    const rebuiltCompatibility = await assembleSelfHosted(rebuiltIR, nativeStages.assembler);
    assert.deepEqual(rebuiltCompatibility.binary, compatibility[name].binary, `native assembler must reproduce ${name} compatibility WebAssembly`);
  }
  return { ...nativeStages.core, assembler: nativeStages.assembler, nativeLowerer: nativeStages.native };
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  const compiled = await bootstrap();
  const outputDir = join(here, 'build');
  const metadata = ({ native, nativeBackend, nativeLabels, nativeGlobalBase, nativeFrameBase, nativeDataEnd }) =>
    JSON.stringify({ native, nativeBackend, nativeLabels, nativeGlobalBase, nativeFrameBase, nativeDataEnd });
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'core.wasm'), compiled.binary);
  await writeFile(join(outputDir, 'core.json'), metadata(compiled));
  await writeFile(join(outputDir, 'assembler.wasm'), compiled.assembler.binary);
  await writeFile(join(outputDir, 'assembler.json'), metadata(compiled.assembler));
  await writeFile(join(outputDir, 'native.wasm'), compiled.nativeLowerer.binary);
  await writeFile(join(outputDir, 'native.json'), metadata(compiled.nativeLowerer));
  console.log(`Native self-hosted compiler, assembler, and lowerer reproduced themselves (${compiled.binary.length} + ${compiled.assembler.binary.length} + ${compiled.nativeLowerer.binary.length} bytes).`);
}
