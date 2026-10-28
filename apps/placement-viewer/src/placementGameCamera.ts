import { resolveSpatialCameraSpec, type SpatialCameraSpec } from "@ferrum2d/ferrum-web/core";
import { setUiAttribute, setUiText } from "./placementLocale";
import { decorateViewportAction } from "./placementViewportChrome";
import { spatialCameraPitch, orbitSpatialCameraPitch } from "./placementSpatialCamera";
import { installGameCameraGestures } from "./placementGameCameraGestures";

/** Cold authored camera controls. The workspace owns transactions and native apply. */
export function createPlacementGameCamera(options: {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  camera(): SpatialCameraSpec | undefined;
  editorCamera(): SpatialCameraSpec | undefined;
  canEdit(): boolean;
  live(): boolean;
  previewInput(camera?: SpatialCameraSpec): void;
  closePreview(): void;
  commit(camera: SpatialCameraSpec): boolean;
  preview(): void;
  report(error?: unknown): void;
}) {
  const element = document.createElement("section");
  element.className = "placement-game-camera";
  const heading = document.createElement("h4"), hint = document.createElement("p"), errorMessage = document.createElement("p");
  errorMessage.className = "placement-game-camera-error";
  errorMessage.setAttribute("role", "alert"); errorMessage.hidden = true;
  setUiText(heading, "Game Camera");
  setUiText(hint, "Changes affect Game Preview. Save or export to keep them.");
  const dock = document.createElement("aside"), dockHeader = document.createElement("div"), liveLabel = document.createElement("strong"), close = document.createElement("button");
  dock.className = "placement-game-camera-dock";
  dock.dataset.placementGameCameraDock = "true";
  setUiAttribute(dock, "aria-label", "Game Camera");
  dockHeader.className = "placement-game-camera-dock-header";
  setUiText(liveLabel, "Live Preview");
  close.type = "button";
  close.dataset.placementGameCameraClose = "true";
  setUiText(close, "Back to Editing");
  close.addEventListener("click", () => { if (flushInput()) options.closePreview(); });
  dockHeader.append(liveLabel, close); dock.append(dockHeader); dock.hidden = true;
  options.stage.append(dock);
  let home: HTMLElement | undefined;
  const actions = document.createElement("div");
  actions.className = "placement-game-camera-actions";
  const apply = document.createElement("button"), preview = document.createElement("button");
  apply.type = preview.type = "button";
  apply.dataset.placementGameCameraApply = "true";
  preview.dataset.placementGameCameraPreview = "true";
  setUiText(apply, "Apply Current View");
  setUiAttribute(apply, "title", "Save this view as the game camera");
  setUiText(preview, "View Game Camera");
  setUiAttribute(preview, "title", "Paused preview with the game frame");
  actions.append(apply, preview);
  const form = document.createElement("form");
  form.className = "placement-game-camera-fields";
  form.addEventListener("submit", event => event.preventDefault());
  const projection = document.createElement("select"), projectionRow = document.createElement("label"), projectionLabel = document.createElement("span");
  setUiText(projectionLabel, "Projection");
  setUiAttribute(projection, "aria-label", "Game Camera Projection");
  projection.dataset.placementGameCameraProjection = "true";
  for (const [value, caption] of [["orthographic", "Orthographic"], ["perspective", "Perspective"]]) {
    const option = document.createElement("option"); option.value = value; setUiText(option, caption); projection.append(option);
  }
  projectionRow.append(projectionLabel, projection); form.append(projectionRow);
  const advanced = document.createElement("details"), summary = document.createElement("summary"), advancedFields = document.createElement("div");
  setUiText(summary, "Advanced Camera");
  advancedFields.className = "placement-game-camera-fields";
  advanced.append(summary, advancedFields);
  summary.addEventListener("keydown", event => {
    if (!["Enter", "Space"].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) advanced.open = !advanced.open;
  });
  const fields = new Map<string, HTMLInputElement>();
  const ranges = new Map<string, HTMLInputElement>();
  const scrubFields: Array<{ label: HTMLElement; input: HTMLInputElement; build(): SpatialCameraSpec }> = [];
  const inputEdits = new Map<HTMLInputElement, { apply(resetOnFailure?: boolean): boolean; displayed: string }>();
  for (const [name, caption, parent, min, max] of [
    ["pitch", "Game Viewing Angle (°)", form, -90, 90],
    ["yaw", "Game View Direction (°)", form],
    ["height", "View Size", form, 0],
    ["fov", "Field of View (°)", form, 1, 170],
    ["distance", "Camera Distance", form, 0],
    ["targetX", "Center X", form], ["targetY", "Center Y", form], ["targetElevation", "Center Height", form],
    ["positionX", "Camera X", advancedFields], ["positionY", "Camera Y", advancedFields], ["positionElevation", "Camera Height", advancedFields],
    ["near", "Near Clip", advancedFields, 0], ["far", "Far Clip", advancedFields, 0],
  ] as const) {
    const row = document.createElement("label"), text = document.createElement("span"), input = document.createElement("input");
    setUiText(text, caption); setUiAttribute(input, "aria-label", caption);
    input.type = "number"; input.step = "any";
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.dataset.placementGameCameraField = name;
    row.append(text, input); parent.append(row); fields.set(name, input);
    const build = () => {
      if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) throw new Error("Enter a valid camera value");
      const value = input.valueAsNumber, current = read();
      if (name === "pitch") return orbitSpatialCameraPitch(current, value);
      if (name === "yaw") {
        const radius = Math.hypot(current.position.x - current.target.x, current.position.y - current.target.y), angle = value * Math.PI / 180;
        current.position.x = current.target.x + radius * Math.cos(angle);
        current.position.y = current.target.y + radius * Math.sin(angle);
      } else if (name === "distance") setDistance(current, value);
      else if (name === "fov") current.fovDegrees = value;
      else if (name === "height" || name === "near" || name === "far") current[name] = value;
      else {
        const axis = name.endsWith("Elevation") ? "elevation" : name.endsWith("X") ? "x" : "y";
        if (name.startsWith("target")) {
          const delta = value - current.target[axis];
          current.target[axis] = value; current.position[axis] += delta;
        } else current.position[axis] = value;
      }
      return current;
    };
    const apply = (resetOnFailure = true) => edit(build, resetOnFailure);
    scrubFields.push({ label: text, input, build });
    const pending = { apply, displayed: "" };
    inputEdits.set(input, pending);
    const previewInput = () => {
      if (!options.live() || !options.canEdit()) return;
      try { options.previewInput(resolveSpatialCameraSpec(build())); report(); }
      catch (error) {
        // Incomplete/invalid text remains editable, but must not leave a stale view.
        try { options.previewInput(); } catch (restoreError) { report(restoreError); return; }
        report(error);
      }
    };
    input.addEventListener("input", previewInput);
    const escapeInput = (event: KeyboardEvent) => {
      if (event.code !== "Escape" || !options.live()) return;
      event.preventDefault(); event.stopPropagation();
      try { options.previewInput(); sync(true); report(); }
      catch (error) { report(error); }
    };
    input.addEventListener("keydown", escapeInput);
    input.addEventListener("keydown", event => {
      if (event.code !== "Enter") return;
      event.preventDefault(); event.stopPropagation();
      if (input.value !== pending.displayed || input.validity.badInput) {
        const focused = document.activeElement === input;
        apply();
        // The commit briefly disables controls. Keep keyboard editing in this field.
        if (focused && input.isConnected && !input.disabled) input.focus({ preventScroll: true });
      }
    });
    if (name === "pitch" || name === "yaw") {
      const range = document.createElement("input");
      range.type = "range"; range.min = name === "pitch" ? "-89" : "-180";
      range.max = name === "pitch" ? "89" : "180"; range.step = "1";
      range.dataset.placementGameCameraRange = name;
      setUiAttribute(range, "aria-label", caption);
      range.addEventListener("input", () => { input.value = range.value; previewInput(); });
      range.addEventListener("change", () => {
        if (input.value !== pending.displayed || input.validity.badInput) apply();
      });
      range.addEventListener("keydown", escapeInput);
      row.append(range); ranges.set(name, range);
    }
    input.addEventListener("change", () => {
      // A save can commit before the browser delivers blur/change. Do not
      // recompute an already-accepted angle and create a second floating-point edit.
      if (input.value !== pending.displayed || input.validity.badInput) apply();
      else if (options.canEdit()) report();
    });
  }
  const zoom = document.createElement("div"); zoom.className = "placement-game-camera-actions";
  const zoomButtons: HTMLButtonElement[] = [];
  for (const [action, icon, caption, factor] of [["in", "plus", "Zoom In", 0.8], ["out", "minus", "Zoom Out", 1.25]] as const) {
    const button = document.createElement("button"); button.type = "button"; button.dataset.placementGameCameraZoom = action;
    decorateViewportAction(button, icon, caption);
    button.addEventListener("click", () => edit(() => {
      const current = read();
      if (current.projection === "orthographic") current.height = current.height! * factor;
      else setDistance(current, distance(current) * factor);
      return current;
    }));
    zoomButtons.push(button); zoom.append(button);
  }
  const lensHint = document.createElement("p");
  setUiText(lensHint, "Smaller view size zooms in. Perspective uses distance and field of view.");
  const gestureHint = document.createElement("p");
  setUiText(gestureHint, "Drag: orbit · Space/middle drag: pan · Wheel: zoom");
  element.append(heading, hint, gestureHint, errorMessage, actions, form, zoom, lensHint, advanced);
  projection.addEventListener("change", () => edit(() => {
    const current = read(), next = projection.value;
    if (next !== "orthographic" && next !== "perspective") throw new Error("Unknown camera projection");
    if (next === current.projection) return current;
    // Preserve the vertical extent at the target when switching projection.
    if (next === "perspective") {
      setDistance(current, current.height! / (2 * Math.tan(Math.PI / 8)));
      delete current.height; current.fovDegrees = 45;
    } else {
      current.height = 2 * distance(current) * Math.tan(current.fovDegrees! * Math.PI / 360);
      delete current.fovDegrees;
    }
    current.projection = next;
    // Moving the eye to preserve framing must not leave its target clipped.
    // Keep authored clips whenever they already contain the new target depth.
    const depth = Math.fround(distance(current));
    if (Math.fround(current.near!) >= depth) current.near = depth / 2;
    if (Math.fround(current.far!) <= depth) current.far = depth * 2;
    return current;
  }));
  apply.addEventListener("click", () => edit(() => {
    const current = options.editorCamera();
    if (!current) throw new Error("No editor camera available");
    return structuredClone(current);
  }));
  preview.addEventListener("click", () => { if (options.canEdit()) options.preview(); });

  const frame = document.createElement("div"), frameLabel = document.createElement("span");
  frame.className = "placement-game-camera-frame"; frame.dataset.placementGameCameraFrame = "true";
  frame.setAttribute("role", "img"); setUiAttribute(frame, "aria-label", "Game Camera Frame");
  setUiText(frameLabel, "Game Frame"); frame.append(frameLabel); frame.hidden = true; options.stage.append(frame);
  const gestures = installGameCameraGestures({
    canvas: options.canvas,
    canStart: () => options.live() && options.canEdit(),
    beforeStart: flushInput,
    camera: read,
    viewHeight: () => frame.getBoundingClientRect().height || options.canvas.clientHeight,
    preview: camera => options.previewInput(camera),
    commit: camera => edit(() => camera),
    changed: () => sync(true),
    report,
  });
  for (const field of scrubFields) gestures.scrub(field.label, field.input, field.build);
  function read() { return resolveSpatialCameraSpec(options.camera()); }
  function distance(camera: SpatialCameraSpec) {
    return Math.hypot(camera.position.x - camera.target.x, camera.position.y - camera.target.y, camera.position.elevation - camera.target.elevation);
  }
  function setDistance(camera: SpatialCameraSpec, value: number) {
    if (!Number.isFinite(value) || value <= 0) throw new Error("Camera distance must be positive");
    const ratio = value / distance(camera);
    for (const axis of ["x", "y", "elevation"] as const)
      camera.position[axis] = camera.target[axis] + (camera.position[axis] - camera.target[axis]) * ratio;
  }
  function edit(build: () => SpatialCameraSpec, resetOnFailure = true): boolean {
    if (!options.canEdit()) return false;
    let accepted = false;
    try {
      accepted = options.commit(resolveSpatialCameraSpec(build()));
      if (accepted) report();
      else report(new Error("Game camera change rejected"));
      return accepted;
    }
    catch (error) { report(error); return false; }
    finally {
      if (options.live()) {
        try { options.previewInput(); } catch (error) { report(error); }
      }
      sync(accepted || resetOnFailure);
    }
  }
  function report(error?: unknown) {
    errorMessage.hidden = !error;
    setUiText(errorMessage, error ? error instanceof Error ? error.message : String(error) : "");
    options.report(error);
  }
  function sync(reset = false) {
    const live = options.live();
    if (!home && element.parentElement && element.parentElement !== dock) home = element.parentElement;
    const parent = live ? dock : home;
    if (parent && element.parentElement !== parent) parent.append(element);
    dock.hidden = !live;
    options.stage.dataset.gameCameraEditing = String(live);
    preview.hidden = live;
    setUiText(hint, live ? "Paused. Changes appear immediately. Save or export to keep them." : "Changes affect Game Preview. Save or export to keep them.");
    gestureHint.hidden = !live;
    for (const field of scrubFields) {
      field.label.classList.toggle("placement-number-scrub", live);
      setUiAttribute(field.label, "title", live ? "Drag to adjust · Shift: fine · Ctrl/Cmd: fast" : "Open Game Camera preview to drag values");
    }
    const camera = options.camera(), enabled = !!camera && options.canEdit() && !gestures.ownsGesture();
    close.disabled = !enabled;
    projection.disabled = apply.disabled = preview.disabled = !enabled;
    if (!options.editorCamera()) apply.disabled = true;
    for (const button of zoomButtons) button.disabled = !enabled;
    for (const input of fields.values()) input.disabled = !enabled;
    for (const range of ranges.values()) range.disabled = !enabled;
    if (!camera) return;
    const current = gestures.current() ?? read(), target = current.target, eye = current.position;
    projection.value = current.projection;
    const values: Record<string, number | undefined> = {
      pitch: spatialCameraPitch(current), yaw: Math.atan2(eye.y - target.y, eye.x - target.x) * 180 / Math.PI,
      height: current.height, fov: current.fovDegrees, distance: current.projection === "perspective" ? distance(current) : undefined,
      targetX: target.x, targetY: target.y, targetElevation: target.elevation,
      positionX: eye.x, positionY: eye.y, positionElevation: eye.elevation, near: current.near, far: current.far,
    };
    for (const [name, input] of fields) {
      const value = values[name]; input.parentElement!.hidden = value === undefined;
      const range = ranges.get(name);
      if (reset || (document.activeElement !== input && document.activeElement !== range)) {
        input.value = value === undefined ? "" : String(value);
        inputEdits.get(input)!.displayed = input.value;
        if (range) range.value = String(value);
      }
    }
  }
  function flushInput(): boolean {
    if (gestures.ownsGesture()) return false;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLInputElement)) return true;
    const input = fields.get(focused.dataset.placementGameCameraRange ?? "") ?? focused;
    const pending = inputEdits.get(input);
    if (!pending || (input.value === pending.displayed && !input.validity.badInput)) return true;
    const text = input.value, badInput = input.validity.badInput;
    const accepted = pending.apply(false);
    if (!accepted) {
      // Native rejection may have refreshed the accepted draft. Keep the user's
      // rejected value available for correction; incomplete numbers have no DOM value.
      if (!badInput) input.value = text;
      if (!focused.disabled) focused.focus({ preventScroll: true });
    }
    return accepted;
  }
  // Open/save hosts publish the document while the shell is inert. Observe the
  // lock separately so unlocking also refreshes controls without a resize/edit.
  const shell = options.canvas.closest<HTMLElement>(".demo-shell");
  if (shell) {
    const observer = new MutationObserver(() => sync(true));
    observer.observe(shell, { attributes: true, attributeFilter: ["inert"] });
    window.addEventListener("pagehide", event => {
      if (!event.persisted) observer.disconnect();
    });
  }
  return {
    element, sync, flushInput,
    ownsGesture: gestures.ownsGesture,
    cancelGesture: gestures.cancel,
    frame(presentation: Float32Array | undefined, show: boolean) {
      frame.hidden = !show;
      if (!show) return;
      const canvas = options.canvas.getBoundingClientRect(), stage = options.stage.getBoundingClientRect();
      const [x, y, width, height] = presentation ?? [0, 0, 1, 1];
      frame.style.left = canvas.left - stage.left + canvas.width * x + "px";
      frame.style.top = canvas.top - stage.top + canvas.height * y + "px";
      frame.style.width = canvas.width * width + "px"; frame.style.height = canvas.height * height + "px";
    },
  };
}
