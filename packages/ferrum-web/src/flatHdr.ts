import type { ResolvedLightingScene2D } from "./lightingTypes.js";

/** Scene-linear Flat world output; HUD starts after setLighting(false). */
export interface FlatHdrOptions {
  enabled?: boolean;
  /** Exposure compensation in stops, -10..10. Default 0. */
  exposure?: number;
  /** Default reinhard. none clips only at final SDR output. */
  toneMapping?: "none" | "reinhard" | "aces";
}
export interface ResolvedFlatHdrOptions {
  enabled: boolean;
  exposure: number;
  toneMapping: "none" | "reinhard" | "aces";
}

export function resolveFlatHdr(value: FlatHdrOptions | false): ResolvedFlatHdrOptions {
  if (value === false) return { enabled: false, exposure: 0, toneMapping: "reinhard" };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("lighting.hdr must be an object or false");
  for (const key of Object.keys(value)) if (!["enabled", "exposure", "toneMapping"].includes(key)) throw Error(`lighting.hdr.${key} is not supported`);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") throw Error("lighting.hdr.enabled must be a boolean");
  const exposure = value.exposure === undefined ? 0 : value.exposure, toneMapping = value.toneMapping === undefined ? "reinhard" : value.toneMapping;
  if (!Number.isFinite(exposure) || exposure < -10 || exposure > 10) throw Error("lighting.hdr.exposure must be in -10..10 stops");
  if (!["none", "reinhard", "aces"].includes(toneMapping)) throw Error("lighting.hdr.toneMapping must be none, reinhard or aces");
  return { enabled: value.enabled !== false, exposure, toneMapping };
}

export function flatHdrOptions(scene: ResolvedLightingScene2D): ResolvedFlatHdrOptions | undefined {
  return scene.enabled && scene.profile === "lit" && scene.hdr?.enabled ? scene.hdr : undefined;
}

/** Validate before flushing or changing any GPU state. One HDR world resolve per frame. */
export function validateFlatHdrTransition(next: ResolvedFlatHdrOptions | undefined, active: ResolvedFlatHdrOptions | undefined, drawn: boolean): void {
  if (next && !active && drawn) throw Error("Configure Flat HDR before world drawing starts; start a new frame before enabling it");
  if (next && active && (next.exposure !== active.exposure || next.toneMapping !== active.toneMapping))
    throw Error("Configure HDR exposure and tone mapping before world drawing starts");
}

export function flatHdrToneMapping(options: ResolvedFlatHdrOptions): number {
  return options.toneMapping === "none" ? 0 : options.toneMapping === "reinhard" ? 1 : 2;
}
