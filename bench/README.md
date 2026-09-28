# Representative WebAssembly benchmarks

Run `npm run bench:real` from the repository root. The command needs the Emscripten SDK at `.bench-toolchains/emsdk` and the AssemblyScript package at `.bench-toolchains/assemblyscript/node_modules/assemblyscript`. Follow [Emscripten's SDK installation guide](https://emscripten.org/docs/getting_started/downloads.html) and clone the SDK into the first path; install AssemblyScript in the second path with `npm install --prefix .bench-toolchains/assemblyscript assemblyscript@0.28.20`. These toolchains are local test dependencies and `.bench-toolchains/` is ignored by Git. Run `npm run bench:real -- --json` for a machine-readable report. `BENCH_SAMPLES` and `BENCH_WARMUPS` override the default 9 timed samples and 3 warmups.

The three implementations are in [`workloads/real.pseudo`](workloads/real.pseudo), [`workloads/real.c`](workloads/real.c), and [`workloads/real.ts`](workloads/real.ts). Each exported function resets its mutable state on every call. The harness verifies the return value on every invocation before accepting a timing:

| Workload | Input | Checked result | What it exercises |
| --- | ---: | ---: | --- |
| N queens | 10 × 10 | 724 solutions | Recursion, branches, global arrays |
| Prime sieve | Integers below 100,000 | 9,592 primes | Array reads/writes and nested loops |
| Matrix multiplication | 48 × 48 | Diagonal checksum 34,600 | Floating-point arithmetic and two-dimensional array access |

The harness compiles Pseudo2Wasm in **Speed** and **Standard** optimization, each with guarded and release step-check settings. It fails if any Pseudo2Wasm build falls back from the self-hosted native compiler. Release omits source-step checks; guarded retains them. Emscripten uses `-O3 -sSTANDALONE_WASM=1` and exports the three functions. AssemblyScript uses `-Ospeed --runtime stub`. The harness instantiates each WASM binary once in the same Node process, rotates toolchain order between samples, and reports the median wall-clock time per call. N queens runs once per sample; the sieve runs five times and matrix multiplication ten times per sample to reduce timing noise. Compilation is outside the timed region; build time is a **single illustrative measurement**, not a controlled build-time comparison.

The algorithms and return values match, but the languages have different number representations, bounds checks, array layouts, and optimization passes. C and AssemblyScript use 32-bit integer loop counters while CAIE `INTEGER` is represented as a WebAssembly floating-point number. C does not insert array-bounds checks for these accesses. Treat the results as performance of these complete compiler outputs under these settings, not an isolated measurement of one optimization or a claim about all programs. In particular, module byte size includes each toolchain's different runtime and linking choices.
