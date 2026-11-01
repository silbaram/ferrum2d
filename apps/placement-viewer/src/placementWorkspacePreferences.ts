export type WorkspaceDock = "scene" | "inspector" | "runtime";
export type WorkspaceLayout = Record<WorkspaceDock, number> & { hidden: WorkspaceDock[] };
export const WORKSPACE_DOCKS = ["scene", "inspector", "runtime"] as const;
export const WORKSPACE_LIMITS = { scene: [160, 400], inspector: [240, 480], runtime: [64, 280] } as const;
export const WORKSPACE_PRESETS = [
  { id: "custom", label: "My Layout" },
  { id: "scene", label: "Scene Placement" },
  { id: "assets", label: "Asset Work" },
  { id: "review", label: "Game Review" },
] as const;
export type WorkspacePreset = typeof WORKSPACE_PRESETS[number]["id"];
export type WorkspacePreferences = { active: WorkspacePreset; layouts: Record<WorkspacePreset, WorkspaceLayout> };

export function clampWorkspaceSize(dock: WorkspaceDock, value: number): number {
  return Math.max(WORKSPACE_LIMITS[dock][0], Math.min(WORKSPACE_LIMITS[dock][1], Math.round(value)));
}
export function defaultWorkspaceLayout(preset: WorkspacePreset): WorkspaceLayout {
  return { scene: 240, inspector: 320, runtime: preset === "assets" ? 240 : preset === "review" ? 120 : 168,
    hidden: preset === "scene" ? ["runtime"] : preset === "custom" ? [] : ["scene", "inspector"] };
}
function parse(text: string | null): unknown {
  try { return JSON.parse(text ?? "null"); } catch { return undefined; }
}
function readLayout(value: unknown, preset: WorkspacePreset): WorkspaceLayout {
  const layout = defaultWorkspaceLayout(preset);
  if (!value || typeof value !== "object") return layout;
  for (const dock of WORKSPACE_DOCKS) {
    const size: unknown = Reflect.get(value, dock);
    if (typeof size === "number" && Number.isFinite(size)) layout[dock] = clampWorkspaceSize(dock, size);
  }
  const hidden: unknown = Reflect.get(value, "hidden");
  if (Array.isArray(hidden)) layout.hidden = WORKSPACE_DOCKS.filter(dock => hidden.includes(dock));
  return layout;
}
/** Legacy custom settings remain independent of the new task preferences. */
export function readWorkspacePreferences(customText: string | null, presetText: string | null): WorkspacePreferences {
  const value = parse(presetText), preferences: WorkspacePreferences = {
    active: "custom", layouts: {
      custom: readLayout(parse(customText), "custom"), scene: defaultWorkspaceLayout("scene"),
      assets: defaultWorkspaceLayout("assets"), review: defaultWorkspaceLayout("review"),
    },
  };
  if (!value || typeof value !== "object") return preferences;
  const active: unknown = Reflect.get(value, "active"), layouts: unknown = Reflect.get(value, "layouts");
  preferences.active = WORKSPACE_PRESETS.find(preset => preset.id === active)?.id ?? "custom";
  if (layouts && typeof layouts === "object") for (const { id } of WORKSPACE_PRESETS) {
    if (id !== "custom") preferences.layouts[id] = readLayout(Reflect.get(layouts, id), id);
  }
  return preferences;
}
export function serializeWorkspacePresets(preferences: WorkspacePreferences): string {
  const { scene, assets, review } = preferences.layouts;
  return JSON.stringify({ active: preferences.active, layouts: { scene, assets, review } });
}
