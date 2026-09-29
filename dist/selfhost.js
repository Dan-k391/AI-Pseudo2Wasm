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
  const embedded = globalThis.__P2W_ASSETS__;
  if (embedded) {
    assetsPromise ??= Promise.resolve(Object.fromEntries(
      ['core', 'assembler', 'native'].map(name => [name, {
        binary: Uint8Array.from(atob(embedded.binaries[name]), character => character.charCodeAt(0)),
        ...embedded.metadata[name],
      }]),
    ));
    return assetsPromise;
  }
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
