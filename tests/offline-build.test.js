import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { compileSelfHostedSource } from '../src/selfhost.js';
import { createRuntime } from '../src/runtime.js';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /<script\s+type="module"/);
assert.doesNotMatch(html, /<link\s+rel="stylesheet"/);
assert.doesNotMatch(html, /(?:src|href)="\.\//);
for (const name of ['styles', 'terminal', 'workspace', 'themes']) {
  assert.match(html, new RegExp(`<style data-bundled="${name}">`));
}

const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('globalThis.__P2W_ASSETS__ = '));
assert.ok(script, 'the editor must be embedded in the HTML');
new Script(script, { filename: 'dist/index.html' });
const prefix = 'globalThis.__P2W_ASSETS__ = ';
const start = script.indexOf(prefix) + prefix.length;
const end = script.indexOf(';\n(() =>', start);
assert.ok(start >= prefix.length && end > start, 'embedded compiler assets must be present');
const assets = JSON.parse(script.slice(start, end));
for (const name of ['core', 'assembler', 'native']) {
  assert.ok(WebAssembly.validate(Buffer.from(assets.binaries[name], 'base64')), `${name} WASM must validate`);
  assert.ok(assets.metadata[name]);
  assert.match(assets.examples[`${name}.pseudo`], /DECLARE|FUNCTION/);
}
const stage = name => ({ binary: Buffer.from(assets.binaries[name], 'base64'), ...assets.metadata[name] });
const compiled = await compileSelfHostedSource('OUTPUT 42\n', stage('core'), stage('assembler'), stage('native'));
assert.deepEqual((await createRuntime(compiled).run()).output, ['42']);
console.log('Standalone HTML embeds a valid editor, styles, compiler binaries, and examples.');
