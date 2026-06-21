# Pixelforge — Design System

> **Pixelforge** is an IDE for 2D game development. This repository defines its visual language, content voice, component vocabulary, and ships a working high‑fidelity recreation of the editor.

## What Pixelforge is

Pixelforge is a desktop‑class **editor IDE for making 2D games**. Think of the category occupied by Godot, GameMaker, Defold, Construct, and Aseprite — Pixelforge sits in the same space:

- A **viewport** at the center where the scene is composed.
- A **scene tree / hierarchy** on the left.
- An **inspector** on the right for properties of the selected node.
- A **file system / assets** panel and an **output / console** at the bottom.
- A **play bar** at the top that runs the game.
- Built‑in tooling for **sprites, tilemaps, animation, physics, scripting**.

The brand voice is **craftsperson over corporation**. We make tools for people who like the smell of metal shavings — the IDE is sharp, dense, fast, and a little bit warm. The product name (forge + pixel) is the whole pitch.

## Sources used to build this system

No codebase, Figma, or screenshots were provided with the original request — the brief was a single line: *"2D 게임 개발을 위한 에디터 IDE."* The design here is therefore an **opinionated, original system** synthesized from the dominant patterns in the category:

- Godot Editor — panel layout, dock system, scene‑tree + inspector pattern.
- VS Code — typography density, command palette, status bar.
- Aseprite — pixel‑art heritage cues used **sparingly** in branding (never in the UI chrome).
- JetBrains IDEs — semantic color discipline for diagnostics.

If you have the real Pixelforge codebase / Figma, replace this section with links and re‑run the system build so we capture the actual tokens.

---

## Index — what is in this folder

| Path | What it is |
|---|---|
| `README.md` | This file. The high‑level guide. |
| `SKILL.md` | Agent SKILL entry — read this first if you are an agent. |
| `colors_and_type.css` | All design tokens (CSS variables). Import this anywhere. |
| `fonts/` | Local font files where bundled; otherwise loaded from Google Fonts. |
| `assets/` | Logo, wordmark, brand marks, illustrations. |
| `preview/` | Small HTML cards that populate the Design System tab. |
| `ui_kits/pixelforge/` | High‑fidelity IDE recreation — JSX components + `index.html`. |

There are no slide templates — none were provided in the brief.

### Font substitution flag

⚠ No font files were bundled. The system loads **Geist** (UI), **JetBrains Mono** (code), and **Silkscreen** (brand wordmark) from **Google Fonts** at runtime. If Pixelforge has licensed display faces (e.g. a custom pixel display face for the wordmark), drop the `.woff2` files into `fonts/` and update the `@font-face` block at the top of `colors_and_type.css`.

---

## CONTENT FUNDAMENTALS

How Pixelforge sounds when it speaks.

### Posture
- **Crafty, technical, never corporate.** This is software for makers, not enterprises.
- **Direct over breezy.** No "Great job!" / "Awesome!" / "Let's go!". The IDE is the user's workshop; the IDE doesn't applaud the user.
- **Confident, not cocky.** State things plainly. The product knows its job.

### Voice rules
| Rule | Do | Don't |
|---|---|---|
| Person | Second person, sparingly. "Save changes?" — not "Would you like to save your changes?" | First‑person plural ("We've saved your project") |
| Casing | **Title Case for UI labels** (`Run Project`, `Pause Animation`), **Sentence case for body and dialogs** (`Unsaved changes will be lost.`) | ALL CAPS, except for tiny system labels like `FPS`, `RAM`, `DRAW CALLS` |
| Length | Buttons: 1–2 words. Tooltips: ≤ 8 words. Empty‑state copy: ≤ 2 sentences. | Anything that scrolls in a tooltip |
| Punctuation | Periods at the end of full sentences in dialogs. No periods on buttons, menu items, or tooltips. | "Save changes." on a button |
| Numerals | Always digits in UI (`3 errors`, `12 FPS`), spelled out only in long‑form copy. | "three errors" in a status bar |

### Examples — Pixelforge‑voiced

> **Empty scene tree**
> *"Nothing here yet. Add a node to start building your scene."*

> **Save dialog**
> *"Unsaved changes in `level_03.scene`. Save before closing?"*
> Buttons: `Save` · `Discard` · `Cancel`

> **Build success toast**
> *"Build finished in 2.4s · 0 errors"*

> **Build error**
> *"Build failed. 3 errors in `player.gd`."* — click‑through opens the first error.

> **Tooltip on the Play button**
> *"Run the current scene (F5)"*

### Off‑limits
- Emoji in product chrome. Never. (Emoji in the chat panel, where users write, is fine — that's user content.)
- Exclamation marks anywhere in the UI.
- "Oops", "Whoops", "Uh oh" — errors are errors, name them.
- Marketing words in the IDE: *powerful, seamless, intuitive, magical*. We let the tool be those things; we don't claim them.

---

## VISUAL FOUNDATIONS

### Mode
**Dark first.** Pixelforge ships in dark mode by default. A light mode exists for screenshots, docs, and accessibility, but the canonical product image is dark. All marketing assets are dark.

### Color vibe
- The neutral spine is **engine graphite** (`#0B1016` → `#DCE5EE`), darker and more instrument-like than a generic editor slate.
- The one signature accent is **forge amber** — `#F5A742`. Used for primary action, brand mark, active selections, focus, and build-in-progress state.
- Semantic colors are flat and saturated: **red** for errors, **green** for runtime/success, **yellow** for warnings, **blue** for render/info, **cyan** for physics, and **purple** for behavior/shaders. Use these as meaning-bearing signals, not decoration.
- Engine domain aliases exist in `colors_and_type.css`: runtime, physics, render, behavior, collision, audio, grid, and viewport tokens. Prefer those aliases in tools that show game-engine state.
- Imagery is cool, technical, slightly cyan‑shifted; never warm filters, never sepia. If we show pixel art, the pixel art itself can be warm — the frame around it is cool.

### Type
- **UI:** Geist Sans, 13px base in dense panels, 14px in dialogs/menus.
- **Code:** JetBrains Mono, 13px in the editor.
- **Brand wordmark only:** Silkscreen (pixel‑bitmap font). **Never used inside the IDE chrome** — only on the splash, the title bar logotype, and marketing.
- Line‑height is tight in panels (1.3) and comfortable in body copy (1.55).
- Numerals are tabular wherever they tick (FPS, frame counter, timecodes).

### Spacing & layout
- **4px base grid.** All paddings, margins, and gaps are multiples of 4.
- Panel chrome is **dense**: 6px vertical padding on rows, 8px horizontal. This is an IDE, not a marketing site.
- **No floating gutters.** Panels share hairline borders, edge‑to‑edge.
- The whole editor is a fixed CSS grid; nothing reflows on window resize except the central viewport and the bottom dock.

### Corner radii
| Token | Value | Use |
|---|---|---|
| `--radius-0` | 0px | Panel chrome, dividers, tab strips, dock edges |
| `--radius-1` | 2px | Inputs, buttons, badges, chips |
| `--radius-2` | 4px | Floating menus, popovers, toasts |
| `--radius-3` | 8px | Modals, large cards |
| `--radius-pill` | 999px | Avatar, status pip |

**Default rounding is small.** 2px on a button, 4px on a popover. No 16px+ pillowy cards anywhere in the IDE.

### Borders
- Hairline `1px solid var(--border)` for almost everything. `--border` is `#1f242c` on dark, `#d8dee5` on light.
- A second `--border-strong` (`#2a313b` / `#bdc6d1`) is used for focused inputs and active tabs.
- We do **not** use shadows to imply panel separation — borders do that. Shadows are reserved for elevated UI (menus, dialogs, toasts).

### Shadows
| Token | Value | Use |
|---|---|---|
| `--shadow-0` | none | Panels, inline UI |
| `--shadow-1` | `0 1px 2px rgba(0,0,0,.4)` | Hover lift on cards |
| `--shadow-2` | `0 6px 16px rgba(0,0,0,.5)` | Popovers, tooltips |
| `--shadow-3` | `0 16px 40px rgba(0,0,0,.6)` | Modals, dialogs |

On dark backgrounds we use **shadow + a 1px highlight on the top edge** (`inset 0 1px 0 rgba(255,255,255,.04)`) to imply lift — pure shadow on dark looks muddy.

### Backgrounds
- The IDE is **flat color, no gradients**, with one exception: a **subtle 2% grain texture** as a CSS background‑image on the top‑level shell. It's there so the dark doesn't look like a void.
- The viewport (where the game renders) has a **checkerboard transparency pattern** behind it, sized 16×16. This is the one piece of "pixel art DNA" baked into the UI.
- Marketing pages allow a single quiet linear gradient from `--bg-1` to `--bg-2`, never multi‑stop, never rainbow.

### Animation
- **Fast and curt.** Default duration `120ms`, easing `cubic-bezier(.2, .8, .2, 1)` (a soft ease‑out).
- Modals: 160ms scale 0.98 → 1.0 + opacity 0 → 1.
- Hover transitions: 80ms color only. No motion on hover.
- No bouncing, no springy overshoot, no parallax. This is a tool, not a toy.
- The **only** decorative motion is the spinning gear icon used while the project is building — 1 rotation per 1.4s, linear.

### Hover & press
- **Hover:** background fills shift by `+4% lightness` (dark) or `−4%` (light). Borders don't change. Cursor‑pointer only on actual interactive elements.
- **Press / active:** background `+6%`, plus a `1px inset` border on the bottom edge to feel pressed‑in. No scale transforms.
- **Focus:** `2px outline` in `--accent` at `2px` offset, no border color change. Visible in keyboard nav, suppressed for `:focus:not(:focus-visible)`.

### Selection
- Selected rows in trees / lists use `--accent` at 18% opacity as a fill, with the row's text bumped to `--fg-1`. There's a **2px left rail** in solid `--accent` on the selected row. The left rail is the canonical Pixelforge selection signature.
- Multi‑select uses the same fill at 12% opacity for non‑primary members of the selection.

### Transparency & blur
- Backdrop blur is used in **two** places only: the command palette (`backdrop-filter: blur(8px)` over an 85% scrim) and the **scene viewport overlay HUD** (gizmo readouts). Everywhere else, opacity changes alone.
- We don't use frosted backgrounds for menus or sidebars — they're solid.

### Cards
- A "card" in Pixelforge has: `border: 1px solid var(--border)`, `border-radius: 4px`, `background: var(--bg-2)`, `padding: 12px 14px`. **No shadow at rest.** Hover adds `--shadow-1`.

### Fixed elements
- The top bar is always 40px tall.
- The status bar at the bottom is always 24px tall.
- The activity bar (icon column far left) is always 44px wide.
- Side dock columns are resizable but snap to multiples of 8px.

### Density variants
The system supports two densities: **Compact** (default, IDE), and **Comfortable** (used in onboarding, dialogs, and marketing). Compact uses 6px row heights; Comfortable uses 10px. Both share the same tokens — only the row padding token swaps.

---

## ICONOGRAPHY

### Approach
Pixelforge uses **Lucide** as its base icon set — a clean, 1.5px‑stroke, monoline family. Lucide is loaded from `unpkg` CDN; there's no local copy in `assets/icons/` to keep the system light.

- Stroke weight: **1.5px** at 16px size, **1.75px** at 20px+.
- All UI icons render at **16px** in panels and toolbars, **20px** in the activity bar and dialog headers.
- Icons inherit `currentColor` so they pick up text color states automatically.
- Filled variants are reserved for **active / selected** states — e.g. the Play button is `play-outline` at rest and `play-fill` when running.

### What's NOT a Lucide icon
- The **Pixelforge brand mark** (a 5×5 pixel cluster, see `assets/logo.svg`). Always SVG, never approximated with characters.
- The **node‑type glyphs** in the scene tree (Sprite, Body2D, Collider, AnimPlayer, etc.). These are **custom 16px pixel‑style icons** drawn on an 8×8 pixel grid — they're the only nod to pixel‑art DNA inside the UI chrome. Placeholders live in `assets/node-icons/` and should be replaced with the real set when available.
- The **checkerboard pattern** in the viewport — that's a CSS background, not an icon.

### Emoji & unicode
- **Never** in product chrome.
- **Allowed** in user‑authored content (asset names, comments, chat). Where rendered, fall back to the OS emoji font; don't ship a custom emoji set.
- Unicode arrows (`→ ↑ ↓ ←`) are fine in keyboard‑shortcut documentation but not in live UI — use Lucide arrow icons there.

### Substitution flag
- ⚠ **Lucide is used as a stand‑in for Pixelforge's real icon system**, which would normally be a custom 16px pixel‑grid set. If you have the real icon set, drop SVGs into `assets/icons/` and update `colors_and_type.css` references accordingly.
