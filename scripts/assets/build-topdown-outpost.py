#!/usr/bin/env python3
"""Reproducible, dependency-free pixel art for the Top-down Shooter example."""
import argparse
import hashlib
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'examples/topdown-shooter/public/assets/outpost'

class Image:
    def __init__(self, width, height):
        self.width, self.height = width, height
        self.pixels = bytearray(width * height * 4)
    def rect(self, x, y, width, height, color):
        for yy in range(max(0, y), min(self.height, y + height)):
            for xx in range(max(0, x), min(self.width, x + width)):
                pos = (yy * self.width + xx) * 4
                self.pixels[pos:pos + 4] = bytes((*color[:3], color[3] if len(color) == 4 else 255))
    def png(self):
        def chunk(kind, data):
            return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
        scan = b''.join(b'\0' + self.pixels[y*self.width*4:(y+1)*self.width*4] for y in range(self.height))
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', self.width, self.height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(scan, 9)) + chunk(b'IEND', b'')

def operator_sheet():
    image = Image(128, 64)
    for row in range(2):
        for frame in range(4):
            x, y = frame*32, row*32
            bob = (frame % 2) if row else 0
            image.rect(x+7, y+27, 19, 3, (2, 8, 18, 90))
            for side in range(2):
                fy = y+23+(1 if row and (frame+side)%2 else 0)
                image.rect(x+10+side*9, fy, 5, 5, (16, 29, 43))
                image.rect(x+11+side*9, fy, 3, 2, (94, 135, 151))
            y += bob
            image.rect(x+8, y+12, 19, 13, (7, 27, 43))
            image.rect(x+9, y+13, 16, 9, (30, 117, 138))
            image.rect(x+11, y+14, 11, 6, (48, 175, 183))
            image.rect(x+12, y+15, 7, 2, (174, 242, 222))
            image.rect(x+8, y+5, 17, 10, (8, 25, 39))
            image.rect(x+10, y+4, 13, 10, (153, 190, 192))
            image.rect(x+11, y+5, 10, 3, (217, 237, 216))
            image.rect(x+11, y+9, 12, 4, (5, 57, 78))
            image.rect(x+13, y+10, 10, 2, (82, 239, 233))
            image.rect(x+6, y+15, 4, 8, (51, 81, 97))
            image.rect(x+23, y+15, 5, 6, (74, 106, 110))
            image.rect(x+24, y+16, 7, 4, (10, 24, 38))
            image.rect(x+27, y+16, 4, 1, (245, 189, 83))
    return image

def drone():
    image = Image(32, 32)
    image.rect(4, 25, 24, 4, (2, 8, 18, 90))
    for x in [3, 23]:
        image.rect(x, 9, 6, 15, (24, 26, 40))
        image.rect(x+1, 10, 4, 9, (110, 57, 72))
        image.rect(x+2, 11, 2, 4, (242, 112, 103))
    image.rect(7, 7, 18, 18, (28, 30, 44))
    image.rect(8, 6, 16, 16, (148, 63, 77))
    image.rect(10, 7, 12, 5, (209, 106, 98))
    image.rect(11, 12, 10, 8, (50, 34, 51))
    image.rect(13, 13, 6, 5, (250, 173, 105))
    image.rect(14, 13, 4, 2, (255, 236, 170))
    image.rect(9, 22, 14, 2, (69, 44, 62))
    return image

def pulse():
    image = Image(16, 16)
    image.rect(3, 3, 10, 10, (44, 210, 239, 45))
    image.rect(5, 4, 6, 8, (58, 218, 234, 180))
    image.rect(6, 5, 4, 6, (190, 255, 241))
    image.rect(7, 6, 2, 4, (255, 255, 225))
    return image

def arena():
    image = Image(256, 64)
    for tile in range(4):
        x = tile*64
        image.rect(x, 0, 64, 64, (15, 27, 40))
        if tile < 3:
            image.rect(x+2, 2, 60, 60, (24+tile*2, 40+tile*2, 54+tile*3))
            image.rect(x+3, 3, 58, 1, (46, 65, 77))
            image.rect(x+3, 60, 58, 1, (8, 19, 30))
            for yy in range(9, 60, 10):
                for xx in range(9, 60, 10):
                    if (xx*3+yy*7+tile)%4==0: image.rect(x+xx, yy, 1, 1, (40, 57, 70))
            for xx in [5, 57]:
                for yy in [5, 57]: image.rect(x+xx, yy, 2, 2, (62, 83, 93))
            if tile == 1:
                image.rect(x+7, 25, 50, 15, (11, 25, 37))
                for yy in range(27, 39, 3): image.rect(x+9, yy, 46, 1, (44, 65, 75))
            if tile == 2:
                image.rect(x+26, 2, 12, 60, (19, 51, 62))
                image.rect(x+31, 5, 2, 54, (43, 135, 150))
                image.rect(x+31, 16, 2, 8, (110, 224, 218))
        else:
            image.rect(x+1, 2, 62, 60, (8, 17, 27))
            image.rect(x+4, 2, 56, 56, (67, 91, 99))
            image.rect(x+7, 4, 50, 49, (37, 58, 71))
            image.rect(x+9, 6, 46, 3, (103, 129, 131))
            image.rect(x+9, 46, 46, 5, (14, 34, 49))
            image.rect(x+12, 13, 40, 28, (27, 44, 59))
            for xx in range(14, 50, 6): image.rect(x+xx, 16, 2, 21, (56, 76, 85))
            for xx in range(8, 56, 8):
                image.rect(x+xx, 52, 5, 3, (217, 154, 71))
            image.rect(x+10, 8, 4, 2, (81, 226, 204))
            image.rect(x+50, 8, 4, 2, (81, 226, 204))
    return image

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    assets = {'operator.png': operator_sheet(), 'sentinel.png': drone(), 'pulse.png': pulse(), 'arena.png': arena()}
    for name, image in assets.items():
        target = OUT / name
        data = image.png()
        if args.check:
            if not target.exists() or target.read_bytes() != data: raise SystemExit(f'Out-of-date asset: {target}')
        else:
            OUT.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        print(f'{name}: {image.width}x{image.height} {hashlib.sha256(data).hexdigest()}')

if __name__ == '__main__': main()
