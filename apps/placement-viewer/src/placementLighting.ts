import type { SpatialEnvironmentSpec, SpatialLightingSpec, SpatialRgb, FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import type { LightingScene2D } from "@ferrum2d/ferrum-web/labs";
import type { ScenePlacementViewer, ScenePlacementViewerState } from "@ferrum2d/ferrum-web/authoring";
import { createPlacementLightGizmos } from "./placementLightGizmos";
import { placementLightAnchor } from "./placementSpatialPose";
import { lightingMood, lightingQuality, type LightingMood, type LightingQuality } from "./placementLightingPresets";
import { createPlacementControlMenu } from "./placementControlMenu";
import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";

type Draft = { spatial: true; environment: SpatialEnvironmentSpec; light: SpatialLightingSpec; bindings: Record<string,readonly number[]> }
  | { spatial: false; light: LightingScene2D };

/** Scene settings use the viewer's existing draft/history/native validation boundary. */
export function createPlacementLighting(options: {
  viewer: ScenePlacementViewer;
  canvas: HTMLCanvasElement; stage:HTMLElement;
  engine: FerrumRuntime["engine"];
  key(): string;
  mode(): "2d" | "spatial" | "game";
  runtimeRevision(): number;
  busy(): boolean;
  finishEdit(): void;
  clearSelection():void;
  hasObjectSelection():boolean;
  onChange(state: ScenePlacementViewerState): unknown;
}) {
  const menu = createPlacementControlMenu("lighting", "Lighting", "sun");
  menu.panel.classList.add("placement-lighting-panel");
  const hint = document.createElement("p"), message = document.createElement("p");
  message.className = "placement-lighting-error";
  message.setAttribute("role", "alert"); message.hidden = true;
  setUiText(hint, "Saved with the scene. Undo/Redo supported.");
  const form = document.createElement("fieldset");
  const master = checkbox("Scene Lighting", "enabled", value => change(d => { d.light.enabled = value; }));
  master.row.className = "placement-lighting-master";
  const ambient = section("Ambient Light");
  const hemisphere = section("Sky and Ground Light"), hemisphereForm=document.createElement("div");
  const hemisphereEnabled=checkbox("Hemisphere Light","hemisphere",value=>change(d=>{
    if(d.spatial)d.light.hemisphere={...(d.light.hemisphere ?? {}),enabled:value};
  }));
  hemisphere.append(hemisphereEnabled.row,hemisphereForm);
  const sun = section("Sunlight"), sunForm = document.createElement("div");
  const sunAdd = action("Add Sunlight", "add-sun", () => change(d => {
    if (d.spatial) d.light.directional = { direction: { x: -0.6, y: -0.4, elevation: 1 }, intensity: 0.9 };
    else d.light.directionalLight = { directionX: 0.6, directionY: 0.8, intensity: 0.15 };
  }));
  const sunRemove = action("Remove Sunlight", "remove-sun", () => change(d => {
    if (d.spatial) delete d.light.directional; else delete d.light.directionalLight;
  }));
  sun.append(sunAdd, sunForm);
  const points = section("Point Lights"), pointIndex = document.createElement("select"), pointForm = document.createElement("div");
  pointIndex.dataset.placementLightingPointIndex = "true";
  setUiAttribute(pointIndex, "aria-label", "Point Lights");
  const addPoint = action("Add Light", "add-point", () => change(d => {
    const selected = state.selected?.transform;
    const x = selected?.x ?? state.viewport.cameraX, y = selected?.y ?? state.viewport.cameraY;
    if (d.spatial) d.light.lights = [...d.light.lights, { position: { x, y, elevation: 64 }, radius: 160, intensity: 1, color: [1, 0.8, 0.5] }];
    else d.light.pointLights = [...(d.light.pointLights ?? []), { x, y, radius: 120, intensity: 0.8, color: [1, 0.8, 0.5, 1] }];
    selectedPoints.set(options.key(), count(d) - 1);
  }));
  const removePoint = action("Remove Light", "remove-point", () => change(d => {
    const index = selectedIndex();
    if (d.spatial) {
      for(const [id,indices] of Object.entries(d.bindings)) {
        const next=indices.filter(i=>i!==index).map(i=>i>index?i-1:i);
        if(next.length)d.bindings[id]=next;else delete d.bindings[id];
      }
      d.light.lights = d.light.lights.filter((_, i) => i !== index);
      if (d.light.shadows?.lightIndex === index) delete d.light.shadows;
      else if (d.light.shadows && d.light.shadows.lightIndex > index) d.light.shadows.lightIndex--;
    } else d.light.pointLights = d.light.pointLights?.filter((_, i) => i !== index);
  }));
  const pointActions = document.createElement("div"); pointActions.className = "placement-lighting-actions";
  pointActions.append(addPoint, removePoint); points.append(pointIndex, pointActions, pointForm);
  form.append(master.row, ambient, hemisphere, sun, points); menu.panel.append(hint, message, form);
  const fields: Array<{ input: HTMLInputElement; read(d: Draft): string | number; row: HTMLElement; apply(): boolean; visible?(d: Draft): boolean }> = [];
  let state = options.viewer.state(), nativeSunSignature = "";
  const selectedPoints = new Map<string, number>();
  const selectedIndex = () => selectedPoints.get(options.key()) ?? 0;
  pointIndex.addEventListener("change", () => { selectedPoints.set(options.key(), Number(pointIndex.value)); gizmos.select(); options.clearSelection(); sync(options.viewer.state()); });

  number(ambient, "Ambient Strength", "ambient", 0, 4, 0.05, d => d.spatial ? Math.max(...(d.light.ambient ?? [0.15, 0.15, 0.15])) : 1 - (d.light.ambient?.[3] ?? 0.45), (d, value) => {
    if (d.spatial) {
      const color = d.light.ambient ?? [0.15, 0.15, 0.15], max = Math.max(...color);
      d.light.ambient = color.map(c => max ? c / max * value : value) as unknown as SpatialRgb;
    } else {
      const color = d.light.ambient ?? [0, 0, 0, 0.45];
      d.light.ambient = [color[0], color[1], color[2], 1 - value];
    }
  });
  color(ambient, "Ambient Color", "ambient-color", d => d.light.ambient ?? (d.spatial ? [0.15, 0.15, 0.15] : [0, 0, 0, 0.45]), (d, rgb) => {
    if (d.spatial) {
      const strength = Math.max(...(d.light.ambient ?? [0.15, 0.15, 0.15]));
      const scale = strength / (Math.max(...rgb) || 1);
      d.light.ambient = rgb.map(c => c * scale) as unknown as SpatialRgb;
    } else d.light.ambient = [...rgb, d.light.ambient?.[3] ?? 0.45];
  });
  number(hemisphereForm,"Intensity","hemisphere-intensity",0,64,.05,d=>d.spatial?d.light.hemisphere?.intensity ?? .35:0,(d,value)=>{
    if(d.spatial && d.light.hemisphere)d.light.hemisphere.intensity=value;
  });
  color(hemisphereForm,"Sky Color","hemisphere-sky",d=>d.spatial?d.light.hemisphere?.skyColor ?? [.6,.75,1]:[1,1,1],(d,rgb)=>{
    if(d.spatial && d.light.hemisphere)d.light.hemisphere.skyColor=rgb;
  });
  color(hemisphereForm,"Ground Color","hemisphere-ground",d=>d.spatial?d.light.hemisphere?.groundColor ?? [.3,.22,.14]:[1,1,1],(d,rgb)=>{
    if(d.spatial && d.light.hemisphere)d.light.hemisphere.groundColor=rgb;
  });
  number(sunForm, "Intensity", "sun-intensity", 0, 64, 0.05, d => d.spatial ? d.light.directional?.intensity ?? 1 : d.light.directionalLight?.intensity ?? 0.15, (d, value) => {
    if (d.spatial && d.light.directional) d.light.directional.intensity = value;
    else if (!d.spatial && d.light.directionalLight) d.light.directionalLight.intensity = value;
  });
  color(sunForm, "Sun Color", "sun-color", d => (d.spatial ? d.light.directional?.color : d.light.directionalLight?.color) ?? [1, 1, 1], (d, rgb) => {
    if (d.spatial && d.light.directional) d.light.directional.color = rgb;
    else if (!d.spatial && d.light.directionalLight) d.light.directionalLight.color = rgb;
  });
  number(sunForm, "Direction (°)", "sun-direction", -180, 180, 1, d => {
    const v = d.spatial ? d.light.directional?.direction : undefined;
    return Math.atan2(v?.y ?? (!d.spatial ? d.light.directionalLight?.directionY ?? 1 : 0), v?.x ?? (!d.spatial ? d.light.directionalLight?.directionX ?? 1 : 1)) * 180 / Math.PI;
  }, (d, value) => {
    const angle = value * Math.PI / 180;
    if (d.spatial && d.light.directional) {
      const v = d.light.directional.direction, length = Math.hypot(v.x, v.y);
      d.light.directional.direction = { x: Math.cos(angle) * length, y: Math.sin(angle) * length, elevation: v.elevation };
    } else if (!d.spatial && d.light.directionalLight) {
      d.light.directionalLight.directionX = Math.cos(angle); d.light.directionalLight.directionY = Math.sin(angle);
    }
  });
  number(sunForm, "Sun Height (°)", "sun-height", -90, 90, 1, d => {
    if (!d.spatial || !d.light.directional) return 45;
    const v = d.light.directional.direction; return Math.atan2(v.elevation, Math.hypot(v.x, v.y)) * 180 / Math.PI;
  }, (d, value) => {
    if (!d.spatial || !d.light.directional) return;
    const v = d.light.directional.direction, yaw = Math.atan2(v.y, v.x), pitch = value * Math.PI / 180;
    d.light.directional.direction = { x: Math.cos(yaw) * Math.cos(pitch), y: Math.sin(yaw) * Math.cos(pitch), elevation: Math.sin(pitch) };
  }, d => d.spatial);
  const sunShadows = checkbox("Sun Shadows", "sun-shadows", value => change(d => {
    if (d.spatial && d.light.directional) {
      if (value) d.light.directional.shadows = { resolution: 512 };
      else delete d.light.directional.shadows;
    } else if (!d.spatial && d.light.directionalLight) d.light.directionalLight.shadowOpacity = value ? 0.35 : 0;
  }));
  sunForm.append(sunShadows.row);
  const sunNormalOffset=number(sunForm,"Shadow Surface Offset","sun-normal-bias",0,10,.05,d=>d.spatial?d.light.directional?.shadows?.normalBias ?? 0:0,(d,value)=>{
    if(d.spatial && d.light.directional?.shadows)d.light.directional.shadows.normalBias=value;
  },d=>d.spatial && !!d.light.directional?.shadows);
  setUiAttribute(sunNormalOffset,"title","Reduce shadow speckles; large values detach shadows.");
  sunForm.append(sunRemove);

  for (const axis of ["x", "y", "elevation"] as const) number(pointForm, axis === "elevation" ? "Height" : axis.toUpperCase(), `point-${axis}`, -1e6, 1e6, 1,
    d => { const light = point(d); return light ? "position" in light ? light.position[axis] : axis === "elevation" ? 0 : light[axis] : 0; },
    (d, value) => { const light = point(d); if (light) { if ("position" in light) light.position[axis] = value; else if (axis !== "elevation") light[axis] = value; } }, d => axis !== "elevation" || d.spatial);
  number(pointForm, "Radius", "point-radius", 0.1, 1e6, 1, d => point(d)?.radius ?? 120, (d, value) => { const p = point(d); if (p) p.radius = value; });
  number(pointForm, "Intensity", "point-intensity", 0, 64, 0.05, d => point(d)?.intensity ?? 1, (d, value) => { const p = point(d); if (p) p.intensity = value; });
  color(pointForm, "Light Color", "point-color", d => point(d)?.color ?? [1, 1, 1], (d, rgb) => {
    const p = point(d); if (p) p.color = "position" in p ? rgb : [...rgb, p.color?.[3] ?? 1];
  });
  const shadows = checkbox("Point Shadows", "point-shadows", value => change(d => {
    if (d.spatial) { if (value) d.light.shadows = { ...(d.light.shadows ?? {}), lightIndex: selectedIndex() }; else delete d.light.shadows; }
    else d.light.shadows = { ...(typeof d.light.shadows === "object" ? d.light.shadows : {}), enabled: value };
  }));
  pointForm.append(shadows.row);
  const pointNormalOffset=number(pointForm,"Shadow Surface Offset","point-normal-bias",0,10,.05,d=>d.spatial?d.light.shadows?.normalBias ?? 0:0,(d,value)=>{
    if(d.spatial && d.light.shadows)d.light.shadows.normalBias=value;
  },d=>d.spatial && d.light.shadows?.lightIndex===selectedIndex());
  setUiAttribute(pointNormalOffset,"title","Reduce shadow speckles; large values detach shadows.");

  const atmosphere=section("Atmosphere"), moodSelect=document.createElement("select"), qualitySelect=document.createElement("select");
  function choices(select:HTMLSelectElement,label:string,values:readonly string[],apply:(value:string)=>void) {
    setUiAttribute(select,"aria-label",label);select.dataset.placementLightingPreset=label;
    const placeholder=document.createElement("option");placeholder.value="";setUiText(placeholder,label);select.append(placeholder);
    for(const value of values){const o=document.createElement("option");o.value=value;setUiText(o,value);select.append(o);}
    select.addEventListener("change",()=>{if(select.value)apply(select.value);select.value="";});
  }
  choices(moodSelect,"Atmosphere Preset",["Day","Sunset","Night","Interior"],value=>change(d=>{
    if(d.spatial){d.environment=lightingMood({...d.environment,lighting:d.light},value as LightingMood);d.light=d.environment.lighting!;}
  }));
  choices(qualitySelect,"Lighting Quality",["Low","Balanced","High"],value=>change(d=>{
    if(d.spatial){d.environment=lightingQuality({...d.environment,lighting:d.light},value as LightingQuality);d.light=d.environment.lighting!;}
  }));
  const budgetStatus=document.createElement("output");budgetStatus.dataset.placementLightingBudget="true";
  atmosphere.append(moodSelect,qualitySelect,budgetStatus);form.insertBefore(atmosphere,ambient);
  number(atmosphere,"Active Light Budget","light-budget",1,4,1,d=>d.spatial?d.light.maxActiveLights??4:4,(d,value)=>{if(d.spatial)d.light.maxActiveLights=value as 1|2|3|4;});
  const bloom=checkbox("Scene Bloom","bloom",value=>change(d=>{if(d.spatial){if(value)d.environment.bloom={strength:.5,radius:8,threshold:1};else delete d.environment.bloom;}}));
  const ao=checkbox("Contact Occlusion","ao",value=>change(d=>{if(d.spatial){if(value)d.environment.ambientOcclusion={strength:.6,radius:16,bias:.3};else delete d.environment.ambientOcclusion;}}));
  atmosphere.append(bloom.row,ao.row);
  for(const [key,label,min,max,step] of [["strength","Bloom Strength",0,4,.05],["radius","Bloom Radius",.1,24,.5],["threshold","Bloom Threshold",0,64,.1]] as const)
    number(atmosphere,label,`bloom-${key}`,min,max,step,d=>d.spatial?d.environment.bloom?.[key]??0:0,(d,value)=>{if(d.spatial&&d.environment.bloom)d.environment.bloom[key]=value;},d=>d.spatial&&!!d.environment.bloom);
  for(const [key,label,min,max,step] of [["strength","Occlusion Strength",0,1,.05],["radius","Occlusion Radius",.1,1000,1],["bias","Occlusion Bias",0,100,.1]] as const)
    number(atmosphere,label,`ao-${key}`,min,max,step,d=>d.spatial?d.environment.ambientOcclusion?.[key]??0:0,(d,value)=>{if(d.spatial&&d.environment.ambientOcclusion)d.environment.ambientOcclusion[key]=value;},d=>d.spatial&&!!d.environment.ambientOcclusion);
  number(sunForm,"Shadow Coverage","shadow-coverage",1,10000,10,d=>d.spatial?d.light.directional?.shadows?.extent??256:256,(d,value)=>{if(d.spatial&&d.light.directional?.shadows)d.light.directional.shadows.extent=value;},d=>d.spatial&&!!d.light.directional?.shadows);
  const spot=checkbox("Spotlight","spot",value=>change(d=>{const p=point(d);if(p&&"position" in p){if(value)p.spot={direction:{x:0,y:1,elevation:-1},angle:45,penumbra:.25};else delete p.spot;}}));
  pointForm.append(spot.row);
  for(const axis of ["x","y","elevation"] as const)
    number(pointForm,`Cone ${axis}`,`spot-${axis}`,-1e6,1e6,.1,d=>{const p=point(d);return p&&"position" in p?p.spot?.direction[axis]??0:0;},(d,value)=>{const p=point(d);if(p&&"position" in p&&p.spot)p.spot.direction[axis]=value;},d=>{const p=point(d);return !!(d.spatial&&p&&"position" in p&&p.spot);});
  for(const [key,label,min,max,step] of [["angle","Cone Angle",1,89,1],["penumbra","Soft Edge",0,1,.05]] as const)
    number(pointForm,label,`spot-${key}`,min,max,step,d=>{const p=point(d);return p&&"position" in p?p.spot?.[key]??0:0;},(d,value)=>{const p=point(d);if(p&&"position" in p&&p.spot)p.spot[key]=value;},d=>{const p=point(d);return !!(d.spatial&&p&&"position" in p&&p.spot);});
  const bindingRow=document.createElement("label"),bindingText=document.createElement("span"),bindingSelect=document.createElement("select");
  setUiText(bindingText,"Attach Light");setUiAttribute(bindingSelect,"aria-label","Attach Light");bindingSelect.dataset.placementLightingBinding="true";bindingRow.append(bindingText,bindingSelect);pointForm.append(bindingRow);
  bindingSelect.addEventListener("change",()=>change(d=>{
    if(!d.spatial)return;const index=selectedIndex(),p=d.light.lights[index];if(!p)return;
    const previous=Object.entries(d.bindings).find(([,indices])=>indices.includes(index))?.[0] ?? (p.followActor ? state.spatial?.actor?.instanceId : undefined);
    const before=placementLightAnchor(state,previous),after=placementLightAnchor(state,bindingSelect.value||undefined);
    p.position={x:p.position.x+before.x-after.x,y:p.position.y+before.y-after.y,elevation:p.position.elevation+before.elevation-after.elevation};
    delete p.followActor;
    for(const [id,indices]of Object.entries(d.bindings)){const next=indices.filter(i=>i!==index);if(next.length)d.bindings[id]=next;else delete d.bindings[id];}
    if(bindingSelect.value)d.bindings[bindingSelect.value]=[...(d.bindings[bindingSelect.value]??[]),index];
    d.light.maxActiveLights??=4;
  }));

  function draft(): Draft {
    if (state.spatial) {
      const environment = structuredClone(state.spatial.environment ?? {});
      return { spatial: true, environment, bindings: structuredClone(state.spatial.lightBindings??{}), light: environment.lighting ?? { enabled: false, ambient: [0.35, 0.35, 0.4], lights: [] } };
    }
    return { spatial: false, light: structuredClone(state.lighting ?? { enabled: false, ambient: [0, 0, 0, 0.25], pointLights: [] }) };
  }
  function count(d: Draft) { return d.spatial ? d.light.lights.length : d.light.pointLights?.length ?? 0; }
  function point(d: Draft) { return d.spatial ? d.light.lights[selectedIndex()] : d.light.pointLights?.[selectedIndex()]; }
  function change(edit: (d: Draft) => void) {
    if (options.busy() || options.mode() === "game" || (state.spatial && options.mode() !== "spatial")) return false;
    try {
      options.finishEdit(); const next = draft(); edit(next);
      const changed = next.spatial
        ? options.viewer.updateSpatial([{ kind: "setEnvironment", changes: { environment: { ...next.environment, lighting: next.light }, lightBindings: next.bindings } }])
        : options.viewer.updateLighting(next.light);
      options.onChange(changed); message.hidden = true;
      return true;
    } catch (error) {
      setUiText(message, error instanceof Error ? error.message : String(error)); message.hidden = false;
      options.onChange(options.viewer.state());
      return false;
    }
  }
  function section(label: string) { const group = document.createElement("fieldset"), legend = document.createElement("legend"); setUiText(legend, label); group.append(legend); return group; }
  function action(label: string, name: string, run: () => void) {
    const button = document.createElement("button"); button.type = "button"; setUiText(button, label);
    button.dataset.placementLightingAction = name; button.addEventListener("click", run); return button;
  }
  function checkbox(label: string, name: string, run: (value: boolean) => void) {
    const row = document.createElement("label"), input = document.createElement("input"), text = document.createElement("span");
    input.type = "checkbox"; input.dataset.placementLightingToggle = name; setUiText(text, label); row.append(input, text);
    input.addEventListener("change", () => run(input.checked)); return { row, input };
  }
  function field(parent: HTMLElement, label: string, name: string, type: string, read: (d: Draft) => string | number, write: (d: Draft, value: string) => void, visible?: (d: Draft) => boolean) {
    const row = document.createElement("label"), text = document.createElement("span"), input = document.createElement("input");
    setUiText(text, label); input.type = type; input.dataset.placementLightingField = name;
    setUiAttribute(input, "aria-label", label); row.append(text, input); parent.append(row);
    const apply = () => {
      if (!input.validity.valid || (type === "number" && !Number.isFinite(input.valueAsNumber))) {
        setUiText(message, "Enter a valid light value"); message.hidden = false; return false;
      }
      const accepted = String(read(draft()));
      if (type === "number" ? Number(input.value) === Number(accepted) : input.value === accepted) { message.hidden = true; return true; }
      return change(d => write(d, input.value));
    };
    fields.push({ row, input, read, visible, apply });
    input.addEventListener("change", apply);
    input.addEventListener("keydown", event => {
      if (event.code === "Enter") { event.preventDefault(); event.stopPropagation(); input.dispatchEvent(new Event("change")); }
      if (event.code === "Escape" && (input.value !== String(read(draft())) || !message.hidden)) {
        event.preventDefault(); event.stopPropagation(); input.value = String(read(draft())); message.hidden = true;
      }
    });
    return input;
  }
  function number(parent: HTMLElement, label: string, name: string, min: number, max: number, step: number, read: (d: Draft) => number, write: (d: Draft, value: number) => void, visible?: (d: Draft) => boolean) {
    const input = field(parent, label, name, "number", d => Number(read(d).toFixed(4)), (d, value) => write(d, Number(value)), visible);
    input.min = String(min); input.max = String(max); input.step = "any";
    input.addEventListener("keydown", event => {
      if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return;
      event.preventDefault(); event.stopPropagation();
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) return;
      const next = value + (event.code === "ArrowUp" ? step : -step) * (event.shiftKey ? 0.1 : event.ctrlKey || event.metaKey ? 10 : 1);
      input.value = String(Number(Math.max(Number(input.min), Math.min(Number(input.max), next)).toFixed(6)));
      input.dispatchEvent(new Event("change"));
    });
    return input;
  }
  function color(parent: HTMLElement, label: string, name: string, read: (d: Draft) => readonly number[], write: (d: Draft, rgb: [number, number, number]) => void) {
    field(parent, label, name, "color", d => {
      const rgb = read(d), divisor = d.spatial && name === "ambient-color" ? Math.max(...rgb.slice(0, 3)) || 1 : Math.max(1, ...rgb.slice(0, 3));
      return "#" + rgb.slice(0, 3).map(c => Math.round(c / divisor * 255).toString(16).padStart(2, "0")).join("");
    }, (d, hex) => write(d, [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number]));
  }
  function sync(next: ScenePlacementViewerState) {
    state = next;
    gizmos.sync(next);
    const light = state.lighting, sun = !state.spatial && light?.enabled !== false ? light?.directionalLight : undefined;
    const signature = JSON.stringify([options.runtimeRevision(), sun ?? false]);
    if (signature !== nativeSunSignature) {
      if (!options.engine.setDataSceneSun(sun ?? false)) throw new Error("Scene lighting change rejected");
      nativeSunSignature = signature;
    }
    const d = draft(), total = count(d), index = Math.max(0, Math.min(selectedIndex(), total - 1));
    selectedPoints.set(options.key(), index);
    form.disabled = options.busy() || options.mode() === "game" || (!!state.spatial && options.mode() !== "spatial");
    setUiText(hint, options.mode() === "game" ? "Stop to edit scene lighting." : state.spatial && options.mode() !== "spatial" ? "Use HD-2D to edit spatial lighting." : "Saved with the scene. Undo/Redo supported.");
    master.input.checked = d.light.enabled !== false;
    atmosphere.hidden=!d.spatial;spot.row.hidden=!d.spatial;bindingRow.hidden=!d.spatial;
    bloom.input.checked=d.spatial&&!!d.environment.bloom;ao.input.checked=d.spatial&&!!d.environment.ambientOcclusion;
    const current=point(d);spot.input.checked=!!(current&&"position" in current&&current.spot);
    const bindingIds=state.instances.map(i=>i.instanceId);
    if(bindingSelect.dataset.ids!==JSON.stringify(bindingIds)){
      bindingSelect.replaceChildren();const world=document.createElement("option");world.value="";setUiText(world,"World Position");bindingSelect.append(world);
      for(const id of bindingIds){const o=document.createElement("option");o.value=id;o.textContent=id;bindingSelect.append(o);}bindingSelect.dataset.ids=JSON.stringify(bindingIds);
    }
    bindingSelect.value=d.spatial?Object.entries(d.bindings).find(([,indices])=>indices.includes(index))?.[0]??(d.light.lights[index]?.followActor?state.spatial?.actor?.instanceId:undefined)??"":"";
    helpers.row.hidden=!d.spatial;
    hemisphere.hidden=!d.spatial;
    hemisphereEnabled.input.checked=d.spatial && !!d.light.hemisphere && d.light.hemisphere.enabled!==false;
    hemisphereForm.hidden=!hemisphereEnabled.input.checked;
    const sunlight = d.spatial ? d.light.directional : d.light.directionalLight;
    sunForm.hidden = !sunlight; sunAdd.hidden = !!sunlight;
    sunShadows.input.checked = d.spatial ? !!d.light.directional?.shadows : (d.light.directionalLight?.shadowOpacity ?? 0.35) > 0;
    if (pointIndex.options.length !== total) pointIndex.replaceChildren(...Array.from({ length: total }, (_, i) => {
      const option = document.createElement("option"); option.value = String(i); return option;
    }));
    for (const [i, option] of [...pointIndex.options].entries()) setUiText(option, uiMessage("Light {0}", i + 1));
    pointIndex.value = String(index); pointIndex.hidden = !total; pointForm.hidden = !total; removePoint.disabled = !total;
    addPoint.disabled = total >= (d.spatial ? 16 : 32);
    for (const f of fields) {
      f.row.hidden = f.visible ? !f.visible(d) : false;
      if (document.activeElement !== f.input) f.input.value = String(f.read(d));
      if (f.input.dataset.placementLightingField === "ambient" || f.input.dataset.placementLightingField === "sun-intensity") f.input.max = String(d.spatial ? f.input.dataset.placementLightingField === "ambient" ? 4 : 64 : 1);
    }
    shadows.input.checked = d.spatial ? d.light.shadows?.lightIndex === index : typeof d.light.shadows === "object" ? d.light.shadows.enabled !== false : d.light.shadows === true;
  }
  const helpers=checkbox("Light Helpers","helpers",()=>{});helpers.input.checked=true;points.prepend(helpers.row);
  const gizmos=createPlacementLightGizmos({...options,enabled:()=>options.mode()==="spatial"&&helpers.input.checked,
    selected: selectedIndex,select(index){selectedPoints.set(options.key(),index);options.clearSelection();sync(options.viewer.state());}});
  return { element: menu.element, sync, ownsGesture:gizmos.ownsGesture, frame(update:Parameters<typeof gizmos.frame>[0]){gizmos.frame(update);const spatial=update.frame.renderCommandBuffer.spatial?.environment?.values;setUiText(budgetStatus,uiMessage("Active {0} / Authored {1}",spatial?.[1]??0,state.spatial?.environment?.lighting?.lights.length??0));}, flatLighting: () => state.spatial ? undefined : state.lighting,
    flushInput() {
      gizmos.cancel();
      const field = fields.find(field => field.input === document.activeElement);
      return field?.apply() ?? true;
    },
  };
}
