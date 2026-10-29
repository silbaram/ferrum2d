import { sceneCompositionDiagnosticError } from "./diagnostics.js";
import type { SpatialPoint } from "./dataSceneSpatial.js";

export type SpatialRgb = readonly [number, number, number];
export interface SpatialHemisphereLightSpec {
  /** Defaults to true. Disabled authored fill retains its color/direction/intensity. */
  enabled?: boolean;
  /** Direction towards the sky, in engine X/Y/elevation. Default +elevation. */
  direction?: SpatialPoint;
  skyColor?: SpatialRgb;
  groundColor?: SpatialRgb;
  intensity?: number;
}
export interface SpatialPointLightSpec {
  /** Optional cone; direction points outwards from the source. Angles are degrees. */
  spot?: { direction: SpatialPoint; angle?: number; penumbra?: number };
  /** Follow the native spatial actor, using position as a local offset. */
  followActor?: boolean;
  position: SpatialPoint;
  color?: SpatialRgb;
  intensity?: number;
  radius: number;
}
export interface SpatialDirectionalLightSpec {
  /** World vector from the surface towards the sun; normalized by the compiler. */
  direction: SpatialPoint;
  color?: SpatialRgb;
  intensity?: number;
  shadows?: { resolution?: 128 | 256 | 512 | 1024; distance?: number; extent?: number; bias?: number; normalBias?: number };
}
export interface SpatialLightingSpec {
  /** Defaults to true. Disabled lighting retains authored light settings. */
  enabled?: boolean;
  directional?: SpatialDirectionalLightSpec;
  /** Unshadowed sky/ground fill evaluated with the final shading normal. */
  hemisphere?: SpatialHemisphereLightSpec;
  shadowFilter?: "hard" | "pcf3";
  ambient?: SpatialRgb;
  /** At most 16 authored lights; native selects at most maxActiveLights per frame. */
  lights: readonly SpatialPointLightSpec[];
  maxActiveLights?: 1 | 2 | 3 | 4;
  /** A single omnidirectional depth cube. All authored terrain/cutout billboards cast shadows. */
  shadows?: {
    lightIndex: number;
    resolution?: 128 | 256 | 512 | 1024;
    bias?: number;
    /** World units along the geometric normal for shadow queries only. Default 0. */
    normalBias?: number;
  };
}
export interface SpatialDepthOfFieldSpec {
  focusDistance: number;
  /** Optional bounded foreground/background gather. Default standard (13 samples). */
  quality?: "standard" | "high";
  /** Tracks the configured native spatial actor; missing/behind-camera actors use focusDistance. */
  focusTarget?: "actor";
  focusOffset?: number;
  focusRange?: number;
  aperture?: number;
  /** CSS pixels; bounded 13-tap depth-aware disk, maximum 12. */
  maxBlurRadius?: number;
}
export interface SpatialColorGradingSpec {
  /** Exposure value in stops. Default 0. */
  exposure?: number;
  contrast?: number;
  saturation?: number;
  tint?: SpatialRgb;
  toneMapping?: "none" | "reinhard" | "aces";
}
export interface SpatialFogSpec {
  color: SpatialRgb;
  start: number;
  end: number;
}
export interface SpatialEnvironmentSpec {
  /** Fixed scene resolution; integer CSS upscale, centered bars; smaller windows downscale to fit. */
  pixelArt?: { width: number; height: number; snapCamera?: boolean };
  lighting?: SpatialLightingSpec;
  /** Scene HDR glow, before grading and HUD. Radius is in CSS pixels (max 24). */
  bloom?: { strength?: number; radius?: number; threshold?: number };
  /** Screen-space contact occlusion. Radius and bias are view-space world units. */
  ambientOcclusion?: { strength?: number; radius?: number; bias?: number };
  depthOfField?: SpatialDepthOfFieldSpec;
  colorGrading?: SpatialColorGradingSpec;
  fog?: SpatialFogSpec;
}
/** Borrowed native environment v1/v2/v3/v4; acquire per frame, copy before deferred use. */
export interface SpatialEnvironmentBufferView {
  version: 1 | 2 | 3 | 4;
  values: Float32Array;
  shadowMatrices: Float32Array;
  shadowCasters: Float32Array;
  shadowCasterVertexCount: number;
  /** Optional independent submission extension v1. Four u32 fields: face, source, first, count. */
  shadowSubmission?: { version: 1; revision: number; ranges: Uint32Array };
}
export const SPATIAL_ENVIRONMENT_VALUES = 80;
export function validSpatialEnvironmentValues(v: Float32Array): boolean {
  if (
    ![80, 112, 128, 512].includes(v.length) ||
    v.some((x) => !Number.isFinite(x)) ||
    !Number.isInteger(v[0]) ||
    v[0] < 0 ||
    v[0] > (v.length === 512 ? 127 : v.length === 80 ? 15 : 31) ||
    !Number.isInteger(v[1]) ||
    v[1] < 0 ||
    v[1] > 4 ||
    !Number.isInteger(v[2]) ||
    v[2] < -1 ||
    v[2] > 3
  )
    return false;
  if (v.length >= 112) {
    if (v[0] & 16) {
      if (![v[80], v[81]].every(x => Number.isInteger(x) && x >= 1 && x <= 2048) || v[80] * v[81] > 1_048_576 || ![0, 1].includes(v[82])) return false;
    } else if (v.slice(80, 83).some(x => x !== 0)) return false;
    if (!validExtendedEnvironment(v)) return false;
    if (v.length >= 128 && !validLightingExtension(v)) return false;
  }
  if (v.length === 512 && !validLightingV4(v)) return false;
  if (!(v[0] & 1) && (v[1] !== 0 || v[2] !== -1)) return false;
  const range = (start: number, end: number, min: number, max: number) => {
    for (let i = start; i < end; i++)
      if (v[i] < min || v[i] > max) return false;
    return true;
  };
  if (
    !range(5, 8, 0, 4) ||
    !range(4, 5, 0, 10) ||
    (v[2] >= 0 && (v[2] >= v[1] || ![128, 256, 512, 1024].includes(v[3]))) ||
    (v[2] < 0 && v[3] !== 0)
  )
    return false;
  for (let i = 0; i < 4; i++) {
    const p = 12 + i * 12;
    if (i >= v[1]) {
      if (!range(p, p + 12, 0, 0)) return false;
      continue;
    }
    if (
      !range(p, p + 3, -1e6, 1e6) ||
      !range(p + 3, p + 4, 0.1, 1e6) ||
      !range(p + 4, p + 7, 0, 1) ||
      !range(p + 7, p + 8, 0, 64) ||
      !range(p + 8, p + 12, 0, 0)
    )
      return false;
  }
  return (
    range(8, 12, 0, 0) &&
    range(60, 61, 0.001, 1e6) &&
    range(61, 62, 0, 1e6) &&
    range(62, 63, 0, 32) &&
    range(63, 64, 0, 12) &&
    range(64, 65, -10, 10) &&
    range(65, 67, 0, 2) &&
    [0, 1, 2].includes(v[67]) &&
    range(68, 71, 0, 4) &&
    range(71, 72, 0, 1e6) &&
    v[72] > v[71] &&
    v[72] <= 1e6 &&
    range(73, 76, 0, 1) &&
    range(76, 80, 0, 0)
  );
}
function validExtendedEnvironment(v: Float32Array): boolean {
  const zeros = (a: number, b: number) => v.subarray(a, b).every(x => x === 0);
  const range = (a: number, b: number, min: number, max: number) => v.subarray(a, b).every(x => x >= min && x <= max);
  if (![0, 1].includes(v[83]) || ![0, 1].includes(v[95]) || ![0, 1].includes(v[96]) || ![0, 1].includes(v[97]) || Math.abs(v[98]) > 1e6 || !range(99, 100, 0, 1e6) || !zeros(100, 112)) return false;
  if (v[83]) {
    if (!(v[0] & 1) || !range(84, 87, -1, 1) || Math.hypot(v[84], v[85], v[86]) < 0.00001 || !range(87, 88, 0, 64) || !range(88, 91, 0, 1)) return false;
    if (v[92]) { if (![128, 256, 512, 1024].includes(v[92]) || !range(91, 92, 1, 10000) || !range(93, 94, 0, 10) || !range(94, 95, 1, 10000)) return false; }
    else if (!zeros(91, 95)) return false;
  } else if (!zeros(84, 95)) return false;
  return ((v[0] & 4) !== 0 || zeros(96, 100)) && (v[97] !== 0 || zeros(98, 100)) && ((v[0] & 1) !== 0 || v[95] === 0);
}
function validLightingExtension(v: Float32Array): boolean {
  const zeros = (a: number, b: number) => v.subarray(a,b).every(x=>x===0);
  if (![0,1].includes(v[112]) || !zeros(125,128) || v[123]<0 || v[123]>10 || v[124]<0 || v[124]>10) return false;
  if (v[112]) {
    const direction=v.subarray(113,116);
    if (!(v[0]&1) || direction.some(x=>Math.abs(x)>1) || Math.hypot(...direction)<.00001 ||
      v.subarray(116,119).some(x=>x<0 || x>1) || v[119]<0 || v[119]>64 || v.subarray(120,123).some(x=>x<0 || x>1)) return false;
  } else if (!zeros(113,123)) return false;
  return (v[2]>=0 || v[123]===0) && (v[92]>0 || v[124]===0);
}
// v4: 128..135 post effects, 136..143 budgets/shadow authoring,
// 144..175 selected cones, 192..511 sixteen immutable authored light records.
function validLightingV4(v: Float32Array): boolean {
  const range=(i:number,a:number,b:number)=>v[i]>=a && v[i]<=b;
  const zero=(a:number,b:number)=>v.subarray(a,b).every(x=>x===0);
  for(const p of [128,132]) {
    if(![0,1].includes(v[p]))return false;
    if(!v[p]) {if(!zero(p+1,p+4))return false;continue;}
    if(!range(p+1,0,p===128?4:1) || !range(p+2,.1,p===128?24:1000) || !range(p+3,0,p===128?64:100))return false;
  }
  if(((v[0]&32)!==0)!==(v[128]===1) || ((v[0]&64)!==0)!==(v[132]===1))return false;
  if(![1,2,3,4].includes(v[136]) || !Number.isInteger(v[137]) || !range(137,0,16) ||
    !Number.isInteger(v[138]) || !range(138,-1,v[137]-1) || !zero(142,144) || !zero(176,192))return false;
  if(v[138]>=0) {if(![128,256,512,1024].includes(v[139]) || !range(140,0,10) || !range(141,0,10))return false;}
  else if(!zero(139,142))return false;
  if(v[138]>=0 ? v[2]!==0 || v[3]!==v[139] || v[4]!==v[140] || v[123]!==v[141] : v[2]!==-1)return false;
  if(!(v[0]&1) && (v[137]!==0 || v[138]!==-1))return false;
  for(let i=0;i<16;i++) {
    const p=192+i*20;
    if(i>=v[137]) {if(!zero(p,p+20))return false;continue;}
    if(v.subarray(p,p+3).some(x=>Math.abs(x)>1e6) || !range(p+3,.1,1e6) ||
      v.subarray(p+4,p+7).some(x=>x<0 || x>1) || !range(p+7,0,64) ||
      ![0,1].includes(v[p+13]) || ![0,1].includes(v[p+14]) || !zero(p+15,p+20))return false;
    if(v[p+13]) {
      if(v.subarray(p+8,p+11).some(x=>Math.abs(x)>1) || Math.hypot(...v.subarray(p+8,p+11))<.00001 ||
        !range(p+11,0,1) || !range(p+12,v[p+11],1))return false;
    } else if(!zero(p+8,p+13))return false;
  }
  for(let i=0;i<4;i++) {
    const p=144+i*8;
    if(![0,1].includes(v[p+5]) || !zero(p+6,p+8))return false;
    if(v[p+5]) {if(i>=v[1] || v.subarray(p,p+3).some(x=>Math.abs(x)>1) || Math.hypot(...v.subarray(p,p+3))<.00001 || !range(p+3,0,1) || !range(p+4,v[p+3],1))return false;}
    else if(!zero(p,p+5))return false;
  }
  return v[1]<=v[136];
}
function compileLightingV4(spec:SpatialEnvironmentSpec,v:Float32Array):void {
  for(const [p,effect] of [[128,spec.bloom],[132,spec.ambientOcclusion]] as const) {
    if(!effect)continue;
    v[0]|=p===128?32:64;
    v.set([1,effect.strength!,effect.radius!,p===128?spec.bloom!.threshold!:spec.ambientOcclusion!.bias!],p);
  }
  const light=spec.lighting?.enabled===false?undefined:spec.lighting;
  v[136]=light?.maxActiveLights ?? 4;
  v[137]=light?.lights.length ?? 0; v[138]=light?.shadows?.lightIndex ?? -1;
  if(light?.shadows)v.set([light.shadows.resolution!,light.shadows.bias!,light.shadows.normalBias??0],139);
  light?.lights.forEach((l,i)=>{
    const p=192+i*20;
    v.set([l.position.x,l.position.elevation,-l.position.y,l.radius,...l.color!,l.intensity!],p);
    if(l.spot) {
      const d=l.spot.direction, n=Float32Array.from([d.x,d.elevation,-d.y]),length=Math.hypot(...n);
      if(Math.abs(length-1)>2**-23)for(let j=0;j<3;j++)n[j]/=length;
      const angle=l.spot.angle!*Math.PI/180;
      v.set([...n,Math.cos(angle),Math.cos(angle*(1-l.spot.penumbra!)),1],p+8);
    }
    v[p+14]=l.followActor?1:0;
  });
  const indices=Array.from({length:v[137]},(_,i)=>i);
  if(v[138]>=0)indices.unshift(...indices.splice(v[138],1));
  v.fill(0,12,60);v[1]=Math.min(v[136],indices.length);v[2]=v[138]>=0?0:-1;
  v[3]=v[139];v[4]=v[138]>=0?v[140]:.05;v[123]=v[141];
  indices.slice(0,v[1]).forEach((index,i)=>{
    const p=192+index*20;v.set(v.subarray(p,p+8),12+i*12);v.set(v.subarray(p+8,p+14),144+i*8);
  });
}
function decodeLightingV4(v:Float32Array,spec:SpatialEnvironmentSpec):void {
  if(v[128])spec.bloom={strength:v[129],radius:v[130],threshold:v[131]};
  if(v[132])spec.ambientOcclusion={strength:v[133],radius:v[134],bias:v[135]};
  if(!spec.lighting)return;
  spec.lighting.maxActiveLights=v[136] as 1|2|3|4;
  spec.lighting.lights=Array.from({length:v[137]},(_,i)=>{
    const p=192+i*20, angle=Math.max(Math.PI/180,Math.min(89*Math.PI/180,Math.acos(v[p+11])));
    return {position:{x:v[p],elevation:v[p+1],y:-v[p+2]},radius:v[p+3],color:[v[p+4],v[p+5],v[p+6]] as SpatialRgb,intensity:v[p+7],
      ...(v[p+14]?{followActor:true}:{}),
      ...(v[p+13]?{spot:{direction:{x:v[p+8],elevation:v[p+9],y:-v[p+10]},angle:angle*180/Math.PI,penumbra:Math.max(0,Math.min(1,1-Math.acos(v[p+12])/angle))}}:{})};
  });
  delete spec.lighting.shadows;
  if(v[138]>=0)spec.lighting.shadows={lightIndex:v[138],resolution:v[139] as 128|256|512|1024,bias:v[140],...(v[141]>0?{normalBias:v[141]}:{})};
}
function object(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw sceneCompositionDiagnosticError(path, "must be an object");
  for (const key of Object.keys(value))
    if (!keys.includes(key))
      throw sceneCompositionDiagnosticError(
        `${path}.${key}`,
        "is not supported",
      );
  return value as Record<string, unknown>;
}
function number(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(Math.fround(value)) ||
    Math.fround(value) < min ||
    Math.fround(value) > max
  )
    throw sceneCompositionDiagnosticError(
      path,
      `must be a finite f32 in ${min}..${max}`,
    );
  return value;
}
function rgb(value: unknown, path: string, max = 4): SpatialRgb {
  if (!Array.isArray(value) || value.length !== 3)
    throw sceneCompositionDiagnosticError(path, "must have three RGB channels");
  return [
    number(value[0], `${path}[0]`, 0, max),
    number(value[1], `${path}[1]`, 0, max),
    number(value[2], `${path}[2]`, 0, max),
  ];
}
export function resolveSpatialEnvironmentSpec(
  value: unknown,
  path = "spatial.environment",
): SpatialEnvironmentSpec {
  const o = object(value, path, [
    "lighting",
    "bloom",
    "ambientOcclusion",
    "pixelArt",
    "depthOfField",
    "colorGrading",
    "fog",
  ]);
  const result: SpatialEnvironmentSpec = {};
  for (const key of ["bloom", "ambientOcclusion"] as const) {
    if (o[key] === undefined) continue;
    const at = `${path}.${key}`, bloom = key === "bloom";
    const effect = object(o[key], at, bloom ? ["strength", "radius", "threshold"] : ["strength", "radius", "bias"]);
    const strength = number(effect.strength === undefined ? (bloom ? .5 : .6) : effect.strength, `${at}.strength`, 0, bloom ? 4 : 1);
    const radius = number(effect.radius === undefined ? (bloom ? 8 : 12) : effect.radius, `${at}.radius`, .1, bloom ? 24 : 1000);
    if (bloom) result.bloom = { strength, radius, threshold: number(effect.threshold === undefined ? 1 : effect.threshold, `${at}.threshold`, 0, 64) };
    else result.ambientOcclusion = { strength, radius, bias: number(effect.bias === undefined ? .2 : effect.bias, `${at}.bias`, 0, 100) };
  }
  if (o.pixelArt !== undefined) {
    const p = object(o.pixelArt, `${path}.pixelArt`, ["width", "height", "snapCamera"]);
    const width = number(p.width, `${path}.pixelArt.width`, 1, 2048), height = number(p.height, `${path}.pixelArt.height`, 1, 2048);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width * height > 1_048_576 || (p.snapCamera !== undefined && typeof p.snapCamera !== "boolean")) throw sceneCompositionDiagnosticError(`${path}.pixelArt`, "requires integer dimensions within 1 megapixel and boolean snapCamera");
    result.pixelArt = { width, height, snapCamera: p.snapCamera === true };
  }
  if (o.lighting !== undefined) {
    const l = object(o.lighting, `${path}.lighting`, [
      "enabled",
      "maxActiveLights",
      "ambient",
      "directional",
      "hemisphere",
      "shadowFilter",
      "lights",
      "shadows",
    ]);
    if (l.enabled !== undefined && typeof l.enabled !== "boolean")
      throw sceneCompositionDiagnosticError(`${path}.lighting.enabled`, "must be a boolean");
    if (!Array.isArray(l.lights) || l.lights.length > 16)
      throw sceneCompositionDiagnosticError(
        `${path}.lighting.lights`,
        "must be an array of at most sixteen lights",
      );
    const budget = l.maxActiveLights;
    if (budget !== undefined && ![1,2,3,4].includes(budget as number))
      throw sceneCompositionDiagnosticError(`${path}.lighting.maxActiveLights`, "must be 1, 2, 3 or 4");
    const lights = Array.from(
      l.lights,
      (value, index): SpatialPointLightSpec => {
        const at = `${path}.lighting.lights[${index}]`,
          s = object(value, at, ["position", "color", "intensity", "radius", "spot", "followActor"]),
          p = object(s.position, `${at}.position`, ["x", "y", "elevation"]);
        if (s.followActor !== undefined && typeof s.followActor !== "boolean") throw sceneCompositionDiagnosticError(`${at}.followActor`, "must be a boolean");
        let spot: SpatialPointLightSpec["spot"];
        if (s.spot !== undefined) {
          const cone = object(s.spot, `${at}.spot`, ["direction", "angle", "penumbra"]);
          const d = object(cone.direction, `${at}.spot.direction`, ["x", "y", "elevation"]);
          const direction = { x: number(d.x, `${at}.spot.direction.x`, -1e6, 1e6), y: number(d.y, `${at}.spot.direction.y`, -1e6, 1e6), elevation: number(d.elevation, `${at}.spot.direction.elevation`, -1e6, 1e6) };
          if (Math.hypot(direction.x,direction.y,direction.elevation)<.00001) throw sceneCompositionDiagnosticError(`${at}.spot.direction`, "must be nonzero");
          spot = { direction, angle: number(cone.angle === undefined ? 45 : cone.angle, `${at}.spot.angle`, 1, 89), penumbra: number(cone.penumbra === undefined ? .25 : cone.penumbra, `${at}.spot.penumbra`, 0, 1) };
        }
        return {
          ...(spot ? { spot } : {}), ...(s.followActor === true ? { followActor: true } : {}),
          position: {
            x: number(p.x, `${at}.position.x`, -1e6, 1e6),
            y: number(p.y, `${at}.position.y`, -1e6, 1e6),
            elevation: number(
              p.elevation,
              `${at}.position.elevation`,
              -1e6,
              1e6,
            ),
          },
          radius: number(s.radius, `${at}.radius`, 0.1, 1e6),
          color: rgb(
            s.color === undefined ? [1, 1, 1] : s.color,
            `${at}.color`,
            1,
          ),
          intensity: number(
            s.intensity === undefined ? 1 : s.intensity,
            `${at}.intensity`,
            0,
            64,
          ),
        };
      },
    );
    let directional: SpatialDirectionalLightSpec | undefined;
    if (l.directional !== undefined) {
      const d = object(l.directional, `${path}.lighting.directional`, ["direction", "color", "intensity", "shadows"]);
      const n = object(d.direction, `${path}.lighting.directional.direction`, ["x", "y", "elevation"]);
      const direction = { x: number(n.x, `${path}.lighting.directional.direction.x`, -1e6, 1e6), y: number(n.y, `${path}.lighting.directional.direction.y`, -1e6, 1e6), elevation: number(n.elevation, `${path}.lighting.directional.direction.elevation`, -1e6, 1e6) };
      if (Math.hypot(direction.x, direction.y, direction.elevation) < 0.00001) throw sceneCompositionDiagnosticError(`${path}.lighting.directional.direction`, "must be nonzero");
      directional = { direction, color: rgb(d.color ?? [1, 1, 1], `${path}.lighting.directional.color`, 1), intensity: number(d.intensity ?? 1, `${path}.lighting.directional.intensity`, 0, 64) };
      if (d.shadows !== undefined) {
        const sh = object(d.shadows, `${path}.lighting.directional.shadows`, ["resolution", "distance", "extent", "bias", "normalBias"]);
        const resolution = sh.resolution ?? 512;
        if (![128, 256, 512, 1024].includes(resolution as number)) throw sceneCompositionDiagnosticError(`${path}.lighting.directional.shadows.resolution`, "must be 128, 256, 512 or 1024");
        directional.shadows = { resolution: resolution as 128 | 256 | 512 | 1024, distance: number(sh.distance ?? 512, `${path}.lighting.directional.shadows.distance`, 1, 10000), extent: number(sh.extent ?? 256, `${path}.lighting.directional.shadows.extent`, 1, 10000), bias: number(sh.bias ?? 0.05, `${path}.lighting.directional.shadows.bias`, 0, 10) };
        const normalBias=number(sh.normalBias === undefined ? 0 : sh.normalBias,`${path}.lighting.directional.shadows.normalBias`,0,10);
        if (normalBias>0) directional.shadows.normalBias=normalBias;
      }
    }
    let hemisphere: SpatialHemisphereLightSpec | undefined;
    if (l.hemisphere !== undefined) {
      const hemispherePath = `${path}.lighting.hemisphere`;
      const h = object(l.hemisphere, hemispherePath, ["enabled", "direction", "skyColor", "groundColor", "intensity"]);
      const d = object(h.direction === undefined ? { x: 0, y: 0, elevation: 1 } : h.direction,
        `${hemispherePath}.direction`, ["x", "y", "elevation"]);
      const direction = {
        x: number(d.x, `${hemispherePath}.direction.x`, -1e6, 1e6),
        y: number(d.y, `${hemispherePath}.direction.y`, -1e6, 1e6),
        elevation: number(d.elevation, `${hemispherePath}.direction.elevation`, -1e6, 1e6),
      };
      if (Math.hypot(direction.x, direction.y, direction.elevation) < 0.00001)
        throw sceneCompositionDiagnosticError(`${hemispherePath}.direction`, "must be nonzero");
      if (h.enabled !== undefined && typeof h.enabled !== "boolean")
        throw sceneCompositionDiagnosticError(`${hemispherePath}.enabled`, "must be a boolean");
      hemisphere = {
        ...(h.enabled === false ? { enabled: false } : {}),
        direction,
        skyColor: rgb(h.skyColor === undefined ? [0.6, 0.75, 1] : h.skyColor, `${hemispherePath}.skyColor`, 1),
        groundColor: rgb(h.groundColor === undefined ? [0.3, 0.22, 0.14] : h.groundColor, `${hemispherePath}.groundColor`, 1),
        intensity: number(h.intensity === undefined ? 0.35 : h.intensity, `${hemispherePath}.intensity`, 0, 64),
      };
    }
    if (l.shadowFilter !== undefined && l.shadowFilter !== "hard" && l.shadowFilter !== "pcf3") throw sceneCompositionDiagnosticError(`${path}.lighting.shadowFilter`, "must be hard or pcf3");
    let shadows: SpatialLightingSpec["shadows"];
    if (l.shadows !== undefined) {
      const s = object(l.shadows, `${path}.lighting.shadows`, [
        "lightIndex",
        "resolution",
        "bias",
        "normalBias",
      ]);
      const lightIndex = number(
          s.lightIndex,
          `${path}.lighting.shadows.lightIndex`,
          0,
          15,
        ),
        resolution = s.resolution === undefined ? 256 : s.resolution;
      if (!Number.isInteger(lightIndex) || lightIndex >= lights.length)
        throw sceneCompositionDiagnosticError(
          `${path}.lighting.shadows.lightIndex`,
          "must reference an authored light",
        );
      if (![128, 256, 512, 1024].includes(resolution as number))
        throw sceneCompositionDiagnosticError(
          `${path}.lighting.shadows.resolution`,
          "must be 128, 256, 512 or 1024",
        );
      shadows = {
        lightIndex,
        resolution: resolution as 128 | 256 | 512 | 1024,
        bias: number(
          s.bias === undefined ? 0.05 : s.bias,
          `${path}.lighting.shadows.bias`,
          0,
          10,
        ),
      };
      const normalBias=number(s.normalBias === undefined ? 0 : s.normalBias,`${path}.lighting.shadows.normalBias`,0,10);
      if(normalBias>0) shadows.normalBias=normalBias;
    }
    result.lighting = {
      ...(budget === undefined ? {} : { maxActiveLights: budget as 1 | 2 | 3 | 4 }),
      ...(l.enabled === false ? { enabled: false } : {}),
      ...(directional ? { directional } : {}),
      ...(hemisphere ? { hemisphere } : {}),
      ...(l.shadowFilter === undefined ? {} : { shadowFilter: l.shadowFilter as "hard" | "pcf3" }),
      ambient: rgb(
        l.ambient === undefined ? [0.15, 0.15, 0.15] : l.ambient,
        `${path}.lighting.ambient`,
      ),
      lights,
      ...(shadows === undefined ? {} : { shadows }),
    };
  }
  if (o.depthOfField !== undefined) {
    const d = object(o.depthOfField, `${path}.depthOfField`, [
      "focusDistance",
      "focusRange",
      "aperture",
      "maxBlurRadius",
      "quality",
      "focusTarget",
      "focusOffset",
    ]);
    if (d.quality !== undefined && d.quality !== "standard" && d.quality !== "high") throw sceneCompositionDiagnosticError(`${path}.depthOfField.quality`, "must be standard or high");
    if (d.focusTarget !== undefined && d.focusTarget !== "actor") throw sceneCompositionDiagnosticError(`${path}.depthOfField.focusTarget`, "must be actor");
    if (d.focusOffset !== undefined && d.focusTarget !== "actor") throw sceneCompositionDiagnosticError(`${path}.depthOfField.focusOffset`, "requires focusTarget: actor");
    result.depthOfField = {
      ...(d.quality === undefined ? {} : { quality: d.quality as "standard" | "high" }),
      ...(d.focusTarget === undefined ? {} : { focusTarget: "actor" as const, focusOffset: number(d.focusOffset ?? 0, `${path}.depthOfField.focusOffset`, -1e6, 1e6) }),
      focusDistance: number(
        d.focusDistance,
        `${path}.depthOfField.focusDistance`,
        0.001,
        1e6,
      ),
      focusRange: number(
        d.focusRange === undefined ? 10 : d.focusRange,
        `${path}.depthOfField.focusRange`,
        0,
        1e6,
      ),
      aperture: number(
        d.aperture === undefined ? 8 : d.aperture,
        `${path}.depthOfField.aperture`,
        0,
        32,
      ),
      maxBlurRadius: number(
        d.maxBlurRadius === undefined ? 8 : d.maxBlurRadius,
        `${path}.depthOfField.maxBlurRadius`,
        0,
        12,
      ),
    };
  }
  if (o.colorGrading !== undefined) {
    const c = object(o.colorGrading, `${path}.colorGrading`, [
        "exposure",
        "contrast",
        "saturation",
        "tint",
        "toneMapping",
      ]),
      tone = c.toneMapping === undefined ? "none" : c.toneMapping;
    if (tone !== "none" && tone !== "reinhard" && tone !== "aces")
      throw sceneCompositionDiagnosticError(
        `${path}.colorGrading.toneMapping`,
        "must be none, reinhard or aces",
      );
    result.colorGrading = {
      exposure: number(
        c.exposure === undefined ? 0 : c.exposure,
        `${path}.colorGrading.exposure`,
        -10,
        10,
      ),
      contrast: number(
        c.contrast === undefined ? 1 : c.contrast,
        `${path}.colorGrading.contrast`,
        0,
        2,
      ),
      saturation: number(
        c.saturation === undefined ? 1 : c.saturation,
        `${path}.colorGrading.saturation`,
        0,
        2,
      ),
      tint: rgb(
        c.tint === undefined ? [1, 1, 1] : c.tint,
        `${path}.colorGrading.tint`,
      ),
      toneMapping: tone,
    };
  }
  if (o.fog !== undefined) {
    const f = object(o.fog, `${path}.fog`, ["color", "start", "end"]),
      start = number(f.start, `${path}.fog.start`, 0, 1e6),
      end = number(f.end, `${path}.fog.end`, 0.001, 1e6);
    if (Math.fround(end) <= Math.fround(start))
      throw sceneCompositionDiagnosticError(
        `${path}.fog.end`,
        "must exceed start",
      );
    result.fog = { color: rgb(f.color, `${path}.fog.color`, 1), start, end };
  }
  return result;
}
export function compileSpatialEnvironment(
  input: SpatialEnvironmentSpec | null,
): Float32Array {
  if (input === null) return new Float32Array();
  const spec = resolveSpatialEnvironmentSpec(input),
    advancedLighting = !!(spec.lighting?.hemisphere || spec.lighting?.shadows?.normalBias || spec.lighting?.directional?.shadows?.normalBias),
    v4 = !!(spec.bloom || spec.ambientOcclusion || spec.lighting?.maxActiveLights || (spec.lighting?.lights.length ?? 0)>4 || spec.lighting?.lights.some(l=>l.spot || l.followActor)),
    v = new Float32Array(v4 ? 512 : advancedLighting ? 128 : spec.pixelArt || spec.lighting?.directional || spec.lighting?.shadowFilter === "pcf3" || spec.depthOfField?.quality === "high" || spec.depthOfField?.focusTarget ? 112 : 80);
  v[2] = -1;
  v[4] = 0.05;
  v.set([0.15, 0.15, 0.15], 5);
  v.set([100, 10, 8, 8, 0, 1, 1, 0, 1, 1, 1, 0, 1000, 0, 0, 0], 60);
  if (spec.pixelArt) { v[0] |= 16; v.set([spec.pixelArt.width, spec.pixelArt.height, spec.pixelArt.snapCamera ? 1 : 0], 80); }
  if (spec.lighting && spec.lighting.enabled !== false) {
    v[0] |= 1;
    if (spec.lighting.hemisphere && spec.lighting.hemisphere.enabled!==false) {
      const h=spec.lighting.hemisphere,d=h.direction!,direction=Float32Array.from([d.x,d.elevation,-d.y]),length=Math.hypot(...direction);
      if(Math.abs(length-1)>2**-23) for(let i=0;i<3;i++) direction[i]/=length;
      v.set([1,...direction,...h.skyColor!,h.intensity!,...h.groundColor!],112);
    }
    if (advancedLighting) {v[123]=spec.lighting.shadows?.normalBias ?? 0;v[124]=spec.lighting.directional?.shadows?.normalBias ?? 0;}
    if (spec.lighting.directional) {
      const d = spec.lighting.directional;
      const direction = Float32Array.from([d.direction.x, d.direction.elevation, -d.direction.y]);
      const length = Math.hypot(...direction);
      // A decoded f32 unit vector must survive compile/decode without renormalization drift.
      if (Math.abs(length - 1) > 2 ** -23)
        for (let axis = 0; axis < direction.length; axis++) direction[axis] /= length;
      v.set([1, ...direction, d.intensity!, ...d.color!], 83);
      if (d.shadows) v.set([d.shadows.distance!, d.shadows.resolution!, d.shadows.bias!, d.shadows.extent!], 91);
    }
    if (spec.lighting.shadowFilter === "pcf3") v[95] = 1;
    v[1] = Math.min(4, spec.lighting.lights.length);
    v.set(spec.lighting.ambient!, 5);
    spec.lighting.lights.slice(0,4).forEach((l, i) =>
      v.set(
        [
          l.position.x,
          l.position.elevation,
          -l.position.y,
          l.radius,
          ...l.color!,
          l.intensity!,
          0,
          0,
          0,
          0,
        ],
        12 + i * 12,
      ),
    );
    if (spec.lighting.shadows && spec.lighting.shadows.lightIndex < 4) {
      v[2] = spec.lighting.shadows.lightIndex;
      v[3] = spec.lighting.shadows.resolution!;
      v[4] = spec.lighting.shadows.bias!;
    }
  }
  if (spec.depthOfField) {
    v[0] |= 4;
    const d = spec.depthOfField;
    if (v.length >= 112) { v[96] = d.quality === "high" ? 1 : 0; v[97] = d.focusTarget === "actor" ? 1 : 0; v[98] = d.focusOffset ?? 0; }
    v.set([d.focusDistance, d.focusRange!, d.aperture!, d.maxBlurRadius!], 60);
  }
  if (spec.colorGrading) {
    v[0] |= 8;
    const c = spec.colorGrading;
    v.set(
      [
        c.exposure!,
        c.contrast!,
        c.saturation!,
        ["none", "reinhard", "aces"].indexOf(c.toneMapping!),
        ...c.tint!,
      ],
      64,
    );
  }
  if (spec.fog) {
    v[0] |= 2;
    v.set([spec.fog.start, spec.fog.end, ...spec.fog.color], 71);
  }
  if (v4) compileLightingV4(spec,v);
  return v;
}
export function decodeSpatialEnvironment(
  v: Float32Array,
): SpatialEnvironmentSpec | null {
  if (v.length === 0) return null;
  if (!validSpatialEnvironmentValues(v))
    throw new Error("Invalid native spatial environment");
  const flags = v[0],
    spec: SpatialEnvironmentSpec = {};
  if (flags & 16) spec.pixelArt = { width: v[80], height: v[81], snapCamera: v[82] === 1 };
  if (flags & 1)
    spec.lighting = {
      ambient: [v[5], v[6], v[7]],
      lights: Array.from({ length: v[1] }, (_, i) => {
        const p = 12 + i * 12;
        return {
          position: { x: v[p], elevation: v[p + 1], y: -v[p + 2] },
          radius: v[p + 3],
          color: [v[p + 4], v[p + 5], v[p + 6]],
          intensity: v[p + 7],
        };
      }),
      ...(v[2] < 0
        ? {}
        : {
            shadows: {
              lightIndex: v[2],
              resolution: v[3] as 128 | 256 | 512 | 1024,
              bias: v[4],
              ...(v.length>=128 && v[123]>0 ? {normalBias:v[123]} : {}),
            },
          }),
    };
  if (spec.lighting && v.length >= 112) {
    if (v[83]) spec.lighting.directional = { direction: { x: v[84], elevation: v[85], y: -v[86] }, intensity: v[87], color: [v[88], v[89], v[90]], ...(v[92] ? { shadows: { distance: v[91], resolution: v[92] as 128 | 256 | 512 | 1024, bias: v[93], extent: v[94] } } : {}) };
    if (v[95]) spec.lighting.shadowFilter = "pcf3";
    if (v.length>=128) {
      if(v[112]) spec.lighting.hemisphere={direction:{x:v[113],elevation:v[114],y:-v[115]},skyColor:[v[116],v[117],v[118]],intensity:v[119],groundColor:[v[120],v[121],v[122]]};
      if(v[124]>0 && spec.lighting.directional?.shadows) spec.lighting.directional.shadows.normalBias=v[124];
    }
  }
  if (flags & 4)
    spec.depthOfField = {
      focusDistance: v[60],
      focusRange: v[61],
      aperture: v[62],
      maxBlurRadius: v[63],
      ...(v.length >= 112 && v[96] ? { quality: "high" as const } : {}),
      ...(v.length >= 112 && v[97] ? { focusTarget: "actor" as const, focusOffset: v[98] } : {}),
    };
  if (flags & 8)
    spec.colorGrading = {
      exposure: v[64],
      contrast: v[65],
      saturation: v[66],
      toneMapping: (["none", "reinhard", "aces"] as const)[v[67]],
      tint: [v[68], v[69], v[70]],
    };
  if (flags & 2)
    spec.fog = { start: v[71], end: v[72], color: [v[73], v[74], v[75]] };
  if(v.length === 512) decodeLightingV4(v,spec);
  return resolveSpatialEnvironmentSpec(spec);
}
