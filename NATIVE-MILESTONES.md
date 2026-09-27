# Native WASM execution milestones

1. Keep the self-hosted pseudocode compiler and assembler as the source parser and compatibility backend. Add a native lowering pass for programs whose types can be represented entirely in linear memory.
2. Lower scalar variables, numeric expressions, comparisons, and control flow to WASM loads, stores, and instructions. Keep step limits inside WASM.
3. Lay out numeric arrays and records contiguously in WASM memory. Pass `BYREF` arguments as addresses and allocate routine frames on a WASM managed stack.
4. Keep JavaScript calls at the boundary for output, input, random values, and some text built-ins. Store strings in linear memory and concatenate and compare them in WASM. Use the existing backend for files, classes, sets, dates, pointers, and unsupported constructs. Large repeated string appends use the rope-backed compatibility path.
5. Verify output parity, addressable storage, recursion, bounds errors, and speed. Publish the tested site.

The native lowering pass is written in `bootstrap/native.pseudo`. The compiler core, compatibility assembler, and native lowerer are each compiled to native WASM and rebuilt byte for byte by those native stages. Their variables, arrays, records, and routine frames use WASM memory. The compatibility assembler handles constructs outside the native pass. The production browser and CLI use these native stages. Their remaining JavaScript imports cover input/output, Unicode text operations, selected built-ins, errors, and execution limits.
