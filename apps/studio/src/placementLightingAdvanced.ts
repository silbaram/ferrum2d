import { placementPointShadow } from "./placementPointShadows";
import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
import type { PlacementLightingControls, PlacementLightingDraft } from "./placementLightingControls";

type SpatialDraft = Extract<PlacementLightingDraft, { spatial: true }>;

/** Optional spatial effects edit the same environment patch as the basic lighting inspector. */
export function createPlacementLightingAdvanced(options: PlacementLightingControls & {
  form: HTMLElement; atmosphere: HTMLElement; sun: HTMLElement; point: HTMLElement;
  key(): string; pointIndex(): number; refresh(): void;
}) {
  const syncers: Array<(d: SpatialDraft) => void> = [];
  const sections: HTMLElement[] = [];
  const spatialRows: HTMLElement[] = [];
  const selectedProbes = new Map<string, number>();
  const probeIndex = () => selectedProbes.get(options.key()) ?? 0;
  const point = (d: SpatialDraft) => d.light.lights[options.pointIndex()];
  const owner = (d: SpatialDraft) => placementPointShadow(d.light, options.pointIndex());
  const probe = (d: SpatialDraft) => d.light.probes?.[probeIndex()];
  const change = (edit: (d: SpatialDraft) => void) => options.change(d => { if (d.spatial) edit(d); });
  function group(label: string, id: string) {
    const details = document.createElement("details"), summary = document.createElement("summary");
    details.className = "placement-tool-advanced";
    details.dataset.placementLightingAdvanced = id;
    setUiText(summary, label); details.append(summary); options.form.append(details); sections.push(details);
    return details;
  }
  function number(parent: HTMLElement, label: string, name: string, min: number, max: number, step: number,
    read: (d: SpatialDraft) => number, write: (d: SpatialDraft, value: number) => void,
    visible: (d: SpatialDraft) => boolean = () => true) {
    return options.number(parent, label, name, min, max, step, d => d.spatial ? read(d) : 0,
      (d, value) => { if (d.spatial) write(d, value); }, d => d.spatial && visible(d), 8);
  }
  function color(parent: HTMLElement, label: string, name: string, read: (d: SpatialDraft) => readonly number[],
    write: (d: SpatialDraft, value: [number, number, number]) => void, visible: (d: SpatialDraft) => boolean) {
    options.color(parent, label, name, d => d.spatial ? read(d) : [1, 1, 1],
      (d, value) => { if (d.spatial) write(d, value); }, d => d.spatial && visible(d));
  }
  function toggle(parent: HTMLElement, label: string, name: string, read: (d: SpatialDraft) => boolean,
    write: (d: SpatialDraft, value: boolean) => void, visible: (d: SpatialDraft) => boolean = () => true) {
    const control = options.checkbox(label, name, value => change(d => write(d, value)));
    parent.append(control.row);
    spatialRows.push(control.row);
    syncers.push(d => { control.input.checked = read(d); control.row.hidden = !visible(d); });
    return control;
  }
  function select<T extends string>(parent: HTMLElement, label: string, name: string, values: readonly (readonly [T, string])[],
    read: (d: SpatialDraft) => T, write: (d: SpatialDraft, value: T) => void,
    visible: (d: SpatialDraft) => boolean = () => true) {
    const row = document.createElement("label"), caption = document.createElement("span"), input = document.createElement("select");
    setUiText(caption, label); setUiAttribute(input, "aria-label", label); input.dataset.placementLightingSelect = name;
    for (const [value, label] of values) { const item = document.createElement("option"); item.value = value; setUiText(item, label); input.append(item); }
    input.addEventListener("change", () => {
      const chosen = values.find(([value]) => value === input.value);
      if (chosen) change(d => write(d, chosen[0]));
    });
    row.append(caption, input); parent.append(row);
    spatialRows.push(row);
    syncers.push(d => { row.hidden = !visible(d); input.value = read(d); });
    return input;
  }

  const composition = select(options.atmosphere, "Light Composition", "composition", [["legacy", "Legacy"], ["separated", "Separated"]],
    d => d.environment.composition ?? "legacy", (d, value) => { d.environment.composition = value; });
  setUiAttribute(composition, "title", "Disable wide Bloom and light shafts before Legacy.");
  syncers.push(d => { composition.options[0].disabled = !!d.environment.lightShafts || d.environment.bloom?.mode === "wide"; });
  select(options.atmosphere, "Bloom Mode", "bloom-mode", [["gather", "Gather"], ["wide", "Wide"]],
    d => d.environment.bloom?.mode ?? "gather", (d, value) => {
      const bloom = d.environment.bloom; if (!bloom) return;
      if (value === "wide") { bloom.mode = "wide"; bloom.quality ??= "balanced"; d.environment.composition = "separated"; }
      else { delete bloom.mode; delete bloom.quality; bloom.radius = Math.min(bloom.radius ?? 8, 24); }
    }, d => !!d.environment.bloom);
  const quality = [["low", "Low"], ["balanced", "Balanced"], ["high", "High"]] as const;
  select(options.atmosphere, "Bloom Quality", "bloom-quality", quality, d => d.environment.bloom?.quality ?? "balanced",
    (d, value) => { if (d.environment.bloom) d.environment.bloom.quality = value; }, d => d.environment.bloom?.mode === "wide");
  select(options.atmosphere, "Base Shadow Filter", "shadow-filter", [["hard", "Hard"], ["pcf3", "PCF"]],
    d => d.light.shadowFilter ?? "hard", (d, value) => { d.light.shadowFilter = value; });

  for (const kind of ["sun", "point"] as const) {
    const parent = options[kind], shadow = (d: SpatialDraft) => kind === "sun" ? d.light.directional?.shadows : owner(d);
    select(parent, "Shadow Resolution", `${kind}-resolution`, [["128", "128"], ["256", "256"], ["512", "512"], ["1024", "1024"]],
      d => String(shadow(d)?.resolution ?? 512), (d, value) => {
        const s = shadow(d), resolution = Number(value);
        if (s && (resolution === 128 || resolution === 256 || resolution === 512 || resolution === 1024)) s.resolution = resolution;
      }, d => !!shadow(d));
    toggle(parent, "Soft Shadows (PCSS)", `${kind}-pcss`, d => !!shadow(d)?.pcss, (d, enabled) => {
      if (kind === "sun") { const s = d.light.directional?.shadows; if (s) { if (enabled) s.pcss = {}; else delete s.pcss; } }
      else { const s = owner(d); if (s) { if (enabled) s.pcss = {}; else delete s.pcss; } }
    }, d => !!shadow(d));
    number(parent, kind === "sun" ? "Sun Angular Radius (°)" : "Emitter Radius", `${kind}-pcss-radius`, 0, kind === "sun" ? 5 : 1000, .1,
      d => kind === "sun" ? d.light.directional?.shadows?.pcss?.angularRadius ?? .5 : owner(d)?.pcss?.sourceRadius ?? 1,
      (d, value) => {
        if (kind === "sun") { const p = d.light.directional?.shadows?.pcss; if (p) p.angularRadius = value; }
        else { const p = owner(d)?.pcss; if (p) p.sourceRadius = value; }
      }, d => !!shadow(d)?.pcss);
    number(parent, "Soft Shadow Limit", `${kind}-pcss-limit`, 1, 32, 1, d => shadow(d)?.pcss?.maxRadiusTexels ?? 16,
      (d, value) => { const p = shadow(d)?.pcss; if (p) p.maxRadiusTexels = value; }, d => !!shadow(d)?.pcss);
    for (const [key, label] of [["lightMask", "Light Channels"], ["shadowMask", "Shadow Channels"]] as const) {
      const input = number(parent, label, `${kind}-${key}`, 0, 255, 1,
        d => (kind === "sun" ? d.light.directional : point(d))?.[key] ?? 255,
        (d, value) => { const light = kind === "sun" ? d.light.directional : point(d); if (light) light[key] = value; });
      input.step = "1"; setUiAttribute(input, "title", "Bit mask: 0 none, 255 all channels.");
    }
  }

  const selection = group("Light Selection", "selection");
  toggle(selection, "Smooth Light Selection", "selection", d => !!d.light.selection && d.light.selection.enabled !== false,
    (d, enabled) => { d.light.selection = { ...d.light.selection, enabled }; });
  for (const [key, label, max, step, fallback] of [
    ["hysteresis", "Selection Hysteresis", 1, .05, .15], ["fadeSeconds", "Light Fade (s)", 5, .05, .15],
    ["resetDistance", "Camera Cut Distance", 1e6, 1, 0],
  ] as const) number(selection, label, `selection-${key}`, 0, max, step, d => d.light.selection?.[key] ?? fallback,
    (d, value) => { if (d.light.selection) d.light.selection[key] = value; }, d => !!d.light.selection && d.light.selection.enabled !== false);

  const fog = group("Fog", "fog");
  select(fog, "Fog Mode", "fog-mode", [["none", "None"], ["linear", "Linear"], ["height", "Height"]],
    d => d.environment.fog ? d.environment.fog.height ? "height" : "linear" : "none", (d, value) => {
      if (value === "none") { delete d.environment.fog; return; }
      d.environment.fog ??= { color: [.6, .7, .8], start: 0, end: 1000 };
      if (value === "height") d.environment.fog.height ??= {};
      else delete d.environment.fog.height;
    });
  color(fog, "Fog Color", "fog-color", d => d.environment.fog?.color ?? [1, 1, 1],
    (d, value) => { if (d.environment.fog) d.environment.fog.color = value; }, d => !!d.environment.fog);
  for (const key of ["start", "end"] as const) number(fog, key === "start" ? "Fog Start" : "Fog End", `fog-${key}`, 0, 1e6, 10,
    d => d.environment.fog?.[key] ?? 0, (d, value) => { if (d.environment.fog) d.environment.fog[key] = value; }, d => !!d.environment.fog);
  for (const [key, label, min, max, step, fallback] of [
    ["baseHeight", "Fog Base Height", -1e6, 1e6, 1, 0], ["density", "Fog Density", 0, 10, .001, .01], ["falloff", "Height Falloff", 0, 10, .001, .02],
  ] as const) number(fog, label, `fog-${key}`, min, max, step, d => d.environment.fog?.height?.[key] ?? fallback,
    (d, value) => { if (d.environment.fog?.height) d.environment.fog.height[key] = value; }, d => !!d.environment.fog?.height);

  const shafts = group("Light Shafts", "shafts");
  const shaftToggle = toggle(shafts, "Sun Light Shafts", "shafts", d => !!d.environment.lightShafts, (d, enabled) => {
    if (!enabled) { delete d.environment.lightShafts; return; }
    d.environment.composition = "separated";
    d.light.directional ??= { direction: { x: -1, y: -1, elevation: 2 } };
    d.light.directional.shadows ??= { resolution: 512 };
    d.environment.lightShafts = {};
  });
  setUiAttribute(shaftToggle.input, "title", "Enables separated composition and sun shadows.");
  color(shafts, "Shaft Color", "shaft-color", d => d.environment.lightShafts?.color ?? [1, 1, 1],
    (d, value) => { if (d.environment.lightShafts) d.environment.lightShafts.color = value; }, d => !!d.environment.lightShafts);
  for (const [key, label, min, max, step, fallback] of [
    ["intensity", "Shaft Intensity", 0, 4, .05, .5], ["density", "Shaft Density", 0, 1, .001, .01],
    ["maxDistance", "Shaft Distance", .1, 10000, 10, 200], ["anisotropy", "Forward Scattering", 0, .9, .05, 0],
  ] as const) number(shafts, label, `shaft-${key}`, min, max, step, d => d.environment.lightShafts?.[key] ?? fallback,
    (d, value) => { if (d.environment.lightShafts) d.environment.lightShafts[key] = value; }, d => !!d.environment.lightShafts);
  select(shafts, "Shaft Quality", "shaft-quality", quality, d => d.environment.lightShafts?.quality ?? "balanced",
    (d, value) => { if (d.environment.lightShafts) d.environment.lightShafts.quality = value; }, d => !!d.environment.lightShafts);

  const probes = group("Indirect Light Probes", "probes"), probeList = document.createElement("select");
  probeList.dataset.placementLightingProbeIndex = "true"; setUiAttribute(probeList, "aria-label", "Indirect Light Probes"); probes.append(probeList);
  probeList.addEventListener("change", () => { selectedProbes.set(options.key(), Number(probeList.value)); options.refresh(); });
  const add = options.action("Add Probe", "add-probe", () => change(d => {
    const probes = d.light.probes ?? []; if (probes.length >= 8) return;
    selectedProbes.set(options.key(), probes.length);
    d.light.probes = [...probes, { position: { x: 0, y: 0, elevation: 0 }, radius: 100, color: [1, 1, 1], intensity: 1 }];
  }));
  const remove = options.action("Remove Probe", "remove-probe", () => change(d => {
    d.light.probes = d.light.probes?.filter((_, i) => i !== probeIndex()) ?? [];
  }));
  const actions = document.createElement("div"); actions.className = "placement-lighting-actions"; actions.append(add, remove); probes.append(actions);
  for (const axis of ["x", "y", "elevation"] as const) number(probes, axis === "elevation" ? "Height" : axis.toUpperCase(), `probe-${axis}`, -1e6, 1e6, 1,
    d => probe(d)?.position[axis] ?? 0, (d, value) => { const p = probe(d); if (p) p.position[axis] = value; }, d => !!probe(d));
  number(probes, "Probe Radius", "probe-radius", .1, 10000, 1, d => probe(d)?.radius ?? 100,
    (d, value) => { const p = probe(d); if (p) p.radius = value; }, d => !!probe(d));
  number(probes, "Probe Intensity", "probe-intensity", 0, 4, .05, d => probe(d)?.intensity ?? 1,
    (d, value) => { const p = probe(d); if (p) p.intensity = value; }, d => !!probe(d));
  color(probes, "Probe Color", "probe-color", d => probe(d)?.color ?? [1, 1, 1],
    (d, value) => { const p = probe(d); if (p) p.color = value; }, d => !!probe(d));
  const note = document.createElement("p"); note.className = "placement-tool-scope";
  setUiText(note, "Up to 8 probes. Zero intensity darkens the region."); probes.append(note);
  return { sync(d: PlacementLightingDraft) {
    for (const section of sections) section.hidden = !d.spatial;
    for (const row of spatialRows) row.hidden = !d.spatial;
    if (!d.spatial) return;
    const count = d.light.probes?.length ?? 0;
    selectedProbes.set(options.key(), Math.max(0, Math.min(probeIndex(), count - 1)));
    if (probeList.options.length !== count) probeList.replaceChildren(...Array.from({ length: count }, (_, i) => {
      const item = document.createElement("option"); item.value = String(i); return item;
    }));
    for (const [i, item] of [...probeList.options].entries()) setUiText(item, uiMessage("Probe {0}", i + 1));
    probeList.value = String(probeIndex()); probeList.hidden = !count; add.disabled = count >= 8; remove.disabled = !count;
    for (const sync of syncers) sync(d);
  } };
}
