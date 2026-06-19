import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import {
  createScenePlacementAssetProvider,
  createScenePlacementAssetProviderFromProjectAssets,
} from "../src/authoring.js";

test("createScenePlacementAssetProvider lists and resolves sprite assets", () => {
  const provider = createScenePlacementAssetProvider([
    {
      id: " crate ",
      label: "Crate",
      width: 40,
      height: 40,
      thumbnailUrl: "crate.png",
      frames: [{
        id: "idle",
        label: "Idle",
        width: 20,
        height: 20,
        thumbnailUrl: "crate-idle.png",
        frame: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
      }],
    },
    { id: "turret", width: 34, height: 42 },
  ]);

  deepEqual(provider.listSpriteAssets().map((asset) => asset.id), ["crate", "turret"]);
  deepEqual(provider.resolveSpriteAsset("crate"), {
    id: "crate",
    label: "Crate",
    width: 40,
    height: 40,
    thumbnailUrl: "crate.png",
    frames: [{
      id: "idle",
      label: "Idle",
      width: 20,
      height: 20,
      thumbnailUrl: "crate-idle.png",
      frame: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
    }],
  });
  deepEqual(provider.listSpriteFrames("crate").map((frame) => frame.id), ["idle"]);
  equal(provider.resolveSpriteFrame("crate", "idle")?.width, 20);
  equal(provider.resolveSpriteAsset("missing"), undefined);
  equal(provider.resolveSpriteFrame("missing", "idle"), undefined);
});

test("createScenePlacementAssetProvider rejects invalid asset metadata", () => {
  assertThrows(
    () => createScenePlacementAssetProvider([{ id: "crate" }, { id: "crate" }]),
    /duplicates sprite asset/,
  );
  assertThrows(
    () => createScenePlacementAssetProvider([{ id: "crate", width: 0 }]),
    /positive finite number/,
  );
  assertThrows(
    () => createScenePlacementAssetProvider([{ id: "crate", frames: [{ id: "idle" }, { id: "idle" }] }]),
    /duplicates sprite frame/,
  );
  assertThrows(
    () => createScenePlacementAssetProvider([{ id: "crate", frames: [{ id: "idle", frame: { u0: 0.8, v0: 0, u1: 0.5, v1: 1 } }] }]),
    /greater than frame\.u0/,
  );
});

test("createScenePlacementAssetProvider reports missing asset references", () => {
  const provider = createScenePlacementAssetProvider([
    { id: "crate", frames: [{ id: "idle" }] },
  ]);

  deepEqual(provider.diagnoseSpriteAssetReference({ asset: "crate", frame: "idle" }), []);
  deepEqual(provider.diagnoseSpriteAssetReference({ asset: "missing", path: "scene.instances.enemy.visual" }), [{
    severity: "error",
    code: "missingSpriteAsset",
    path: "scene.instances.enemy.visual",
    assetId: "missing",
    message: "sprite asset 'missing' is not available in the placement asset provider",
  }]);
  deepEqual(provider.diagnoseSpriteAssetReference({ asset: "crate", frame: "walk", path: "scene.instances.enemy.visual" }), [{
    severity: "error",
    code: "missingSpriteFrame",
    path: "scene.instances.enemy.visual",
    assetId: "crate",
    frameId: "walk",
    message: "sprite asset 'crate' does not provide frame 'walk'",
  }]);
});

test("createScenePlacementAssetProviderFromProjectAssets builds assets from manifest and atlas frames", () => {
  const provider = createScenePlacementAssetProviderFromProjectAssets({
    manifest: {
      textures: {
        player: "./assets/player.png",
        atlas: "./assets/atlas.png",
      },
    },
    atlas: {
      frames: {
        "player.idle": {
          texture: "player",
          uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
          size: { width: 32, height: 32 },
        },
        "crate.full": {
          texture: "atlas",
          uv: { u0: 0.25, v0: 0, u1: 0.5, v1: 0.25 },
          size: { width: 48, height: 48 },
        },
        "tiles.floor": {
          texture: 0,
          uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
          size: { width: 160, height: 160 },
        },
      },
    },
    textureMetadata: {
      player: { label: "Player" },
      atlas: { label: "Atlas Sheet", width: 256, height: 256 },
    },
    path: "test.projectAssets",
  });

  deepEqual(provider.listSpriteAssets().map((asset) => asset.id), ["player", "atlas"]);
  deepEqual(provider.resolveSpriteAsset("player"), {
    id: "player",
    label: "Player",
    width: 32,
    height: 32,
    thumbnailUrl: "./assets/player.png",
    frames: [{
      id: "player.idle",
      label: "player.idle",
      width: 32,
      height: 32,
      thumbnailUrl: "./assets/player.png",
      frame: { u0: 0, v0: 0, u1: 1, v1: 1 },
    }],
  });
  equal(provider.resolveSpriteAsset("atlas")?.thumbnailUrl, "./assets/atlas.png");
  equal(provider.resolveSpriteFrame("atlas", "crate.full")?.frame?.u0, 0.25);
  equal(provider.resolveSpriteAsset("0"), undefined);
});

test("createScenePlacementAssetProviderFromProjectAssets accepts texture registry entries and frame id mapping", () => {
  const provider = createScenePlacementAssetProviderFromProjectAssets({
    textureRegistry: {
      entries: () => [
        { name: "turret", textureId: 7, url: "./assets/turret.png" },
      ],
    },
    atlas: {
      frames: {
        "turret.base": {
          texture: "turret",
          uv: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
          size: { width: 34, height: 42 },
        },
      },
    },
    frameId: ({ frameName }) => {
      const parts = frameName.split(".");
      return parts[parts.length - 1] ?? frameName;
    },
    frameLabel: ({ frameName }) => `Frame ${frameName}`,
  });

  equal(provider.resolveSpriteAsset("turret")?.thumbnailUrl, "./assets/turret.png");
  equal(provider.resolveSpriteFrame("turret", "base")?.label, "Frame turret.base");
  equal(provider.resolveSpriteFrame("turret", "base")?.width, 34);
});

function assertThrows(callback: () => void, pattern: RegExp): void {
  try {
    callback();
  } catch (error) {
    ok(pattern.test(error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error("expected callback to throw");
}
