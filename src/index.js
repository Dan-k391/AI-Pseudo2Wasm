import { parse, PseudoError } from './parser.js';
import { compileAst } from './wasm.js';
import { createRuntime } from './runtime.js';

export { parse, PseudoError, compileAst, createRuntime };
export function compile(source) { return compileAst(parse(source)); }
export async function run(source, options = {}) {
  const compiled = compile(source);
  return createRuntime(compiled, options).run();
}
