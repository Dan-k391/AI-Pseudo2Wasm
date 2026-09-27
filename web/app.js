import { parse, compile, createRuntime, PseudoError } from './src/index.js';

const $ = id => document.getElementById(id);
const editor = $('editor'), highlight = $('highlight'), gutter = $('line-numbers'), consoleContent = $('console-content');
const STORAGE = 'pseudo2wasm.project.v1';
const examples = [
  { name: 'Hello world', icon: '01', code: `// Your first CAIE pseudocode program\nDECLARE Name : STRING\nOUTPUT "What is your name?"\nINPUT Name\nOUTPUT "Hello, ", Name, "!"\n`, input: '' },
  { name: 'Loops & selection', icon: '02', code: `DECLARE Total : INTEGER\nDECLARE Number : INTEGER\n\nFOR Number ← 1 TO 10\n  IF Number MOD 2 = 0 THEN\n    Total ← Total + Number\n  ENDIF\nNEXT Number\n\nCASE OF Total\n  30 : OUTPUT "The even numbers sum to 30"\n  OTHERWISE : OUTPUT "Total: ", Total\nENDCASE\n` },
  { name: 'Arrays & records', icon: '03', code: `TYPE StudentRecord\n  DECLARE Name : STRING\n  DECLARE Score : INTEGER\nENDTYPE\n\nDECLARE Students : ARRAY[1:3] OF StudentRecord\nDECLARE Index : INTEGER\nStudents[1].Name ← "Ada"\nStudents[1].Score ← 93\nStudents[2].Name ← "Grace"\nStudents[2].Score ← 88\nStudents[3].Name ← "Alan"\nStudents[3].Score ← 91\n\nFOR Index ← 1 TO 3\n  OUTPUT Students[Index].Name, ": ", Students[Index].Score\nNEXT Index\n` },
  { name: 'Functions & BYREF', icon: '04', code: `FUNCTION Factorial(N : INTEGER) RETURNS INTEGER\n  IF N <= 1 THEN\n    RETURN 1\n  ENDIF\n  RETURN N * Factorial(N - 1)\nENDFUNCTION\n\nPROCEDURE AddOne(BYREF Value : INTEGER)\n  Value ← Value + 1\nENDPROCEDURE\n\nDECLARE Answer : INTEGER\nAnswer ← Factorial(5)\nCALL AddOne(Answer)\nOUTPUT "Answer: ", Answer\n` },
  { name: 'Virtual files', icon: '05', code: `DECLARE LineOfText : STRING\nOPENFILE "notes.txt" FOR WRITE\nWRITEFILE "notes.txt", "First line"\nWRITEFILE "notes.txt", "Second line"\nCLOSEFILE "notes.txt"\n\nOPENFILE "notes.txt" FOR READ\nWHILE NOT EOF("notes.txt")\n  READFILE "notes.txt", LineOfText\n  OUTPUT LineOfText\nENDWHILE\nCLOSEFILE "notes.txt"\n` },
  { name: 'Classes', icon: '06', code: `CLASS Counter\n  PRIVATE Value : INTEGER\n  PUBLIC PROCEDURE NEW(Start : INTEGER)\n    Value ← Start\n  ENDPROCEDURE\n  PUBLIC PROCEDURE Increment()\n    Value ← Value + 1\n  ENDPROCEDURE\n  PUBLIC FUNCTION Current() RETURNS INTEGER\n    RETURN Value\n  ENDFUNCTION\nENDCLASS\n\nDECLARE MyCounter : Counter\nMyCounter ← NEW Counter(5)\nCALL MyCounter.Increment()\nOUTPUT MyCounter.Current()\n` },
];

let project = { source: examples[0].code, input: examples[0].input, files: {}, records: {} };
let selectedFile = null, lastCompiled = null, builtSource = null, problems = [], activeConsole = 'output', consoleLines = [], buildInfo = null, timer = null, waitingInput = null, runToken = 0;
try { const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null'); if (saved && typeof saved.source === 'string') project = { source: saved.source, input: saved.input || '', files: saved.files || {}, records: saved.records || {} }; } catch {}

function save() {
  project.source = editor.value; project.input = $('stdin').value;
  try { localStorage.setItem(STORAGE, JSON.stringify(project)); $('save-state').textContent = 'Saved locally'; $('dirty-dot').hidden = true; } catch { $('save-state').textContent = 'Storage unavailable'; }
}
function scheduleSave() { $('save-state').textContent = 'Saving…'; $('dirty-dot').hidden = false; clearTimeout(timer); timer = setTimeout(save, 350); }
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tokenPattern = /\/\/[^\n]*|"(?:""|\\.|[^"])*"|'(?:''|\\.|[^'])*'|\b(?:DECLARE|CONSTANT|TYPE|ENDTYPE|DEFINE|CLASS|ENDCLASS|PUBLIC|PRIVATE|INHERITS|FUNCTION|ENDFUNCTION|PROCEDURE|ENDPROCEDURE|RETURNS|RETURN|BYREF|BYVAL|CALL|NEW|SUPER|OUTPUT|INPUT|OPENFILE|CLOSEFILE|READFILE|WRITEFILE|GETRECORD|PUTRECORD|SEEK|FOR|TO|STEP|NEXT|WHILE|ENDWHILE|REPEAT|UNTIL|IF|THEN|ELSE|ENDIF|CASE|OF|OTHERWISE|ENDCASE|AND|OR|NOT|IN|DIV|MOD|TRUE|FALSE|NULL|INTEGER|REAL|BOOLEAN|CHAR|STRING|DATE|ARRAY|SET|READ|WRITE|APPEND|RANDOM)\b|\b\d+(?:\.\d+)?\b|[←&<>+=*/^-]/gi;
const flow = new Set(['IF','THEN','ELSE','ENDIF','CASE','OF','OTHERWISE','ENDCASE','FOR','TO','STEP','NEXT','WHILE','ENDWHILE','REPEAT','UNTIL','FUNCTION','ENDFUNCTION','PROCEDURE','ENDPROCEDURE','RETURN','CALL','CLASS','ENDCLASS']);
const types = new Set(['INTEGER','REAL','BOOLEAN','CHAR','STRING','DATE','ARRAY','SET']);
function colorize(source) {
  let last = 0, html = '';
  for (const match of source.matchAll(tokenPattern)) {
    html += escape(source.slice(last, match.index));
    const value = match[0], upper = value.toUpperCase();
    const cls = value.startsWith('//') ? 'tok-comment' : value.startsWith('"') || value.startsWith("'") ? 'tok-string' : /^\d/.test(value) ? 'tok-number' : flow.has(upper) ? 'tok-flow' : types.has(upper) ? 'tok-type' : /^[A-Z_]/i.test(value) ? 'tok-key' : 'tok-op';
    html += `<span class="${cls}">${escape(value)}</span>`; last = match.index + value.length;
  }
  html += escape(source.slice(last));
  return html + '\n';
}
function renderEditor() {
  highlight.innerHTML = colorize(editor.value);
  const lines = editor.value.split('\n').length;
  gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<div class="${problems.some(p => p.line === i + 1) ? 'error-line' : ''}">${i + 1}</div>`).join('');
  $('line-count').textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  highlight.scrollTop = editor.scrollTop; highlight.scrollLeft = editor.scrollLeft; gutter.scrollTop = editor.scrollTop;
  cursorPosition();
}
function cursorPosition() {
  const before = editor.value.slice(0, editor.selectionStart), lines = before.split('\n');
  $('cursor-position').textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
}
function setProblems(items) {
  problems = items;
  $('problem-count').textContent = items.length;
  $('diagnostic-light').classList.toggle('error', items.length > 0);
  $('diagnostic-summary').textContent = items.length ? `${items.length} problem${items.length === 1 ? '' : 's'}` : 'No problems';
  renderEditor(); if (activeConsole === 'diagnostics') renderConsole();
}
function diagnose() {
  try { parse(editor.value); setProblems([]); }
  catch (e) { setProblems([{ line: e.line || 1, column: e.column || 1, message: e.message }]); }
}
function log(text, kind = 'line') { consoleLines.push({ text, kind }); $('output-count').textContent = consoleLines.filter(x => x.kind === 'line').length; if (activeConsole === 'output') renderConsole(); }
function renderConsole() {
  consoleContent.replaceChildren();
  if (activeConsole === 'output') {
    if (!consoleLines.length && !waitingInput) { const empty = document.createElement('div'); empty.className = 'empty-console'; empty.innerHTML = '<span class="terminal-glyph">›_</span><span>Run your program to see output here.</span>'; consoleContent.append(empty); return; }
    for (const item of consoleLines) { const line = document.createElement('div'); line.className = item.kind === 'error' ? 'console-line console-error' : item.kind === 'meta' ? 'console-meta' : item.kind === 'input' ? 'console-line console-input' : 'console-line'; line.textContent = item.text; consoleContent.append(line); }
    if (waitingInput) {
      const row = document.createElement('form'); row.className = 'terminal-prompt';
      const label = document.createElement('label'); label.textContent = `${waitingInput.label} · line ${waitingInput.line}`; label.htmlFor = 'terminal-input';
      const field = document.createElement('input'); field.id = 'terminal-input'; field.type = 'text'; field.autocomplete = 'off'; field.setAttribute('aria-label', `Input for ${waitingInput.label}`);
      const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Enter ↵';
      row.append(label, field, submit);
      row.addEventListener('submit', event => { event.preventDefault(); const value = field.value; const session = waitingInput.session; waitingInput = null; log(value, 'input'); session.inputLines.push(value); continueRun(session); });
      consoleContent.append(row);
    }
    consoleContent.scrollTop = consoleContent.scrollHeight;
  } else if (activeConsole === 'diagnostics') {
    if (!problems.length) { const line = document.createElement('div'); line.className = 'console-meta'; line.textContent = 'No problems found.'; consoleContent.append(line); }
    for (const p of problems) { const item = document.createElement('div'); item.className = 'problem-item'; const loc = document.createElement('strong'); loc.textContent = `Ln ${p.line}:${p.column}`; item.append(loc, document.createTextNode(p.message)); consoleContent.append(item); }
  } else {
    const info = document.createElement('div'); info.className = 'build-log';
    if (buildInfo) { info.innerHTML = `<strong>Build succeeded</strong><br>WebAssembly module: ${buildInfo.size.toLocaleString()} bytes<br>Routines: ${buildInfo.routines}<br>Imports: ${buildInfo.imports}<br>Compiled in ${buildInfo.ms.toFixed(1)} ms`; }
    else info.textContent = 'Compile to inspect the WebAssembly module.';
    consoleContent.append(info);
    if (buildInfo) {
      const projectButton = document.createElement('button'); projectButton.className = 'tiny-button'; projectButton.style.marginTop = '14px'; projectButton.textContent = 'Download project .json'; projectButton.addEventListener('click', downloadProject); consoleContent.append(projectButton);
    }
  }
}
function switchConsole(tab) {
  activeConsole = tab; document.querySelectorAll('[data-console-tab]').forEach(b => b.classList.toggle('active', b.dataset.consoleTab === tab)); renderConsole();
}
function build() {
  const start = performance.now();
  try {
    const result = compile(editor.value);
    if (!WebAssembly.validate(result.binary)) throw new Error('Generated WebAssembly module did not validate');
    const ms = performance.now() - start;
    lastCompiled = result; builtSource = editor.value; buildInfo = { size: result.binary.length, routines: result.routines.length, imports: WebAssembly.Module.imports(new WebAssembly.Module(result.binary)).length, ms };
    $('build-status').textContent = 'Build succeeded'; $('build-size').textContent = `${result.binary.length.toLocaleString()} bytes · ${ms.toFixed(1)} ms`;
    setProblems([]); return result;
  } catch (error) {
    const item = { line: error.line || 1, column: error.column || 1, message: error.message };
    lastCompiled = null; builtSource = null; buildInfo = null;
    $('build-status').textContent = 'Build failed'; $('build-size').textContent = `Line ${item.line}`;
    setProblems([item]); switchConsole('diagnostics'); return null;
  }
}
async function runProgram() {
  runToken++; waitingInput = null; consoleLines = []; $('output-count').textContent = '0'; switchConsole('output');
  const result = builtSource === editor.value && lastCompiled ? lastCompiled : build();
  if (!result) { log('Compilation failed. Open Problems for details.', 'error'); switchConsole('diagnostics'); return; }
  const preloaded = $('stdin').value.replace(/\r/g, '').replace(/\n$/, '');
  const session = { token: runToken, compiled: result, files: structuredClone(project.files), records: structuredClone(project.records || {}), inputLines: preloaded ? preloaded.split('\n') : [], printed: 0, runtimeMs: 0, seed: (Math.random() * 0x100000000) >>> 0, today: new Date().toISOString() };
  await continueRun(session);
}
async function continueRun(session) {
  if (session.token !== runToken) return;
  $('run-button').disabled = true; $('run-button').textContent = 'Running…';
  try {
    const attemptStart = performance.now();
    const runtime = createRuntime(session.compiled, { inputLines: session.inputLines, files: session.files, records: session.records, interactive: true, seed: session.seed, today: session.today, maxSteps: 250000 });
    const done = await runtime.run();
    session.runtimeMs += performance.now() - attemptStart;
    if (session.token !== runToken) return;
    for (const line of done.output.slice(session.printed)) log(line);
    session.printed = done.output.length;
    if (done.status === 'waiting') {
      waitingInput = { line: done.line, label: done.label, session };
      $('diagnostic-summary').textContent = `Waiting for ${done.label} at line ${done.line}`;
      switchConsole('output'); $('terminal-input')?.focus();
      return;
    }
    project.files = done.files; project.records = done.records; renderFiles(); save();
    log(`Program finished · ${done.steps.toLocaleString()} steps · ${session.runtimeMs.toFixed(1)} ms`, 'meta');
    setProblems([]);
  } catch (error) {
    log(`Line ${error.line || '?'}: ${error.message}`, 'error');
    setProblems([{ line: error.line || 1, column: error.column || 1, message: error.message }]);
  } finally { $('run-button').disabled = false; $('run-button').innerHTML = '<span class="play-icon">▶</span> Run program'; }
}
function downloadBlob(blob, filename) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
function downloadWasm() { const compiled = builtSource === editor.value && lastCompiled ? lastCompiled : build(); if (compiled) downloadBlob(new Blob([compiled.binary], { type: 'application/wasm' }), 'main.wasm'); }
function downloadProject() { save(); downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'pseudo2wasm-project.json'); }
function renderFiles() {
  const list = $('virtual-file-list'); list.replaceChildren();
  const names = Object.keys(project.files).sort();
  if (!names.length) { const empty = document.createElement('div'); empty.className = 'virtual-file-empty'; empty.textContent = 'No files yet. A program can create one.'; list.append(empty); }
  for (const file of names) {
    const button = document.createElement('button'); button.className = `virtual-file${selectedFile === file ? ' active' : ''}`; button.textContent = `◇  ${file}`;
    button.addEventListener('click', () => { selectedFile = file; renderFiles(); }); list.append(button);
  }
  $('file-editor-area').hidden = !selectedFile || !Object.hasOwn(project.files, selectedFile);
  if (!$('file-editor-area').hidden) { $('file-editor-label').textContent = selectedFile; $('file-editor').value = project.files[selectedFile]; }
}
function switchTool(tool) {
  document.querySelectorAll('[data-tool]').forEach(b => { const active = b.dataset.tool === tool; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active)); });
  document.querySelectorAll('.tool-pane').forEach(p => p.classList.toggle('active', p.id === `tool-${tool}`));
}
function setSource(source, input = '') { runToken++; waitingInput = null; editor.value = source; $('stdin').value = input; lastCompiled = null; builtSource = null; diagnose(); renderEditor(); save(); editor.focus(); }

for (const example of examples) {
  const button = document.createElement('button'); button.className = 'example-item';
  button.innerHTML = `<span class="example-icon">${example.icon}</span><span>${example.name}</span>`;
  button.addEventListener('click', () => { if (editor.value !== example.code && !confirm(`Load “${example.name}” into main.pseudo? Your current program is saved in this browser, but the example will replace it.`)) return; setSource(example.code, example.input || ''); });
  $('example-list').append(button);
}
editor.value = project.source; $('stdin').value = project.input; diagnose(); renderFiles();
editor.addEventListener('input', () => { if (waitingInput) { runToken++; waitingInput = null; log('Run cancelled after source edit.', 'meta'); } lastCompiled = null; builtSource = null; renderEditor(); scheduleSave(); clearTimeout(editor._diagnoseTimer); editor._diagnoseTimer = setTimeout(diagnose, 300); });
editor.addEventListener('scroll', renderEditor); editor.addEventListener('click', cursorPosition); editor.addEventListener('keyup', cursorPosition);
editor.addEventListener('keydown', event => {
  if (event.key === 'Tab') { event.preventDefault(); const a = editor.selectionStart, b = editor.selectionEnd; editor.setRangeText('  ', a, b, 'end'); editor.dispatchEvent(new Event('input')); }
  if (event.key === 'Enter') { const before = editor.value.slice(0, editor.selectionStart), indent = before.slice(before.lastIndexOf('\n') + 1).match(/^\s*/)[0]; if (indent) { event.preventDefault(); editor.setRangeText('\n' + indent, editor.selectionStart, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); } }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); runProgram(); }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); build(); switchConsole('build'); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); downloadProject(); }
});
$('stdin').addEventListener('input', scheduleSave);
$('file-editor').addEventListener('input', () => { if (selectedFile) { project.files[selectedFile] = $('file-editor').value; scheduleSave(); } });
$('add-file').addEventListener('click', () => { const filename = prompt('File name (for example, data.txt)'); if (!filename) return; if (!/^[\w. -]+$/.test(filename)) { alert('Use letters, numbers, spaces, dots, underscores, or hyphens.'); return; } project.files[filename] ??= ''; selectedFile = filename; renderFiles(); save(); });
$('remove-file').addEventListener('click', () => { if (!selectedFile || !confirm(`Delete ${selectedFile}?`)) return; delete project.files[selectedFile]; selectedFile = null; renderFiles(); save(); });
$('run-button').addEventListener('click', runProgram);
$('compile-button').addEventListener('click', () => { const result = build(); switchConsole(result ? 'build' : 'diagnostics'); });
$('download-button').addEventListener('click', downloadWasm);
$('clear-output').addEventListener('click', () => { consoleLines = []; $('output-count').textContent = '0'; renderConsole(); });
$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const content = await file.text();
    if (file.name.toLowerCase().endsWith('.json')) { const data = JSON.parse(content); if (typeof data.source !== 'string') throw new Error('Project JSON needs a source field'); project = { source: data.source, input: String(data.input || ''), files: data.files && typeof data.files === 'object' ? data.files : {}, records: data.records && typeof data.records === 'object' ? data.records : {} }; selectedFile = null; renderFiles(); setSource(project.source, project.input); }
    else setSource(content, '');
  } catch (error) { alert(`Could not open file: ${error.message}`); }
  event.target.value = '';
});
document.querySelectorAll('[data-console-tab]').forEach(b => b.addEventListener('click', () => switchConsole(b.dataset.consoleTab)));
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => switchTool(b.dataset.tool)));
renderConsole();
