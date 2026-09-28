import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createRuntime } from '../src/index.js';
import { compileSelfHosted, loadSelfHostedCompiler } from '../bootstrap/compile.js';
import { advancedExamples } from '../web/examples.js';

const compiler = await loadSelfHostedCompiler();

async function runNative(source, options) {
  const built = await compileSelfHosted(source, compiler);
  assert.ok(built?.native, 'program should use native lowering');
  assert.equal(built.nativeBackend, 'selfhosted');
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

test('release native modules omit step checks while IDE builds stay guarded', async () => {
  const source = 'DECLARE Total : INTEGER\nDECLARE I : INTEGER\nFOR I ← 1 TO 1000\n  Total ← Total + I\nNEXT I\nOUTPUT Total\n';
  const guarded = await compileSelfHosted(source, compiler);
  const release = await compileSelfHosted(source, compiler, { release: true });
  assert.equal(guarded.native, true);
  assert.equal(guarded.release, false);
  assert.equal(release.native, true);
  assert.equal(release.release, true);
  assert.ok(release.binary.length < guarded.binary.length);
  await assert.rejects(createRuntime(guarded, { maxSteps: 10 }).run(), /Execution limit/);
  const result = await createRuntime(release, { maxSteps: 10 }).run();
  assert.deepEqual(result.output, ['500500']);
  assert.equal(result.steps, 0);
  assert.equal(new DataView(result.memory.buffer).getFloat64(release.nativeGlobalBase, true), 500500);
  const invalid = await compileSelfHosted('DECLARE Values : ARRAY[1:2] OF INTEGER\nValues[3] ← 1\n', compiler, { release: true });
  await assert.rejects(createRuntime(invalid).run(), error => error.line === 2 && /bounds/.test(error.message));
});

test('release routines keep numeric parameters and locals correct across recursion and repeated calls', async () => {
  const source = `FUNCTION SumTo(N : INTEGER) RETURNS INTEGER
  DECLARE Total : INTEGER
  DECLARE I : INTEGER
  FOR I ← 1 TO N
    Total ← Total + I
  NEXT I
  RETURN Total
ENDFUNCTION
FUNCTION Fib(N : INTEGER) RETURNS INTEGER
  IF N <= 1 THEN
    RETURN N
  ENDIF
  RETURN Fib(N - 1) + Fib(N - 2)
ENDFUNCTION
OUTPUT SumTo(10), " ", SumTo(3), " ", Fib(10)
`;
  const guarded = await compileSelfHosted(source, compiler);
  const release = await compileSelfHosted(source, compiler, { release: true });
  assert.equal(release.nativeBackend, 'selfhosted');
  assert.ok(WebAssembly.validate(release.binary));
  assert.ok(release.binary.length < guarded.binary.length);
  assert.deepEqual((await createRuntime(release).run()).output, ['55 6 55']);
});

test('release routines preserve string frames and BYREF memory addresses', async () => {
  const stringSource = `FUNCTION Labelled(N : INTEGER, Prefix : STRING) RETURNS STRING
  DECLARE ResultValue : INTEGER
  ResultValue ← N + 1
  RETURN Prefix & NUM_TO_STR(ResultValue)
ENDFUNCTION
OUTPUT Labelled(4, "N=")
`;
  const stringBuilt = await compileSelfHosted(stringSource, compiler, { release: true });
  assert.equal(stringBuilt.nativeBackend, 'selfhosted');
  assert.deepEqual((await createRuntime(stringBuilt).run()).output, ['N=5']);

  const byrefSource = `PROCEDURE AddOne(BYREF N : INTEGER)
  N ← N + 1
ENDPROCEDURE
DECLARE Values : ARRAY[1:2] OF INTEGER
Values[2] ← 7
CALL AddOne(Values[2])
OUTPUT Values[2]
`;
  const byrefBuilt = await compileSelfHosted(byrefSource, compiler, { release: true });
  assert.equal(byrefBuilt.nativeBackend, 'selfhosted');
  assert.deepEqual((await createRuntime(byrefBuilt).run()).output, ['8']);
});

test('release FOR loops preserve descending steps and reject dynamic zero steps', async () => {
  const descending = `DECLARE Total : INTEGER
DECLARE I : INTEGER
FOR I ← 5 TO 1 STEP -1
  Total ← Total + I
NEXT I
OUTPUT Total
`;
  const built = await compileSelfHosted(descending, compiler, { release: true });
  assert.equal(built.nativeBackend, 'selfhosted');
  assert.deepEqual((await createRuntime(built).run()).output, ['15']);

  const zeroStep = `DECLARE StepValue : INTEGER
DECLARE I : INTEGER
FOR I ← 1 TO 3 STEP StepValue
  OUTPUT I
NEXT I
`;
  const invalid = await compileSelfHosted(zeroStep, compiler, { release: true });
  await assert.rejects(createRuntime(invalid).run(), /FOR STEP must be a nonzero number/);
});

test('speed optimization keeps constant-step loops and multi-dimensional array values', async () => {
  const source = `DECLARE Grid : ARRAY[0:2, 0:2] OF INTEGER
DECLARE I : INTEGER
DECLARE J : INTEGER
FOR I ← 0 TO 2
  FOR J ← 0 TO 2
    Grid[I, J] ← I * 10 + J
  NEXT J
NEXT I
OUTPUT Grid[1, 2]
FOR I ← 2 TO 0 STEP -1
  OUTPUT Grid[I, I]
NEXT I
`;
  const standard = await compileSelfHosted(source, compiler, { release: true });
  const speed = await compileSelfHosted(source, compiler, { release: true, optimization: 'speed' });
  assert.equal(speed.nativeBackend, 'selfhosted');
  assert.equal(speed.optimization, 'speed');
  assert.ok(speed.binary.length < standard.binary.length);
  assert.deepEqual((await createRuntime(speed).run()).output, (await createRuntime(standard).run()).output);
  assert.deepEqual((await createRuntime(speed).run()).output, ['12', '22', '11', '0']);
});

test('speed optimization retains dynamic index errors, literal bounds and guarded limits', async () => {
  const sources = [
    { source: 'DECLARE A : ARRAY[1:3] OF INTEGER\nA[4] ← 1\n', line: 2 },
    { source: 'DECLARE A : ARRAY[1:3] OF INTEGER\nDECLARE I : REAL\nI ← 1.5\nA[I] ← 1\n', line: 4 },
    { source: 'DECLARE A : ARRAY[1:3] OF INTEGER\nDECLARE I : INTEGER\nI ← 0\nA[I] ← 1\n', line: 4 },
  ];
  for (const item of sources) {
    const built = await compileSelfHosted(item.source, compiler, { release: true, optimization: 'speed' });
    await assert.rejects(createRuntime(built).run(), error => error.line === item.line && /bounds/.test(error.message));
  }
  const zeroStep = await compileSelfHosted('DECLARE S : INTEGER\nDECLARE I : INTEGER\nFOR I ← 1 TO 3 STEP S\n  OUTPUT I\nNEXT I\n', compiler, { release: true, optimization: 'speed' });
  await assert.rejects(createRuntime(zeroStep).run(), /FOR STEP must be a nonzero number/);
  const guarded = await compileSelfHosted('DECLARE I : INTEGER\nFOR I ← 1 TO 100\n  OUTPUT I\nNEXT I\n', compiler, { optimization: 'speed' });
  assert.equal(guarded.release, false);
  await assert.rejects(createRuntime(guarded, { maxSteps: 3 }).run(), /Execution limit/);
});

test('speed zero-fill loop falls back to checked stores outside the array extent', async () => {
  const source = `DECLARE Flags : ARRAY[0:4] OF BOOLEAN
FUNCTION Clear(N : INTEGER) RETURNS INTEGER
  DECLARE I : INTEGER
  FOR I ← 0 TO N - 1
    Flags[I] ← FALSE
  NEXT I
  RETURN 1
ENDFUNCTION
OUTPUT Clear(5)
`;
  const built = await compileSelfHosted(source, compiler, { release: true, optimization: 'speed' });
  assert.equal(built.nativeBackend, 'selfhosted');
  assert.deepEqual((await createRuntime(built).run()).output, ['1']);
  const module = new WebAssembly.Module(built.binary);
  const env = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    env[entry.name] = entry.name === 'fail' ? (code, line) => { throw new Error(`Error ${code} at line ${line}`); } : () => 0;
  }
  const instance = new WebAssembly.Instance(module, { env });
  assert.equal(instance.exports.CLEAR(0), 1);
  assert.equal(instance.exports.CLEAR(5), 1);
  assert.throws(() => instance.exports.CLEAR(6), /Error 2 at line 5/);
});

test('self-hosted native peephole removes multiplication by one', async () => {
  const prefix = 'DECLARE X : INTEGER\nX ← 7\n';
  const direct = await compileSelfHosted(prefix + 'X ← X\nOUTPUT X\n', compiler);
  const multiplication = await compileSelfHosted(prefix + 'X ← X * 2\nOUTPUT X\n', compiler);
  for (const expression of ['X * 1', '1 * X']) {
    const built = await compileSelfHosted(prefix + `X ← ${expression}\nOUTPUT X\n`, compiler);
    assert.equal(built.native, true);
    assert.ok(built.binary.length < multiplication.binary.length);
    assert.ok(built.binary.length <= direct.binary.length + 8, 'only the unused literal remains in the data segment');
    assert.deepEqual((await createRuntime(built).run()).output, ['7']);
  }
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

test('unsupported classes retain the compatibility module', async () => {
  const source = 'CLASS Thing\nENDCLASS\nDECLARE X : Thing\n';
  assert.equal((await compileSelfHosted(source, compiler)).native, undefined);
});

test('large repeated string appends use the rope-backed compatibility runtime', async () => {
  const source = 'DECLARE Text : STRING\nDECLARE I : INTEGER\nFOR I ← 1 TO 70000\n  Text ← Text & "x"\nNEXT I\nOUTPUT LENGTH(Text)\n';
  const built = await compileSelfHosted(source, compiler);
  assert.equal(built.native, undefined);
  assert.deepEqual((await createRuntime(built, { maxSteps: 500000 }).run()).output, ['70000']);
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

test('dynamic BYREF indexes pass the element address through native frames', async () => {
  const source = `TYPE TCell
  DECLARE Value : INTEGER
ENDTYPE
PROCEDURE AddOne(BYREF N : INTEGER)
  N ← N + 1
ENDPROCEDURE
DECLARE Cells : ARRAY[1:3] OF TCell
DECLARE Index : INTEGER
Index ← 2
Cells[Index].Value ← 8
CALL AddOne(Cells[Index].Value)
OUTPUT Cells[Index].Value
`;
  const { built, result } = await runNative(source);
  assert.deepEqual(result.output, ['9']);
  assert.ok(built.nativeFrameBase > built.nativeGlobalBase);
});

test('native bounds checks and input still report source locations', async () => {
  const source = 'DECLARE Values : ARRAY[1:2] OF INTEGER\nValues[3] ← 1\n';
  const built = await compileSelfHosted(source, compiler);
  await assert.rejects(createRuntime(built).run(), error => error.line === 2 && /bounds/.test(error.message));
  const inputSource = 'DECLARE N : INTEGER\nOUTPUT "N?"\nINPUT N\nOUTPUT N + 1\n';
  const inputBuilt = await compileSelfHosted(inputSource, compiler);
  const waiting = await createRuntime(inputBuilt, { interactive: true }).run();
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.label, 'N');
  assert.deepEqual(waiting.output, ['N?']);
  assert.deepEqual((await createRuntime(inputBuilt, { inputLines: ['41'] }).run()).output, ['N?', '42']);
});

test('the packaged self-hosted compiler selects native WASM for the complex examples', async () => {
  for (const example of advancedExamples) {
    const built = await compileSelfHosted(example.code, compiler);
    assert.equal(built.native, true, `${example.name} should use native lowering`);
    assert.equal(built.nativeBackend, 'selfhosted');
    assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(built.binary)).some(item => ['get', 'set', 'index', 'field', 'binary'].includes(item.name)), false);
  }
});

test('native and compatibility paths agree on all complex example output', async () => {
  for (const example of advancedExamples) {
    const compatible = compile(example.code), native = await compileSelfHosted(example.code, compiler);
    const release = await compileSelfHosted(example.code, compiler, { release: true });
    const speed = await compileSelfHosted(example.code, compiler, { optimization: 'speed' });
    const speedRelease = await compileSelfHosted(example.code, compiler, { release: true, optimization: 'speed' });
    const options = { maxSteps: 500000, seed: 12345, inputLines: example.name === 'ASCII Minesweeper' ? ['F', '1', '1', 'Q'] : [] };
    const baseline = await createRuntime(compatible, options).run();
    const lowered = await createRuntime(native, options).run();
    const optimized = await createRuntime(release, options).run();
    const speedResult = await createRuntime(speed, options).run();
    const speedReleaseResult = await createRuntime(speedRelease, options).run();
    assert.deepEqual(lowered.output, baseline.output, example.name);
    assert.deepEqual(optimized.output, baseline.output, `${example.name} release`);
    assert.deepEqual(speedResult.output, baseline.output, `${example.name} speed guarded`);
    assert.deepEqual(speedReleaseResult.output, baseline.output, `${example.name} speed release`);
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
  const built = await compileSelfHosted(source, compiler);
  assert.deepEqual((await createRuntime(built).run()).output, ['The even numbers sum to 30']);
});
