import { localizationDiagnosticError } from "./diagnostics.js";

export type TextDirection = "ltr" | "rtl";
export type LocalizationPlaceholderValue = string | number | boolean;

export interface LocalizationStringEntrySpec {
  text: string;
  description?: string;
}

export type LocalizationStringSpec = string | LocalizationStringEntrySpec;

export interface LocalizationLocaleSpec {
  strings: Readonly<Record<string, LocalizationStringSpec>>;
  direction?: TextDirection;
}

export interface LocalizationDocumentSpec {
  defaultLocale: string;
  fallbackLocale?: string;
  locales: Readonly<Record<string, LocalizationLocaleSpec>>;
}

export interface ResolveLocalizationOptions {
  path?: string;
}

export interface ResolvedLocalizationString {
  key: string;
  text: string;
  description?: string;
}

export interface ResolvedLocalizationLocale {
  locale: string;
  direction: TextDirection;
  strings: Readonly<Record<string, ResolvedLocalizationString>>;
}

export interface ResolvedLocalizationDocument {
  defaultLocale: string;
  fallbackLocale: string;
  locales: Readonly<Record<string, ResolvedLocalizationLocale>>;
}

export type MissingLocalizationBehavior = "key" | "empty" | "fallback";

export interface LocalizeOptions {
  locale?: string;
  values?: Readonly<Record<string, LocalizationPlaceholderValue>>;
  fallback?: string;
  missing?: MissingLocalizationBehavior;
}

export interface LocalizedTextResult {
  key: string;
  locale: string;
  requestedLocale: string;
  text: string;
  fallbackUsed: boolean;
  missing: boolean;
  direction: TextDirection;
}

export interface TextLayoutOptions {
  maxCharsPerLine?: number;
  maxLines?: number;
  overflow?: "clip" | "ellipsis";
  direction?: TextDirection;
}

export interface TextLayoutLine {
  text: string;
}

export interface TextLayoutResult {
  text: string;
  direction: TextDirection;
  lines: readonly TextLayoutLine[];
  truncated: boolean;
}

export type FontDisplayPolicy = "auto" | "block" | "swap" | "fallback" | "optional";

export interface WebFontPolicySpec {
  family: string;
  sources?: readonly string[];
  weight?: string;
  style?: string;
  display?: FontDisplayPolicy;
  preload?: boolean;
}

export interface BitmapFontPolicySpec {
  image: string;
  data: string;
  family?: string;
  lineHeight?: number;
}

export interface FontLoadingPolicySpec {
  defaultFamily?: string;
  fallbackFamilies?: readonly string[];
  webFonts?: Readonly<Record<string, WebFontPolicySpec>>;
  bitmapFonts?: Readonly<Record<string, BitmapFontPolicySpec>>;
}

export interface ResolvedWebFontPolicy {
  id: string;
  family: string;
  sources: readonly string[];
  weight: string;
  style: string;
  display: FontDisplayPolicy;
  preload: boolean;
  cssFontFace: string;
  loadExpression: string;
}

export interface ResolvedBitmapFontPolicy {
  id: string;
  family: string;
  image: string;
  data: string;
  lineHeight?: number;
}

export interface ResolvedFontLoadingPolicy {
  defaultFamily: string;
  fallbackFamilies: readonly string[];
  cssFontFamily: string;
  webFonts: readonly ResolvedWebFontPolicy[];
  bitmapFonts: readonly ResolvedBitmapFontPolicy[];
  preloadUrls: readonly string[];
}

export interface FontFaceSetLike {
  load(font: string): Promise<unknown>;
}

export interface LoadFontPolicyResult {
  requested: number;
  loaded: number;
  failed: readonly { id: string; error: string }[];
}

const DEFAULT_FALLBACK_FAMILIES = ["ui-sans-serif", "system-ui", "sans-serif"] as const;
const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_.-]+)\}/g;

export function resolveLocalizationDocument(
  document: LocalizationDocumentSpec,
  options: ResolveLocalizationOptions = {},
): ResolvedLocalizationDocument {
  const path = options.path ?? "localization";
  if (!isRecord(document)) {
    throw invalid(path, "must be an object");
  }
  const input = document as LocalizationDocumentSpec;
  const defaultLocale = localeId(input.defaultLocale, `${path}.defaultLocale`);
  const fallbackLocale = localeId(input.fallbackLocale ?? defaultLocale, `${path}.fallbackLocale`);
  if (!isRecord(input.locales)) {
    throw invalid(`${path}.locales`, "must be an object");
  }

  const locales: Record<string, ResolvedLocalizationLocale> = {};
  for (const [locale, localeSpec] of Object.entries(input.locales)) {
    const localePath = `${path}.locales.${locale}`;
    locales[localeId(locale, localePath)] = resolveLocale(locale, localeSpec, localePath);
  }
  if (locales[defaultLocale] === undefined) {
    throw invalid(`${path}.defaultLocale`, `references missing locale '${defaultLocale}'`);
  }
  if (locales[fallbackLocale] === undefined) {
    throw invalid(`${path}.fallbackLocale`, `references missing locale '${fallbackLocale}'`);
  }

  return {
    defaultLocale,
    fallbackLocale,
    locales,
  };
}

export class LocalizationBundle {
  private readonly document: ResolvedLocalizationDocument;
  private activeLocale: string;

  constructor(document: LocalizationDocumentSpec | ResolvedLocalizationDocument, locale?: string) {
    this.document = isResolvedLocalizationDocument(document)
      ? document
      : resolveLocalizationDocument(document);
    this.activeLocale = this.resolveLocale(locale ?? this.document.defaultLocale);
  }

  static create(document: LocalizationDocumentSpec | ResolvedLocalizationDocument, locale?: string): LocalizationBundle {
    return new LocalizationBundle(document, locale);
  }

  setLocale(locale: string): void {
    this.activeLocale = this.resolveLocale(locale);
  }

  locale(): string {
    return this.activeLocale;
  }

  has(key: string, locale = this.activeLocale): boolean {
    const normalizedKey = stringKey(key, "localization key");
    return this.lookup(normalizedKey, locale).entry !== undefined;
  }

  t(key: string, options: LocalizeOptions = {}): string {
    return this.localize(key, options).text;
  }

  localize(key: string, options: LocalizeOptions = {}): LocalizedTextResult {
    const normalizedKey = stringKey(key, "localization key");
    const requestedLocale = options.locale ?? this.activeLocale;
    const lookup = this.lookup(normalizedKey, requestedLocale);
    if (lookup.entry !== undefined) {
      return {
        key: normalizedKey,
        locale: lookup.locale.locale,
        requestedLocale,
        text: interpolate(lookup.entry.text, options.values),
        fallbackUsed: lookup.locale.locale !== requestedLocale,
        missing: false,
        direction: lookup.locale.direction,
      };
    }

    const missing = options.missing ?? "key";
    const fallbackText = missing === "fallback"
      ? options.fallback ?? normalizedKey
      : missing === "empty"
        ? ""
        : normalizedKey;
    const locale = this.document.locales[this.resolveLocale(requestedLocale)];
    return {
      key: normalizedKey,
      locale: locale.locale,
      requestedLocale,
      text: interpolate(fallbackText, options.values),
      fallbackUsed: true,
      missing: true,
      direction: locale.direction,
    };
  }

  layout(key: string, options: LocalizeOptions & TextLayoutOptions = {}): TextLayoutResult {
    const localized = this.localize(key, options);
    return layoutLocalizedText(localized.text, {
      ...options,
      direction: options.direction ?? localized.direction,
    });
  }

  private lookup(
    key: string,
    requestedLocale: string,
  ): { locale: ResolvedLocalizationLocale; entry?: ResolvedLocalizationString } {
    const chain = localizationLocaleChain(this.document, requestedLocale);
    for (const localeIdValue of chain) {
      const locale = this.document.locales[localeIdValue];
      const entry = locale?.strings[key];
      if (locale !== undefined && entry !== undefined) {
        return { locale, entry };
      }
    }
    return { locale: this.document.locales[this.document.fallbackLocale] };
  }

  private resolveLocale(locale: string): string {
    return localizationLocaleChain(this.document, locale)[0] ?? this.document.fallbackLocale;
  }
}

export function localizationLocaleChain(
  document: ResolvedLocalizationDocument,
  locale: string,
): readonly string[] {
  const requested = normalizeLocale(locale);
  const language = requested.includes("-") ? requested.split("-")[0] : requested;
  const chain: string[] = [];
  appendExisting(requested);
  appendExisting(language);
  appendExisting(document.fallbackLocale);
  appendExisting(document.defaultLocale);
  return chain;

  function appendExisting(candidate: string): void {
    if (candidate.length > 0 && document.locales[candidate] !== undefined && !chain.includes(candidate)) {
      chain.push(candidate);
    }
  }
}

export function layoutLocalizedText(text: string, options: TextLayoutOptions = {}): TextLayoutResult {
  const maxCharsPerLine = positiveInteger(options.maxCharsPerLine, "text.maxCharsPerLine", Number.MAX_SAFE_INTEGER);
  const maxLines = positiveInteger(options.maxLines, "text.maxLines", Number.MAX_SAFE_INTEGER);
  const overflow = options.overflow ?? "clip";
  const direction = options.direction ?? "ltr";
  const words = splitWords(String(text));
  const lines: string[] = [];
  let current = "";
  let truncated = false;

  for (const word of words) {
    const candidates = word.length > maxCharsPerLine ? chunkText(word, maxCharsPerLine) : [word];
    for (const candidate of candidates) {
      const next = current.length === 0 ? candidate : `${current} ${candidate}`;
      if (Array.from(next).length <= maxCharsPerLine) {
        current = next;
        continue;
      }
      if (current.length > 0) {
        lines.push(current);
      }
      current = candidate;
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
    }
    if (truncated) {
      break;
    }
  }

  if (!truncated && current.length > 0) {
    lines.push(current);
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    truncated = true;
  }
  if (truncated && overflow === "ellipsis" && lines.length > 0) {
    lines[lines.length - 1] = ellipsize(lines[lines.length - 1], maxCharsPerLine);
  }

  return {
    text,
    direction,
    lines: lines.map((line) => ({ text: line })),
    truncated,
  };
}

export function resolveFontLoadingPolicy(
  spec: FontLoadingPolicySpec = {},
  options: ResolveLocalizationOptions = {},
): ResolvedFontLoadingPolicy {
  const path = options.path ?? "fontPolicy";
  if (!isRecord(spec)) {
    throw invalid(path, "must be an object");
  }
  const input = spec as FontLoadingPolicySpec;
  const defaultFamily = optionalString(input.defaultFamily, `${path}.defaultFamily`) ?? "Ferrum2D UI";
  const fallbackFamilies = input.fallbackFamilies === undefined
    ? [...DEFAULT_FALLBACK_FAMILIES]
    : input.fallbackFamilies.map((family, index) => stringKey(family, `${path}.fallbackFamilies.${index}`));
  const webFonts = resolveWebFonts(input.webFonts, `${path}.webFonts`);
  const bitmapFonts = resolveBitmapFonts(input.bitmapFonts, `${path}.bitmapFonts`);
  const preloadUrls = [
    ...webFonts.flatMap((font) => font.preload ? font.sources : []),
    ...bitmapFonts.flatMap((font) => [font.image, font.data]),
  ];
  return {
    defaultFamily,
    fallbackFamilies,
    cssFontFamily: [quoteCssFamily(defaultFamily), ...fallbackFamilies.map(quoteCssFamily)].join(", "),
    webFonts,
    bitmapFonts,
    preloadUrls,
  };
}

export async function loadFontLoadingPolicy(
  policy: ResolvedFontLoadingPolicy,
  fontFaceSet: FontFaceSetLike,
): Promise<LoadFontPolicyResult> {
  const preloadFonts = policy.webFonts.filter((font) => font.preload);
  const failed: { id: string; error: string }[] = [];
  let loaded = 0;
  for (const font of preloadFonts) {
    try {
      await fontFaceSet.load(font.loadExpression);
      loaded += 1;
    } catch (error) {
      failed.push({
        id: font.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    requested: preloadFonts.length,
    loaded,
    failed,
  };
}

function resolveLocale(locale: string, spec: LocalizationLocaleSpec, path: string): ResolvedLocalizationLocale {
  if (!isRecord(spec)) {
    throw invalid(path, "must be an object");
  }
  const input = spec as LocalizationLocaleSpec;
  if (!isRecord(input.strings)) {
    throw invalid(`${path}.strings`, "must be an object");
  }
  const strings: Record<string, ResolvedLocalizationString> = {};
  for (const [key, entry] of Object.entries(input.strings)) {
    strings[stringKey(key, `${path}.strings key`)] = resolveStringEntry(key, entry, `${path}.strings.${key}`);
  }
  return {
    locale: normalizeLocale(locale),
    direction: direction(input.direction, `${path}.direction`),
    strings,
  };
}

function resolveStringEntry(key: string, entry: LocalizationStringSpec, path: string): ResolvedLocalizationString {
  if (typeof entry === "string") {
    return { key, text: entry };
  }
  if (!isRecord(entry)) {
    throw invalid(path, "must be a string or object");
  }
  const input = entry as LocalizationStringEntrySpec;
  return {
    key,
    text: stringKey(input.text, `${path}.text`),
    ...(input.description === undefined ? {} : { description: stringKey(input.description, `${path}.description`) }),
  };
}

function resolveWebFonts(
  webFonts: Readonly<Record<string, WebFontPolicySpec>> | undefined,
  path: string,
): readonly ResolvedWebFontPolicy[] {
  if (webFonts === undefined) {
    return [];
  }
  if (!isRecord(webFonts)) {
    throw invalid(path, "must be an object");
  }
  return Object.entries(webFonts).map(([id, spec]) => {
    if (!isRecord(spec)) {
      throw invalid(`${path}.${id}`, "must be an object");
    }
    const input = spec as WebFontPolicySpec;
    const family = stringKey(input.family, `${path}.${id}.family`);
    const sources = input.sources === undefined
      ? []
      : input.sources.map((source, index) => stringKey(source, `${path}.${id}.sources.${index}`));
    const weight = optionalString(input.weight, `${path}.${id}.weight`) ?? "400";
    const style = optionalString(input.style, `${path}.${id}.style`) ?? "normal";
    const display = fontDisplay(input.display, `${path}.${id}.display`);
    return {
      id: stringKey(id, `${path} key`),
      family,
      sources,
      weight,
      style,
      display,
      preload: input.preload ?? sources.length > 0,
      cssFontFace: cssFontFace(family, sources, weight, style, display),
      loadExpression: `${style} ${weight} 16px ${quoteCssFamily(family)}`,
    };
  });
}

function resolveBitmapFonts(
  bitmapFonts: Readonly<Record<string, BitmapFontPolicySpec>> | undefined,
  path: string,
): readonly ResolvedBitmapFontPolicy[] {
  if (bitmapFonts === undefined) {
    return [];
  }
  if (!isRecord(bitmapFonts)) {
    throw invalid(path, "must be an object");
  }
  return Object.entries(bitmapFonts).map(([id, spec]) => {
    if (!isRecord(spec)) {
      throw invalid(`${path}.${id}`, "must be an object");
    }
    const input = spec as BitmapFontPolicySpec;
    return {
      id: stringKey(id, `${path} key`),
      family: optionalString(input.family, `${path}.${id}.family`) ?? id,
      image: stringKey(input.image, `${path}.${id}.image`),
      data: stringKey(input.data, `${path}.${id}.data`),
      ...(input.lineHeight === undefined
        ? {}
        : { lineHeight: positiveFinite(input.lineHeight, `${path}.${id}.lineHeight`) }),
    };
  });
}

function interpolate(text: string, values: Readonly<Record<string, LocalizationPlaceholderValue>> | undefined): string {
  if (values === undefined) {
    return text;
  }
  return text.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

function splitWords(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    return words;
  }
  return words;
}

function chunkText(text: string, maxChars: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += maxChars) {
    chunks.push(chars.slice(index, index + maxChars).join(""));
  }
  return chunks;
}

function ellipsize(text: string, maxChars: number): string {
  if (maxChars <= 1) {
    return ".";
  }
  const chars = Array.from(text);
  if (chars.length < maxChars) {
    return `${text}.`;
  }
  return `${chars.slice(0, maxChars - 1).join("")}.`;
}

function cssFontFace(
  family: string,
  sources: readonly string[],
  weight: string,
  style: string,
  display: FontDisplayPolicy,
): string {
  const source = sources.length === 0
    ? ""
    : `src: ${sources.map((url) => `url("${url.replace(/"/g, "\\\"")}")`).join(", ")};`;
  return `@font-face { font-family: ${quoteCssFamily(family)}; ${source} font-weight: ${weight}; font-style: ${style}; font-display: ${display}; }`;
}

function quoteCssFamily(family: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(family) ? family : `"${family.replace(/"/g, "\\\"")}"`;
}

function isResolvedLocalizationDocument(value: unknown): value is ResolvedLocalizationDocument {
  if (
    !isRecord(value)
    || typeof value.defaultLocale !== "string"
    || typeof value.fallbackLocale !== "string"
    || !isRecord(value.locales)
  ) {
    return false;
  }
  return Object.values(value.locales).every((locale) => (
    isRecord(locale)
    && typeof locale.locale === "string"
    && isRecord(locale.strings)
  ));
}

function localeId(value: unknown, path: string): string {
  return normalizeLocale(stringKey(value, path));
}

function normalizeLocale(value: string): string {
  return value.trim().replace(/_/g, "-");
}

function stringKey(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, "must be a non-empty string");
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return stringKey(value, path);
}

function direction(value: unknown, path: string): TextDirection {
  if (value === undefined) {
    return "ltr";
  }
  if (value === "ltr" || value === "rtl") {
    return value;
  }
  throw invalid(path, "must be ltr or rtl");
}

function fontDisplay(value: unknown, path: string): FontDisplayPolicy {
  if (value === undefined) {
    return "swap";
  }
  if (value === "auto" || value === "block" || value === "swap" || value === "fallback" || value === "optional") {
    return value;
  }
  throw invalid(path, "must be auto, block, swap, fallback, or optional");
}

function positiveInteger(value: number | undefined, path: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw invalid(path, "must be a positive integer");
  }
  return value;
}

function positiveFinite(value: number, path: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw invalid(path, "must be a positive finite number");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, detail: string): Error {
  return localizationDiagnosticError(path, detail);
}
