# Pseudo2Wasm

A dependency-free compiler and browser IDE for Cambridge International AS & A Level Computer Science (9618) pseudocode. The browser compiles source with three native WebAssembly compiler stages written in pseudocode. Those stages compile and rebuild themselves. Eligible programs use native WASM lowering: scalar variables, arrays, records, arithmetic, control flow, routine frames, and `BYREF` addresses run in WASM memory. Strings are memory-backed too; concatenation and equality execute in WASM. JavaScript handles input/output, Unicode text operations, and selected built-ins. Other language features continue through the self-hosted compatibility backend.

## Run locally

```powershell
npm run build
npm run serve
```

Open <http://127.0.0.1:4173>. The VS Code style workspace saves source files, open tabs, panel sizes, input, and virtual files in browser storage. Create or import several `.pseudo` files from Explorer, keep them open as tabs, and use **Split editor** to view two files side by side. Alt-click a file in Explorer to open it in the other editor. Run, Compile, and Download .wasm use the active editor's file.

Drag the Explorer, Program Tools, terminal, and split-editor dividers to resize them. The activity bar toggles panels. `Ctrl+Enter` runs, `Ctrl+Shift+B` compiles, `Ctrl+S` saves locally, `Ctrl+\\` splits the editor, `Ctrl+W` closes a tab, and `Ctrl+Tab` cycles tabs. Compile a file and use the Build panel to download a portable project JSON.

The editor supports `Ctrl+Z` undo, `Ctrl+Shift+Z` or `Ctrl+Y` redo, and an editor action menu on right-click. `Ctrl+F` opens Find; Enter and Shift+Enter move through matches while keeping Find focused. `F2` renames the symbol under the cursor and its references in the current file, with one undo step for the rename.

In an editor, holding Ctrl underlines a symbol that has a definition. `Ctrl+click` jumps to its declaration and opens a references box; clicking a declaration opens the same box. `F12` jumps to the declaration, `Shift+F12` opens references, and `Alt+Left` returns to the previous location. Navigation follows routine and class scopes within the active source file; each `.pseudo` file is compiled separately.

`INPUT` pauses at the terminal when preloaded stdin is exhausted. Type a value and press Enter to continue. The browser replays the compiled module with the supplied inputs and a fixed random seed, so earlier output and virtual file effects appear only once.

The Explorer includes runnable examples for memoized Fibonacci, the N queens backtracking problem (set `N` to change the board size), and an ASCII Minesweeper game. Minesweeper asks for an action (`R`, `F`, or `Q`), then a row and column for reveal or flag moves; enter each value in the terminal.

## Use the self-hosted compiler from JavaScript

```js
import { compileSelfHosted, loadSelfHostedCompiler } from './bootstrap/compile.js';
import { createRuntime } from './src/index.js';

const source = 'DECLARE X : INTEGER\nX ← 6 * 7\nOUTPUT X';
const compiler = await loadSelfHostedCompiler();
const compiled = await compileSelfHosted(source, compiler);
const result = await createRuntime(compiled).run(); // output: ['42']
```

The downloaded `.wasm` has `env` imports for the Pseudo2Wasm runtime. It is not a WASI module; use `createRuntime(compiled, options)` for execution.

## Self-hosted compiler

Run `npm run bootstrap` to build the pseudocode compiler, compatibility assembler, and native lowerer, then verify that the native stages rebuild all three native modules byte for byte. Use `npm run selfhost:compile -- bootstrap/demo.pseudo bootstrap/build/demo.wasm` to compile with the bootstrapped compiler. The IDE's Run, Compile, and Download buttons use the same compiler. See [the bootstrap guide](bootstrap/README.md) for the architecture and precise language limits.

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
