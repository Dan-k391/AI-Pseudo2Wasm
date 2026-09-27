# Pseudo2Wasm

A dependency-free compiler and browser IDE for Cambridge International AS & A Level Computer Science (9618) pseudocode. The browser compiles source with a self-hosted WebAssembly compiler and assembler written in pseudocode. Eligible programs then receive a native WASM lowering pass: scalar variables, numeric arrays and records, arithmetic, control flow, routine frames, and `BYREF` addresses run in WASM memory. Strings are memory-backed too; concatenation and equality execute in WASM. JavaScript handles input/output and selected built-ins. Unsupported features continue through the compatibility runtime.

## Run locally

```powershell
npm run build
npm run serve
```

Open <http://127.0.0.1:4173>. The VS Code style workspace saves source files, open tabs, panel sizes, input, and virtual files in browser storage. Create or import several `.pseudo` files from Explorer, keep them open as tabs, and use **Split editor** to view two files side by side. Alt-click a file in Explorer to open it in the other editor. Run, Compile, and Download .wasm use the active editor's file.

Drag the Explorer, Program Tools, terminal, and split-editor dividers to resize them. The activity bar toggles panels. `Ctrl+Enter` runs, `Ctrl+Shift+B` compiles, `Ctrl+S` saves locally, `Ctrl+\\` splits the editor, `Ctrl+W` closes a tab, and `Ctrl+Tab` cycles tabs. Compile a file and use the Build panel to download a portable project JSON.

In an editor, `Ctrl+click` or `F12` jumps to a symbol's declaration, `Shift+F12` lists its references, and `Alt+Left` returns to the previous location. Navigation follows routine and class scopes within the active source file; each `.pseudo` file is compiled separately.

`INPUT` pauses at the terminal when preloaded stdin is exhausted. Type a value and press Enter to continue. The browser replays the compiled module with the supplied inputs and a fixed random seed, so earlier output and virtual file effects appear only once.

The Explorer includes runnable examples for memoized Fibonacci, the N queens backtracking problem (set `N` to change the board size), and an ASCII Minesweeper game. Minesweeper asks for an action (`R`, `F`, or `Q`), then a row and column for reveal or flag moves; enter each value in the terminal.

## Use the compiler from JavaScript

```js
import { compile, run } from './src/index.js';

const source = 'DECLARE X : INTEGER\nX ← 6 * 7\nOUTPUT X';
const { binary } = compile(source);   // a valid WebAssembly module
const result = await run(source);      // { output: ['42'], files, records, steps, binary }
```

The downloaded `.wasm` has `env` imports for the Pseudo2Wasm runtime. It is not a WASI module; use `createRuntime(compiled, options)` for execution.

## Self-hosted compiler

Run `npm run bootstrap` to build the pseudocode compiler and assembler and verify that both rebuild themselves byte for byte through two WebAssembly stages. Then use `npm run selfhost:compile -- bootstrap/demo.pseudo bootstrap/build/demo.wasm` to compile with the bootstrapped compiler. The IDE's Run, Compile, and Download buttons use the same compiler. See [the bootstrap guide](bootstrap/README.md) for the architecture and precise language limits.

## Language coverage

- Scalar declarations, constants, type checks, arithmetic, Boolean and string operations, built-in string/number/date functions
- `IF`, `CASE` including ranges, `FOR` with `STEP`, `WHILE`, `REPEAT`
- Functions, procedures, recursion, `RETURN`, `BYVAL`, `BYREF`
- Arrays with explicit bounds, records, enums, sets, pointers, classes, inheritance and constructors
- Text and random file statements with a browser-local virtual filesystem

The compiler targets the [Cambridge 2026 pseudocode guide](https://www.cambridgeinternational.org/Images/697401-2026-pseudocode-guide-for-teachers.pdf). The runtime caps execution at 250,000 steps in the IDE and reports the active source line.

## Verify

```powershell
npm test
npm run build
```
