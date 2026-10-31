import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
export interface PlacementBrowserAsset {
  key: string;
  kind: "sprite" | "model";
  id: string;
  label: string;
  frameId?: string;
  contentId?: string;
  thumbnail?: string;
  uv?: { u0: number; v0: number; u1: number; v1: number };
}

/** Project UI preferences only; no authoring document or runtime is stored. */
export function createPlacementAssetBrowser(options: {
  entries(): readonly PlacementBrowserAsset[];
  choose(asset: PlacementBrowserAsset): void;
  drag(event: DragEvent, asset: PlacementBrowserAsset): void;
  canUse(asset: PlacementBrowserAsset): boolean;
  projectKey(): string;
  selected(asset: PlacementBrowserAsset): boolean;
  normal?(asset: PlacementBrowserAsset): void;
  editPixels?(asset: PlacementBrowserAsset): void;
}) {
  const element = document.createElement("section");
  element.className = "placement-asset-browser";
  element.dataset.placementAssetBrowser = "true";
  const heading = document.createElement("h3");
  setUiText(heading, "Assets");
  const search = document.createElement("input");
  search.type = "search";
  setUiAttribute(search, "placeholder", "Search Assets");
  setUiAttribute(search, "aria-label", "Search assets");
  search.dataset.placementAssetSearch = "true";
  const filter = document.createElement("select");
  setUiAttribute(filter, "aria-label", "Asset filter");
  filter.dataset.placementAssetFilter = "true";
  for (const [value, label] of [
    ["all", "All"],
    ["sprite", "Sprites"],
    ["model", "Models"],
    ["recent", "Recent"],
    ["favorite", "Favorites"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    setUiText(option, label);
    filter.append(option);
  }
  const grid = document.createElement("div");
  grid.className = "placement-asset-grid";
  const status = document.createElement("output");
  status.setAttribute("aria-live", "polite");
  element.append(heading, search, filter, grid, status);
  let project = "",
    signature = "",
    favorites: string[] = [],
    recent: string[] = [];
  const storageKey = () => "ferrum.placement.assets.v1:" + project;
  function save() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({ favorites, recent }));
    } catch {
      /* optional UI preference */
    }
  }
  function remember(key: string) {
    recent = [key, ...recent.filter((value) => value !== key)].slice(0, 24);
    save();
  }
  const rendered = new Map<HTMLButtonElement, PlacementBrowserAsset>();
  function syncSelection() {
    for (const [button, asset] of rendered) {
      const selected = options.selected(asset);
      if (button.dataset.selected !== String(selected)) {
        button.setAttribute("aria-pressed", String(selected));
        button.dataset.selected = String(selected);
      }
    }
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    let entries = options
      .entries()
      .filter(
        (asset) =>
          (asset.label + " " + asset.id + " " + (asset.frameId ?? ""))
            .toLocaleLowerCase()
            .includes(query) &&
          (filter.value === "all" ||
            filter.value === asset.kind ||
            (filter.value === "favorite" && favorites.includes(asset.key)) ||
            (filter.value === "recent" && recent.includes(asset.key))),
      );
    if (filter.value === "recent")
      entries = [...entries].sort(
        (a, b) => recent.indexOf(a.key) - recent.indexOf(b.key),
      );
    grid.replaceChildren();
    rendered.clear();
    for (const asset of entries.slice(0, 300)) {
      const cell = document.createElement("div");
      cell.className = "placement-asset-cell";
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.placementBrowserAsset = asset.key;
      rendered.set(button, asset);
      button.title = asset.label;
      button.disabled = !options.canUse(asset);
      button.draggable = !button.disabled;
      const image = document.createElement("span");
      image.className = "placement-browser-thumbnail";
      if (asset.thumbnail) {
        image.style.backgroundImage = `url(${JSON.stringify(asset.thumbnail)})`;
        if (asset.uv) {
          const { u0, v0, u1, v1 } = asset.uv,
            du = u1 - u0,
            dv = v1 - v0;
          image.style.backgroundSize = `${100 / du}% ${100 / dv}%`;
          image.style.backgroundPosition = `${du === 1 ? 0 : (100 * u0) / (1 - du)}% ${dv === 1 ? 0 : (100 * v0) / (1 - dv)}%`;
        }
      } else setUiText(image, asset.kind === "model" ? "GLB" : "IMG");
      const label = document.createElement("span");
      label.textContent = asset.label;
      button.append(image, label);
      button.addEventListener("click", () => {
        options.choose(asset);
        remember(asset.key);
        syncSelection();
      });
      button.addEventListener("dragstart", (event) => {
        options.drag(event, asset);
        if (!event.defaultPrevented) remember(asset.key);
        syncSelection();
      });
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "placement-asset-favorite";
      const star = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      star.setAttribute("viewBox", "0 0 24 24");
      star.setAttribute("aria-hidden", "true");
      star.setAttribute("width", "16");
      star.setAttribute("height", "16");
      const path = document.createElementNS(star.namespaceURI, "path");
      path.setAttribute(
        "d",
        "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z",
      );
      star.append(path);
      favorite.append(star);
      setUiAttribute(
        favorite,
        "title",
        favorites.includes(asset.key) ? "Remove favorite" : "Add favorite",
      );
      setUiAttribute(
        favorite,
        "aria-label",
        uiMessage("Favorite {0}", asset.label),
      );
      favorite.setAttribute(
        "aria-pressed",
        String(favorites.includes(asset.key)),
      );
      favorite.addEventListener("click", () => {
        favorites = favorites.includes(asset.key)
          ? favorites.filter((key) => key !== asset.key)
          : [...favorites, asset.key].slice(-128);
        save();
        render();
      });
      cell.append(button, favorite);
      if (asset.kind === "sprite" && asset.thumbnail && options.editPixels) {
        const edit = document.createElement("button");
        edit.type = "button"; edit.className = "placement-asset-normal";
        edit.dataset.placementEditPixels = asset.id;
        if (asset.frameId) edit.dataset.placementEditPixelFrame = asset.frameId;
        setUiText(edit, "Edit Pixels");
        setUiAttribute(edit, "aria-label", uiMessage("Edit Pixels {0}", asset.label));
        edit.disabled = !options.canUse(asset);
        edit.addEventListener("click", () => options.editPixels?.(asset));
        cell.append(edit);
      }
      if (
        asset.kind === "sprite" &&
        !asset.frameId &&
        asset.thumbnail &&
        options.normal
      ) {
        const normal = document.createElement("button");
        normal.type = "button";
        setUiText(normal, "Normal");
        normal.className = "placement-asset-normal";
        setUiAttribute(normal, "title", "Generate Normal");
        setUiAttribute(
          normal,
          "aria-label",
          uiMessage("Generate Normal {0}", asset.label),
        );
        normal.disabled = !options.canUse(asset);
        normal.addEventListener("click", () => options.normal?.(asset));
        cell.append(normal);
      }
      grid.append(cell);
    }
    syncSelection();
    setUiText(
      status,
      entries.length
        ? uiMessage(
            "{0} assets{1}",
            entries.length,
            entries.length > 300
              ? uiMessage(" · Showing first 300; refine search")
              : uiMessage(""),
          )
        : "No matching assets",
    );
  }
  search.addEventListener("input", render);
  filter.addEventListener("change", render);
  return {
    element,
    sync() {
      const nextProject = options.projectKey();
      if (project !== nextProject) {
        project = nextProject;
        favorites = [];
        recent = [];
        try {
          const value: unknown = JSON.parse(
            localStorage.getItem(storageKey()) ?? "null",
          );
          if (value && typeof value === "object") {
            const read = (key: string, max: number) => {
              const values: unknown = Reflect.get(value, key);
              return Array.isArray(values)
                ? values
                    .filter(
                      (v): v is string =>
                        typeof v === "string" && v.length < 1024,
                    )
                    .slice(-max)
                : [];
            };
            favorites = read("favorites", 128);
            recent = read("recent", 24);
          }
        } catch {
          /* malformed storage uses defaults */
        }
        signature = "";
      }
      const next = JSON.stringify(
        options
          .entries()
          .map((asset) => [
            asset.key,
            asset.label,
            asset.frameId,
            asset.uv,
            asset.kind === "model" ? asset.contentId : asset.thumbnail,
            options.canUse(asset),
          ]),
      );
      if (next !== signature) {
        signature = next;
        render();
      }
      syncSelection();
    },
  };
}
