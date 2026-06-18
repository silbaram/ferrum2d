import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  DATA_SCENE_PRIMITIVE_TEXTURES,
  dataSceneObjectVisualBounds,
  resolveDataSceneComponentsSpec,
  resolveDataSceneInstanceComponents,
} from "../src/dataSceneComponents.js";
import type { ResolvedSceneCompositionInstance } from "../src/sceneComposition.js";

test("resolveDataSceneComponentsSpec resolves inline sprite, collider, and layer descriptors", () => {
  const resolved = resolveDataSceneComponentsSpec({
    sprite: {
      texture: "agent",
      width: 24,
      height: 32,
      frame: { u0: 0.25, v0: 0, u1: 0.5, v1: 1 },
      animation: { frameCount: 4, fps: 8 },
    },
    collider: {
      type: "aabb",
      halfWidth: 10,
      halfHeight: 14,
      offsetX: 1,
      offsetY: -2,
      enabled: true,
      isTrigger: false,
    },
    layer: "enemy",
  }, { path: "scene.props.components" });

  equal(resolved.mode, "inline");
  if (resolved.mode !== "inline") {
    throw new Error("expected inline components");
  }
  deepEqual(resolved.sprite.texture, {
    kind: "asset",
    value: "agent",
    name: "agent",
  });
  deepEqual(resolved.sprite.frame, { u0: 0.25, v0: 0, u1: 0.5, v1: 1 });
  deepEqual(resolved.sprite.animation, { frameCount: 4, fps: 8 });
  deepEqual(resolved.visual, {
    kind: "sprite",
    texture: {
      kind: "asset",
      value: "agent",
      name: "agent",
    },
    width: 24,
    height: 32,
    frame: { u0: 0.25, v0: 0, u1: 0.5, v1: 1 },
    animation: { frameCount: 4, fps: 8 },
    originX: 0.5,
    originY: 0.5,
    bounds: { width: 24, height: 32 },
  });
  deepEqual(resolved.collider, {
    type: "aabb",
    halfWidth: 10,
    halfHeight: 14,
    offsetX: 1,
    offsetY: -2,
    enabled: true,
    isTrigger: false,
  });
  deepEqual(resolved.layer, { name: "enemy", code: 1 });
});

test("resolveDataSceneComponentsSpec supports numeric texture and layer ids", () => {
  const resolved = resolveDataSceneComponentsSpec({
    sprite: {
      texture: 7,
      width: 8,
      height: 8,
    },
    collider: "none",
    layer: 4,
  });

  equal(resolved.mode, "inline");
  if (resolved.mode !== "inline") {
    throw new Error("expected inline components");
  }
  deepEqual(resolved.sprite.texture, {
    kind: "id",
    value: 7,
    id: 7,
  });
  deepEqual(resolved.sprite.frame, { u0: 0, v0: 0, u1: 1, v1: 1 });
  deepEqual(resolved.collider, { type: "none" });
  deepEqual(resolved.layer, { name: "pickup", code: 4 });
});

test("resolveDataSceneComponentsSpec resolves primitive visual descriptors into runtime sprites", () => {
  const resolved = resolveDataSceneComponentsSpec({
    visual: {
      kind: "primitive",
      shape: "circle",
      radius: 18,
      color: "#7ddc9d",
    },
    collider: { type: "circle", radius: 18 },
    layer: "wall",
  }, { path: "scene.props.components" });

  equal(resolved.mode, "inline");
  if (resolved.mode !== "inline") {
    throw new Error("expected inline components");
  }
  deepEqual(resolved.visual, {
    kind: "primitive",
    shape: "circle",
    color: "#7ddc9d",
    width: 36,
    height: 36,
    radius: 18,
    bounds: { width: 36, height: 36 },
  });
  deepEqual(dataSceneObjectVisualBounds(resolved), { width: 36, height: 36 });
  deepEqual(resolved.sprite.texture, {
    kind: "asset",
    value: DATA_SCENE_PRIMITIVE_TEXTURES.circle,
    name: DATA_SCENE_PRIMITIVE_TEXTURES.circle,
  });
  equal(resolved.sprite.width, 36);
  equal(resolved.sprite.height, 36);
});

test("resolveDataSceneComponentsSpec resolves sprite visual descriptors with asset aliases", () => {
  const resolved = resolveDataSceneComponentsSpec({
    visual: {
      kind: "sprite",
      asset: "crate",
      width: 20,
      height: 24,
      originX: 0,
      originY: 1,
      sortOrder: 3,
      tint: "#ffffff",
    },
    collider: "none",
    layer: "pickup",
  });

  equal(resolved.mode, "inline");
  if (resolved.mode !== "inline") {
    throw new Error("expected inline components");
  }
  deepEqual(resolved.visual, {
    kind: "sprite",
    texture: {
      kind: "asset",
      value: "crate",
      name: "crate",
    },
    width: 20,
    height: 24,
    frame: { u0: 0, v0: 0, u1: 1, v1: 1 },
    originX: 0,
    originY: 1,
    sortOrder: 3,
    tint: "#ffffff",
    bounds: { width: 20, height: 24 },
  });
  deepEqual(resolved.sprite.texture, {
    kind: "asset",
    value: "crate",
    name: "crate",
  });
});

test("resolveDataSceneComponentsSpec supports catalog template references", () => {
  deepEqual(resolveDataSceneComponentsSpec({ template: "agent.base" }), {
    mode: "template",
    template: "agent.base",
  });

  expectMessage(
    () => resolveDataSceneComponentsSpec({ template: "agent.base" }, {
      allowTemplate: false,
      path: "components",
    }),
    /path='components\.template'/,
  );

  expectMessage(
    () => resolveDataSceneComponentsSpec({
      template: "agent.base",
      sprite: { texture: "agent", width: 16, height: 16 },
    }, { path: "components" }),
    /path='components\.sprite'/,
  );

  expectMessage(
    () => resolveDataSceneComponentsSpec({
      template: "agent.base",
      visual: { kind: "primitive", shape: "rect" },
    }, { path: "components" }),
    /path='components\.visual'/,
  );
});

test("resolveDataSceneComponentsSpec validates collider and frame diagnostics", () => {
  expectMessage(
    () => resolveDataSceneComponentsSpec({
      sprite: {
        texture: "agent",
        width: 16,
        height: 16,
        frame: { u0: 0.75, u1: 0.25 },
      },
      collider: { type: "aabb", halfWidth: 8, halfHeight: 8 },
      layer: "enemy",
    }, { path: "components" }),
    /path='components\.sprite\.frame\.u1'/,
  );

  expectMessage(
    () => resolveDataSceneComponentsSpec({
      sprite: { texture: "agent", width: 16, height: 16 },
      collider: { type: "convexPolygon", vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      layer: "enemy",
    }, { path: "components" }),
    /path='components\.collider\.vertices'/,
  );

  expectMessage(
    () => resolveDataSceneComponentsSpec({
      visual: { kind: "primitive", shape: "rect" },
      sprite: { texture: "agent", width: 16, height: 16 },
      collider: "none",
      layer: "enemy",
    }, { path: "components" }),
    /path='components\.visual'/,
  );
});

test("resolveDataSceneInstanceComponents reads merged instance props", () => {
  const instance: ResolvedSceneCompositionInstance = {
    id: "agent-1",
    sourceId: "agent-1",
    prefab: "agent",
    x: 10,
    y: 20,
    rotationRadians: 0,
    scale: 1,
    layer: 0,
    props: {
      components: {
        sprite: { texture: "agent", width: 24, height: 24 },
        collider: { type: "circle", radius: 12 },
        layer: "player",
      },
    },
  };

  const resolved = resolveDataSceneInstanceComponents(instance, {
    path: "dataSceneAuthoring.sceneComposition.instances.0",
  });
  equal(resolved.mode, "inline");
  if (resolved.mode !== "inline") {
    throw new Error("expected inline components");
  }
  deepEqual(resolved.collider, {
    type: "circle",
    radius: 12,
    offsetX: 0,
    offsetY: 0,
    enabled: true,
    isTrigger: true,
  });
});

function expectMessage(fn: () => void, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    equal(error instanceof Error, true);
    equal(pattern.test(error instanceof Error ? error.message : String(error)), true);
    return;
  }
  throw new Error("Expected function to throw");
}
