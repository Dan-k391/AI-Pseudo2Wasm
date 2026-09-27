import { parse } from './src/parser.js';
import { createRuntime } from './src/runtime.js';
import { advancedExamples } from './examples.js';
import { compileSelfHostedInBrowser } from './selfhost.js';

const $ = id => document.getElementById(id);
const app = document.querySelector('.app');
const consoleContent = $('console-content');
const STORAGE = 'pseudo2wasm.project.v2';
const panes = {
  primary: { group: $('primary-group'), tabs: $('primary-tabs'), editor: $('primary-editor'), highlight: $('primary-highlight'), gutter: $('primary-gutter') },
  secondary: { group: $('secondary-group'), tabs: $('secondary-tabs'), editor: $('secondary-editor'), highlight: $('secondary-highlight'), gutter: $('secondary-gutter') },
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
    activePane: raw?.activePane === 'secondary' && secondaryActive ? 'secondary' : 'primary',
    split: !!raw?.split && !!secondaryActive,
    input: String(raw?.input || ''), files: raw?.files && typeof raw.files === 'object' ? raw.files : {}, records: raw?.records && typeof raw.records === 'object' ? raw.records : {},
    layout: { explorerWidth: Number(layout.explorerWidth) || (innerWidth < 800 ? 180 : 218), toolsWidth: Number(layout.toolsWidth) || 292, bottomHeight: Number(layout.bottomHeight) || 230, splitRatio: Number(layout.splitRatio) || 50, explorerVisible: layout.explorerVisible ?? innerWidth > 660, toolsVisible: layout.toolsVisible ?? innerWidth > 1100, terminalVisible: layout.terminalVisible ?? true },
  };
}
let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORAGE) || localStorage.getItem('pseudo2wasm.project.v1') || 'null'); } catch {}
let project = normalizeProject(saved);
let selectedDataFile = null, lastCompiled = null, builtFile = null, builtSource = null, buildInfo = null;
let problemsByFile = {}, activeConsole = 'output', consoleLines = [], waitingInput = null, runToken = 0, saveTimer = null, diagnoseTimer = null;
let draggedFile = null;

const activeName = () => project.panes[project.activePane].active;
const activeSource = () => project.sourceFiles[activeName()] ?? '';
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  return html + escape(source.slice(last)) + '\n';
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
  openSource(copy, which);
}
function downloadSource(name) { downloadBlob(new Blob([project.sourceFiles[name]], { type: 'text/plain;charset=utf-8' }), name); }
function showFileContextMenu(event, name, which = null) {
  if (!Object.hasOwn(project.sourceFiles, name)) return;
  event.preventDefault(); event.stopPropagation(); hideContextMenu();
  const menu = $('editor-context-menu'); menu._invoker = event.currentTarget;
  const addAction = (label, action, { danger = false, disabled = false } = {}) => {
    const button = document.createElement('button'); button.type = 'button'; button.role = 'menuitem'; button.textContent = label;
    button.disabled = disabled; button.className = danger ? 'context-danger' : '';
    button.addEventListener('click', () => { hideContextMenu(true); action(); }); menu.append(button);
  };
  const divider = () => { const line = document.createElement('div'); line.className = 'context-divider'; line.role = 'separator'; menu.append(line); };
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
  menu.hidden = false;
  const anchor = event.currentTarget.getBoundingClientRect(), x = event.clientX || anchor.left + 16, y = event.clientY || anchor.bottom;
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
  $('source-count').textContent = String(names.length).padStart(2, '0');
  for (const name of names) {
    const item = document.createElement('button'); item.className = `source-item${name === activeName() ? ' active' : ''}`; item.title = `Open ${name}. Drag to reorder or open in an editor. Alt-click to open in the other editor.`; item.draggable = true; item.dataset.file = name;
    const glyph = document.createElement('span'); glyph.className = 'file-glyph'; glyph.textContent = '◇';
    const label = document.createElement('span'); label.className = 'source-item-name'; label.textContent = name;
    item.append(glyph, label);
    if (project.panes.primary.tabs.includes(name) || project.panes.secondary.tabs.includes(name)) { const dot = document.createElement('span'); dot.className = 'open-indicator'; dot.textContent = '●'; item.append(dot); }
    item.addEventListener('click', event => openSource(name, event.altKey ? (project.activePane === 'primary' ? 'secondary' : 'primary') : project.activePane));
    item.addEventListener('contextmenu', event => showFileContextMenu(event, name));
    item.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showFileContextMenu(event, name); });
    item.addEventListener('dragstart', event => beginFileDrag(event, name, null));
    list.append(item);
  }
}
function renderTabs(which) {
  const state = project.panes[which], root = panes[which].tabs; root.replaceChildren();
  for (const name of state.tabs) {
    const tab = document.createElement('div'); tab.className = `source-tab${state.active === name ? ' active' : ''}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.active === name)); tab.tabIndex = 0; tab.title = `Drag to reorder or move ${name} to another editor`; tab.draggable = true; tab.dataset.file = name;
    const glyph = document.createElement('span'); glyph.className = 'file-glyph'; glyph.textContent = '◇';
    const label = document.createElement('span'); label.className = 'source-tab-name'; label.textContent = name;
    const close = document.createElement('button'); close.className = 'tab-close'; close.type = 'button'; close.setAttribute('aria-label', `Close ${name} in ${which} editor`); close.textContent = '×';
    close.addEventListener('click', event => { event.stopPropagation(); closeTab(which, name); });
    tab.addEventListener('click', () => openSource(name, which));
    tab.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showFileContextMenu(event, name, which); else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSource(name, which); } });
    tab.addEventListener('contextmenu', event => showFileContextMenu(event, name, which));
    tab.addEventListener('dragstart', event => beginFileDrag(event, name, which));
    tab.append(glyph, label, close); root.append(tab);
  }
}
function renderCode(which) {
  const pane = panes[which], name = project.panes[which].active;
  pane.group.classList.toggle('empty', !name);
  if (!name) { pane.editor.value = ''; pane.highlight.textContent = ''; pane.gutter.textContent = ''; return; }
  const source = project.sourceFiles[name] ?? '';
  if (pane.editor.value !== source) pane.editor.value = source;
  pane.highlight.innerHTML = colorize(source);
  const errors = problemsByFile[name] || [];
  pane.gutter.innerHTML = Array.from({ length: source.split('\n').length }, (_, i) => `<div class="${errors.some(p => p.line === i + 1) ? 'error-line' : ''}">${i + 1}</div>`).join('');
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
  $('diagnostic-summary').textContent = waitingInput ? `Waiting for ${waitingInput.label} at line ${waitingInput.line}` : problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'} in ${name}` : 'No problems';
}
function renderWorkspace() {
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
function insertFileAt(list, name, target, after) {
  if (target === name && list.includes(name)) return list;
  const next = list.filter(item => item !== name);
  const index = target ? next.indexOf(target) : -1;
  next.splice(index < 0 ? next.length : index + Number(after), 0, name);
  return next;
}
function beginFileDrag(event, name, fromPane) {
  if (!event.dataTransfer || !Object.hasOwn(project.sourceFiles, name)) return;
  draggedFile = { name, fromPane };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', name);
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
    project.fileOrder = insertFileAt(project.fileOrder, draggedFile.name, item?.dataset.file, rect ? event.clientY >= rect.top + rect.height / 2 : true);
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
    const position = editorDropPosition(event), { name, fromPane } = draggedFile;
    endFileDrag(); placeFileInEditor(name, position.which, position.target, position.after, fromPane);
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
    onSubmit: name => { project.sourceFiles[name] = ''; openSource(name); } });
}
function renameSource(old = activeName()) {
  if (!old || !Object.hasOwn(project.sourceFiles, old)) return;
  showWorkspaceDialog({ title: 'Rename file', description: `Rename ${old} in this workspace.`, label: 'Filename', value: old, submitLabel: 'Rename',
    validate: name => !validFilename(name) ? 'Enter a filename ending in .pseudo.' : name !== old && Object.hasOwn(project.sourceFiles, name) ? 'A file with this name already exists.' : null,
    onSubmit: name => {
      if (name === old) return;
      const entries = Object.entries(project.sourceFiles).map(([k, v]) => [k === old ? name : k, v]); project.sourceFiles = Object.fromEntries(entries);
      project.fileOrder = project.fileOrder.map(k => k === old ? name : k);
      for (const state of Object.values(project.panes)) { state.tabs = state.tabs.map(k => k === old ? name : k); if (state.active === old) state.active = name; }
      if (problemsByFile[old]) { problemsByFile[name] = problemsByFile[old]; delete problemsByFile[old]; }
      if (builtFile === old) builtFile = name;
      renderWorkspace(); scheduleSave();
    } });
}
function removeSource(name) {
  delete project.sourceFiles[name]; delete problemsByFile[name];
  project.fileOrder = project.fileOrder.filter(k => k !== name);
  for (const state of Object.values(project.panes)) { state.tabs = state.tabs.filter(k => k !== name); if (state.active === name) state.active = state.tabs.at(-1) || null; }
  if (builtFile === name) { builtFile = null; builtSource = null; lastCompiled = null; }
  if (project.split && !project.panes.secondary.tabs.length) project.split = false;
  if (!Object.keys(project.sourceFiles).length) { project.sourceFiles['main.pseudo'] = ''; project.panes.primary.tabs = ['main.pseudo']; project.panes.primary.active = 'main.pseudo'; }
  if (!project.panes[project.activePane].active || (project.activePane === 'secondary' && !project.split)) project.activePane = 'primary';
  renderWorkspace(); scheduleSave();
}
function deleteSource(name = activeName()) {
  if (!name || !Object.hasOwn(project.sourceFiles, name)) return;
  showWorkspaceDialog({ title: 'Delete file', description: `Delete ${name} from this workspace? This removes its saved source code.`, submitLabel: 'Delete file', danger: true, onSubmit: () => removeSource(name) });
}
function setProblems(name, items) {
  if (name) problemsByFile[name] = items;
  for (const id of ['primary', 'secondary']) if (project.panes[id].active === name) renderCode(id);
  updateStatus(); if (activeConsole === 'diagnostics') renderConsole();
}
function diagnose(name) {
  if (!name) return;
  try { parse(project.sourceFiles[name]); setProblems(name, []); }
  catch (error) { setProblems(name, [{ line: error.line || 1, column: error.column || 1, message: error.message }]); }
}
function log(text, kind = 'line') { consoleLines.push({ text, kind }); $('output-count').textContent = consoleLines.filter(x => x.kind === 'line').length; if (activeConsole === 'output') renderConsole(); }
function renderConsole() {
  consoleContent.replaceChildren();
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
    for (const issue of issues) { const row = document.createElement('div'); row.className = 'problem-item'; const loc = document.createElement('strong'); loc.textContent = `Ln ${issue.line}:${issue.column}`; row.append(loc, document.createTextNode(issue.message)); consoleContent.append(row); }
  } else {
    const info = document.createElement('div'); info.className = 'build-log';
    if (buildInfo) info.innerHTML = `<strong>${escape(buildInfo.name)} · self-hosted build succeeded</strong><br>WebAssembly module: ${buildInfo.size.toLocaleString()} bytes<br>Routines: ${buildInfo.routines}<br>Imports: ${buildInfo.imports}<br>Compiled in ${buildInfo.ms.toFixed(1)} ms`;
    else info.textContent = 'Compile the active source file to inspect its WebAssembly module.';
    consoleContent.append(info);
    if (buildInfo) { const button = document.createElement('button'); button.className = 'tiny-button'; button.style.marginTop = '14px'; button.textContent = 'Download project .json'; button.addEventListener('click', downloadProject); consoleContent.append(button); }
  }
}
function switchConsole(tab) { activeConsole = tab; document.querySelectorAll('[data-console-tab]').forEach(button => button.classList.toggle('active', button.dataset.consoleTab === tab)); renderConsole(); }
async function build() {
  const name = activeName(); if (!name) { log('Open a source file before compiling.', 'error'); return null; }
  const source = activeSource(), start = performance.now();
  try {
    const result = await compileSelfHostedInBrowser(source);
    if (!WebAssembly.validate(result.binary)) throw new Error('Generated WebAssembly module did not validate');
    if (name !== activeName() || source !== activeSource()) return null;
    const ms = performance.now() - start;
    lastCompiled = result; builtFile = name; builtSource = source;
    buildInfo = { name, size: result.binary.length, routines: result.routines.length, imports: WebAssembly.Module.imports(new WebAssembly.Module(result.binary)).length, ms };
    $('build-status').textContent = `${name} · succeeded`; $('build-size').textContent = `${result.binary.length.toLocaleString()} bytes · ${ms.toFixed(1)} ms`;
    setProblems(name, []); return result;
  } catch (error) {
    lastCompiled = null; builtFile = null; builtSource = null; buildInfo = null;
    $('build-status').textContent = `${name} · failed`; $('build-size').textContent = `Line ${error.line || 1}`;
    setProblems(name, [{ line: error.line || 1, column: error.column || 1, message: error.message }]); switchConsole('diagnostics'); return null;
  }
}
async function runProgram() {
  runToken++; waitingInput = null; consoleLines = []; $('output-count').textContent = '0'; switchConsole('output');
  const name = activeName(), source = activeSource();
  const compiled = builtFile === name && builtSource === source && lastCompiled ? lastCompiled : await build();
  if (!compiled) { switchConsole('diagnostics'); return; }
  const preload = $('stdin').value.replace(/\r/g, '').replace(/\n$/, '');
  const session = { token: runToken, filename: name, compiled, files: structuredClone(project.files), records: structuredClone(project.records || {}), inputLines: preload ? preload.split('\n') : [], printed: 0, runtimeMs: 0, seed: (Math.random() * 0x100000000) >>> 0, today: new Date().toISOString() };
  await continueRun(session);
}
async function continueRun(session) {
  if (session.token !== runToken) return;
  $('run-button').disabled = true; $('run-button').textContent = 'Running…';
  try {
    const start = performance.now();
    const runtime = createRuntime(session.compiled, { inputLines: session.inputLines, files: session.files, records: session.records, interactive: true, seed: session.seed, today: session.today, maxSteps: 250000 });
    const done = await runtime.run(); session.runtimeMs += performance.now() - start;
    if (session.token !== runToken) return;
    for (const line of done.output.slice(session.printed)) log(line);
    session.printed = done.output.length;
    if (done.status === 'waiting') { waitingInput = { line: done.line, label: done.label, session }; project.layout.terminalVisible = true; applyLayout(); updateStatus(); switchConsole('output'); $('terminal-input')?.focus(); return; }
    project.files = done.files; project.records = done.records; renderDataFiles(); save();
    log(`${session.filename} finished · ${done.steps.toLocaleString()} steps · ${session.runtimeMs.toFixed(1)} ms`, 'meta');
    setProblems(session.filename, []);
  } catch (error) { log(`${session.filename}, line ${error.line || '?'}: ${error.message}`, 'error'); setProblems(session.filename, [{ line: error.line || 1, column: error.column || 1, message: error.message }]); }
  finally { $('run-button').disabled = false; $('run-button').innerHTML = '<span class="play-icon">▶</span> Run program'; }
}
function downloadBlob(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 3000); }
async function downloadWasm() { const name = activeName(), compiled = builtFile === name && builtSource === activeSource() && lastCompiled ? lastCompiled : await build(); if (compiled) downloadBlob(new Blob([compiled.binary], { type: 'application/wasm' }), name.replace(/\.pseudo$/i, '') + '.wasm'); }
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

for (const which of ['primary', 'secondary']) {
  const pane = panes[which], empty = document.createElement('div'); empty.className = 'editor-empty'; empty.textContent = 'Open a pseudocode file from Explorer'; pane.group.append(empty);
  pane.editor.addEventListener('focus', () => setActivePane(which));
  pane.editor.addEventListener('click', updateStatus); pane.editor.addEventListener('keyup', updateStatus);
  pane.editor.addEventListener('scroll', () => { pane.highlight.scrollTop = pane.editor.scrollTop; pane.highlight.scrollLeft = pane.editor.scrollLeft; pane.gutter.scrollTop = pane.editor.scrollTop; });
  pane.editor.addEventListener('input', () => {
    const name = project.panes[which].active; if (!name) return;
    if (waitingInput?.session.filename === name) { runToken++; waitingInput = null; log('Run cancelled after source edit.', 'meta'); }
    project.sourceFiles[name] = pane.editor.value; if (builtFile === name) { lastCompiled = null; builtSource = null; }
    renderCode(which); renderCode(which === 'primary' ? 'secondary' : 'primary'); updateStatus(); scheduleSave();
    clearTimeout(diagnoseTimer); diagnoseTimer = setTimeout(() => diagnose(name), 250);
  });
  pane.editor.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.ctrlKey) { event.preventDefault(); const a = pane.editor.selectionStart, b = pane.editor.selectionEnd; pane.editor.setRangeText('  ', a, b, 'end'); pane.editor.dispatchEvent(new Event('input')); }
    if (event.key === 'Enter') { const before = pane.editor.value.slice(0, pane.editor.selectionStart), indent = before.slice(before.lastIndexOf('\n') + 1).match(/^\s*/)[0]; if (indent) { event.preventDefault(); pane.editor.setRangeText('\n' + indent, pane.editor.selectionStart, pane.editor.selectionEnd, 'end'); pane.editor.dispatchEvent(new Event('input')); } }
  });
}
$('example-count').textContent = String(examples.length).padStart(2, '0');
for (const example of examples) { const button = document.createElement('button'); button.className = 'example-item'; button.innerHTML = `<span class="example-icon">◇</span><span>${escape(example.name)}</span>`; button.addEventListener('click', () => { const name = uniqueFilename(example.filename); project.sourceFiles[name] = example.code; openSource(name); }); $('example-list').append(button); }
$('stdin').value = project.input;
$('dialog-cancel').addEventListener('click', () => $('workspace-dialog').close());
$('stdin').addEventListener('input', scheduleSave);
$('file-editor').addEventListener('input', () => { if (selectedDataFile) { project.files[selectedDataFile] = $('file-editor').value; scheduleSave(); } });
$('add-file').addEventListener('click', () => showWorkspaceDialog({ title: 'New virtual file', description: 'Programs can read and write this file.', label: 'Filename', value: 'data.txt', submitLabel: 'Create file',
  validate: name => !name || !/^[\w. -]+$/.test(name) ? 'Use letters, numbers, spaces, dots, underscores, or hyphens.' : Object.hasOwn(project.files, name) ? 'A virtual file with this name already exists.' : null,
  onSubmit: name => { project.files[name] = ''; selectedDataFile = name; renderDataFiles(); save(); } }));
$('remove-file').addEventListener('click', () => { const name = selectedDataFile; if (!name) return; showWorkspaceDialog({ title: 'Delete virtual file', description: `Delete ${name} from this workspace?`, submitLabel: 'Delete file', danger: true,
  onSubmit: () => { delete project.files[name]; selectedDataFile = null; renderDataFiles(); save(); } }); });
$('new-source').addEventListener('click', newSource); $('rename-source').addEventListener('click', () => renameSource()); $('delete-source').addEventListener('click', () => deleteSource());
$('import-source').addEventListener('click', () => $('import-file').click()); $('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async event => {
  const files = [...event.target.files]; if (!files.length) return;
  try {
    for (const file of files) {
      const content = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) { project = normalizeProject(JSON.parse(content)); selectedDataFile = null; problemsByFile = {}; lastCompiled = null; builtSource = null; builtFile = null; $('stdin').value = project.input; renderDataFiles(); renderWorkspace(); save(); }
      else if (file.name.toLowerCase().endsWith('.pseudo')) { const name = uniqueFilename(validFilename(file.name) || 'imported.pseudo'); project.sourceFiles[name] = content; openSource(name); }
      else { project.files[file.name] = content; selectedDataFile = file.name; renderDataFiles(); save(); }
    }
  } catch (error) { showToast(`Could not open file: ${error.message}`); }
  event.target.value = '';
});
$('split-editor').addEventListener('click', splitEditor); $('close-split').addEventListener('click', closeSplit);
$('toggle-explorer').addEventListener('click', () => { project.layout.explorerVisible = !project.layout.explorerVisible; applyLayout(); scheduleSave(); });
$('toggle-tools').addEventListener('click', () => { project.layout.toolsVisible = !project.layout.toolsVisible; applyLayout(); scheduleSave(); });
$('toggle-terminal').addEventListener('click', () => { project.layout.terminalVisible = !project.layout.terminalVisible; applyLayout(); scheduleSave(); });
$('run-button').addEventListener('click', runProgram); $('compile-button').addEventListener('click', async () => { const result = await build(); switchConsole(result ? 'build' : 'diagnostics'); }); $('download-button').addEventListener('click', downloadWasm);
$('clear-output').addEventListener('click', () => { consoleLines = []; $('output-count').textContent = '0'; renderConsole(); });
document.querySelectorAll('[data-console-tab]').forEach(button => button.addEventListener('click', () => switchConsole(button.dataset.consoleTab)));
document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => switchTool(button.dataset.tool)));
document.addEventListener('keydown', async event => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === 'Enter') { event.preventDefault(); runProgram(); }
  else if (event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); const result = await build(); switchConsole(result ? 'build' : 'diagnostics'); }
  else if (event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
  else if (event.key === '\\') { event.preventDefault(); splitEditor(); }
  else if (event.key.toLowerCase() === 'w') { event.preventDefault(); if (activeName()) closeTab(project.activePane, activeName()); }
  else if (event.key === 'Tab') { event.preventDefault(); const state = project.panes[project.activePane]; if (state.tabs.length) { const index = state.tabs.indexOf(state.active); openSource(state.tabs[(index + 1) % state.tabs.length]); } }
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
