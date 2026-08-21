#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_./:>?";
const columns = 16;
const cellWidth = 12;
const cellHeight = 16;
const width = columns * cellWidth;
const height = 3 * cellHeight;
const pixelScale = 2;

const glyphs = Object.freeze({
  A: "01110/10001/10001/11111/10001/10001/10001",
  B: "11110/10001/10001/11110/10001/10001/11110",
  C: "01111/10000/10000/10000/10000/10000/01111",
  D: "11110/10001/10001/10001/10001/10001/11110",
  E: "11111/10000/10000/11110/10000/10000/11111",
  F: "11111/10000/10000/11110/10000/10000/10000",
  G: "01111/10000/10000/10111/10001/10001/01111",
  H: "10001/10001/10001/11111/10001/10001/10001",
  I: "11111/00100/00100/00100/00100/00100/11111",
  J: "00111/00010/00010/00010/10010/10010/01100",
  K: "10001/10010/10100/11000/10100/10010/10001",
  L: "10000/10000/10000/10000/10000/10000/11111",
  M: "10001/11011/10101/10101/10001/10001/10001",
  N: "10001/11001/10101/10011/10001/10001/10001",
  O: "01110/10001/10001/10001/10001/10001/01110",
  P: "11110/10001/10001/11110/10000/10000/10000",
  Q: "01110/10001/10001/10001/10101/10010/01101",
  R: "11110/10001/10001/11110/10100/10010/10001",
  S: "01111/10000/10000/01110/00001/00001/11110",
  T: "11111/00100/00100/00100/00100/00100/00100",
  U: "10001/10001/10001/10001/10001/10001/01110",
  V: "10001/10001/10001/10001/10001/01010/00100",
  W: "10001/10001/10001/10101/10101/10101/01010",
  X: "10001/10001/01010/00100/01010/10001/10001",
  Y: "10001/10001/01010/00100/00100/00100/00100",
  Z: "11111/00001/00010/00100/01000/10000/11111",
  0: "01110/10001/10011/10101/11001/10001/01110",
  1: "00100/01100/00100/00100/00100/00100/01110",
  2: "01110/10001/00001/00010/00100/01000/11111",
  3: "11110/00001/00001/01110/00001/00001/11110",
  4: "00010/00110/01010/10010/11111/00010/00010",
  5: "11111/10000/10000/11110/00001/00001/11110",
  6: "01110/10000/10000/11110/10001/10001/01110",
  7: "11111/00001/00010/00100/01000/01000/01000",
  8: "01110/10001/10001/01110/10001/10001/01110",
  9: "01110/10001/10001/01111/00001/00001/01110",
  " ": "00000/00000/00000/00000/00000/00000/00000",
  "-": "00000/00000/00000/11111/00000/00000/00000",
  _: "00000/00000/00000/00000/00000/00000/11111",
  ".": "00000/00000/00000/00000/00000/00110/00110",
  "/": "00001/00010/00010/00100/01000/01000/10000",
  ":": "00000/00110/00110/00000/00110/00110/00000",
  ">": "10000/01000/00100/00010/00100/01000/10000",
  "?": "01110/10001/00001/00010/00100/00000/00100",
});

const rgba = Buffer.alloc(width * height * 4);
for (const [index, character] of [...characters].entries()) {
  const pattern = (glyphs[character] ?? glyphs["?"]).split("/");
  const cellX = (index % columns) * cellWidth + 1;
  const cellY = Math.floor(index / columns) * cellHeight + 1;
  for (let row = 0; row < pattern.length; row += 1) {
    for (let column = 0; column < pattern[row].length; column += 1) {
      if (pattern[row][column] !== "1") continue;
      for (let offsetY = 0; offsetY < pixelScale; offsetY += 1) {
        for (let offsetX = 0; offsetX < pixelScale; offsetX += 1) {
          const x = cellX + column * pixelScale + offsetX;
          const y = cellY + row * pixelScale + offsetY;
          const offset = (y * width + x) * 4;
          rgba[offset] = 255;
          rgba[offset + 1] = 255;
          rgba[offset + 2] = 255;
          rgba[offset + 3] = 255;
        }
      }
    }
  }
}

const scanlines = Buffer.alloc(height * (width * 4 + 1));
for (let y = 0; y < height; y += 1) {
  const target = y * (width * 4 + 1);
  scanlines[target] = 0;
  rgba.copy(scanlines, target + 1, y * width * 4, (y + 1) * width * 4);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(scanlines)),
  chunk("IEND", Buffer.alloc(0)),
]);

await writeFile(new URL("../public/assets/debug-font.png", import.meta.url), png);

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return result;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
