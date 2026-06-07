#!/usr/bin/env node
import {
  LocalizationBundle,
  layoutLocalizedText,
  loadFontLoadingPolicy,
  resolveFontLoadingPolicy,
} from "../../packages/ferrum-web/dist/index.js";

const localization = new LocalizationBundle({
  defaultLocale: "en",
  fallbackLocale: "en",
  locales: {
    en: {
      strings: {
        greeting: "Hello, {name}",
        title: "Agent friendly runtime text",
      },
    },
    ko: {
      strings: {
        greeting: "안녕하세요, {name}",
      },
    },
  },
}, "ko-KR");

const greeting = localization.t("greeting", { values: { name: "Ferrum2D" } });
const title = localization.t("title");
if (greeting !== "안녕하세요, Ferrum2D" || title !== "Agent friendly runtime text") {
  throw new Error(`localization fallback failed: ${JSON.stringify({ greeting, title })}`);
}

const layout = layoutLocalizedText(title, { maxCharsPerLine: 14, maxLines: 1, overflow: "ellipsis" });
if (layout.lines.length !== 1 || !layout.truncated) {
  throw new Error(`text layout did not wrap and truncate: ${JSON.stringify(layout)}`);
}

const fontPolicy = resolveFontLoadingPolicy({
  defaultFamily: "Ferrum UI",
  webFonts: {
    ui: { family: "Ferrum UI", sources: ["/fonts/ferrum-ui.woff2"] },
  },
  bitmapFonts: {
    pixel: { image: "/fonts/pixel.png", data: "/fonts/pixel.json" },
  },
});
const loadResult = await loadFontLoadingPolicy(fontPolicy, {
  load: async () => [],
});
if (loadResult.loaded !== 1 || fontPolicy.preloadUrls.length !== 3) {
  throw new Error(`font loading policy failed: ${JSON.stringify({ loadResult, fontPolicy })}`);
}

console.log(JSON.stringify({
  localizationSmoke: {
    locale: localization.locale(),
    greeting,
    title,
    lines: layout.lines.map((line) => line.text),
    fontPreloadCount: fontPolicy.preloadUrls.length,
    loadedFonts: loadResult.loaded,
  },
}, null, 2));
