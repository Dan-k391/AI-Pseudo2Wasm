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
  ]).then(([coreBinary, coreMetadata, assemblerBinary, assemblerMetadata]) => ({
    core: { binary: coreBinary, ...coreMetadata },
    assembler: { binary: assemblerBinary, ...assemblerMetadata },
  }));
  return assetsPromise;
}

export async function compileSelfHostedInBrowser(source) {
  const { core, assembler } = await assets();
  return compileSelfHostedSource(source, core, assembler);
}
