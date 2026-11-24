export type SiteLocale = "ko" | "en";
export type LocalizedText = Readonly<Record<SiteLocale, string>>;
type UiText = string | LocalizedText;

const storageKey = "ferrum.examples.locale.v1";

function initialLocale(): SiteLocale {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "ko" || saved === "en") return saved;
  } catch { /* Language selection still works without storage. */ }
  return /^ko(?:-|$)/i.test(navigator.language) ? "ko" : "en";
}

let locale = initialLocale();
document.documentElement.lang = locale;

export const siteLocale = () => locale;
export const translate = (text: LocalizedText) => text[locale];

const texts = new WeakMap<Text, LocalizedText>();
const attributes = new WeakMap<Element, Map<string, LocalizedText>>();

export function setUiText(node: Text, text: UiText): void {
  if (typeof text === "string") {
    texts.delete(node);
    node.data = text;
  } else {
    texts.set(node, text);
    node.data = translate(text);
  }
}

export function uiText(text: LocalizedText): Text {
  const node = document.createTextNode("");
  setUiText(node, text);
  return node;
}

export function uiAttribute(node: Element, name: string, text: LocalizedText): void {
  let bindings = attributes.get(node);
  if (!bindings) attributes.set(node, bindings = new Map());
  bindings.set(name, text);
  node.setAttribute(name, translate(text));
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: UiText): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof text === "string") node.textContent = text;
  else if (text) node.append(uiText(text));
  return node;
}

export function setSiteLocale(next: SiteLocale): void {
  if (next === locale) return;
  locale = next;
  document.documentElement.lang = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Optional preference. */ }

  // Refresh live text and attributes in place so controls, focus and running examples survive.
  const walk = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (node instanceof Text) {
      const text = texts.get(node);
      if (text) node.data = translate(text);
    } else if (node instanceof Element) {
      for (const [name, text] of attributes.get(node) ?? []) node.setAttribute(name, translate(text));
    }
  }
}
