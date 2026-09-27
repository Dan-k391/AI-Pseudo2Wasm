import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createRuntime } from '../src/index.js';
import { tryNativeLower } from '../src/native-wasm.js';
import { compileSelfHosted, loadSelfHostedCompiler } from '../bootstrap/compile.js';
import { advancedExamples } from '../web/examples.js';

async function runNative(source, options) {
  const built = tryNativeLower(source, compile(source));
  assert.ok(built?.native, 'program should use native lowering');
  assert.ok(WebAssembly.validate(built.binary));
  return { built, result: await createRuntime(built, options).run() };
}

test('numeric variables and loops execute with native WASM operations', async () => {
  const source = `DECLARE Total : INTEGER
DECLARE I : INTEGER
FOR I ← 1 TO 100000
  Total ← Total + I
NEXT I
OUTPUT Total
`;
  const { built, result } = await runNative(source, { maxSteps: 500000 });
  assert.deepEqual(result.output, ['5000050000']);
  assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(built.binary)).some(item => item.name === 'get' || item.name === 'set' || item.name === 'binary'), false);
  assert.equal(new DataView(result.memory.buffer).getFloat64(built.nativeGlobalBase, true), 5000050000);
});

test('numeric arrays and record fields occupy contiguous WASM memory', async () => {
  const source = `TYPE TPoint
  DECLARE X : INTEGER
  DECLARE Y : INTEGER
ENDTYPE
DECLARE Values : ARRAY[1:3] OF INTEGER
DECLARE Point : TPoint
Values[2] ← 7
Point.X ← Values[2]
Point.Y ← 5
OUTPUT Point.X + Point.Y
`;
  const { built, result } = await runNative(source);
  assert.deepEqual(result.output, ['12']);
  const view = new DataView(result.memory.buffer);
  assert.equal(view.getFloat64(built.nativeGlobalBase + 8, true), 7);
  assert.equal(view.getFloat64(built.nativeGlobalBase + 24, true), 7);
  assert.equal(view.getFloat64(built.nativeGlobalBase + 32, true), 5);
});

test('recursive calls and BYREF share addresses in a WASM stack', async () => {
  const source = `FUNCTION Factorial(N : INTEGER) RETURNS INTEGER
  IF N <= 1 THEN
    RETURN 1
  ENDIF
  RETURN N * Factorial(N - 1)
ENDFUNCTION
PROCEDURE Increase(BYREF N : INTEGER)
  N ← N + 1
ENDPROCEDURE
DECLARE Answer : INTEGER
Answer ← Factorial(5)
CALL Increase(Answer)
OUTPUT Answer
`;
  const { result } = await runNative(source);
  assert.deepEqual(result.output, ['121']);
});

test('strings live in WASM memory and concatenate inside WASM', async () => {
  const source = 'DECLARE Name : STRING\nName ← "Ada" & " Lovelace"\nOUTPUT Name\n';
  const { result } = await runNative(source);
  assert.deepEqual(result.output, ['Ada Lovelace']);
  assert.ok(Buffer.from(new Uint8Array(result.memory.buffer, 0, result.stringBytes)).includes(Buffer.from('Ada Lovelace')));
});

test('unsupported classes retain the compatibility module', () => {
  const source = 'CLASS Thing\nENDCLASS\nDECLARE X : Thing\n';
  assert.equal(tryNativeLower(source, compile(source)), null);
});

test('large repeated string appends use the rope-backed compatibility runtime', () => {
  const source = 'DECLARE Text : STRING\nDECLARE I : INTEGER\nFOR I ← 1 TO 70000\n  Text ← Text & "x"\nNEXT I\nOUTPUT LENGTH(Text)\n';
  assert.equal(tryNativeLower(source, compile(source)), null);
});

test('BYREF array elements and record fields update the same WASM cells', async () => {
  const source = `TYPE TCell
  DECLARE Value : INTEGER
ENDTYPE
PROCEDURE AddOne(BYREF N : INTEGER)
  N ← N + 1
ENDPROCEDURE
DECLARE Items : ARRAY[1:2] OF INTEGER
DECLARE Cell : TCell
Items[2] ← 6
Cell.Value ← 10
CALL AddOne(Items[2])
CALL AddOne(Cell.Value)
OUTPUT Items[2], " ", Cell.Value
`;
  const { result } = await runNative(source);
  assert.deepEqual(result.output, ['7 11']);
});

test('native bounds checks and input still report source locations', async () => {
  const source = 'DECLARE Values : ARRAY[1:2] OF INTEGER\nValues[3] ← 1\n';
  const built = tryNativeLower(source, compile(source));
  await assert.rejects(createRuntime(built).run(), error => error.line === 2 && /bounds/.test(error.message));
  const inputSource = 'DECLARE N : INTEGER\nOUTPUT "N?"\nINPUT N\nOUTPUT N + 1\n';
  const inputBuilt = tryNativeLower(inputSource, compile(inputSource));
  const waiting = await createRuntime(inputBuilt, { interactive: true }).run();
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.label, 'N');
  assert.deepEqual(waiting.output, ['N?']);
  assert.deepEqual((await createRuntime(inputBuilt, { inputLines: ['41'] }).run()).output, ['N?', '42']);
});

test('the packaged self-hosted compiler selects native WASM for the complex examples', async () => {
  const compiler = await loadSelfHostedCompiler();
  for (const example of advancedExamples) {
    const built = await compileSelfHosted(example.code, compiler);
    assert.equal(built.native, true, `${example.name} should use native lowering`);
    assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(built.binary)).some(item => ['get', 'set', 'index', 'field', 'binary'].includes(item.name)), false);
  }
});

test('native and compatibility paths agree on all complex example output', async () => {
  for (const example of advancedExamples) {
    const compatible = compile(example.code), native = tryNativeLower(example.code, compatible);
    const options = { maxSteps: 500000, seed: 12345, inputLines: example.name === 'ASCII Minesweeper' ? ['F', '1', '1', 'Q'] : [] };
    const baseline = await createRuntime(compatible, options).run();
    const lowered = await createRuntime(native, options).run();
    assert.deepEqual(lowered.output, baseline.output, example.name);
  }
});

test('Unicode string equality and nested record arrays run in WASM memory', async () => {
  const source = `TYPE TCell
  DECLARE Label : STRING
  DECLARE Score : INTEGER
ENDTYPE
DECLARE Grid : ARRAY[1:2] OF TCell
Grid[2].Label ← "café 😀"
Grid[2].Score ← 7
IF Grid[2].Label = "café 😀" THEN
  OUTPUT Grid[2].Label, " ", Grid[2].Score
ENDIF
`;
  const { result } = await runNative(source);
  assert.deepEqual(result.output, ['café 😀 7']);
});

test('the built-in loops example compiles through the self-hosted browser path', async () => {
  const source = `DECLARE Total : INTEGER
DECLARE Number : INTEGER

FOR Number ← 1 TO 10
  IF Number MOD 2 = 0 THEN
    Total ← Total + Number
  ENDIF
NEXT Number

CASE OF Total
  30 : OUTPUT "The even numbers sum to 30"
  OTHERWISE : OUTPUT "Total: ", Total
ENDCASE
`;
  const compiler = await loadSelfHostedCompiler();
  const built = await compileSelfHosted(source, compiler);
  assert.deepEqual((await createRuntime(built).run()).output, ['The even numbers sum to 30']);
});
