import { createPlacementControlMenu } from "./placementControlMenu";
import type { PlacementCommand } from "./placementCommandPalette";
import { setUiText } from "./placementLocale";

/** `a|b` shows the first enabled command, so scene and pixel history share one entry. */
type MenuGroups = readonly (readonly string[])[];
const FILE_GROUPS: MenuGroups = [["save", "export"]];
const MENUS: readonly (readonly [string, string, "file" | "layout" | "plus" | "view", MenuGroups])[] = [
  ["edit", "Edit", "file", [["pixel-undo|undo", "pixel-redo|redo"], ["duplicate-selected", "remove-selected"]]],
  ["window", "Window", "layout", [["objects", "project-scenes", "properties", "lighting"], ["assets", "problems", "runtime"], ["layout-custom", "layout-scene", "layout-assets", "layout-review"], ["focus-view", "reset-layout"]]],
  ["tools", "Tools", "plus", [["new-pixel", "open-pixel"], ["asset-aseprite", "asset-tile", "asset-model", "asset-normal"], ["asset-usage", "asset-cleanup", "asset-changes"]]],
  ["run", "Run", "view", [["play", "stop"], ["view-2d", "view-hd2d", "view-game"], ["game-camera"]]],
];

/** Classic menus are adapters over palette commands; controls keep their owners. */
export function installPlacementMenuBar(bar: HTMLElement, options: { commands(): readonly PlacementCommand[]; canOpen(): boolean }) {
  function bind(panel: HTMLElement, summary: HTMLElement, groups: MenuGroups, close: (restoreFocus?: boolean) => void) {
    const items = document.createElement("div");
    items.className = "placement-menu-items";
    items.setAttribute("role", "menu");
    panel.querySelector(":scope > strong")?.after(items);
    function render() {
      const commands = new Map(options.commands().map(command => [command.id, command])), allowed = options.canOpen();
      items.replaceChildren();
      for (const group of groups) {
        const resolved = group.flatMap(entry => {
          const choices = entry.split("|").flatMap(id => commands.get(id) ?? []);
          return choices.find(command => command.enabled()) ?? choices.at(-1) ?? [];
        });
        if (!resolved.length) continue;
        if (items.childElementCount) items.append(Object.assign(document.createElement("hr"), { className: "placement-menu-separator" }));
        for (const command of resolved) {
          const button = document.createElement("button"), label = document.createElement("span"), key = document.createElement("kbd");
          button.type = "button";
          button.setAttribute("role", "menuitem");
          button.dataset.placementMenuCommand = command.id;
          button.disabled = !allowed || !command.enabled();
          setUiText(label, command.label);
          key.textContent = command.shortcut ?? "";
          button.append(label, key);
          button.addEventListener("click", () => { close(); command.run(); });
          items.append(button);
        }
      }
    }
    // Capture so the panel is measured with its current items.
    summary.addEventListener("click", render, true);
  }
  const file = bar.querySelector<HTMLDetailsElement>('[data-placement-menu="file"]');
  const fileSummary = file?.querySelector<HTMLElement>(":scope > summary"), filePanel = file?.querySelector<HTMLElement>(":scope > .placement-control-panel");
  if (file && fileSummary && filePanel) bind(filePanel, fileSummary, FILE_GROUPS, () => { file.open = false; });
  const anchor = file?.nextElementSibling ?? null;
  for (const [id, label, icon, groups] of MENUS) {
    const menu = createPlacementControlMenu(id, label, icon);
    bind(menu.panel, menu.summary, groups, menu.close);
    bar.insertBefore(menu.element, id === "edit" ? anchor : bar.querySelector('[data-placement-menu="help"]'));
  }
  const entries = () => [...bar.querySelectorAll<HTMLDetailsElement>(":scope > details")].filter(entry => entry.checkVisibility());
  const summaryOf = (entry: HTMLDetailsElement) => entry.querySelector<HTMLElement>(":scope > summary")!;
  function switchTo(target: HTMLDetailsElement) {
    for (const entry of entries()) if (entry !== target && entry.open) entry.open = false;
    if (!target.open) summaryOf(target).click();
  }
  // Once a menu is open, moving across the bar switches menus like a desktop menu bar.
  bar.addEventListener("pointerover", event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLDetailsElement>("summary")?.parentElement : undefined;
    if (target instanceof HTMLDetailsElement && target.parentElement === bar && !target.open && entries().some(entry => entry.open)) switchTo(target);
  });
  bar.addEventListener("keydown", event => {
    if (!(event.target instanceof HTMLElement)) return;
    const list = event.target.closest<HTMLElement>(".placement-menu-items");
    if (list && (event.code === "ArrowDown" || event.code === "ArrowUp")) {
      const buttons = [...list.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const next = buttons.indexOf(event.target as HTMLButtonElement) + (event.code === "ArrowDown" ? 1 : -1);
      buttons[(next + buttons.length) % buttons.length]?.focus();
      event.preventDefault(); event.stopPropagation();
      return;
    }
    if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;
    if (event.target.matches("input, select, textarea")) return;
    const all = entries(), current = all.findIndex(entry => entry.contains(event.target as Node));
    if (current < 0) return;
    const target = all[(current + (event.code === "ArrowRight" ? 1 : -1) + all.length) % all.length]!;
    const wasOpen = all[current]!.open;
    event.preventDefault(); event.stopPropagation();
    if (wasOpen) switchTo(target);
    summaryOf(target).focus({ preventScroll: true });
  });
}
