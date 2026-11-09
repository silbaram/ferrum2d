import type { AssetReleasePayload } from "@ferrum2d/ferrum-web/core";
import type { SceneAuthoringDocumentSpec, PostProcessStackInput } from "@ferrum2d/ferrum-web/authoring";
import { nativePosition, type FeatureContext, type FeatureExtra } from "./featureExtras";
type SpriteMaterialPresetInput = Parameters<NonNullable<FeatureContext["runtime"]["renderer"]["setSpriteMaterial"]>>[0];

export const displayControls: Record<string, string> = {
  "pixel-perfect": `<label class="feature-check"><input data-control="pixel-enabled" type="checkbox" checked> 가상 해상도 · 320 × 192</label>
    <label class="feature-check"><input data-control="pixel-snap" type="checkbox" checked> 픽셀 좌표 정렬</label>
    <label>월드 확대 <output data-value="pixel-zoom">100%</output><input data-control="pixel-zoom" type="range" min="100" max="200" step="5" value="100"></label>
    <label>소수 이동 <output data-value="pixel-offset">0</output><input data-control="pixel-offset" type="range" min="0" max="4" step="0.125" value="0"></label>
    <p>창 크기를 바꾸어 정수 확대와 여백을 확인하세요. 입력 좌표와 실제 물리 좌표는 연속 값을 유지합니다.</p>`,
  "sprite-materials": `<label>표현<select data-control="sprite-style"><option value="original">원본</option><option value="palette">팔레트 교체</option><option value="flash">피격 색상</option><option value="outline">외곽선</option></select></label>
    <p>팔레트 교체는 지정한 원본 색만 바꿉니다. 재질은 이 실험 화면 전체에 적용됩니다.</p>`,
  rendering: `<label>오브젝트 수<select data-control="object-count"><option value="2">2개</option><option value="32">32개</option><option value="128">128개</option></select></label>
    <div class="feature-buttons"><button data-control="probe-load">텍스처 준비</button><button data-control="probe-release" disabled>텍스처 해제</button></div>
    <output data-value="probe-status" role="status">검사용 텍스처 없음</output><p>원본과 다른 URL의 검사용 텍스처만 준비·해제합니다. 장면에서 쓰는 텍스처는 유지합니다.</p>`,
};
export const postProcessControls = `<label>화면 효과<select data-control="effect"><option value="clean">원본</option><option value="bloom">Bloom · 빛 번짐</option><option value="crt">CRT · 곡면 / 스캔라인</option><option value="vignette">Vignette · 주변 어둡게</option><option value="glitch">Glitch · 색상 어긋남</option><option value="pixelArt">도트 색상 · 디더링</option><option value="fade">Fade · 검은색 전환</option></select></label>
  <label>효과 강도 <output data-value="effect-strength">100%</output><input data-control="effect-strength" type="range" min="0" max="100" value="100" step="5"></label>
  <p>같은 원본을 유지한 채 효과 하나만 적용합니다. 강도 0% 또는 원본을 선택해 비교하세요.</p>`;

export function displayPostProcess(root: HTMLElement): PostProcessStackInput {
  const effect = root.querySelector<HTMLSelectElement>('[data-control="effect"]')!.value;
  const strength = Number(root.querySelector<HTMLInputElement>('[data-control="effect-strength"]')!.value) / 100;
  if (!strength || effect === "clean") return false;
  switch (effect) {
    case "bloom": return [{ kind: "bloom", threshold: .4, intensity: .8 * strength, radius: 2 }];
    case "crt": return [{ kind: "crt", curvature: .035 * strength, scanlineIntensity: .3 * strength }];
    case "vignette": return [{ kind: "vignette", intensity: .9 * strength, radius: .4, softness: .4 }];
    case "glitch": return [{ kind: "glitch", intensity: .25 * strength, chromaticAberration: .02 * strength, seed: 19 }];
    case "pixelArt": return [{ kind: "pixelArt", levels: Math.max(2, Math.round(32 - strength * 28)), dither: .8 * strength }];
    case "fade": return [{ kind: "fade", color: [0, 0, 0, .85 * strength] }];
    default: return false;
  }
}

export function createDisplayFeature(ctx: FeatureContext): FeatureExtra | undefined {
  if (!(ctx.id in displayControls)) return;
  const { root, runtime, signal, assets } = ctx, renderer = runtime.renderer;
  // The fixed catalog routes above load SceneAuthoring documents, never Shooter specs.
  const source = ctx.source as SceneAuthoringDocumentSpec;
  const control = <T extends HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(name: string) => root.querySelector<T>(`[data-control="${name}"]`)!;
  const on = (name: string, event: string, callback: () => void) => control(name).addEventListener(event, callback, { signal });
  const extra: FeatureExtra = { reset() {}, frame() {}, observation: () => "", snapshot: () => ({}), pause() {}, destroy() {} };
  if (ctx.id === "pixel-perfect") {
    const comparison = document.createElement("details"); comparison.className = "feature-atlas-comparison";
    comparison.innerHTML = `<summary>아틀라스 보호 여백 비교</summary><p>같은 원본·UV에서 투명 여백과 가장자리 2px 복제를 비교합니다. 정상 nearest 샘플링에서 항상 차이가 나타나는 옵션은 아니며 내부 텍셀 정밀도를 바꾸지 않습니다.</p><div><figure><img src="./features/atlas/padding-0.png" alt="투명 보호 여백의 바닥 타일 아틀라스"><figcaption>padding 2 · extrude 0</figcaption></figure><figure><img src="./features/atlas/padding-2.png" alt="가장자리를 2픽셀 복제한 바닥 타일 아틀라스"><figcaption>padding 2 · extrude 2</figcaption></figure></div>`;
    root.querySelector(".feature-scene")!.after(comparison);
    const apply = () => {
      const offset = Number(control("pixel-offset").value);
      const scene = structuredClone(source), instances = scene.sceneComposition.fragments!.lab!.instances!;
      scene.display = {pixelPerfect: control<HTMLInputElement>("pixel-enabled").checked ? {width:320,height:192,snap:control<HTMLInputElement>("pixel-snap").checked} : false};
      for (const item of instances) if (item.id === "robot") item.x = 240 + offset;
      ctx.reapply(scene); ctx.configureView();
      root.querySelector('[data-value="pixel-offset"]')!.textContent = offset.toFixed(3);
      root.querySelector('[data-value="pixel-zoom"]')!.textContent = `${control("pixel-zoom").value}%`;
    };
    on("pixel-enabled", "change", apply); on("pixel-snap", "change", apply); on("pixel-offset", "input", apply); on("pixel-zoom", "input", apply);
    extra.viewport = () => ({width:640 / (Number(control("pixel-zoom").value)/100),height:384 / (Number(control("pixel-zoom").value)/100)});
    extra.reset = apply;
    extra.observation = () => { const p = renderer.pixelPerfectPresentation?.(), position = nativePosition(runtime,runtime.dataScene!.result.entityHandles.robot); return p ? `가상 ${p.sourceWidth} × ${p.sourceHeight} · 확대 ${p.scale}배 · 실제 X ${position?.x.toFixed(3) ?? "—"}` : "가상 해상도 끔 · 연속 좌표 표시"; };
    extra.snapshot = () => ({ pixel: { presentation: renderer.pixelPerfectPresentation?.(), viewport: renderer.viewportSize(), position: nativePosition(runtime,runtime.dataScene!.result.entityHandles.robot), offset: Number(control("pixel-offset").value), snap: control<HTMLInputElement>("pixel-snap").checked } });
    extra.destroy = () => { comparison.remove(); renderer.setPixelPerfect?.(false); };
  } else if (ctx.id === "sprite-materials") {
    const apply = () => {
      const mode = control("sprite-style").value;
      // Mix toward red: mixing a white sprite tint toward white would hide the comparison.
      const material: SpriteMaterialPresetInput = mode === "original" ? false : mode === "palette" ? {
        paletteSwap: [{ textureId: assets.textureId("robot"), colors: [{ from: "#46768b", to: "#d69a6c" }, { from: "#b6c3bd", to: "#f5c781" }] }],
      } : mode === "flash" ? {colorMix:{color:[1,.15,.1,1],amount:.8,preserveAlpha:true}} : {outline:{color:[.35,.8,1,1],thickness:2,directions:"eight"}};
      renderer.setSpriteMaterial?.(material);
    };
    on("sprite-style", "change", apply); extra.reset = apply;
    extra.observation = () => `표현 ${control<HTMLSelectElement>("sprite-style").selectedOptions[0]!.textContent} · 원본 이미지·위치·크기 동일`;
    extra.snapshot = () => ({ sprite: { style: control("sprite-style").value } });
    extra.destroy = () => renderer.setSpriteMaterial?.(false);
  } else {
    let loaded = false, pending = false, destroyed = false, generation = 0;
    let request: AbortController | undefined;
    const url = new URL("./playground/ball.png?resource-probe=1", document.baseURI).href;
    const entry = {kind: "texture" as const, name: "resource-probe", url};
    const payload: AssetReleasePayload = {entries:[entry],textures:[entry],sounds:[],json:[],total:1};
    const status = (text: string) => { root.querySelector('[data-value="probe-status"]')!.textContent = text; control<HTMLButtonElement>("probe-load").disabled = pending || loaded; control<HTMLButtonElement>("probe-release").disabled = !loaded; };
    const release = () => { generation++; request?.abort(); request = undefined; pending = false; assets.releaseAssets(payload); loaded = false; status("검사용 텍스처 없음"); };
    const apply = () => {
      const scene = structuredClone(source), instances = [...scene.sceneComposition.fragments!.lab!.instances!];
      scene.sceneComposition.fragments!.lab!.instances = instances;
      const robot = instances[0]!, count = Number(control("object-count").value);
      for (let i = 2; i < count; i++) instances.push({...structuredClone(robot), id:`copy-${i}`, x:64 + (i % 16) * 32, y:48 + Math.floor(i / 16) * 36,
        props:{components:{visual:{kind:"sprite",texture:"robot",width:24,height:30,frame:{u0:0,v0:0,u1:.25,v1:1}},collider:"none",layer:"player"}}});
      ctx.reapply(scene);
    };
    on("object-count", "change", apply);
    on("probe-load", "click", () => {
      if (loaded || pending) return;
      const token = ++generation; request = new AbortController(); pending = true; status("준비 중…");
      void assets.loadAssets({textures:{"resource-probe":url}}, undefined, {signal:request.signal}).then(() => {
        if (destroyed || token !== generation) return;
        pending = false; loaded = true; status("검사용 텍스처 준비됨 · 해제하여 자원 수를 비교하세요.");
      }).catch(error => { if (!destroyed && token === generation) { pending = false; status(`준비 실패: ${String(error)}`); } });
    });
    on("probe-release", "click", release);
    extra.reset = () => { release(); apply(); };
    extra.observation = () => { const s = renderer.stats(), r = renderer.resourceStats?.(); return `명령 ${s.renderCommandCount} · 드로우 ${s.drawCalls} · 텍스처 ${r?.textureCount ?? "미지원"}개 · 추정 ${r?.textureBytes === undefined ? "미지원" : (r.textureBytes / 1024).toFixed(1) + " KiB"}`; };
    extra.snapshot = () => ({ rendering: { count:Number(control("object-count").value), loaded, pending, stats:{...renderer.stats()}, resources:renderer.resourceStats?.() } });
    extra.destroy = () => { destroyed = true; release(); };
  }
  return extra;
}
