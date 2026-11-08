import { decodeRenderCommands } from "@ferrum2d/ferrum-web/core";
import { ParticleVfxEmitter, particleVfxPreset, type ParticleVfxPresetName } from "@ferrum2d/ferrum-web/labs";
import type { FeatureContext, FeatureExtra } from "./featureExtras";
import "./featureParticles.css";

export const particleControls = `<label>효과<select data-control="vfx"><option value="hit-spark">불꽃 · 빠르게 튀고 수축</option><option value="dust-loop">먼지 · 느리게 퍼지고 팽창</option><option value="motion-trail">잔상 · 이동 경로</option></select></label>
  <output data-value="particle-profile" role="status"></output>
  <label>방출당 수량 <output data-value="count">24</output><input data-control="count" type="range" min="1" max="64" value="24"></label>
  <label>최대 수명 <output data-value="life">0.3초</output><input data-control="life" type="range" min="1" max="30" value="3"></label>
  <label>최대 속도 <output data-value="speed">220</output><input data-control="speed" type="range" min="0" max="300" value="220" step="2"></label>
  <div class="feature-buttons"><button data-control="emit">선택 효과 방출</button><button data-control="stop-emitter">방출 정지</button><button data-control="compare-particles">불꽃·먼지 나란히</button></div>
  <p>효과를 바꾸면 고유 기본값을 적용합니다. 나란히 비교는 기본값을 사용합니다. 정지는 새 방출을 멈추며 남은 입자는 수명 뒤 사라집니다.</p>`;
export const particleHelp = "캔버스를 눌러 선택 효과 방출 · 잔상은 방출 후 포인터 이동 · 나란히 비교에서 왼쪽 불꽃과 오른쪽 먼지의 차이를 보세요.";

// Example-only art direction. Public SDK presets retain their existing defaults.
const profiles = {
  "hit-spark": { name: "불꽃", texture: "particleSpark", count: 24, life: 3, speed: 220,
    interval: 1.4, description: "피격·충돌용 · 작은 밝은 입자가 빠르게 튀고 짧게 사라집니다.",
    startSize: [7, 11], endSize: [.5, 1.5], startColor: [1,.9,.35,1], endColor: [1,.2,.03,0], accelerationY: 90, damping: 1.4 },
  "dust-loop": { name: "먼지", texture: "particleDust", count: 5, life: 14, speed: 40,
    interval: .18, description: "발걸음·착지·차량 먼지용 · 부드러운 흙색 구름이 느리게 커지며 투명해집니다.",
    startSize: [9, 14], endSize: [30, 44], startColor: [.63,.55,.44,.34], endColor: [.5,.43,.34,0], accelerationY: -14, damping: .8 },
  "motion-trail": { name: "잔상", texture: "particleTrail", count: 2, life: 5, speed: 16,
    interval: .05, description: "이동 강조용 · 포인터가 지나간 월드 위치에 푸른 입자를 남깁니다.",
    startSize: [7, 11], endSize: [1, 2], startColor: [.35,.75,1,.75], endColor: [.15,.35,1,0], accelerationY: 0, damping: 1.8 },
} as const;
type Kind = keyof typeof profiles;

/** Presentation emits bursts; Rust owns particle motion, interpolation, expiry and render commands. */
export function createParticleFeature(ctx: FeatureContext): FeatureExtra {
  const { root, canvas, signal, runtime } = ctx, engine = runtime.engine;
  const control = <T extends HTMLInputElement | HTMLSelectElement>(key: string) => root.querySelector<T>(`[data-control="${key}"]`)!;
  const output = (key: string, text: string) => { root.querySelector(`[data-value="${key}"]`)!.textContent = text; };
  const selected = () => control<HTMLSelectElement>("vfx").value as Kind;
  const on = (key: string, event: string, callback: () => void) => root.querySelector(`[data-control="${key}"]`)!.addEventListener(event, callback, { signal });
  let emitter: ParticleVfxEmitter | undefined, comparison: ParticleVfxEmitter[] = [], comparing = false;
  let pointer = { x: 320, y: 192 }, lastTime: number | undefined, lastSample = -Infinity;
  let native: Record<string, { textureId: number; count: number; meanSize: number; meanAlpha: number }> = {};
  const overlay = document.createElement("div"); overlay.className = "feature-particle-comparison"; overlay.hidden = true;
  const labels = ["불꽃 · 짧고 빠름", "먼지 · 크고 느림"].map(text => {
    const label = document.createElement("span"); label.textContent = text; overlay.append(label); return label;
  });
  root.querySelector(".feature-scene")!.append(overlay);
  const stop = () => { emitter?.stop(); for (const item of comparison) item.stop(); };
  const clear = () => { stop(); comparison = []; emitter = undefined; engine.clearParticles(); native = {}; lastTime = undefined; };
  const create = (kind: Kind, presetId: number, custom: boolean, loop = false) => {
    const profile = profiles[kind], preset = particleVfxPreset(kind as ParticleVfxPresetName, profile.texture);
    const life = (custom ? Number(control("life").value) : profile.life) / 10;
    const speed = custom ? Number(control("speed").value) : profile.speed;
    return ParticleVfxEmitter.create({ target: engine, presetId, preset: {
      particle: { ...preset.particle, texture: profile.texture, burstCount: custom ? Number(control("count").value) : profile.count,
        lifetime: [life * .7, life], speed: [speed * .3, speed], startSize: profile.startSize, endSize: profile.endSize,
        startColor: profile.startColor, endColor: profile.endColor, accelerationY: profile.accelerationY, damping: profile.damping },
      emitter: { ...preset.emitter, mode: loop ? "loop" : preset.emitter?.mode, intervalSeconds: profile.interval, autostart: false, maxBurstsPerUpdate: 1 },
    } });
  };
  const observation = () => comparing
    ? `기본값 나란히 비교 · 왼쪽 불꽃 ${profiles["hit-spark"].life / 10}초 / 오른쪽 먼지 ${profiles["dust-loop"].life / 10}초 · 현재 ${engine.particleCount()}개`
    : `${profiles[selected()].name} · 현재 입자 ${engine.particleCount()}개 · 누적 방출 ${emitter?.snapshot().spawnedParticleCount ?? 0}개 · ${emitter?.snapshot().active ? "방출 중" : "방출 대기/정지"}`;
  const setup = (defaults = false) => {
    clear(); comparing = false; root.dataset.particleComparing = "false"; overlay.hidden = true;
    const profile = profiles[selected()];
    if (defaults) for (const key of ["count", "life", "speed"] as const) control(key).value = String(profile[key]);
    for (const key of ["count", "speed"] as const) output(key, control(key).value);
    output("life", `${(Number(control("life").value) / 10).toFixed(1)}초`);
    output("particle-profile", profile.description);
    emitter = create(selected(), 30, true);
    output("observation", observation());
  };
  const emit = () => {
    if (!ctx.playing()) return;
    if (comparing) setup();
    if (selected() === "hit-spark") emitter!.trigger(pointer.x, pointer.y); else emitter!.start(pointer.x, pointer.y);
    output("observation", observation());
  };
  on("vfx", "change", () => setup(true));
  for (const key of ["count", "life", "speed"]) on(key, "input", () => setup());
  on("emit", "click", emit); on("stop-emitter", "click", () => { stop(); output("observation", observation()); });
  on("compare-particles", "click", () => {
    if (!ctx.playing()) return;
    clear(); comparing = true; root.dataset.particleComparing = "true"; overlay.hidden = false;
    comparison = [create("hit-spark", 31, false, true), create("dust-loop", 32, false, true)];
    comparison[0].trigger(190, 220); comparison[1].trigger(450, 220);
    comparison[0].start(190, 220); comparison[1].start(450, 220);
    output("particle-profile", "기본값 비교 · 불꽃은 1.4초마다 짧게 방출하고, 먼지는 부드럽게 연속 방출합니다.");
    output("observation", observation());
  });
  canvas.addEventListener("pointermove", event => { pointer = ctx.worldPoint(event); }, { signal });
  canvas.addEventListener("pointerdown", event => { if (event.button === 0) { pointer = ctx.worldPoint(event); emit(); } }, { signal });
  setup(true);
  return {
    reset() { control("vfx").value = "hit-spark"; pointer = { x: 320, y: 192 }; setup(true); },
    frame(frame) {
      // Copy native command aggregates before an emitter update can call Wasm.
      if (performance.now() - lastSample >= 50) {
        lastSample = performance.now();
        const commands = decodeRenderCommands(frame.renderCommandBuffer);
        native = Object.fromEntries(Object.entries(profiles).map(([kind, profile]) => {
          const textureId = ctx.assets.textureId(profile.texture), rows = commands.filter(command => command.textureId === textureId);
          return [kind, { textureId, count: rows.length,
            meanSize: rows.length ? rows.reduce((n,row) => n + row.width,0) / rows.length : 0,
            meanAlpha: rows.length ? rows.reduce((n,row) => n + row.color[3],0) / rows.length : 0 }];
        }));
      }
      const dt = lastTime === undefined ? 0 : Math.max(0, Math.min(.05, frame.timeSeconds - lastTime)); lastTime = frame.timeSeconds;
      if (ctx.playing()) {
        if (comparing) { comparison[0].update(dt,190,220); comparison[1].update(dt,450,220); }
        else emitter?.update(dt,pointer.x,pointer.y);
      }
      if (comparing) labels.forEach((label, index) => {
        const point = ctx.screenPoint({ x: index ? 450 : 190, y: 80 });
        label.style.left = `${point.x}px`; label.style.top = `${point.y}px`;
      });
    },
    observation,
    snapshot: () => ({ particles: { ...emitter?.snapshot(), count: engine.particleCount(), selected: selected(), comparing,
      active: comparing ? comparison.some(item => item.snapshot().active) : emitter?.snapshot().active ?? false,
      comparison: comparison.map(item => item.snapshot()), native,
      profile: { texture: profiles[selected()].texture, description: profiles[selected()].description } } }),
    pause() { lastTime = undefined; },
    destroy() { stop(); overlay.remove(); delete root.dataset.particleComparing; },
  };
}
