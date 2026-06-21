---
name: pixelforge-design-system
description: Use when designing, implementing, reviewing, or prototyping Pixelforge-branded IDE UI, Ferrum2D local authoring app screens, game-development editor panels, design-system tokens, visual mocks, UI kit components, brand assets, icons, screenshots, or production UI that must follow the Pixelforge Design System.
---

# Pixelforge Design System

Pixelforge is a dark, dense, desktop-class IDE visual system for 2D game development tools. Use it for Pixelforge-branded UI, local authoring app UI, editor-like mocks, and production components that should feel like a precise game-development workshop rather than a marketing page.

## Source Files

- Full guidelines: `references/design-system.md`
- Original imported skill notes: `references/source-skill.md`
- Tokens: `assets/colors_and_type.css`
- Brand assets: `assets/brand-assets/logo.svg`, `wordmark.svg`, `logo-mono.svg`
- Node icons: `assets/brand-assets/node-icons/*.svg`
- Sample sprites: `assets/brand-assets/sample-sprites/*.png`
- Component previews: `assets/preview/*.html`
- IDE UI kit: `assets/ui_kits/pixelforge/*.jsx`, `assets/ui_kits/pixelforge/ide.css`

Read `references/design-system.md` before making broad visual decisions. For token names or implementation values, inspect `assets/colors_and_type.css`. For an IDE-shaped screen, prefer the UI kit files over rebuilding chrome from scratch.

## Core Visual Rules

- Design dark-first. Do not lead with light mode.
- Use engine graphite neutrals with one signature accent: forge amber `#F5A742`.
- Use engine domain colors only for state and category meaning: runtime green, physics cyan, render blue, behavior purple, collision coral, audio orange.
- Keep UI dense: 4px spacing grid, compact rows, edge-to-edge panels, no floating gutters.
- Use small radii: 2px for buttons/inputs, 4px for menus/cards, 8px max for dialogs.
- Use hairline borders for panel separation. Shadows are only for elevated popovers, dialogs, and toasts.
- Use the selection signature: 2px amber left rail plus amber fill at low opacity.
- Keep motion short and curt: 80-120ms, ease-out, no bounce, no spring, no parallax.
- Use Lucide-style stroke icons for general chrome and Pixelforge node SVGs for scene-tree node types.
- Never use emoji, exclamation marks, bouncy animation, rainbow gradients, large pillowy cards, or decorative blobs in product chrome.

## Voice Rules

- Write like a tool for makers: direct, technical, calm.
- Use Title Case for UI labels and Sentence case for body/dialog copy.
- Keep buttons to 1-2 words and tooltips to 8 words or fewer.
- Avoid corporate and hype words such as `seamless`, `magical`, `powerful`, `awesome`, and `great job`.
- Name errors plainly: `Build failed. 3 errors in player.gd.`

## Implementation Workflow

1. Identify whether the output is a production component, HTML mock, screenshot/visual asset, or design review.
2. Load only the needed reference:
   - Broad style or copy: `references/design-system.md`
   - CSS/token implementation: `assets/colors_and_type.css`
   - IDE shell/panels: `assets/ui_kits/pixelforge/`
   - Component-level pattern: matching file under `assets/preview/`
3. Reuse assets by path instead of recreating brand marks or node icons.
4. For HTML artifacts, copy or link `assets/colors_and_type.css` and use the design tokens instead of hard-coded colors.
5. For production UI, map existing app styles to Pixelforge tokens gradually. Do not introduce a parallel untracked palette.
6. For Ferrum2D authoring surfaces, keep the product philosophy intact: Pixelforge styling may improve the allowed authoring viewer UI, but it must not expand scope into a general visual editor, behavior recipe body editor, FSM/action graph editor, or timeline editor without explicit approval.

## Validation Checklist

- The screen reads as dark, dense, tool-like IDE UI.
- Amber is sparse and reserved for active state, selection, primary action, or brand.
- Engine domain colors are sparse and reserved for status dots, overlays, diagnostics, legends, or category badges.
- Text fits compact panels without oversized hero typography.
- All spacing follows the 4px grid.
- No new one-off color/radius/font tokens were invented.
- Icons are Lucide-style or provided Pixelforge SVG assets, not emoji.
- If changing production UI, run the project checks relevant to that UI surface and inspect a screenshot when visual regressions are plausible.
