import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const dist = resolve('dist');

async function bundledEditor(entry) {
  const modules = new Map();
  async function include(path) {
    path = resolve(path);
    if (modules.has(path)) return;
    const key = relative(dist, path).replaceAll('\\', '/');
    let source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
    const imports = [...source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm)];
    for (const match of imports) await include(resolve(dirname(path), match[2]));
    source = source.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm,
      (_, names, specifier) => `const { ${names.trim()} } = __modules[${JSON.stringify(relative(dist, resolve(dirname(path), specifier)).replaceAll('\\', '/'))}];`);
    const exports = [];
    source = source.replace(/^export\s+(?:(async)\s+)?(function|class|const|let)\s+(\w+)/gm, (_, asyncWord, kind, name) => {
      exports.push(name);
      return `${asyncWord ? 'async ' : ''}${kind} ${name}`;
    });
    source = source.replace(/^export\s*\{([^}]+)\};?\s*$/gm, (_, names) => {
      for (const name of names.split(',')) exports.push(name.trim());
      return '';
    });
    if (/^\s*(?:import|export)\b/m.test(source)) throw new Error(`Unsupported module syntax in ${key}`);
    source = source.replaceAll('import.meta.url', 'document.baseURI');
    modules.set(path, `__modules[${JSON.stringify(key)}] = (() => {\n${source}\nreturn { ${exports.join(', ')} };\n})();`);
  }
  await include(entry);
  return `(() => {\n'use strict';\nconst __modules = Object.create(null);\n${[...modules.values()].join('\n')}\n})();`;
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist/src', { recursive: true });
await mkdir('dist/bootstrap', { recursive: true });
await mkdir('dist/examples/self-hosted-compiler', { recursive: true });
await cp('web', 'dist', { recursive: true });
for (const name of ['parser.js', 'runtime.js', 'string-memory.js', 'cell-memory.js', 'native-runtime.js', 'selfhost.js']) {
  await cp(`src/${name}`, `dist/src/${name}`);
}
for (const name of ['core.wasm', 'core.json', 'assembler.wasm', 'assembler.json', 'native.wasm', 'native.json']) {
  await cp(`bootstrap/build/${name}`, `dist/bootstrap/${name}`);
}
for (const name of ['core.pseudo', 'native.pseudo', 'assembler.pseudo']) {
  await cp(`bootstrap/${name}`, `dist/examples/self-hosted-compiler/${name}`);
}

// A single HTML file also works when opened directly with file://. Browsers
// block module imports, workers, and fetch() from local files, so the editor
// entry point and its compiler assets are embedded in the built page.
const binaries = {};
const metadata = {};
const examples = {};
for (const name of ['core', 'assembler', 'native']) {
  binaries[name] = (await readFile(`dist/bootstrap/${name}.wasm`)).toString('base64');
  metadata[name] = JSON.parse(await readFile(`dist/bootstrap/${name}.json`, 'utf8'));
  examples[`${name}.pseudo`] = await readFile(`dist/examples/self-hosted-compiler/${name}.pseudo`, 'utf8');
}
let html = await readFile('dist/index.html', 'utf8');
const faviconTag = '<link rel="icon" href="./favicon.svg" type="image/svg+xml">';
if (!html.includes(faviconTag)) throw new Error(`Missing favicon ${faviconTag}`);
const favicon = (await readFile('dist/favicon.svg')).toString('base64');
html = html.replace(faviconTag, () => `<link rel="icon" href="data:image/svg+xml;base64,${favicon}" type="image/svg+xml">`);
for (const name of ['styles', 'terminal', 'workspace', 'themes']) {
  const tag = `<link rel="stylesheet" href="./${name}.css">`;
  if (!html.includes(tag)) throw new Error(`Missing stylesheet ${tag}`);
  const css = await readFile(`dist/${name}.css`, 'utf8');
  html = html.replace(tag, () => `<style data-bundled="${name}">\n${css}\n</style>`);
}
const assets = JSON.stringify({ binaries, metadata, examples }).replaceAll('<', '\\u003c');
const script = `globalThis.__P2W_ASSETS__ = ${assets};\n${await bundledEditor(resolve(dist, 'app.js'))}`;
const entryTag = '<script type="module" src="./app.js"></script>';
if (!html.includes(entryTag)) throw new Error(`Missing editor entry point ${entryTag}`);
html = html.replace(entryTag, () => `<script>\n${script}\n</script>`);
await writeFile('dist/index.html', html);
console.log('Built standalone IDE in dist/index.html (works over HTTP and file://).');
