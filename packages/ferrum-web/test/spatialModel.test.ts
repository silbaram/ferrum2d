import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { loadSpatialGlb, createSpatialModelThumbnailSvg } from "../src/core.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import { SpatialModelImageReader } from "../src/spatialModelImage.js";
import { spatialModelResource } from "../src/spatialModel.js";
import type { Engine } from "../pkg/ferrum_core.js";
interface Fixture {
    extensionsRequired?: string[];
    nodes: {
        children?: number[];
        scale?: number[];
        translation?: number[];
    }[];
    accessors: {
        count: number;
        byteOffset?: number;
        normalized?: boolean;
    }[];
    bufferViews: {
        byteStride?: number;
    }[];
    materials: {
        extensions?: Record<string,unknown>;
        normalTexture?: {index:number; scale?:number};
        emissiveTexture?: {index:number};
        emissiveFactor?: number[];
        alphaMode?: string;
        alphaCutoff?: number;
        doubleSided?: boolean;
        pbrMetallicRoughness: {
            baseColorTexture?: unknown;
            baseColorFactor?: number[];
        };
    }[];
    meshes: {
        primitives: {
            mode?: number;
            material?: number;
            attributes: Record<string,number>;
        }[];
    }[];
    buffers: {
        uri?: string;
    }[];
    images: unknown[];
}
async function fixture(edit: (json: Fixture) => void = () => { }, name = "rock", preserveTextures = false): Promise<ArrayBuffer> {
    const file = await readFile(new URL(`../../../../examples/data-scene-native/assets/${name}.glb`, import.meta.url));
    const v = new DataView(file.buffer, file.byteOffset, file.byteLength), n = v.getUint32(12, true);
    const json: Fixture = JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + n)));
    // Pure decoder tests omit browser image decoding; packed browser smoke uses the original textured GLB.
    if (!preserveTextures) {
    for(const material of json.materials) {
      delete material.pbrMetallicRoughness.baseColorTexture;
      delete material.normalTexture;
      delete material.emissiveTexture;
    }
    json.images = [];
    }
    edit(json);
    const raw = new TextEncoder().encode(JSON.stringify(json));
    const padded = (raw.length + 3) & ~3, bin = file.subarray(28 + n);
    const bytes = new ArrayBuffer(28 + padded + bin.length), out = new DataView(bytes);
    [0x46546c67, 2, bytes.byteLength, padded, 0x4e4f534a].forEach((x, i) => out.setUint32(i * 4, x, true));
    new Uint8Array(bytes, 20, padded).fill(32);
    new Uint8Array(bytes, 20, raw.length).set(raw);
    out.setUint32(20 + padded, bin.length, true);
    out.setUint32(24 + padded, 0x004e4942, true);
    new Uint8Array(bytes, 28 + padded).set(bin);
    return bytes;
}
test("static GLB preserves hierarchy/pivot, content identity and opaque resource ownership", async () => {
    const bytes = await fixture(), asset = await loadSpatialGlb(bytes, { materialProfile: "diffuse" });
    deepEqual(asset.bounds, [-14, 0, -13, 18, 24, 15]);
    equal(asset.primitiveCount, 1);
    equal(asset.triangleCount, 8);
    ok(/^[a-f0-9]{64}$/.test(asset.contentId));
    ok(Object.isFrozen(asset));
    equal((await loadSpatialGlb(bytes, { materialProfile: "diffuse" })).contentId, asset.contentId);
    let bound = true;
    const native = { configure_spatial_scene_models: () => true, spatial_model_asset_in_use: () => bound };
    const api = createSpatialApi(native as unknown as Engine, () => { }, () => ({ width: 640, height: 360 }));
    ok(api.registerDataSceneSpatialModel("rock", asset));
    ok(api.registerDataSceneSpatialModel("rock", asset));
    equal(api.registerDataSceneSpatialModel("forged", { ...asset }), false);
    equal(api.releaseDataSceneSpatialModel("rock"), false);
    bound = false;
    ok(api.releaseDataSceneSpatialModel("rock"));
});
test("GLB unit conversions preserve normals at small and large positive node scales",async()=>{
    for(const scale of [1e-6,1e9]) {
        const asset=await loadSpatialGlb(await fixture(j=>{j.nodes[0].scale=[scale,scale,scale];}),{materialProfile:"diffuse"});
        deepEqual(asset.bounds,[-14,0,-13,18,24,15].map(x=>Math.fround(x*scale)));
        const data=spatialModelResource(asset)!;
        deepEqual([...data.primitives[0].vertices.subarray(5,8)],[0,1,0]);
    }
});
test("GLB MASK cutoff and double-sided material survive node baking with glTF defaults", async () => {
    for (const [mode, cutoff, expected] of [["OPAQUE", undefined, 0], ["OPAQUE", 0.8, 0], ["MASK", undefined, 0.5], ["MASK", 0, 0], ["MASK", 0.3, Math.fround(0.3)], ["MASK", 1+1e-8, 1+2**-23], ["MASK", 2, 2]] as const) {
        const asset = await loadSpatialGlb(await fixture(j => {
            j.materials[0].alphaMode = mode;
            j.materials[0].alphaCutoff = cutoff;
            j.materials[0].doubleSided = true;
        }), { materialProfile: "diffuse" });
        const p = spatialModelResource(asset)!.primitives[0];
        equal(p.alphaCutoff, expected);
        equal(p.doubleSided, true);
        deepEqual(asset.bounds, [-14, 0, -13, 18, 24, 15]);
    }
    const defaults = spatialModelResource(await loadSpatialGlb(await fixture(), { materialProfile: "diffuse" }))!.primitives[0];
    equal(defaults.doubleSided, false);
});
test("tree hierarchy keeps the foot pivot and distinct opaque trunk/MASK canopy primitives",async()=>{
    const asset=await loadSpatialGlb(await fixture(()=>{},"tree"),{materialProfile:"diffuse"});
    deepEqual(asset.bounds,[-32,0,-4,32,96,4]);equal(asset.primitiveCount,2);equal(asset.triangleCount,14);
    const [trunk,canopy]=spatialModelResource(asset)!.primitives;
    equal(trunk.alphaCutoff,0);equal(trunk.doubleSided,false);
    equal(canopy.alphaCutoff,.5);equal(canopy.doubleSided,true);
    equal(canopy.vertices[1],32);
});
test("GLB rejects oversized response before downloading and releases readers when cancellation fails",async()=>{
    const fetch=globalThis.fetch;
    let cancelled=false,released=false;
    try {
        globalThis.fetch=async()=>new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true;}}),{headers:{"content-length":String(33*1024*1024)}});
        await rejects(loadSpatialGlb("/oversized.glb",{materialProfile:"diffuse"}),/32 MiB/);ok(cancelled);
        for(const status of [200,503]) {
            globalThis.fetch=async()=>({ok:status===200,status,headers:new Headers({"content-length":String(33*1024*1024)}),body:{cancel:async()=>{throw Error("cancel failure");}}}) as unknown as Response;
            await rejects(loadSpatialGlb("/cancel-failed.glb",{materialProfile:"diffuse"}),status===200?/32 MiB/:/HTTP 503/);
        }
        // A broken stream can reject both read and cancellation; preserve the read cause and release its lock.
        const response={ok:true,headers:new Headers(),body:{getReader:()=>({
            read:async()=>{throw Error("read failure");},cancel:async()=>{throw Error("cancel failure");},releaseLock:()=>{released=true;},
        })}};
        globalThis.fetch=async()=>response as unknown as Response;
        await rejects(loadSpatialGlb("/broken.glb",{materialProfile:"diffuse"}),/read failure/);ok(released);
    } finally {globalThis.fetch=fetch;}
});
test("GLB rejects malformed accessors, hierarchy, extensions, materials and transforms before registration", async () => {
    const edits: ((j: Fixture) => void)[] = [
        j => j.extensionsRequired = ["KHR_draco_mesh_compression"], j => j.nodes[1].children = [0],
        j => j.nodes[1].scale = [-1, 1, 1], j => j.nodes[1].scale = [0, 1, 1],
        j => j.accessors[0].count = 65537, j => j.accessors[0].byteOffset = 999999,
        j => j.accessors[1].normalized = true, j => j.bufferViews[0].byteStride = 5,
        j => j.materials[0].alphaMode = "BLEND", j => j.materials[0].alphaMode = "UNKNOWN",
        j => j.materials[0].alphaCutoff = -0.1, j => j.materials[0].alphaCutoff = 1e39,
        j => j.materials[0].alphaCutoff = 1e-50,
        j => Object.assign(j.materials[0], {alphaMode:["MASK"]}),
        j => Object.assign(j.materials[0], {alphaCutoff:null}),
        j => Object.assign(j.materials[0], {doubleSided:"yes"}),
        j => j.meshes[0].primitives[0].mode = 1, j => j.buffers[0].uri = "external.bin",
        j => j.accessors[3].count = 23, j => j.nodes[1].translation = [1e39, 0, 0],
    ];
    for (const edit of edits)
        await rejects(loadSpatialGlb(await fixture(edit), { materialProfile: "diffuse" }), /Spatial (GLB|glTF)/);
    const aborted = new AbortController();
    aborted.abort();
    await rejects(loadSpatialGlb(await fixture(), { materialProfile: "diffuse", signal: aborted.signal }), /abort/i);
    const bad = await fixture();
    new DataView(bad).setUint32(8, 99, true);
    await rejects(loadSpatialGlb(bad, { materialProfile: "diffuse" }), /header/);
});

test("GLB validates exported tangent spaces and linear emissive factors before image allocation",async()=>{
    const data=spatialModelResource(await loadSpatialGlb(await fixture(j=>{j.materials[1].emissiveFactor=[.1,.3,.9];},"tree-material"),{materialProfile:"diffuse"}))!;
    deepEqual(data.primitives[1].emissiveFactor,[.1,.3,.9]);
    const edits:((j:Fixture)=>void)[]=[
        j=>j.materials[1].emissiveFactor=[-1,0,0],j=>j.materials[1].emissiveFactor=[0,2,0],
        j=>Object.assign(j.materials[1],{emissiveFactor:null}),
        j=>j.accessors[j.meshes[1].primitives[0].attributes.TANGENT].count=3,
    ];
    for(const edit of edits)await rejects(loadSpatialGlb(await fixture(edit,"tree-material"),{materialProfile:"diffuse"}),/Spatial GLB/);
});

test("GLB normal/emissive references preserve tangent handedness and bake nonuniform node transforms",async()=>{
    const originalBitmap=globalThis.createImageBitmap,originalRead=SpatialModelImageReader.prototype.read;
    let closed=0;
    try {
        globalThis.createImageBitmap=(async(blob:Blob)=>{
            const data=new DataView(await blob.arrayBuffer());
            return {width:data.getUint32(16),height:data.getUint32(20),close:()=>{closed++;}} as ImageBitmap;
        }) as typeof createImageBitmap;
        SpatialModelImageReader.prototype.read=function(bitmap:ImageBitmap){return new Uint8ClampedArray(bitmap.width*bitmap.height*4).fill(255);};
        const bytes=await fixture(j=>Object.assign(j.nodes[0],{matrix:[1,1,0,0,0,2,0,0,0,0,.5,0,0,0,0,1]}),"tree-material",true);
        const asset=await loadSpatialGlb(bytes,{materialProfile:"diffuse"}),p=spatialModelResource(asset)!.primitives[1];
        equal(p.vertices.length,4*12);deepEqual([...p.vertices.subarray(5,8)],[0,0,1]);
        deepEqual([...p.vertices.subarray(8,12)],[Math.fround(Math.SQRT1_2),Math.fround(Math.SQRT1_2),0,-1]);
        equal(p.normal?.image,1);equal(p.normal?.scale,1);equal(p.emissive?.image,2);deepEqual(p.emissiveFactor,[.4,.6,.8]);equal(closed,3);
        for(const edit of [
            (j:Fixture)=>delete j.meshes[1].primitives[0].attributes.TANGENT,
            (j:Fixture)=>j.materials[1].normalTexture!.scale=65,
            (j:Fixture)=>Object.assign(j.materials[1].normalTexture!,{scale:null}),
            (j:Fixture)=>Object.assign(j.materials[1].emissiveTexture!,{texCoord:1}),
        ])await rejects(loadSpatialGlb(await fixture(edit,"tree-material",true),{materialProfile:"diffuse"}),/Spatial GLB/);
    } finally {globalThis.createImageBitmap=originalBitmap;SpatialModelImageReader.prototype.read=originalRead;}
});

test("GLB preserves supported draw order and merges larger static material groups within geometry budgets",async()=>{
    const withCount=(count:number)=>fixture(j=>{const p=j.meshes[0].primitives[0];j.meshes[0].primitives=Array.from({length:count},()=>p);});
    const model=await loadSpatialGlb(await withCount(32),{materialProfile:"diffuse"});
    equal(model.primitiveCount,32);equal(model.triangleCount,8*32);
    const merged=await loadSpatialGlb(await withCount(64),{materialProfile:"diffuse"});
    equal(merged.primitiveCount,1);equal(merged.triangleCount,8*64);
    const resource=spatialModelResource(merged)!;
    equal(resource.primitives[0].indices.length,8*64*3);
    ok(resource.primitives[0].indices.every(i=>i<resource.primitives[0].vertices.length/8));
    ok(merged.diagnostics.some(x=>x.includes("merged 64")));
    await rejects(loadSpatialGlb(await fixture(j=>{
        j.materials=Array.from({length:33},(_,i)=>({pbrMetallicRoughness:{baseColorFactor:[i/33,0,0,1]}}));
        const p=j.meshes[0].primitives[0];j.meshes[0].primitives=Array.from({length:33},(_,i)=>({...p,material:i}));
    }),{materialProfile:"diffuse"}),/material batch limit 32/);
});
test("GLB supports required unlit and bounded emissive strength without accepting unknown material extensions",async()=>{
    const hdr=await loadSpatialGlb(await fixture(j=>{
        j.extensionsRequired=['KHR_materials_emissive_strength'];
        j.materials[0].emissiveFactor=[1,.5,0];
        j.materials[0].extensions={KHR_materials_emissive_strength:{emissiveStrength:4}};
    }),{materialProfile:'diffuse'});
    deepEqual(spatialModelResource(hdr)!.primitives[0].emissiveFactor,[4,2,0]);
    const unlit=await loadSpatialGlb(await fixture(j=>{
        j.extensionsRequired=['KHR_materials_unlit'];j.materials[0].extensions={KHR_materials_unlit:{}};
        j.materials[0].emissiveFactor=[1,1,1];j.materials[0].alphaMode='MASK';
    }),{materialProfile:'diffuse'});
    equal(spatialModelResource(unlit)!.primitives[0].unlit,true);
    deepEqual(spatialModelResource(unlit)!.primitives[0].emissiveFactor,[0,0,0]);
    for(const extension of [
        {KHR_materials_emissive_strength:{emissiveStrength:-1}},
        {KHR_materials_emissive_strength:{emissiveStrength:65}},
        {KHR_materials_emissive_strength:{emissiveStrength:'4'}},
        {KHR_materials_unlit:null},
        {KHR_materials_unlit:{},KHR_materials_emissive_strength:{}},
        {KHR_materials_transmission:{}},
    ])await rejects(loadSpatialGlb(await fixture(j=>{j.materials[0].extensions=extension;}),{materialProfile:'diffuse'}),/Spatial GLB/);
});
test("GLB fragmented HTTP streams preserve content identity and release their reader",async()=>{
    const originalFetch=globalThis.fetch,bytes=new Uint8Array(await fixture());let offset=0,readerClosed=false;
    try {
        const stream=new ReadableStream<Uint8Array>({pull(controller){if(offset===bytes.length){readerClosed=true;controller.close();}else controller.enqueue(bytes.subarray(offset,++offset));}});
        globalThis.fetch=async()=>new Response(stream);
        const asset=await loadSpatialGlb("/fragmented.glb",{materialProfile:"diffuse"});
        equal(asset.contentId,(await loadSpatialGlb(bytes.buffer,{materialProfile:"diffuse"})).contentId);
        ok(readerClosed);equal(stream.locked,false);
    } finally {globalThis.fetch=originalFetch;}
});

test("public model thumbnails are deterministic bounded SVG geometry without DOM or GPU ownership", async () => {
    const asset = await loadSpatialGlb(await fixture(), {materialProfile:"diffuse"});
    const before = [asset.contentId,...asset.bounds];
    const svg = createSpatialModelThumbnailSvg(asset,80);
    ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="80"'));
    ok(svg.includes("<polygon "));ok(!svg.includes("NaN") && !svg.includes("Infinity"));
    ok((svg.match(/<polygon /g) ?? []).length <= 2048);
    equal(createSpatialModelThumbnailSvg(asset,80),svg);deepEqual([asset.contentId,...asset.bounds],before);
    for(const size of [0,15,257,NaN,80.5])throws(()=>createSpatialModelThumbnailSvg(asset,size),/size/);
});
