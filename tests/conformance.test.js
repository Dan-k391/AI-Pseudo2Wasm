import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, createRuntime } from '../src/index.js';
import { compileSelfHosted, loadSelfHostedCompiler } from '../bootstrap/compile.js';
import { analyzeSource } from '../web/language-service.js';

const compiler = await loadSelfHostedCompiler();

// Each case is keyed to the 2026 Cambridge 9618 pseudocode guide. Compare the
// production self-hosted compiler with the independent JavaScript seed, then
// assert the expected CAIE-visible result so shared mistakes cannot pass.
const cases = [
  {
    section: '2 variables, constants and primitive types',
    source: 'CONSTANT Rate = 2.5\nDECLARE Count : INTEGER\nDECLARE Paid : REAL\nDECLARE Done : BOOLEAN\nCount ← 4\nPaid ← Count * Rate\nDone ← TRUE\nOUTPUT Paid, " ", Done\n',
    output: ['10 TRUE'],
  },
  {
    section: '3 one- and two-dimensional arrays',
    source: 'DECLARE Grid : ARRAY[1:2, 0:1] OF INTEGER\nDECLARE I : INTEGER\nI ← 1\nGrid[I + 1, 1] ← 9\nOUTPUT Grid[2, 1]\n',
    output: ['9'],
  },
  {
    section: '4 records, enumerations, pointers and sets',
    source: 'TYPE Person\n  DECLARE Age : INTEGER\nENDTYPE\nTYPE Season = (Spring, Summer)\nTYPE TIntPointer = ^INTEGER\nTYPE Letters = SET OF CHAR\nDEFINE Vowels (\'A\', \'E\') : Letters\nDECLARE P : Person\nDECLARE Ref : TIntPointer\nP.Age ← 4\nRef ← ^P.Age\nRef^ ← Ref^ + 1\nOUTPUT P.Age, " ", Spring, " ", \'A\' IN Vowels\n',
    output: ['5 SPRING TRUE'],
  },
  {
    section: '5 arithmetic, Boolean and string operations',
    source: 'OUTPUT 11 DIV 3, " ", 11 MOD 3\nOUTPUT NOT FALSE AND TRUE, " ", MID("ABCDE", 2, 2), RIGHT("ABC", 1)\n',
    output: ['3 2', 'TRUE BCC'],
  },
  {
    section: '6 and 7 selection and iteration',
    source: 'DECLARE I : INTEGER\nFOR I ← 3 TO 1 STEP -1\n  CASE OF I\n    3 : OUTPUT "three"\n    2 : OUTPUT "two"\n    OTHERWISE : OUTPUT "one"\n  ENDCASE\nNEXT I\nREPEAT\n  I ← I + 1\nUNTIL I = 2\nOUTPUT I\n',
    output: ['three', 'two', 'one', '2'],
  },
  {
    section: '8 functions, procedures and BYREF',
    source: 'FUNCTION Double(N : INTEGER) RETURNS INTEGER\n  RETURN N * 2\nENDFUNCTION\nPROCEDURE Add(BYREF N : INTEGER, Amount : INTEGER)\n  N ← N + Amount\nENDPROCEDURE\nDECLARE X : INTEGER\nX ← Double(3)\nCALL Add(X, 4)\nOUTPUT X\n',
    output: ['10'],
  },
  {
    section: '9 sequential text files',
    source: 'DECLARE Line : STRING\nOPENFILE "data.txt" FOR WRITE\nWRITEFILE "data.txt", "hello"\nCLOSEFILE "data.txt"\nOPENFILE "data.txt" FOR READ\nWHILE NOT EOF("data.txt")\n  READFILE "data.txt", Line\n  OUTPUT Line\nENDWHILE\nCLOSEFILE "data.txt"\n',
    output: ['hello'],
  },
  {
    section: '9 random record files',
    source: 'TYPE Item\n  DECLARE Code : INTEGER\nENDTYPE\nDECLARE V : Item\nOPENFILE "items.dat" FOR RANDOM\nV.Code ← 12\nSEEK "items.dat", 0\nPUTRECORD "items.dat", V\nV.Code ← 0\nSEEK "items.dat", 0\nGETRECORD "items.dat", V\nOUTPUT V.Code\nCLOSEFILE "items.dat"\n',
    output: ['12'],
  },
  {
    section: '10 classes, constructors and inheritance',
    source: 'CLASS Base\n  PUBLIC Value : INTEGER\n  PUBLIC PROCEDURE NEW(N : INTEGER)\n    Value ← N\n  ENDPROCEDURE\nENDCLASS\nCLASS Child INHERITS Base\n  PUBLIC PROCEDURE NEW(N : INTEGER)\n    SUPER.NEW(N)\n  ENDPROCEDURE\nENDCLASS\nDECLARE C : Child\nC ← NEW Child(7)\nOUTPUT C.Value\n',
    output: ['7'],
  },
  {
    section: '5.1 INPUT to an array element and record field',
    source: 'TYPE Item\n  DECLARE Value : INTEGER\nENDTYPE\nDECLARE Items : ARRAY[1:2] OF INTEGER\nDECLARE A : Item\nINPUT Items[2]\nINPUT A.Value\nOUTPUT Items[2], " ", A.Value\n',
    options: { inputLines: ['6', '8'] },
    output: ['6 8'],
  },
];

for (const entry of cases) test(`CAIE guide ${entry.section}`, async () => {
  assert.deepEqual(analyzeSource(entry.source), [], `Editor diagnostics on valid section ${entry.section}`);
  const baseline = compile(entry.source);
  const selfhosted = await compileSelfHosted(entry.source, compiler);
  assert.ok(WebAssembly.validate(selfhosted.binary));
  const options = entry.options || {};
  const seedResult = await createRuntime(baseline, options).run();
  const hostedResult = await createRuntime(selfhosted, options).run();
  assert.deepEqual(seedResult.output, entry.output);
  assert.deepEqual(hostedResult.output, entry.output);
  const release = await compileSelfHosted(entry.source, compiler, { release: true });
  const releaseResult = await createRuntime(release, options).run();
  assert.deepEqual(releaseResult.output, entry.output);
  if (!release.native) assert.equal(release.release, undefined, 'compatibility fallback retains guards');
});
