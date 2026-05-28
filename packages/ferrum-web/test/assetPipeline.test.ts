import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  importAsepriteAtlas,
  importAsepriteAtlasFrames,
} from "../src/assetPipeline.js";
import { rejectsWithMessage } from "./assetPipeline.shared.js";

test("importAsepriteAtlas converts hash frames into Shooter atlas metadata", () => {
  const imported = importAsepriteAtlas({
    frames: {
      "player.idle.0.png": {
        frame: { x: 0, y: 0, w: 16, h: 24 },
        rotated: false,
        trimmed: false,
        sourceSize: { w: 16, h: 24 },
      },
      "bullet.default.png": {
        frame: { x: 32, y: 8, w: 8, h: 8 },
        rotated: false,
        trimmed: false,
        sourceSize: { w: 8, h: 8 },
      },
    },
    meta: {
      image: "sprites.png",
      size: { w: 64, h: 32 },
    },
  }, { texture: "sprites", frameNamePrefix: "game." });

  deepEqual(imported.frameNames, ["game.player.idle.0", "game.bullet.default"]);
  equal(imported.image, "sprites.png");
  equal(imported.width, 64);
  equal(imported.height, 32);
  deepEqual(imported.atlas.frames?.["game.player.idle.0"], {
    texture: "sprites",
    uv: { u0: 0, v0: 0, u1: 0.25, v1: 0.75 },
    size: { width: 16, height: 24 },
  });
  deepEqual(imported.atlas.frames?.["game.bullet.default"], {
    texture: "sprites",
    uv: { u0: 0.5, v0: 0.25, u1: 0.625, v1: 0.5 },
    size: { width: 8, height: 8 },
  });
});

test("importAsepriteAtlas supports array frames and source-size display mode", () => {
  const frames = importAsepriteAtlasFrames({
    frames: [
      {
        filename: "enemy.png",
        frame: { x: 32, y: 0, w: 16, h: 16 },
        rotated: false,
        trimmed: true,
        sourceSize: { w: 24, h: 20 },
      },
    ],
    meta: {
      image: "sprites.png",
      size: { w: 64, h: 64 },
    },
  }, { texture: 3, sizeSource: "source" });

  deepEqual(frames.enemy, {
    texture: 3,
    uv: { u0: 0.5, v0: 0, u1: 0.75, v1: 0.25 },
    size: { width: 24, height: 20 },
  });
});

test("importAsepriteAtlas rejects rotated frames", () => {
  rejectsWithMessage(
    () => importAsepriteAtlas({
      frames: {
        spin: {
          frame: { x: 0, y: 0, w: 16, h: 16 },
          rotated: true,
        },
      },
      meta: { size: { w: 64, h: 64 } },
    }, { texture: "sprites" }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.aseprite.frames.spin' detail='rotated Aseprite frames are not supported'.",
  );
});

test("importAsepriteAtlas rejects duplicate normalized frame names", () => {
  rejectsWithMessage(
    () => importAsepriteAtlas({
      frames: {
        "hero.png": { frame: { x: 0, y: 0, w: 16, h: 16 } },
        "hero.aseprite": { frame: { x: 16, y: 0, w: 16, h: 16 } },
      },
      meta: { size: { w: 64, h: 64 } },
    }, { texture: "sprites" }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.aseprite.frames.hero.aseprite' detail='duplicate imported frame name \\'hero\\''.",
  );
});

test("importAsepriteAtlas rejects frames outside atlas bounds", () => {
  rejectsWithMessage(
    () => importAsepriteAtlas({
      frames: {
        wall: { frame: { x: 48, y: 0, w: 32, h: 16 } },
      },
      meta: { size: { w: 64, h: 64 } },
    }, { texture: "sprites" }),
    "Invalid asset pipeline metadata: kind=asset-pipeline path='assetPipeline.aseprite.frames.wall.frame.w' detail='frame exceeds atlas width'.",
  );
});
