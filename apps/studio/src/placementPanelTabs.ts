import { setUiAttribute, setUiText } from "./placementLocale";
let sequence = 0;

/** UI-only tabs. Inactive content is hidden, including its keyboard controls. */
export function createPlacementPanelTabs<K extends string>(
  label: string,
  entries: readonly (readonly [K, string])[],
  change?: (key: K) => void,
) {
  const element = document.createElement("div");
  element.className = "placement-panel-tabs";
  const tabs = document.createElement("div");
  tabs.className = "placement-panel-tablist";
  tabs.setAttribute("role", "tablist");
  setUiAttribute(tabs, "aria-label", label);
  const panels = new Map<K, HTMLElement>();
  const buttons = new Map<K, HTMLButtonElement>();
  let active = entries[0][0];
  const prefix = `placement-tabs-${++sequence}`;
  element.append(tabs);
  function select(key: K, focus = false, notify = true) {
    active = key;
    for (const [id, panel] of panels) {
      panel.hidden = id !== key;
      const button = buttons.get(id)!;
      button.setAttribute("aria-selected", String(id === key));
      button.tabIndex = id === key ? 0 : -1;
    }
    if (focus) buttons.get(key)?.focus({ preventScroll: true });
    if (notify) change?.(key);
  }
  for (const [key, title] of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `${prefix}-${key}-tab`;
    setUiText(button, title);
    button.dataset.placementPanelTab = key;
    button.setAttribute("role", "tab");
    const panel = document.createElement("div");
    panel.id = `${prefix}-${key}-panel`;
    panel.className = "placement-panel-tabbody";
    panel.dataset.placementPanelBody = key;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    button.setAttribute("aria-controls", panel.id);
    button.addEventListener("click", () => select(key));
    tabs.append(button);
    element.append(panel);
    buttons.set(key, button);
    panels.set(key, panel);
  }
  tabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const keys = [...buttons.keys()],
      index = keys.indexOf(active);
    event.preventDefault();
    event.stopPropagation();
    select(
      keys[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? keys.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + keys.length) %
              keys.length
      ],
      true,
    );
  });
  select(active, false, false);
  return { element, panels, buttons, select, active: () => active };
}
