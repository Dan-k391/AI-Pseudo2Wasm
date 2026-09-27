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
  const hasSurrogateBytes = bytes => {
    for (let i = 0; i + 2 < bytes.length; i++) {
      if (bytes[i] === 0xed && bytes[i + 1] >= 0xa0 && bytes[i + 1] <= 0xbf) return true;
    }
    return false;
  };
  const encodeString = value => {
    if (!/[\uD800-\uDFFF]/.test(value)) return encoder.encode(value);
    const bytes = [];
    for (let i = 0; i < value.length; i++) {
      let code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
        const low = value.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
          i++;
        }
      }
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | code >> 6, 0x80 | code & 63);
      else if (code < 0x10000) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
      else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
    }
    return Uint8Array.from(bytes);
  };
  const decodeString = bytes => {
    if (!hasSurrogateBytes(bytes)) return decoder.decode(bytes);
    let result = '';
    for (let i = 0; i < bytes.length;) {
      const first = bytes[i++];
      if (first < 0x80) result += String.fromCharCode(first);
      else if (first < 0xe0) result += String.fromCharCode((first & 31) << 6 | (bytes[i++] & 63));
      else if (first < 0xf0) result += String.fromCharCode((first & 15) << 12 | (bytes[i++] & 63) << 6 | (bytes[i++] & 63));
      else result += String.fromCodePoint((first & 7) << 18 | (bytes[i++] & 63) << 12 | (bytes[i++] & 63) << 6 | (bytes[i++] & 63));
    }
    return result;
  };
  let position = 0, fragment = '', wasm = null;
  const stringCache = new Map();
  let randomState = (options.seed ?? (Math.random() * 0x100000000)) >>> 0;
  const currentLine = () => wasm?.exports.line.value || 1;
  const storeBytes = bytes => {
    const pointer = wasm.exports.heapTop.value;
    const end = (pointer + 4 + bytes.length + 3) & ~3;
    if (end > wasm.exports.memory.buffer.byteLength) wasm.exports.memory.grow(Math.ceil((end - wasm.exports.memory.buffer.byteLength) / 65536));
    new DataView(wasm.exports.memory.buffer).setUint32(pointer, bytes.length, true);
    new Uint8Array(wasm.exports.memory.buffer, pointer + 4, bytes.length).set(bytes);
    wasm.exports.heapTop.value = end;
    return pointer;
  };
  const storeString = value => {
    const source = String(value), pointer = storeBytes(encodeString(source));
    stringCache.set(pointer, source);
    return pointer;
  };
  const materialize = pointer => {
    if (!pointer) return 0;
    let view = new DataView(wasm.exports.memory.buffer);
    const header = view.getUint32(pointer, true);
    if (!(header & 0x80000000)) return pointer;
    const cached = view.getUint32(pointer + 12, true);
    if (cached) return cached;
    const bytes = new Uint8Array(header & 0x7fffffff);
    let offset = 0;
    const stack = [pointer];
    while (stack.length) {
      const part = stack.pop(), tag = view.getUint32(part, true);
      if (tag & 0x80000000) {
        const flat = view.getUint32(part + 12, true);
        if (flat) stack.push(flat);
        else stack.push(view.getUint32(part + 8, true), view.getUint32(part + 4, true));
      } else {
        bytes.set(new Uint8Array(wasm.exports.memory.buffer, part + 4, tag), offset);
        offset += tag;
      }
    }
    const flat = storeBytes(hasSurrogateBytes(bytes) ? encodeString(decodeString(bytes)) : bytes);
    view = new DataView(wasm.exports.memory.buffer);
    view.setUint32(pointer + 12, flat, true);
    return flat;
  };
  const readString = pointer => {
    if (!pointer) return '';
    if (stringCache.has(pointer)) return stringCache.get(pointer);
    const flat = materialize(pointer);
    const length = new DataView(wasm.exports.memory.buffer).getUint32(flat, true);
    const result = stringCache.get(flat) ?? decodeString(new Uint8Array(wasm.exports.memory.buffer, flat + 4, length));
    stringCache.set(pointer, result);
    stringCache.set(flat, result);
    return result;
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
    stringLength: pointer => {
      if (!pointer) return 0;
      const view = new DataView(wasm.exports.memory.buffer);
      return (view.getUint32(pointer, true) & 0x80000000)
        ? view.getUint32(pointer + 16, true)
        : readString(pointer).length;
    },
    chr: value => storeString(String.fromCodePoint(value)),
    asc: pointer => readString(pointer).codePointAt(0) ?? 0,
    left: (pointer, count) => storeString(readString(pointer).slice(0, count)),
    right: (pointer, count) => storeString(readString(pointer).slice(-count)),
    mid: (pointer, start, length) => storeString(readString(pointer).substr(start - 1, length)),
    strToNum: pointer => {
      const value = readString(pointer);
      if (!/^[-+]?\d+(?:\.\d+)?$/.test(value)) throw new PseudoError('Invalid numeric string', currentLine(), 1);
      return Number(value);
    },
    isNum: pointer => Number(/^[-+]?\d+(?:\.\d+)?$/.test(readString(pointer))),
    materialize,
    fail: (code, line) => { throw new PseudoError(messages[code] || 'Native WASM error', line, 1); },
    limit: () => Math.max(0, Math.min(0x7fffffff, options.maxSteps ?? 250000)),
  };
  return {
    env, output, files, records,
    get steps() { return wasm?.exports.steps.value || 0; },
    get line() { return currentLine(); },
    get heapTop() { return wasm?.exports.heapTop.value || 0; },
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
