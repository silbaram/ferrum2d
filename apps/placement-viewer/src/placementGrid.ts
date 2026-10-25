import {
  setUiAttribute,
  setUiText,
  uiText,
  uiMessage,
} from "./placementLocale";
import {
  flatGrid,
  spatialGrid,
  visibleWorkingPlane,
  type GridColor,
  type GridSurface,
  type GridViewport,
} from "./placementGridGeometry";
export interface PlacementGridContext {
  mode: string;
  viewport: GridViewport;
  size: number;
  surfaces: readonly GridSurface[];
  referencePlane: boolean;
  planeElevation?: number;
  planeFloor?: number;
}
/** Workspace display state only. It never owns authored transforms or history. */
export function createPlacementGrid(
  mount: HTMLElement,
  changeSize: (size: number) => void,
) {
  const element = document.createElement("div"),
    label = document.createElement("label"),
    toggle = document.createElement("input"),
    size = document.createElement("input"),
    spacing = document.createElement("label"),
    terrainLabel = document.createElement("label"),
    terrain = document.createElement("input"),
    output = document.createElement("output");
  element.className = "placement-grid-controls";
  setUiAttribute(element, "aria-label", "Viewport grid");
  toggle.type = "checkbox";
  toggle.checked = true;
  setUiAttribute(toggle, "aria-label", "Show grid");
  toggle.dataset.placementGridToggle = "true";
  label.append(toggle, uiText(" Grid"));
  size.type = "number";
  size.min = "1";
  size.max = "1024";
  size.step = "1";
  setUiAttribute(size, "aria-label", "Grid size");
  spacing.append(uiText("Spacing"), size);
  output.dataset.placementGridSpacing = "true";
  terrain.type = "checkbox";
  terrain.dataset.placementTerrainGrid = "true";
  setUiAttribute(terrain, "aria-label", "Terrain height grid");
  terrainLabel.append(terrain, uiText("Terrain height grid"));
  element.append(label, spacing, terrainLabel, output);
  mount.append(element);
  const styles = getComputedStyle(mount),
    parse = (token: string, alpha: number): GridColor => {
      const hex = styles.getPropertyValue(token).trim();
      return [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
        alpha,
      ];
    };
  const minor = parse("--viewport-grid-strong", 0.28),
    major = parse("--fg-3", 0.45);
  let context: PlacementGridContext | undefined,
    revision = 0,
    flatKey = "",
    spatialKey = "",
    flat: ReturnType<typeof flatGrid> | undefined,
    spatial: ReturnType<typeof spatialGrid> | undefined;
  let metrics = {
    visible: false,
    mode: "2d",
    lineCount: 0,
    drawCalls: 0,
    spacing: 16,
    referencePlane: false,
    planeElevation: 0,
    terrainOverlay: false,
    depthTest: false,
  };
  size.addEventListener("change", () => {
    const n = size.valueAsNumber;
    if (Number.isInteger(n) && n >= 1 && n <= 1024) changeSize(n);
    else if (context) size.value = String(context.size);
  });
  toggle.addEventListener("change", () => {
    flatKey = spatialKey = "";
  });
  terrain.addEventListener("change", () => { spatialKey = ""; });
  function publish(lineCount: number, step: number, depthTest: boolean) {
    metrics = {
      visible: !!context && context.mode !== "game" && toggle.checked,
      mode: context?.mode ?? "2d",
      lineCount,
      drawCalls: lineCount ? 1 : 0,
      spacing: step,
      referencePlane: context?.referencePlane ?? false,
      planeElevation: context?.planeElevation ?? 0,
      terrainOverlay: terrain.checked,
      depthTest,
    };
    Object.assign(window, { ferrumPlacementGrid: { ...metrics } });
    setUiText(
      output,
      lineCount
        ? uiMessage(
            "{0} units{1}",
            step,
            context?.referencePlane
              ? uiMessage(" · Working plane: Floor {0} / H {1}", context.planeFloor ?? 0, context.planeElevation ?? 0)
              : "",
          )
        : "",
    );
  }
  return {
    sync(next: PlacementGridContext) {
      context = next;
      revision++;
      element.hidden = next.mode === "game";
      terrainLabel.hidden = next.mode !== "spatial";
      if (document.activeElement !== size) size.value = String(next.size);
    },
    flat() {
      if (!context || context.mode !== "2d" || !toggle.checked) {
        publish(0, context?.size ?? 16, false);
        return;
      }
      const key = JSON.stringify([context.viewport, context.size]);
      if (key !== flatKey) {
        flatKey = key;
        flat = flatGrid(context.viewport, context.size, minor, major);
      }
      publish(flat!.lineCount, flat!.step, false);
      return {
        lines: flat!,
        camera: { x: context.viewport.cameraX, y: context.viewport.cameraY },
      };
    },
    spatial(matrix: Float32Array, width: number, height: number) {
      if (!context || context.mode !== "spatial" || !toggle.checked) {
        publish(0, context?.size ?? 16, true);
        return;
      }
      const key =
        revision + ":" + width + ":" + height + ":" + matrix.join(",");
      if (key !== spatialKey) {
        spatialKey = key;
        const elevation = context.planeElevation ?? 0,
          plane = visibleWorkingPlane(matrix, elevation),
          surfaces = terrain.checked ? context.surfaces.filter(s =>
            // The continuous working grid already covers coplanar flat terrain.
            !plane || s.elevation !== elevation || (s.endElevation ?? s.elevation) !== elevation,
          ) : [];
        spatial = spatialGrid(
          [...(plane ? [plane] : []), ...surfaces],
          matrix,
          width,
          height,
          context.size,
          minor,
          major,
          true,
        );
      }
      publish(spatial!.lineCount, spatial!.step, true);
      return spatial;
    },
    submitted(lineCount: number) {
      publish(lineCount, metrics.spacing, metrics.depthTest);
    },
    hidden() {
      publish(0, context?.size ?? 16, false);
    },
    dispose() {
      element.remove();
      flat = spatial = undefined;
      Object.assign(window, { ferrumPlacementGrid: undefined });
    },
  };
}
export type PlacementGrid = ReturnType<typeof createPlacementGrid>;
