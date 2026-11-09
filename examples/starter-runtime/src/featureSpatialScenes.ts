import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";

import { environmentControls } from "./featureSpatialEnvironment";
import { shadowControls } from "./featureSpatialShadows";

export const spatialFeatureIds = new Set(["hd2d-movement", "ai-combat", "attachments", "hd2d-environment", "hd2d-shadow-proxy"]);
export const spatialControls: Record<string, string> = {
  "hd2d-environment": environmentControls,
  "hd2d-shadow-proxy": shadowControls,
  "hd2d-movement": `<label>이동 실험<select data-control="mode"><option value="ramp">경사로와 층</option><option value="lift">승강 발판</option><option value="bridge">수평 이동 발판</option></select></label>
    <div class="feature-buttons"><button data-control="go">위층으로 이동</button><button data-control="back">출발점으로 이동</button></div>`,
  "ai-combat": `<label>적 행동<select data-control="mode"><option value="chase">추적과 장애물 우회</option><option value="melee">근접 공격</option><option value="ranged">원거리 공격</option></select></label>
    <p>청록: 플레이어 · 주황: 적 · 회색: 장애물</p>`,
  attachments: `<label class="feature-check"><input data-control="attached" type="checkbox" checked> 부모에 연결</label>
    <label>부모 위치<input data-control="position" type="range" min="-60" max="60" step="10" value="0"></label>
    <label>부모 회전<input data-control="rotation" type="range" min="0" max="360" step="15" value="0"></label>`,
};

/** Cold authoring presets. No movement, combat or hierarchy simulation lives here. */
export function spatialFeatureScene(source: SceneAuthoringDocumentSpec, id: string, mode: string): SceneAuthoringDocumentSpec {
  const scene = structuredClone(source);
  if (id === "hd2d-movement" && mode !== "ramp") {
    const lift = mode === "lift";
    return { ...scene, sceneComposition: { ...scene.sceneComposition,
      fragments: { lab: { instances: scene.sceneComposition.fragments!.lab!.instances!.map(i => ({ ...i, x: 0, y: 0 })) } } },
      spatial: { ...scene.spatial!, connections: [],
        terrain: [
          { id: "left", x: -96, y: -32, width: 72, depth: 64, elevation: 0, color: [0.18, 0.32, 0.3, 1] },
          { id: "platform", x: -24, y: -32, width: 48, depth: 64, elevation: 0, baseElevation: -8, color: [0.68, 0.46, 0.18, 1] },
          { id: "right", x: lift ? 24 : 104, y: -32, width: 72, depth: 64, elevation: lift ? 32 : 0, color: [0.3, 0.4, 0.48, 1] },
        ],
        movingPlatforms: [{ surfaceId: "platform", durationSeconds: 2, ...(lift ? { offsetElevation: 32 } : { offsetX: 80 }) }],
      },
    };
  }
  if (id === "ai-combat") {
    const base = scene.behaviorRecipes.entities.enemy!.recipes;
    const recipes = mode === "chase" ? base : [
      ...base.filter(r => typeof r === "string" || !("kind" in r) || r.kind !== "chase"),
      { kind: "chase" as const, target: "primaryActor" as const, speed: 64, stopDistance: mode === "melee" ? 16 : 88 },
      ...(mode === "melee" ? [{ kind: "meleeAction" as const, action: "attack", target: "player" as const, range: 28, damage: 3, cooldownSeconds: 0.6 }] :
        [{ kind: "projectileAction" as const, action: "attack", aim: "targetPlayer" as const, collisionTarget: "player" as const,
          cooldownSeconds: 0.7, speed: 100, damage: 2, lifetimeSeconds: 3 }]),
      { kind: "timerTrigger" as const, timer: "attack", action: "attack", seconds: 0.7 },
    ];
    return { ...scene, ...(mode === "ranged" ? { sceneComposition: { ...scene.sceneComposition,
      fragments: { lab: { instances: scene.sceneComposition.fragments!.lab!.instances!.map(i => i.id === "wall" ? i : { ...i, y: -64 }) } } } } : {}),
      behaviorRecipes: { ...scene.behaviorRecipes, entities: {
      ...scene.behaviorRecipes.entities, enemy: { recipes },
    } } };
  }
  return scene;
}
