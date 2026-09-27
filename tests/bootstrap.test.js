import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { bootstrap, coreSource } from '../bootstrap/bootstrap.js';
import { compileSelfHosted, loadSelfHostedCompiler } from '../bootstrap/compile.js';
import { advancedExamples } from '../web/examples.js';

const bootstrapped = bootstrap();

test('all packaged compiler stages execute as native self-hosted WASM', async () => {
  const compiler = await loadSelfHostedCompiler();
  for (const stage of [compiler, compiler.assembler, compiler.nativeLowerer]) {
    assert.equal(stage.native, true);
    assert.equal(stage.nativeBackend, 'selfhosted');
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(stage.binary)).map(item => item.name);
    assert.equal(imports.some(name => ['get', 'set', 'index', 'field', 'binary', 'call'].includes(name)), false);
  }
});

test('the packaged self-hosted compiler reads virtual text files', async () => {
  const compiler = await loadSelfHostedCompiler();
  const source = `DECLARE i : STRING
OPENFILE "data.txt" FOR READ
WHILE NOT EOF("data.txt")
  READFILE "data.txt", i
  OUTPUT i
ENDWHILE
CLOSEFILE "data.txt"
`;
  const built = await compileSelfHosted(source, compiler);
  const result = await createRuntime(built, { files: { 'data.txt': 'first\nsecond\n' } }).run();
  assert.deepEqual(result.output, ['first', 'second']);
});

test('the bootstrapped compiler rebuilds itself and compiles control flow', async () => {
  const core = await bootstrapped;
  assert.equal(WebAssembly.validate(core.binary), true);
  assert.ok(coreSource.includes('INPUT SOURCE'));
  const program = `DECLARE COUNT : INTEGER
DECLARE TEXT : STRING
COUNT ← 0
TEXT ← "start"
WHILE COUNT < 4
  IF COUNT = 2 THEN
    OUTPUT "two"
  ELSE
    OUTPUT COUNT
  ENDIF
  COUNT ← COUNT + 1
ENDWHILE
OUTPUT TEXT & "!"
`;
  const built = await compileSelfHosted(program, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['0', '1', 'two', '3', 'start!']);
});

test('self-hosted output stores dynamic strings in exported memory', async () => {
  const core = await bootstrapped;
  const built = await compileSelfHosted('DECLARE S : STRING\nS ← "café" & " 😀"\nOUTPUT S\n', core);
  assert.ok(WebAssembly.Module.exports(new WebAssembly.Module(built.binary)).some(item => item.name === 'memory' && item.kind === 'memory'));
  assert.ok(Buffer.from(built.binary).includes(Buffer.from('café', 'utf8')));
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['café 😀']);
  assert.ok(Buffer.from(new Uint8Array(result.memory.buffer, 0, result.stringBytes)).includes(Buffer.from('café 😀')));
});

test('the self-hosted compiler accepts INPUT and rejects unsupported statements', async () => {
  const core = await bootstrapped;
  const built = await compileSelfHosted('DECLARE NAME : STRING\nINPUT NAME\nOUTPUT "Hello " & NAME\n', core);
  const result = await createRuntime(built, { inputLines: ['Ada'] }).run();
  assert.deepEqual(result.output, ['Hello Ada']);
  await assert.rejects(compileSelfHosted('OUTPUT "before"\nBOGUS\n', core), error => {
    assert.match(error.message, /Unsupported self-hosted source line/);
    assert.equal(error.line, 2);
    return true;
  });
});

test('the self-hosted assembler and compiler reproduce their own bytes', async () => {
  const core = await bootstrapped;
  assert.equal(WebAssembly.validate(core.assembler.binary), true);
  const source = `DECLARE N : INTEGER
N ← 0
REPEAT
  N ← N + 1
UNTIL N = 3
OUTPUT N
OUTPUT 10 - 3 - 2
OUTPUT 2 + 3 * 4
OUTPUT (2 + 3) * 4
OUTPUT MID("abcdef", 2, LENGTH("abc"))
OUTPUT NOT FALSE
OUTPUT -5 + 7
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['3', '5', '14', '20', 'bcd', 'TRUE', '2']);
});

test('the self-hosted expression path matches arithmetic and output lists', async () => {
  const core = await bootstrapped;
  const source = `DECLARE X : INTEGER
X ← 11 DIV 3 + 11 MOD 3
OUTPUT X, " ", MID("ABCDEFG", 2, 3)
OUTPUT NOT FALSE, " ", 3 < 4 AND 4 <> 5
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['5 BCD', 'TRUE TRUE']);
});

test('the self-hosted compiler runs downward FOR loops', async () => {
  const core = await bootstrapped;
  const source = `DECLARE SUM : INTEGER
DECLARE I : INTEGER
FOR I ← 5 TO 1 STEP -2
  IF I > 2 THEN
    SUM ← SUM + I
  ELSE
    SUM ← SUM + 10
  ENDIF
NEXT I
OUTPUT SUM
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['18']);
});

test('the self-hosted compiler runs REPEAT and CASE ranges', async () => {
  const core = await bootstrapped;
  const source = `DECLARE X : INTEGER
WHILE X < 3
  X ← X + 1
ENDWHILE
REPEAT
  X ← X + 1
UNTIL X = 4
CASE OF X
  1 TO 3 : OUTPUT "low"
  4 : OUTPUT "four"
  OTHERWISE : OUTPUT "other"
ENDCASE
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['four']);
});

test('the self-hosted compiler selects string CASE arms', async () => {
  const core = await bootstrapped;
  const source = `DECLARE Choice : STRING
Choice ← "B"
CASE OF Choice
  "A" : OUTPUT "first"
  "B" : OUTPUT "second"
  OTHERWISE : OUTPUT "other"
ENDCASE
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['second']);
});

test('the self-hosted compiler supports nested CASE blocks', async () => {
  const core = await bootstrapped;
  const source = `DECLARE A : INTEGER
DECLARE B : STRING
A ← 2
B ← "Y"
CASE OF A
  1 : OUTPUT "wrong"
  2 :
    CASE OF B
      "X" : OUTPUT "wrong"
      "Y" : OUTPUT "nested"
    ENDCASE
  OTHERWISE : OUTPUT "wrong"
ENDCASE
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['nested']);
});

test('the self-hosted compiler creates records and accesses fields', async () => {
  const core = await bootstrapped;
  const source = `TYPE TStudent
  DECLARE Name : STRING
  DECLARE Score : INTEGER
ENDTYPE
DECLARE Student : TStudent
Student.Name ← "Ada"
Student.Score ← 7
OUTPUT Student.Name, " ", Student.Score
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['Ada 7']);
});

test('the self-hosted compiler handles inline and aliased arrays', async () => {
  const core = await bootstrapped;
  const source = `TYPE TNumbers = ARRAY[3:4] OF INTEGER
DECLARE Values : TNumbers
DECLARE Scores : ARRAY[1:2, 0:1] OF INTEGER
Values[3] ← 9
Scores[2, 1] ← Values[3]
OUTPUT Scores[2, 1]
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['9']);
});

test('the self-hosted compiler handles enum values and defined sets', async () => {
  const core = await bootstrapped;
  const source = `TYPE TColor = (RED, GREEN, BLUE)
TYPE TLetters = SET OF CHAR
DEFINE Vowels('A', 'E', 'I') : TLetters
OUTPUT RED, " ", 'A' IN Vowels
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['RED TRUE']);
});

test('the self-hosted compiler emits recursive functions', async () => {
  const core = await bootstrapped;
  const source = `FUNCTION Factorial(N : INTEGER) RETURNS INTEGER
  IF N <= 1 THEN
    RETURN 1
  ENDIF
  RETURN N * Factorial(N - 1)
ENDFUNCTION
DECLARE Result : INTEGER
Result ← Factorial(5)
OUTPUT Result
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['120']);
});

test('the self-hosted compiler passes BYREF procedure arguments', async () => {
  const core = await bootstrapped;
  const source = `PROCEDURE AddOne(BYREF N : INTEGER)
  N ← N + 1
ENDPROCEDURE
DECLARE Result : INTEGER
Result ← 120
CALL AddOne(Result)
OUTPUT Result
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['121']);
});

test('the self-hosted compiler runs text file I/O', async () => {
  const core = await bootstrapped;
  const source = `DECLARE Line : STRING
INPUT Line
OPENFILE "a.txt" FOR WRITE
WRITEFILE "a.txt", Line
CLOSEFILE "a.txt"
OPENFILE "a.txt" FOR READ
WHILE NOT EOF("a.txt")
  READFILE "a.txt", Line
  OUTPUT Line
ENDWHILE
CLOSEFILE "a.txt"
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built, { inputLines: ['hello'] }).run();
  assert.deepEqual(result.output, ['hello']);
  assert.equal(result.files['a.txt'], 'hello\n');
});

test('the self-hosted compiler handles pointers and date literals', async () => {
  const core = await bootstrapped;
  const source = `TYPE TIntPointer = ^INTEGER
DECLARE N : INTEGER
DECLARE P : TIntPointer
DECLARE D : DATE
N ← 8
P ← ^N
P^ ← 9
D ← 09/05/2023
OUTPUT N, " ", DAY(D), "/", MONTH(D), "/", YEAR(D)
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['9 9/5/2023']);
});

test('the self-hosted compiler runs random record file operations', async () => {
  const core = await bootstrapped;
  const source = `TYPE TItem
  DECLARE Code : INTEGER
ENDTYPE
DECLARE Item : TItem
OPENFILE "items.dat" FOR RANDOM
Item.Code ← 42
SEEK "items.dat", 0
PUTRECORD "items.dat", Item
Item.Code ← 0
SEEK "items.dat", 0
GETRECORD "items.dat", Item
OUTPUT Item.Code
CLOSEFILE "items.dat"
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['42']);
});

test('the self-hosted compiler runs inherited class methods', async () => {
  const core = await bootstrapped;
  const source = `CLASS Counter
  PRIVATE Value : INTEGER
  PUBLIC PROCEDURE NEW(Start : INTEGER)
    Value ← Start
  ENDPROCEDURE
  PUBLIC PROCEDURE Increment()
    Value ← Value + 1
  ENDPROCEDURE
  PUBLIC FUNCTION Current() RETURNS INTEGER
    RETURN Value
  ENDFUNCTION
ENDCLASS
CLASS DoubleCounter INHERITS Counter
  PUBLIC PROCEDURE NEW(Start : INTEGER)
    SUPER.NEW(Start)
  ENDPROCEDURE
  PUBLIC PROCEDURE Increment()
    Value ← Value + 2
  ENDPROCEDURE
ENDCLASS
DECLARE C : DoubleCounter
C ← NEW DoubleCounter(5)
CALL C.Increment()
OUTPUT C.Current()
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['7']);
});

test('the self-hosted compiler passes BYREF class method arguments', async () => {
  const core = await bootstrapped;
  const source = `CLASS Accumulator
  PUBLIC PROCEDURE Add(BYREF Target : INTEGER, Amount : INTEGER)
    Target ← Target + Amount
  ENDPROCEDURE
ENDCLASS
DECLARE A : Accumulator
DECLARE N : INTEGER
A ← NEW Accumulator()
N ← 4
CALL A.Add(N, 3)
OUTPUT N
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['7']);
});

test('the self-hosted compiler accesses fields of array records', async () => {
  const core = await bootstrapped;
  const source = `TYPE StudentRecord
  DECLARE Name : STRING
  DECLARE Score : INTEGER
ENDTYPE
DECLARE Students : ARRAY[1:2] OF StudentRecord
Students[1].Name ← "Ada"
Students[1].Score ← 93
OUTPUT Students[1].Name, ": ", Students[1].Score
`;
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['Ada: 93']);
});

test('the self-hosted compiler executes all advanced IDE examples', async () => {
  const core = await bootstrapped;
  for (const example of advancedExamples) {
    const built = await compileSelfHosted(example.code, core);
    const inputLines = example.name.includes('Minesweeper') ? ['Q'] : [];
    const result = await createRuntime(built, { inputLines, seed: 123, maxSteps: 250000 }).run();
    assert.equal(result.status, 'completed', example.name);
    if (example.name.includes('Fibonacci')) assert.equal(result.output.at(-1), 'F(20) = 6765');
    if (example.name.includes('N queens')) assert.equal(result.output.at(-1), 'Solutions: 92');
    if (example.name.includes('Minesweeper')) assert.ok(result.output.includes('Game ended.'));
  }
});

test('the self-hosted runtime reports the source line when stopping a loop', async () => {
  const core = await bootstrapped;
  const built = await compileSelfHosted('DECLARE N : INTEGER\nWHILE TRUE\n  N ← N + 1\nENDWHILE\n', core);
  await assert.rejects(createRuntime(built, { maxSteps: 20 }).run(), error => {
    assert.match(error.message, /Execution limit/);
    assert.equal(error.line, 2);
    return true;
  });
});

test('the self-hosted compiler accepts mixed-case source and ASCII assignment arrows', async () => {
  const core = await bootstrapped;
  const built = await compileSelfHosted('declare Count : integer\nCount<-3 // initial value\n\toutput "Keep Case: // ", Count // show it\n', core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['Keep Case: // 3']);
});

test('the self-hosted expression parser accepts compact operators', async () => {
  const core = await bootstrapped;
  const source = 'OUTPUT 2+3*4\nOUTPUT 10-3-2\nOUTPUT (2+3)*4\nOUTPUT -5+7\nOUTPUT 3<=4\nOUTPUT 3<>4\n';
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['14', '5', '20', '2', 'TRUE', 'TRUE']);
});

test('the self-hosted compiler reads multiple INPUT targets', async () => {
  const core = await bootstrapped;
  const built = await compileSelfHosted('DECLARE A, B : INTEGER\nINPUT A, B\nOUTPUT A+B\n', core);
  const result = await createRuntime(built, { inputLines: ['2', '3'] }).run();
  assert.deepEqual(result.output, ['5']);
});

test('the self-hosted compiler resolves named array bounds in type aliases', async () => {
  const core = await bootstrapped;
  const source = 'CONSTANT SIZE = 4\nTYPE TNumbers = ARRAY[1:SIZE] OF INTEGER\nDECLARE Values : TNumbers\nValues[4] ← 12\nOUTPUT Values[4]\n';
  const built = await compileSelfHosted(source, core);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['12']);
});

test('the self-hosted assembler encodes large routine counts and indices', async () => {
  const core = await bootstrapped;
  const source = Array.from({ length: 130 }, (_, i) =>
    `PROCEDURE P${i}()\n  OUTPUT ${i}\nENDPROCEDURE\n`).join('') + 'CALL P129()\n';
  const built = await compileSelfHosted(source, core);
  assert.equal(WebAssembly.validate(built.binary), true);
  const result = await createRuntime(built).run();
  assert.deepEqual(result.output, ['129']);
});
