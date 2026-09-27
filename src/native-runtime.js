import { PseudoError } from './parser.js';

class InputRequired extends Error {
  constructor(label, line) { super('Input required'); this.label = label; this.line = line; }
}

const messages = {
  1: 'Execution limit exceeded', 2: 'Array index is outside its bounds',
  3: 'Division by zero', 4: 'Expected a finite number',
  5: 'Expected INTEGER', 6: 'FOR STEP must be a nonzero number', 7: 'WASM call stack is full',
};

export function createNativeRuntime(compiled, options = {}) {
  const output = [], files = { ...(options.files || {}) }, records = structuredClone(options.records || {});
  const input = Array.isArray(options.inputLines) ? [...options.inputLines] : String(options.input || '').replace(/\r/g, '').replace(/\n$/, '').split('\n').filter(Boolean);
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  let position = 0, fragment = '', wasm = null;
  let randomState = (options.seed ?? (Math.random() * 0x100000000)) >>> 0;
  const currentLine = () => wasm?.exports.line.value || 1;
  const readString = pointer => {
    if (!pointer) return '';
    const length = new DataView(wasm.exports.memory.buffer).getUint32(pointer, true);
    return decoder.decode(new Uint8Array(wasm.exports.memory.buffer, pointer + 4, length));
  };
  const storeString = value => {
    const bytes = encoder.encode(String(value)), pointer = wasm.exports.heapTop.value;
    const end = (pointer + 4 + bytes.length + 3) & ~3;
    if (end > wasm.exports.memory.buffer.byteLength) wasm.exports.memory.grow(Math.ceil((end - wasm.exports.memory.buffer.byteLength) / 65536));
    new DataView(wasm.exports.memory.buffer).setUint32(pointer, bytes.length, true);
    new Uint8Array(wasm.exports.memory.buffer, pointer + 4, bytes.length).set(bytes);
    wasm.exports.heapTop.value = end;
    return pointer;
  };
  const nextInput = label => {
    if (position >= input.length) {
      if (options.interactive) throw new InputRequired(label, currentLine());
      throw new PseudoError('INPUT needs another line', currentLine(), 1);
    }
    return String(input[position++]);
  };
  const env = {
    emitNumber: value => { fragment += String(value); },
    emitBoolean: value => { fragment += value ? 'TRUE' : 'FALSE'; },
    emitText: (offset, length) => { fragment += decoder.decode(new Uint8Array(wasm.exports.memory.buffer, offset, length)); },
    endLine: () => { output.push(fragment); options.onOutput?.(fragment); fragment = ''; },
    readNumber: (kind, labelId) => {
      const raw = nextInput(compiled.nativeLabels?.[labelId] || 'value');
      return kind === 2 ? Number(raw.toUpperCase() === 'TRUE') : Number(raw);
    },
    numberToString: value => storeString(String(value)),
    emitString: pointer => { fragment += readString(pointer); },
    readString: labelId => storeString(nextInput(compiled.nativeLabels?.[labelId] || 'value')),
    random: () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 0x100000000; },
    upper: pointer => storeString(readString(pointer).toUpperCase()),
    lower: pointer => storeString(readString(pointer).toLowerCase()),
    stringLength: pointer => readString(pointer).length,
    fail: (code, line) => { throw new PseudoError(messages[code] || 'Native WASM error', line, 1); },
    limit: () => Math.max(0, Math.min(0x7fffffff, options.maxSteps ?? 250000)),
  };
  return {
    env, output, files, records,
    get steps() { return wasm?.exports.steps.value || 0; },
    get line() { return currentLine(); },
    async run() {
      try {
        const result = await WebAssembly.instantiate(compiled.binary, { env });
        wasm = result.instance || result;
        wasm.exports.main();
        return { status: 'completed', output: [...output], files, records, steps: wasm.exports.steps.value, binary: compiled.binary, memory: wasm.exports.memory, stringBytes: wasm.exports.heapTop.value };
      } catch (error) {
        if (error instanceof InputRequired) return { status: 'waiting', output: [...output], files, records, steps: wasm?.exports.steps.value || 0, line: error.line, label: error.label, binary: compiled.binary };
        if (error instanceof PseudoError) throw error;
        throw new PseudoError(error.message, currentLine(), 1);
      }
    },
  };
}
