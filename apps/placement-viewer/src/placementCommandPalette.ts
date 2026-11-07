import { decorateViewportAction } from "./placementViewportChrome";
import { commandSearchShortcut, isCommandSearchShortcut, isMacPlatform } from "./placementKeyHints";
import { formatUi, onPlacementLocaleChange, registerUiRoot, setUiAttribute, setUiText, uiMessage, type UiContent } from "./placementLocale";

export interface PlacementCommand {
  id: string;
  label: UiContent;
  category: UiContent;
  keywords?: readonly string[];
  shortcut?: string;
  enabled(): boolean;
  run(): void;
}
const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().trim();
/** Bilingual metadata search. It never reads or serializes authored documents. */
export function searchPlacementCommands(commands: readonly PlacementCommand[], query: string): PlacementCommand[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return commands.map((command, index) => {
    const names = [formatUi(command.label, "en"), formatUi(command.label, "ko")].map(normalize);
    const haystack = normalize([...names, formatUi(command.category, "en"), formatUi(command.category, "ko"), ...(command.keywords ?? [])].join(" "));
    return { command, index, matches: words.every(word => haystack.includes(word)), prefix: words.length > 0 && names.some(name => name.startsWith(words.join(" "))) };
  }).filter(result => result.matches).sort((a, b) => Number(b.prefix) - Number(a.prefix) || a.index - b.index).map(result => result.command);
}

/** An app-local action picker. Execution and authoring state remain with existing owners. */
export function createPlacementCommandPalette(options: {
  root: HTMLElement;
  commands(): readonly PlacementCommand[];
  canOpen(): boolean;
  context(): string;
}) {
  const button = document.createElement("button"); button.type = "button";
  button.dataset.placementCommandSearch = "true";
  const mac = isMacPlatform();
  decorateViewportAction(button, "search", "Search Commands", `${commandSearchShortcut(mac)} · F3`, true);
  const dialog = document.createElement("dialog"); dialog.className = "placement-command-palette";
  dialog.id = "placement-command-palette";
  button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-controls", dialog.id);
  dialog.dataset.placementCommandPalette = "true";
  setUiAttribute(dialog, "aria-label", "Search Commands");
  const title = document.createElement("strong"), closeButton = document.createElement("button"); closeButton.type = "button";
  setUiText(title, "Search Commands"); decorateViewportAction(closeButton, "close", "Close", undefined, true);
  const header = document.createElement("div"); header.className = "placement-command-header"; header.append(title, closeButton);
  const input = document.createElement("input"); input.type = "search"; input.autocomplete = "off"; input.spellcheck = false;
  input.dataset.placementCommandQuery = "true"; input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-expanded", "false");
  setUiAttribute(input, "aria-label", "Search Commands"); setUiAttribute(input, "placeholder", "Search tools, views and panels");
  const list = document.createElement("div"); list.id = "placement-command-results"; list.setAttribute("role", "listbox");
  setUiAttribute(list, "aria-label", "Commands"); input.setAttribute("aria-controls", list.id);
  const status = document.createElement("output"); status.setAttribute("role", "status"); status.dataset.placementCommandStatus = "true";
  const hint = document.createElement("p"); setUiText(hint, "Arrows to choose · Enter to run · Escape to close");
  dialog.append(header, input, list, status, hint); document.body.append(dialog); registerUiRoot(dialog);
  const lifetime = new AbortController();
  let disposed = false, openedContext = "", returnFocus: HTMLElement | undefined, active = -1, composing = false;
  let results: PlacementCommand[] = [];
  const otherModal = () => [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].some(value => value !== dialog);
  const available = (command: PlacementCommand) => options.canOpen() && options.context() === openedContext && command.enabled();
  function paintActive() {
    for (const [index, row] of [...list.children].entries()) row.setAttribute("aria-selected", String(index === active));
    if (active >= 0 && list.children[active]) {
      input.setAttribute("aria-activedescendant", list.children[active].id);
      list.children[active].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function render() {
    results = searchPlacementCommands(options.commands(), input.value);
    list.replaceChildren(); active = results.findIndex(available);
    for (const [index, command] of results.entries()) {
      const row = document.createElement("div"); row.id = `placement-command-${index}`; row.setAttribute("role", "option");
      row.dataset.placementCommand = command.id; row.setAttribute("aria-disabled", String(!available(command)));
      const label = document.createElement("span"), category = document.createElement("small"), key = document.createElement("kbd");
      setUiText(label, command.label); setUiText(category, command.category); key.textContent = command.shortcut ?? "";
      row.append(label, category, key);
      row.addEventListener("pointerdown", event => event.preventDefault());
      row.addEventListener("pointermove", () => { if (available(command) && active !== index) { active = index; paintActive(); } });
      row.addEventListener("click", () => execute(command.id)); list.append(row);
    }
    setUiText(status, results.length ? active < 0 ? "Command unavailable in the current state" : uiMessage("{0} commands", results.length) : "No matching commands");
    paintActive();
  }
  function close(restoreFocus = true) {
    if (!dialog.open) return;
    dialog.close(); input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
    results = []; list.replaceChildren(); input.value = ""; active = -1; composing = false;
    if (restoreFocus && returnFocus?.isConnected && !returnFocus.closest("[inert]")) returnFocus.focus({ preventScroll: true });
    returnFocus = undefined;
  }
  function execute(id: string) {
    const command = options.commands().find(value => value.id === id);
    if (!command || !available(command) || otherModal()) { render(); setUiText(status, "Command unavailable in the current state"); return; }
    // Close before dispatch: native modal inertness must not block the original control.
    close(false); if (available(command) && !otherModal()) command.run();
  }
  function open() {
    if (disposed || !options.canOpen() || otherModal()) return;
    if (dialog.open) { input.focus(); return; }
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    openedContext = options.context(); input.value = "";
    dialog.showModal(); input.setAttribute("aria-expanded", "true"); render(); input.focus();
  }
  button.onclick = open; closeButton.onclick = () => close();
  input.addEventListener("input", render);
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; render(); });
  dialog.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.isComposing || composing) return;
    if (event.code === "Escape") { event.preventDefault(); close(); }
    if (event.code === "Enter" && event.target === input) { event.preventDefault(); if (!event.repeat && active >= 0) execute(results[active].id); }
    if ((event.code === "ArrowDown" || event.code === "ArrowUp") && event.target === input) {
      event.preventDefault(); const enabled = results.map((command, index) => available(command) ? index : -1).filter(index => index >= 0);
      if (!enabled.length) return;
      const current = enabled.indexOf(active), direction = event.code === "ArrowDown" ? 1 : -1;
      active = enabled[current < 0 ? (direction > 0 ? 0 : enabled.length - 1) : (current + direction + enabled.length) % enabled.length]; paintActive();
    }
  });
  dialog.addEventListener("cancel", event => { event.preventDefault(); if (!composing) close(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
  window.addEventListener("keydown", event => {
    const f3 = event.code === "F3" && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!(f3 || isCommandSearchShortcut(event, mac)) || event.isComposing || event.repeat || composing) return;
    if (!options.root.isConnected || !options.canOpen() || otherModal()) return;
    event.preventDefault(); event.stopImmediatePropagation(); open();
  }, { capture: true, signal: lifetime.signal });
  window.addEventListener("blur", () => close(false), { signal: lifetime.signal });
  document.addEventListener("visibilitychange", () => { if (document.hidden) close(false); }, { signal: lifetime.signal });
  const unsubscribe = onPlacementLocaleChange(() => { if (dialog.open) render(); });
  const observer = new MutationObserver(() => { if (dialog.open && (options.root.inert || options.context() !== openedContext)) close(false); });
  observer.observe(options.root, { attributes: true, attributeFilter: ["inert"] });
  function destroy() { if (disposed) return; disposed = true; close(false); lifetime.abort(); unsubscribe(); observer.disconnect(); dialog.remove(); button.remove(); }
  window.addEventListener("pagehide", event => { if (!event.persisted) destroy(); }, { signal: lifetime.signal });
  return { button, open, close, destroy };
}
