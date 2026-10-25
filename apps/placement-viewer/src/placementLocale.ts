import { koreanMessages } from "./placementLocaleMessages";

export type PlacementLocale = "en" | "ko";
export type UiContent = string | UiMessage;
const UI_MESSAGE = Symbol("placement-ui-message");
export interface UiMessage {
  readonly [UI_MESSAGE]: true;
  readonly key: string;
  readonly values: readonly unknown[];
}
export const LOCALE_STORAGE_KEY = "ferrum.placement.locale.v1";

/** Parameters are data. Only explicitly nested messages are translated. */
export function uiMessage(key: string, ...values: unknown[]): UiMessage {
  return { [UI_MESSAGE]: true, key, values };
}
export function formatUi(
  content: UiContent,
  language: PlacementLocale,
): string {
  const message = typeof content === "string" ? uiMessage(content) : content;
  const source =
    language === "ko" && Object.hasOwn(koreanMessages, message.key)
      ? koreanMessages[message.key]
      : message.key;
  return source.replace(/\{(\d+)\}/g, (token, index: string) => {
    if (Number(index) >= message.values.length) return token;
    const value = message.values[Number(index)];
    return isUiMessage(value) ? formatUi(value, language) : String(value ?? "");
  });
}
export function isUiMessage(value: unknown): value is UiMessage {
  return typeof value === "object" && value !== null && UI_MESSAGE in value;
}
export function preferredLocale(
  saved: string | null,
  languages: readonly string[],
): PlacementLocale {
  if (saved === "en" || saved === "ko") return saved;
  return /^ko(?:-|$)/i.test(languages[0] ?? "") ? "ko" : "en";
}
let locale: PlacementLocale = "en";
try {
  locale = preferredLocale(
    localStorage.getItem(LOCALE_STORAGE_KEY),
    navigator.languages,
  );
} catch {
  if (typeof navigator !== "undefined")
    locale = preferredLocale(null, navigator.languages);
}
const texts = new WeakMap<Text, UiContent>();
const attributes = new WeakMap<Element, Map<string, UiContent>>();
const roots = new Set<WeakRef<HTMLElement>>();
const registeredRoots = new WeakSet<HTMLElement>();
const listeners = new Set<() => void>();
export const placementLocale = () => locale;
export const translateUi = (content: UiContent) => formatUi(content, locale);

export function uiText(content: UiContent): Text {
  const node = document.createTextNode(translateUi(content));
  texts.set(node, content);
  return node;
}
export function uiOption(content: UiContent, value: string): HTMLOptionElement {
  const option = new Option("", value);
  setUiText(option, content);
  return option;
}
export function setUiText(element: Element, content: UiContent): void {
  const rendered = translateUi(content);
  const child = element.firstChild;
  if (element.childNodes.length === 1 && child instanceof Text) {
    texts.set(child, content);
    if (child.data !== rendered) child.data = rendered;
  } else element.replaceChildren(uiText(content));
}
export function setUiAttribute(
  element: Element,
  attribute: string,
  content: UiContent,
): void {
  let bindings = attributes.get(element);
  if (!bindings) attributes.set(element, (bindings = new Map()));
  bindings.set(attribute, content);
  const rendered = translateUi(content);
  if (element.getAttribute(attribute) !== rendered)
    element.setAttribute(attribute, rendered);
}
/** Read a presentation binding, without using its already translated text as a key. */
export function uiContent(element: Element): UiContent {
  const child = element.firstChild;
  return child instanceof Text
    ? (texts.get(child) ?? child.data)
    : (element.textContent ?? "");
}
export function refreshUi(root: HTMLElement): void {
  const walk = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = root;
  while (node) {
    if (node instanceof Text) {
      const content = texts.get(node);
      if (content !== undefined) {
        const rendered = translateUi(content);
        if (node.data !== rendered) node.data = rendered;
      }
    } else if (node instanceof Element) {
      for (const [attribute, content] of attributes.get(node) ?? []) {
        node.setAttribute(attribute, translateUi(content));
      }
    }
    node = walk.nextNode();
  }
}
/** Roots include cached, detached document inspectors. Weak ownership permits normal tab cleanup. */
export function registerUiRoot(root: HTMLElement): void {
  if (registeredRoots.has(root)) return;
  registeredRoots.add(root);
  roots.add(new WeakRef(root));
}
export function setPlacementLocale(next: PlacementLocale): void {
  locale = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    /* UI remains usable without storage. */
  }
  for (const ref of roots) {
    const root = ref.deref();
    if (root) refreshUi(root);
    else roots.delete(ref);
  }
  for (const listener of listeners) listener();
}
export function onPlacementLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function installPlacementLanguage(toolbar: HTMLElement): () => void {
  const label = document.createElement("label"),
    select = document.createElement("select");
  label.className = "placement-language";
  label.append(uiText("Language"), select);
  select.dataset.placementLanguage = "true";
  select.setAttribute("aria-label", "Language / 언어");
  select.add(new Option("한국어", "ko"));
  select.add(new Option("English", "en"));
  select.value = locale;
  select.addEventListener("change", () => {
    if (select.value === "en" || select.value === "ko")
      setPlacementLocale(select.value);
  });
  // Keep the selector inside the existing action cell of the three-column toolbar.
  (toolbar.querySelector(".demo-actions") ?? toolbar).append(label);
  document.documentElement.lang = locale;
  registerUiRoot(document.body);
  const unsubscribe = onPlacementLocaleChange(() => (select.value = locale));
  return () => {
    unsubscribe();
    label.remove();
  };
}
