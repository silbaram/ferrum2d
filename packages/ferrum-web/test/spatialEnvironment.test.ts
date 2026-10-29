import { deepEqual, equal, throws, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  resolveSpatialEnvironmentSpec,
  type SpatialEnvironmentSpec,
} from "../src/core.js";
import {
  compileSpatialEnvironment,
  decodeSpatialEnvironment,
  validSpatialEnvironmentValues,
} from "../src/spatialEnvironment.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import type { Engine } from "../pkg/ferrum_core.js";
const spec: SpatialEnvironmentSpec = {
  lighting: {
    ambient: [0.1, 0.1, 0.1],
    lights: [{ position: { x: 3, y: 4, elevation: 64 }, radius: 200 }],
    shadows: { lightIndex: 0 },
  },
  depthOfField: { focusDistance: 200 },
  colorGrading: { toneMapping: "aces" },
  fog: { start: 100, end: 300, color: [0.2, 0.3, 0.4] },
};
test("hemisphere and normal receiver bias use v3 without changing legacy payloads",()=>{
  equal(compileSpatialEnvironment(spec).length,80);
  const input: SpatialEnvironmentSpec={...spec,lighting:{...spec.lighting!,hemisphere:{direction:{x:1,y:2,elevation:3}},shadows:{lightIndex:0,normalBias:.5},directional:{direction:{x:0,y:0,elevation:1},shadows:{normalBias:.75}}}};
  const v=compileSpatialEnvironment(input);equal(v.length,128);ok(validSpatialEnvironmentValues(v));equal(v[112],1);equal(v[123],.5);equal(v[124],.75);
  deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)),v);
  const disabled=resolveSpatialEnvironmentSpec({...input,lighting:{...input.lighting!,enabled:false}});
  equal(disabled.lighting!.hemisphere!.intensity,.35);
  const off=compileSpatialEnvironment(disabled);ok(validSpatialEnvironmentValues(off));equal(off[112],0);equal(off[123],0);equal(off[124],0);
  const hemiOff=resolveSpatialEnvironmentSpec({...input,lighting:{...input.lighting!,hemisphere:{...input.lighting!.hemisphere!,enabled:false}}});
  equal(hemiOff.lighting!.hemisphere!.enabled,false);deepEqual(hemiOff.lighting!.hemisphere!.direction,input.lighting!.hemisphere!.direction);
  equal(compileSpatialEnvironment(hemiOff)[112],0);
  deepEqual(compileSpatialEnvironment({...hemiOff,lighting:{...hemiOff.lighting!,hemisphere:{...hemiOff.lighting!.hemisphere!,enabled:true}}}),v);
  deepEqual(compileSpatialEnvironment({...spec,lighting:{...spec.lighting!,shadows:{lightIndex:0,normalBias:0}}}),compileSpatialEnvironment(spec));
});
test("v3 rejects invalid hemisphere and detached shadow offsets atomically",()=>{
  const input={lighting:{lights:[],hemisphere:{}}};
  for(const hemisphere of [{enabled:"false"},{direction:{x:0,y:0,elevation:0}},{direction:{x:0,y:0,elevation:NaN}},{skyColor:[1,0,2]},{groundColor:[-1,0,0]},{intensity:65},{unknown:true}])throws(()=>resolveSpatialEnvironmentSpec({lighting:{lights:[],hemisphere}}));
  for(const normalBias of [-1,11,NaN,Infinity])throws(()=>resolveSpatialEnvironmentSpec({...spec,lighting:{...spec.lighting!,shadows:{lightIndex:0,normalBias}}}));
  const good=compileSpatialEnvironment(input);
  for(const [index,value] of [[112,2],[113,2],[119,-1],[120,2],[123,.5],[124,.5],[125,1]]){const bad=good.slice();bad[index]=value;equal(validSpatialEnvironmentValues(bad),false);}
  const native={configure_spatial_environment:(v:Float32Array)=>v.length<=112},api=createSpatialApi(native as unknown as Engine,()=>{},()=>({width:100,height:100}));
  equal(api.setDataSceneSpatialEnvironment(input),false);
});
test("explicit null lighting extensions are rejected before native mutation, even while disabled", () => {
  let nativeCalls = 0;
  const api = createSpatialApi({ configure_spatial_environment: () => { nativeCalls++; return true; } } as unknown as Engine,
    () => {}, () => ({ width: 100, height: 100 }));
  const invalids: Array<{ lighting: unknown; path: RegExp }> = [
    ...["enabled", "direction", "skyColor", "groundColor", "intensity"].map(field => ({
      lighting: { lights: [], hemisphere: { [field]: null } },
      path: new RegExp(`lighting\\.hemisphere\\.${field}`),
    })),
    { lighting: { ...spec.lighting!, shadows: { lightIndex: 0, normalBias: null } }, path: /lighting\.shadows\.normalBias/ },
    { lighting: { lights: [], directional: { direction: { x: 0, y: 0, elevation: 1 }, shadows: { normalBias: null } } }, path: /lighting\.directional\.shadows\.normalBias/ },
  ];
  for (const { lighting, path } of invalids) {
    for (const enabled of [true, false]) {
      const input = { lighting: { ...lighting as object, enabled } };
      throws(() => resolveSpatialEnvironmentSpec(input), path);
      throws(() => api.setDataSceneSpatialEnvironment(input as SpatialEnvironmentSpec), path);
    }
  }
  equal(nativeCalls, 0);
  const defaults = resolveSpatialEnvironmentSpec({ lighting: { lights: [], hemisphere: {} } });
  deepEqual(defaults.lighting!.hemisphere, {
    direction: { x: 0, y: 0, elevation: 1 }, skyColor: [0.6, 0.75, 1], groundColor: [0.3, 0.22, 0.14], intensity: 0.35,
  });
});
test("disabled authored lighting retains settings but compiles no lights or shadows and preserves other effects", () => {
  const disabled = resolveSpatialEnvironmentSpec({ ...spec, lighting: { ...spec.lighting!, enabled: false } });
  equal(disabled.lighting!.enabled, false);
  equal(disabled.lighting!.lights.length, 1);
  equal(disabled.lighting!.shadows!.lightIndex, 0);
  const values = compileSpatialEnvironment(disabled);
  ok(validSpatialEnvironmentValues(values));
  equal(values[0] & 1, 0);
  equal(values[1], 0);
  equal(values[2], -1);
  equal(values[0] & 14, 14);
  const restored = { ...disabled, lighting: { ...disabled.lighting!, enabled: true } };
  deepEqual(compileSpatialEnvironment(restored), compileSpatialEnvironment(spec));
  deepEqual(resolveSpatialEnvironmentSpec(restored), resolveSpatialEnvironmentSpec(spec));
  throws(() => resolveSpatialEnvironmentSpec({ lighting: { enabled: "false", lights: [] } }), /enabled/);
  throws(() => resolveSpatialEnvironmentSpec({ lighting: { enabled: false, lights: [{ radius: -1 }] } }), /position|radius/);
});
test("spatial environment compiles deterministic finite numeric v1 settings with bounded defaults", () => {
  const normalized = resolveSpatialEnvironmentSpec(spec),
    v = compileSpatialEnvironment(spec);
  equal(v.length, 80);
  ok(validSpatialEnvironmentValues(v));
  equal(v[0], 15);
  equal(v[2], 0);
  equal(v[3], 256);
  deepEqual([...v.slice(12, 16)], [3, 64, -4, 200]);
  equal(v[63], 8);
  deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
  equal(normalized.lighting!.shadows!.bias, 0.05);
  equal(normalized.depthOfField!.focusRange, 10);
  equal(normalized.colorGrading!.exposure, 0);
  deepEqual([...compileSpatialEnvironment(null)], []);
  deepEqual(decodeSpatialEnvironment(new Float32Array()), null);
  equal(compileSpatialEnvironment({})[0], 0);
});
test("spatial environment rejects malformed fields and renderer numeric buffers before native mutation", () => {
  for (const bad of [
    { wat: true },
    { lighting: null },
    {
      lighting: {
        lights: [{ position: { x: 0, y: 0, elevation: 1 }, radius: 0 }],
      },
    },
    { lighting: { lights: Array(17).fill(spec.lighting!.lights[0]) } },
    { lighting: { lights: [], shadows: { lightIndex: 0 } } },
    {
      lighting: {
        ...spec.lighting,
        shadows: { lightIndex: 0, resolution: 300 },
      },
    },
    { depthOfField: { focusDistance: 0 } },
    { depthOfField: { focusDistance: 200, maxBlurRadius: 13 } },
    { fog: { color: [0, 0, 0], start: 100, end: 100 } },
    { colorGrading: { exposure: 11 } },
    { colorGrading: { toneMapping: "film" } },
    { colorGrading: { tint: [1, NaN, 1] } },
  ])
    throws(() => resolveSpatialEnvironmentSpec(bad), /spatial.environment/);
  const original = compileSpatialEnvironment(spec);
  for (const [index, value] of [
    [0, 16],
    [1, 5],
    [2, 3],
    [3, 300],
    [12, Infinity],
    [15, 0],
    [63, 13],
    [67, 5],
    [79, 1],
  ]) {
    const invalid = original.slice();
    invalid[index] = value;
    equal(validSpatialEnvironmentValues(invalid), false, `field ${index}`);
  }
});
test("spatial environment facade is cold numeric, validates before call, and guards old Wasm", () => {
  const calls: Float32Array[] = [];
  const api = createSpatialApi(
    {
      configure_spatial_environment: (v: Float32Array) => {
        calls.push(v);
        return true;
      },
    } as Engine,
    () => {},
    () => ({ width: 400, height: 300 }),
  );
  ok(api.setDataSceneSpatialEnvironment(spec));
  deepEqual(calls[0], compileSpatialEnvironment(spec));
  throws(
    () =>
      api.setDataSceneSpatialEnvironment({
        depthOfField: { focusDistance: -1 },
      }),
    /focusDistance/,
  );
  equal(calls.length, 1);
  ok(api.setDataSceneSpatialEnvironment(null));
  equal(calls[1].length, 0);
  const old = createSpatialApi(
    {} as Engine,
    () => {},
    () => ({ width: 1, height: 1 }),
  );
  equal(old.setDataSceneSpatialEnvironment(spec), false);
});

test("pixel presentation uses a versioned optional numeric extension and round trips", () => {
  const v = compileSpatialEnvironment({ pixelArt: { width: 160, height: 90, snapCamera: true } });
  equal(v.length, 112); equal(v[0], 16); ok(validSpatialEnvironmentValues(v));
  deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
  for (const bad of [{ width: 0, height: 90 }, { width: 160.5, height: 90 }, { width: 2048, height: 2048 }, { width: 160, height: 90, snapCamera: 1 }])
    throws(() => resolveSpatialEnvironmentSpec({ pixelArt: bad }), /pixelArt/);
});

test("directional shadows, PCF and actor focus round trip without changing legacy settings", () => {
  const settings: SpatialEnvironmentSpec = {
    lighting: { lights: [], directional: { direction: { x: 1, y: -1, elevation: 2 }, shadows: {} }, shadowFilter: "pcf3" },
    depthOfField: { focusDistance: 100, quality: "high", focusTarget: "actor", focusOffset: 16 },
  };
  const v = compileSpatialEnvironment(settings);
  equal(v.length, 112); ok(validSpatialEnvironmentValues(v)); equal(v[92], 512);
  equal(v[95], 1); equal(v[96], 1); equal(v[97], 1); equal(v[98], 16); equal(v[99], 0);
  deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)), v);
  for (const invalid of [
    { lighting: { lights: [], directional: { direction: { x: 0, y: 0, elevation: 0 } } } },
    { lighting: { lights: [], shadowFilter: "pcss" } },
    { depthOfField: { focusDistance: 100, quality: "ultra" } },
    { depthOfField: { focusDistance: 100, focusTarget: "missing" } },
    { depthOfField: { focusDistance: 100, focusOffset: 16 } },
  ]) throws(() => resolveSpatialEnvironmentSpec(invalid), /spatial.environment/);
});

test("directional f32 vectors stay byte-identical across repeated environment save round trips", () => {
  for (let i = 0; i < 2000; i++) {
    const original = compileSpatialEnvironment({
      lighting: { lights: [], directional: {
        direction: { x: Math.sin(i * 0.17) * 100, y: Math.cos(i * 0.3) * 300, elevation: Math.sin(i * 0.9) * 400 },
        shadows: { extent: 256, resolution: 512 },
      } },
    });
    let current = original;
    for (let save = 0; save < 3; save++) {
      current = compileSpatialEnvironment(decodeSpatialEnvironment(current));
      deepEqual(current, original, `direction ${i}, save ${save}`);
    }
  }
});

test("v4 preserves sixteen authored lights, selected cone budget and scene-only post effects", () => {
  const original=compileSpatialEnvironment({
    lighting:{maxActiveLights:2,lights:Array.from({length:16},(_,i)=>({position:{x:i*10,y:0,elevation:30},radius:100,intensity:i+1,
      ...(i===15?{followActor:true,spot:{direction:{x:0,y:1,elevation:-1},angle:45,penumbra:.25}}:{})})),shadows:{lightIndex:15,normalBias:.2}},
    bloom:{strength:.8,radius:10,threshold:1.2},ambientOcclusion:{strength:.5,radius:16,bias:.3},
  });
  equal(original.length,512);ok(validSpatialEnvironmentValues(original));equal(original[1],2);equal(original[2],0);
  equal(original[12],150);equal(original[149],1);equal(original[137],16);
  deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(original)),original);
  const detachedShadow=original.slice();detachedShadow[2]=-1;detachedShadow[3]=0;detachedShadow[123]=0;equal(validSpatialEnvironmentValues(detachedShadow),false);
  for(const [index,value] of [[136,0],[137,17],[138,16],[139,300],[129,5],[130,25],[133,2],[135,-1],[142,1],[176,1],[207,1],[149,2]]) {
    const bad=original.slice();bad[index]=value;equal(validSpatialEnvironmentValues(bad),false,`v4 field ${index}`);
  }
  for(const bad of [{bloom:null},{ambientOcclusion:{radius:0}},{lighting:{lights:[],maxActiveLights:5}},{lighting:{lights:Array(17).fill({position:{x:0,y:0,elevation:0},radius:1})}},{lighting:{lights:[{position:{x:0,y:0,elevation:0},radius:1,spot:{direction:{x:0,y:0,elevation:0}}}]}}])throws(()=>resolveSpatialEnvironmentSpec(bad));
});

test("v4 effects without lighting and disabled lighting keep valid native settings",()=>{
  for(const input of [{bloom:{}},{ambientOcclusion:{}},{lighting:{enabled:false,maxActiveLights:2 as const,lights:[]},bloom:{strength:0}}]) {
    const v=compileSpatialEnvironment(input);ok(validSpatialEnvironmentValues(v));deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)),v);
  }
});

test("spot cone boundaries and f32 directions survive repeated progress round trips",()=>{
  for(let i=0;i<600;i++) {
    const v=compileSpatialEnvironment({lighting:{lights:[{position:{x:0,y:0,elevation:30},radius:100,spot:{direction:{x:Math.sin(i),y:Math.cos(i),elevation:-1},angle:i%3===0?1:i%3===1?89:1+(i%88),penumbra:(i%11)/10}}]}});
    deepEqual(compileSpatialEnvironment(decodeSpatialEnvironment(v)),v,`cone ${i}`);
  }
});
