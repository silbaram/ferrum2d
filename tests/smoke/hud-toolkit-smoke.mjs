#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  HUD_THEME_PRESETS,
  createHudOverlayState,
  resolveHudTheme,
} from "../../packages/ferrum-web/dist/index.js";

const theme = resolveHudTheme({ textColor: "#ffffff", borderRadius: "4px" });
assert.equal(theme.textColor, "#ffffff");
assert.equal(theme.borderRadius, "4px");
assert.equal(HUD_THEME_PRESETS["high-contrast"].panelBorder, "#ffffff");

const state = createHudOverlayState([
  { type: "meter", id: "health", label: "HP", value: 3, max: 6 },
  { type: "counter", id: "score", label: "Score", value: 120 },
  {
    type: "prompt",
    id: "start",
    text: "Press Start",
    action: { id: "start", label: "Start", tone: "primary" },
  },
], {
  panelId: "game-hud",
  title: "HUD",
  region: "top-right",
});

assert.equal(state.panels[0].id, "game-hud");
assert.equal(state.panels[0].ariaLive, "polite");
assert.equal(state.panels[0].lines[0].value, "50%");
assert.equal(state.panels[0].lines[0].meter.max, 6);
assert.equal(state.panels[0].actions[0].id, "start");

console.log(JSON.stringify({
  hudToolkitSmoke: {
    panel: state.panels[0].id,
    meterValue: state.panels[0].lines[0].value,
    action: state.panels[0].actions[0].id,
  },
}, null, 2));
