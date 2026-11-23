import "./guidedGameSurface.css";

/** Visual legend and input devices for the two native controller/collision demos. */
export function createGuidedGameSurface<T extends { destroy(): void }>(
  stage: HTMLElement,
  kind: "breakout" | "platformer",
  createControls: (parent: HTMLElement, buttons: readonly { id: string; label: string; controls: readonly ("a" | "d" | "space")[] }[]) => T,
) {
  const legend = document.createElement("div");
  legend.className = "guided-legend";
  legend.setAttribute("aria-label", "화면 색상 안내");
  const entries = kind === "platformer"
    ? [["#f04357", "플레이어"], ["#587cac", "고정 발판"], ["#ddbc41", "단방향 발판"], ["#35c9d1", "이동 발판"]]
    : [["#36d778", "패들"], ["#ffffcf", "공"], ["#fa5a50", "벽돌"]];
  for (const [color, label] of entries) {
    const item = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.style.background = color;
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(label));
    legend.append(item);
  }
  const pad = document.createElement("div");
  pad.className = "guided-touch-pad";
  pad.setAttribute("aria-label", "터치 게임 조작");
  const controls = createControls(pad, [
      { id: "left", label: "← 왼쪽", controls: ["a"] },
      { id: "right", label: "오른쪽 →", controls: ["d"] },
      ...(kind === "platformer" ? [{ id: "jump", label: "점프", controls: ["space" as const] }] : []),
  ]);
  // The keys are in the page's "해 보기"; the stage keeps the color legend and the touch pad.
  stage.append(legend, pad);
  const lifetime = new AbortController();
  const destroy = () => { lifetime.abort(); controls.destroy(); legend.remove(); pad.remove(); };
  window.addEventListener("pagehide", event => { if (!event.persisted) destroy(); }, { signal: lifetime.signal });
  return { controls, destroy };
}
