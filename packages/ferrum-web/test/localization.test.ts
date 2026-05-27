import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  LocalizationBundle,
  layoutLocalizedText,
  loadFontLoadingPolicy,
  localizationLocaleChain,
  resolveFontLoadingPolicy,
  resolveLocalizationDocument,
} from "../src/localization.js";

const document = {
  defaultLocale: "en",
  fallbackLocale: "en",
  locales: {
    en: {
      strings: {
        start: "Start",
        greeting: "Hello, {name}",
        wrapped: "Agent friendly game engine text layout",
      },
    },
    ko: {
      strings: {
        start: "시작",
      },
    },
  },
};

test("LocalizationBundle resolves locale fallback and placeholders", () => {
  const localization = new LocalizationBundle(document, "ko-KR");
  equal(localization.locale(), "ko");
  equal(localization.t("start"), "시작");
  equal(localization.t("greeting", { values: { name: "Ferrum" } }), "Hello, Ferrum");

  const missing = localization.localize("missing", {
    fallback: "Missing {name}",
    missing: "fallback",
    values: { name: "copy" },
  });
  equal(missing.text, "Missing copy");
  equal(missing.missing, true);
  equal(missing.fallbackUsed, true);
});

test("resolveLocalizationDocument validates default and fallback locales", () => {
  const resolved = resolveLocalizationDocument(document);
  deepEqual(localizationLocaleChain(resolved, "ko-KR"), ["ko", "en"]);
  expectThrows(
    () => resolveLocalizationDocument({ defaultLocale: "fr", locales: { en: { strings: {} } } }),
    /Invalid localization config: kind=localization path='localization\.defaultLocale'/,
  );
});

test("layoutLocalizedText wraps text and marks truncation", () => {
  const layout = layoutLocalizedText("alpha beta gamma delta", {
    maxCharsPerLine: 10,
    maxLines: 2,
    overflow: "ellipsis",
  });
  deepEqual(layout.lines.map((line) => line.text), ["alpha beta", "gamma."]);
  equal(layout.truncated, true);
});

test("resolveFontLoadingPolicy builds CSS and preload policy", async () => {
  const policy = resolveFontLoadingPolicy({
    defaultFamily: "Ferrum UI",
    fallbackFamilies: ["system-ui", "sans-serif"],
    webFonts: {
      ui: {
        family: "Ferrum UI",
        sources: ["/fonts/ferrum.woff2"],
        weight: "700",
        display: "swap",
      },
    },
    bitmapFonts: {
      pixel: {
        image: "/fonts/pixel.png",
        data: "/fonts/pixel.json",
        lineHeight: 12,
      },
    },
  });

  equal(policy.cssFontFamily, "\"Ferrum UI\", system-ui, sans-serif");
  equal(policy.webFonts[0].loadExpression, "normal 700 16px \"Ferrum UI\"");
  deepEqual(policy.preloadUrls, ["/fonts/ferrum.woff2", "/fonts/pixel.png", "/fonts/pixel.json"]);

  const requested: string[] = [];
  const result = await loadFontLoadingPolicy(policy, {
    load: async (expression) => {
      requested.push(expression);
      return [];
    },
  });
  equal(result.requested, 1);
  equal(result.loaded, 1);
  equal(result.failed.length, 0);
  equal(requested[0], "normal 700 16px \"Ferrum UI\"");
  ok(policy.webFonts[0].cssFontFace.includes("font-display: swap"));
});

function expectThrows(callback: () => void, pattern: RegExp): void {
  try {
    callback();
  } catch (error) {
    ok(pattern.test(error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error("Expected callback to throw.");
}
