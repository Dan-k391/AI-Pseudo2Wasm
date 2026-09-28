import { performance } from 'node:perf_hooks';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { compileSelfHosted, loadSelfHostedCompiler } from '../bootstrap/compile.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'bench', 'workloads');
const work = join(root, '.bench-toolchains');
const emcc = join(work, 'emsdk', 'upstream', 'emscripten', process.platform === 'win32' ? 'emcc.exe' : 'emcc');
const asc = join(work, 'assemblyscript', 'node_modules', 'assemblyscript', 'bin', 'asc.js');
const cWasm = join(work, 'real-emscripten.wasm');
const asWasm = join(work, 'real-assemblyscript.wasm');
const pseudoGuardedWasm = join(work, 'real-pseudo-guarded.wasm');
const pseudoReleaseWasm = join(work, 'real-pseudo-release.wasm');
const toolNames = ['PseudoRelease', 'PseudoGuarded', 'Emscripten', 'AssemblyScript'];
const samples = positiveInteger(process.env.BENCH_SAMPLES, 9);
const warmups = positiveInteger(process.env.BENCH_WARMUPS, 3);

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, got ${value}`);
  return parsed;
}

function command(executable, args) {
  const start = performance.now();
  const result = spawnSync(executable, args, { cwd: work, encoding: 'utf8', maxBuffer: 4_000_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return { elapsedMs: performance.now() - start, stdout: result.stdout };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function matrixChecksum(n) {
  let checksum = 0;
  for (let i = 0; i < n; i++) {
    let diagonal = 0;
    for (let k = 0; k < n; k++) diagonal += ((i + k) % 7) * ((k * 2 + i) % 11);
    checksum += diagonal;
  }
  return checksum;
}

const workloads = [
  { name: 'N queens', export: 'nQueens', input: 10, expected: 724, repeats: 1 },
  { name: 'Prime sieve', export: 'primeCount', input: 100_000, expected: 9592, repeats: 5 },
  { name: 'Matrix multiply', export: 'matMul', input: 48, expected: matrixChecksum(48), repeats: 10 },
];

function instantiate(name, binary) {
  const module = new WebAssembly.Module(binary);
  const env = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    if (entry.kind !== 'function' || entry.module !== 'env') {
      throw new Error(`${name} has unexpected import ${entry.module}.${entry.name}`);
    }
    if (entry.name === 'fail') {
      env.fail = (code, line) => { throw new Error(`${name} failed with code ${code} at line ${line}`); };
    } else if (entry.name === 'abort') {
      env.abort = () => { throw new Error(`${name} aborted`); };
    } else if (entry.name === 'limit') {
      env.limit = () => 2_000_000_000;
    } else if (entry.name === 'emitNumber' || entry.name === 'endLine') {
      // The benchmark's pseudocode has only OUTPUT 0 in main; it is not timed.
      env[entry.name] = () => 0;
    } else {
      env[entry.name] = () => { throw new Error(`${name} unexpectedly called env.${entry.name}`); };
    }
  }
  const instance = new WebAssembly.Instance(module, { env });
  if (name.startsWith('Pseudo')) instance.exports.main();
  return instance;
}

function getFunction(name, instance, workload) {
  const exportName = name.startsWith('Pseudo') ? workload.export.toUpperCase() : workload.export;
  const fn = instance.exports[exportName];
  if (typeof fn !== 'function') throw new Error(`${name} did not export ${exportName}`);
  return fn;
}

function timeOne(fn, workload) {
  const start = performance.now();
  let actual;
  for (let i = 0; i < workload.repeats; i++) actual = fn(workload.input);
  return { actual, elapsedMs: (performance.now() - start) / workload.repeats };
}

function check(name, workload, actual) {
  if (actual !== workload.expected) {
    throw new Error(`${name} ${workload.export}(${workload.input}) returned ${actual}; expected ${workload.expected}`);
  }
}

async function main() {
  await mkdir(work, { recursive: true });
  const pseudoSource = await readFile(join(sourceDir, 'real.pseudo'), 'utf8');
  const compiler = await loadSelfHostedCompiler();
  const build = {};

  let start = performance.now();
  const pseudoRelease = await compileSelfHosted(pseudoSource, compiler, { release: true });
  build.PseudoRelease = performance.now() - start;
  start = performance.now();
  const pseudoGuarded = await compileSelfHosted(pseudoSource, compiler);
  build.PseudoGuarded = performance.now() - start;
  if (!pseudoRelease.native || pseudoRelease.nativeBackend !== 'selfhosted' || !pseudoRelease.release) {
    throw new Error('Release build did not use the self-hosted native WASM compiler');
  }
  if (!pseudoGuarded.native || pseudoGuarded.nativeBackend !== 'selfhosted') {
    throw new Error('Guarded build did not use the self-hosted native WASM compiler');
  }
  await Promise.all([
    writeFile(pseudoReleaseWasm, pseudoRelease.binary),
    writeFile(pseudoGuardedWasm, pseudoGuarded.binary),
  ]);
  // emcc and asc require filesystem inputs; the checked-in source is used unchanged.
  build.Emscripten = command(emcc, [
    '-O3', '-sSTANDALONE_WASM=1', '-Wl,--no-entry',
    '-Wl,--export=nQueens', '-Wl,--export=primeCount', '-Wl,--export=matMul',
    join(sourceDir, 'real.c'), '-o', cWasm,
  ]).elapsedMs;
  build.AssemblyScript = command(process.execPath, [
    asc, join(sourceDir, 'real.ts'), '--outFile', asWasm, '-Ospeed', '--runtime', 'stub',
  ]).elapsedMs;

  const binaries = {
    PseudoRelease: pseudoRelease.binary,
    PseudoGuarded: pseudoGuarded.binary,
    Emscripten: await readFile(cWasm),
    AssemblyScript: await readFile(asWasm),
  };
  const instances = Object.fromEntries(Object.entries(binaries).map(([name, binary]) => [name, instantiate(name, binary)]));
  const results = {};
  for (const workload of workloads) {
    const fns = Object.fromEntries(toolNames.map(name => [name, getFunction(name, instances[name], workload)]));
    const times = Object.fromEntries(toolNames.map(name => [name, []]));
    for (let pass = 0; pass < warmups + samples; pass++) {
      // Rotate run order to avoid consistently favoring one toolchain.
      for (let offset = 0; offset < toolNames.length; offset++) {
        const name = toolNames[(pass + offset) % toolNames.length];
        const result = timeOne(fns[name], workload);
        check(name, workload, result.actual);
        if (pass >= warmups) times[name].push(result.elapsedMs);
      }
    }
    results[workload.export] = Object.fromEntries(toolNames.map(name => [name, {
      medianMs: median(times[name]), minMs: Math.min(...times[name]), maxMs: Math.max(...times[name]),
    }]));
  }
  const emccVersion = command(emcc, ['--version']).stdout.split(/\r?\n/)[0];
  const asVersion = JSON.parse(await readFile(join(work, 'assemblyscript', 'node_modules', 'assemblyscript', 'package.json'), 'utf8')).version;
  const report = {
    versions: { node: process.version, emscripten: emccVersion, assemblyScript: asVersion },
    settings: { samples, warmups, pseudoCompiler: 'self-hosted native', cFlags: '-O3 -sSTANDALONE_WASM=1', assemblyScriptFlags: '-Ospeed --runtime stub' },
    workloads: workloads.map(({ name, export: exportName, input, expected, repeats }) => ({ name, export: exportName, input, expected, repeats })),
    buildMs: build,
    wasmBytes: Object.fromEntries(Object.entries(binaries).map(([name, bytes]) => [name, bytes.length])),
    runtimeMs: results,
  };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Node ${process.version}; ${emccVersion}; AssemblyScript ${asVersion}`);
    console.log(`Median milliseconds per call (${samples} samples, ${warmups} warmups; lower is better)`);
    console.log('| Workload | Pseudo release | Pseudo guarded | Emscripten | AssemblyScript |');
    console.log('| --- | ---: | ---: | ---: | ---: |');
    for (const workload of workloads) {
      const row = results[workload.export];
      console.log(`| ${workload.name} (${workload.input}) | ${toolNames.map(name => row[name].medianMs.toFixed(3)).join(' | ')} |`);
    }
    console.log(`Checks: ${workloads.map(item => `${item.name}=${item.expected}`).join(', ')}`);
    console.log(`Build ms: ${JSON.stringify(build)}`);
    console.log(`WASM bytes: ${JSON.stringify(report.wasmBytes)}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
