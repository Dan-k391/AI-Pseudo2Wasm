import { createRuntime } from './src/runtime.js';
import { advancedExamples } from './examples.js';
import { compileSelfHostedInBrowser } from './selfhost.js';
import { createDiagnosticCoordinator, diagnosticsFromError, mergeDiagnostics } from './compiler-diagnostics.js';
import { analyzeSource } from './language-service.js';
import { completions, diagnosticRange, diagnosticAtOffset, nextDiagnostic } from './editor-intelligence.js';
import { selectExplorerFiles, moveExplorerFiles } from './explorer-selection.js';
import { findMatches, replaceMatches } from './editor-search.js';
import { indexSource, renameSymbol } from './editor-navigation.js';
import { createEditorHistory } from './editor-history.js';

const $ = id => document.getElementById(id);
const app = document.querySelector('.app');
const consoleContent = $('console-content');
const STORAGE = 'pseudo2wasm.project.v2';
const THEMES = new Set(['pseudo', 'atom-one-dark-pro', 'dracula', 'nord', 'github-light']);
const THEME_COLORS = { pseudo: '#0d1219', 'atom-one-dark-pro': '#282c34', dracula: '#282a36', nord: '#2e3440', 'github-light': '#ffffff' };
const panes = {
  primary: { group: $('primary-group'), tabs: $('primary-tabs'), editor: $('primary-editor'), highlight: $('primary-highlight'), gutter: $('primary-gutter'), completion: $('primary-completion'), search: $('primary-search'), searchInput: $('primary-search-input'), replaceInput: $('primary-replace-input'), peek: $('primary-reference-peek'), diagnostic: $('primary-diagnostic-tooltip') },
  secondary: { group: $('secondary-group'), tabs: $('secondary-tabs'), editor: $('secondary-editor'), highlight: $('secondary-highlight'), gutter: $('secondary-gutter'), completion: $('secondary-completion'), search: $('secondary-search'), searchInput: $('secondary-search-input'), replaceInput: $('secondary-replace-input'), peek: $('secondary-reference-peek'), diagnostic: $('secondary-diagnostic-tooltip') },
};
const examples = [
  { name: 'Hello world', filename: 'hello-world.pseudo', code: `// Your first CAIE pseudocode program\nDECLARE Name : STRING\nOUTPUT "What is your name?"\nINPUT Name\nOUTPUT "Hello, ", Name, "!"\n` },
  { name: 'Loops & selection', filename: 'loops.pseudo', code: `DECLARE Total : INTEGER\nDECLARE Number : INTEGER\n\nFOR Number ← 1 TO 10\n  IF Number MOD 2 = 0 THEN\n    Total ← Total + Number\n  ENDIF\nNEXT Number\n\nCASE OF Total\n  30 : OUTPUT "The even numbers sum to 30"\n  OTHERWISE : OUTPUT "Total: ", Total\nENDCASE\n` },
  { name: 'Arrays & records', filename: 'arrays.pseudo', code: `TYPE StudentRecord\n  DECLARE Name : STRING\n  DECLARE Score : INTEGER\nENDTYPE\n\nDECLARE Students : ARRAY[1:3] OF StudentRecord\nDECLARE Index : INTEGER\nStudents[1].Name ← "Ada"\nStudents[1].Score ← 93\nStudents[2].Name ← "Grace"\nStudents[2].Score ← 88\nStudents[3].Name ← "Alan"\nStudents[3].Score ← 91\n\nFOR Index ← 1 TO 3\n  OUTPUT Students[Index].Name, ": ", Students[Index].Score\nNEXT Index\n` },
  { name: 'Functions & BYREF', filename: 'functions.pseudo', code: `FUNCTION Factorial(N : INTEGER) RETURNS INTEGER\n  IF N <= 1 THEN\n    RETURN 1\n  ENDIF\n  RETURN N * Factorial(N - 1)\nENDFUNCTION\n\nPROCEDURE AddOne(BYREF Value : INTEGER)\n  Value ← Value + 1\nENDPROCEDURE\n\nDECLARE Answer : INTEGER\nAnswer ← Factorial(5)\nCALL AddOne(Answer)\nOUTPUT "Answer: ", Answer\n` },
  { name: 'Virtual files', filename: 'files.pseudo', code: `DECLARE LineOfText : STRING\nOPENFILE "notes.txt" FOR WRITE\nWRITEFILE "notes.txt", "First line"\nWRITEFILE "notes.txt", "Second line"\nCLOSEFILE "notes.txt"\n\nOPENFILE "notes.txt" FOR READ\nWHILE NOT EOF("notes.txt")\n  READFILE "notes.txt", LineOfText\n  OUTPUT LineOfText\nENDWHILE\nCLOSEFILE "notes.txt"\n` },
  { name: 'Classes', filename: 'classes.pseudo', code: `CLASS Counter\n  PRIVATE Value : INTEGER\n  PUBLIC PROCEDURE NEW(Start : INTEGER)\n    Value ← Start\n  ENDPROCEDURE\n  PUBLIC PROCEDURE Increment()\n    Value ← Value + 1\n  ENDPROCEDURE\n  PUBLIC FUNCTION Current() RETURNS INTEGER\n    RETURN Value\n  ENDFUNCTION\nENDCLASS\n\nDECLARE MyCounter : Counter\nMyCounter ← NEW Counter(5)\nCALL MyCounter.Increment()\nOUTPUT MyCounter.Current()\n` },
  ...advancedExamples,
];
const compilerExamples = [
  { filename: 'core.pseudo', description: 'Source to stack IR' },
  { filename: 'native.pseudo', description: 'IR to native WebAssembly' },
  { filename: 'assembler.pseudo', description: 'IR to compatibility WebAssembly' },
];

function normalizeProject(raw) {
  const sourceFiles = raw?.sourceFiles && typeof raw.sourceFiles === 'object' ? { ...raw.sourceFiles } : { 'main.pseudo': typeof raw?.source === 'string' ? raw.source : examples[0].code };
  const names = Object.keys(sourceFiles);
  if (!names.length) sourceFiles['main.pseudo'] = examples[0].code;
  const fileOrder = [...new Set([...(Array.isArray(raw?.fileOrder) ? raw.fileOrder : []), ...Object.keys(sourceFiles)])].filter(name => Object.hasOwn(sourceFiles, name));
  const first = Object.keys(sourceFiles)[0];
  const oldPanes = raw?.panes || {};
  const primaryTabs = (oldPanes.primary?.tabs || [first]).filter(n => Object.hasOwn(sourceFiles, n));
  const secondaryTabs = (oldPanes.secondary?.tabs || []).filter(n => Object.hasOwn(sourceFiles, n));
  const primaryActive = primaryTabs.includes(oldPanes.primary?.active) ? oldPanes.primary.active : primaryTabs[0] || null;
  const secondaryActive = secondaryTabs.includes(oldPanes.secondary?.active) ? oldPanes.secondary.active : secondaryTabs[0] || null;
  const layout = raw?.layout || {};
  return {
    sourceFiles, fileOrder, panes: { primary: { tabs: primaryTabs, active: primaryActive }, secondary: { tabs: secondaryTabs, active: secondaryActive } },
    theme: THEMES.has(raw?.theme) ? raw.theme : 'pseudo',
    breakpoints: Object.fromEntries(Object.entries(raw?.breakpoints || {}).map(([name, lines]) => [name, Array.isArray(lines) ? [...new Set(lines.filter(line => Number.isInteger(line) && line > 0))] : []])),
    activePane: raw?.activePane === 'secondary' && secondaryActive ? 'secondary' : 'primary',
    split: !!raw?.split && !!secondaryActive,
    input: String(raw?.input || ''), releaseBuild: !!raw?.releaseBuild, optimizationLevel: raw?.optimizationLevel === 'standard' ? 'standard' : 'speed', files: raw?.files && typeof raw.files === 'object' ? raw.files : {}, records: raw?.records && typeof raw.records === 'object' ? raw.records : {},
    layout: { explorerWidth: Number(layout.explorerWidth) || (innerWidth < 800 ? 180 : 218), toolsWidth: Number(layout.toolsWidth) || 292, bottomHeight: Number(layout.bottomHeight) || 230, splitRatio: Number(layout.splitRatio) || 50, explorerVisible: layout.explorerVisible ?? innerWidth > 660, toolsVisible: layout.toolsVisible ?? innerWidth > 1100, terminalVisible: layout.terminalVisible ?? true },
  };
}
let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORAGE) || localStorage.getItem('pseudo2wasm.project.v1') || 'null'); } catch {}
let project = normalizeProject(saved);
function applyTheme() {
  document.documentElement.dataset.theme = project.theme;
  $('theme-select').value = project.theme;
  document.querySelector('meta[name="theme-color"]').content = THEME_COLORS[project.theme];
}
applyTheme();
let selectedDataFile = null, lastCompiled = null, builtFile = null, builtSource = null, builtRequestedRelease = false, builtOptimization = null, buildInfo = null;
let problemsByFile = {}, activeConsole = 'output', consoleLines = [], waitingInput = null, runToken = 0, saveTimer = null, diagnoseTimer = null;
let debugSession = null;
let draggedFile = null;
let selectedFiles = [], selectionAnchor = null;
let referenceQuery = null;
const navigationHistory = [];
const editHistory = createEditorHistory();
const navigationIndexes = new Map();

const activeName = () => project.panes[project.activePane].active;
const activeSource = () => project.sourceFiles[activeName()] ?? '';
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tokenPattern = /\/\/[^\n]*|"(?:""|\\.|[^"])*"|'(?:''|\\.|[^'])*'|\b(?:DECLARE|CONSTANT|TYPE|ENDTYPE|DEFINE|CLASS|ENDCLASS|PUBLIC|PRIVATE|INHERITS|FUNCTION|ENDFUNCTION|PROCEDURE|ENDPROCEDURE|RETURNS|RETURN|BYREF|BYVAL|CALL|NEW|SUPER|OUTPUT|INPUT|OPENFILE|CLOSEFILE|READFILE|WRITEFILE|GETRECORD|PUTRECORD|SEEK|FOR|TO|STEP|NEXT|WHILE|ENDWHILE|REPEAT|UNTIL|IF|THEN|ELSE|ENDIF|CASE|OF|OTHERWISE|ENDCASE|AND|OR|NOT|IN|DIV|MOD|TRUE|FALSE|NULL|INTEGER|REAL|BOOLEAN|CHAR|STRING|DATE|ARRAY|SET|READ|WRITE|APPEND|RANDOM)\b|\b\d+(?:\.\d+)?\b|[←&<>+=*/^-]/gi;
const flow = new Set(['IF','THEN','ELSE','ENDIF','CASE','OF','OTHERWISE','ENDCASE','FOR','TO','STEP','NEXT','WHILE','ENDWHILE','REPEAT','UNTIL','FUNCTION','ENDFUNCTION','PROCEDURE','ENDPROCEDURE','RETURN','CALL','CLASS','ENDCLASS']);
const types = new Set(['INTEGER','REAL','BOOLEAN','CHAR','STRING','DATE','ARRAY','SET']);
function colorize(source, issues = [], matches = [], current = -1, navigationRange = null) {
  const ranges = issues.map(issue => diagnosticRange(source, issue)).filter(Boolean);
  let last = 0, html = '', matchCursor = 0;
  const segment = (value, offset, cls = '') => {
    const cuts = [0, value.length];
    for (const [start, end] of ranges) { if (start > offset && start < offset + value.length) cuts.push(start - offset); if (end > offset && end < offset + value.length) cuts.push(end - offset); }
    if (navigationRange) for (const point of navigationRange) if (point > offset && point < offset + value.length) cuts.push(point - offset);
    while (matches[matchCursor]?.end <= offset) matchCursor++;
    for (let j = matchCursor; j < matches.length && matches[j].start < offset + value.length; j++) {
      const match = matches[j];
      if (match.start > offset) cuts.push(match.start - offset);
      if (match.end < offset + value.length) cuts.push(match.end - offset);
    }
    cuts.sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1]; if (a === b) continue;
      const error = ranges.some(([start, end]) => offset + a >= start && offset + a < end);
      while (matches[matchCursor]?.end <= offset + a) matchCursor++;
      const matchIndex = matches[matchCursor]?.start <= offset + a ? matchCursor : -1;
      const link = navigationRange && offset + a >= navigationRange[0] && offset + a < navigationRange[1];
      const classes = [cls, error ? 'editor-error-underline' : '', matchIndex < 0 ? '' : matchIndex === current ? 'search-current' : 'search-match', link ? 'navigation-link' : ''].filter(Boolean).join(' ');
      html += classes ? `<span class="${classes}">${escape(value.slice(a, b))}</span>` : escape(value.slice(a, b));
    }
  };
  for (const match of source.matchAll(tokenPattern)) {
    segment(source.slice(last, match.index), last);
    const value = match[0], upper = value.toUpperCase();
    const cls = value.startsWith('//') ? 'tok-comment' : value.startsWith('"') || value.startsWith("'") ? 'tok-string' : /^\d/.test(value) ? 'tok-number' : flow.has(upper) ? 'tok-flow' : types.has(upper) ? 'tok-type' : /^[A-Z_]/i.test(value) ? 'tok-key' : 'tok-op';
    segment(value, match.index, cls); last = match.index + value.length;
  }
  segment(source.slice(last), last);
  return html + '\n';
}
function save() {
  project.input = $('stdin').value;
  try { localStorage.setItem(STORAGE, JSON.stringify(project)); $('save-state').textContent = 'Saved locally'; } catch { $('save-state').textContent = 'Storage unavailable'; }
}
function scheduleSave() { $('save-state').textContent = 'Saving…'; clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }
function showToast(message) {
  const toast = document.createElement('div'); toast.className = 'workspace-toast'; toast.textContent = message;
  $('toast-container').append(toast);
  setTimeout(() => toast.remove(), 4500);
}
function showWorkspaceDialog({ title, description, label, value = '', submitLabel = 'Save', danger = false, validate, onSubmit }) {
  hideContextMenu();
  const dialog = $('workspace-dialog'), form = $('workspace-dialog-form'), input = $('dialog-input'), error = $('dialog-error');
  const previousFocus = document.activeElement;
  $('dialog-title').textContent = title;
  $('dialog-description').textContent = description || '';
  $('dialog-description').hidden = !description;
  $('dialog-input-label').textContent = label || '';
  $('dialog-input-label').hidden = !label;
  input.hidden = !label; input.value = value;
  error.hidden = true; error.textContent = '';
  $('dialog-submit').textContent = submitLabel;
  $('dialog-submit').classList.toggle('danger', danger);
  form.onsubmit = event => {
    event.preventDefault();
    const result = label ? input.value.trim() : null;
    const problem = validate?.(result);
    if (problem) { error.textContent = problem; error.hidden = false; input.focus(); return; }
    dialog.close(); onSubmit(result);
  };
  dialog.onclose = () => { form.onsubmit = null; previousFocus?.focus?.(); };
  dialog.showModal();
  if (label) { input.focus(); input.select(); } else $('dialog-submit').focus();
}
function hideContextMenu(restoreFocus = false) {
  const menu = $('editor-context-menu');
  if (menu.hidden) return;
  menu.hidden = true; menu.replaceChildren();
  if (restoreFocus) menu._invoker?.focus?.();
  menu._invoker = null;
}
function closeOtherTabs(which, name) {
  const state = project.panes[which]; state.tabs = [name]; state.active = name; project.activePane = which;
  renderWorkspace(); scheduleSave();
}
function closeTabsToRight(which, name) {
  const state = project.panes[which], index = state.tabs.indexOf(name);
  if (index < 0) return;
  state.tabs = state.tabs.slice(0, index + 1); state.active = name; project.activePane = which;
  renderWorkspace(); scheduleSave();
}
function duplicateSource(name, which = project.activePane) {
  const copy = uniqueFilename(name); project.sourceFiles[copy] = project.sourceFiles[name];
  project.fileOrder = insertFileAt(project.fileOrder, copy, name, true);
  selectedFiles = [copy]; selectionAnchor = copy;
  openSource(copy, which);
}
function selectedSourceNames() { return project.fileOrder.filter(name => selectedFiles.includes(name) && Object.hasOwn(project.sourceFiles, name)); }
function selectSource(name, options = {}) {
  const next = selectExplorerFiles(project.fileOrder, selectedFiles, selectionAnchor || activeName(), name, options);
  selectedFiles = next.selected; selectionAnchor = next.anchor;
  updateExplorerSelection();
}
function updateExplorerSelection() {
  document.querySelectorAll('#source-list .source-item').forEach(item => {
    const selected = selectedFiles.includes(item.dataset.file);
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  const count = selectedSourceNames().length;
  $('source-drag-hint').textContent = count > 1 ? `${count} files selected · drag together or use the actions below` : 'Ctrl+click to select many · Shift+click for a range';
  $('open-selected').hidden = count < 2;
  $('rename-source').disabled = count > 1;
  $('delete-source').textContent = count > 1 ? `Delete ${count}` : 'Delete';
}
function openSources(names, which = project.activePane, active = names.at(-1)) {
  names = names.filter(name => Object.hasOwn(project.sourceFiles, name));
  if (!names.length) return;
  if (which === 'secondary') project.split = true;
  const state = project.panes[which];
  for (const name of names) if (!state.tabs.includes(name)) state.tabs.push(name);
  state.active = names.includes(active) ? active : names.at(-1);
  project.activePane = which;
  renderWorkspace(); scheduleSave(); panes[which].editor.focus();
}
function duplicateSources(names) {
  const copies = [];
  for (const name of names) {
    const copy = uniqueFilename(name); project.sourceFiles[copy] = project.sourceFiles[name];
    project.fileOrder = insertFileAt(project.fileOrder, copy, name, true); copies.push(copy);
  }
  selectedFiles = copies; selectionAnchor = copies[0] || null;
  openSources(copies);
}
function downloadSource(name) { downloadBlob(new Blob([project.sourceFiles[name]], { type: 'text/plain;charset=utf-8' }), name); }
function showFileContextMenu(event, name, which = null) {
  if (!Object.hasOwn(project.sourceFiles, name)) return;
  event.preventDefault(); event.stopPropagation(); hideContextMenu();
  if (!which && !selectedFiles.includes(name)) selectSource(name);
  const menu = $('editor-context-menu'); menu._invoker = event.currentTarget; menu.setAttribute('aria-label', 'File actions');
  const addAction = (label, action, { danger = false, disabled = false } = {}) => {
    const button = document.createElement('button'); button.type = 'button'; button.role = 'menuitem'; button.textContent = label;
    button.disabled = disabled; button.className = danger ? 'context-danger' : '';
    button.addEventListener('click', () => { hideContextMenu(true); action(); }); menu.append(button);
  };
  const divider = () => { const line = document.createElement('div'); line.className = 'context-divider'; line.role = 'separator'; menu.append(line); };
  const selection = !which ? selectedSourceNames() : [];
  if (selection.length > 1) {
    addAction(`Open ${selection.length} Selected`, () => openSources(selection));
    addAction('Open Selected to Side', () => openSources(selection, project.activePane === 'primary' ? 'secondary' : 'primary'));
    divider();
    addAction('Duplicate Selected', () => duplicateSources(selection));
    divider();
    addAction(`Delete ${selection.length} Selected`, () => deleteSources(selection), { danger: true });
  } else {
  if (which) {
    const tabs = project.panes[which].tabs, index = tabs.indexOf(name);
    addAction('Close', () => closeTab(which, name));
    addAction('Close Others', () => closeOtherTabs(which, name), { disabled: tabs.length < 2 });
    addAction('Close to the Right', () => closeTabsToRight(which, name), { disabled: index === tabs.length - 1 });
    divider();
  } else addAction('Open', () => openSource(name));
  addAction(which ? 'Open in Other Editor' : 'Open to Side', () => openSource(name, which ? (which === 'primary' ? 'secondary' : 'primary') : (project.activePane === 'primary' ? 'secondary' : 'primary')));
  divider();
  addAction('Rename', () => renameSource(name));
  addAction('Duplicate', () => duplicateSource(name, which || project.activePane));
  addAction('Download .pseudo', () => downloadSource(name));
  divider();
  addAction('Delete', () => deleteSource(name), { danger: true });
  }
  menu.hidden = false;
  const anchor = event.currentTarget.getBoundingClientRect(), x = event.clientX || anchor.left + 16, y = event.clientY || anchor.bottom;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}
function showEditorContextMenu(event, which) {
  event.preventDefault(); event.stopPropagation(); hideCompletions(which); hideContextMenu();
  const pane = panes[which], editor = pane.editor, menu = $('editor-context-menu'); menu.setAttribute('aria-label', 'Editor actions');
  const file = project.panes[which].active;
  if (!file) return;
  const start = editor.selectionStart, end = editor.selectionEnd;
  const targetOffset = event.clientX && event.clientY ? editorOffsetAtPoint(which, event.clientX, event.clientY) : start;
  const target = navigationTarget(which, targetOffset);
  menu._invoker = editor;
  const action = (label, shortcut, run, disabled = false) => {
    const button = document.createElement('button'); button.type = 'button'; button.role = 'menuitem'; button.className = 'menu-action'; button.disabled = disabled;
    const title = document.createElement('span'); title.textContent = label;
    const key = document.createElement('span'); key.className = 'menu-shortcut'; key.textContent = shortcut;
    button.append(title, key); button.addEventListener('click', () => { hideContextMenu(); run(); }); menu.append(button);
  };
  const divider = () => { const line = document.createElement('div'); line.className = 'context-divider'; line.role = 'separator'; menu.append(line); };
  action('Undo', 'Ctrl+Z', () => changeHistory(which, 'undo'), !editHistory.canUndo(file));
  action('Redo', 'Ctrl+Shift+Z', () => changeHistory(which, 'redo'), !editHistory.canRedo(file));
  divider();
  action('Cut', 'Ctrl+X', async () => {
    try { await navigator.clipboard.writeText(editor.value.slice(start, end)); editor.focus(); rememberEdit(which); editor.setRangeText('', start, end, 'start'); editor.dispatchEvent(new Event('input', { bubbles: true })); }
    catch { showToast('Clipboard access is unavailable.'); }
  }, start === end);
  action('Copy', 'Ctrl+C', async () => { try { await navigator.clipboard.writeText(editor.value.slice(start, end)); editor.focus(); } catch { showToast('Clipboard access is unavailable.'); } }, start === end);
  action('Paste', 'Ctrl+V', async () => {
    try { const value = await navigator.clipboard.readText(); editor.focus(); rememberEdit(which); editor.setRangeText(value, start, end, 'end'); editor.dispatchEvent(new Event('input', { bubbles: true })); }
    catch { showToast('Clipboard access is unavailable. Use Ctrl+V instead.'); }
  });
  action('Select All', 'Ctrl+A', () => { editor.focus(); editor.select(); });
  divider();
  action('Find', 'Ctrl+F', () => showSearch(which));
  action('Replace', 'Ctrl+H', () => showSearch(which, true));
  action('Toggle Line Comment', 'Ctrl+/', () => { editor.focus(); editLines(which, 'comment'); });
  action('Toggle Breakpoint', 'F9', () => toggleBreakpoint(file, editor.value.slice(0, targetOffset).split('\n').length));
  divider();
  action('Go to Definition', 'F12', () => { editor.focus(); goToDefinition(which, targetOffset); }, !target);
  action('Find References', 'Shift+F12', () => { editor.focus(); showReferences(which, targetOffset); }, !target);
  action('Rename Symbol', 'F2', () => { editor.focus(); renameEditorSymbol(which, targetOffset); }, !target);
  menu.hidden = false;
  const rect = editor.getBoundingClientRect(), x = event.clientX || rect.left + 36, y = event.clientY || rect.top + 36;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}
function installContextMenu() {
  const menu = $('editor-context-menu');
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target)) hideContextMenu(); });
  window.addEventListener('resize', () => hideContextMenu());
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); hideContextMenu(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); hideContextMenu(true); } });
}
function applyLayout() {
  const l = project.layout;
  const explorerWidth = l.explorerVisible && innerWidth > 660 ? Math.min(l.explorerWidth, Math.max(150, innerWidth - 400)) : 0;
  const toolsWidth = l.toolsVisible && innerWidth > 1100 ? Math.min(l.toolsWidth, Math.max(220, innerWidth - explorerWidth - 450)) : 0;
  app.style.setProperty('--explorer-width', `${explorerWidth}px`);
  app.style.setProperty('--left-handle', `${explorerWidth ? 5 : 0}px`);
  app.style.setProperty('--tools-width', `${toolsWidth}px`);
  app.style.setProperty('--right-handle', `${toolsWidth ? 5 : 0}px`);
  app.style.setProperty('--tools-panel-width', `${l.toolsWidth}px`);
  app.style.setProperty('--bottom-height', `${l.terminalVisible ? l.bottomHeight : 0}px`);
  app.style.setProperty('--bottom-handle', `${l.terminalVisible ? 5 : 0}px`);
  app.style.setProperty('--split-ratio', `${l.splitRatio}%`);
  app.classList.toggle('explorer-hidden', !l.explorerVisible);
  app.classList.toggle('tools-hidden', !l.toolsVisible);
  app.classList.toggle('tools-opened', l.toolsVisible);
  app.classList.toggle('terminal-hidden', !l.terminalVisible);
  $('toggle-explorer').classList.toggle('active', l.explorerVisible);
  $('toggle-tools').classList.toggle('active', l.toolsVisible);
  $('toggle-terminal').classList.toggle('active', l.terminalVisible);
  $('toggle-explorer').setAttribute('aria-pressed', String(l.explorerVisible));
  $('toggle-tools').setAttribute('aria-pressed', String(l.toolsVisible));
  $('toggle-terminal').setAttribute('aria-pressed', String(l.terminalVisible));
}
function renderExplorer() {
  const list = $('source-list'); list.replaceChildren();
  project.fileOrder = [...new Set([...project.fileOrder, ...Object.keys(project.sourceFiles)])].filter(name => Object.hasOwn(project.sourceFiles, name));
  const names = project.fileOrder;
  selectedFiles = selectedFiles.filter(name => names.includes(name));
  if (selectionAnchor && !names.includes(selectionAnchor)) selectionAnchor = null;
  $('source-count').textContent = String(names.length).padStart(2, '0');
  for (const name of names) {
    const item = document.createElement('button'); item.className = `source-item${name === activeName() ? ' active' : ''}`; item.title = `Open ${name}. Ctrl+click to toggle selection, Shift+click to select a range. Drag selected files together.`; item.draggable = true; item.dataset.file = name;
    const glyph = document.createElement('span'); glyph.className = 'file-glyph'; glyph.textContent = '◇';
    const label = document.createElement('span'); label.className = 'source-item-name'; label.textContent = name;
    item.append(glyph, label);
    if (project.panes.primary.tabs.includes(name) || project.panes.secondary.tabs.includes(name)) { const dot = document.createElement('span'); dot.className = 'open-indicator'; dot.textContent = '●'; item.append(dot); }
    item.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) { selectSource(name, { shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey }); return; }
      selectSource(name);
      openSource(name, event.altKey ? (project.activePane === 'primary' ? 'secondary' : 'primary') : project.activePane);
    });
    item.addEventListener('contextmenu', event => showFileContextMenu(event, name));
    item.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showFileContextMenu(event, name);
      else if (event.key === 'Escape') { event.preventDefault(); selectedFiles = []; selectionAnchor = null; updateExplorerSelection(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectedFiles = [...project.fileOrder]; selectionAnchor = name; updateExplorerSelection(); }
      else if (event.key === ' ' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); selectSource(name, { toggle: true }); }
    });
    item.addEventListener('dragstart', event => beginFileDrag(event, name, null));
    list.append(item);
  }
  updateExplorerSelection();
}
function renderTabs(which) {
  const state = project.panes[which], root = panes[which].tabs; root.replaceChildren();
  for (const name of state.tabs) {
    const tab = document.createElement('div'); tab.className = `source-tab${state.active === name ? ' active' : ''}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.active === name)); tab.tabIndex = 0; tab.title = `Drag to reorder or move ${name} to another editor`; tab.draggable = true; tab.dataset.file = name;
    const glyph = document.createElement('span'); glyph.className = 'file-glyph'; glyph.textContent = '◇';
    const label = document.createElement('span'); label.className = 'source-tab-name'; label.textContent = name;
    const close = document.createElement('button'); close.className = 'tab-close'; close.type = 'button'; close.setAttribute('aria-label', `Close ${name} in ${which} editor`); close.textContent = '×';
    close.addEventListener('click', event => { event.stopPropagation(); closeTab(which, name); });
    tab.addEventListener('auxclick', event => { if (event.button === 1) { event.preventDefault(); event.stopPropagation(); closeTab(which, name); } });
    tab.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); });
    tab.addEventListener('click', () => openSource(name, which));
    tab.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showFileContextMenu(event, name, which); else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSource(name, which); } });
    tab.addEventListener('contextmenu', event => showFileContextMenu(event, name, which));
    tab.addEventListener('dragstart', event => beginFileDrag(event, name, which));
    tab.append(glyph, label, close); root.append(tab);
  }
}
function renderCode(which) {
  const pane = panes[which], name = project.panes[which].active;
  if (pane.renderedFile !== name) { pane.renderedFile = name; pane.navHover = null; pane.peek.hidden = true; hideDiagnostic(which); pane.editor.classList.remove('navigation-ready'); }
  pane.group.classList.toggle('empty', !name);
  if (!name) { pane.editor.value = ''; pane.highlight.textContent = ''; pane.gutter.textContent = ''; return; }
  const source = project.sourceFiles[name] ?? '';
  if (pane.editor.value !== source) pane.editor.value = source;
  const errors = problemsByFile[name] || [];
  const breakpoints = new Set(project.breakpoints[name] || []);
  const pausedLine = debugSession?.filename === name && debugSession.status === 'paused' ? debugSession.line : null;
  const searchState = pane.searchState;
  if (searchState && !pane.search.hidden) updateSearch(which, false);
  pane.highlight.innerHTML = colorize(source, errors, searchState && !pane.search.hidden ? searchState.matches : [], searchState?.current ?? -1, pane.navHover);
  pane.gutter.innerHTML = Array.from({ length: source.split('\n').length }, (_, i) => {
    const line = i + 1, breakpoint = breakpoints.has(line), paused = pausedLine === line;
    return `<div class="gutter-line${errors.some(p => p.line === line) ? ' error-line' : ''}${paused ? ' debug-line' : ''}"><button class="gutter-button${breakpoint ? ' has-breakpoint' : ''}" type="button" data-breakpoint-line="${line}" aria-label="${breakpoint ? 'Remove' : 'Add'} breakpoint at line ${line}" aria-pressed="${breakpoint}" tabindex="-1"><span class="gutter-marker">${paused ? '▶' : breakpoint ? '●' : ''}</span><span>${line}</span></button></div>`;
  }).join('');
  pane.highlight.scrollTop = pane.editor.scrollTop; pane.highlight.scrollLeft = pane.editor.scrollLeft; pane.gutter.scrollTop = pane.editor.scrollTop;
}
function updateStatus() {
  const name = activeName(), source = activeSource(), editor = panes[project.activePane].editor;
  $('active-file-label').textContent = name || 'No file open'; $('status-file').textContent = name || 'No file';
  const before = editor.value.slice(0, editor.selectionStart), lines = before.split('\n');
  $('cursor-position').textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
  const count = source.split('\n').length; $('line-count').textContent = `${count} ${count === 1 ? 'line' : 'lines'}`;
  const problems = problemsByFile[name] || []; $('problem-count').textContent = problems.length;
  $('diagnostic-light').classList.toggle('error', problems.length > 0);
  $('diagnostic-summary').textContent = waitingInput ? `Waiting for ${waitingInput.label} at line ${waitingInput.line}` : debugSession?.status === 'paused' && debugSession.filename === name ? `Paused at line ${debugSession.line} · step ${debugSession.pausedStep}` : problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'} in ${name}` : 'No problems';
}
function toggleBreakpoint(name, line) {
  if (!name || !Number.isInteger(line) || line < 1) return;
  const lines = new Set(project.breakpoints[name] || []);
  if (lines.has(line)) lines.delete(line); else lines.add(line);
  project.breakpoints[name] = [...lines].sort((a, b) => a - b);
  for (const which of ['primary', 'secondary']) if (project.panes[which].active === name) renderCode(which);
  if (activeConsole === 'debug') renderConsole();
  scheduleSave();
}
function renderWorkspace() {
  for (const which of ['primary', 'secondary']) hideCompletions(which);
  applyLayout(); renderExplorer();
  $('secondary-group').hidden = !project.split; $('split-resizer').hidden = !project.split; $('close-split').hidden = !project.split;
  $('primary-group').classList.toggle('primary-split', project.split);
  for (const which of ['primary', 'secondary']) {
    panes[which].group.classList.toggle('active-group', project.activePane === which);
    renderTabs(which); renderCode(which);
  }
  updateStatus(); if (activeConsole === 'diagnostics') renderConsole();
}
function setActivePane(which) {
  if (which === 'secondary' && !project.split) return;
  project.activePane = which;
  for (const id of ['primary', 'secondary']) { panes[id].group.classList.toggle('active-group', id === which); renderTabs(id); }
  renderExplorer(); updateStatus(); if (activeConsole === 'diagnostics') renderConsole(); scheduleSave();
}
function openSource(name, which = project.activePane) {
  if (!Object.hasOwn(project.sourceFiles, name)) return;
  if (which === 'secondary') project.split = true;
  const state = project.panes[which]; if (!state.tabs.includes(name)) state.tabs.push(name);
  state.active = name; project.activePane = which;
  renderWorkspace(); scheduleSave(); panes[which].editor.focus();
}
function openExampleSource(filename, code) {
  const name = uniqueFilename(filename);
  project.sourceFiles[name] = code;
  openSource(name);
  const pane = panes[project.activePane];
  pane.editor.setSelectionRange(0, 0);
  pane.editor.scrollTop = pane.editor.scrollLeft = 0;
  pane.highlight.scrollTop = pane.highlight.scrollLeft = pane.gutter.scrollTop = 0;
  updateStatus();
}
function insertFileAt(list, name, target, after) {
  if (target === name && list.includes(name)) return list;
  const next = list.filter(item => item !== name);
  const index = target ? next.indexOf(target) : -1;
  next.splice(index < 0 ? next.length : index + Number(after), 0, name);
  return next;
}
function beginFileDrag(event, name, fromPane) {
  if (!event.dataTransfer || !Object.hasOwn(project.sourceFiles, name)) return;
  if (!fromPane && !selectedFiles.includes(name)) selectSource(name);
  const names = fromPane ? [name] : selectedSourceNames();
  draggedFile = { name, names, fromPane };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', names.join('\n'));
  event.currentTarget.classList.add('dragging-source');
  $('editor-area').classList.add('dragging-file');
}
function clearDropFeedback() {
  document.querySelectorAll('.drop-before, .drop-after, .drop-target, .drop-split').forEach(node => node.classList.remove('drop-before', 'drop-after', 'drop-target', 'drop-split'));
}
function endFileDrag() {
  draggedFile = null;
  clearDropFeedback();
  $('editor-area').classList.remove('dragging-file');
  document.querySelectorAll('.dragging-source').forEach(node => node.classList.remove('dragging-source'));
}
function placeFileInEditor(name, which, target = null, after = true, fromPane = null) {
  if (!Object.hasOwn(project.sourceFiles, name)) return;
  if (fromPane) {
    const source = project.panes[fromPane], oldIndex = source.tabs.indexOf(name);
    if (fromPane !== which && oldIndex >= 0) {
      source.tabs.splice(oldIndex, 1);
      if (source.active === name) source.active = source.tabs[Math.min(oldIndex, source.tabs.length - 1)] || null;
    }
  }
  const destination = project.panes[which];
  destination.tabs = insertFileAt(destination.tabs, name, target, after);
  destination.active = name;
  project.activePane = which;
  if (which === 'secondary') project.split = true;
  else if (fromPane === 'secondary' && !project.panes.secondary.tabs.length) project.split = false;
  renderWorkspace(); scheduleSave();
}
function placeFilesInEditor(names, which, active, target = null, after = true) {
  names = project.fileOrder.filter(name => names.includes(name) && Object.hasOwn(project.sourceFiles, name));
  if (!names.length) return;
  const destination = project.panes[which];
  destination.tabs = destination.tabs.filter(name => !names.includes(name));
  const targetIndex = target ? destination.tabs.indexOf(target) : -1;
  destination.tabs.splice(targetIndex < 0 ? destination.tabs.length : targetIndex + Number(after), 0, ...names);
  destination.active = names.includes(active) ? active : names.at(-1);
  project.activePane = which;
  if (which === 'secondary') project.split = true;
  renderWorkspace(); scheduleSave(); panes[which].editor.focus();
}
function editorDropPosition(event) {
  const tab = event.target.closest('.source-tab');
  const group = event.target.closest('.editor-group');
  let which = group?.id === 'secondary-group' ? 'secondary' : 'primary';
  if (!project.split && !tab) {
    const rect = $('editor-area').getBoundingClientRect();
    if (event.clientX > rect.left + rect.width * .68) which = 'secondary';
  }
  const rect = tab?.getBoundingClientRect();
  return { which, target: tab?.dataset.file || null, after: rect ? event.clientX >= rect.left + rect.width / 2 : true };
}
function installFileDragTargets() {
  const list = $('source-list'), area = $('editor-area');
  list.addEventListener('dragover', event => {
    if (!draggedFile) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; clearDropFeedback();
    const item = event.target.closest('.source-item');
    if (item) { const rect = item.getBoundingClientRect(); item.classList.add(event.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after'); }
    else list.classList.add('drop-target');
  });
  list.addEventListener('drop', event => {
    if (!draggedFile) return;
    event.preventDefault();
    const item = event.target.closest('.source-item'), rect = item?.getBoundingClientRect();
    project.fileOrder = moveExplorerFiles(project.fileOrder, draggedFile.names, item?.dataset.file, rect ? event.clientY >= rect.top + rect.height / 2 : true);
    endFileDrag(); renderExplorer(); scheduleSave();
  });
  area.addEventListener('dragover', event => {
    if (!draggedFile) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; clearDropFeedback();
    const position = editorDropPosition(event);
    if (position.target) event.target.closest('.source-tab').classList.add(position.after ? 'drop-after' : 'drop-before');
    else if (position.which === 'secondary' && !project.split) area.classList.add('drop-split');
    else panes[position.which].group.classList.add('drop-target');
  });
  area.addEventListener('drop', event => {
    if (!draggedFile) return;
    event.preventDefault();
    const position = editorDropPosition(event), { name, names, fromPane } = draggedFile;
    endFileDrag();
    if (fromPane) placeFileInEditor(name, position.which, position.target, position.after, fromPane);
    else placeFilesInEditor(names, position.which, name, position.target, position.after);
  });
  document.addEventListener('dragend', endFileDrag);
}
function closeTab(which, name) {
  const state = project.panes[which], index = state.tabs.indexOf(name);
  if (index < 0) return;
  state.tabs.splice(index, 1);
  if (state.active === name) state.active = state.tabs[Math.min(index, state.tabs.length - 1)] || null;
  if (which === 'secondary' && !state.tabs.length) { project.split = false; project.activePane = 'primary'; }
  else if (project.activePane === which && !state.active) project.activePane = which === 'primary' && project.split ? 'secondary' : 'primary';
  renderWorkspace(); scheduleSave();
}
function splitEditor() {
  const name = activeName(); if (!name) return;
  const destination = project.activePane === 'primary' ? 'secondary' : 'primary';
  openSource(name, destination);
}
function closeSplit() { project.split = false; project.panes.secondary = { tabs: [], active: null }; project.activePane = 'primary'; renderWorkspace(); scheduleSave(); }
function validFilename(input) { const name = input?.trim(); if (!name) return null; return /^[\w. -]+\.pseudo$/i.test(name) ? name : null; }
function uniqueFilename(name) {
  if (!Object.hasOwn(project.sourceFiles, name)) return name;
  const base = name.replace(/\.pseudo$/i, ''); let i = 2;
  while (Object.hasOwn(project.sourceFiles, `${base}-${i}.pseudo`)) i++;
  return `${base}-${i}.pseudo`;
}
function newSource() {
  showWorkspaceDialog({ title: 'New pseudocode file', description: 'Create a file in this workspace.', label: 'Filename', value: 'untitled.pseudo', submitLabel: 'Create file',
    validate: name => !validFilename(name) ? 'Enter a filename ending in .pseudo.' : Object.hasOwn(project.sourceFiles, name) ? 'A file with this name already exists.' : null,
    onSubmit: name => { project.sourceFiles[name] = ''; selectedFiles = [name]; selectionAnchor = name; openSource(name); } });
}
function renameSource(old = activeName()) {
  if (!old || !Object.hasOwn(project.sourceFiles, old)) return;
  showWorkspaceDialog({ title: 'Rename file', description: `Rename ${old} in this workspace.`, label: 'Filename', value: old, submitLabel: 'Rename',
    validate: name => !validFilename(name) ? 'Enter a filename ending in .pseudo.' : name !== old && Object.hasOwn(project.sourceFiles, name) ? 'A file with this name already exists.' : null,
    onSubmit: name => {
      if (name === old) return;
      const entries = Object.entries(project.sourceFiles).map(([k, v]) => [k === old ? name : k, v]); project.sourceFiles = Object.fromEntries(entries);
      project.fileOrder = project.fileOrder.map(k => k === old ? name : k);
      selectedFiles = selectedFiles.map(k => k === old ? name : k); if (selectionAnchor === old) selectionAnchor = name;
      for (const state of Object.values(project.panes)) { state.tabs = state.tabs.map(k => k === old ? name : k); if (state.active === old) state.active = name; }
      if (problemsByFile[old]) { problemsByFile[name] = problemsByFile[old]; delete problemsByFile[old]; }
      if (project.breakpoints[old]) { project.breakpoints[name] = project.breakpoints[old]; delete project.breakpoints[old]; }
      if (debugSession?.filename === old) debugSession.filename = name;
      diagnosticCoordinator.forget(old);
      editHistory.rename(old, name); navigationIndexes.delete(old);
      if (referenceQuery?.file === old) referenceQuery.file = name;
      if (builtFile === old) builtFile = name;
      renderWorkspace(); scheduleSave();
    } });
}
function removeSources(names) {
  const removing = new Set(names.filter(name => Object.hasOwn(project.sourceFiles, name)));
  if (!removing.size) return;
  for (const name of removing) { delete project.sourceFiles[name]; delete project.breakpoints[name]; delete problemsByFile[name]; diagnosticCoordinator.forget(name); editHistory.delete(name); navigationIndexes.delete(name); }
  if (removing.has(debugSession?.filename)) stopDebug();
  if (removing.has(referenceQuery?.file)) referenceQuery = null;
  project.fileOrder = project.fileOrder.filter(name => !removing.has(name));
  selectedFiles = selectedFiles.filter(name => !removing.has(name));
  if (removing.has(selectionAnchor)) selectionAnchor = null;
  for (const state of Object.values(project.panes)) { state.tabs = state.tabs.filter(name => !removing.has(name)); if (removing.has(state.active)) state.active = state.tabs.at(-1) || null; }
  if (removing.has(builtFile)) { builtFile = null; builtSource = null; lastCompiled = null; }
  if (project.split && !project.panes.secondary.tabs.length) project.split = false;
  if (!Object.keys(project.sourceFiles).length) { project.sourceFiles['main.pseudo'] = ''; project.panes.primary.tabs = ['main.pseudo']; project.panes.primary.active = 'main.pseudo'; }
  if (!project.panes[project.activePane].active || (project.activePane === 'secondary' && !project.split)) project.activePane = 'primary';
  renderWorkspace(); scheduleSave();
}
function removeSource(name) { removeSources([name]); }
function deleteSource(name = activeName()) {
  if (!name || !Object.hasOwn(project.sourceFiles, name)) return;
  showWorkspaceDialog({ title: 'Delete file', description: `Delete ${name} from this workspace? This removes its saved source code.`, submitLabel: 'Delete file', danger: true, onSubmit: () => removeSource(name) });
}
function deleteSources(names) {
  names = names.filter(name => Object.hasOwn(project.sourceFiles, name));
  if (names.length === 1) { deleteSource(names[0]); return; }
  if (!names.length) return;
  showWorkspaceDialog({ title: `Delete ${names.length} files`, description: `Delete ${names.join(', ')} from this workspace? Their saved source code will be removed.`, submitLabel: `Delete ${names.length} files`, danger: true, onSubmit: () => removeSources(names) });
}
function setProblems(name, items) {
  if (name) problemsByFile[name] = items;
  for (const id of ['primary', 'secondary']) if (project.panes[id].active === name) {
    renderCode(id);
    const pane = panes[id];
    if (pane.diagnosticOffset != null && !pane.diagnostic.hidden) showDiagnosticAtOffset(id, pane.diagnosticOffset, pane.diagnosticAnchor.x, pane.diagnosticAnchor.y, true);
    else if (document.activeElement === pane.editor) updateDiagnosticAtCaret(id);
  }
  updateStatus(); if (activeConsole === 'diagnostics') renderConsole();
}
const diagnosticCoordinator = createDiagnosticCoordinator(setProblems);
let diagnosticWorker;
try {
  if (location.protocol === 'file:') throw new Error('Use local diagnostics for file pages');
  diagnosticWorker = new Worker(new URL('./diagnostics-worker.js', import.meta.url), { type: 'module' });
  diagnosticWorker.onmessage = ({ data }) => diagnosticCoordinator.receive(data);
  diagnosticWorker.onerror = () => {
    diagnosticWorker.terminate();
    diagnosticWorker = null;
    for (const { name } of diagnosticCoordinator.outstanding()) diagnose(name);
  };
} catch { diagnosticWorker = null; }
function diagnose(name) {
  if (!name || !Object.hasOwn(project.sourceFiles, name)) return;
  const request = diagnosticCoordinator.request(name, project.sourceFiles[name]);
  if (diagnosticWorker) { diagnosticWorker.postMessage(request); return; }
  const editorIssues = analyzeSource(request.source);
  diagnosticCoordinator.receive({ ...request, issues: editorIssues, partial: true });
  compileSelfHostedInBrowser(request.source).then(
    () => diagnosticCoordinator.receive({ ...request, issues: editorIssues }),
    error => diagnosticCoordinator.receive({ ...request, issues: mergeDiagnostics(editorIssues, diagnosticsFromError(error, request.source)) }),
  );
}
function log(text, kind = 'line') { consoleLines.push({ text, kind }); $('output-count').textContent = consoleLines.filter(x => x.kind === 'line').length; if (activeConsole === 'output') renderConsole(); }
function renderConsole() {
  consoleContent.replaceChildren();
  if (activeConsole === 'references') $('references-count').textContent = '0';
  if (activeConsole === 'output') {
    if (!consoleLines.length && !waitingInput) { const empty = document.createElement('div'); empty.className = 'empty-console'; empty.innerHTML = '<span class="terminal-glyph">›_</span><span>Run a source file to see output here.</span>'; consoleContent.append(empty); return; }
    for (const item of consoleLines) { const row = document.createElement('div'); row.className = item.kind === 'error' ? 'console-line console-error' : item.kind === 'meta' ? 'console-meta' : item.kind === 'input' ? 'console-line console-input' : 'console-line'; row.textContent = item.text; consoleContent.append(row); }
    if (waitingInput) {
      const row = document.createElement('form'); row.className = 'terminal-prompt';
      const label = document.createElement('label'); label.textContent = `${waitingInput.label} · line ${waitingInput.line}`; label.htmlFor = 'terminal-input';
      const field = document.createElement('input'); field.id = 'terminal-input'; field.type = 'text'; field.autocomplete = 'off'; field.setAttribute('aria-label', `Input for ${waitingInput.label}`);
      const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Enter ↵';
      row.append(label, field, submit);
      row.addEventListener('submit', event => { event.preventDefault(); const value = field.value, session = waitingInput.session; waitingInput = null; log(value, 'input'); session.inputLines.push(value); continueRun(session); });
      consoleContent.append(row);
    }
    consoleContent.scrollTop = consoleContent.scrollHeight;
  } else if (activeConsole === 'diagnostics') {
    const issues = problemsByFile[activeName()] || [];
    if (!issues.length) { const row = document.createElement('div'); row.className = 'console-meta'; row.textContent = 'No problems in the active file.'; consoleContent.append(row); }
    for (const issue of issues) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'problem-item';
      const loc = document.createElement('strong'); loc.textContent = `Ln ${issue.line}:${issue.column}`;
      row.append(loc, document.createTextNode(issue.message));
      row.addEventListener('click', () => {
        const file = activeName(), range = diagnosticRange(project.sourceFiles[file] || '', issue);
        if (range) navigateTo(file, range[0], range[1]);
      });
      consoleContent.append(row);
    }
  } else if (activeConsole === 'debug') {
    const toolbar = document.createElement('div'); toolbar.className = 'debug-toolbar';
    const control = (label, title, enabled, run) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title; button.disabled = !enabled; button.addEventListener('click', run); toolbar.append(button); };
    control('Start', 'Start debugging (F5)', !debugSession || ['completed', 'failed'].includes(debugSession.status), debugProgram);
    control('Continue', 'Continue to next breakpoint (F5)', debugSession?.status === 'paused', () => resumeDebug('continue'));
    control('Step', 'Execute one statement (F10)', debugSession?.status === 'paused', () => resumeDebug('step'));
    control('Stop', 'Stop debugging (Shift+F5)', !!debugSession && !['completed', 'failed'].includes(debugSession.status), stopDebug);
    consoleContent.append(toolbar);
    const status = document.createElement('div'); status.className = 'debug-status';
    const count = (project.breakpoints[activeName()] || []).length;
    status.textContent = !debugSession ? `Click a line number or press F9 to set a breakpoint. ${count} breakpoint${count === 1 ? '' : 's'} in this file.`
      : debugSession.status === 'paused' ? `${debugSession.filename} · paused before line ${debugSession.line} · step ${debugSession.pausedStep}`
      : debugSession.status === 'completed' ? `${debugSession.filename} · completed`
      : debugSession.status === 'failed' ? `${debugSession.filename} · ${debugSession.error}`
      : `${debugSession.filename} · ${debugSession.status}`;
    consoleContent.append(status);
    if (debugSession?.state && debugSession.status === 'paused') {
      const section = (title, entries) => {
        const wrap = document.createElement('div'); wrap.className = 'debug-section';
        const heading = document.createElement('h4'); heading.textContent = title; wrap.append(heading);
        if (!entries.length) { const empty = document.createElement('div'); empty.className = 'debug-empty'; empty.textContent = 'None'; wrap.append(empty); }
        for (const entry of entries) {
          const row = document.createElement('div'); row.className = 'debug-variable';
          const name = document.createElement('span'); name.className = 'debug-variable-name'; name.textContent = entry.name;
          const value = document.createElement('span'); value.className = 'debug-variable-value'; value.textContent = `${entry.value}${entry.type ? `  · ${entry.type}` : ''}`;
          row.append(name, value); wrap.append(row);
        }
        consoleContent.append(wrap);
      };
      section('Local variables', debugSession.state.locals);
      section('Global variables', debugSession.state.globals);
      section('Call stack', debugSession.state.stack.map((name, index) => ({ name: `${index + 1}. ${name}`, value: '' })));
    }
  } else if (activeConsole === 'references') {
    if (!referenceQuery || !Object.hasOwn(project.sourceFiles, referenceQuery.file)) {
      const empty = document.createElement('div'); empty.className = 'console-meta'; empty.textContent = 'Place the cursor on a symbol and press Shift+F12 to find its references.'; consoleContent.append(empty);
    } else {
      const source = project.sourceFiles[referenceQuery.file], sourceLines = source.split('\n'), result = indexSource(source).at(referenceQuery.offset);
      if (!result) { const empty = document.createElement('div'); empty.className = 'console-meta'; empty.textContent = 'No definition found for this symbol.'; consoleContent.append(empty); }
      else {
        $('references-count').textContent = String(result.references.length);
        const heading = document.createElement('div'); heading.className = 'references-heading'; heading.textContent = `${result.name} · ${result.references.length} reference${result.references.length === 1 ? '' : 's'}`; consoleContent.append(heading);
        const addLocation = (token, label) => {
          const line = sourceLines[token.line - 1] || '';
          const button = document.createElement('button'); button.type = 'button'; button.className = 'reference-item';
          const place = document.createElement('span'); place.className = 'reference-place'; place.textContent = `${referenceQuery.file}:${token.line}:${token.column}`;
          const snippet = document.createElement('span'); snippet.className = 'reference-snippet'; snippet.textContent = `${label}  ${line.trim()}`;
          button.append(place, snippet); button.addEventListener('click', () => navigateTo(referenceQuery.file, token.start, token.end)); consoleContent.append(button);
        };
        addLocation(result.definition, 'Definition');
        for (const token of result.references) addLocation(token, 'Reference');
      }
    }
  } else {
    const info = document.createElement('div'); info.className = 'build-log';
    if (buildInfo) info.innerHTML = `<strong>${escape(buildInfo.name)} · build succeeded</strong><br>Execution: ${buildInfo.native ? 'Self-hosted native WASM' : 'Self-hosted compatibility WASM'} · ${buildInfo.release ? 'release' : 'guarded'} · ${buildInfo.optimization}<br>WebAssembly module: ${buildInfo.size.toLocaleString()} bytes<br>Routines: ${buildInfo.routines}<br>Imports: ${buildInfo.imports}<br>Compiled in ${buildInfo.ms.toFixed(1)} ms`;
    else info.textContent = 'Compile the active source file to inspect its WebAssembly module.';
    consoleContent.append(info);
    if (buildInfo) { const button = document.createElement('button'); button.className = 'tiny-button'; button.style.marginTop = '14px'; button.textContent = 'Download project .json'; button.addEventListener('click', downloadProject); consoleContent.append(button); }
  }
}
function switchConsole(tab) { activeConsole = tab; document.querySelectorAll('[data-console-tab]').forEach(button => button.classList.toggle('active', button.dataset.consoleTab === tab)); renderConsole(); }
function navigateTo(file, start, end = start, remember = true) {
  if (!Object.hasOwn(project.sourceFiles, file)) return;
  if (remember && activeName()) navigationHistory.push({ file: activeName(), offset: panes[project.activePane].editor.selectionStart });
  openSource(file);
  const editor = panes[project.activePane].editor;
  editor.setSelectionRange(start, end);
  revealEditorRange(project.activePane, start);
  updateStatus(); updateDiagnosticAtCaret(project.activePane);
}
function navigateProblem(which, backwards = false) {
  const file = project.panes[which].active;
  if (!file) return;
  const pane = panes[which];
  const next = nextDiagnostic(project.sourceFiles[file] || '', problemsByFile[file] || [], pane.editor.selectionStart, backwards);
  if (!next) { switchConsole('diagnostics'); return; }
  hideCompletions(which);
  setActivePane(which);
  navigateTo(file, next.range[0], next.range[1], false);
  switchConsole('diagnostics');
}
function rememberEdit(which) {
  const editor = panes[which].editor;
  panes[which].beforeEdit = { start: editor.selectionStart, end: editor.selectionEnd };
}
function changeHistory(which, direction) {
  const pane = panes[which], file = project.panes[which].active;
  if (!file) return;
  const editor = pane.editor, selection = { start: editor.selectionStart, end: editor.selectionEnd };
  const next = direction === 'undo' ? editHistory.undo(file, editor.value, selection) : editHistory.redo(file, editor.value, selection);
  if (!next) return;
  pane.applyingHistory = true; pane.suppressCompletion = true;
  editor.value = next.text;
  editor.setSelectionRange(next.start, next.end);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.focus(); revealEditorRange(which, next.start);
}
function revealEditorRange(which, start) {
  const editor = panes[which].editor;
  const before = editor.value.slice(0, start), line = before.split('\n').length - 1;
  const column = before.length - before.lastIndexOf('\n') - 1;
  const style = getComputedStyle(editor), lineHeight = parseFloat(style.lineHeight) || 24;
  const top = line * lineHeight + (parseFloat(style.paddingTop) || 0);
  if (top < editor.scrollTop || top + lineHeight > editor.scrollTop + editor.clientHeight)
    editor.scrollTop = Math.max(0, top - editor.clientHeight / 3);
  const characterWidth = parseFloat(style.fontSize) * 0.62;
  const left = column * characterWidth + (parseFloat(style.paddingLeft) || 0);
  if (left < editor.scrollLeft || left > editor.scrollLeft + editor.clientWidth - 40)
    editor.scrollLeft = Math.max(0, left - editor.clientWidth / 3);
  panes[which].highlight.scrollTop = editor.scrollTop;
  panes[which].highlight.scrollLeft = editor.scrollLeft;
  panes[which].gutter.scrollTop = editor.scrollTop;
}
function navigationIndex(which) {
  const file = project.panes[which].active;
  if (!file) return null;
  const source = project.sourceFiles[file] || '', cached = navigationIndexes.get(file);
  if (!cached || cached.source !== source) navigationIndexes.set(file, { source, index: indexSource(source) });
  return navigationIndexes.get(file).index;
}
function navigationTarget(which, offset = panes[which].editor.selectionStart) {
  return navigationIndex(which)?.at(offset) || null;
}
function updateNavigationHover(which, event = null) {
  const pane = panes[which];
  if (event?.clientX) pane.lastPointer = { x: event.clientX, y: event.clientY };
  const point = pane.lastPointer;
  const target = event && (event.ctrlKey || event.metaKey) && point ? navigationTarget(which, editorOffsetAtPoint(which, point.x, point.y)) : null;
  const range = target ? [target.token.start, target.token.end] : null;
  if (pane.navHover?.[0] === range?.[0] && pane.navHover?.[1] === range?.[1]) return;
  pane.navHover = range;
  pane.editor.classList.toggle('navigation-ready', !!range);
  renderCode(which);
}
function editorOffsetAtPoint(which, x, y) {
  const editor = panes[which].editor, source = editor.value, rect = editor.getBoundingClientRect(), style = getComputedStyle(editor);
  const lineHeight = parseFloat(style.lineHeight) || 22, paddingTop = parseFloat(style.paddingTop) || 0, paddingLeft = parseFloat(style.paddingLeft) || 0;
  const lines = source.split('\n'), lineNumber = Math.max(0, Math.min(lines.length - 1, Math.floor((y - rect.top + editor.scrollTop - paddingTop) / lineHeight)));
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d'); context.font = `${style.fontSize} ${style.fontFamily}`;
  const cell = context.measureText('M').width || 8;
  const column = Math.max(0, (x - rect.left + editor.scrollLeft - paddingLeft) / cell);
  let display = 0, index = 0;
  for (const char of lines[lineNumber]) { const width = char === '\t' ? 2 - display % 2 : 1; if (display + width > column) break; display += width; index += char.length; }
  let offset = index;
  for (let i = 0; i < lineNumber; i++) offset += lines[i].length + 1;
  return offset;
}
function editorPointForOffset(which, offset) {
  const editor = panes[which].editor, style = getComputedStyle(editor), before = editor.value.slice(0, offset), lines = before.split('\n');
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d'); context.font = `${style.fontSize} ${style.fontFamily}`;
  const cell = context.measureText('M').width || 8;
  let display = 0; for (const char of lines.at(-1)) display += char === '\t' ? 2 - display % 2 : 1;
  return { x: (parseFloat(style.paddingLeft) || 0) + display * cell - editor.scrollLeft, y: (parseFloat(style.paddingTop) || 0) + (lines.length - 1) * (parseFloat(style.lineHeight) || 22) - editor.scrollTop };
}
function hideDiagnostic(which) {
  const pane = panes[which];
  clearTimeout(pane.hoverTimer);
  pane.diagnostic.hidden = true;
  pane.diagnosticOffset = null;
  pane.diagnosticKey = null;
  if (pane.editor.getAttribute('aria-describedby') === pane.diagnostic.id) pane.editor.removeAttribute('aria-describedby');
}
function placeEditorTooltip(which, x, y) {
  const pane = panes[which], tooltip = pane.diagnostic;
  tooltip.hidden = false;
  pane.editor.setAttribute('aria-describedby', tooltip.id);
  pane.diagnosticAnchor = { x, y };
  const layer = pane.editor.parentElement, lineHeight = parseFloat(getComputedStyle(pane.editor).lineHeight) || 22;
  const below = y + 6, above = y - lineHeight - tooltip.offsetHeight - 6;
  const top = below + tooltip.offsetHeight > layer.clientHeight - 8 ? Math.max(8, above) : below;
  tooltip.style.top = `${Math.max(8, Math.min(top, layer.clientHeight - tooltip.offsetHeight - 8))}px`;
  tooltip.style.left = `${Math.max(8, Math.min(x, layer.clientWidth - tooltip.offsetWidth - 8))}px`;
}
function showDiagnosticAtOffset(which, offset, x, y, reposition = false) {
  const pane = panes[which], file = project.panes[which].active;
  const issue = diagnosticAtOffset(project.sourceFiles[file] || '', problemsByFile[file] || [], offset);
  if (!issue) { hideDiagnostic(which); return false; }
  clearTimeout(pane.hoverTimer);
  const key = `${issue.line}:${issue.column}:${issue.message}`;
  if (pane.diagnosticKey === key && !reposition) return true;
  const tooltip = pane.diagnostic;
  if (pane.diagnosticKey !== key) {
    tooltip.classList.remove('symbol');
    tooltip.replaceChildren();
    const heading = document.createElement('div'); heading.className = 'editor-diagnostic-heading';
    const label = document.createElement('span'); label.textContent = 'Error';
    const location = document.createElement('span'); location.className = 'editor-diagnostic-location'; location.textContent = `Ln ${issue.line}, Col ${issue.column || 1}`;
    heading.append(label, location); tooltip.append(heading);
    const message = document.createElement('div'); message.className = 'editor-diagnostic-message'; message.textContent = issue.message;
    tooltip.append(message);
  }
  pane.diagnosticOffset = offset;
  pane.diagnosticKey = key;
  placeEditorTooltip(which, x, y);
  return true;
}
function showSymbolAtOffset(which, offset, x, y) {
  const pane = panes[which];
  if (!/[A-Za-z0-9_]/.test(pane.editor.value[offset] || '')) return;
  const symbol = navigationIndex(which)?.describe(offset);
  if (!symbol || diagnosticAtOffset(pane.editor.value, problemsByFile[project.panes[which].active] || [], offset)) return;
  const tooltip = pane.diagnostic;
  tooltip.classList.add('symbol');
  tooltip.replaceChildren();
  const heading = document.createElement('div'); heading.className = 'editor-diagnostic-heading';
  const label = document.createElement('span'); label.textContent = symbol.name;
  const location = document.createElement('span'); location.className = 'editor-diagnostic-location';
  location.textContent = `${symbol.kind} · Ln ${symbol.definition.line}`;
  heading.append(label, location); tooltip.append(heading);
  if (symbol.type) { const detail = document.createElement('div'); detail.className = 'editor-diagnostic-message'; detail.textContent = symbol.type; tooltip.append(detail); }
  pane.diagnosticOffset = offset;
  pane.diagnosticKey = `symbol:${symbol.definition.start}`;
  placeEditorTooltip(which, x, y);
}
function updateDiagnosticHover(which, event) {
  const pane = panes[which], rect = pane.editor.parentElement.getBoundingClientRect();
  const offset = editorOffsetAtPoint(which, event.clientX, event.clientY);
  const x = event.clientX - rect.left + 10, y = event.clientY - rect.top + 10;
  if (!showDiagnosticAtOffset(which, offset, x, y))
    pane.hoverTimer = setTimeout(() => showSymbolAtOffset(which, offset, x, y), 350);
}
function updateDiagnosticAtCaret(which) {
  const editor = panes[which].editor;
  const point = editorPointForOffset(which, editor.selectionStart);
  showDiagnosticAtOffset(which, editor.selectionStart, point.x, point.y + (parseFloat(getComputedStyle(editor).lineHeight) || 22), true);
}
function hideReferencePeek(which) { panes[which].peek.hidden = true; }
function showReferencePeek(which, result, offset = result.token.start) {
  const pane = panes[which], file = project.panes[which].active, source = project.sourceFiles[file] || '', lines = source.split('\n'), peek = pane.peek;
  peek.replaceChildren();
  const head = document.createElement('div'); head.className = 'reference-peek-head';
  const name = document.createElement('strong'); name.textContent = result.name;
  const count = document.createElement('span'); count.className = 'reference-peek-count'; count.textContent = `${result.references.length} reference${result.references.length === 1 ? '' : 's'}`;
  const close = document.createElement('button'); close.type = 'button'; close.title = 'Close references (Esc)'; close.setAttribute('aria-label', 'Close references'); close.textContent = '×'; close.addEventListener('click', () => { hideReferencePeek(which); pane.editor.focus(); });
  head.append(name, count, close); peek.append(head);
  const list = document.createElement('div'); list.className = 'reference-peek-list';
  for (const [index, token] of [result.definition, ...result.references].entries()) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'reference-peek-item';
    const place = document.createElement('span'); place.className = 'peek-location'; place.textContent = `${index ? 'Ref' : 'Def'} · ${token.line}:${token.column}`;
    const snippet = document.createElement('span'); snippet.className = 'peek-snippet'; snippet.textContent = (lines[token.line - 1] || '').trim();
    row.append(place, snippet); row.title = `${file}:${token.line}:${token.column} ${snippet.textContent}`;
    row.addEventListener('click', () => { hideReferencePeek(which); navigateTo(file, token.start, token.end); }); list.append(row);
  }
  peek.append(list);
  const footer = document.createElement('div'); footer.className = 'reference-peek-footer'; footer.textContent = `${file} · click a location to jump · Esc to close`; peek.append(footer);
  peek.hidden = false;
  const point = editorPointForOffset(which, offset), layer = pane.editor.parentElement;
  const below = point.y + 30, top = below + peek.offsetHeight > layer.clientHeight ? Math.max(8, point.y - peek.offsetHeight - 5) : below;
  peek.style.top = `${Math.max(8, Math.min(top, layer.clientHeight - peek.offsetHeight - 8))}px`;
  peek.style.left = `${Math.max(8, Math.min(point.x, layer.clientWidth - peek.offsetWidth - 8))}px`;
}
function goToDefinition(which, offset, peek = false) {
  const result = navigationTarget(which, offset);
  if (!result) { showToast('No definition found at the cursor.'); return; }
  const file = project.panes[which].active;
  if (result.token.start !== result.definition.start) navigateTo(file, result.definition.start, result.definition.end);
  if (peek || result.token.start === result.definition.start) {
    referenceQuery = { file, offset: result.definition.start };
    $('references-count').textContent = String(result.references.length);
    showReferencePeek(which, result, result.definition.start);
  }
}
function showReferences(which, offset) {
  const result = navigationTarget(which, offset);
  if (!result) { showToast('No definition found at the cursor.'); return; }
  referenceQuery = { file: project.panes[which].active, offset: result.definition.start };
  $('references-count').textContent = String(result.references.length);
  showReferencePeek(which, result, result.token.start);
  if (activeConsole === 'references') renderConsole();
}
function renameEditorSymbol(which, offset = panes[which].editor.selectionStart) {
  const result = navigationTarget(which, offset);
  if (!result) { showToast('No symbol found at the cursor.'); return; }
  const file = project.panes[which].active, original = project.sourceFiles[file], originalName = original.slice(result.definition.start, result.definition.end);
  showWorkspaceDialog({ title: `Rename ${originalName}`, description: `Change this symbol and its ${result.references.length} reference${result.references.length === 1 ? '' : 's'} in ${file}.`, label: 'New name', value: originalName, submitLabel: 'Rename symbol',
    validate: name => { try { renameSymbol(original, result, name); return null; } catch (error) { return error.message; } },
    onSubmit: name => {
      if (name === originalName) return;
      const pane = panes[which], editor = pane.editor;
      rememberEdit(which); editor.value = renameSymbol(original, result, name);
      const start = result.definition.start; editor.setSelectionRange(start, start + name.length);
      pane.suppressCompletion = true; editor.dispatchEvent(new Event('input', { bubbles: true })); editor.focus(); revealEditorRange(which, start);
    },
  });
}
function navigateBack() {
  const previous = navigationHistory.pop();
  if (previous) navigateTo(previous.file, previous.offset, previous.offset, false);
}
async function build({ release = false, optimization = project.optimizationLevel } = {}) {
  const name = activeName(); if (!name) { log('Open a source file before compiling.', 'error'); return null; }
  const source = activeSource(), start = performance.now();
  const editorIssues = analyzeSource(source);
  try {
    const result = await compileSelfHostedInBrowser(source, { release, optimization });
    if (!WebAssembly.validate(result.binary)) throw new Error('Generated WebAssembly module did not validate');
    if (name !== activeName() || source !== activeSource()) return null;
    const ms = performance.now() - start;
    lastCompiled = result; builtFile = name; builtSource = source; builtRequestedRelease = release; builtOptimization = optimization;
    buildInfo = { name, size: result.binary.length, routines: result.routines.length, imports: WebAssembly.Module.imports(new WebAssembly.Module(result.binary)).length, native: !!result.native, release: !!result.release, optimization: result.optimization || 'standard', ms };
    $('build-status').textContent = `${name} · succeeded`; $('build-size').textContent = `${result.binary.length.toLocaleString()} bytes · ${result.release ? 'release' : 'guarded'} · ${buildInfo.optimization} · ${ms.toFixed(1)} ms`;
    setProblems(name, editorIssues); return result;
  } catch (error) {
    if (name !== activeName() || source !== activeSource()) return null;
    lastCompiled = null; builtFile = null; builtSource = null; builtOptimization = null; buildInfo = null;
    $('build-status').textContent = `${name} · failed`; $('build-size').textContent = `Line ${error.line || 1}`;
    setProblems(name, mergeDiagnostics(editorIssues, diagnosticsFromError(error, source))); switchConsole('diagnostics'); return null;
  }
}
async function runProgram() {
  runToken++; waitingInput = null; debugSession = null; consoleLines = []; $('output-count').textContent = '0'; switchConsole('output');
  renderCode('primary'); renderCode('secondary');
  const name = activeName(), source = activeSource();
  const compiled = builtFile === name && builtSource === source && !builtRequestedRelease && builtOptimization === project.optimizationLevel && lastCompiled ? lastCompiled : await build();
  if (!compiled) { switchConsole('diagnostics'); return; }
  const preload = $('stdin').value.replace(/\r/g, '').replace(/\n$/, '');
  const session = { token: runToken, filename: name, compiled, files: structuredClone(project.files), records: structuredClone(project.records || {}), inputLines: preload ? preload.split('\n') : [], printed: 0, runtimeMs: 0, seed: (Math.random() * 0x100000000) >>> 0, today: new Date().toISOString() };
  await continueRun(session);
}
function stopDebug() {
  if (!debugSession) return;
  runToken++;
  if (waitingInput?.session === debugSession) waitingInput = null;
  debugSession = null;
  for (const which of ['primary', 'secondary']) renderCode(which);
  updateStatus();
  if (activeConsole === 'debug' || activeConsole === 'output') renderConsole();
}
async function debugProgram() {
  runToken++; waitingInput = null; debugSession = null; consoleLines = []; $('output-count').textContent = '0';
  const token = runToken, name = activeName(), source = activeSource();
  if (!name) { showToast('Open a pseudocode file to debug.'); return; }
  project.layout.terminalVisible = true; applyLayout(); switchConsole('debug');
  try {
    const compiled = await compileSelfHostedInBrowser(source, { debug: true });
    if (token !== runToken || project.sourceFiles[name] !== source) return;
    const preload = $('stdin').value.replace(/\r/g, '').replace(/\n$/, '');
    debugSession = { debug: true, token, filename: name, source, compiled, files: structuredClone(project.files), records: structuredClone(project.records || {}), inputLines: preload ? preload.split('\n') : [], printed: 0, runtimeMs: 0, seed: (Math.random() * 0x100000000) >>> 0, today: new Date().toISOString(), pausedStep: 0, mode: 'step', status: 'running', state: null };
    await continueRun(debugSession);
  } catch (error) {
    if (token !== runToken) return;
    setProblems(name, diagnosticsFromError(error, source)); switchConsole('diagnostics');
  }
}
function resumeDebug(mode) {
  if (debugSession?.status !== 'paused') return;
  debugSession.mode = mode;
  continueRun(debugSession);
}
async function continueRun(session) {
  if (session.token !== runToken) return;
  if (session.debug) { session.status = 'running'; if (activeConsole === 'debug') renderConsole(); }
  $('run-button').disabled = true; $('run-button').textContent = 'Running…';
  $('debug-button').disabled = true;
  try {
    const start = performance.now();
    const breakpoints = new Set(project.breakpoints[session.filename] || []);
    const runtime = createRuntime(session.compiled, { inputLines: session.inputLines, files: session.files, records: session.records, interactive: true, seed: session.seed, today: session.today, maxSteps: 250000,
      onStep: session.debug ? (line, step) => step > session.pausedStep && (session.mode === 'step' || breakpoints.has(line)) : undefined });
    const done = await runtime.run(); session.runtimeMs += performance.now() - start;
    if (session.token !== runToken) return;
    for (const line of done.output.slice(session.printed)) log(line);
    session.printed = done.output.length;
    if (done.status === 'paused') {
      session.pausedStep = done.steps; session.line = done.line; session.state = done.state; session.status = 'paused';
      const lines = session.source.split('\n'), offset = lines.slice(0, done.line - 1).reduce((total, row) => total + row.length + 1, 0) + (lines[done.line - 1]?.search(/\S/) ?? 0);
      navigateTo(session.filename, Math.max(0, offset), Math.max(0, offset), false);
      updateStatus(); switchConsole('debug'); return;
    }
    if (done.status === 'waiting') { if (session.debug) session.status = 'waiting'; waitingInput = { line: done.line, label: done.label, session }; project.layout.terminalVisible = true; applyLayout(); updateStatus(); switchConsole('output'); $('terminal-input')?.focus(); return; }
    project.files = done.files; project.records = done.records; renderDataFiles(); save();
    log(`${session.filename} finished · ${done.steps.toLocaleString()} steps · ${session.runtimeMs.toFixed(1)} ms`, 'meta');
    if (session.debug) { session.status = 'completed'; session.state = null; session.line = null; renderCode('primary'); renderCode('secondary'); switchConsole('debug'); }
    setProblems(session.filename, []);
  } catch (error) { if (session.debug) { session.status = 'failed'; session.error = `line ${error.line || '?'}: ${error.message}`; switchConsole('debug'); } log(`${session.filename}, line ${error.line || '?'}: ${error.message}`, 'error'); setProblems(session.filename, [{ line: error.line || 1, column: error.column || 1, message: error.message }]); }
  finally { $('run-button').disabled = false; $('run-button').innerHTML = '<span class="play-icon">▶</span> Run program'; $('debug-button').disabled = false; if (activeConsole === 'debug') renderConsole(); }
}
function downloadBlob(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 3000); }
async function downloadWasm() { const name = activeName(), release = $('release-build').checked, compiled = builtFile === name && builtSource === activeSource() && builtRequestedRelease === release && builtOptimization === project.optimizationLevel && lastCompiled ? lastCompiled : await build({ release }); if (compiled) downloadBlob(new Blob([compiled.binary], { type: 'application/wasm' }), name.replace(/\.pseudo$/i, '') + '.wasm'); }
function downloadProject() { save(); downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'pseudo2wasm-project.json'); }
function renderDataFiles() {
  const list = $('virtual-file-list'); list.replaceChildren(); const names = Object.keys(project.files).sort();
  if (!names.length) { const empty = document.createElement('div'); empty.className = 'virtual-file-empty'; empty.textContent = 'No data files yet. Programs can create them.'; list.append(empty); }
  for (const name of names) { const button = document.createElement('button'); button.className = `virtual-file${selectedDataFile === name ? ' active' : ''}`; button.textContent = `◇  ${name}`; button.addEventListener('click', () => { selectedDataFile = name; renderDataFiles(); }); list.append(button); }
  $('file-editor-area').hidden = !selectedDataFile || !Object.hasOwn(project.files, selectedDataFile);
  if (!$('file-editor-area').hidden) { $('file-editor-label').textContent = selectedDataFile; $('file-editor').value = project.files[selectedDataFile]; }
}
function switchTool(tool) { document.querySelectorAll('[data-tool]').forEach(button => { const selected = button.dataset.tool === tool; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); }); document.querySelectorAll('.tool-pane').forEach(pane => pane.classList.toggle('active', pane.id === `tool-${tool}`)); project.layout.toolsVisible = true; applyLayout(); scheduleSave(); }
function installResizer(id, direction, key, min, max) {
  const handle = $(id); let origin = 0, start = 0;
  const change = delta => { const bound = Math.min(max(), Math.max(min(), start + delta)); project.layout[key] = Math.round(bound); applyLayout(); };
  handle.addEventListener('pointerdown', event => { if (event.button !== 0) return; origin = direction === 'x' ? event.clientX : event.clientY; start = project.layout[key]; handle.setPointerCapture(event.pointerId); handle.classList.add('dragging'); event.preventDefault(); });
  handle.addEventListener('pointermove', event => { if (!handle.hasPointerCapture(event.pointerId)) return; const current = direction === 'x' ? event.clientX : event.clientY; change((current - origin) * (id === 'right-resizer' || id === 'bottom-resizer' ? -1 : 1)); });
  handle.addEventListener('pointerup', event => { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); handle.classList.remove('dragging'); scheduleSave(); });
  handle.addEventListener('pointercancel', () => handle.classList.remove('dragging'));
  handle.addEventListener('keydown', event => { const positive = direction === 'x' ? 'ArrowRight' : 'ArrowDown', negative = direction === 'x' ? 'ArrowLeft' : 'ArrowUp'; if (![positive, negative].includes(event.key)) return; event.preventDefault(); start = project.layout[key]; change((event.key === positive ? 20 : -20) * (id === 'right-resizer' || id === 'bottom-resizer' ? -1 : 1)); scheduleSave(); });
}
function installSplitResizer() {
  const handle = $('split-resizer'); let origin = 0, start = 50;
  handle.addEventListener('pointerdown', event => { if (event.button !== 0) return; origin = event.clientX; start = project.layout.splitRatio; handle.setPointerCapture(event.pointerId); handle.classList.add('dragging'); event.preventDefault(); });
  handle.addEventListener('pointermove', event => { if (!handle.hasPointerCapture(event.pointerId)) return; const width = $('editor-area').clientWidth; project.layout.splitRatio = Math.max(25, Math.min(75, start + (event.clientX - origin) * 100 / width)); applyLayout(); });
  handle.addEventListener('pointerup', event => { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); handle.classList.remove('dragging'); scheduleSave(); });
  handle.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); project.layout.splitRatio = Math.max(25, Math.min(75, project.layout.splitRatio + (event.key === 'ArrowRight' ? 5 : -5))); applyLayout(); scheduleSave(); });
}

function hideCompletions(which) { const pane = panes[which]; pane.completion.hidden = true; pane.completionData = null; }
function showCompletions(which, explicit = false) {
  const pane = panes[which], editor = pane.editor;
  if (editor.selectionStart !== editor.selectionEnd || !project.panes[which].active) { hideCompletions(which); return; }
  const result = completions(editor.value, editor.selectionStart, Object.keys(project.files));
  if (!result?.items.length || (!explicit && result.start === result.end && !['.', '"'].includes(editor.value[editor.selectionStart - 1]))) { hideCompletions(which); return; }
  pane.completionData = { ...result, selected: 0 };
  renderCompletions(which);
  const before = editor.value.slice(0, editor.selectionStart), lines = before.split('\n');
  const style = getComputedStyle(editor), canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  context.font = style.font;
  const characterWidth = context.measureText('M').width, lineHeight = parseFloat(style.lineHeight);
  const left = parseFloat(style.paddingLeft) + lines.at(-1).length * characterWidth - editor.scrollLeft;
  const top = parseFloat(style.paddingTop) + lines.length * lineHeight - editor.scrollTop;
  pane.completion.style.left = `${Math.max(4, Math.min(left, pane.completion.parentElement.clientWidth - 310))}px`;
  pane.completion.style.top = `${Math.max(4, Math.min(top, pane.completion.parentElement.clientHeight - 250))}px`;
  pane.completion.hidden = false;
}
function renderCompletions(which) {
  const pane = panes[which], data = pane.completionData;
  pane.completion.replaceChildren();
  for (const [index, item] of data.items.slice(0, 12).entries()) {
    const row = document.createElement('button'); row.type = 'button'; row.className = `completion-item${index === data.selected ? ' selected' : ''}`;
    row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === data.selected));
    const kind = document.createElement('span'); kind.className = `completion-kind completion-${item.kind}`; kind.textContent = item.kind.slice(0, 1).toUpperCase();
    const label = document.createElement('span'); label.className = 'completion-label'; label.textContent = item.label;
    const detail = document.createElement('span'); detail.className = 'completion-detail'; detail.textContent = item.detail;
    row.append(kind, label, detail);
    row.addEventListener('mousedown', event => event.preventDefault());
    row.addEventListener('click', () => acceptCompletion(which, index)); pane.completion.append(row);
  }
}
function acceptCompletion(which, index = panes[which].completionData?.selected) {
  const pane = panes[which], data = pane.completionData, item = data?.items[index]; if (!item) return;
  rememberEdit(which);
  pane.editor.setRangeText(item.insert, data.start, data.end, 'end');
  if (item.select) pane.editor.setSelectionRange(data.start + item.select[0], data.start + item.select[1]);
  hideCompletions(which); pane.suppressCompletion = true; pane.editor.dispatchEvent(new Event('input', { bubbles: true })); pane.editor.focus();
}
function editLines(which, action) {
  const editor = panes[which].editor, source = editor.value;
  rememberEdit(which);
  const originalStart = editor.selectionStart, originalEnd = editor.selectionEnd;
  const first = source.lastIndexOf('\n', editor.selectionStart - 1) + 1;
  const last = editor.selectionEnd > first && source[editor.selectionEnd - 1] === '\n' ? editor.selectionEnd - 1 : editor.selectionEnd;
  const end = source.indexOf('\n', last), finish = end < 0 ? source.length : end;
  const block = source.slice(first, finish), lines = block.split('\n'); let replacement = block;
  if (action === 'comment') { const uncomment = lines.every(line => /^\s*\/\//.test(line)); replacement = lines.map(line => uncomment ? line.replace(/^(\s*)\/\/ ?/, '$1') : line.replace(/^(\s*)/, '$1// ')).join('\n'); }
  else if (action === 'indent') replacement = lines.map(line => `  ${line}`).join('\n');
  else if (action === 'outdent') replacement = lines.map(line => line.replace(/^(?:  |\t)/, '')).join('\n');
  else if (action === 'delete') { const removeEnd = end < 0 ? finish : finish + 1; editor.setRangeText('', first, removeEnd, 'start'); editor.dispatchEvent(new Event('input', { bubbles: true })); return; }
  editor.setRangeText(replacement, first, finish, 'select');
  if (originalStart === originalEnd) { const next = Math.min(first + replacement.length, Math.max(first, originalStart + replacement.length - block.length)); editor.setSelectionRange(next, next); }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}
function moveLine(which, direction) {
  const editor = panes[which].editor, source = editor.value, start = source.lastIndexOf('\n', editor.selectionStart - 1) + 1;
  rememberEdit(which);
  const endPos = source.indexOf('\n', editor.selectionEnd), end = endPos < 0 ? source.length : endPos;
  if (direction < 0) {
    if (start === 0) return;
    const previous = source.lastIndexOf('\n', start - 2) + 1, chunk = source.slice(previous, start - 1);
    editor.setRangeText(`${source.slice(start, end)}\n${chunk}`, previous, end, 'select');
  } else {
    if (endPos < 0) return;
    const nextEndPos = source.indexOf('\n', endPos + 1), nextEnd = nextEndPos < 0 ? source.length : nextEndPos;
    editor.setRangeText(`${source.slice(endPos + 1, nextEnd)}\n${source.slice(start, end)}`, start, nextEnd, 'select');
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}
function showSearch(which, replace = false) {
  const pane = panes[which]; pane.search.hidden = false;
  if (replace) pane.search.classList.add('with-replace');
  const selection = pane.editor.value.slice(pane.editor.selectionStart, pane.editor.selectionEnd);
  if (selection && !selection.includes('\n')) pane.searchInput.value = selection;
  updateSearch(which);
  pane.searchInput.focus(); pane.searchInput.select();
}
function updateSearch(which, render = true) {
  const pane = panes[which], state = pane.searchState;
  const found = findMatches(pane.editor.value, pane.searchInput.value, state);
  state.matches = found.matches; state.error = found.error;
  const start = pane.editor.selectionStart, end = pane.editor.selectionEnd;
  const selected = state.matches.findIndex(match => match.start === start && match.end === end);
  state.current = selected >= 0 ? selected : state.matches.findIndex(match => match.start >= start);
  if (state.current < 0 && state.matches.length) state.current = 0;
  pane.searchInput.classList.toggle('invalid', !!found.error);
  pane.searchInput.title = found.error || '';
  const count = $(`${which}-search-count`);
  count.textContent = found.error ? 'Invalid pattern' : !pane.searchInput.value ? 'No results' : state.matches.length ? `${state.current + 1} of ${state.matches.length}` : 'No results';
  for (const button of pane.search.querySelectorAll('[data-search-action="next"], [data-search-action="previous"], [data-search-action="replace"], [data-search-action="all"]')) button.disabled = !state.matches.length;
  if (render) renderCode(which);
}
function findNext(which, backwards = false, focus = true) {
  const pane = panes[which], state = pane.searchState;
  if (!state.matches.length) return;
  state.current = (state.current + (backwards ? -1 : 1) + state.matches.length) % state.matches.length;
  const match = state.matches[state.current];
  if (focus) pane.editor.focus();
  pane.editor.setSelectionRange(match.start, match.end);
  revealEditorRange(which, match.start);
  $(`${which}-search-count`).textContent = `${state.current + 1} of ${state.matches.length}`;
  renderCode(which); updateStatus();
}
function replaceSearch(which, all = false) {
  const pane = panes[which], state = pane.searchState;
  if (!state.matches.length) return;
  const result = replaceMatches(pane.editor.value, state.matches, pane.replaceInput.value, { regex: state.regex, all, current: state.current });
  if (!result.count) return;
  pane.suppressCompletion = true;
  rememberEdit(which);
  pane.editor.setRangeText(result.source, 0, pane.editor.value.length, 'end');
  pane.editor.setSelectionRange(result.cursor, result.cursor);
  pane.editor.dispatchEvent(new Event('input', { bubbles: true }));
  updateSearch(which);
  if (!all && state.matches.length) {
    const next = state.matches.findIndex(match => match.start >= result.cursor);
    state.current = next < 0 ? 0 : next;
    const match = state.matches[state.current];
    pane.editor.setSelectionRange(match.start, match.end);
    renderCode(which);
  }
  pane.replaceInput.focus();
}
function quickOpen() {
  const overlay = $('quick-open'), input = $('quick-open-input'); overlay.hidden = false; input.value = ''; renderQuickOpen(); input.focus();
}
function renderQuickOpen() {
  const query = $('quick-open-input').value.toLowerCase(), list = $('quick-open-list'); list.replaceChildren();
  for (const name of project.fileOrder.filter(name => name.toLowerCase().includes(query)).slice(0, 12)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quick-open-item'; button.textContent = `◇  ${name}`;
    button.addEventListener('click', () => { $('quick-open').hidden = true; openSource(name); }); list.append(button);
  }
}

for (const which of ['primary', 'secondary']) {
  const pane = panes[which], empty = document.createElement('div'); empty.className = 'editor-empty'; empty.textContent = 'Open a pseudocode file from Explorer'; pane.group.append(empty);
  pane.gutter.addEventListener('click', event => {
    const button = event.target.closest('[data-breakpoint-line]');
    if (button) toggleBreakpoint(project.panes[which].active, Number(button.dataset.breakpointLine));
  });
  pane.searchState = { caseSensitive: false, wholeWord: false, regex: false, matches: [], current: -1, error: '' };
  pane.editor.addEventListener('focus', () => { hideDiagnostic(which === 'primary' ? 'secondary' : 'primary'); setActivePane(which); });
  pane.editor.addEventListener('click', event => { hideCompletions(which); updateStatus(); if ((event.ctrlKey || event.metaKey) && project.panes[which].active) goToDefinition(which, pane.editor.selectionStart, true); updateDiagnosticAtCaret(which); });
  pane.editor.addEventListener('mousemove', event => { updateNavigationHover(which, event); updateDiagnosticHover(which, event); });
  pane.editor.addEventListener('mouseleave', () => { updateNavigationHover(which); hideDiagnostic(which); });
  pane.editor.addEventListener('keyup', event => { updateStatus(); if (event.key === 'Control' || event.key === 'Meta') updateNavigationHover(which); if (/^(Arrow|Home$|End$|Page)/.test(event.key)) updateDiagnosticAtCaret(which); else if (event.key === 'Escape') hideDiagnostic(which); });
  pane.editor.addEventListener('contextmenu', event => showEditorContextMenu(event, which));
  pane.editor.addEventListener('beforeinput', event => {
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); changeHistory(which, event.inputType === 'historyUndo' ? 'undo' : 'redo'); }
    else rememberEdit(which);
  });
  pane.editor.addEventListener('blur', event => { if (!pane.completion.contains(event.relatedTarget)) hideCompletions(which); hideDiagnostic(which); });
  pane.editor.addEventListener('scroll', () => { pane.highlight.scrollTop = pane.editor.scrollTop; pane.highlight.scrollLeft = pane.editor.scrollLeft; pane.gutter.scrollTop = pane.editor.scrollTop; hideCompletions(which); hideReferencePeek(which); hideDiagnostic(which); });
  pane.editor.addEventListener('input', event => {
    const name = project.panes[which].active; if (!name) return;
    const previous = project.sourceFiles[name], next = pane.editor.value;
    if (!pane.applyingHistory) editHistory.record(name, previous, next, pane.beforeEdit || { start: pane.editor.selectionStart, end: pane.editor.selectionEnd }, event.isTrusted && ['insertText', 'deleteContentBackward'].includes(event.inputType) ? event.inputType : '');
    pane.applyingHistory = false; pane.beforeEdit = null;
    if (waitingInput?.session.filename === name) { runToken++; waitingInput = null; log('Run cancelled after source edit.', 'meta'); }
    project.sourceFiles[name] = next; if (builtFile === name) { lastCompiled = null; builtSource = null; }
    if (debugSession?.filename === name && previous !== next) stopDebug();
    diagnosticCoordinator.forget(name); problemsByFile[name] = [];
    hideDiagnostic(which);
    hideReferencePeek(which); pane.navHover = null; pane.editor.classList.remove('navigation-ready');
    renderCode(which); renderCode(which === 'primary' ? 'secondary' : 'primary'); updateStatus(); scheduleSave();
    if (activeConsole === 'references' && referenceQuery?.file === name) renderConsole();
    clearTimeout(diagnoseTimer); diagnoseTimer = setTimeout(() => diagnose(name), 250);
    if (pane.suppressCompletion) pane.suppressCompletion = false; else showCompletions(which);
  });
  pane.editor.addEventListener('keydown', event => {
    const data = pane.completionData;
    if (event.key === 'F9') { event.preventDefault(); toggleBreakpoint(project.panes[which].active, pane.editor.value.slice(0, pane.editor.selectionStart).split('\n').length); return; }
    if (event.key === 'F8') { event.preventDefault(); navigateProblem(which, event.shiftKey); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); changeHistory(which, event.shiftKey ? 'redo' : 'undo'); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); changeHistory(which, 'redo'); return; }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { showEditorContextMenu(event, which); return; }
    if (event.key === 'Escape' && !pane.peek.hidden) { event.preventDefault(); hideReferencePeek(which); return; }
    if (event.key === 'Control' || event.key === 'Meta') updateNavigationHover(which, { ctrlKey: true });
    if (event.key === 'F12') { event.preventDefault(); hideCompletions(which); if (event.shiftKey) showReferences(which); else goToDefinition(which); return; }
    if (event.key === 'F2') { event.preventDefault(); hideCompletions(which); renameEditorSymbol(which); return; }
    if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); navigateBack(); return; }
    if (data && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); data.selected = (data.selected + (event.key === 'ArrowDown' ? 1 : -1) + Math.min(12, data.items.length)) % Math.min(12, data.items.length); renderCompletions(which); return; }
    if (data && ['Tab', 'Enter'].includes(event.key)) { event.preventDefault(); acceptCompletion(which); return; }
    if (event.key === 'Escape' && data) { event.preventDefault(); hideCompletions(which); return; }
    if ((event.ctrlKey || event.metaKey) && event.code === 'Space') { event.preventDefault(); showCompletions(which, true); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === '/') { event.preventDefault(); hideCompletions(which); editLines(which, 'comment'); return; }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); hideCompletions(which); editLines(which, 'delete'); return; }
    if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); hideCompletions(which); moveLine(which, event.key === 'ArrowUp' ? -1 : 1); return; }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); hideCompletions(which); if (event.shiftKey) editLines(which, 'outdent'); else if (pane.editor.value.slice(pane.editor.selectionStart, pane.editor.selectionEnd).includes('\n')) editLines(which, 'indent'); else { rememberEdit(which); pane.editor.setRangeText('  ', pane.editor.selectionStart, pane.editor.selectionEnd, 'end'); pane.editor.dispatchEvent(new Event('input')); } return; }
    if (event.key === 'Enter') { const before = pane.editor.value.slice(0, pane.editor.selectionStart), indent = before.slice(before.lastIndexOf('\n') + 1).match(/^\s*/)[0]; if (indent) { event.preventDefault(); rememberEdit(which); pane.editor.setRangeText('\n' + indent, pane.editor.selectionStart, pane.editor.selectionEnd, 'end'); pane.editor.dispatchEvent(new Event('input')); } }
  });
  pane.searchInput.addEventListener('input', () => updateSearch(which));
  pane.searchInput.addEventListener('keydown', event => { if (event.key === 'Escape') { pane.search.hidden = true; renderCode(which); pane.editor.focus(); } else if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); findNext(which, event.shiftKey || event.key === 'ArrowUp', false); } });
  pane.replaceInput.addEventListener('keydown', event => { if (event.key === 'Escape') { pane.search.hidden = true; pane.editor.focus(); } else if (event.key === 'Enter') { event.preventDefault(); pane.search.querySelector('[data-search-action="replace"]').click(); } });
  pane.search.addEventListener('click', event => {
    const option = event.target.closest('[data-search-option]')?.dataset.searchOption;
    if (option) { pane.searchState[option] = !pane.searchState[option]; pane.search.querySelector(`[data-search-option="${option}"]`).setAttribute('aria-pressed', String(pane.searchState[option])); updateSearch(which); pane.searchInput.focus(); return; }
    const action = event.target.closest('[data-search-action]')?.dataset.searchAction; if (!action) return;
    if (action === 'close') { pane.search.hidden = true; renderCode(which); pane.editor.focus(); }
    else if (action === 'toggle-replace') { pane.search.classList.toggle('with-replace'); (pane.search.classList.contains('with-replace') ? pane.replaceInput : pane.searchInput).focus(); }
    else if (action === 'next' || action === 'previous') findNext(which, action === 'previous', false);
    else replaceSearch(which, action === 'all');
  });
}
$('example-count').textContent = String(examples.length + compilerExamples.length).padStart(2, '0');
for (const example of examples) { const button = document.createElement('button'); button.className = 'example-item'; button.innerHTML = `<span class="example-icon">◇</span><span>${escape(example.name)}</span>`; button.addEventListener('click', () => openExampleSource(example.filename, example.code)); $('example-list').append(button); }
const compilerFolder = document.createElement('details');
compilerFolder.className = 'compiler-example-folder';
const compilerFolderLabel = document.createElement('summary');
compilerFolderLabel.innerHTML = `<span>Self-hosted compiler</span><span class="compiler-example-count">${compilerExamples.length.toString().padStart(2, '0')}</span>`;
const compilerFiles = document.createElement('div');
compilerFiles.className = 'compiler-example-files';
for (const example of compilerExamples) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'example-item';
  button.title = example.description;
  button.innerHTML = `<span class="example-icon">◇</span><span>${example.filename}</span>`;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      let source = globalThis.__P2W_ASSETS__?.examples?.[example.filename];
      if (source === undefined) {
        const response = await fetch(new URL(`./examples/self-hosted-compiler/${example.filename}`, import.meta.url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        source = await response.text();
      }
      openExampleSource(example.filename, source);
    } catch {
      showToast(`Could not load ${example.filename}. Please try again.`);
    } finally {
      button.disabled = false;
    }
  });
  compilerFiles.append(button);
}
compilerFolder.append(compilerFolderLabel, compilerFiles);
$('example-list').append(compilerFolder);
$('stdin').value = project.input;
$('release-build').checked = project.releaseBuild;
$('release-build').addEventListener('change', () => { project.releaseBuild = $('release-build').checked; scheduleSave(); });
$('optimization-level').value = project.optimizationLevel;
$('optimization-level').addEventListener('change', () => { project.optimizationLevel = $('optimization-level').value; scheduleSave(); });
$('dialog-cancel').addEventListener('click', () => $('workspace-dialog').close());
$('stdin').addEventListener('input', scheduleSave);
$('file-editor').addEventListener('input', () => { if (selectedDataFile) { project.files[selectedDataFile] = $('file-editor').value; scheduleSave(); } });
$('add-file').addEventListener('click', () => showWorkspaceDialog({ title: 'New virtual file', description: 'Programs can read and write this file.', label: 'Filename', value: 'data.txt', submitLabel: 'Create file',
  validate: name => !name || !/^[\w. -]+$/.test(name) ? 'Use letters, numbers, spaces, dots, underscores, or hyphens.' : Object.hasOwn(project.files, name) ? 'A virtual file with this name already exists.' : null,
  onSubmit: name => { project.files[name] = ''; selectedDataFile = name; renderDataFiles(); save(); } }));
$('remove-file').addEventListener('click', () => { const name = selectedDataFile; if (!name) return; showWorkspaceDialog({ title: 'Delete virtual file', description: `Delete ${name} from this workspace?`, submitLabel: 'Delete file', danger: true,
  onSubmit: () => { delete project.files[name]; selectedDataFile = null; renderDataFiles(); save(); } }); });
$('new-source').addEventListener('click', newSource);
$('open-selected').addEventListener('click', () => openSources(selectedSourceNames()));
$('rename-source').addEventListener('click', () => renameSource(selectedSourceNames()[0] || activeName()));
$('delete-source').addEventListener('click', () => { const names = selectedSourceNames(); if (names.length) deleteSources(names); else deleteSource(); });
$('import-source').addEventListener('click', () => $('import-file').click()); $('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const files = [...event.target.files]; if (!files.length) return;
  try {
    for (const file of files) {
      const content = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) { const imported = normalizeProject(JSON.parse(content)); stopDebug(); project = imported; applyTheme(); selectedDataFile = null; problemsByFile = {}; lastCompiled = null; builtSource = null; builtFile = null; builtOptimization = null; $('stdin').value = project.input; $('release-build').checked = project.releaseBuild; $('optimization-level').value = project.optimizationLevel; renderDataFiles(); renderWorkspace(); save(); }
      else if (file.name.toLowerCase().endsWith('.pseudo')) { const name = uniqueFilename(validFilename(file.name) || 'imported.pseudo'); project.sourceFiles[name] = content; openSource(name); }
      else { project.files[file.name] = content; selectedDataFile = file.name; renderDataFiles(); save(); }
    }
  } catch (error) { showToast(`Could not open file: ${error.message}`); }
  event.target.value = '';
});
$('split-editor').addEventListener('click', splitEditor); $('close-split').addEventListener('click', closeSplit);
$('theme-select').addEventListener('change', event => { project.theme = THEMES.has(event.target.value) ? event.target.value : 'pseudo'; applyTheme(); save(); });
$('toggle-explorer').addEventListener('click', () => { project.layout.explorerVisible = !project.layout.explorerVisible; applyLayout(); scheduleSave(); });
$('toggle-tools').addEventListener('click', () => { project.layout.toolsVisible = !project.layout.toolsVisible; applyLayout(); scheduleSave(); });
$('toggle-terminal').addEventListener('click', () => { project.layout.terminalVisible = !project.layout.terminalVisible; applyLayout(); scheduleSave(); });
$('run-button').addEventListener('click', runProgram); $('compile-button').addEventListener('click', async () => { const result = await build({ release: $('release-build').checked }); switchConsole(result ? 'build' : 'diagnostics'); }); $('download-button').addEventListener('click', downloadWasm);
$('debug-button').addEventListener('click', debugProgram);
$('clear-output').addEventListener('click', () => { consoleLines = []; $('output-count').textContent = '0'; renderConsole(); });
document.querySelectorAll('[data-console-tab]').forEach(button => button.addEventListener('click', () => switchConsole(button.dataset.consoleTab)));
document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => switchTool(button.dataset.tool)));
$('quick-open-input').addEventListener('input', renderQuickOpen);
$('quick-open-input').addEventListener('keydown', event => {
  if (event.key === 'Escape') { $('quick-open').hidden = true; panes[project.activePane].editor.focus(); }
  else if (event.key === 'Enter') { event.preventDefault(); $('quick-open-list').querySelector('button')?.click(); }
  else if (event.key === 'ArrowDown') { event.preventDefault(); $('quick-open-list').querySelector('button')?.focus(); }
});
$('quick-open-list').addEventListener('keydown', event => {
  const items = [...$('quick-open-list').querySelectorAll('button')], index = items.indexOf(document.activeElement);
  if (event.key === 'Escape') { $('quick-open').hidden = true; panes[project.activePane].editor.focus(); }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
});
$('quick-open').addEventListener('mousedown', event => { if (event.target === $('quick-open')) $('quick-open').hidden = true; });
document.addEventListener('keydown', async event => {
  if (event.key === 'Escape' && !$('quick-open').hidden) { $('quick-open').hidden = true; return; }
  if (event.key === 'F5') { event.preventDefault(); if (event.shiftKey) stopDebug(); else if (debugSession?.status === 'paused') resumeDebug('continue'); else if (!debugSession || ['completed', 'failed'].includes(debugSession.status)) debugProgram(); return; }
  if (event.key === 'F10') { event.preventDefault(); if (debugSession?.status === 'paused') resumeDebug('step'); else if (!debugSession || ['completed', 'failed'].includes(debugSession.status)) debugProgram(); return; }
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === 'Enter') { event.preventDefault(); runProgram(); }
  else if (event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); const result = await build({ release: $('release-build').checked }); switchConsole(result ? 'build' : 'diagnostics'); }
  else if (event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
  else if (event.key.toLowerCase() === 'p') { event.preventDefault(); quickOpen(); }
  else if (event.key.toLowerCase() === 'f') { event.preventDefault(); showSearch(project.activePane); }
  else if (event.key.toLowerCase() === 'h') { event.preventDefault(); showSearch(project.activePane, true); }
  else if (event.key.toLowerCase() === 'g') { event.preventDefault(); showWorkspaceDialog({ title: 'Go to line', label: 'Line number', value: '1', submitLabel: 'Go', validate: value => !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > panes[project.activePane].editor.value.split('\n').length ? 'Enter a line number in the current file.' : null, onSubmit: value => { const editor = panes[project.activePane].editor; const position = editor.value.split('\n').slice(0, Number(value) - 1).reduce((sum, line) => sum + line.length + 1, 0); editor.focus(); editor.setSelectionRange(position, position); updateStatus(); updateDiagnosticAtCaret(project.activePane); } }); }
  else if (event.key === '\\') { event.preventDefault(); splitEditor(); }
  else if (event.key.toLowerCase() === 'w') { event.preventDefault(); if (activeName()) closeTab(project.activePane, activeName()); }
  else if (event.key === 'Tab') { event.preventDefault(); const state = project.panes[project.activePane]; if (state.tabs.length) { const index = state.tabs.indexOf(state.active), offset = event.shiftKey ? -1 : 1; openSource(state.tabs[(index + offset + state.tabs.length) % state.tabs.length]); } }
});
installResizer('left-resizer', 'x', 'explorerWidth', () => 150, () => Math.min(450, innerWidth - 380));
installResizer('right-resizer', 'x', 'toolsWidth', () => 220, () => Math.min(500, innerWidth - 380));
installResizer('bottom-resizer', 'y', 'bottomHeight', () => 120, () => Math.min(500, innerHeight - 220));
installSplitResizer();
installFileDragTargets();
installContextMenu();
window.addEventListener('resize', applyLayout);
renderDataFiles(); renderWorkspace(); renderConsole();
for (const name of Object.keys(project.sourceFiles)) diagnose(name);
