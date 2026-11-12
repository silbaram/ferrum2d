import {
  setUiAttribute,
  setUiText,
  uiMessage,
  uiOption,
} from "./placementLocale";
import { placementRenderLayer } from "./placementLayerState";

import type {
  ResolvedSceneAuthoringDocument,
  ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";

/** Filters only presentation; selection, locks and authored hierarchy stay owned by the viewer. */
export function createPlacementSceneNavigator(
  list: HTMLElement,
  resolved: ResolvedSceneAuthoringDocument,
) {
  const element = document.createElement("div");
  element.className = "placement-scene-navigation";
  const search = document.createElement("input"),
    type = document.createElement("select"),
    layer = document.createElement("select");
  search.type = "search";
  setUiAttribute(search, "placeholder", "Search objects");
  setUiAttribute(search, "aria-label", "Search scene");
  setUiAttribute(type, "aria-label", "Scene type");
  setUiAttribute(layer, "aria-label", "Scene layer");
  layer.dataset.placementSceneLayerFilter = "true";
  for (const value of ["All Types", "Sprite", "Model", "Terrain", "Object"])
    type.add(uiOption(value, value));
  const frame = document.createElement("button"),
    count = document.createElement("output");
  frame.type = "button";
  setUiText(frame, "Frame Selected");
  frame.dataset.placementSceneFrame = "true";
  frame.addEventListener("click", () =>
    element.dispatchEvent(
      new CustomEvent("placement-scene-frame", { bubbles: true }),
    ),
  );
  const filters = document.createElement("div"), actions = document.createElement("div");
  filters.className = "placement-scene-filters";
  actions.className = "placement-scene-actions";
  filters.append(type, layer);
  actions.append(count, frame);
  element.append(search, filters, actions);
  let signature = "";
  const fragments = new Map<string, string[]>();
  for (const [id, fragment] of Object.entries(
    resolved.sceneComposition.fragments,
  ))
    for (const instance of fragment.instances) {
      if (!instance.id) continue;
      const owners = fragments.get(instance.id) ?? [];
      owners.push(id);
      fragments.set(instance.id, owners);
    }
  function sync(
    next: ScenePlacementViewerState,
    spatialTarget?: { kind: string; id: string },
  ) {
    const rows = [
      ...list.querySelectorAll<HTMLElement>(".placement-instance-row"),
    ];
    const nextSignature = JSON.stringify([
      next.fragment,
      next.instances.map((i) => [
        i.instanceId,
        i.sourceId,
        placementRenderLayer(i),
        i.visual?.kind,
      ]),
      Object.keys(next.spatial?.models ?? {}),
      next.spatial?.terrain.map((s) => [s.id, s.floorId]),
    ]);
    if (
      signature !== nextSignature ||
      !list.querySelector("[data-placement-fragment]")
    ) {
      signature = nextSignature;
      const expanded = new Map(
        [
          ...list.querySelectorAll<HTMLDetailsElement>(
            "[data-placement-fragment]",
          ),
        ].map((group) => [group.dataset.placementFragment!, group.open]),
      );
      const groups = new Map<string, HTMLDetailsElement>();
      const instances = new Map(
        next.instances.map((instance) => [instance.instanceId, instance]),
      );
      const group = (name: string, systemLabel = false) => {
        let value = groups.get(name);
        if (!value) {
          value = document.createElement("details");
          value.open = expanded.get(name) ?? true;
          value.dataset.placementFragment = name;
          const title = document.createElement("summary");
          if (systemLabel) setUiText(title, name);
          else title.textContent = name;
          value.append(title);
          groups.set(name, value);
        }
        return value;
      };
      for (const row of rows) {
        const id =
          row.querySelector<HTMLButtonElement>("[data-instance-id]")!.dataset
            .instanceId!;
        const instance = instances.get(id)!;
        row.dataset.sceneType = next.spatial?.models?.[id]
          ? "Model"
          : instance.visual?.kind === "sprite" || next.spatial?.billboards[id]
            ? "Sprite"
            : "Object";
        row.dataset.sceneLayer = String(placementRenderLayer(instance));
        row.dataset.sceneSearch = `${id} ${instance.prefab}`.toLowerCase();
        group(
          fragments.get(instance.sourceId)?.join(" / ") ?? next.fragment,
        ).append(row);
      }
      for (const surface of next.spatial?.terrain ?? []) {
        const row = document.createElement("div"),
          button = document.createElement("button");
        row.className = "placement-terrain-row";
        row.dataset.sceneType = "Terrain";
        row.dataset.sceneLayer = "terrain";
        row.dataset.sceneSearch = surface.id.toLowerCase();
        button.type = "button";
        button.textContent = surface.id;
        button.dataset.placementSceneSurface = surface.id;
        button.addEventListener("click", () =>
          element.dispatchEvent(
            new CustomEvent("placement-scene-surface", {
              bubbles: true,
              detail: surface.id,
            }),
          ),
        );
        row.append(button);
        group("Terrain", true).append(row);
      }
      list.replaceChildren(...groups.values());
      const previous = layer.value;
      layer.replaceChildren(
        uiOption("All Layers", "all"),
        ...[...new Set(next.instances.map((i) => String(placementRenderLayer(i))))]
          .sort((a, b) => Number(a) - Number(b))
          .map((v) => uiOption(uiMessage("Layer {0}", v), v)),
      );
      if (next.spatial?.terrain.length)
        layer.add(uiOption("Terrain", "terrain"));
      layer.value = [...layer.options].some((o) => o.value === previous)
        ? previous
        : "all";
    }
    frame.disabled = !next.selected && !spatialTarget;
    filter();
  }
  function filter() {
    let shown = 0,
      total = 0;
    for (const group of list.querySelectorAll<HTMLElement>(
      "[data-placement-fragment]",
    )) {
      let visible = 0;
      for (const row of group.querySelectorAll<HTMLElement>(
        "[data-scene-type]",
      )) {
        const match =
          (!search.value ||
            row.dataset.sceneSearch?.includes(
              search.value.trim().toLowerCase(),
            )) &&
          (type.value === "All Types" ||
            type.value === row.dataset.sceneType) &&
          (layer.value === "all" || layer.value === row.dataset.sceneLayer);
        row.hidden = !match;
        total++;
        if (match) {
          visible++;
          shown++;
        }
      }
      group.hidden = !visible;
    }
    setUiText(count, uiMessage("{0} / {1} objects", shown, total));
  }
  search.addEventListener("input", filter);
  type.addEventListener("change", filter);
  layer.addEventListener("change", filter);
  return { element, sync, filterLayer(value?: number) { layer.value = value === undefined ? "all" : String(value); filter(); } };
}
