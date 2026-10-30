import { pixelBytes, readPixelDocument, type PixelDocument } from "./placementPixelDocument";

function chunk(name: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(name), 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < bytes.length - 4; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}
/** Lossless RGBA export, including transparent RGB. Avoid canvas premultiplication. */
export async function pixelPng(source: PixelDocument): Promise<ArrayBuffer> {
  const document = readPixelDocument(JSON.stringify(source));
  const pixels = pixelBytes(document), stride = document.width * 4;
  const rows = new Uint8Array((stride + 1) * document.height);
  for (let row = 0; row < document.height; row++)
    rows.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  const stream = new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, document.width); view.setUint32(4, document.height);
  header[8] = 8; header[9] = 6;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("sRGB", new Uint8Array([0])),
    chunk("IDAT", compressed), chunk("IEND", new Uint8Array()),
  ];
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output.buffer;
}
