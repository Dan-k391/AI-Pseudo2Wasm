# Self-hosted compiler

`core.pseudo` is the source-to-IR compiler and `assembler.pseudo` is the IR-to-WebAssembly assembler. Both are CAIE pseudocode programs. The assembler embeds the fixed Pseudo2Wasm import ABI header and emits the complete `.wasm` binary, including function, memory, export, and code sections.

`npm run bootstrap` uses the JavaScript compiler only as the initial seed. It then uses the seed-built WebAssembly compiler and assembler to build both pseudocode sources. Those results rebuild both sources once more. The build fails unless the two self-hosted stages have identical WebAssembly bytes and string tables. The resulting `bootstrap/build/core.wasm` and `assembler.wasm` are the compiler used by the CLI and browser IDE. Neither production path calls the JavaScript parser or code generator to build a program.

## Build and use

```powershell
npm run bootstrap
npm run selfhost:compile -- bootstrap/demo.pseudo bootstrap/build/demo.wasm
npm run selfhost:run -- bootstrap/build/demo.wasm
npm test
npm run build
npm run serve
```

The compile command writes a `.wasm` and matching `.meta.json` file. The metadata carries types, classes, routines, and the literal string table. Generated modules import a small `env` ABI and need `src/runtime.js` to run. They are not WASI programs. Source always passes through the self-hosted compiler and assembler. An optional JavaScript lowering pass then replaces eligible modules with native WASM for scalar variables, numeric arrays and records, control flow, routines, and `BYREF`. These values live in linear memory; arithmetic, indexing, field access, and frame management execute in WASM. Strings also live in linear memory, and native concatenation and equality use WASM memory instructions. Input, output, random values, and some text built-ins cross to JavaScript. The compatibility module remains for unsupported features, including classes, files, sets, dates, and pointers, and for large repeated string appends where its rope representation is faster.

## Implemented language

The self-hosted path compiles the included language examples and tests for declarations, constants, scalar and composite types, arithmetic and string expressions, calls and recursion, `BYREF`, `IF`, `CASE`, `FOR`, `WHILE`, `REPEAT`, input and output, virtual file operations, pointers, classes, constructors, methods, and inheritance. It emits line-numbered execution checks so the runtime can stop runaway programs. The test suite also runs the Fibonacci, N queens, and ASCII Minesweeper examples through this path.

Source syntax is case-insensitive outside string literals. Both `←` and `<-` assignments work. The compiler accepts inline comments, tabs, and compact symbolic operators.

The compiler is line-oriented, and some grammar edges of the JavaScript seed are still narrower: array bounds in type aliases must be numeric literals or single identifiers; multi-name declarations of inline arrays and indexed or field `INPUT`/`BYREF` targets need separate statements or a plain variable. The browser's live syntax diagnostics still use the JavaScript parser; Run, Compile, and Download use the self-hosted compiler. The seed remains in `src/` for bootstrap and comparison tests.
