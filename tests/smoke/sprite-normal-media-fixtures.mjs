import { deflateSync } from "node:zlib";

// Self-authored tiny encoders: partial frames exercise the pinned decoder, not a second decoder.
export function animatedGif() {
  const chunks = [
    Buffer.from("GIF89a"),
    Buffer.from([16, 0, 16, 0, 0x81, 3, 0]),
    Buffer.from([200, 40, 20, 30, 200, 60, 40, 70, 220, 0, 0, 0]),
  ];
  function frame(
    x,
    y,
    width,
    height,
    delay,
    disposal,
    color,
    transparentCorner = false,
  ) {
    chunks.push(
      Buffer.from([0x21, 0xf9, 4, (disposal << 2) | 1, delay, 0, 3, 0]),
    );
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    [x, y, width, height].forEach((n, i) =>
      descriptor.writeUInt16LE(n, 1 + i * 2),
    );
    chunks.push(descriptor, Buffer.from([2]));
    const codes = [];
    for (let i = 0; i < width * height; i++)
      codes.push(4, transparentCorner && i === 0 ? 3 : color);
    codes.push(5);
    const data = Buffer.alloc(Math.ceil((codes.length * 3) / 8));
    codes.forEach((code, index) => {
      const bit = index * 3;
      data[bit >> 3] |= code << bit % 8;
      if (bit % 8 > 5) data[(bit >> 3) + 1] |= code >> (8 - (bit % 8));
    });
    for (let offset = 0; offset < data.length; offset += 255) {
      const part = data.subarray(offset, offset + 255);
      chunks.push(Buffer.from([part.length]), part);
    }
    chunks.push(Buffer.from([0]));
  }
  frame(0, 0, 16, 16, 5, 1, 0, true);
  frame(4, 4, 4, 4, 9, 3, 1);
  frame(10, 10, 2, 2, 12, 2, 2);
  frame(0, 0, 1, 1, 6, 1, 1);
  return Buffer.concat([...chunks, Buffer.from([0x3b])]);
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let i = 0; i < 8; i++)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function compressed(width, height, color, transparentCorner = false) {
  const data = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data.set(
        transparentCorner && x === 0 && y === 0 ? [0, 0, 0, 0] : color,
        y * (width * 4 + 1) + 1 + x * 4,
      );
  return deflateSync(data);
}
export function animatedApng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(12);
  ihdr.writeUInt32BE(10, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(3);
  actl.writeUInt32BE(2, 4);
  const chunks = [
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("acTL", actl),
  ];
  let sequence = 0;
  function frame(
    x,
    y,
    width,
    height,
    denominator,
    disposal,
    blend,
    color,
    first = false,
  ) {
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence++);
    [width, height, x, y].forEach((n, i) =>
      control.writeUInt32BE(n, 4 + i * 4),
    );
    control.writeUInt16BE(1, 20);
    control.writeUInt16BE(denominator, 22);
    control[24] = disposal;
    control[25] = blend;
    chunks.push(chunk("fcTL", control));
    const pixels = compressed(width, height, color, first);
    if (first) chunks.push(chunk("IDAT", pixels));
    else {
      const number = Buffer.alloc(4);
      number.writeUInt32BE(sequence++);
      chunks.push(chunk("fdAT", Buffer.concat([number, pixels])));
    }
  }
  frame(0, 0, 12, 10, 12, 0, 0, [200, 100, 50, 255], true);
  frame(4, 3, 3, 2, 20, 2, 0, [50, 100, 200, 255]);
  frame(2, 2, 1, 1, 30, 0, 1, [50, 100, 200, 128]);
  return Buffer.concat([...chunks, chunk("IEND", Buffer.alloc(0))]);
}
