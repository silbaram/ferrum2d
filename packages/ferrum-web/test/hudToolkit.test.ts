import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  HUD_THEME_PRESETS,
  createHudOverlayState,
  resolveHudTheme,
} from "../src/hudToolkit.js";

test("resolveHudTheme resolves presets and custom token overrides", () => {
  equal(resolveHudTheme("high-contrast").panelBorder, "#ffffff");
  equal(resolveHudTheme({ textColor: "#111111" }).textColor, "#111111");
  equal(HUD_THEME_PRESETS.dark.borderRadius, "6px");
});

test("createHudOverlayState maps HUD components to UiOverlayState", () => {
  const state = createHudOverlayState([
    { type: "meter", id: "health", label: "HP", value: 4, max: 8 },
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

  const panel = state.panels?.[0];
  equal(panel?.id, "game-hud");
  equal(panel?.region, "top-right");
  equal(panel?.ariaLabel, "HUD");
  equal(panel?.ariaLive, "polite");
  equal(panel?.lines?.[0].value, "50%");
  equal(panel?.lines?.[0].meter?.max, 8);
  equal(panel?.lines?.[1].value, 120);
  equal(panel?.actions?.[0].id, "start");
});

test("createHudOverlayState marks low meters as danger tone", () => {
  const state = createHudOverlayState([
    { type: "meter", id: "health", value: 1, max: 8 },
  ]);
  equal(state.panels?.[0].lines?.[0].tone, "danger");
});
