import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";
import { setUiText } from "./placementLocale";

interface GardenManifest {
  format: string;
  version: number;
  texture: { id: string; file: string; width: number; height: number; sha256: string };
  frames: Record<string, { x: number; y: number; width: number; height: number }>;
}
let catalog: GardenManifest | undefined;
const url = (file: string) => new URL(`./assets/lantern-garden/${file}`, document.baseURI).href;
export function isGardenScene(scene: SceneAuthoringDocumentSpec): boolean {
  return scene.gameplay?.primaryActor === "garden_hero" && Object.hasOwn(scene.sceneComposition.prefabs ?? {}, "garden-hero");
}

export async function ensureGardenAssets(scene: SceneAuthoringDocumentSpec): Promise<void> {
  if (catalog || !isGardenScene(scene)) return;
  const response = await fetch(url("manifest.json"));
  if (!response.ok) throw new Error(`Garden assets: HTTP ${response.status}`);
  const value = await response.json() as GardenManifest;
  const texture = value.texture;
  if (value.format !== "ferrum2d.example.lantern-garden-assets" || value.version !== 1 ||
      !texture || texture.id !== "garden_atlas" || texture.file !== "atlas.png" ||
      texture.width !== 512 || texture.height !== 512 || !/^[a-f0-9]{64}$/.test(texture.sha256) ||
      !value.frames || typeof value.frames !== "object" || Object.keys(value.frames).length > 128)
    throw new Error("Invalid garden asset manifest");
  for (const [name, frame] of Object.entries(value.frames)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name) || !frame ||
        ![frame.x, frame.y, frame.width, frame.height].every(Number.isInteger) ||
        frame.x < 0 || frame.y < 0 || frame.width <= 0 || frame.height <= 0 ||
        frame.x + frame.width > 512 || frame.y + frame.height > 512)
      throw new Error(`Invalid garden frame: ${name}`);
  }
  catalog = value;
}
export function gardenTextures(): Record<string, string> {
  return catalog ? { garden_atlas: url("atlas.png") + "?revision=" + catalog.texture.sha256 } : {};
}
export function gardenAtlasFrames() {
  return Object.fromEntries(Object.entries(catalog?.frames ?? {}).map(([id, f]) => ["garden_" + id, {
    texture: "garden_atlas", uv: { u0: f.x / 512, v0: f.y / 512, u1: (f.x + f.width) / 512, v1: (f.y + f.height) / 512 },
    size: { width: f.width, height: f.height },
  }]));
}
export function gardenTextureMetadata(): Record<string, { label: string; thumbnailUrl: string; width: number; height: number }> {
  return catalog ? { garden_atlas: { label: "Lantern Garden", thumbnailUrl: url("atlas.png"), width: 512, height: 512 } } : {};
}
/** Native animation owns direction, walk/idle transitions and playback timing. */
export function configureGardenActor(engine: FerrumRuntime["engine"], scene: SceneAuthoringDocumentSpec): void {
  if (!isGardenScene(scene)) return;
  if (!engine.configureDataSceneMovementAnimation({
    idle: { up: { clip: 0 }, down: { clip: 1 }, left: { clip: 2 }, right: { clip: 3 } },
    walk: { up: { clip: 4 }, down: { clip: 5 }, left: { clip: 6 }, right: { clip: 7 } },
    initialDirection: "down",
  })) throw new Error("Garden movement animation rejected");
}

/** Example input adapter. A click sends one destination; Rust owns routing, movement and collision. */
export function createGardenPreview(options: {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  engine: FerrumRuntime["engine"];
  document(): SceneAuthoringDocumentSpec;
  mode(): "2d" | "spatial" | "game";
  revision(): number;
  pointerToWorld(point: { x: number; y: number }): { x: number; y: number };
}) {
  const hint = document.createElement("output");
  hint.className = "placement-garden-hint";
  hint.dataset.placementGardenHint = "true";
  hint.setAttribute("role", "status");
  hint.hidden = true; options.stage.append(hint);
  const lifetime = new AbortController();
  let signature = "";
  const text = () => setUiText(hint, "Lantern Garden · Click ground to move · Collect the garden tokens");
  options.canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey ||
        options.mode() !== "game" || !isGardenScene(options.document()) || options.engine.dataSceneState() !== "playing") return;
    const point = options.pointerToWorld({ x: event.clientX, y: event.clientY });
    const accepted = options.engine.moveDataSceneActorTo({ ...point, speed: 110, arrivalRadius: 0.5, cancelOnInput: true });
    if (accepted) text(); else setUiText(hint, "Choose walkable ground. Walls and the canal block the path.");
  }, { signal: lifetime.signal });
  window.addEventListener("pagehide", event => { if (!event.persisted) lifetime.abort(); }, { signal: lifetime.signal });
  return {
    sync() {
      const garden = isGardenScene(options.document()), mode = options.mode();
      options.stage.dataset.flatActor = garden ? "garden_hero" : "";
      hint.hidden = !garden || mode !== "game";
      const next = JSON.stringify([garden, mode, options.revision()]);
      if (next === signature) return;
      if (garden && mode === "2d") options.engine.pauseDataScene();
      signature = next; text();
    },
  };
}
