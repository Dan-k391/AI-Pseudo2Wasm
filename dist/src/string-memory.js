// Strings live in the module's linear memory as [byte length:u32][UTF-8 bytes].
// Concatenation uses a rope until its bytes are needed, avoiding quadratic copies.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class MemoryString {
  constructor(heap, { pointer = 0, byteLength = 0, length = 0, left = null, right = null, cached = null }) {
    this.heap = heap; this.pointer = pointer; this.byteLength = byteLength; this.length = length;
    this.left = left; this.right = right; this.cached = cached;
  }
  toString() { return this.heap.read(this); }
  [Symbol.toPrimitive]() { return this.toString(); }
}

export class StringMemory {
  constructor(memory, strings = [], hasStaticData = false) {
    this.memory = memory;
    this.top = 8;
    this.interned = new Map();
    this.literals = [];
    if (hasStaticData) {
      const view = new DataView(memory.buffer);
      for (const source of strings) {
        const pointer = this.top, byteLength = view.getUint32(pointer, true);
        const actual = decoder.decode(new Uint8Array(memory.buffer, pointer + 4, byteLength));
        if (actual !== source) throw new Error('Invalid static string data in WebAssembly memory');
        const value = new MemoryString(this, { pointer, byteLength, length: source.length, cached: source });
        this.literals.push(value);
        if (source.length <= 128) this.interned.set(source, value);
        this.top = (pointer + 4 + byteLength + 3) & ~3;
      }
    }
    this.empty = this.interned.get('') || this.allocate('');
    this.interned.set('', this.empty);
  }
  literal(index) { return this.literals[index]; }
  reserve(size) {
    const end = this.top + size;
    if (end > this.memory.buffer.byteLength) this.memory.grow(Math.ceil((end - this.memory.buffer.byteLength) / 65536));
    const pointer = this.top;
    this.top = (end + 3) & ~3;
    return pointer;
  }
  allocate(value) {
    const source = String(value), bytes = encoder.encode(source);
    const pointer = this.reserve(4 + bytes.length);
    const view = new DataView(this.memory.buffer);
    view.setUint32(pointer, bytes.length, true);
    new Uint8Array(this.memory.buffer, pointer + 4, bytes.length).set(bytes);
    return new MemoryString(this, { pointer, byteLength: bytes.length, length: source.length, cached: source });
  }
  from(value) {
    if (value instanceof MemoryString) return value;
    if (typeof value !== 'string') return value;
    if (value.length > 128) return this.allocate(value);
    let result = this.interned.get(value);
    if (!result) { result = this.allocate(value); this.interned.set(value, result); }
    return result;
  }
  concat(left, right) {
    left = this.from(left); right = this.from(right);
    if (!left.length) return right;
    if (!right.length) return left;
    return new MemoryString(this, { left, right, length: left.length + right.length });
  }
  read(value) {
    if (value.cached !== null) return value.cached;
    if (value.left) {
      const parts = [], stack = [value];
      while (stack.length) {
        const part = stack.pop();
        if (part.left) stack.push(part.right, part.left);
        else parts.push(part.cached ?? decoder.decode(new Uint8Array(this.memory.buffer, part.pointer + 4, part.byteLength)));
      }
      const text = parts.join('');
      const stored = this.allocate(text);
      value.pointer = stored.pointer; value.byteLength = stored.byteLength;
      value.left = null; value.right = null; value.cached = text;
      return text;
    }
    return decoder.decode(new Uint8Array(this.memory.buffer, value.pointer + 4, value.byteLength));
  }
  // Use this when exposing runtime state to callers or saving virtual records.
  plain(value) {
    if (value instanceof MemoryString) return value.toString();
    if (Array.isArray(value)) return value.map(item => this.plain(item));
    if (value instanceof Set) return new Set([...value].map(item => this.plain(item)));
    if (value && value.__array) return { ...value, data: value.data.map(item => this.plain(item)) };
    if (value && typeof value === 'object' && !(value instanceof Date) && !value.__object && !value.__pointer && !value.__ref) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.plain(item)]));
    return value;
  }
}
