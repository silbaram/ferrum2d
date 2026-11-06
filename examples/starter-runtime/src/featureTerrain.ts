import { resolvePhysicsSpec } from "@ferrum2d/ferrum-web/core";
import { createPixelMaskTerrain, createPixelMaskTerrainRuntime, type PixelMaskTerrainRuntime, type PixelMaskTerrainRuntimeSyncResult } from "@ferrum2d/ferrum-web/labs";
import type { FeatureContext, FeatureExtra } from "./featureExtras";

export const terrainControls = `<label>깎기 반경 <output data-value="terrain-radius">12 픽셀</output><input data-control="terrain-radius" type="range" min="4" max="28" step="2" value="12"></label>
  <div class="feature-buttons"><button data-control="terrain-hole">중앙 구멍</button><button data-control="terrain-ball">공 다시 놓기</button></div>
  <p>초록 지형을 클릭해 깎습니다. 중앙 구멍은 바닥까지 관통합니다. 위의 실험 초기화는 지형도 복구합니다.</p>
  <output data-value="terrain-edit" role="status">공이 지면에 멈추는지 먼저 확인하세요.</output>`;

/** Editing is a bounded, click-only authoring operation; Rust owns the falling body. */
export function createTerrainFeature(ctx: FeatureContext): FeatureExtra {
  const { runtime, root, canvas, signal } = ctx, engine = runtime.engine, renderer = runtime.renderer;
  const createTexture = renderer.createPixelMaskTerrainTexture, patchTexture = renderer.updatePixelMaskTerrainTexture;
  if (!createTexture || !patchTexture) throw Error("이 렌더러는 지형 마스크 텍스처를 지원하지 않습니다.");
  const target = { createPixelMaskTerrainTexture: createTexture.bind(renderer), updatePixelMaskTerrainTexture: patchTexture.bind(renderer) };
  const textureId = ctx.assets.textureId("floor");
  // Chunk replacement also applies the global physics config; keep edits and reset identical.
  const physicsSettings = { mode: "rigid" as const, gravity: [0, 300] as [number, number], continuous: true,
    solver: { velocityIterations: 8, positionIterations: 6 } };
  let terrain: PixelMaskTerrainRuntime | undefined, edits = 0, physicsSeconds = 0, gravityY = 300;
  let sync: PixelMaskTerrainRuntimeSyncResult | undefined;
  const control = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-control="${name}"]`)!;
  const output = (key: string, text: string) => { root.querySelector(`[data-value="${key}"]`)!.textContent = text; };
  const handle = () => runtime.dataScene!.result.entityHandles.ball!;
  const check = (ok: boolean) => { if (!ok) throw Error("지형 실험의 물리 설정을 적용하지 못했습니다."); };
  const dispose = () => {
    if (terrain) { terrain.destroy(); terrain.terrain.destroy(); terrain = undefined; }
  };
  const resetBall = () => {
    if (!ctx.playing()) return;
    check(engine.setPhysicsBodyPosition(handle(), 320, 80)); check(engine.setPhysicsBodyVelocity(handle(), 0, 0));
  };
  const carve = (x: number, y: number, radius: number) => {
    if (!ctx.playing() || !terrain) return;
    if (x < 0 || x >= 128 || y < 0 || y >= 48) { output("terrain-edit", "초록 지형 안을 선택하세요."); return; }
    const previous = terrain.terrain.version;
    sync = terrain.carveCircle(x, y, radius);
    if (sync.terrainVersion !== previous) {
      edits++;
      output("terrain-edit", `편집 ${edits}회 · 충돌 청크 ${sync.colliderChunksRebuilt}개 갱신`);
    }
  };
  control("terrain-hole").addEventListener("click", () => carve(64, 24, 28), { signal });
  control("terrain-ball").addEventListener("click", resetBall, { signal });
  control("terrain-radius").addEventListener("input", () => output("terrain-radius", `${control<HTMLInputElement>("terrain-radius").value} 픽셀`), { signal });
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault(); canvas.focus();
    const p = ctx.worldPoint(event);
    carve((p.x - 64) / 4, (p.y - 160) / 4, Number(control<HTMLInputElement>("terrain-radius").value));
  }, { signal });
  return {
    beforeReset: dispose,
    reset() {
      dispose(); edits = 0; physicsSeconds = 0;
      const mask = createPixelMaskTerrain({ width: 128, height: 48, fill: "solid" });
      terrain = createPixelMaskTerrainRuntime({ terrain: mask,
        texture: { target, textureId, upload: { color: [122, 154, 101] } },
        physics: { engine, baseSpec: physicsSettings, chunkWidth: 32, chunkHeight: 24, maxDirtyChunksPerSync: 8,
          boundary: { tileWidth: 4, tileHeight: 4, originX: 64, originY: 160 } } });
      sync = terrain.sync();
      engine.configurePhysicsRuntime(resolvePhysicsSpec(physicsSettings));
      engine.configureAutoRigidBodyStep({ gravityX: 0, gravityY: 300, continuous: true, velocityIterations: 8, positionIterations: 6 });
      check(engine.setPhysicsBodyMaterial(handle(), { restitution: 0, friction: .5 }));
      output("terrain-radius", "12 픽셀"); output("terrain-edit", "공이 지면에 멈추는지 먼저 확인하세요.");
    },
    frame(frame) {
      // Native elapsed time includes the fixed-step remainder; count only simulated time.
      physicsSeconds += frame.physics.fixedConsumedSeconds;
      gravityY = frame.physics.gravityY;
    }, pause() {},
    observation: () => `편집 ${edits}회 · 지형 충돌 몸체 ${sync?.colliderBodies ?? 0}개 · 최근 갱신 ${sync?.colliderChunksRebuilt ?? 0}청크 · 공 Y ${engine.getPhysicsEntity(handle())?.y.toFixed(1)}`,
    snapshot: () => ({ terrain: { edits, physicsSeconds, gravityY, ...sync, centerSolid: terrain?.terrain.isSolid(64, 24) ?? false, surfaceSolid: terrain?.terrain.isSolid(64, 0) ?? false } }),
    destroy: dispose,
  };
}
