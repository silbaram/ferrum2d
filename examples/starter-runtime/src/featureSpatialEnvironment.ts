import type { SpatialEnvironmentSpec } from "@ferrum2d/ferrum-web/core";

export const environmentControls = `<label>광원 종류<select data-control="light-mode"><option value="point">점광원 · 위치</option><option value="sun">태양광 · 방향</option><option value="mixed">점광원 + 태양광</option></select></label>
  <label class="feature-check"><input data-control="environment-lighting" type="checkbox" checked> 조명 적용</label>
  <label>점광원 좌우 <output data-value="light-x">−90</output><input data-control="light-x" type="range" min="-100" max="100" step="10" value="-90"></label>
  <label>태양 방위 <output data-value="sun-azimuth">−45°</output><input data-control="sun-azimuth" type="range" min="-180" max="180" value="-45" step="15"></label>
  <label>태양 고도 <output data-value="sun-elevation">35°</output><input data-control="sun-elevation" type="range" min="10" max="80" value="35" step="5"></label>
  <label class="feature-check"><input data-control="environment-shadows" type="checkbox" checked> 그림자</label>
  <label>그림자 필터<select data-control="shadow-filter"><option value="hard">선명하게</option><option value="pcf3">PCF · 부드럽게</option></select></label>
  <label class="feature-check"><input data-control="environment-fog" type="checkbox"> 거리 안개</label>
  <label>공간 화면 효과<select data-control="environment-effect"><option value="clean">원본</option><option value="bloom">Bloom · 밝은 부분 번짐</option><option value="ao">AO · 접촉 음영</option><option value="dof">DOF · 초점 밖 흐림</option><option value="aces">ACES · 밝기 압축</option></select></label>
  <p>같은 장면에서 광원 종류·방향 또는 화면 효과 하나만 바꾸어 비교하세요. 마름모는 점광원의 위치입니다.</p>`;

export function spatialEnvironmentSettings(root: HTMLElement) {
  const input = (key: string) => root.querySelector<HTMLInputElement>(`[data-control="${key}"]`)!;
  const lightX = Number(input("light-x").value), lighting = input("environment-lighting").checked;
  const shadows = input("environment-shadows").checked, fog = input("environment-fog").checked;
  const mode = input("light-mode").value, effect = input("environment-effect").value;
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
    ...(effect === "bloom" ? { bloom: { strength: 1.2, radius: 8, threshold: .5 } } : {}),
    ...(effect === "ao" ? { ambientOcclusion: { strength: .9, radius: 20, bias: .2 } } : {}),
    ...(effect === "dof" ? { depthOfField: { focusDistance: 510, focusRange: 20, aperture: 5, maxBlurRadius: 8 } } : {}),
    ...(effect === "aces" ? { colorGrading: { exposure: 1, toneMapping: "aces" } } : {}),
  };
  return { lightX, lighting, shadows, fog, mode, effect, azimuth, elevation, environment };
}
