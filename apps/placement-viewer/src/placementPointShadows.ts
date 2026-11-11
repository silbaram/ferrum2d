import type { SpatialLightingSpec, SpatialPointShadowSpec } from "@ferrum2d/ferrum-web/core";

export function placementPointShadow(light: SpatialLightingSpec, index: number): SpatialPointShadowSpec | undefined {
  return light.pointShadows?.find(shadow => shadow.lightIndex === index)
    ?? (light.shadows?.lightIndex === index ? light.shadows : undefined);
}

/** A second checked owner promotes the existing single source without losing its settings. */
export function setPlacementPointShadow(light: SpatialLightingSpec, index: number, enabled: boolean): void {
  if (enabled && placementPointShadow(light, index)) return;
  const owners = [...(light.pointShadows ?? (light.shadows ? [light.shadows] : []))];
  if (enabled && owners.length >= 2) return;
  if (!light.pointShadows && !enabled) {
    if (light.shadows?.lightIndex === index) delete light.shadows;
    return;
  }
  if (!light.pointShadows && enabled && !owners.length) {
    light.shadows = { lightIndex: index };
    return;
  }
  const next = enabled ? [...owners, { lightIndex: index }] : owners.filter(shadow => shadow.lightIndex !== index);
  delete light.shadows;
  if (next.length) light.pointShadows = next;
  else delete light.pointShadows;
  if (next.length === 2 && light.maxActiveLights === 1) light.maxActiveLights = 2;
}

/** Authored light indices move when a source is deleted, including non-shadow sources. */
export function removePlacementPointShadowSource(light: SpatialLightingSpec, index: number): void {
  if (light.pointShadows) {
    const next = light.pointShadows.filter(shadow => shadow.lightIndex !== index)
      .map(shadow => ({ ...shadow, lightIndex: shadow.lightIndex > index ? shadow.lightIndex - 1 : shadow.lightIndex }));
    if (next.length) light.pointShadows = next;
    else delete light.pointShadows;
  }
  if (light.shadows?.lightIndex === index) delete light.shadows;
  else if (light.shadows && light.shadows.lightIndex > index) light.shadows.lightIndex--;
}
