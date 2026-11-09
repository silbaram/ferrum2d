import type { SpatialEnvironmentSpec } from "@ferrum2d/ferrum-web/core";
import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";

export const environmentEffects = ["bloom", "ao", "dof", "aces"] as const;

export const environmentControls = `<label>광원 종류<select data-control="light-mode"><option value="point">점광원 · 위치</option><option value="sun">태양광 · 방향</option><option value="mixed">점광원 + 태양광</option></select></label>
  <label class="feature-check"><input data-control="environment-lighting" type="checkbox" checked> 조명 적용</label>
  <label>점광원 좌우 <output data-value="light-x">−90</output><input data-control="light-x" type="range" min="-100" max="100" step="10" value="-90"></label>
  <label>태양 방위 <output data-value="sun-azimuth">−45°</output><input data-control="sun-azimuth" type="range" min="-180" max="180" value="-45" step="15"></label>
  <label>태양 고도 <output data-value="sun-elevation">35°</output><input data-control="sun-elevation" type="range" min="10" max="80" value="35" step="5"></label>
  <label class="feature-check"><input data-control="environment-shadows" type="checkbox" checked> 그림자</label>
  <label>그림자 필터<select data-control="shadow-filter"><option value="hard">선명하게</option><option value="pcf3">PCF · 부드럽게</option></select></label>
  <label class="feature-check"><input data-control="environment-fog" type="checkbox"> 거리 안개</label>
  <fieldset class="feature-effect-combination"><legend>화면 효과 · 함께 켜서 비교</legend>
    <label class="feature-check"><input data-control="environment-bloom" type="checkbox"> Bloom · 밝은 부분 번짐</label>
    <label class="feature-check"><input data-control="environment-ao" type="checkbox"> AO · 접촉 음영</label>
    <label class="feature-check"><input data-control="environment-dof" type="checkbox"> DOF · 초점 밖 흐림</label>
    <label class="feature-check"><input data-control="environment-aces" type="checkbox"> ACES · 밝기 압축</label>
  </fieldset>
  <details><summary>그림자 품질 재현 · 카메라</summary>
    <label>카메라 회전 <output data-value="camera-angle">0°</output><input data-control="camera-angle" type="range" min="-180" max="180" step="15" value="0"></label>
    <label>카메라 이동 X <output data-value="camera-pan">0</output><input data-control="camera-pan" type="range" min="-48" max="48" step="8" value="0"></label>
    <p>태양을 고정한 채 시점을 바꿉니다. 방위는 월드 XY 기준이며 0° = +X, 90° = +Y입니다.</p>
  </details>
  <p>마름모는 점광원 위치, 주황 창은 스스로 빛나는 재질입니다. 발광은 주변 사물을 밝히는 광원과 별개입니다.</p>
  <p>기존 합성 기준: AO는 발광을 포함한 화면색을 어둡게 하고, Bloom은 AO·DOF 적용 전 영상을 사용합니다. 효과를 하나씩 끄며 차이를 비교하세요.</p>`;

export function spatialEnvironmentSettings(root: HTMLElement) {
  const input = (key: string) => root.querySelector<HTMLInputElement>(`[data-control="${key}"]`)!;
  const lightX = Number(input("light-x").value), lighting = input("environment-lighting").checked;
  const shadows = input("environment-shadows").checked, fog = input("environment-fog").checked;
  const mode = input("light-mode").value;
  const effects = environmentEffects.filter(effect => input(`environment-${effect}`).checked);
  const azimuth = Number(input("sun-azimuth").value), elevation = Number(input("sun-elevation").value);
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  const environment: SpatialEnvironmentSpec = {
    lighting: { enabled: lighting, ambient: [.18, .18, .2], shadowFilter: input("shadow-filter").value === "pcf3" ? "pcf3" : "hard",
      lights: mode === "sun" ? [] : [{ position: { x: lightX, y: -60, elevation: 100 }, radius: 420, color: [1, .85, .65], intensity: 2 }],
      ...(shadows && mode !== "sun" ? { shadows: { lightIndex: 0, resolution: 256, bias: .1 } } : {}),
      ...(mode !== "point" ? { directional: { direction: { x: Math.cos(a) * Math.cos(e), y: Math.sin(a) * Math.cos(e), elevation: Math.sin(e) },
        color: [1, .9, .7], intensity: 1.4, ...(shadows ? { shadows: { resolution: 256, distance: 500, extent: 260, bias: .1, normalBias: .05 } } : {}) } } : {}),
    },
    ...(fog ? { fog: { color: [.1, .17, .25], start: 430, end: 690 } } : {}),
    ...(effects.includes("bloom") ? { bloom: { strength: 1.2, radius: 8, threshold: .5 } } : {}),
    ...(effects.includes("ao") ? { ambientOcclusion: { strength: .9, radius: 20, bias: .2 } } : {}),
    ...(effects.includes("dof") ? { depthOfField: { focusDistance: 510, focusRange: 20, aperture: 5, maxBlurRadius: 8 } } : {}),
    ...(effects.includes("aces") ? { colorGrading: { exposure: 1, toneMapping: "aces" } } : {}),
  };
  return { lightX, lighting, shadows, fog, mode, effects, effect: effects.join(" + ") || "clean", azimuth, elevation, environment };
}

/** Camera controls are cold scene-authoring settings; the native core builds the matrices. */
export function spatialEnvironmentCamera(root: HTMLElement, base: NonNullable<SceneAuthoringDocumentSpec["spatial"]>["camera"], size: { width: number; height: number }) {
  const angle = Number(root.querySelector<HTMLInputElement>('[data-control="camera-angle"]')!.value) * Math.PI / 180;
  const pan = Number(root.querySelector<HTMLInputElement>('[data-control="camera-pan"]')!.value);
  const dx = base.position.x - base.target.x, dy = base.position.y - base.target.y;
  const target = { ...base.target, x: base.target.x + pan };
  return { ...base, target, position: { ...base.position,
    x: target.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: target.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  }, height: Math.max(250, 360 * size.height / Math.max(1, size.width)) };
}
