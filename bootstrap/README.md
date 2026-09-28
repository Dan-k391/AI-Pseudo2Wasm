# Self-hosted compiler

`core.pseudo` is the source-to-IR compiler, `native.pseudo` is the IR-to-native-WebAssembly lowerer, and `assembler.pseudo` is the compatibility IR-to-WebAssembly assembler. All three are CAIE pseudocode programs. They emit complete `.wasm` binaries, including function, memory, export, and code sections.

`npm run bootstrap` uses the JavaScript compiler only as the initial seed. It first reaches a byte-for-byte fixed point with compatibility WebAssembly. The self-hosted native lowerer then compiles all three stages to native WebAssembly. The native compiler recompiles all three sources, the native lowerer rebuilds all three native modules byte for byte, and the native assembler reproduces the compatibility modules byte for byte. The build fails if any comparison differs. The native `bootstrap/build/core.wasm`, `native.wasm`, and `assembler.wasm` are the compiler used by the CLI and browser IDE. Neither production path calls the JavaScript parser or code generator to build a program.

## Build and use

```powershell
npm run bootstrap
npm run selfhost:compile -- bootstrap/demo.pseudo bootstrap/build/demo.wasm
npm run selfhost:run -- bootstrap/build/demo.wasm
npm test
npm run build
npm run serve
```

The compile command writes a `.wasm` and matching `.meta.json` file. Generated modules import a small `env` ABI and need `src/runtime.js` to run. They are not WASI programs. Source passes through the native self-hosted core and then the native self-hosted lowerer. The compiler stages and eligible generated programs keep scalar variables, arrays, records, control flow, routines, and `BYREF` addresses in WASM memory and stack frames. Strings live in WASM memory; concatenation creates rope nodes there, and equality compares bytes in WASM after flattening. Input, output, random values, Unicode string operations, and selected text built-ins cross to JavaScript. The native self-hosted compatibility assembler handles unsupported native constructs, including classes, files, sets, dates, and pointers, and large repeated string appends where the compatibility runtime remains faster.

## Implemented language

The self-hosted path compiles the included language examples and tests for declarations, constants, scalar and composite types, arithmetic and string expressions, calls and recursion, `BYREF`, `IF`, `CASE`, `FOR`, `WHILE`, `REPEAT`, input and output, virtual file operations, pointers, classes, constructors, methods, and inheritance. It emits line-numbered execution checks so the runtime can stop runaway programs. The test suite also runs the Fibonacci, N queens, and ASCII Minesweeper examples through this path.

Source syntax is case-insensitive outside string literals. Both `←` and `<-` assignments work. The compiler accepts inline comments, tabs, and compact symbolic operators.

The compiler is line-oriented, and some grammar edges of the JavaScript seed are still narrower: array bounds in type aliases must be numeric literals or single identifiers, and multi-name declarations of inline arrays need separate statements. The browser's live diagnostics, Run, Compile, and Download all use the self-hosted compiler. Diagnostics compile in a worker and discard results for outdated source snapshots. The seed remains in `src/` for bootstrap and comparison tests.
