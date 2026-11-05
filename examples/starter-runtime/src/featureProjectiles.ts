import { decodeRenderCommands } from "@ferrum2d/ferrum-web/core";
import { behaviorRecipeCommandsForEntity, compileWeaponProfiles, projectile, weapon } from "@ferrum2d/ferrum-web/authoring";
import type { FeatureContext, FeatureExtra } from "./featureExtras";

export const projectileControls = `<label>벽 충돌<select data-control="projectile"><option value="despawn">일반 · 벽에서 소멸</option><option value="passThrough">관통 · 벽 통과</option><option value="bounce">반사 · 벽에서 되돌아옴</option></select></label><button data-control="fire">한 발 발사</button><p>속도 220 · 수명 4초 · 최소 발사 간격 0.2초로 동일합니다. 설정을 바꾸면 기존 탄을 비웁니다.</p>`;

export function createProjectileFeature(ctx: FeatureContext): FeatureExtra {
  const { runtime, root, signal } = ctx, engine = runtime.engine;
  const selection = root.querySelector<HTMLSelectElement>('[data-control="projectile"]')!;
  let queued = false, shots = 0, samples: number[] = [], lastSample = -Infinity, bulletX: number | undefined;
  const reset = () => {
    engine.setGameSpec(ctx.source as Parameters<typeof engine.setGameSpec>[0]); engine.resetGame();
    engine.setTextureIds({ player: engine.textureId("robot"), enemy: engine.textureId("robot"), bullet: engine.textureId("energy") });
    engine.setBuiltInSceneEntityPosition(engine.builtInShooterPlayerHandle()!, 160, 192);
    const impact = selection.value as "despawn" | "passThrough" | "bounce";
    const profiles = compileWeaponProfiles([weapon("shot").actionId(1).cooldown(.2).fire(projectile("shot").speed(220).damage(1).lifetime(4).tileImpact(impact))]);
    engine.applyGameplayBehaviorCommands(behaviorRecipeCommandsForEntity(profiles, "shot"), { shot: engine.builtInShooterPlayerHandle()! });
    engine.setInputActionBinding(1, 0, { control: "space", activation: "pressed" });
    runtime.input.clear(); queued = false; shots = 0; samples = []; bulletX = undefined; lastSample = -Infinity;
  };
  root.querySelector('[data-control="fire"]')!.addEventListener("click", () => { if (ctx.playing()) { queued = true; samples = []; } }, { signal });
  selection.addEventListener("change", () => { reset(); ctx.configureView(); }, { signal });
  return {
    reset, input: snapshot => {
      const fire = queued && ctx.playing(); queued = false; if (fire) shots++;
      const viewport = runtime.renderer.viewportSize();
      return { ...snapshot, w: false, a: false, s: false, d: false, enter: false, space: fire, mouseLeft: false, mouseX: viewport.width * .9, mouseY: viewport.height / 2 };
    },
    frame: frame => {
      if (frame.timeSeconds - lastSample < .05) return;
      lastSample = frame.timeSeconds;
      // Bounded diagnostic sampling of the bulk render buffer; simulation remains native.
      const bullet = decodeRenderCommands(frame.renderCommandBuffer).find(c => c.textureId === engine.textureId("energy"));
      bulletX = bullet?.x; if (bullet && samples.length < 100) samples.push(bullet.x);
    },
    observation: () => `발사 요청 ${shots}회 · 탄 X ${bulletX?.toFixed(0) ?? "없음"} · 중앙 벽 X 320~352`,
    snapshot: () => ({ projectile: { impact: selection.value, shots, bulletX, samples: [...samples] } }),
    pause: () => { queued = false; }, destroy() {},
  };
}
