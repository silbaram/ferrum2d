import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { lightingQualityModel } from "./lighting-quality-model.mjs";
import { buildShadowComparison } from "./build-shadow-comparison.mjs";

// Deterministic example authoring data; runtime simulation remains in Rust.
const output = new URL("../../examples/starter-runtime/public/features/", import.meta.url);
await mkdir(new URL("spatial/", output), { recursive: true });
const contentIds = {};
for (const name of ["cart", "lamp"]) {
  const source = new URL(`../../apps/placement-viewer/public/assets/rpg-village/${name}.glb`, import.meta.url);
  contentIds[name] = createHash("sha256").update(await readFile(source)).digest("hex");
  await copyFile(source, new URL(`spatial/${name}.glb`, output));
}
const emissionModel = lightingQualityModel();
contentIds.emitter = createHash("sha256").update(emissionModel).digest("hex");
await writeFile(new URL("spatial/emitter.glb", output), emissionModel);
const camera = { projection: "orthographic", position: { x: 240, y: -320, elevation: 420 },
  target: { x: 0, y: 0, elevation: 16 }, height: 250, near: 0.1, far: 2000 };
const body = (layer, texture = "robot", type = "kinematic", elevation = 0, height = 24) => ({
  visual: { kind: "sprite", texture, width: 24, height: 32, originY: 1,
    ...(texture === "robot" ? { frame: { u0: 0, v0: 0, u1: 0.25, v1: 1 } } : {}) },
  collider: { type: "aabb", halfWidth: 4, halfHeight: 4, isTrigger: false },
  layer, body: { type, heightSpan: { floorId: 0, elevation, height } },
});
const instance = (id, x, y, components, recipes = []) => ({ id, prefab: "object", x, y,
  props: { components, ...(recipes.length ? { behaviorRecipes: recipes } : {}) } });
const scene = (instances, spatial, gameplay = {}) => ({
  format: "ferrum2d.consumer.scene-authoring", version: 1,
  sceneComposition: { initialFragment: "lab", prefabs: { object: {} }, fragments: { lab: { instances } } },
  behaviorRecipes: { entities: {} }, gameplay, spatial: { camera, ...spatial },
});
const movement = scene([instance("actor", 0, -64, body("player"))], {
  terrain: [
    { id: "ground", x: -64, y: -96, width: 128, depth: 64, elevation: 0, color: [0.18, 0.32, 0.3, 1] },
    { id: "ramp", x: -64, y: -32, width: 128, depth: 64, elevation: 0, endElevation: 48, kind: "ramp", color: [0.35, 0.42, 0.48, 1] },
    { id: "upper", x: -64, y: 32, width: 128, depth: 64, elevation: 48, baseElevation: 40, floorId: 1, kind: "bridge", color: [0.62, 0.44, 0.22, 1] },
  ],
  connections: [{ from: "ramp", to: "upper" }],
  billboards: { actor: {} }, actor: { instanceId: "actor", speed: 72, maxStepHeight: 12, maxDropHeight: 52 },
}, { primaryActor: "actor" });
const combat = scene([
  instance("actor", 88, 0, body("player"), ["actor"]),
  instance("enemy", -88, 0, { ...body("enemy"), visual: { ...body("enemy").visual, color: "#ff9370" } }, ["enemy"]),
  instance("wall", 0, 0, { ...body("wall", "wall", "static", 0, 40),
    collider: { type: "aabb", halfWidth: 12, halfHeight: 30, isTrigger: false }, visual: { ...body("wall", "wall").visual, color: "#ffffff00" } }),
], {
  terrain: [
    { id: "ground", x: -160, y: -100, width: 320, depth: 200, elevation: 0, color: [0.16, 0.25, 0.28, 1] },
    { id: "obstacle", x: -12, y: -30, width: 24, depth: 60, elevation: 40, baseElevation: 0, floorId: 1, walkable: false, color: [0.4, 0.43, 0.48, 1] },
  ],
  billboards: { actor: {}, enemy: {} }, actor: { instanceId: "actor", speed: 72, maxStepHeight: 8, maxDropHeight: 8 },
}, { primaryActor: "actor", combat: true, combatNavigation: { maxAgents: 4, arrivalRadius: 0 } });
combat.ids = { actions: { attack: 7 }, timers: { attack: 7 } };
combat.behaviorRecipes.entities = {
  actor: { recipes: [{ kind: "health", max: 1000 }, { kind: "faction", faction: "player", damages: ["enemy"] }] },
  enemy: { recipes: [{ kind: "health", max: 100 }, { kind: "faction", faction: "enemy", damages: ["player"] },
    { kind: "chase", target: "primaryActor", speed: 64, stopDistance: 16 }] },
};
const attachments = scene([
  instance("cart", 0, 0, { ...body("wall", "wall", "kinematic"), visual: { ...body("wall", "wall").visual, color: "#ffffff00" } }),
  instance("lamp", 30, 0, { ...body("wall", "wall", "static", 0, 64), visual: { ...body("wall", "wall").visual, color: "#ffffff00" } }),
  instance("box", -18, 0, { ...body("wall", "wall", "static", 24, 16), visual: { kind: "sprite", texture: "wall", width: 18, height: 18, originY: 1, color: "#f5a742" } }),
], {
  terrain: [{ id: "ground", x: -140, y: -80, width: 280, depth: 160, elevation: 0, color: [0.17, 0.25, 0.29, 1] }],
  models: { cart: { asset: "cart", contentId: contentIds.cart }, lamp: { asset: "lamp", contentId: contentIds.lamp, scale: 0.65 } },
  billboards: { box: {} },
  attachments: { lamp: { parent: "cart", x: 30 }, box: { parent: "cart", x: -18, elevation: 24 } },
});
const environment = scene([
  instance("actor", 48, -32, body("player", "robot", "static")),
  instance("light", -90, -60, { ...body("wall", "energy", "kinematic", 100, 4), collider: { type: "circle", radius: 1, isTrigger: true }, visual: { kind: "sprite", texture: "energy", width: 12, height: 12 } }),
  instance("emitter", 38, 20, { ...body("wall", "wall", "static", 0, 40), visual: { ...body("wall", "wall").visual, color: "#ffffff00" } }),
], {
  terrain: [
    { id: "ground", x: -120, y: -90, width: 240, depth: 180, elevation: 0, color: [.45, .49, .5, 1] },
    { id: "column", x: -20, y: -12, width: 40, depth: 30, elevation: 64, baseElevation: 0, floorId: 1, walkable: false, color: [.65, .65, .68, 1] },
    { id: "rear", x: -90, y: 50, width: 35, depth: 25, elevation: 36, baseElevation: 0, floorId: 1, walkable: false, color: [.5, .6, .65, 1] },
  ], billboards: { actor: {}, light: {} }, models: { emitter: { asset: "emitter", contentId: contentIds.emitter } },
  environment: { lighting: { ambient: [.18, .18, .2], lights: [{ position: { x: -90, y: -60, elevation: 100 }, radius: 420, color: [1, .85, .65], intensity: 2 }], shadows: { lightIndex: 0, resolution: 256, bias: .1 } } },
});
for (const [id, document] of Object.entries({ "hd2d-movement": movement, "ai-combat": combat, "attachments": attachments, "hd2d-environment": environment })) {
  await writeFile(new URL(`${id}.json`, output), JSON.stringify(document, null, 2) + "\n");
}
await buildShadowComparison(output);
console.log("HD-2D feature scenes generated (5 documents, village models, emissive fixture and garden shadow comparison).");
