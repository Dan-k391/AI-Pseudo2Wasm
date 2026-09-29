# Pseudo2Wasm

A dependency-free compiler and browser IDE for Cambridge International AS & A Level Computer Science (9618) pseudocode. The browser compiles source with three native WebAssembly compiler stages written in pseudocode. Those stages compile and rebuild themselves. Eligible programs use native WASM lowering: numeric routine locals and parameters use WASM locals when safe, while arrays, records, address-taken values, and `BYREF` addresses use WASM memory. Strings are memory-backed too; concatenation and equality execute in WASM. JavaScript handles input/output, Unicode text operations, and selected built-ins. Other language features continue through the self-hosted compatibility backend.

## Run locally

```powershell
npm run build
npm run serve
```

Open <http://127.0.0.1:4173>. The VS Code style workspace saves source files, open tabs, panel sizes, input, and virtual files in browser storage. Create or import several `.pseudo` files from Explorer, keep them open as tabs, and use **Split editor** to view two files side by side. Alt-click a file in Explorer to open it in the other editor. Run, Compile, and Download .wasm use the active editor's file.

You can also double-click `dist/index.html` after `npm run build`. That built file contains the editor scripts, styles, self-hosted WASM compiler modules, and compiler examples, so it works without an HTTP server. Opening the source template at `web/index.html` from disk redirects to the built file.

Use the **Theme** selector in the top bar to switch between Pseudo2Wasm, Atom One Dark Pro, Dracula, Nord, and GitHub Light. The selected theme is saved with the workspace and included in exported project JSON.

Drag the Explorer, Program Tools, terminal, and split-editor dividers to resize them. The activity bar toggles panels. `Ctrl+Enter` runs, `Ctrl+Shift+B` compiles, `Ctrl+S` saves locally, and `Ctrl+\\` splits the editor. Browsers can reserve `Ctrl+W` and `Ctrl+Tab`, so `Alt+Shift+W` closes the active tab and `Alt+PageUp`/`Alt+PageDown` cycles tabs. Browser-safe alternatives for other actions are listed in the IDE Guide, including `Alt+Shift+G` for Go to Line. Compile a file and use the Build panel to download a portable project JSON.

The editor supports `Ctrl+Z` undo, `Ctrl+Shift+Z` or `Ctrl+Y` redo, and an editor action menu on right-click. `Ctrl+F` opens Find; Enter and Shift+Enter move through matches while keeping Find focused. `F2` renames the symbol under the cursor and its references in the current file, with one undo step for the rename.

In an editor, holding Ctrl underlines a symbol that has a definition. `Ctrl+click` jumps to its declaration and opens a references box; clicking a declaration opens the same box. Hovering a symbol shows its declaration and type. `F12` jumps to the declaration, `Shift+F12` opens references, and `Alt+Left` returns to the previous location. Navigation follows routine and class scopes within the active source file; each `.pseudo` file is compiled separately.

The editor analyzes incomplete source in a background worker on served pages and on the main page when opened from disk, then underlines exact error spans. It checks expression structure, paired blocks, and constant array indexes, then merges those findings with self-hosted compiler errors. Hover an underline for its message, open Problems to jump to it, or use `F8` and `Shift+F8` to move between problems. Static index checks cover literal and named constant indexes when array bounds are known; dynamic indexes are checked when the program runs.

Click a line number or press `F9` to toggle a breakpoint. **Debug** (`F5`) pauses before the first statement; Continue (`F5`) runs to the next breakpoint, Step (`F10`) executes one statement, and Stop (`Shift+F5`) ends the session. The Debug panel shows local and global variables and the call stack. Debugging uses the self-hosted compatibility WASM path and deterministic replay between pauses, so stepping deep into a long run is slower than normal Run. Source edits stop the current session; breakpoints remain saved with the workspace.

`INPUT` pauses at the terminal when preloaded stdin is exhausted. Type a value and press Enter to continue. The browser replays the compiled module with the supplied inputs and a fixed random seed, so earlier output and virtual file effects appear only once.

The Explorer includes runnable examples for memoized Fibonacci, the N queens backtracking problem (set `N` to change the board size), and an ASCII Minesweeper game. Minesweeper asks for an action (`R`, `F`, or `Q`), then a row and column for reveal or flag moves; enter each value in the terminal.

Expand **Self-hosted compiler** under Examples to open its three pseudocode stages in the editor: `core.pseudo`, `native.pseudo`, and `assembler.pseudo`. The site build copies them directly from `bootstrap/`, so the examples match the compiler source used to build the WebAssembly modules.

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

The compiler targets the [Cambridge 2026 pseudocode guide](https://www.cambridgeinternational.org/Images/697401-2026-pseudocode-guide-for-teachers.pdf). Run in the IDE caps execution at 250,000 steps and reports the active source line. The optional Release build checkbox produces native WASM without step checks for Compile and Download; compatibility programs remain guarded.

The **Optimization** selector defaults to Speed for native WASM. Speed specializes `FOR` loops with literal steps, folds proven in-range array indexes, and simplifies array address checks. In Speed Release, eligible integer-start, unit-step `FOR` loops compare and increment an `i32` counter in WASM; the visible numeric variable stays synchronized for reads and after `NEXT`. Fractional ends use the correct integer cutoff, while ends outside the safe `i32` interval fall back to the original floating-point loop. Proven in-range array accesses can reuse that `i32` counter without repeated bounds or fraction checks; other accesses stay checked. Speed Release also turns a simple, safe Boolean array zero-fill loop into a WebAssembly `memory.fill`, with the original checked loop as a fallback. Standard retains the earlier lowering for comparison. Run remains guarded with either setting; Release is a separate choice. The self-hosted command line accepts `--optimize` for Speed builds.

## Verify

```powershell
npm test
npm run build
```

For cross-toolchain runtime tests, run `npm run bench:real`. The [benchmark guide](bench/README.md) documents the N queens, prime sieve, and matrix workloads, required local toolchains, flags, and comparison limits.
