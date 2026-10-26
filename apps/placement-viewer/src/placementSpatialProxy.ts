import {
  setUiAttribute,
  setUiText,
  uiMessage,
  uiText,
} from "./placementLocale";
import type {
  ScenePlacementViewer,
  ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";
type Value = NonNullable<
  Parameters<ScenePlacementViewer["addInstance"]>[1]["props"]
>[string];

/** Explicit authored proxies. Dimensions never come from model mesh inference. */
export function createPlacementSpatialProxy(options: {
  viewer: ScenePlacementViewer;
  components(id: string): Value;
  finish(): void;
  change(state: ScenePlacementViewerState): unknown;
  report(error?: unknown): void;
  debug(enabled: boolean): void;
}) {
  const element = document.createElement("details");
  element.className = "placement-proxy-panel";
  const summary = document.createElement("summary");
  setUiText(summary, "Collision Proxy");
  const shape = document.createElement("select");
  setUiAttribute(shape, "aria-label", "Proxy shape");
  shape.dataset.placementProxyShape = "true";
  for (const value of ["aabb", "orientedBox"]) {
    const option = document.createElement("option");
    option.value = value;
    setUiText(option, value === "aabb" ? "AABB" : "OBB");
    shape.append(option);
  }
  const fields = new Map<string, HTMLInputElement>();
  const form = document.createElement("div");
  form.className = "placement-spatial-fields";
  for (const [name, label, value] of [
    ["width", "Width", 16],
    ["depth", "Depth", 16],
    ["height", "Height", 16],
    ["elevation", "Elevation", 0],
    ["floorId", "Floor", 0],
    ["yaw", "Collider Yaw", 0],
    ["offsetX", "Offset X", 0],
    ["offsetY", "Offset Y", 0],
  ] as const) {
    const row = document.createElement("label"),
      input = document.createElement("input");
    setUiText(row, label);
    input.type = "number";
    input.value = String(value);
    input.dataset.placementProxyField = name;
    setUiAttribute(
      input,
      "aria-label",
      uiMessage("Proxy {0}", uiMessage(label)),
    );
    row.append(input);
    form.append(row);
    fields.set(name, input);
  }
  const apply = document.createElement("button"),
    remove = document.createElement("button");
  apply.type = remove.type = "button";
  setUiText(apply, "Apply Proxy");
  setUiText(remove, "Remove Proxy");
  apply.dataset.placementProxyApply = "true";
  remove.dataset.placementProxyRemove = "true";
  const hint = document.createElement("p");
  setUiText(hint, "Explicit dimensions. Visual position stays fixed.");
  const show = document.createElement("input"),
    showLabel = document.createElement("label");
  show.type = "checkbox";
  show.dataset.placementProxyOverlay = "true";
  showLabel.append(show, uiText(" Show Proxy Overlay"));
  show.addEventListener("change", () => options.debug(show.checked));
  element.append(summary, showLabel, shape, form, apply, remove, hint);
  let fieldSignature: string | undefined;
  function commit(clear: boolean) {
    try {
      options.finish();
      const state = options.viewer.state(),
        instance = state.selected,
        model = instance && state.spatial?.models?.[instance.instanceId];
      if (
        !instance ||
        !model ||
        state.lockedInstanceIds.includes(instance.instanceId) ||
        state.spatial?.attachments?.[instance.instanceId]
      )
        throw new Error("Choose an unlocked, unattached model");
      const source = options.components(instance.instanceId);
      if (!source || typeof source !== "object" || Array.isArray(source))
        throw new Error("Proxy requires inline components");
      const values = Object.fromEntries(
        [...fields].map(([name, input]) => [name, input.valueAsNumber]),
      );
      if (
        !clear && (
          Object.values(values).some((value) => !Number.isFinite(value)) ||
          values.width <= 0 ||
          values.depth <= 0 ||
          values.height <= 0 ||
          !Number.isInteger(values.floorId) ||
          values.floorId < 0 ||
          values.floorId > 0xffffffff
        )
      )
        throw new Error(
          "Proxy dimensions must be positive; floor must be uint32",
        );
      const components: Record<string, Value> = Object.fromEntries(
        Object.entries(source),
      );
      const totalElevation =
        (instance.body?.heightSpan?.elevation ?? 0) + (model.elevation ?? 0);
      if (clear) {
        components.collider = "none";
        delete components.body;
      } else {
        components.collider = {
          type: shape.value,
          halfWidth: values.width / 2,
          halfHeight: values.depth / 2,
          offsetX: values.offsetX,
          offsetY: values.offsetY,
          ...(shape.value === "orientedBox"
            ? { rotationRadians: (values.yaw * Math.PI) / 180 }
            : {}),
        };
        const body = components.body;
        components.body = {
          ...(body && typeof body === "object" && !Array.isArray(body)
            ? Object.fromEntries(Object.entries(body))
            : { type: "static" }),
          heightSpan: {
            elevation: values.elevation,
            height: values.height,
            floorId: values.floorId,
          },
        };
      }
      options.viewer.beginEdit("Collision Proxy");
      try {
        options.viewer.updateInstanceComponents(
          instance.instanceId,
          components,
        );
        options.viewer.updateSpatial([
          {
            kind: "updateModel",
            id: instance.instanceId,
            changes: {
              elevation: totalElevation - (clear ? 0 : values.elevation),
            },
          },
        ]);
        options.change(options.viewer.commitEdit());
        options.report();
      } catch (error) {
        options.change(options.viewer.cancelEdit());
        throw error;
      }
    } catch (error) {
      options.report(error);
    }
  }
  apply.addEventListener("click", () => commit(false));
  remove.addEventListener("click", () => commit(true));
  return {
    element,
    overlayControl: showLabel,
    overlay: () => show.checked,
    sync(state: ScenePlacementViewerState) {
      const instance = state.selected,
        model = instance && state.spatial?.models?.[instance.instanceId];
      element.hidden = !model;
      const disabled =
        !model ||
        !instance ||
        state.lockedInstanceIds.includes(instance.instanceId) ||
        !!state.spatial?.attachments?.[instance.instanceId];
      for (const input of fields.values()) input.disabled = disabled;
      shape.disabled = apply.disabled = disabled;
      remove.disabled = disabled || !instance?.body;
      if (!instance || !model) {
        fieldSignature = undefined;
        return;
      }
      const collider = instance.collider;
      const box = collider?.type === "aabb" || collider?.type === "orientedBox" ? collider : undefined;
      const shapeValue = box?.type ?? "aabb";
      const values = {
        width: box ? box.halfWidth * 2 : 16,
        depth: box ? box.halfHeight * 2 : 16,
        offsetX: box?.offsetX ?? 0,
        offsetY: box?.offsetY ?? 0,
        yaw: box?.type === "orientedBox" ? (box.rotationRadians * 180) / Math.PI : 0,
        elevation: instance.body?.heightSpan?.elevation ?? model.elevation ?? 0,
        floorId: instance.body?.heightSpan?.floorId ?? 0,
        height: instance.body?.heightSpan?.height ?? 16,
      };
      // Refresh on authoritative component/history changes, while retaining
      // unapplied inputs through unrelated selection/lock-state notifications.
      const signature = JSON.stringify([instance.instanceId, collider?.type, !!instance.body, values]);
      if (signature === fieldSignature) return;
      fieldSignature = signature;
      shape.value = shapeValue;
      for (const [name, value] of Object.entries(values))
        fields.get(name)!.value = String(value);
    },
  };
}
