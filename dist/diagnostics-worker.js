import { compileSelfHostedInBrowser } from './selfhost.js';
import { diagnosticsFromError, mergeDiagnostics } from './compiler-diagnostics.js';
import { analyzeSource } from './language-service.js';

self.onmessage = async ({ data: { id, name, source } }) => {
  const editorIssues = analyzeSource(source);
  self.postMessage({ id, name, source, issues: editorIssues, partial: true });
  let compilerIssues = [];
  try { await compileSelfHostedInBrowser(source); }
  catch (error) { compilerIssues = diagnosticsFromError(error, source); }
  self.postMessage({ id, name, source, issues: mergeDiagnostics(editorIssues, compilerIssues) });
};
