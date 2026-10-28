import { resolveSpatialCameraSpec, type SpatialCameraSpec } from "@ferrum2d/ferrum-web/core";
import { setUiAttribute } from "./placementLocale";
import { orbitSpatialCamera, panSpatialCamera, zoomSpatialCamera } from "./placementSpatialCamera";

/** Transient authoring gestures. Native renders previews; release commits one spec patch. */
export function installGameCameraGestures(options: {
  canvas: HTMLCanvasElement;
  canStart(): boolean;
  beforeStart(): boolean;
  camera(): SpatialCameraSpec;
  viewHeight(): number;
  preview(camera?: SpatialCameraSpec): void;
  commit(camera: SpatialCameraSpec): boolean;
  changed(): void;
  report(error?: unknown): void;
}) {
  type Gesture = {
    kind: "orbit" | "pan" | "scrub" | "wheel";
    origin: SpatialCameraSpec;
    current?: SpatialCameraSpec;
    pointer?: { id: number; target: HTMLElement; button: number; x: number; y: number };
    viewHeight: number;
    motion?: { lastX: number; lastY: number; x: number; y: number };
    scrub?: { input: HTMLInputElement; value: number; build(): SpatialCameraSpec; step: number; exponential: boolean };
    cancelRequested?: boolean;
  };
  let gesture: Gesture | undefined, space = false, wheelTimer: ReturnType<typeof setTimeout> | undefined;
  const { canvas } = options;
  const speed = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => event.shiftKey ? 0.1 : event.ctrlKey || event.metaKey ? 10 : 1;
  function clear() {
    const previous = gesture;
    gesture = undefined;
    clearTimeout(wheelTimer); wheelTimer = undefined;
    canvas.dataset.gameCameraGesture = "";
    if (previous?.pointer?.target.hasPointerCapture(previous.pointer.id)) previous.pointer.target.releasePointerCapture(previous.pointer.id);
    options.changed();
  }
  function cancel(): boolean {
    if (!gesture) return true;
    clearTimeout(wheelTimer);
    try { options.preview(); clear(); return true; }
    catch (error) { gesture.cancelRequested = true; options.report(error); return false; }
  }
  function finish() {
    const previous = gesture;
    if (!previous) return;
    if (previous.cancelRequested) { cancel(); return; }
    clear();
    if (previous.current) options.commit(previous.current);
    else previous.scrub?.input.focus({ preventScroll: true });
  }
  function preview(camera: SpatialCameraSpec) {
    if (!gesture || gesture.cancelRequested) return;
    try {
      const resolved = resolveSpatialCameraSpec(camera);
      options.preview(resolved);
      gesture.current = resolved;
      options.changed(); options.report();
    } catch (error) { cancel(); options.report(error); }
  }
  function begin(event: PointerEvent, kind: "orbit" | "pan" | "scrub", scrub?: Gesture["scrub"]) {
    if (gesture?.kind === "wheel") finish();
    if (gesture || !options.canStart() || !options.beforeStart()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    gesture = { kind, origin: options.camera(), viewHeight: options.viewHeight(), scrub: scrub ? { ...scrub, value: scrub.input.valueAsNumber } : undefined,
      motion: { lastX: event.clientX, lastY: event.clientY, x: 0, y: 0 },
      pointer: { id: event.pointerId, target, button: event.button, x: event.clientX, y: event.clientY } };
    if (target === canvas) canvas.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    canvas.dataset.gameCameraGesture = kind;
    options.changed();
  }
  function move(event: PointerEvent) {
    const g = gesture, pointer = g?.pointer;
    if (!g || !pointer || event.pointerId !== pointer.id || g.cancelRequested) return;
    if (!(event.buttons & (pointer.button === 1 ? 4 : 1))) { cancel(); return; }
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 3 && !g.current) return;
    const factor = speed(event), motion = g.motion!;
    // Modifiers affect subsequent movement, without jumping back to the start.
    motion.x += (event.clientX - motion.lastX) * factor;
    motion.y += (event.clientY - motion.lastY) * factor;
    motion.lastX = event.clientX; motion.lastY = event.clientY;
    const dx = motion.x, dy = motion.y;
    if (g.kind === "scrub" && g.scrub) {
      const { input, value, build, step, exponential } = g.scrub;
      let next = exponential ? value * Math.exp(Math.max(-50, Math.min(50, dx * 0.005))) : value + dx * step;
      const name = input.dataset.placementGameCameraField;
      if (name === "pitch") next = Math.max(-89.9, Math.min(89.9, next));
      if (name === "fov") next = Math.max(1, Math.min(170, next));
      input.value = String(Number(next.toPrecision(12)));
      try { preview(build()); } catch (error) { cancel(); options.report(error); }
    } else {
      try { preview(g.kind === "pan" ? panSpatialCamera(g.origin, dx, dy, g.viewHeight) : orbitSpatialCamera(g.origin, dx, dy)); }
      catch (error) { cancel(); options.report(error); }
    }
  }
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 && event.button !== 1) return;
    begin(event, event.button === 1 || space ? "pan" : "orbit");
  });
  window.addEventListener("pointermove", event => {
    if (gesture?.pointer?.id !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation(); move(event);
  });
  window.addEventListener("pointerup", event => {
    if (gesture?.pointer?.id !== event.pointerId || gesture.pointer.button !== event.button) return;
    // pointerup clears buttons; sample its final coordinates before ending.
    const pointer = gesture.pointer;
    move(new PointerEvent("pointermove", { pointerId: event.pointerId, buttons: pointer.button === 1 ? 4 : 1,
      clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey }));
    finish();
  });
  window.addEventListener("pointercancel", event => { if (gesture?.pointer?.id === event.pointerId) cancel(); });
  function captureLost(event: PointerEvent) { if (gesture?.pointer?.id === event.pointerId) cancel(); }
  canvas.addEventListener("lostpointercapture", captureLost);
  canvas.addEventListener("wheel", event => {
    if (!options.canStart()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (gesture && gesture.kind !== "wheel") return;
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0 || (!gesture && !options.beforeStart())) return;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? options.viewHeight() : 1;
    gesture ??= { kind: "wheel", origin: options.camera(), viewHeight: options.viewHeight() };
    preview(zoomSpatialCamera(gesture.current ?? gesture.origin, Math.exp(Math.max(-500, Math.min(500, event.deltaY * units)) * 0.002 * speed(event))));
    if (!gesture) return;
    clearTimeout(wheelTimer); wheelTimer = setTimeout(finish, 180);
  }, { passive: false });
  window.addEventListener("pointerdown", () => { if (gesture?.kind === "wheel") finish(); }, true);
  window.addEventListener("keydown", event => {
    if (event.code === "Escape" && gesture) { event.preventDefault(); event.stopImmediatePropagation(); cancel(); return; }
    // Buttons, disclosures and numeric inputs retain native Space activation.
    if (event.code !== "Space" || !options.canStart() || event.target !== canvas) return;
    space = true; event.preventDefault();
  }, true);
  window.addEventListener("keyup", event => { if (event.code === "Space") space = false; });
  window.addEventListener("blur", () => { space = false; cancel(); });
  window.addEventListener("resize", () => cancel());
  document.addEventListener("visibilitychange", () => { if (document.hidden) { space = false; cancel(); } });
  window.addEventListener("pagehide", () => { clearTimeout(wheelTimer); });
  return {
    ownsGesture: () => !!gesture,
    cancel,
    current: () => gesture?.current,
    scrub(label: HTMLElement, input: HTMLInputElement, build: () => SpatialCameraSpec) {
      label.classList.add("placement-number-scrub");
      label.dataset.placementCameraScrub = input.dataset.placementGameCameraField;
      setUiAttribute(label, "title", "Drag to adjust · Shift: fine · Ctrl/Cmd: fast");
      label.addEventListener("pointerdown", event => {
        if (event.button !== 0 || input.disabled || !Number.isFinite(input.valueAsNumber)) return;
        const name = input.dataset.placementGameCameraField!;
        begin(event, "scrub", { input, build, value: input.valueAsNumber,
          step: name === "pitch" || name === "yaw" || name === "fov" ? 0.25 : 1,
          exponential: ["height", "distance", "near", "far"].includes(name) });
      });
      label.addEventListener("lostpointercapture", captureLost);
    },
  };
}
