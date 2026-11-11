import type { FerrumRuntimeFrame } from "@ferrum2d/ferrum-web/core";
import type { ScenePlacementViewer, ScenePlacementViewerState } from "@ferrum2d/ferrum-web/authoring";
import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";

export interface SunGizmoPose {
  azimuth: number;
  elevation: number;
  length: number;
  horizontalLength: number;
  spatial: boolean;
  enabled: boolean;
}
export type SunGizmoAxis = "azimuth" | "elevation" | "both";
type Vector = readonly [number, number, number];

/** Direction-only authoring widget. Its screen position is never saved as a light position. */
export function createPlacementSunGizmo(options: {
  canvas: HTMLCanvasElement; stage: HTMLElement; viewer: ScenePlacementViewer;
  key(): string; enabled(): boolean; busy(): boolean; hasObjectSelection(): boolean;
  read(): SunGizmoPose | undefined;
  write(base: SunGizmoPose, azimuth: number, elevation: number, axis: SunGizmoAxis, gesture: boolean): boolean;
  select(inspect: boolean): void; finishEdit(): void; onChange(state: ScenePlacementViewerState): unknown;
}) {
  const root = document.createElement("div"), caption = document.createElement("span"), readout = document.createElement("output");
  root.className = "placement-sun-gizmo"; root.hidden = true;
  root.dataset.placementSunGizmo = "true";
  setUiText(caption, "Sunlight · Direction Only"); caption.className = "placement-sun-gizmo-caption";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const ns = "http://www.w3.org/2000/svg";
  const rays = document.createElementNS(ns, "path"); rays.classList.add("placement-sun-rays"); rays.setAttribute("aria-hidden", "true"); svg.append(rays);
  const rayHit = document.createElementNS(ns, "path"), rayTitle = document.createElementNS(ns, "title");
  rayHit.classList.add("placement-sun-ring-hit"); rayHit.dataset.placementSunRayHit = "true"; rayHit.setAttribute("aria-hidden", "true");
  setUiText(rayTitle, "Drag to rotate sunlight · Shift: snap"); rayHit.append(rayTitle); svg.append(rayHit);
  rayHit.addEventListener("pointerdown", event => start(event, controls.get("both")!, "both"));
  const controls = new Map<SunGizmoAxis, SVGGElement>();
  const rings = new Map<SunGizmoAxis, { line: SVGPathElement; hit: SVGPathElement; arrow: SVGPathElement; arrowHit: SVGPathElement }>();
  for (const [axis, text] of [["azimuth", "Sun Azimuth"], ["elevation", "Sun Elevation"], ["both", "Rotate Sunlight"]] as const) {
    const control = document.createElementNS(ns, "g"), title = document.createElementNS(ns, "title");
    control.dataset.placementSunHandle = axis; control.setAttribute("tabindex", "0"); control.setAttribute("role", axis === "both" ? "button" : "slider");
    setUiAttribute(control, "aria-label", text);
    setUiText(title, axis === "both" ? "Drag to rotate sunlight · Shift: snap" : axis === "azimuth" ? "Drag azimuth arrow · Shift: snap" : "Drag elevation arrow · Shift: snap");
    control.append(title);
    if (axis === "both") {
      // A sun disc and rays, with a circular hit target. No rectangular toolbar chrome.
      const disc = document.createElementNS(ns, "circle"), spokes = document.createElementNS(ns, "path"), hit = document.createElementNS(ns, "circle");
      disc.setAttribute("r", "6"); spokes.setAttribute("d", Array.from({ length: 8 }, (_, i) => {
        const a = i * Math.PI / 4; return `M${Math.cos(a) * 9},${Math.sin(a) * 9}L${Math.cos(a) * 13},${Math.sin(a) * 13}`;
      }).join(" "));
      hit.setAttribute("r", "17"); hit.classList.add("placement-sun-disc-hit");
      control.append(disc, spokes, hit);
    } else {
      const line = document.createElementNS(ns, "path"), hit = document.createElementNS(ns, "path"), arrow = document.createElementNS(ns, "path"), arrowHit = document.createElementNS(ns, "path");
      line.classList.add("placement-sun-orbit"); arrow.classList.add("placement-sun-orbit-arrow");
      hit.classList.add("placement-sun-ring-hit"); arrowHit.classList.add("placement-sun-ring-hit");
      hit.dataset.placementSunRing = axis; arrow.dataset.placementSunArrow = axis; arrowHit.dataset.placementSunArrowHit = axis;
      control.append(line, arrow, hit, arrowHit); rings.set(axis, { line, hit, arrow, arrowHit });
      control.setAttribute("aria-orientation", axis === "azimuth" ? "horizontal" : "vertical");
    }
    controls.set(axis, control); svg.append(control);
    control.addEventListener("pointerdown", event => start(event, control, axis));
    control.addEventListener("pointermove", move);
    control.addEventListener("pointerup", event => { if (drag?.pointer === event.pointerId) { event.stopPropagation(); finish(false); } });
    control.addEventListener("pointercancel", () => finish(true));
    control.addEventListener("lostpointercapture", () => finish(true));
    control.addEventListener("keydown", event => {
      if ((event.code === "Enter" || event.code === "Space") && axis === "both") {
        event.preventDefault(); event.stopPropagation();
        if (!options.busy() && options.enabled()) { choose(); control.focus({ preventScroll: true }); }
        return;
      }
      if (!event.code.startsWith("Arrow") || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code)) return;
      event.preventDefault(); event.stopPropagation();
      if (options.busy() || !options.enabled()) return;
      const pose = options.read(); if (!pose) return;
      const horizontal = event.code === "ArrowLeft" || event.code === "ArrowRight";
      if ((axis === "azimuth" && !horizontal) || (axis === "elevation" && horizontal)) return;
      const delta = (event.code === "ArrowLeft" || event.code === "ArrowDown" ? -1 : 1) * (event.shiftKey ? 15 : 1);
      const yaw = wrap(pose.azimuth + (horizontal ? delta : 0)), pitch = clamp(pose.elevation + (horizontal ? 0 : delta), pose.spatial);
      if ((horizontal && pose.spatial && pose.horizontalLength < 1e-12) || (Math.abs(wrap(yaw - pose.azimuth)) < 1e-10 && Math.abs(pitch - pose.elevation) < 1e-10)) return;
      choose();
      control.focus({ preventScroll: true });
      options.write(pose, yaw, pitch, horizontal ? "azimuth" : "elevation", false);
    });
    control.addEventListener("click", event => { event.stopPropagation(); if (!disabled(axis) && options.enabled()) choose(); });
  }
  readout.dataset.placementSunGizmoReadout = "true";
  const hint = document.createElement("p"); setUiText(hint, "Drag arrows · Shift: 15°");
  root.prepend(caption, svg); root.append(readout, hint); options.stage.append(root);
  let pose = options.read(), selected = false, signature = "", key = options.key();
  let basis: { right: Vector; up: Vector } = { right: [1, 0, 0], up: [0, -1, 0] };
  let center = { x: 92, y: 92 };
  type Drag = { pointer: number; control: SVGGElement; axis: SunGizmoAxis; key: string; base: SunGizmoPose;
    start: { x: number; y: number }; basis: typeof basis; center: typeof center; active: boolean; angle?: number; rotation: number };
  let drag: Drag | undefined;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
  const clamp = (value: number, spatial: boolean) => Math.max(spatial ? -90 : 0, Math.min(90, value));
  const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const direction = (yaw: number, pitch: number): Vector => [Math.cos(radians(yaw)) * Math.cos(radians(pitch)), Math.sin(radians(yaw)) * Math.cos(radians(pitch)), Math.sin(radians(pitch))];
  const horizontalDirection = (yaw: number): Vector => [Math.cos(radians(yaw)), Math.sin(radians(yaw)), 0];
  function choose() { const inspect = !selected; selected = true; options.select(inspect); signature = ""; }
  function finish(cancel: boolean) {
    const previous = drag; if (!previous) return;
    drag = undefined;
    if (previous.control.hasPointerCapture(previous.pointer)) previous.control.releasePointerCapture(previous.pointer);
    if (previous.active && previous.key === options.key()) options.onChange(cancel ? options.viewer.cancelEdit() : options.viewer.commitEdit());
    signature = "";
  }
  function planeAngle(point: { x: number; y: number }, d: Drag) {
    const a: Vector = d.axis === "azimuth" ? [1, 0, 0] : horizontalDirection(d.base.azimuth);
    const b: Vector = d.axis === "azimuth" ? [0, 1, 0] : [0, 0, 1];
    const ax = dot(d.basis.right, a), ay = -dot(d.basis.up, a), bx = dot(d.basis.right, b), by = -dot(d.basis.up, b);
    const determinant = ax * by - bx * ay;
    if (Math.abs(determinant) < .05) return;
    const x = point.x - d.center.x, y = point.y - d.center.y;
    return Math.atan2((ax * y - ay * x) / determinant, (x * by - y * bx) / determinant) * 180 / Math.PI;
  }
  function disabled(axis: SunGizmoAxis) {
    return (options.busy() && !drag) || (axis === "azimuth" && !!pose?.spatial && pose.horizontalLength < 1e-12);
  }
  function start(event: PointerEvent, control: SVGGElement, axis: SunGizmoAxis) {
    if (event.button !== 0 || drag || disabled(axis) || options.busy() || !options.enabled()) return;
    const base = options.read(); if (!base) return;
    event.preventDefault(); event.stopPropagation(); choose();
    control.focus({ preventScroll: true });
    const bounds = root.getBoundingClientRect();
    drag = { pointer: event.pointerId, control, axis, key: options.key(), base, start: { x: event.clientX, y: event.clientY },
      basis, center: { x: bounds.left + center.x, y: bounds.top + center.y }, active: false, rotation: 0 };
    drag.angle = planeAngle(drag.start, drag);
    control.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const d = drag; if (!d || d.pointer !== event.pointerId || d.key !== options.key()) return;
    event.preventDefault(); event.stopPropagation();
    const dx = event.clientX - d.start.x, dy = event.clientY - d.start.y;
    if (!d.active && Math.hypot(dx, dy) < 3) return;
    let yaw = d.base.azimuth, pitch = d.base.elevation;
    const angle = planeAngle({ x: event.clientX, y: event.clientY }, d);
    // Unwrap consecutive samples, so bounded elevation never flips at a half turn.
    let delta: number | undefined;
    if (angle !== undefined && d.angle !== undefined) {
      d.rotation += wrap(angle - d.angle); d.angle = angle; delta = d.rotation;
    }
    if (d.axis !== "elevation") yaw += d.axis === "azimuth" && delta !== undefined ? delta : dx * .5;
    if (d.axis !== "azimuth") pitch += d.axis === "elevation" && delta !== undefined ? delta : -dy * .5;
    if (event.shiftKey) { if (d.axis !== "elevation") yaw = Math.round(yaw / 15) * 15; if (d.axis !== "azimuth") pitch = Math.round(pitch / 15) * 15; }
    yaw = wrap(yaw); pitch = clamp(pitch, d.base.spatial);
    if (d.base.spatial && d.base.horizontalLength < 1e-12 && Math.abs(pitch - d.base.elevation) < 1e-10) yaw = d.base.azimuth;
    // Restore the exact draft (including omitted defaults) at the starting pose.
    // Keep pointer capture so this same drag can leave the origin again.
    if (Math.abs(wrap(yaw - d.base.azimuth)) < 1e-10 && Math.abs(pitch - d.base.elevation) < 1e-10) {
      if (d.active) {
        try { const restored = options.viewer.cancelEdit(); d.active = false; options.onChange(restored); }
        catch (error) { finish(true); window.dispatchEvent(new CustomEvent("ferrum-placement-document-error", { detail: error })); }
        signature = "";
      }
      return;
    }
    if (pose && Math.abs(wrap(yaw - pose.azimuth)) < 1e-10 && Math.abs(pitch - pose.elevation) < 1e-10) return;
    if (!d.active) { options.finishEdit(); options.viewer.beginEdit("Sunlight Rotation"); d.active = true; }
    try { if (!options.write(d.base, yaw, pitch, d.axis, true)) finish(true); }
    catch (error) { finish(true); window.dispatchEvent(new CustomEvent("ferrum-placement-document-error", { detail: error })); }
  }
  options.canvas.addEventListener("pointerdown", () => { if (!drag) { selected = false; signature = ""; } });
  window.addEventListener("keydown", event => { if (event.code === "Escape" && (drag || (selected && root.contains(document.activeElement)))) {
    event.preventDefault(); event.stopImmediatePropagation(); finish(true); selected = false; signature = "";
  } }, { capture: true });
  window.addEventListener("blur", () => finish(true));
  const normalize = (v: Vector): Vector => { const length = Math.hypot(...v) || 1; return [v[0] / length, v[1] / length, v[2] / length]; };
  return {
    sync() { pose = options.read(); if (!pose) { finish(true); selected = false; } signature = ""; },
    deselect() { selected = false; signature = ""; },
    cancel() { finish(true); }, ownsGesture: () => drag !== undefined,
    frame(update: FerrumRuntimeFrame) {
      if (key !== options.key()) { finish(true); selected = false; key = options.key(); }
      if (options.hasObjectSelection() && !drag) selected = false;
      root.hidden = !pose || !options.enabled();
      if (root.hidden) { finish(true); return; }
      const rect = options.canvas.getBoundingClientRect(), stage = options.stage.getBoundingClientRect(), m = update.frame.renderCommandBuffer.spatial?.camera;
      if (rect.width < 208 || rect.height < 208) { root.hidden = true; finish(true); return; }
      // Own six direction coefficients, never a borrowed Wasm camera view.
      basis = m && pose!.spatial ? { right: normalize([m[0], -m[8], m[4]]), up: normalize([m[1], -m[9], m[5]]) }
        : { right: [1, 0, 0], up: [0, -1, 0] };
      const width = Math.min(184, Math.max(96, rect.width - 16));
      const left = Math.max(8, rect.right - stage.left - width - 8), top = rect.top - stage.top + 36;
      const compact = rect.height < 272;
      const next = [width, left, top, compact, ...basis.right, ...basis.up, pose!.azimuth, pose!.elevation, pose!.enabled, selected, options.busy(), !!drag].join();
      if (next === signature) return; signature = next;
      root.style.width = `${width}px`; root.style.left = `${left}px`; root.style.top = `${top}px`;
      root.dataset.selected = String(selected); root.dataset.lightingEnabled = String(pose!.enabled); root.dataset.compact = String(compact);
      center = { x: width / 2, y: compact ? 78 : 94 };
      const radius = Math.min(compact ? 40 : 58, width / 2 - 22);
      const project = (v: Vector, size = radius) => ({ x: center.x + dot(basis.right, v) * size, y: center.y - dot(basis.up, v) * size });
      const path = (values: Vector[]) => values.map((value, index) => { const p = project(value); return `${index ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(" ");
      const yawPath = path(Array.from({ length: 49 }, (_, i) => horizontalDirection(i * 7.5)));
      const pitchPath = path(Array.from({ length: 37 }, (_, i) => direction(pose!.azimuth, i * 5 - 90)));
      const sunDirection = direction(pose!.azimuth, pose!.elevation), end = project(sunDirection);
      const arrowHead = (sample: (angle: number) => Vector, angle: number, vertical = false) => {
        for (const offset of [0, 25, -25, 60, -60]) {
          const value = vertical ? Math.max(-90, Math.min(90, angle + offset)) : angle + offset;
          const tip = project(sample(value)), before = project(sample(value + (vertical && value <= -80 ? 10 : -10)));
          const dx = tip.x - before.x, dy = tip.y - before.y, length = Math.hypot(dx, dy);
          if (length < 1) continue;
          const x = dx / length, y = dy / length;
          return `M${tip.x - x * 9 - y * 4.5},${tip.y - y * 9 + x * 4.5}L${tip.x},${tip.y}L${tip.x - x * 9 + y * 4.5},${tip.y - y * 9 - x * 4.5}`;
        }
        return "";
      };
      const yawArrows = [65, 245].map(offset => arrowHead(horizontalDirection, pose!.azimuth + offset)).join(" ");
      // Keep the elevation arrow away from the sun disc, including near-vertical
      // sunlight and a top-down view where the elevation arc projects to a line.
      const pitchCandidates = [-90, -60, -30, 0, 30, 60, 90];
      const distanceFromSun = (angle: number) => { const p = project(direction(pose!.azimuth, angle)); return Math.hypot(p.x - end.x, p.y - end.y); };
      const pitchArrowAngle = pitchCandidates.reduce((best, angle) => distanceFromSun(angle) > distanceFromSun(best) ? angle : best);
      const pitchArrows = arrowHead(angle => direction(pose!.azimuth, angle), pitchArrowAngle, true);
      for (const [axis, wire, arrows] of [["azimuth", yawPath, yawArrows], ["elevation", pitchPath, pitchArrows]] as const) {
        const geometry = rings.get(axis)!;
        geometry.line.setAttribute("d", wire); geometry.hit.setAttribute("d", wire);
        geometry.arrow.setAttribute("d", arrows); geometry.arrowHit.setAttribute("d", arrows);
      }
      const tangent = horizontalDirection(pose!.azimuth + 90);
      // Parallel rays express a directional light; there is no point-light radius.
      const rayPath = [-.18, 0, .18].map(offset => {
        const ray = (scale: number): Vector => [sunDirection[0] * scale + tangent[0] * offset, sunDirection[1] * scale + tangent[1] * offset, sunDirection[2] * scale];
        const a = project(ray(.82)), b = project(ray(-.55));
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
        return `M${a.x},${a.y}L${b.x},${b.y}m${-dx / length * 5 - dy / length * 3},${-dy / length * 5 + dx / length * 3}L${b.x},${b.y}l${-dx / length * 5 + dy / length * 3},${-dy / length * 5 - dx / length * 3}`;
      }).join(" ");
      rays.setAttribute("d", rayPath); rayHit.setAttribute("d", rayPath);
      rays.dataset.active = String(drag?.active === true && drag.axis === "both");
      rayHit.dataset.disabled = String(disabled("both"));
      controls.get("both")!.setAttribute("transform", `translate(${end.x},${end.y})`);
      for (const [axis, control] of controls) {
        const blocked = disabled(axis);
        control.setAttribute("aria-disabled", String(blocked)); control.setAttribute("tabindex", blocked ? "-1" : "0");
        control.dataset.active = String(drag?.active === true && drag.axis === axis);
        if (axis === "both") control.setAttribute("aria-pressed", String(selected));
        else {
          control.setAttribute("aria-valuemin", String(axis === "azimuth" ? -180 : pose!.spatial ? -90 : 0));
          control.setAttribute("aria-valuemax", axis === "azimuth" ? "180" : "90");
          control.setAttribute("aria-valuenow", String(Number((axis === "azimuth" ? pose!.azimuth : pose!.elevation).toFixed(1))));
        }
      }
      const azimuth = Number(pose!.azimuth.toFixed(1)), elevation = Number(pose!.elevation.toFixed(1));
      setUiText(readout, uiMessage("Az {0}° · El {1}°", azimuth, elevation));
      setUiAttribute(readout, "aria-label", uiMessage("Azimuth {0}° · Elevation {1}°", azimuth, elevation));
    },
  };
}
