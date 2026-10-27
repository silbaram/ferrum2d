import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";

// App-owned stroke icons; keep their labels in the locale catalog, never in SVG.
const paths = {
  select: '<path d="m3 2 10 7-5 1-2 4Z"/>',
  pan: '<path d="M5 8V4a1 1 0 0 1 2 0v3-4a1 1 0 0 1 2 0v4-3a1 1 0 0 1 2 0v4-2a1 1 0 0 1 2 0v5c0 3-2 4-5 4-2 0-3-1-4-3L2 9a1 1 0 0 1 2-1l1 1Z"/>',
  left: '<path d="M3 6a5 5 0 1 1 0 5M3 2v4h4"/>',
  right: '<path d="M13 6a5 5 0 1 0 0 5m0-9v4H9"/>',
  up: '<ellipse cx="8" cy="11" rx="5" ry="2"/><path d="M8 9V2M5 5l3-3 3 3"/>',
  down: '<ellipse cx="8" cy="5" rx="5" ry="2"/><path d="M8 7v7m-3-3 3 3 3-3"/>',
  height: '<path d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3"/>',
  minus: '<path d="M3 8h10"/>',
  plus: '<path d="M3 8h10M8 3v10"/>',
  reset: '<path d="M3 6a5 5 0 1 1 0 5M3 2v4h4M8 5v3l2 1"/>',
  frame: '<path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4"/><rect x="6" y="6" width="4" height="4"/>',
  fit: '<path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4M5 8h6M8 5v6"/>',
  floors: '<path d="m8 2 6 3-6 3-6-3Zm-6 6 6 3 6-3m-12 3 6 3 6-3"/>',
  view: '<path d="M2 4h12M2 8h12M2 12h12M5 2v4m6 0v4m-5 0v4"/>',
  camera: '<path d="M2 5h3l1-2h4l1 2h3v8H2Z"/><circle cx="8" cy="9" r="2"/>',
  layout: '<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M5 2v12m6-12v12M5 11h6"/>',
  help: '<circle cx="8" cy="8" r="6"/><path d="M6 6a2 2 0 1 1 3 2c-1 .5-1 1-1 1M8 11v.1"/>',
  file: '<path d="M4 2h5l3 3v9H4Z"/><path d="M9 2v4h3M6 9h4M6 11h4"/>',
  play: '<path d="m5 3 8 5-8 5Z"/>',
  pause: '<path d="M5 3v10M11 3v10"/>',
  stop: '<rect x="4" y="4" width="8" height="8"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
} as const;
export type ViewportIcon = keyof typeof paths;

export function decorateViewportAction(
  button: HTMLElement,
  icon: ViewportIcon,
  label: string,
  shortcut?: string,
  iconOnly = false,
) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths[icon];
  const text = document.createElement("span");
  text.className = iconOnly ? "placement-visually-hidden" : "placement-action-label";
  setUiText(text, label);
  setUiAttribute(button, "aria-label", label);
  setUiAttribute(button, "title", shortcut ? uiMessage("{0} ({1})", uiMessage(label), shortcut) : label);
  button.classList.add("placement-viewport-action");
  button.replaceChildren(svg, text);
  if (shortcut && !iconOnly) {
    const key = document.createElement("kbd");
    key.textContent = shortcut;
    key.setAttribute("aria-hidden", "true");
    button.append(key);
  }
}

export function viewportGroup(label: string) {
  const group = document.createElement("div");
  group.className = "placement-viewport-group";
  group.setAttribute("role", "group");
  setUiAttribute(group, "aria-label", label);
  return group;
}

/** Arrow keys traverse enabled toolbar actions; form controls retain native keys. */
export function installViewportToolbarKeys(toolbar: HTMLElement) {
  toolbar.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches("button, summary") || target.closest(".placement-view-panel, .placement-control-panel") || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.code)) return;
    const buttons = [...toolbar.querySelectorAll<HTMLElement>("button:not(:disabled), summary")].filter((b) => b.getClientRects().length && !b.closest(".placement-view-panel, .placement-control-panel"));
    const index = buttons.indexOf(target);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = event.code === "Home" ? 0 : event.code === "End" ? buttons.length - 1
      : (index + (event.code === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus({ preventScroll: true });
    buttons[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}
