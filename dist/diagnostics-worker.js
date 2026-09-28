import { compileSelfHostedInBrowser } from './selfhost.js';
import { diagnosticFromError } from './compiler-diagnostics.js';

self.onmessage = async ({ data: { id, name, source } }) => {
  let issue = null;
  try { await compileSelfHostedInBrowser(source); }
  catch (error) { issue = diagnosticFromError(error, source); }
  self.postMessage({ id, name, source, issue });
};
