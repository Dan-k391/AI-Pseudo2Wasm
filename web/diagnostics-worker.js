import { compileSelfHostedInBrowser } from './selfhost.js';
import { diagnosticsFromError } from './compiler-diagnostics.js';

self.onmessage = async ({ data: { id, name, source } }) => {
  let issues = [];
  try { await compileSelfHostedInBrowser(source); }
  catch (error) { issues = diagnosticsFromError(error, source); }
  self.postMessage({ id, name, source, issues });
};
