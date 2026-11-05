import type { SpatialEnvironmentSpec } from "@ferrum2d/ferrum-web/core";

export const environmentControls = `<label class="feature-check"><input data-control="environment-lighting" type="checkbox" checked> 조명 적용</label>
  <label>광원 좌우 위치 <output data-value="light-x">−90</output><input data-control="light-x" type="range" min="-100" max="100" step="10" value="-90"></label>
  <label class="feature-check"><input data-control="environment-shadows" type="checkbox" checked> 그림자</label>
  <label class="feature-check"><input data-control="environment-fog" type="checkbox"> 거리 안개</label>
  <p>마름모 표식은 높이 100의 광원입니다. 회색 기둥의 뒤쪽 그림자와 멀리 있는 지형의 색을 비교하세요.</p>`;

export function spatialEnvironmentSettings(root: HTMLElement) {
  const input = (key: string) => root.querySelector<HTMLInputElement>(`[data-control="${key}"]`)!;
  const lightX = Number(input("light-x").value), lighting = input("environment-lighting").checked;
  const shadows = input("environment-shadows").checked, fog = input("environment-fog").checked;
  const environment: SpatialEnvironmentSpec = {
    lighting: { enabled: lighting, ambient: [.18, .18, .2],
      lights: [{ position: { x: lightX, y: -60, elevation: 100 }, radius: 420, color: [1, .85, .65], intensity: 2 }],
      ...(shadows ? { shadows: { lightIndex: 0, resolution: 256, bias: .1 } } : {}) },
    ...(fog ? { fog: { color: [.1, .17, .25], start: 430, end: 690 } } : {}),
  };
  return { lightX, lighting, shadows, fog, environment };
}
