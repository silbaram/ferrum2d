---
name: pixelforge-design
description: Use this skill to generate well-branded interfaces and assets for Pixelforge, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# Pixelforge Design Skill

Pixelforge is an IDE for 2D game development. Dark by default, sharp corners, dense panel UI, with **forge amber (`#F5A742`)** as the one signature accent. The brand voice is craftsperson over corporation.

## Where to look

Read `README.md` first — it covers content fundamentals, visual foundations, and iconography. Then explore:

- `colors_and_type.css` — all design tokens. Import this anywhere you build a new HTML artifact.
- `assets/logo.svg`, `assets/wordmark.svg`, `assets/logo-mono.svg` — the brand mark in three forms.
- `assets/node-icons/` — custom 8×8 pixel‑grid node icons. The only "pixel art" inside the UI chrome.
- `assets/sample-sprites/` — placeholder hero/coin sprites for viewport mocks.
- `preview/` — small example cards for every token / component cluster. Read these to learn the visual vocabulary.
- `ui_kits/pixelforge/` — JSX components for the full IDE shell. Reuse these for any IDE‑shaped mock.

## How to use it

If you're making a **visual artifact** (slide, mock, throwaway prototype):
1. Copy `colors_and_type.css` into your new file's directory and `<link>` it.
2. Pull `assets/logo.svg` (or the wordmark) for branding.
3. For an IDE‑shaped UI, copy the components from `ui_kits/pixelforge/` rather than rebuilding chrome.
4. Lucide stroke icons via CDN are fine for general iconography; never substitute emoji.

If you're working on **production code**:
- Treat `colors_and_type.css` as the token contract — never invent new colors or radii.
- Match the density: 6px row padding in panels, 4px grid for everything.
- Animations are short (`120ms`) and ease‑out — never bouncy.

## Rules of thumb

- Dark first. Never lead a marketing screenshot with light mode.
- Small radii. 2px on buttons, 4px on menus, 8px max for modals.
- One accent color in a screen — amber, used sparingly.
- Selection signature: 2px left rail in amber over an 18%‑opacity amber fill.
- Never use emoji in chrome. Never bouncy animation. Never colored gradient backgrounds.

## If the user just invokes this skill

Ask what they want to build (a new IDE panel? a marketing page? a feature mock?). Confirm:
- Output format (HTML mock, slide, production component?)
- Whether they want variations.
- Whether to copy assets out or link the design system in place.

Then act as an expert designer who outputs HTML artifacts or production code depending on the need.
