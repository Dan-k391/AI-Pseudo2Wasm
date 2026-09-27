// Addressable variable slots share the module's linear memory with strings.
// A slot is 16 bytes: tag, pointer/length or f64 payload. Composite values
// retain a host handle; numeric and Boolean values are stored in the slot.
const NULL = 0, NUMBER = 1, BOOLEAN = 2, STRING = 3, HOST = 4, ALIAS = 5;

export class CellMemory {
  constructor(strings) {
    this.strings = strings;
    this.memory = strings.memory;
    this.entries = new Map();
    this.hostValues = new Map();
    this.freeAliases = [];
    this.refreshViews();
    strings.onGrow = () => this.refreshViews();
  }
  refreshViews() {
    this.words = new Uint32Array(this.memory.buffer);
    this.numbers = new Float64Array(this.memory.buffer);
  }
  slot() {
    if (this.strings.top & 7) this.strings.reserve(4);
    return this.strings.reserve(16);
  }
  store(address, value) {
    const word = address >>> 2;
    if (value === null || value === undefined) {
      this.words[word] = NULL; this.hostValues.delete(address);
    } else if (typeof value === 'number') {
      this.words[word] = NUMBER;
      this.numbers[(address + 8) >>> 3] = value;
      this.hostValues.delete(address);
    } else if (typeof value === 'boolean') {
      this.words[word] = BOOLEAN;
      this.words[word + 2] = value ? 1 : 0;
      this.hostValues.delete(address);
    } else if (typeof value === 'string' || value?.heap === this.strings) {
      const string = this.strings.from(value);
      this.words[word] = STRING;
      this.words[word + 1] = string.pointer;
      this.words[word + 2] = string.length;
      this.words[word + 3] = string.byteLength;
      this.hostValues.set(address, string);
    } else {
      this.words[word] = HOST;
      this.hostValues.set(address, value);
    }
  }
  load(address) {
    switch (this.words[address >>> 2]) {
      case NULL: return null;
      case NUMBER: return this.numbers[(address + 8) >>> 3];
      case BOOLEAN: return !!this.words[(address >>> 2) + 2];
      case STRING: case HOST: return this.hostValues.get(address);
      default: throw new Error('Invalid variable slot');
    }
  }
  promote(cell, label) {
    if (cell.__memoryRef !== undefined) return cell.__memoryRef;
    const address = this.slot(), value = cell.value;
    this.store(address, value);
    const reference = BigInt(address);
    Object.defineProperty(cell, '__memoryRef', { value: reference });
    Object.defineProperty(cell, '__memoryAddress', { value: address });
    this.entries.set(reference, { address, cell, label, transient: false, leases: 0 });
    return reference;
  }
  sync(cell) {
    const address = cell.__memoryAddress;
    if (address === undefined) return;
    const value = cell.value, word = address >>> 2;
    if (typeof value === 'number') {
      if (this.words[word] !== NUMBER) this.hostValues.delete(address);
      this.words[word] = NUMBER;
      this.numbers[(address + 8) >>> 3] = value;
    } else if (typeof value === 'boolean') {
      if (this.words[word] !== BOOLEAN) this.hostValues.delete(address);
      this.words[word] = BOOLEAN;
      this.words[word + 2] = value ? 1 : 0;
    } else this.store(address, value);
  }
  syncAll() {
    for (const entry of this.entries.values()) if (!entry.transient) this.store(entry.address, entry.cell.value);
  }
  alias(cell, label) {
    const address = this.freeAliases.pop() ?? this.slot();
    this.words[address >>> 2] = ALIAS;
    const reference = BigInt(address);
    this.entries.set(reference, { address, cell, label, transient: true, leases: 1 });
    return reference;
  }
  has(reference) { return typeof reference === 'bigint' && this.entries.has(reference); }
  lookup(reference) { return typeof reference === 'bigint' ? this.entries.get(reference) : undefined; }
  entry(reference) {
    const entry = this.entries.get(reference);
    if (!entry) throw new Error('Invalid BYREF address');
    return entry;
  }
  cell(reference) { return this.entry(reference).cell; }
  label(reference) { return this.entry(reference).label; }
  retain(reference) { const entry = this.entry(reference); if (entry.transient) entry.leases++; return reference; }
  release(reference) {
    const entry = this.entries.get(reference);
    if (!entry?.transient) return;
    if (--entry.leases > 0) return;
    this.entries.delete(reference);
    this.words[entry.address >>> 2] = NULL;
    this.freeAliases.push(entry.address);
  }
}
