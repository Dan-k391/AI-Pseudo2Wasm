import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/src', { recursive: true });
await cp('web', 'dist', { recursive: true });
await cp('src', 'dist/src', { recursive: true });
console.log('Built dependency-free static IDE in dist/');
