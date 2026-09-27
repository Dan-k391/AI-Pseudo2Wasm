# Pseudo2Wasm

A dependency-free compiler and browser IDE for Cambridge International AS & A Level Computer Science (9618) pseudocode. It tokenizes and parses source into an AST, emits a WebAssembly binary with structured control flow and callable routines, then supplies input/output, typed values, and virtual files through host imports.

## Run locally

```powershell
npm run build
npm run serve
```

Open <http://127.0.0.1:4173>. The IDE saves your source, input, and virtual files in browser storage. `Ctrl+Enter` runs, `Ctrl+Shift+B` compiles, and `Ctrl+S` downloads the project JSON.

`INPUT` pauses at the terminal when preloaded stdin is exhausted. Type a value and press Enter to continue. The browser replays the compiled module with the supplied inputs and a fixed random seed, so earlier output and virtual file effects appear only once.

## Use the compiler from JavaScript

```js
import { compile, run } from './src/index.js';

const source = 'DECLARE X : INTEGER\nX ← 6 * 7\nOUTPUT X';
const { binary } = compile(source);   // a valid WebAssembly module
const result = await run(source);      // { output: ['42'], files, records, steps, binary }
```

The downloaded `.wasm` has `env` imports for the Pseudo2Wasm runtime. It is not a WASI module; use `createRuntime(compiled, options)` for execution.

## Language coverage

- Scalar declarations, constants, type checks, arithmetic, Boolean and string operations, built-in string/number/date functions
- `IF`, `CASE` including ranges, `FOR` with `STEP`, `WHILE`, `REPEAT`
- Functions, procedures, recursion, `RETURN`, `BYVAL`, `BYREF`
- Arrays with explicit bounds, records, enums, sets, pointers, classes, inheritance and constructors
- Text and random file statements with a browser-local virtual filesystem

The compiler targets the [Cambridge 2026 pseudocode guide](https://www.cambridgeinternational.org/Images/697401-2026-pseudocode-guide-for-teachers.pdf). Unsupported or malformed syntax reports a source line rather than silently producing code. The runtime caps execution at 250,000 steps in the IDE.

## Verify

```powershell
npm test
npm run build
```
