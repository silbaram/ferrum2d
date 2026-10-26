import { setUiAttribute, setUiText } from "./placementLocale";
import { decorateViewportAction, type ViewportIcon } from "./placementViewportChrome";

/** A disclosure for mixed controls; native form keys remain available inside. */
export function createPlacementControlMenu(id: string, label: string, icon: ViewportIcon) {
  const element = document.createElement("details"),
    summary = document.createElement("summary"),
    panel = document.createElement("div"),
    heading = document.createElement("strong");
  const lifetime = new AbortController();
  element.className = "placement-control-menu";
  element.dataset.placementMenu = id;
  summary.setAttribute("role", "button");
  summary.setAttribute("aria-expanded", "false");
  summary.setAttribute("aria-controls", `placement-menu-${id}`);
  decorateViewportAction(summary, icon, label);
  const caret = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  caret.setAttribute("viewBox", "0 0 16 16");
  caret.setAttribute("aria-hidden", "true");
  caret.classList.add("placement-disclosure-caret");
  caret.innerHTML = '<path d="m4 6 4 4 4-4"/>';
  summary.append(caret);
  panel.id = `placement-menu-${id}`;
  panel.className = "placement-control-panel";
  panel.setAttribute("role", "group");
  setUiAttribute(panel, "aria-label", label);
  setUiText(heading, label);
  panel.append(heading);
  element.append(summary, panel);
  let anchor: DOMRect | undefined;
  function position() {
    if (!element.open) return;
    const rect = summary.getBoundingClientRect();
    anchor = rect;
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`;
    const below = innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < 160 && above > below;
    panel.style.maxHeight = `${Math.max(0, upward ? above : below)}px`;
    panel.style.top = `${upward ? Math.max(8, rect.top - panel.offsetHeight - 4) : rect.bottom + 4}px`;
  }
  function close(restoreFocus = false) {
    if (!element.open) return;
    element.open = false;
    summary.setAttribute("aria-expanded", "false");
    if (restoreFocus) summary.focus({ preventScroll: true });
  }
  summary.addEventListener("click", (event) => {
    event.preventDefault();
    element.open = !element.open;
    summary.setAttribute("aria-expanded", String(element.open));
    position();
  });
  summary.addEventListener("keydown", (event) => {
    if (event.code === "Enter" || event.code === "Space") {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) summary.click();
    } else if (event.code === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      if (!element.open) summary.click();
      panel.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus();
    }
  });
  element.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(element.open));
    position();
  });
  element.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || !element.open) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  });
  const dismissOutside = (event: Event) => {
    if (event.target instanceof Node && !element.contains(event.target)) close();
  };
  document.addEventListener("pointerdown", dismissOutside, { capture: true, signal: lifetime.signal });
  document.addEventListener("focusin", dismissOutside, { signal: lifetime.signal });
  document.addEventListener("scroll", (event) => {
    if (!element.open || !anchor || !(event.target instanceof Node) || !event.target.contains(summary)) return;
    const rect = summary.getBoundingClientRect();
    // Ignore a scroll queued before opening, and scrolling inside the panel.
    if (rect.left !== anchor.left || rect.top !== anchor.top) close();
  }, { capture: true, passive: true, signal: lifetime.signal });
  // Close on viewport changes rather than leaving a clipped, stale popover.
  window.addEventListener("resize", () => close(), { signal: lifetime.signal });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) lifetime.abort();
  }, { signal: lifetime.signal });
  return { element, summary, panel, close };
}
