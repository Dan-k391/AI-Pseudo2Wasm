import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/src', { recursive: true });
await mkdir('dist/bootstrap', { recursive: true });
await cp('web', 'dist', { recursive: true });
for (const name of ['parser.js', 'runtime.js', 'string-memory.js', 'cell-memory.js', 'selfhost.js']) {
  await cp(`src/${name}`, `dist/src/${name}`);
}
for (const name of ['core.wasm', 'core.json', 'assembler.wasm', 'assembler.json']) {
  await cp(`bootstrap/build/${name}`, `dist/bootstrap/${name}`);
}
console.log('Built dependency-free static IDE in dist/');
