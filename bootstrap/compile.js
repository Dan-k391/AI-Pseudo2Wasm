import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import { compileSelfHostedSource } from '../src/selfhost.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadSelfHostedCompiler() {
  const [binary, metadata, assemblerBinary, assemblerMetadata, nativeBinary, nativeMetadata] = await Promise.all([
    readFile(join(here, 'build', 'core.wasm')),
    readFile(join(here, 'build', 'core.json'), 'utf8'),
    readFile(join(here, 'build', 'assembler.wasm')),
    readFile(join(here, 'build', 'assembler.json'), 'utf8'),
    readFile(join(here, 'build', 'native.wasm')),
    readFile(join(here, 'build', 'native.json'), 'utf8'),
  ]);
  return {
    binary: new Uint8Array(binary), ...JSON.parse(metadata),
    assembler: { binary: new Uint8Array(assemblerBinary), ...JSON.parse(assemblerMetadata) },
    nativeLowerer: { binary: new Uint8Array(nativeBinary), ...JSON.parse(nativeMetadata) },
  };
}

export async function compileSelfHosted(source, compiler, options = {}) {
  if (!compiler.assembler) throw new Error('Self-hosted assembler is missing');
  return compileSelfHostedSource(source, compiler, compiler.assembler, compiler.nativeLowerer, options);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const release = process.argv.slice(2).includes('--release');
  const optimization = process.argv.slice(2).includes('--optimize') ? 'speed' : 'standard';
  const paths = process.argv.slice(2).filter(argument => argument !== '--release' && argument !== '--optimize');
  const inputPath = paths[0];
  if (!inputPath) {
    console.error('Usage: npm run selfhost:compile -- <source.pseudo> [output.wasm] [--release] [--optimize]');
    process.exitCode = 1;
  } else {
    try {
      const outputPath = resolve(paths[1] || inputPath.replace(/\.pseudo$/i, '') + '.wasm');
      const source = await readFile(inputPath, 'utf8');
      const compiler = await loadSelfHostedCompiler();
      const result = await compileSelfHosted(source, compiler, { release, optimization });
      await writeFile(outputPath, result.binary);
      const extension = extname(outputPath);
      const metadataPath = extension ? outputPath.slice(0, -extension.length) + '.meta.json' : outputPath + '.meta.json';
      await writeFile(metadataPath, JSON.stringify({ strings: result.strings, literalStrings: result.literalStrings, types: result.types, classes: result.classes, routines: result.routines, native: !!result.native, release: !!result.release, optimization: result.optimization || 'standard', nativeLabels: result.nativeLabels, nativeDataEnd: result.nativeDataEnd, nativeGlobalBase: result.nativeGlobalBase, nativeFrameBase: result.nativeFrameBase }, null, 2));
      console.log(`Compiled ${inputPath} with self-hosted core → ${outputPath} (${result.binary.length} bytes, ${result.release ? 'release' : 'guarded'}, ${result.optimization || 'standard'} optimization)`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
