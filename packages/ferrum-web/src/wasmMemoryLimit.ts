/** Internal cold transform for trusted build artifacts; this is not a file-data decoder.
 * Limits linear memory only: host compilation, JS heap, resources and RSS are separate. */
const PAGE_LIMIT = 65_536;

function readU32(bytes: Uint8Array, cursor: { at: number }): number {
  let value = 0, scale = 1;
  for (let count = 0; count < 5; count++) {
    if (cursor.at >= bytes.length) throw new Error("Truncated Wasm u32");
    const next = bytes[cursor.at++];
    value += (next & 127) * scale;
    if (value > 0xffff_ffff) throw new Error("Wasm u32 overflow");
    if (!(next & 128)) return value;
    scale *= 128;
  }
  throw new Error("Invalid Wasm u32");
}
function writeU32(value: number): number[] {
  const output: number[] = [];
  do { const next = value % 128; value = Math.floor(value / 128); output.push(next | (value ? 128 : 0)); } while (value);
  return output;
}

export function limitWasmMemory(bytes: Uint8Array, maximumPages: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(maximumPages) || maximumPages < 0 || maximumPages > PAGE_LIMIT) throw new Error("Invalid Wasm memory maximum");
  if (bytes.length < 8 || [0,97,115,109,1,0,0,0].some((v,i) => bytes[i] !== v)) throw new Error("Unexpected Wasm header");
  const cursor = { at: 8 }; let memory: {begin: number; end: number; minimum: number; maximum: number} | undefined;
  while (cursor.at < bytes.length) {
    const begin = cursor.at, id = bytes[cursor.at++], size = readU32(bytes,cursor), end = cursor.at + size;
    if (end > bytes.length) throw new Error("Truncated Wasm section");
    if (id === 5) {
      if (memory || readU32(bytes,cursor) !== 1) throw new Error("Expected one defined Wasm memory");
      const flags = readU32(bytes,cursor);
      if (flags !== 0 && flags !== 1) throw new Error("Unsupported shared or memory64 Wasm memory");
      const minimum = readU32(bytes,cursor), maximum = flags === 1 ? readU32(bytes,cursor) : PAGE_LIMIT;
      if (cursor.at !== end) throw new Error("Unexpected Wasm memory fields");
      memory = {begin,end,minimum,maximum};
    }
    cursor.at = end;
  }
  if (!memory || maximumPages < memory.minimum || maximumPages > memory.maximum) throw new Error("Wasm memory maximum is outside the original limits");
  const payload = [1,1,...writeU32(memory.minimum),...writeU32(maximumPages)];
  const replacement = new Uint8Array([5,...writeU32(payload.length),...payload]);
  const output = new Uint8Array(bytes.length - (memory.end - memory.begin) + replacement.length);
  output.set(bytes.subarray(0,memory.begin)); output.set(replacement,memory.begin);
  output.set(bytes.subarray(memory.end),memory.begin + replacement.length);
  return output;
}
