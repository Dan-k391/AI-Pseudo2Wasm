# Native WASM execution milestones

1. Keep the self-hosted pseudocode compiler and assembler as the source parser and compatibility backend. Add a native lowering pass for programs whose types can be represented entirely in linear memory.
2. Lower scalar variables, numeric expressions, comparisons, and control flow to WASM loads, stores, and instructions. Keep step limits inside WASM.
3. Lay out numeric arrays and records contiguously in WASM memory. Pass `BYREF` arguments as addresses and allocate routine frames on a WASM managed stack.
4. Keep JavaScript calls at the boundary for output, input, random values, and some text built-ins. Store strings in linear memory and concatenate and compare them in WASM. Use the existing backend for files, classes, sets, dates, pointers, and unsupported constructs. Large repeated string appends use the rope-backed compatibility path.
5. Verify output parity, addressable storage, recursion, bounds errors, and speed. Publish the tested site.

The optional native lowering pass runs after the self-hosted compiler validates and assembles source. The compiler and assembler still reproduce themselves, and the compatibility module remains available for any source the native pass cannot handle. Native lowering is implemented in JavaScript at compile time; native programs execute their computation in WASM.
