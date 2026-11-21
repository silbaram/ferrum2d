/** @internal Host section data policy. No normalization, host invocation or native queries. */
import { ResourceBudget, resourceFinite, resourceInteger } from "./nativeFileResourceBudget.js";
import { hostArray, hostBool, hostEntries, hostEnum, hostName, hostNonNegativeInteger, hostRecord, validateHostDebug, validateHostPhysics, type HostRecord } from "./nativeFileRuntimeHostPhysics.js";

export const HOST_OPTIONS = ["includeDeprecatedRenderCommands", "useWorkerClock", "includeAudioEvents", "includeCollisionEvents", "includeGameplayEvents", "includeEffectEvents", "effectEvents", "enablePhysicsDebugLines", "physicsDebugOptions", "includePhysicsDebugLines", "fixedTimestep", "physicsBackend", "physicsMode", "lifecycle"] as const;
export const HOST_LIFECYCLE = ["onStart", "onPause", "onResume", "onStop", "onDestroy"] as const;
export const HOST_EFFECT_CALLBACKS = ["hasSoundEffect", "hasParticlePreset", "target", "shakeCameraEffect", "applyCustomEffect", "onDispatchSummary"] as const;
export const HOST_EFFECT_DATA = ["registry", "assetValidation", "path", "unknownEffect", "requireKindMatch", "missingHandler"] as const;
export const HOST_FRAME = ["onFrame", "onRenderFrame", "inputProvider", "viewportProvider", "needsFrameState", "needsPhysicsDebugLineBuffer"] as const;
export const HOST_ROLES = [
  "frame.onFrame", "frame.onRenderFrame", "frame.inputProvider", "frame.viewportProvider",
  ...HOST_LIFECYCLE.map(k => `options.lifecycle.${k}` as const),
  ...HOST_EFFECT_CALLBACKS.map(k => `options.effectEvents.${k}` as const),
] as const;
export type NativeFileRuntimeHostRole = typeof HOST_ROLES[number];
export interface RuntimeHostDocument {
  readonly format: "ferrum-native-runtime-host";
  readonly version: 1;
  readonly metadata: HostRecord;
  readonly options: HostRecord;
  readonly frame: HostRecord;
  readonly bindings: readonly { readonly role: NativeFileRuntimeHostRole; readonly reference: { readonly kind: string; readonly version: number; readonly symbol: string } }[];
}
function optBool(r: HostRecord, k: string, b: ResourceBudget): void { if (r[k] !== undefined) hostBool(r[k], b, k); }
function marker(v: unknown, role: string, b: ResourceBudget, roles: string[]): void {
  if (v === null) roles.push(role); else if (v !== undefined) b.fail("DATA", role);
}
function effectString(v: unknown, b: ResourceBudget, p: string): void {
  if (typeof v !== "string" || v.length === 0) b.fail("DATA", p); b.metadata(v);
}
function sameEffect(a: unknown, v: unknown, b: ResourceBudget): boolean {
  if (a === v) return true;
  if (!a || !v || typeof a !== "object" || typeof v !== "object") return false;
  const x = a as HostRecord, y = v as HostRecord;
  b.work(10);
  for (const k of ["effect", "effectId", "kind", "key", "soundId", "particlePresetId", "intensity", "radius"]) if (!Object.is(x[k], y[k])) return false;
  if (!Array.isArray(x.tags) || !Array.isArray(y.tags) || x.tags.length !== y.tags.length) return false;
  b.work(x.tags.length); for (let i = 0; i < x.tags.length; i++) if (x.tags[i] !== y.tags[i]) return false;
  return true;
}
function registry(value: unknown, b: ResourceBudget): void {
  const r = hostRecord(value, ["effects", "byId", "ids"], b, "effect registry");
  const effects = hostEntries(r.effects, b, "effects"), byId = hostEntries(r.byId, b, "byId");
  if (effects.length !== byId.length) b.fail("DATA", "effect index census");
  const indexed = r.byId as HostRecord;
  for (const [name, v] of effects) {
    effectString(name, b, "effect name");
    const e = hostRecord(v, ["effect", "effectId", "kind", "key", "soundId", "particlePresetId", "intensity", "radius", "tags"], b, "effect");
    const id = resourceInteger(e.effectId, "effectId", 1);
    if (e.effect !== name || !Object.prototype.hasOwnProperty.call(indexed, String(id)) || !sameEffect(indexed[id], v, b)) b.fail("DATA", "effect index values");
    hostEnum(e.kind, ["sound", "particle", "cameraShake", "custom"], b, "effect kind");
    if (e.key !== undefined) effectString(e.key, b, "key");
    for (const k of ["soundId", "particlePresetId"]) if (e[k] !== undefined) hostNonNegativeInteger(e[k], b, k);
    for (const k of ["intensity", "radius"]) if (e[k] !== undefined) resourceFinite(e[k], k, 0);
    for (const tag of hostArray(e.tags, b, "tags")) effectString(tag, b, "tag");
  }
  for (const [key, value] of byId) {
    const e = hostRecord(value, ["effect", "effectId", "kind", "key", "soundId", "particlePresetId", "intensity", "radius", "tags"], b, "effect index");
    if (String(e.effectId) !== key || !Object.prototype.hasOwnProperty.call(r.effects, e.effect as string) || !sameEffect((r.effects as HostRecord)[e.effect as string], value, b)) b.fail("DATA", "effect reverse index");
  }
  const ids = hostRecord(r.ids, ["items", "actions", "prefabs", "timers", "tags", "effects", "variables"], b, "effect runtime ids");
  for (const [domain, values] of Object.entries(ids)) {
    if (values === undefined) continue;
    for (const [name, id] of hostEntries(values, b, domain)) { b.metadata(name); resourceFinite(id, domain); }
  }
  // Effects are resolved against this exact mapping. Other domains may be sparse.
  if (effects.length && ids.effects === undefined) b.fail("DATA", "effect ids");
  for (const [name, value] of effects) if ((ids.effects as HostRecord)[name] !== (value as HostRecord).effectId) b.fail("DATA", "effect ids");
}
export function validateRuntimeHostDocument(value: unknown, b: ResourceBudget): RuntimeHostDocument {
  const d = hostRecord(value, ["format", "version", "metadata", "options", "frame", "bindings"], b, "host document");
  if (d.format !== "ferrum-native-runtime-host" || d.version !== 1) b.fail("DATA", "host schema");
  const m = hostRecord(d.metadata, ["initialPhysicsSpec", "physicsSpec", "physicsSpecScene", "particlePresetIds", "lastViewportWidth", "lastViewportHeight", "viewportDirty"], b, "metadata");
  validateHostPhysics(m.initialPhysicsSpec, b, "initialPhysicsSpec"); validateHostPhysics(m.physicsSpec, b, "physicsSpec");
  if (m.physicsSpecScene !== undefined) resourceInteger(m.physicsSpecScene, "physicsSpecScene", 0, 4);
  const presets = hostArray(m.particlePresetIds, b, "particlePresetIds");
  b.charge("decodedBytes", presets.length * 16); const seen = new Set<number>();
  for (const id of presets) { const n = resourceInteger(id, "preset id"); if (seen.has(n)) b.fail("DATA", "duplicate preset"); seen.add(n); }
  for (const k of ["lastViewportWidth", "lastViewportHeight"]) if (m[k] !== undefined) resourceFinite(m[k], k);
  optBool(m, "viewportDirty", b);
  const o = hostRecord(d.options, HOST_OPTIONS, b, "options"), roles: string[] = [];
  b.charge("decodedBytes", HOST_ROLES.length * 16);
  for (const k of ["includeDeprecatedRenderCommands", "useWorkerClock", "includeAudioEvents", "includeCollisionEvents", "includeGameplayEvents", "includeEffectEvents", "includePhysicsDebugLines"]) optBool(o, k, b);
  if (o.physicsBackend !== undefined) hostEnum(o.physicsBackend, ["legacy", "unified"], b, "physicsBackend");
  if (o.physicsMode !== undefined) hostEnum(o.physicsMode, ["none", "arcade", "rigid"], b, "physicsMode");
  if (o.physicsDebugOptions !== undefined) validateHostDebug(o.physicsDebugOptions, b, "physicsDebugOptions");
  if (o.enablePhysicsDebugLines !== undefined && typeof o.enablePhysicsDebugLines !== "boolean") validateHostDebug(o.enablePhysicsDebugLines, b, "enablePhysicsDebugLines");
  if (o.fixedTimestep !== undefined && typeof o.fixedTimestep !== "boolean") {
    const c = hostRecord(o.fixedTimestep, ["interpolate", "enabled", "stepSeconds", "maxFrameSeconds", "maxStepsPerUpdate"], b, "fixedTimestep");
    optBool(c, "interpolate", b); optBool(c, "enabled", b);
    // Raw creation options are retained independently of the current native clock.
    // Legacy setters accept and clamp a wider range; do not apply unified bounds here.
    for (const k of ["stepSeconds", "maxFrameSeconds"]) if (c[k] !== undefined) resourceFinite(c[k], k);
    if (c.maxStepsPerUpdate !== undefined) resourceFinite(c.maxStepsPerUpdate, "maxStepsPerUpdate");
  }
  if (o.lifecycle !== undefined) {
    const l = hostRecord(o.lifecycle, HOST_LIFECYCLE, b, "lifecycle");
    for (const k of HOST_LIFECYCLE) marker(l[k], `options.lifecycle.${k}`, b, roles);
  }
  if (o.effectEvents !== undefined && o.effectEvents !== false) {
    const e = hostRecord(o.effectEvents, [...HOST_EFFECT_DATA, ...HOST_EFFECT_CALLBACKS], b, "effectEvents"); registry(e.registry, b);
    if (e.assetValidation !== undefined) hostEnum(e.assetValidation, ["ignore", "error"], b, "assetValidation");
    if (e.unknownEffect !== undefined) hostEnum(e.unknownEffect, ["error", "ignore", "passthrough"], b, "unknownEffect");
    if (e.missingHandler !== undefined) hostEnum(e.missingHandler, ["error", "ignore"], b, "missingHandler");
    if (e.path !== undefined && typeof e.path !== "string") b.fail("DATA", "effect path"); optBool(e, "requireKindMatch", b);
    for (const k of HOST_EFFECT_CALLBACKS) marker(e[k], `options.effectEvents.${k}`, b, roles);
  }
  const frame = hostRecord(d.frame, HOST_FRAME, b, "frame");
  for (const k of ["needsFrameState", "needsPhysicsDebugLineBuffer"]) optBool(frame, k, b);
  for (const k of ["onFrame", "onRenderFrame", "inputProvider", "viewportProvider"]) marker(frame[k], `frame.${k}`, b, roles);
  const bindings = hostArray(d.bindings, b, "bindings", 0, HOST_ROLES.length);
  if (bindings.length !== roles.length) b.fail("DATA", "binding census");
  const found = new Set<string>();
  for (const row of bindings) {
    const entry = hostRecord(row, ["role", "reference"], b, "binding row");
    hostEnum(entry.role, HOST_ROLES, b, "binding role"); const role = entry.role as string;
    if (!roles.includes(role) || found.has(role)) b.fail("DATA", "binding role census"); found.add(role);
    const reference = hostRecord(entry.reference, ["kind", "version", "symbol"], b, "binding reference");
    hostName(reference.kind, b, "kind"); resourceInteger(reference.version, "version", 1); hostName(reference.symbol, b, "symbol");
  }
  return d as unknown as RuntimeHostDocument;
}
