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

/** Lossless RGBA8 PNG verification, including ordinary filters, split IDAT and Adam7. */
export async function verifyPixelPng(bytes: ArrayBuffer, source: PixelDocument) {
  const document = readPixelDocument(JSON.stringify(source));
  if (bytes.byteLength > 4 * 1024 * 1024) throw Error("Pixel PNG exceeds the byte limit");
  const data = new Uint8Array(bytes.slice(0)), view = new DataView(data.buffer);
  if ([137,80,78,71,13,10,26,10].some((v,i) => data[i] !== v)) throw Error("Invalid pixel PNG");
  const compressed: Uint8Array<ArrayBuffer>[] = [];
  let offset = 8, header = false, end = false, interlaced = false, idatEnded = false;
  let palette = false, srgb = false;
  while (offset + 12 <= data.length) {
    const size = view.getUint32(offset);
    if (size > data.length - offset - 12) throw Error("Invalid pixel PNG chunk");
    const name = String.fromCharCode(...data.subarray(offset + 4,offset + 8));
    if (!/^[A-Za-z]{4}$/.test(name) || (!header && name !== "IHDR")) throw Error("Invalid pixel PNG chunk order");
    const body = data.slice(offset + 8,offset + 8 + size), encoded = chunk(name,body);
    if (encoded.some((v,i) => v !== data[offset+i])) throw Error("Pixel PNG checksum differs");
    offset += size + 12;
    if (name === "IHDR") {
      if (header || size !== 13 || view.getUint32(offset - size - 4) !== document.width ||
        view.getUint32(offset - size) !== document.height || body[8] !== 8 || body[9] !== 6 ||
        body[10] !== 0 || body[11] !== 0 || body[12] > 1) throw Error("Pixel PNG dimensions or format differ");
      header = true; interlaced = body[12] === 1;
    } else if (name === "IDAT") {
      if (idatEnded) throw Error("Invalid pixel PNG chunk order");
      compressed.push(body);
    } else {
      if (compressed.length) idatEnded = true;
      if (name === "IEND") {
        if (size !== 0 || !compressed.length) throw Error("Invalid pixel PNG end");
        end = true; break;
      }
      if (name === "PLTE") {
        if (palette || compressed.length || size === 0 || size > 768 || size % 3 !== 0) throw Error("Invalid pixel PNG palette");
        palette = true;
      } else if (name === "sRGB") {
        if (srgb || compressed.length || size !== 1 || body[0] > 3) throw Error("Invalid pixel PNG color space");
        srgb = true;
      } else if (name === "iCCP" || name === "cICP" || name === "mDCv" || name === "cLLi" ||
        (name === "gAMA" && (size !== 4 || new DataView(body.buffer).getUint32(0) !== 45455)) ||
        (name === "cHRM" && (size !== 32 || [31270,32900,64000,33000,30000,60000,15000,6000].some((v,i) => new DataView(body.buffer).getUint32(i*4) !== v)))) {
        throw Error("Pixel PNG color space differs from sRGB source");
      } else if (name === "acTL" || name === "fcTL" || name === "fdAT" || name[0] === name[0].toUpperCase())
        throw Error("Unsupported pixel PNG chunk");
    }
  }
  if (!end || offset !== data.length) throw Error("Invalid pixel PNG layout");
  const layout = interlaced
    ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]
    : [[0,0,1,1]];
  const passes = layout.map(([x,y,dx,dy]) => ({x,y,dx,dy,
    width: Math.max(0,Math.ceil((document.width-x)/dx)),height: Math.max(0,Math.ceil((document.height-y)/dy))}));
  const limit = passes.reduce((sum,p) => sum + (p.width ? (p.width*4+1)*p.height : 0),0);
  const reader = new Blob(compressed).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  const rows = new Uint8Array(limit);
  let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      if (length + value.length > limit) throw Error("Pixel PNG decompression exceeds dimensions");
      rows.set(value,length); length += value.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (length !== limit) throw Error("Pixel PNG byte length differs");
  const actual = new Uint8Array(document.width*document.height*4);
  let position = 0;
  for (const pass of passes) {
    if (!pass.width || !pass.height) continue;
    let previous = new Uint8Array(pass.width*4), row = new Uint8Array(pass.width*4);
    for (let y = 0; y < pass.height; y++) {
      const filter = rows[position++];
      if (filter > 4) throw Error("Unsupported pixel PNG row filter");
      for (let x = 0; x < row.length; x++) {
        const left = x >= 4 ? row[x-4] : 0, up = previous[x], corner = x >= 4 ? previous[x-4] : 0;
        const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left+up)/2) : paeth(left,up,corner);
        row[x] = (rows[position++] + prediction) & 255;
      }
      for (let x = 0; x < pass.width; x++)
        actual.set(row.subarray(x*4,x*4+4),((pass.y+y*pass.dy)*document.width+pass.x+x*pass.dx)*4);
      [previous,row] = [row,previous];
    }
  }
  const expected = pixelBytes(document);
  if (actual.some((v,i) => v !== expected[i])) throw Error("Pixel PNG and editable source differ");
}
function paeth(left: number, up: number, corner: number): number {
  const p = left+up-corner, a = Math.abs(p-left), b = Math.abs(p-up), c = Math.abs(p-corner);
  return a <= b && a <= c ? left : b <= c ? up : corner;
}
