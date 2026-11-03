import type { ScenePlacementPatch } from "@ferrum2d/ferrum-web/authoring";
import type { PlacementTileAsset } from "./placementTileAssets";
import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";

/** Preview a validated, generated map patch without registering textures or editing a scene. */
export function createTileMapPreview() {
  const element = document.createElement("div"), canvas = document.createElement("canvas"), status = document.createElement("output");
  element.className = "placement-tile-map-preview";
  element.dataset.tileMapPreview = "stale";
  canvas.width = 320; canvas.height = 200; canvas.hidden = true;
  setUiAttribute(canvas, "aria-label", "Tile map preview");
  status.setAttribute("aria-live", "polite");
  element.append(canvas, status);
  let signature = "", serial = 0, disposed = false, loading = false;
  const invalidate = (next: string) => {
    if (signature === next) return;
    signature = next; serial++; canvas.hidden = true; element.dataset.tileMapPreview = "stale";
    setUiText(status, "Preview the map before applying. Amber outlines mark collision cells.");
  };
  async function show(asset: PlacementTileAsset, patch: ScenePlacementPatch) {
    // Decoding cannot be aborted. Keep one decode in flight even when inputs
    // invalidate its result, rather than allocating another bitmap per click.
    if (disposed || loading) return;
    loading = true;
    const token = ++serial;
    canvas.hidden = true; element.dataset.tileMapPreview = "loading";
    setUiText(status, "Preparing map preview…");
    let bitmap: ImageBitmap | undefined;
    try {
      const items = patch.operations.flatMap(op => {
        if (op.kind !== "addInstance") return [];
        // The map patch builder owns these inline components; mapped objects have no inline visual.
        const components = op.instance.props?.components as { visual?: { width: number; height: number; frame: {u0: number; v0: number; u1: number; v1: number} }; collider?: {type?: string} } | undefined;
        const visual = components?.visual;
        return [{ x: op.instance.x ?? 0, y: op.instance.y ?? 0, layer: op.instance.layer ?? 0,
          width: visual?.width ?? 8, height: visual?.height ?? 8, visual, solid: components?.collider?.type === "aabb" }];
      }).sort((a, b) => a.layer - b.layer);
      if (!items.length) throw Error("Map is empty");
      const left = Math.min(...items.map(i => i.x - i.width / 2)), right = Math.max(...items.map(i => i.x + i.width / 2));
      const top = Math.min(...items.map(i => i.y - i.height / 2)), bottom = Math.max(...items.map(i => i.y + i.height / 2));
      const scale = Math.min(304 / (right - left), 184 / (bottom - top));
      const ox = (320 - (right - left) * scale) / 2, oy = (200 - (bottom - top) * scale) / 2;
      bitmap = await createImageBitmap(new Blob([asset.png], {type: "image/png"}));
      if (disposed || serial !== token) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error("Canvas preview is unavailable");
      ctx.clearRect(0, 0, 320, 200); ctx.imageSmoothingEnabled = false;
      const style = getComputedStyle(element);
      for (const item of items) {
        const x = ox + (item.x - item.width / 2 - left) * scale, y = oy + (item.y - item.height / 2 - top) * scale;
        const width = item.width * scale, height = item.height * scale;
        if (item.visual) {
          const uv = item.visual.frame;
          ctx.drawImage(bitmap, uv.u0 * asset.width, uv.v0 * asset.height, (uv.u1 - uv.u0) * asset.width, (uv.v1 - uv.v0) * asset.height, x, y, width, height);
        } else {
          ctx.fillStyle = style.getPropertyValue("--fg-3").trim(); ctx.fillRect(x, y, width, height);
        }
        if (item.solid) { ctx.strokeStyle = style.getPropertyValue("--accent").trim(); ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, Math.max(0, width - 1), Math.max(0, height - 1)); }
      }
      canvas.hidden = false; element.dataset.tileMapPreview = "ready";
      setUiText(status, uiMessage("{0} tiles · {1} object markers · {2} collision cells · Scene unchanged", items.filter(i => i.visual).length, items.filter(i => !i.visual).length, items.filter(i => i.solid).length));
    } catch (error) {
      if (!disposed && serial === token) { element.dataset.tileMapPreview = "error"; setUiText(status, String(error)); }
    } finally { bitmap?.close(); loading = false; }
  }
  return { element, invalidate, show, isLoading: () => loading, destroy() { disposed = true; serial++; canvas.hidden = true; } };
}
