import { compileSelfHostedSource } from './src/selfhost.js';

let assetsPromise;
const binary = async path => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
};
const metadata = async path => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path} (${response.status})`);
  return response.json();
};

async function assets() {
  assetsPromise ??= Promise.all([
    binary('./bootstrap/core.wasm'), metadata('./bootstrap/core.json'),
    binary('./bootstrap/assembler.wasm'), metadata('./bootstrap/assembler.json'),
    binary('./bootstrap/native.wasm'), metadata('./bootstrap/native.json'),
  ]).then(([coreBinary, coreMetadata, assemblerBinary, assemblerMetadata, nativeBinary, nativeMetadata]) => ({
    core: { binary: coreBinary, ...coreMetadata },
    assembler: { binary: assemblerBinary, ...assemblerMetadata },
    native: { binary: nativeBinary, ...nativeMetadata },
  }));
  return assetsPromise;
}

export async function compileSelfHostedInBrowser(source, options = {}) {
  const { core, assembler, native } = await assets();
  return compileSelfHostedSource(source, core, assembler, native, options);
}
