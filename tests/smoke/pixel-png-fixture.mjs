import { crc32, deflateSync } from "node:zlib";

export function pixelPngChunk(name, data) {
  const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type,data])));
  return Buffer.concat([size,type,data,crc]);
}

/** Standard RGBA8 PNG with all row filters, metadata and split IDAT; no editor encoder is used. */
export function filteredPixelPng(width, height, pixels, interlaced = false) {
  const chunk = pixelPngChunk;
  const passes = interlaced
    ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const rows = []; let index = 0;
  for (const [x0,y0,dx,dy] of passes) {
    const w = Math.max(0,Math.ceil((width-x0)/dx)), h = Math.max(0,Math.ceil((height-y0)/dy));
    if (!w || !h) continue;
    let previous = Buffer.alloc(w*4);
    for (let y = 0; y < h; y++) {
      const row = Buffer.alloc(w*4), filtered = Buffer.alloc(w*4+1), filter = index++ % 5;
      for (let x = 0; x < w; x++) row.set(pixels.subarray(((y0+y*dy)*width+x0+x*dx)*4,((y0+y*dy)*width+x0+x*dx)*4+4),x*4);
      filtered[0] = filter;
      for (let x = 0; x < row.length; x++) {
        const a = x >= 4 ? row[x-4] : 0, b = previous[x], c = x >= 4 ? previous[x-4] : 0;
        const p = a+b-c, distance = [Math.abs(p-a),Math.abs(p-b),Math.abs(p-c)];
        const paeth = distance[0] <= distance[1] && distance[0] <= distance[2] ? a : distance[1] <= distance[2] ? b : c;
        const prediction = [0,a,b,Math.floor((a+b)/2),paeth][filter];
        filtered[x+1] = (row[x]-prediction+256) % 256;
      }
      rows.push(filtered); previous = row;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4);
  header[8]=8;header[9]=6;header[12]=Number(interlaced);
  const compressed = deflateSync(Buffer.concat(rows)), half = Math.max(1,Math.floor(compressed.length/2));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),
    chunk("tEXt",Buffer.from("Software\0Independent test encoder")),
    chunk("IDAT",compressed.subarray(0,half)),chunk("IDAT",compressed.subarray(half)),chunk("IEND",Buffer.alloc(0))]);
}
