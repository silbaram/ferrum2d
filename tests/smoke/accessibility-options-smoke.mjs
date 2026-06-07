import {
  accessibilitySubtitlePanel,
  applyAccessibilityToCameraRigSpec,
  applyAccessibilityToScreenFadeSpec,
  resolveAccessibilityHudTheme,
  resolveAccessibilityOptions,
} from "../../packages/ferrum-web/dist/index.js";

const options = resolveAccessibilityOptions({
  reducedMotion: "system",
  subtitles: true,
  contrastPalette: "high-contrast",
  inputAssist: {
    holdToToggleActions: ["fire", "fire"],
    minimumTouchTargetPx: 48,
  },
}, {
  environment: { prefersReducedMotion: true },
});

const camera = applyAccessibilityToCameraRigSpec({ smoothTimeSeconds: 0.45, x: 12 }, options);
const fade = applyAccessibilityToScreenFadeSpec({ durationSeconds: 1, toOpacity: 0.2 }, options);
const theme = resolveAccessibilityHudTheme(options);
const subtitles = accessibilitySubtitlePanel({
  speaker: "Guide",
  text: "Move carefully.",
}, { accessibility: options });

if (!options.reducedMotion) {
  throw new Error("accessibility smoke expected system reduced motion to resolve to true.");
}
if (options.inputAssist.holdToToggleActions.length !== 1 || options.inputAssist.minimumTouchTargetPx !== 48) {
  throw new Error("accessibility smoke expected normalized input assist settings.");
}
if (camera.smoothTimeSeconds !== 0 || fade.durationSeconds !== 0) {
  throw new Error("accessibility smoke expected reduced motion adapters to remove camera/fade smoothing.");
}
if (theme.panelBackground !== "#000000" || theme.panelBorder !== "#ffffff") {
  throw new Error("accessibility smoke expected high-contrast HUD theme.");
}
if (subtitles?.role !== "status" || subtitles.lines?.[1]?.text !== "Move carefully.") {
  throw new Error("accessibility smoke expected subtitle panel output.");
}

console.log(JSON.stringify({
  accessibilityOptionsSmoke: {
    reducedMotion: options.reducedMotion,
    subtitles: options.subtitles,
    contrastPalette: options.contrastPalette.id,
    touchTarget: options.inputAssist.minimumTouchTargetPx,
  },
}, null, 2));
