import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, PseudoError } from '../src/index.js';

async function output(source, options) {
  const built = compile(source);
  assert.equal(WebAssembly.validate(built.binary), true, 'generated module validates');
  return (await run(source, options)).output;
}

test('arithmetic, comparisons, strings and builtins', async () => {
  assert.deepEqual(await output(`
DECLARE X : INTEGER
X ← 11 DIV 3 + 11 MOD 3
OUTPUT X, " ", MID("ABCDEFG", 2, 3)
OUTPUT NOT FALSE, " ", 3 < 4 AND 4 <> 5
`), ['5 BCD', 'TRUE TRUE']);
});

test('strings are UTF-8 in exported linear memory, and long concatenations grow it', async () => {
  const built = compile('DECLARE S : STRING\nS ← "café" & "!"\nOUTPUT S\n');
  assert.ok(WebAssembly.Module.exports(new WebAssembly.Module(built.binary)).some(item => item.name === 'memory' && item.kind === 'memory'));
  assert.ok(Buffer.from(built.binary).includes(Buffer.from('café', 'utf8')));
  const result = await run('DECLARE S : STRING\nS ← "café" & "!"\nOUTPUT S\n');
  assert.deepEqual(result.output, ['café!']);
  const bytes = new Uint8Array(result.memory.buffer, 0, result.stringBytes);
  assert.ok(Buffer.from(bytes).includes(Buffer.from('café!', 'utf8')));
  const grown = await run('DECLARE S : STRING\nDECLARE I : INTEGER\nFOR I ← 1 TO 70000\n  S ← S & "x"\nNEXT I\nOUTPUT LENGTH(S)\nOUTPUT S\n', { maxSteps: 500000 });
  assert.equal(grown.output[0], '70000');
  assert.equal(grown.output[1].length, 70000);
  assert.ok(grown.memory.buffer.byteLength > 65536);
});

test('nested control flow and downward FOR', async () => {
  assert.deepEqual(await output(`
DECLARE SUM : INTEGER
DECLARE I : INTEGER
FOR I ← 5 TO 1 STEP -2
  IF I > 2 THEN
    SUM ← SUM + I
  ELSE
    SUM ← SUM + 10
  ENDIF
NEXT I
OUTPUT SUM
`), ['18']);
});

test('WHILE, REPEAT and CASE ranges', async () => {
  assert.deepEqual(await output(`
DECLARE X : INTEGER
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
`), ['four']);
});

test('arrays, records, enums and sets', async () => {
  assert.deepEqual(await output(`
TYPE TStudent
  DECLARE Name : STRING
  DECLARE Score : INTEGER
ENDTYPE
TYPE TColor = (RED, GREEN, BLUE)
TYPE TLetters = SET OF CHAR
DEFINE Vowels('A', 'E', 'I') : TLetters
DECLARE Scores : ARRAY[1:2, 0:1] OF INTEGER
DECLARE Student : TStudent
Scores[2, 1] ← 7
Student.Name ← "Ada"
Student.Score ← Scores[2, 1]
OUTPUT Student.Name, " ", Student.Score
OUTPUT RED, " ", 'A' IN Vowels
`), ['Ada 7', 'RED TRUE']);
});

test('functions, recursion and BYREF', async () => {
  assert.deepEqual(await output(`
FUNCTION Factorial(N : INTEGER) RETURNS INTEGER
  IF N <= 1 THEN
    RETURN 1
  ENDIF
  RETURN N * Factorial(N - 1)
ENDFUNCTION
PROCEDURE AddOne(BYREF N : INTEGER)
  N ← N + 1
ENDPROCEDURE
DECLARE Result : INTEGER
Result ← Factorial(5)
CALL AddOne(Result)
OUTPUT Result
`), ['121']);
});

test('text file operations and input', async () => {
  const result = await run(`
DECLARE Line : STRING
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
`, { input: 'hello' });
  assert.deepEqual(result.output, ['hello']);
  assert.equal(result.files['a.txt'], 'hello\n');
});

test('classes and inheritance', async () => {
  assert.deepEqual(await output(`
CLASS Counter
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
`), ['7']);
});

test('BYREF class methods update caller variables', async () => {
  assert.deepEqual(await output(`
CLASS Accumulator
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
`), ['7']);
});

test('pointer dereferencing and aliased array type', async () => {
  assert.deepEqual(await output(`
TYPE TIntPointer = ^INTEGER
TYPE TNumbers = ARRAY[3:4] OF INTEGER
DECLARE N : INTEGER
DECLARE P : TIntPointer
DECLARE Values : TNumbers
N ← 8
P ← ^N
P^ ← 9
Values[3] ← N
OUTPUT Values[3]
`), ['9']);
});

test('date literals and built-in date functions', async () => {
  assert.deepEqual(await output(`
DECLARE D : DATE
D ← 09/05/2023
OUTPUT DAY(D), "/", MONTH(D), "/", YEAR(D)
OUTPUT DAYINDEX(D)
OUTPUT SETDATE(26, 10, 2003)
`), ['9/5/2023', '3', '26/10/2003']);
});

test('random files and records', async () => {
  const result = await run(`
TYPE TItem
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
`);
  assert.deepEqual(result.output, ['42']);
});

test('INPUT waits for terminal values and resumes through deterministic replay', async () => {
  const source = `
DECLARE First : STRING
DECLARE Second : STRING
OUTPUT "First?"
INPUT First
OUTPUT "Second?"
INPUT Second
OUTPUT First, " + ", Second
`;
  const first = await run(source, { interactive: true, inputLines: [] });
  assert.equal(first.status, 'waiting');
  assert.equal(first.label, 'FIRST');
  assert.deepEqual(first.output, ['First?']);
  const second = await run(source, { interactive: true, inputLines: ['Ada'] });
  assert.equal(second.status, 'waiting');
  assert.equal(second.label, 'SECOND');
  assert.deepEqual(second.output, ['First?', 'Second?']);
  const done = await run(source, { interactive: true, inputLines: ['Ada', 'Grace'] });
  assert.equal(done.status, 'completed');
  assert.deepEqual(done.output, ['First?', 'Second?', 'Ada + Grace']);
});

test('bad source reports line and execution limit', async () => {
  assert.throws(() => compile('DECLARE X INTEGER'), PseudoError);
  await assert.rejects(run('WHILE TRUE\nENDWHILE', { maxSteps: 20 }), /Execution limit/);
});

await import('./examples.test.js');
await import('./bootstrap.test.js');
