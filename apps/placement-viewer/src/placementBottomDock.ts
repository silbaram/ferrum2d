import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import { createPlacementPanelTabs } from "./placementPanelTabs";

export type PlacementBottomTab = "assets" | "problems" | "runtime" | "changes";

export function createPlacementBottomDock(metrics: HTMLElement) {
  const element = document.createElement("section");
  element.className = "placement-runtime-dock";
  setUiAttribute(element, "aria-label", "Workspace panels");
  const tabs = createPlacementPanelTabs<PlacementBottomTab>(
    "Bottom panels",
    [
      ["assets", "Assets"],
      ["problems", "Problems"],
      ["runtime", "Runtime"],
      ["changes", "Agent Changes"],
    ],
    (key) => {
      for (const panel of tabs.panels.values())
        for (const details of panel.querySelectorAll<HTMLDetailsElement>(
          "details[data-placement-diagnostic-section]",
        ))
          details.open = panel === tabs.panels.get(key);
    },
  );
  element.append(tabs.element);
  metrics.before(element);
  tabs.panels.get("runtime")!.append(metrics);
  let assetMount: HTMLElement | undefined, assetHome: HTMLElement | undefined;
  return {
    element,
    tabs,
    mountAssets(mount: HTMLElement) {
      if (assetMount === mount) return;
      if (assetMount && assetHome) assetHome.append(assetMount);
      assetMount = mount;
      assetHome = mount.parentElement ?? undefined;
      tabs.panels.get("assets")!.append(mount);
    },
    mountDiagnostics(
      panels: {
        problems: HTMLElement;
        runtime: HTMLElement;
        changes: HTMLElement;
      },
      reload: HTMLElement,
    ) {
      for (const key of ["problems", "runtime", "changes"] as const)
        tabs.panels.get(key)!.append(panels[key]);
      tabs.panels.get("problems")!.prepend(reload);
      element.querySelector(".placement-diagnostics")?.remove();
      tabs.select(tabs.active());
    },
    counts(changes: number, problems: number) {
      setUiText(
        tabs.buttons.get("changes")!,
        uiMessage("Agent Changes ({0})", changes),
      );
      setUiText(
        tabs.buttons.get("problems")!,
        uiMessage("Problems ({0})", problems),
      );
    },
  };
}
