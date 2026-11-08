import type { SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";
import { decodeRenderCommands } from "@ferrum2d/ferrum-web/core";
import type { FeatureContext, FeatureExtra } from "./featureExtras";
import "./featureNineSlice.css";

export const nineSliceControls = `<label>게임에서 쓰는 곳<select data-control="panel-example"><option value="dialogue">대화창</option><option value="inventory">가방</option></select></label>
  <label>너비 <output data-value="panel-width">256 px</output><input data-control="panel-width" type="range" min="192" max="280" step="8" value="256"></label>
  <label>높이 <output data-value="panel-height">144 px</output><input data-control="panel-height" type="range" min="144" max="224" step="8" value="144"></label>
  <label class="feature-check"><input data-control="sliced" type="checkbox" checked> 비교 창에 9-slice 적용</label>
  <label>테두리 배율 <output data-value="border">2× · 8 px</output><input data-control="border" type="range" min="1" max="4" value="2"></label>
  <label class="feature-check"><input data-control="slice-guides" type="checkbox" checked> 원본의 9개 영역 보기</label>`;

/** Native sprites form the frames. DOM content only annotates their game UI use. */
export function createNineSliceFeature(ctx: FeatureContext): FeatureExtra {
  const { root, canvas, signal } = ctx;
  root.dataset.nineSliceDemo = "true";
  const source = ctx.source as SceneAuthoringDocumentSpec;
  const control = (name: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-control="${name}"]`)!;
  const number = (name: string) => Number(control(name).value);
  const checked = (name: string) => (control(name) as HTMLInputElement).checked;
  const output = (name: string, text: string) => { root.querySelector(`[data-value="${name}"]`)!.textContent = text; };
  const compact = matchMedia("(max-width: 600px)");
  const viewport = () => ({ width: compact.matches ? 320 : 640, height: compact.matches ? 720 : 432 });
  const centers = () => compact.matches ? [{ x: 160, y: 176 }, { x: 160, y: 456 }] : [{ x: 160, y: 176 }, { x: 480, y: 176 }];
  const original = () => compact.matches ? { x: 160, y: 640 } : { x: 320, y: 352 };
  const overlay = document.createElement("div");
  overlay.className = "nine-slice-overlay";
  overlay.innerHTML = `<section class="nine-slice-label" data-comparison-label="plain"><h3>일반 확대</h3><p>모서리까지 함께 늘어납니다</p></section>
    <section class="nine-slice-label" data-comparison-label="sliced"><h3>9-slice 적용</h3><p>창이 커져도 테두리는 그대로</p></section>
    <section class="nine-slice-content" data-panel-content="plain" aria-label="일반 확대 게임 UI"></section>
    <section class="nine-slice-content" data-panel-content="sliced" aria-label="9-slice 게임 UI"></section>
    <div class="nine-slice-source-grid" aria-hidden="true">${"<i></i>".repeat(9)}</div>
    <p class="nine-slice-source-caption">원본 이미지 24 × 24 · 3배 보기<br><span>모서리 4곳은 고정 · 변과 가운데는 늘리기</span></p>`;
  canvas.after(overlay);
  const labels = [...overlay.querySelectorAll<HTMLElement>("[data-comparison-label]")];
  const contents = [...overlay.querySelectorAll<HTMLElement>("[data-panel-content]")];
  const grid = overlay.querySelector<HTMLElement>(".nine-slice-source-grid")!;
  const caption = overlay.querySelector<HTMLElement>(".nine-slice-source-caption")!;
  let dirty = true;
  let contentMode = "";
  let nativeCorner: { width: number; height: number } | undefined;
  const setContent = () => {
    const mode = control("panel-example").value;
    if (mode === contentMode) return;
    contentMode = mode;
    for (const content of contents) {
      content.dataset.kind = mode;
      content.innerHTML = mode === "dialogue"
        ? `<strong>마을의 안내인</strong><p>강을 건너면<br>작은 여관이 있어요.</p><small>계속하기 ▸</small>`
        : `<strong>여행 가방</strong><div class="nine-slice-items">${["물약", "열쇠", "지도", "보석", "동전", "나침반"].map(item => `<span>${item}</span>`).join("")}</div><small>아이템 6개</small>`;
    }
  };
  const apply = () => {
    const width = number("panel-width"), height = number("panel-height"), border = number("border");
    const positions = centers(), preview = original();
    const instances = ["stretched", "sliced", "source"].map((id, index) => ({
      id, prefab: "object", ...(index === 2 ? preview : positions[index]),
      props: { components: { visual: { kind: "sprite", texture: "panel", width: index === 2 ? 72 : width, height: index === 2 ? 72 : height,
        ...(index === 1 && checked("sliced") ? { nineSlice: { sourceWidth: 24, sourceHeight: 24, left: 4, right: 4, top: 4, bottom: 4, borderScale: border } } : {}) }, collider: "none", layer: "wall" } },
    }));
    ctx.reapply({ ...source, sceneComposition: { ...source.sceneComposition, fragments: {
      ...source.sceneComposition.fragments, lab: { ...source.sceneComposition.fragments?.lab, instances },
    } } });
    output("panel-width", `${width} px`); output("panel-height", `${height} px`); output("border", `${border}× · ${border * 4} px`);
    labels[1].querySelector("h3")!.textContent = checked("sliced") ? "9-slice 적용" : "9-slice 끔";
    labels[1].querySelector("p")!.textContent = checked("sliced") ? `테두리 ${border * 4} px 유지` : "일반 확대와 같은 결과";
    grid.hidden = !checked("slice-guides");
    setContent(); dirty = true;
  };
  const place = (element: HTMLElement, x: number, y: number, width: number, height?: number) => {
    const from = ctx.screenPoint({ x, y }), to = ctx.screenPoint({ x: x + width, y: y + (height ?? 0) });
    element.style.left = `${canvas.offsetLeft + from.x}px`; element.style.top = `${canvas.offsetTop + from.y}px`;
    element.style.width = `${to.x - from.x}px`;
    if (height !== undefined) element.style.height = `${to.y - from.y}px`;
  };
  const layout = () => {
    const width = number("panel-width"), height = number("panel-height"), positions = centers(), preview = original();
    const scale = Math.min(canvas.clientWidth / viewport().width, canvas.clientHeight / viewport().height);
    overlay.style.setProperty("--nine-slice-scale", String(scale));
    positions.forEach((point, index) => {
      place(labels[index], point.x - 144, point.y - 160, 288);
      place(contents[index], point.x - width / 2 + 24, point.y - height / 2 + 20, width - 48, height - 40);
    });
    place(grid, preview.x - 36, preview.y - 36, 72, 72);
    place(caption, preview.x - 152, preview.y + 44, 304);
  };
  const on = (name: string, event: string, callback: () => void) => control(name).addEventListener(event, callback, { signal });
  on("panel-example", "change", () => {
    const inventory = control("panel-example").value === "inventory";
    control("panel-width").value = inventory ? "224" : "256";
    control("panel-height").value = inventory ? "224" : "144";
    apply();
  });
  for (const name of ["panel-width", "panel-height", "border"]) on(name, "input", apply);
  on("sliced", "change", apply);
  on("slice-guides", "change", () => { grid.hidden = !checked("slice-guides"); });
  compact.addEventListener("change", apply, { signal });
  const resize = new ResizeObserver(() => { dirty = true; }); resize.observe(canvas);
  return {
    reset: apply,
    frame(frame) {
      if (!dirty) return;
      // Copy the native corner before projection queries can grow Wasm memory.
      const corner = decodeRenderCommands(frame.renderCommandBuffer).find(command => command.uv[0] === 0 && command.uv[1] === 0 && Math.abs(command.uv[2] - 1 / 6) < .0001 && Math.abs(command.uv[3] - 1 / 6) < .0001);
      nativeCorner = corner ? { width: corner.width, height: corner.height } : undefined;
      layout(); dirty = false;
    },
    observation: () => {
      const width = number("panel-width"), height = number("panel-height"), border = number("border") * 4;
      return `같은 원본 24 × 24 → ${width} × ${height}. 일반 확대의 테두리 ${Math.round(width / 6)} × ${Math.round(height / 6)} px · ${checked("sliced") ? `9-slice는 ${border} px 유지` : "9-slice를 꺼서 양쪽 모두 늘어납니다"}`;
    },
    snapshot: () => ({ nineSlice: { mode: control("panel-example").value, width: number("panel-width"), height: number("panel-height"), borderPixels: number("border") * 4, enabled: checked("sliced"), stacked: compact.matches, nativeCorner } }),
    camera: () => ({ x: viewport().width / 2, y: viewport().height / 2, smoothTimeSeconds: 0 }),
    viewport, pause() {},
    destroy() { resize.disconnect(); overlay.remove(); delete root.dataset.nineSliceDemo; },
  };
}
