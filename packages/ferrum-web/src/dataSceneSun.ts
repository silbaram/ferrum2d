import {resolveLightingChannelMask} from "./lightingMasks.js";
import type { Engine } from "../pkg/ferrum_core.js";
import type { DirectionalLight2D, ResolvedDirectionalLight2D } from "./lightingTypes.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";

/** Optional simple/alpha silhouette or footprint/wall/gable ground-shadow volume. */
export type DataSceneGroundShadowSpec = {
  opacity?: number;
  /** Defaults to one render layer below its owner. */
  layer?: number;
} & ({ shape: "ellipse" | "box" | "alpha"; width?: number; height?: number }
  | { shape: "volume"; width: number; depth: number; height: number;
      roofHeight?: number; offsetX?: number; offsetY?: number });
export type ResolvedDataSceneGroundShadow = {
  width: number;
  height: number;
  opacity: number;
  layer?: number;
} & ({shape:"ellipse"|"box"|"alpha"}
  | {shape:"volume";depth:number;roofHeight:number;offsetX:number;offsetY:number});
export interface DataSceneGroundShadowStats {
  casters: number;
  cacheHits: number;
  rebuilds: number;
  culled: number;
  skippedByBudget: number;
}

/** direction is the direction shadows travel on the ground, not a direction toward the sun. */
export function resolveDirectionalLight2D(light: DirectionalLight2D): ResolvedDirectionalLight2D {
  if(light&&(light.lightMask!==undefined||light.shadowMask!==undefined))throw Error("Light channel masks require the flat lit profile");
  return resolveSun(light, 1);
}

/** Internal lit radiance validation; the legacy public normalizer remains bounded to one. */
export function resolveLitDirectionalLight2D(light: DirectionalLight2D): ResolvedDirectionalLight2D {
  return resolveSun(light, 64);
}

function resolveSun(light: DirectionalLight2D, maxIntensity: number): ResolvedDirectionalLight2D {
  if (typeof light !== "object" || light === null) throw new Error("directionalLight must be an object");
  const x = finite(light.directionX, "directionalLight.directionX"), y = finite(light.directionY, "directionalLight.directionY");
  const length = Math.hypot(x, y);
  if (length < 0.000001) throw new Error("directionalLight direction must be nonzero");
  const intensity = range(light.intensity ?? 0.15, 0, maxIntensity, "directionalLight.intensity");
  const shadowOpacity = range(light.shadowOpacity ?? 0.35, 0, 1, "directionalLight.shadowOpacity");
  const shadowLengthScale = range(light.shadowLengthScale ?? 0.8, 0.01, 100, "directionalLight.shadowLengthScale");
  const maxCasters = range(light.maxCasters ?? 512, 0, 10000, "directionalLight.maxCasters");
  if (!Number.isInteger(maxCasters)) throw new Error("directionalLight.maxCasters must be an integer");
  const color = light.color ?? [1, 0.98, 0.9];
  if (color.length !== 3) throw new Error("directionalLight.color must have three channels");
  return { ...(light.lightMask===undefined?{}:{lightMask:resolveLightingChannelMask(light.lightMask,"directionalLight.lightMask")}),
    ...(light.shadowMask===undefined?{}:{shadowMask:resolveLightingChannelMask(light.shadowMask,"directionalLight.shadowMask")}), ...(light.elevationRadians === undefined ? {} : {elevationRadians:range(light.elevationRadians,0,Math.PI/2,"directionalLight.elevationRadians")}), directionX: x / length, directionY: y / length, intensity, shadowOpacity, shadowLengthScale, maxCasters,
    color: [range(color[0], 0, 1, "directionalLight.color[0]"), range(color[1], 0, 1, "directionalLight.color[1]"), range(color[2], 0, 1, "directionalLight.color[2]")] };
}

export function resolveDataSceneGroundShadow(value: unknown, width: number, height: number, path = "visual.shadow"): ResolvedDataSceneGroundShadow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw sceneCompositionDiagnosticError(path, "must be an object");
  const spec = value as Record<string, unknown>; // Runtime object shape checked above; each field validated below.
  const layer = spec.layer === undefined ? undefined : shadowRange(spec.layer, -2147483648, 2147482647, `${path}.layer`);
  if (layer !== undefined && !Number.isInteger(layer)) throw sceneCompositionDiagnosticError(`${path}.layer`, "must be an integer");
  if(spec.shape==="volume"){
    for(const key of Object.keys(spec))if(!["shape","width","depth","height","roofHeight","offsetX","offsetY","opacity","layer"].includes(key))
      throw sceneCompositionDiagnosticError(`${path}.${key}`,"is not supported by a volume shadow");
    const depth=shadowRange(spec.depth,.001,1e6,`${path}.depth`);
    return {shape:"volume",width:shadowRange(spec.width,.001,1e6,`${path}.width`),depth,
      height:shadowRange(spec.height,.001,1e6,`${path}.height`),roofHeight:shadowRange(spec.roofHeight??0,0,1e6,`${path}.roofHeight`),
      offsetX:shadowRange(spec.offsetX??0,-1e6,1e6,`${path}.offsetX`),offsetY:shadowRange(spec.offsetY??-depth/2,-1e6,1e6,`${path}.offsetY`),
      opacity:shadowRange(spec.opacity??1,0,1,`${path}.opacity`),...(layer===undefined?{}:{layer})};
  }
  if (spec.shape !== "ellipse" && spec.shape !== "box" && spec.shape !== "alpha") throw sceneCompositionDiagnosticError(`${path}.shape`, "must be ellipse, box, alpha or volume");
  return { shape: spec.shape, width: shadowRange(spec.width ?? width, 0.001, 1e10, `${path}.width`),
    height: shadowRange(spec.height ?? height, 0.001, 1e10, `${path}.height`), opacity: shadowRange(spec.opacity ?? 1, 0, 1, `${path}.opacity`),
    ...(layer === undefined ? {} : { layer }) };
}

function shadowRange(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw sceneCompositionDiagnosticError(path, `must be in [${min}, ${max}]`);
  }
  return value;
}

export function configureDataSceneSun(engine: Engine, light: DirectionalLight2D | false): boolean {
  if (light === false) return engine.configure_data_scene_sun(1, 0, 0, 1, 0);
  const sun = resolveLitDirectionalLight2D(light);
  return engine.configure_data_scene_sun(sun.directionX, sun.directionY, sun.shadowOpacity, sun.shadowLengthScale, sun.intensity === 0 ? 0 : sun.maxCasters);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new Error(`${path} must be a finite f32 number`);
  return value;
}
function range(value: unknown, min: number, max: number, path: string): number {
  const number = finite(value, path);
  if (number < min || number > max) throw new Error(`${path} must be in [${min}, ${max}]`);
  return number;
}
