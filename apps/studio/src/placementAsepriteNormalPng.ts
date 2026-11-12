// Worker normal output is bounded, noninterlaced RGBA8 PNG. Keep numeric RGB,
// including alpha-zero pixels: Canvas2D compositing would premultiply it away.
const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const fail = () => {
  throw Error("Invalid RGBA8 normal PNG");
};

async function transform(
  bytes: Uint8Array<ArrayBuffer>,
  decode: boolean,
  limit: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (
    typeof CompressionStream === "undefined" ||
    typeof DecompressionStream === "undefined"
  )
    throw Error("Browser PNG compression unavailable");
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(
      decode
        ? new DecompressionStream("deflate")
        : new CompressionStream("deflate"),
    );
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error("Normal PNG exceeds byte limit");
      chunks.push(value);
    }
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
function paeth(a: number, b: number, c: number) {
  const p = a + b - c,
    da = Math.abs(p - a),
    db = Math.abs(p - b),
    dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}
function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
export async function readAsepriteNormalPixels(
  bytes: ArrayBuffer,
  width: number,
  height: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const raw = new Uint8Array(bytes),
    view = new DataView(bytes),
    parts: Uint8Array[] = [];
  if (
    raw.length < 45 ||
    signature.some((n, i) => raw[i] !== n) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 4_194_304
  )
    fail();
  let offset = 8,
    header = false,
    end = false,
    length = 0;
  while (offset + 12 <= raw.length) {
    const size = view.getUint32(offset),
      type = new TextDecoder().decode(raw.subarray(offset + 4, offset + 8));
    if (size > raw.length - offset - 12) fail();
    if (
      crc(raw.subarray(offset + 4, offset + 8 + size)) !==
      view.getUint32(offset + 8 + size)
    )
      fail();
    if (type === "IHDR") {
      if (
        header ||
        offset !== 8 ||
        size !== 13 ||
        view.getUint32(offset + 8) !== width ||
        view.getUint32(offset + 12) !== height ||
        raw[offset + 16] !== 8 ||
        raw[offset + 17] !== 6 ||
        raw[offset + 18] !== 0 ||
        raw[offset + 19] !== 0 ||
        raw[offset + 20] !== 0
      )
        fail();
      header = true;
    } else if (type === "IDAT") {
      if (!header || end) fail();
      const chunk = raw.subarray(offset + 8, offset + 8 + size);
      length += chunk.length;
      if (length > 32 * 1024 * 1024) fail();
      parts.push(chunk);
    } else if (type === "IEND") {
      if (size || !header) fail();
      end = true;
      offset += 12;
      break;
    }
    offset += size + 12;
  }
  if (!end || offset !== raw.length || !parts.length) fail();
  const compressed = new Uint8Array(length);
  offset = 0;
  for (const part of parts) {
    compressed.set(part, offset);
    offset += part.length;
  }
  const stride = width * 4,
    decoded = await transform(compressed, true, (stride + 1) * height, signal);
  if (decoded.length !== (stride + 1) * height) fail();
  const pixels = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = decoded[row * (stride + 1)];
    if (filter > 4) fail();
    for (let x = 0; x < stride; x++) {
      const index = row * stride + x,
        left = x >= 4 ? pixels[index - 4] : 0,
        up = row ? pixels[index - stride] : 0,
        corner = row && x >= 4 ? pixels[index - stride - 4] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, corner);
      pixels[index] = decoded[row * (stride + 1) + 1 + x] + predictor;
    }
  }
  signal.throwIfAborted();
  return pixels;
}
export async function writeAsepriteNormalPixels(
  width: number,
  height: number,
  pixels: Uint8Array,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 4_194_304 ||
    pixels.length !== width * height * 4
  )
    fail();
  const stride = width * 4,
    scanlines = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++)
    scanlines.set(
      pixels.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  const compressed = await transform(
    scanlines,
    false,
    32 * 1024 * 1024,
    signal,
  );
  const header = new Uint8Array(13),
    hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  function chunk(type: string, data: Uint8Array) {
    const bytes = new Uint8Array(data.length + 12),
      view = new DataView(bytes.buffer);
    view.setUint32(0, data.length);
    bytes.set(new TextEncoder().encode(type), 4);
    bytes.set(data, 8);
    view.setUint32(data.length + 8, crc(bytes.subarray(4, data.length + 8)));
    return bytes;
  }
  const chunks = [
    signature,
    chunk("IHDR", header),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array()),
  ];
  const output = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  signal.throwIfAborted();
  return output.buffer;
}
