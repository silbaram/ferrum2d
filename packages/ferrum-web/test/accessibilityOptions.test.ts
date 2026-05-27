import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  accessibilitySubtitlePanel,
  applyAccessibilityToCameraRigSpec,
  applyAccessibilityToScreenFadeSpec,
  readAccessibilityEnvironment,
  resolveAccessibilityHudTheme,
  resolveAccessibilityOptions,
} from "../src/accessibilityOptions.js";

test("resolveAccessibilityOptions applies system reduced motion and contrast palette", () => {
  const env = readAccessibilityEnvironment({
    matchMedia: (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }),
  });
  const options = resolveAccessibilityOptions({
    reducedMotion: "system",
    contrastPalette: "high-contrast",
    inputAssist: { holdToToggleActions: ["fire", "fire"], minimumTouchTargetPx: 48 },
  }, { environment: env });

  equal(options.reducedMotion, true);
  equal(options.subtitles, true);
  equal(options.inputAssist.holdToToggleActions.length, 1);
  equal(options.inputAssist.minimumTouchTargetPx, 48);
  equal(options.contrastPalette.hudTheme.panelBackground, "#000000");
  equal(resolveAccessibilityHudTheme(options).panelBorder, "#ffffff");
});

test("accessibility helpers reduce camera and screen transition motion", () => {
  const accessibility = resolveAccessibilityOptions({ reducedMotion: true });
  const camera = applyAccessibilityToCameraRigSpec({ smoothTimeSeconds: 0.4, x: 10 }, accessibility);
  const fade = applyAccessibilityToScreenFadeSpec({ durationSeconds: 1.2, toOpacity: 0.25 }, accessibility);

  equal(camera.smoothTimeSeconds, 0);
  equal(camera.x, 10);
  equal(fade.durationSeconds, 0);
  equal(fade.toOpacity, 0.25);
});

test("accessibilitySubtitlePanel honors subtitle toggle", () => {
  const hidden = accessibilitySubtitlePanel(
    { speaker: "Guide", text: "Move carefully." },
    { accessibility: { subtitles: false } },
  );
  const visible = accessibilitySubtitlePanel(
    { id: "intro-subtitle", speaker: "Guide", text: "Move carefully.", region: "bottom-right" },
    { title: "Captions", accessibility: { subtitles: true } },
  );

  equal(hidden, undefined);
  equal(visible?.id, "intro-subtitle");
  equal(visible?.role, "status");
  equal(visible?.ariaLive, "polite");
  equal(visible?.region, "bottom-right");
  equal(visible?.lines?.[0]?.value, "Guide");
  equal(visible?.lines?.[1]?.text, "Move carefully.");
});

test("resolveAccessibilityOptions reports diagnostic paths", () => {
  expectThrows(
    () => resolveAccessibilityOptions({ contrastPalette: "unknown" as never }),
    /Invalid accessibility options: kind=accessibility path='accessibility\.contrastPalette'/,
  );
});

function expectThrows(callback: () => void, pattern: RegExp): void {
  let message = "";
  try {
    callback();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  ok(pattern.test(message), `Expected '${message}' to match ${pattern}.`);
}
