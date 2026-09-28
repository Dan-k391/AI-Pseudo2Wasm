import { performance } from 'node:perf_hooks';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { compileSelfHosted, loadSelfHostedCompiler } from '../bootstrap/compile.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, '.bench-toolchains');
const emsdk = join(work, 'emsdk');
const emcc = join(emsdk, 'upstream', 'emscripten', 'emcc.exe');
const asc = join(work, 'assemblyscript', 'node_modules', 'assemblyscript', 'bin', 'asc.js');
const pseudoFile = join(work, 'kernels.pseudo');
const cFile = join(work, 'kernels.c');
const tsFile = join(work, 'kernels.ts');
const cWasm = join(work, 'emscripten-kernels.wasm');
const tsWasm = join(work, 'assemblyscript-kernels.wasm');
const pseudoWasm = join(work, 'pseudo-kernels.wasm');

const pseudoSource = `FUNCTION Sum(N : INTEGER) RETURNS REAL
  DECLARE Total : REAL
  DECLARE I : INTEGER
  Total ← 0
  FOR I ← 1 TO N
    Total ← Total + I
  NEXT I
  RETURN Total
ENDFUNCTION

FUNCTION Fib(N : INTEGER) RETURNS INTEGER
  IF N <= 1 THEN
    RETURN N
  ENDIF
  RETURN Fib(N - 1) + Fib(N - 2)
ENDFUNCTION

OUTPUT 0
`;
const cSource = `double sum(int n) {
  double total = 0;
  for (int i = 1; i <= n; i++) total += i;
  return total;
}
double fib(int n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
`;
const tsSource = `export function sum(n: i32): f64 {
  let total: f64 = 0;
  for (let i: i32 = 1; i <= n; i++) total += i;
  return total;
}
export function fib(n: i32): f64 {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
`;

function run(command, args) {
  const started = performance.now();
  const result = spawnSync(command, args, { cwd: work, encoding: 'utf8', maxBuffer: 4_000_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return performance.now() - started;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  await mkdir(work, { recursive: true });
  await Promise.all([
    writeFile(pseudoFile, pseudoSource),
    writeFile(cFile, cSource),
    writeFile(tsFile, tsSource),
  ]);
  const compiler = await loadSelfHostedCompiler();
  const cArgs = ['-O3', '-sSTANDALONE_WASM=1', '-Wl,--no-entry', '-Wl,--export=sum', '-Wl,--export=fib', cFile, '-o', cWasm];
  const tsArgs = [tsFile, '--outFile', tsWasm, '-Ospeed', '--runtime', 'stub'];
  const pseudoArgs = [join(root, 'bootstrap', 'compile.js'), pseudoFile, pseudoWasm];

  // One warm build, then median build time. Pseudo also reports its in-process API.
  run(emcc, cArgs);
  run(process.execPath, [asc, ...tsArgs]);
  run(process.execPath, pseudoArgs);
  const build = { Emscripten: [], AssemblyScript: [], PseudoCLI: [], PseudoAPI: [] };
  for (let i = 0; i < 5; i++) {
    build.Emscripten.push(run(emcc, cArgs));
    build.AssemblyScript.push(run(process.execPath, [asc, ...tsArgs]));
    build.PseudoCLI.push(run(process.execPath, pseudoArgs));
    const t = performance.now();
    await compileSelfHosted(pseudoSource, compiler);
    build.PseudoAPI.push(performance.now() - t);
  }
  const pseudo = await compileSelfHosted(pseudoSource, compiler);
  if (!pseudo.native || pseudo.nativeBackend !== 'selfhosted') throw new Error('Pseudo program did not use self-hosted native WASM');
  const binaries = {
    Pseudo2Wasm: pseudo.binary,
    Emscripten: await readFile(cWasm),
    AssemblyScript: await readFile(tsWasm),
  };
  const instances = {};
  for (const [name, binary] of Object.entries(binaries)) {
    const module = new WebAssembly.Module(binary);
    const imports = WebAssembly.Module.imports(module);
    const env = {};
    for (const entry of imports) {
      if (entry.kind !== 'function' || entry.module !== 'env') throw new Error(`${name} has unexpected import ${entry.module}.${entry.name}`);
      env[entry.name] = entry.name === 'limit' ? () => 2_000_000_000
        : entry.name === 'fail' ? (code, line) => { throw new Error(`Pseudo WASM error ${code} at line ${line}`); }
        : () => 0;
    }
    const instance = new WebAssembly.Instance(module, { env });
    if (name === 'Pseudo2Wasm') instance.exports.main();
    instances[name] = instance;
  }
  const kernels = [
    { name: 'sum', input: 10_000_000, expected: 50_000_005_000_000, repeats: 1 },
    { name: 'fib', input: 25, expected: 75_025, repeats: 10 },
  ];
  const runtime = {};
  for (const kernel of kernels) {
    runtime[kernel.name] = {};
    for (const [name, instance] of Object.entries(instances)) {
      const fn = instance.exports[name === 'Pseudo2Wasm' ? kernel.name.toUpperCase() : kernel.name];
      if (typeof fn !== 'function') throw new Error(`${name} did not export ${kernel.name}`);
      const times = [];
      for (let i = 0; i < 12; i++) {
        const t = performance.now();
        let actual;
        for (let j = 0; j < kernel.repeats; j++) actual = fn(kernel.input);
        const elapsed = (performance.now() - t) / kernel.repeats;
        if (actual !== kernel.expected) throw new Error(`${name} ${kernel.name} returned ${actual}, expected ${kernel.expected}`);
        if (i >= 2) times.push(elapsed);
      }
      runtime[kernel.name][name] = { medianMs: median(times), minMs: Math.min(...times), maxMs: Math.max(...times) };
    }
  }
  const emccVersion = spawnSync(emcc, ['--version'], { cwd: work, encoding: 'utf8' }).stdout.match(/emcc .*?\b\d+\.\d+\.\d+/)?.[0] || 'unknown';
  const asVersion = JSON.parse(await readFile(join(work, 'assemblyscript', 'node_modules', 'assemblyscript', 'package.json'), 'utf8')).version;
  console.log(JSON.stringify({
    versions: { node: process.version, emscripten: emccVersion, assemblyScript: asVersion },
    buildMs: Object.fromEntries(Object.entries(build).map(([name, times]) => [name, median(times)])),
    wasmBytes: Object.fromEntries(Object.entries(binaries).map(([name, bytes]) => [name, bytes.length])),
    runtimeMs: runtime,
  }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
