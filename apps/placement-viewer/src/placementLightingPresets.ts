import type { SpatialEnvironmentSpec } from "@ferrum2d/ferrum-web/core";
export type LightingMood = "Day" | "Sunset" | "Night" | "Interior";
export type LightingQuality = "Low" | "Balanced" | "High";
/** Replaces atmosphere only; placed lights, bindings and camera remain authored. */
export function lightingMood(environment: SpatialEnvironmentSpec, mood: LightingMood): SpatialEnvironmentSpec {
    const next = structuredClone(environment), lights = next.lighting?.lights ?? [], shadows = next.lighting?.shadows;
    const configs = {
        Day: { ambient: [.17, .19, .22], sky: [.65, .8, 1], ground: [.4, .3, .2], fill: .5, sun: [1, .94, .8], strength: .95, elevation: 2.4, exposure: 0 },
        Sunset: { ambient: [.12, .08, .12], sky: [.6, .4, .65], ground: [.4, .22, .12], fill: .4, sun: [1, .42, .16], strength: 1.2, elevation: .35, exposure: .1 },
        Night: { ambient: [.025, .035, .065], sky: [.2, .3, .65], ground: [.08, .08, .15], fill: .24, sun: [.35, .5, 1], strength: .24, elevation: 1.2, exposure: .2 },
        Interior: { ambient: [.05, .045, .04], sky: [.55, .48, .4], ground: [.3, .18, .1], fill: .2, sun: [1, .8, .5], strength: 0, elevation: 1, exposure: .1 },
    } as const;
    const c = configs[mood];
    next.lighting = { ...next.lighting, enabled: true, lights, ambient: c.ambient, hemisphere: { skyColor: c.sky, groundColor: c.ground, intensity: c.fill },
        directional: { direction: { x: -1, y: -1, elevation: c.elevation }, color: c.sun, intensity: c.strength,
            ...(mood === "Interior" ? {} : { shadows: next.lighting?.directional?.shadows ?? { resolution: 512, extent: 430, distance: 1400, bias: .07, normalBias: .35 } }) }, shadowFilter: "pcf3", ...(shadows ? { shadows } : {}) };
    next.colorGrading = { ...next.colorGrading, exposure: c.exposure, toneMapping: "aces", saturation: mood === "Night" ? .85 : 1 };
    next.bloom = { strength: mood === "Night" || mood === "Interior" ? .65 : .25, radius: 8, threshold: .8 };
    next.ambientOcclusion ??= { strength: .55, radius: 16, bias: .3 };
    return next;
}
export function lightingQuality(environment: SpatialEnvironmentSpec, quality: LightingQuality): SpatialEnvironmentSpec {
    const next = structuredClone(environment), low = quality === "Low", high = quality === "High";
    next.lighting ??= { lights: [] };
    next.lighting.maxActiveLights = low ? 1 : high ? 4 : 2;
    next.lighting.shadowFilter = low ? "hard" : "pcf3";
    const resolution = low ? 128 : high ? 1024 : 512;
    if (next.lighting.shadows)
        next.lighting.shadows.resolution = resolution;
    if (next.lighting.directional?.shadows)
        next.lighting.directional.shadows.resolution = resolution;
    if (low) {
        delete next.bloom;
        delete next.ambientOcclusion;
    }
    else {
        next.bloom ??= { strength: .5, radius: 8, threshold: 1 };
        next.ambientOcclusion ??= { strength: .55, radius: 16, bias: .3 };
    }
    return next;
}
