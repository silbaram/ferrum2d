#!/usr/bin/env python3
"""Original pixel art and Scene Authoring data for the app's flat 2D showcase.

Uses only Python's standard library. Explicit regeneration replaces the demo JSON.
Gameplay movement, collision, pickup and animation remain native engine features.
"""
import argparse
import binascii
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import zlib

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps/placement-viewer/public/assets/lantern-garden"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true", help="Check reproducibility without writing files")
args = parser.parse_args()


def emit(path, data):
    if isinstance(data, str):
        data = data.encode("utf8")
    if args.check:
        if not path.is_file() or path.read_bytes() != data:
            raise SystemExit(f"Outdated generated asset: {path.relative_to(ROOT)}")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def rgba(color):
    if isinstance(color, str):
        color = color.lstrip("#")
        return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    return tuple(color) if len(color) == 4 else tuple(color) + (255,)


class Pixels:
    def __init__(self, width, height, color=(0, 0, 0, 0)):
        self.width, self.height = width, height
        self.data = bytearray(rgba(color) * (width * height))

    def put(self, x, y, color):
        x, y = int(x), int(y)
        if 0 <= x < self.width and 0 <= y < self.height:
            offset = (y * self.width + x) * 4
            self.data[offset:offset + 4] = bytes(rgba(color))

    def rect(self, x, y, width, height, color):
        for yy in range(int(y), int(y + height)):
            for xx in range(int(x), int(x + width)):
                self.put(xx, yy, color)

    def line(self, a, b, color, thickness=1):
        steps = max(abs(b[0] - a[0]), abs(b[1] - a[1]), 1)
        for i in range(int(steps) + 1):
            self.rect(round(a[0] + (b[0] - a[0]) * i / steps), round(a[1] + (b[1] - a[1]) * i / steps), thickness, thickness, color)

    def ellipse(self, x, y, rx, ry, color):
        for yy in range(-ry, ry + 1):
            half = int(rx * math.sqrt(max(0, 1 - (yy / max(ry, 1)) ** 2)))
            self.rect(x - half, y + yy, half * 2 + 1, 1, color)

    def polygon(self, points, color):
        for y in range(min(p[1] for p in points), max(p[1] for p in points) + 1):
            hits = []
            for a, b in zip(points, points[1:] + points[:1]):
                if min(a[1], b[1]) <= y < max(a[1], b[1]):
                    hits.append(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
            hits.sort()
            for left, right in zip(hits[::2], hits[1::2]):
                self.rect(math.ceil(left), y, math.floor(right) - math.ceil(left) + 1, 1, color)

    def noise(self, seed, amount=6):
        rng = random.Random(seed)
        for i in range(0, len(self.data), 4):
            if self.data[i + 3]:
                delta = rng.randrange(-amount, amount + 1)
                for channel in range(3):
                    self.data[i + channel] = max(0, min(255, self.data[i + channel] + delta))

    def png(self):
        def chunk(kind, payload):
            return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", binascii.crc32(kind + payload) & 0xffffffff)
        raw = b"".join(b"\0" + self.data[y * self.width * 4:(y + 1) * self.width * 4] for y in range(self.height))
        return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", self.width, self.height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


atlas = Pixels(512, 512)
frames = {}
cursor_x = cursor_y = shelf_height = 0


def pack(name, image):
    global cursor_x, cursor_y, shelf_height
    if cursor_x + image.width > atlas.width:
        cursor_x, cursor_y, shelf_height = 0, cursor_y + shelf_height, 0
    if cursor_y + image.height > atlas.height:
        raise ValueError("Atlas budget exceeded")
    frames[name] = {"x": cursor_x, "y": cursor_y, "width": image.width, "height": image.height}
    for y in range(image.height):
        start = (y * image.width) * 4
        offset = ((cursor_y + y) * atlas.width + cursor_x) * 4
        atlas.data[offset:offset + image.width * 4] = image.data[start:start + image.width * 4]
    cursor_x += image.width
    shelf_height = max(shelf_height, image.height)


for variant in range(4):
    tile = Pixels(32, 32, "#607b59")
    tile.noise(120 + variant, 7)
    rng = random.Random(40 + variant)
    for _ in range(22):
        x, y = rng.randrange(32), rng.randrange(32)
        tile.line((x, y), (x + 1, y - 2), "#809269")
    for _ in range(4):
        x, y = rng.randrange(30), rng.randrange(30)
        tile.rect(x, y, 2, 1, "#a2a37a")
    pack(f"grass_{variant}", tile)
    tile = Pixels(32, 32, "#666c60")
    for row in range(4):
        for col in range(-1, 4):
            x, y = col * 12 + (row % 2) * 6, row * 8
            tile.rect(x + 1, y + 1, 11, 7, ["#aaa18b", "#a49c88", "#b2a58b", "#a09a87"][(row + col + variant) % 4])
            tile.rect(x + 1, y + 1, 11, 1, "#c2b59a")
            tile.rect(x + 1, y + 6, 11, 1, "#8a8876")
    tile.noise(30 + variant, 3)
    pack(f"stone_{variant}", tile)
    tile = Pixels(32, 32, "#487b8b")
    tile.noise(5, 3)
    for y in (4, 14, 25):
        x = (y * 3 + variant * 4) % 27
        tile.line((x, y), (min(31, x + 6), y), "#85b0ae")
        tile.line(((x + 8) % 24, y + 2), ((x + 8) % 24 + 3, y + 2), "#6596a0")
    pack(f"water_{variant}", tile)


def house(blue=False, shop=False):
    image = Pixels(128, 128)
    image.rect(12, 113, 105, 12, "#54564c")
    image.rect(15, 111, 99, 10, "#a6a48b")
    for x in range(16, 114, 16):
        image.line((x, 112), (x, 120), "#747b69")
    image.rect(20, 60, 88, 52, "#d3c6a3")
    image.rect(84, 60, 24, 52, "#b7b092")
    for x in (20, 60, 104):
        image.rect(x, 60, 4, 54, "#6b4d3c")
    image.rect(20, 76, 88, 3, "#79603f")
    image.rect(20, 108, 88, 4, "#71604b")
    image.polygon([(3, 65), (64, 10), (125, 65), (120, 73), (8, 73)], "#463b35")
    roof = ["#537c7a", "#5c8781", "#3f696c"] if blue else ["#b06948", "#bf7751", "#98513b"]
    image.polygon([(8, 64), (64, 14), (120, 64), (116, 68), (12, 68)], roof[0])
    for y in range(23, 67, 6):
        half = int((y - 14) * 1.1)
        image.line((64 - half, y), (64 + half, y), roof[2])
        for x in range(64 - half + (y % 12), 64 + half, 10):
            image.line((x, y - 4), (x + 3, y), roof[1])
    image.rect(89, 12, 12, 26, "#7e8274")
    image.rect(87, 9, 16, 5, "#b6b7a0")
    for y in (17, 25, 32):
        image.line((89, y), (100, y), "#626c62")
    for x in (31, 79):
        image.rect(x - 2, 82, 20, 22, "#594534")
        image.rect(x, 84, 16, 18, "#f0d38c")
        image.rect(x + 2, 84, 6, 16, "#fbe3a6")
        image.line((x + 8, 83), (x + 8, 102), "#8c7147", 2)
        image.line((x, 92), (x + 16, 92), "#8c7147")
        image.rect(x - 3, 104, 22, 6, "#8c6444")
        for xx in range(x, x + 17, 5):
            image.rect(xx, 101, 3, 4, "#5b7c4d")
            image.rect(xx + 1, 100, 2, 2, "#d6958c")
    image.rect(57, 88, 18, 26, "#71503c")
    image.rect(60, 91, 12, 22, "#886445")
    image.rect(69, 101, 2, 2, "#dec98c")
    image.rect(54, 114, 24, 5, "#c3baa0")
    if shop:
        image.rect(25, 67, 77, 14, "#4f624e")
        for x in range(27, 100, 10):
            image.rect(x, 68, 6, 13, "#d5ceb0")
        image.rect(44, 52, 41, 12, "#72513c")
        image.line((49, 57), (79, 57), "#dfc784", 2)
    image.noise(9 if blue else 5, 3)
    return image


pack("cottage", house())
pack("workshop", house(True, True))
tree = Pixels(64, 96)
tree.rect(27, 57, 12, 36, "#5d4936")
tree.rect(29, 58, 4, 34, "#937448")
tree.line((33, 74), (43, 61), "#6d5737", 3)
for x, y, rx, ry, color in [(32, 45, 29, 25, "#324f42"), (19, 37, 17, 23, "#42694c"), (43, 35, 19, 26, "#4c7653"), (28, 22, 20, 20, "#668a5b"), (23, 17, 13, 11, "#7d9a65"), (41, 46, 16, 14, "#5b8051")]:
    tree.ellipse(x, y, rx, ry, color)
tree.noise(82, 6)
pack("oak", tree)
for frame in range(4):
    well = Pixels(64, 72)
    well.ellipse(32, 56, 25, 13, "#575f56")
    well.ellipse(32, 48, 25, 13, "#a9aa90")
    well.rect(7, 43, 50, 12, "#92977f")
    well.ellipse(32, 41, 25, 13, "#c0bba0")
    well.ellipse(32, 41, 17, 8, "#4c8290")
    well.line((23 + frame * 2, 41), (35 + frame * 2, 41), "#a4c6bf")
    for x in (12, 49):
        well.rect(x, 23, 4, 30, "#735c3d")
    well.polygon([(3, 24), (32, 3), (61, 24), (58, 29), (6, 29)], "#4e6b6a")
    well.line((7, 23), (32, 6), "#779390", 2)
    well.line((7, 27), (58, 27), "#344d4c", 2)
    well.noise(49, 2)
    pack(f"well_{frame}", well)
bridge = Pixels(64, 64, "#6a5237")
for x in range(0, 64, 8):
    bridge.rect(x + 1, 8, 7, 48, "#b5925d")
    bridge.rect(x + 1, 8, 1, 48, "#d0ad72")
for y in (3, 56):
    bridge.rect(0, y, 64, 5, "#755438")
    bridge.rect(0, y, 64, 1, "#d6b276")
for x in (0, 29, 60):
    for y in (0, 48):
        bridge.rect(x, y, 4, 16, "#8b6941")
pack("bridge", bridge)
crate = Pixels(32, 32)
crate.rect(2, 5, 28, 25, "#634d35")
crate.rect(3, 2, 26, 25, "#aa8654")
for x in (5, 12, 20, 27):
    crate.line((x, 3), (x, 25), "#785e3c")
crate.line((4, 4), (26, 25), "#c49d65", 3)
crate.line((26, 4), (4, 25), "#c49d65", 3)
crate.line((3, 2), (28, 2), "#dfbb7a", 2)
pack("crate", crate)
lantern = Pixels(16, 48)
lantern.rect(6, 12, 4, 34, "#6d624b")
lantern.rect(4, 44, 8, 4, "#a4a087")
lantern.rect(2, 8, 12, 14, "#3a4340")
lantern.rect(4, 10, 8, 10, "#f6cf6a")
lantern.rect(6, 11, 4, 7, "#fff1b4")
lantern.polygon([(1, 9), (8, 3), (15, 9)], "#495d56")
pack("lantern", lantern)
flowers = Pixels(32, 32)
flowers.rect(2, 19, 28, 11, "#73513c")
flowers.rect(1, 18, 30, 3, "#a17c51")
for x, y, color in [(6, 11, "#e4b279"), (15, 8, "#cb8e9a"), (24, 12, "#e3cd8a")]:
    flowers.line((x, y + 4), (x, 20), "#577847", 2)
    flowers.ellipse(x, y, 4, 4, color)
    flowers.rect(x, y, 2, 2, "#f3d89b")
pack("flowers", flowers)
for frame in range(4):
    token = Pixels(16, 20)
    token.ellipse(8, 10, [5, 3, 1, 3][frame], 7, "#cd9a45")
    token.ellipse(7, 9, max(1, [4, 2, 1, 2][frame]), 6, "#f3d782")
    token.rect(7, 5, 1, 7, "#fff0b1")
    pack(f"token_{frame}", token)


def hero(direction, step):
    image = Pixels(16, 24)
    offset = -1 if step == 1 else 1 if step == 3 else 0
    image.rect(4, 18, 4, 5 + min(0, offset), "#344448")
    image.rect(9, 18, 3, 5 - max(0, offset), "#344448")
    image.rect(3, 22 + min(0, offset), 5, 2, "#4c3d32")
    image.rect(9, 22 - max(0, offset), 5, 2, "#4c3d32")
    image.rect(3, 10, 10, 9, "#354c57")
    image.rect(4, 11, 8, 7, "#5b91a0")
    image.rect(3, 17, 10, 2, "#bd9870")
    image.rect(2, 12 + offset, 2, 6, "#d6b38b")
    image.rect(13, 12 - offset, 2, 6, "#d6b38b")
    image.rect(3, 1, 10, 10, "#453d36")
    image.rect(4, 4, 8, 6, "#dab48a")
    image.rect(3, 1, 10, 4, "#544538")
    image.rect(5, 1, 6, 2, "#786046")
    if direction == 0:
        image.rect(3, 3, 10, 7, "#514236")
        image.rect(5, 4, 6, 4, "#63513e")
    elif direction == 1:
        image.rect(5, 6, 2, 2, "#343a36"); image.rect(10, 6, 2, 2, "#343a36")
    else:
        image.rect(4 if direction == 2 else 11, 6, 2, 2, "#343a36")
        image.rect(12 if direction == 2 else 3, 4, 2, 6, "#514236")
    return image


for direction in range(4):
    for step in range(4):
        pack(f"hero_{direction}_{step}", hero(direction, step))

png = atlas.png()
emit(OUT / "atlas.png", png)
manifest = {"format": "ferrum2d.example.lantern-garden-assets", "version": 1,
            "texture": {"id": "garden_atlas", "file": "atlas.png", "width": 512, "height": 512,
                        "sha256": hashlib.sha256(png).hexdigest()}, "frames": frames}
emit(OUT / "manifest.json", json.dumps(manifest, indent=2) + "\n")


def uv(name):
    f = frames[name]
    return {"u0": f["x"] / 512, "v0": f["y"] / 512, "u1": (f["x"] + f["width"]) / 512, "v1": (f["y"] + f["height"]) / 512}


def visual(name, width=None, height=None, ground=False):
    f = frames[name]
    return {"kind": "sprite", "asset": "garden_atlas", "frame": uv(name), "width": width or f["width"], "height": height or f["height"],
            "originX": .5, "originY": .5 if ground else 1, "depthSort": "layer" if ground else "hd2d"}


prefabs = {"object": {"props": {}}}
for kind in ("grass", "stone"):
    for variant in range(4):
        prefabs[f"garden-{kind}-{variant}"] = {"props": {"components": {"visual": visual(f"{kind}_{variant}", ground=True), "collider": "none", "layer": "wall"}}}
water_visual = visual("water_0", ground=True)
water_visual["animationSet"] = {"clips": [{"id": 0, "fps": 3, "loop": True, "frames": [uv(f"water_{i}") for i in range(4)]}], "initialClip": 0}
prefabs["garden-water"] = {"props": {"components": {"visual": water_visual, "collider": "none", "layer": "wall"}}}

COLUMNS, ROWS, TILE = 24, 18, 32
ORIGIN_X, ORIGIN_Y = 416, 162
tiles, instances, costs, obstacles, occluders = [], [], [], [], []
rng = random.Random(1906)
for row in range(ROWS):
    for col in range(COLUMNS):
        boundary = col in (0, COLUMNS - 1) or row in (0, ROWS - 1)
        river = col in (18, 19) and not boundary
        bridge_cell = river and row in (9, 10)
        stone = row in (9, 10) or col in (11, 12) or (8 <= col <= 16 and 7 <= row <= 12) or boundary
        prefab = "garden-water" if river else f"garden-{'stone' if stone else 'grass'}-{rng.randrange(4)}"
        tiles.append({"id": f"tile_{col}_{row}", "prefab": prefab, "x": ORIGIN_X + col * TILE + 16, "y": ORIGIN_Y + row * TILE + 16, "layer": -100})
        costs.append(0 if boundary or (river and not bridge_cell) else 1 if stone else 2)


def prop(identity, frame, x, y, collider=None, width=None, height=None, ground=False, animation=None, tint=None):
    v = visual(frame, width, height, ground)
    if animation:
        v["animationSet"] = {"clips": [{"id": 0, "fps": 4, "loop": True, "frames": [uv(name) for name in animation]}], "initialClip": 0}
    if tint:
        v["tint"] = tint
    if not ground:
        v["shadow"] = {"shape": "ellipse", "width": min(width or frames[frame]["width"], 44), "height": 12, "opacity": .7}
    components = {"visual": v, "collider": "none", "layer": "wall"}
    if collider:
        hw, hh = collider
        components.update({"collider": {"type": "aabb", "halfWidth": hw, "halfHeight": hh, "isTrigger": False},
                           "body": {"type": "static", "heightSpan": {"elevation": 0, "height": 1, "floorId": 0}}})
        obstacles.append({"instanceId": identity, "collider": True})
        # Flat lights have no elevation; their own thin poles should not cast huge wedges.
        if hw >= 8 and hh >= 5:
            occluders.append({"x": x - hw, "y": y - hh, "width": hw * 2, "height": hh * 2})
    instances.append({"id": identity, "prefab": "object", "x": x, "y": y, "layer": -90 if ground else 0, "props": {"components": components}})


prop("garden_cottage", "cottage", 560, 386, (43, 15))
prop("garden_workshop", "workshop", 720, 354, (43, 15))
prop("garden_east_cottage", "cottage", 1104, 386, (43, 15))
prop("garden_storage", "workshop", 912, 650, (43, 15))
prop("garden_well", "well_0", 848, 450, (18, 10), animation=[f"well_{i}" for i in range(4)])
prop("garden_bridge", "bridge", 1024, 482, ground=True)
for index, (x, y) in enumerate([(464, 268), (632, 292), (896, 262), (1136, 264), (464, 614), (560, 674), (688, 674), (1120, 620), (1056, 674)]):
    prop(f"garden_oak_{index}", "oak", x, y, (9, 7))
for index, (x, y) in enumerate([(620, 386), (656, 386), (1048, 386), (1080, 650), (592, 578)]):
    prop(f"garden_flowers_{index}", "flowers", x, y, (12, 5))
for index, (x, y) in enumerate([(656, 418), (688, 418), (944, 610)]):
    prop(f"garden_crate_{index}", "crate", x, y, (12, 10))
lamps = [(592, 450), (784, 386), (944, 482), (1104, 514)]
for index, (x, y) in enumerate(lamps):
    prop(f"garden_lantern_{index}", "lantern", x, y, (3, 3))

hero_visual = visual("hero_1_0", 24, 36)
hero_visual["shadow"] = {"shape": "ellipse", "width": 18, "height": 10, "opacity": .8}
hero_visual["animationSet"] = {"initialClip": 1, "clips": []}
for direction in range(4):
    hero_visual["animationSet"]["clips"].extend([
        {"id": direction, "frames": [uv(f"hero_{direction}_0")], "fps": 1, "loop": True},
        {"id": direction + 4, "frames": [uv(f"hero_{direction}_{step}") for step in range(4)], "fps": 8, "loop": True}])
hero_components = {"visual": hero_visual, "collider": {"type": "aabb", "halfWidth": 6, "halfHeight": 5, "isTrigger": False},
                   "layer": "player", "body": {"type": "kinematic", "heightSpan": {"elevation": 0, "height": 1, "floorId": 0}}}
prefabs["garden-hero"] = {"props": {"components": hero_components, "behaviorRecipes": "garden.hero"}}
instances.append({"id": "garden_hero", "prefab": "garden-hero", "x": 800, "y": 546})
prop("garden_keeper", "hero_1_0", 752, 418, (6, 5), width=24, height=36, tint="#cda7a1")
prop("garden_traveler", "hero_2_0", 592, 514, (6, 5), width=24, height=36, tint="#b6c5a0")
for index, (x, y) in enumerate([(752, 546), (976, 482), (1104, 546)]):
    prop(f"garden_token_{index}", "token_0", x, y, width=14, height=18, animation=[f"token_{i}" for i in range(4)])
    components = instances[-1]["props"]["components"]
    components["collider"] = {"type": "circle", "radius": 8, "isTrigger": True}
    components["layer"] = "pickup"
    instances[-1]["props"]["behaviorRecipes"] = "garden.token"

scene = {"format": "ferrum2d.consumer.scene-authoring", "version": 1,
         "sceneComposition": {"initialFragment": "garden", "prefabs": prefabs,
                              "fragments": {"ground": {"instances": tiles}, "garden": {"include": [{"fragment": "ground", "idPrefix": "ground."}], "instances": instances}}},
         "behaviorRecipes": {"entities": {"garden.hero": {"recipes": [{"kind": "collisionPickup", "target": "other"}]},
                                            "garden.token": {"recipes": [{"kind": "pickup", "item": "garden_token", "count": 1, "despawn": True}]}}},
         "ids": {"items": {"garden_token": 1}}, "gameplay": {"primaryActor": "garden_hero"},
         "navigation": {"columns": COLUMNS, "rows": ROWS, "cellWidth": TILE, "cellHeight": TILE, "originX": ORIGIN_X, "originY": ORIGIN_Y, "costs": costs, "obstacles": obstacles},
         "lighting": {"enabled": True, "ambient": [.08, .12, .22, .46], "directionalLight": {"directionX": .7, "directionY": .7, "intensity": .035, "color": [.45, .6, .85], "shadowOpacity": .3, "shadowLengthScale": .7, "maxCasters": 96},
                      "pointLights": [{"x": x, "y": y - 20, "radius": 142, "color": [1, .8, .45, 1], "intensity": .55, "falloff": 2} for x, y in lamps],
                      "tileOccluders": occluders, "shadows": {"enabled": True, "color": [.02, .035, .06, .18], "projectionLength": 160, "maxDistance": 170}}}
destination = OUT.parents[1] / "placement.garden.scene-authoring.json"
emit(destination, json.dumps(scene, indent=2) + "\n")
print(json.dumps({"atlas": str(OUT / "atlas.png"), "frames": len(frames), "pngBytes": len(png), "instances": len(tiles) + len(instances), "obstacles": len(obstacles), "scene": str(destination)}, indent=2))
