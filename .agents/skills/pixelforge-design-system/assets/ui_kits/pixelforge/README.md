# Pixelforge IDE — UI Kit

A high‑fidelity, click‑through recreation of the Pixelforge editor.

## What's in here

| File | Component | Notes |
|---|---|---|
| `index.html` | The full IDE shell — running session you can click around | Open this. |
| `TopBar.jsx` | App menu, project title, play/pause/stop, modes | 40px tall, fixed. |
| `ActivityBar.jsx` | Far‑left icon column — Scenes / Files / Search / Git / Plugins | 44px wide. |
| `SceneTree.jsx` | Hierarchical scene panel with selection rail | Uses node‑icons. |
| `FileBrowser.jsx` | Project files grid + tree | Bottom‑left dock content. |
| `Viewport.jsx` | The 2D canvas with checkerboard, gizmos, ruler, HUD | Center stage. |
| `Tabs.jsx` | Editor tabs (scene + script + image) | Above viewport. |
| `Inspector.jsx` | Property panel — sections, fields, vector inputs | Right dock. |
| `Console.jsx` | Output / Debugger / Animation / Audio panels | Bottom dock with tabs. |
| `StatusBar.jsx` | 24px status row | Bottom. |
| `CommandPalette.jsx` | Cmd‑K palette overlay | Modal scrim + blur. |
| `Button.jsx`, `Field.jsx`, `Icon.jsx` | Primitives used everywhere | Tiny, reusable. |

## Coverage and limits

This is a **recreation, not a real engine**. The viewport draws DOM sprites positioned by CSS, not a canvas. Scripts don't actually compile. Play / Pause / Stop transition the HUD but don't simulate the game. Where real behavior would matter, the kit fakes plausible state and ignores the rest.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar (40)                                                  │
├──┬─────────────┬──────────────────────────┬─────────────────┤
│A │ SceneTree   │ Tabs ▸ Viewport          │ Inspector       │
│c │             │                          │                 │
│t │             │                          │                 │
│  ├─────────────┤                          │                 │
│  │ FileBrowser │                          │                 │
├──┴─────────────┴──────────────────────────┴─────────────────┤
│ Console (tabs: Output · Debugger · Animation · Audio)        │
├──────────────────────────────────────────────────────────────┤
│ StatusBar (24)                                               │
└──────────────────────────────────────────────────────────────┘
```
