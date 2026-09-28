import { createRuntime } from './runtime.js';
import { PseudoError } from './parser.js';

const fromLatin1 = value => Uint8Array.from(value, char => char.charCodeAt(0));

function decodeType(spec, strictBounds = false) {
  if (spec.startsWith('\x1f')) spec = spec.slice(1);
  if (spec.startsWith('ARRAY|')) {
    const [, dimensions, element] = spec.split('|');
    const ranges = dimensions.split(',').map(bounds => {
      const [rawLo, rawHi] = bounds.split(':');
      if (rawLo === undefined || rawHi === undefined) throw new Error(`Invalid array bounds ${bounds}`);
      const decodeBound = value => {
        value = value.trim();
        if (/^[-+]?\d+$/.test(value)) return { kind: 'literal', value: Number(value) };
        if (/^[A-Z_][A-Z0-9_]*$/.test(value)) return { kind: 'name', name: value };
        if (strictBounds) throw new Error(`Unsupported array bound in type alias: ${value}`);
        // Inline arrays receive evaluated bounds from the generated WASM.
        return { kind: 'literal', value: 0 };
      };
      return { lo: decodeBound(rawLo), hi: decodeBound(rawHi) };
    });
    return { kind: 'array', ranges, of: { kind: 'named', name: element } };
  }
  if (spec.startsWith('SET|')) return { kind: 'set', of: { kind: 'named', name: spec.slice(4) } };
  if (spec.startsWith('POINTER|')) return { kind: 'pointer', to: { kind: 'named', name: spec.slice(8) } };
  if (spec.startsWith('ENUM|')) return { kind: 'enum', values: spec.slice(5).split(',').map(value => value.trim()) };
  if (spec.startsWith('NAMED|')) return { kind: 'named', name: spec.slice(6) };
  return JSON.parse(spec);
}

// The CAIE program emits its own string table and complete WASM binary.
// JavaScript only transports the input and output through the existing ABI.
function decodeSelfHostedMetadata(ir) {
  const types = {};
  const classes = {};
  const routines = [];
  const instructions = [];
  for (const line of ir) {
    if (line.startsWith('M:CONST:')) {
      // The native lowerer consumes constant metadata; the compatibility
      // assembler already receives its executable declaration IR below.
    } else if (line.startsWith('M:TYPE:')) {
      const separator = line.indexOf(':', 7);
      if (separator < 0) throw new Error(`Invalid type metadata: ${line}`);
      const name = line.slice(7, separator);
      if (Object.hasOwn(types, name)) throw new Error(`Duplicate type ${name}`);
      const spec = line.slice(separator + 1);
      if (spec.startsWith('RECORD:')) {
        const fields = spec.slice(7).split(';').filter(Boolean).map(field => {
          const at = field.indexOf(',');
          if (at < 1) throw new Error(`Invalid record field ${field}`);
          return { kind: 'declare', names: [field.slice(0, at)], type: { kind: 'named', name: field.slice(at + 1) } };
        });
        types[name] = { kind: 'record', fields };
      } else types[name] = decodeType(spec, true);
    } else if (line.startsWith('M:CLASS:')) {
      const [, , name, parent, fields = ''] = line.split(':');
      const declarations = fields.split(';').filter(Boolean).map(field => {
        const [name, type, access] = field.split(',');
        return { kind: 'declare', names: [name], type: { kind: 'named', name: type }, access };
      });
      classes[name] = { parent: parent || null, fields: declarations, methods: classes[name]?.methods || {} };
    } else if (line.startsWith('M:METHOD:')) {
      const [, , className, kind, name, returns, params = '', access = 'PUBLIC'] = line.split(':');
      if (!classes[className]) classes[className] = { parent: null, fields: [], methods: {} };
      const parameters = params.split(';').filter(Boolean).map(spec => {
        const [name, type, ref] = spec.split(',');
        return { name, type: { kind: 'named', name: type }, byref: ref === '1' };
      });
      const returnType = returns ? { kind: 'named', name: returns } : null;
      const exportName = `${className}.${name}`;
      classes[className].methods[name] = { exportName, access, params: parameters, returns: returnType };
      routines.push({ kind: kind.toLowerCase(), name, exportName, className, params: parameters, returns: returnType });
    } else if (line.startsWith('M:ROUTINE:')) {
      const [, , kind, name, returns, params = ''] = line.split(':');
      if (!['FUNCTION', 'PROCEDURE'].includes(kind) || !name) throw new Error(`Invalid routine metadata: ${line}`);
      routines.push({
        kind: kind.toLowerCase(), name, exportName: name,
        returns: returns ? { kind: 'named', name: returns } : null,
        params: params.split(';').filter(Boolean).map(spec => {
          const [name, type, ref] = spec.split(',');
          return { name, type: { kind: 'named', name: type }, byref: ref === '1' };
        }),
      });
    } else instructions.push(line);
  }
  return { types, classes, routines, instructions };
}

export async function assembleSelfHosted(ir, assembler, metadata = decodeSelfHostedMetadata(ir)) {
  const { types, classes, routines, instructions } = metadata;
  const result = await createRuntime(assembler, {
    inputLines: [instructions.join('\n')],
    maxSteps: 20000000,
  }).run();
  if (result.status !== 'completed') throw new Error(`Assembler stopped with status ${result.status}`);
  const strings = [];
  let binary;
  for (const line of result.output) {
    if (line.startsWith('E:ERROR:')) {
      const detail = line.slice(8);
      const separator = detail.indexOf(':');
      const sourceLine = Number(detail.slice(0, separator));
      throw new PseudoError(`Unsupported self-hosted source line: ${detail.slice(separator + 1)}`, sourceLine || 1);
    }
    if (line.startsWith('E:')) throw new Error(line.slice(2));
    if (line.startsWith('S:')) strings.push(line.slice(2));
    else if (line.startsWith('B:')) {
      if (binary) throw new Error('Assembler emitted multiple binaries');
      binary = fromLatin1(line.slice(2));
    } else throw new Error(`Unexpected assembler output: ${line.slice(0, 80)}`);
  }
  if (!binary || !WebAssembly.validate(binary)) throw new Error('Assembler emitted invalid WebAssembly');
  const literalStrings = [...strings];
  for (let i = 0; i < strings.length; i++) {
    if (strings[i].startsWith('\x1fARRAY|')) strings[i] = JSON.stringify(decodeType(strings[i]));
  }
  return { binary, strings, literalStrings, types, classes, routines };
}

export async function lowerSelfHostedNative(ir, lowerer) {
  const result = await createRuntime(lowerer, {
    inputLines: [ir.join('\n')],
    maxSteps: 20000000,
  }).run();
  if (result.status !== 'completed') throw new Error(`Native lowerer stopped with status ${result.status}`);
  if (result.output.length === 1 && result.output[0].startsWith('N:UNSUPPORTED')) return null;
  const binaryLine = result.output.find(line => line.startsWith('B:'));
  if (!binaryLine || result.output.some(line => !['B:', 'L:', 'G:', 'F:', 'D:'].some(prefix => line.startsWith(prefix))))
    throw new Error('Native lowerer emitted unexpected output');
  const binary = fromLatin1(binaryLine.slice(2));
  if (!WebAssembly.validate(binary)) throw new Error('Self-hosted native lowerer emitted invalid WebAssembly');
  return {
    binary, native: true, nativeBackend: 'selfhosted', nativeLabels: result.output.filter(line => line.startsWith('L:')).map(line => line.slice(2)),
    nativeGlobalBase: Number(result.output.find(line => line.startsWith('G:'))?.slice(2) || 8),
    nativeFrameBase: Number(result.output.find(line => line.startsWith('F:'))?.slice(2) || 0),
    nativeDataEnd: Number(result.output.find(line => line.startsWith('D:'))?.slice(2) || 8),
  };
}

export async function compileSelfHostedSource(source, core, assembler, nativeLowerer = null) {
  const result = await createRuntime(core, {
    inputLines: [source.replace(/\r\n/g, '\n')],
    maxSteps: 20000000,
  }).run();
  if (result.status !== 'completed') throw new Error(`Compiler stopped with status ${result.status}`);
  const sourceError = result.output.find(line => line.startsWith('ERROR:'));
  if (sourceError) {
    const separator = sourceError.indexOf(':', 6);
    const line = Number(sourceError.slice(6, separator)) || 1;
    const sourceLine = source.replace(/\r\n/g, '\n').split('\n')[line - 1] || '';
    const first = sourceLine.search(/\S/);
    throw new PseudoError(`Unsupported self-hosted source line: ${sourceError.slice(separator + 1)}`, line, first < 0 ? 1 : first + 1);
  }
  const metadata = decodeSelfHostedMetadata(result.output);
  if (nativeLowerer) {
    const native = await lowerSelfHostedNative(result.output, nativeLowerer);
    if (native) return { types: metadata.types, classes: metadata.classes, routines: metadata.routines, strings: [], literalStrings: [], ...native };
  }
  return assembleSelfHosted(result.output, assembler, metadata);
}
