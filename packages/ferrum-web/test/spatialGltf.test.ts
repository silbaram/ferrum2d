import { test } from "node:test";
import { equal, deepEqual, ok, rejects } from "node:assert/strict";
import { loadSpatialGltf } from "../src/core.js";
import { spatialModelResource } from "../src/spatialModel.js";
import { SpatialModelImageReader } from "../src/spatialModelImage.js";

function fixture() {
    const bin = new Uint8Array(78), view = new DataView(bin.buffer);
    [0,0,0,0,0,1,1,0,0,0,1,0,0,1,0,0,1,0].forEach((x,i)=>view.setFloat32(i*4,x,true));
    [0,1,2].forEach((x,i)=>view.setUint16(72+i*2,x,true));
    const json = {asset:{version:"2.0"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
        buffers:[{uri:"scene.bin",byteLength:78}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36},{buffer:0,byteOffset:72,byteLength:6}],
        accessors:[{bufferView:0,componentType:5126,count:3,type:"VEC3"},{bufferView:1,componentType:5126,count:3,type:"VEC3"},{bufferView:2,componentType:5123,count:3,type:"SCALAR"}],
        meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.8,.2,.1,1]}}],
        images:[] as Record<string,unknown>[],extensionsRequired:[] as string[],
    };
    return {json,bin};
}
async function server<T>(files:Record<string,Uint8Array>, run:(calls:string[])=>Promise<T>):Promise<T> {
    const original=globalThis.fetch,calls:string[]=[];
    globalThis.fetch=async(input,init)=>{
        equal(init?.redirect,"error");calls.push(String(input));
        const data=files[new URL(String(input)).pathname];
        return data?new Response(data.slice().buffer):new Response(null,{status:404});
    };
    try{return await run(calls);}finally{globalThis.fetch=original;}
}
const encode=(json:unknown)=>new TextEncoder().encode(JSON.stringify(json));
const options={materialProfile:"diffuse"} as const;

test("separate glTF preserves geometry/opaque ownership and hashes dependency content",async()=>{
    const f=fixture(),files={"/models/scene.gltf":encode(f.json),"/models/scene.bin":f.bin};
    await server(files,async calls=>{
        const a=await loadSpatialGltf("https://assets.test/models/scene.gltf",options);
        deepEqual(a.bounds,[0,0,0,1,0,1]);equal(a.primitiveCount,1);equal(a.triangleCount,1);ok(Object.isFrozen(a));
        equal((await loadSpatialGltf("https://assets.test/models/scene.gltf",options)).contentId,a.contentId);
        new DataView(f.bin.buffer).setFloat32(24,2,true);
        const b=await loadSpatialGltf("https://assets.test/models/scene.gltf",options);ok(b.contentId!==a.contentId);deepEqual(b.bounds,[0,0,0,2,0,1]);
        equal(calls.length,6);ok(!("primitives" in b));
    });
});
test("multiple binary buffers rebase accessors without changing normalized content",async()=>{
    const f=fixture(),split=structuredClone(f.json);
    split.buffers=[{uri:"position.bin",byteLength:36},{uri:"rest.bin",byteLength:42}];
    split.bufferViews[1]={buffer:1,byteOffset:0,byteLength:36};split.bufferViews[2]={buffer:1,byteOffset:36,byteLength:6};
    await server({"/single.gltf":encode(f.json),"/scene.bin":f.bin,"/split.gltf":encode(split),"/position.bin":f.bin.slice(0,36),"/rest.bin":f.bin.slice(36)},async()=>{
        const a=await loadSpatialGltf("https://a.test/single.gltf",options),b=await loadSpatialGltf("https://a.test/split.gltf",options);
        equal(b.contentId,a.contentId);deepEqual(spatialModelResource(b)!.primitives[0].vertices,spatialModelResource(a)!.primitives[0].vertices);
    });
});
test("duplicate dependency URLs fetch once and buffers keep separate view ranges",async()=>{
    const f=fixture();f.json.buffers.push({...f.json.buffers[0]});f.json.bufferViews[1].buffer=1;
    await server({"/scene.gltf":encode(f.json),"/scene.bin":f.bin},async calls=>{
        equal((await loadSpatialGltf("https://a.test/scene.gltf",options)).triangleCount,1);equal(calls.length,2);
    });
});
test("original bufferView bounds cannot become valid by appending other buffers/images",async()=>{
    const f=fixture();f.json.buffers.push({uri:"other.bin",byteLength:100});f.json.bufferViews[2].byteLength=8;
    await server({"/scene.gltf":encode(f.json)},async calls=>{
        await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/original bounds/);equal(calls.length,1);
    });
});
test("appended image views cannot legitimize an invalid original accessor reference",async()=>{
    const f=fixture(),png=new Uint8Array(60);png.set([137,80,78,71,13,10,26,10]);
    new DataView(png.buffer).setUint32(12,0x49484452);new DataView(png.buffer).setUint32(16,1);new DataView(png.buffer).setUint32(20,1);
    png.set(f.bin.subarray(0,36),24);
    Object.assign(f.json.accessors[0],{bufferView:f.json.bufferViews.length,byteOffset:24});
    f.json.images=[{uri:"pixel.png"}];
    const bitmap=globalThis.createImageBitmap,read=SpatialModelImageReader.prototype.read;
    globalThis.createImageBitmap=(async()=>({width:1,height:1,close(){}})) as unknown as typeof createImageBitmap;
    SpatialModelImageReader.prototype.read=()=>new Uint8ClampedArray([255,255,255,255]);
    try{
        await server({"/scene.gltf":encode(f.json),"/scene.bin":f.bin,"/pixel.png":png},async calls=>{
            await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/original bufferView/);
            equal(calls.length,1);
        });
    }finally{globalThis.createImageBitmap=bitmap;SpatialModelImageReader.prototype.read=read;}
});
test("encoded Content-Length does not reject a valid decoded binary or bypass stream limits",async()=>{
    const f=fixture(),original=globalThis.fetch;
    try{
        for(const encoding of ["gzip","br","deflate","identity"]){
            globalThis.fetch=async input=>new URL(String(input)).pathname==="/scene.gltf"?new Response(encode(f.json).buffer):
                new Response(f.bin.slice().buffer,{headers:{"content-encoding":encoding,"content-length":String(f.bin.length+32)}});
            if(encoding==="identity")await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/size limit/);
            else equal((await loadSpatialGltf("https://a.test/scene.gltf",options)).triangleCount,1);
        }
        // CORS exposes Content-Length by default while Content-Encoding may be hidden.
        globalThis.fetch=async input=>{
            if(new URL(String(input)).pathname==="/scene.gltf")return new Response(encode(f.json).buffer);
            const response=new Response(f.bin.slice().buffer,{headers:{"content-length":String(f.bin.length+32)}});
            Object.defineProperty(response,"type",{value:"cors"});return response;
        };
        equal((await loadSpatialGltf("https://a.test/scene.gltf",options)).triangleCount,1);
        let cancelled=false,stream:ReadableStream<Uint8Array>;
        globalThis.fetch=async input=>new URL(String(input)).pathname==="/scene.gltf"?new Response(encode(f.json).buffer):
            new Response(stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(79));},cancel(){cancelled=true;}}),{headers:{"content-encoding":"gzip","content-length":"1"}});
        await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/size limit/);ok(cancelled);equal(stream!.locked,false);
    }finally{globalThis.fetch=original;}
});
test("all dependency URL/shape limits reject before fetching binary or images",async()=>{
    for(const uri of ["https://other.test/a.bin","data:application/octet-stream;base64,AA==","file:///a.bin","https://user:pass@a.test/a.bin","scene.bin#slice"]){
        const f=fixture();f.json.images=[{uri}];
        await server({"/scene.gltf":encode(f.json)},async calls=>{await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/origin|HTTP\(S\)/);equal(calls.length,1);});
    }
    for(const edit of [(f:ReturnType<typeof fixture>)=>{f.json.buffers=Array(17).fill(f.json.buffers[0]);},(f:ReturnType<typeof fixture>)=>{f.json.images=Array(17).fill({uri:"i.png"});},(f:ReturnType<typeof fixture>)=>{f.json.images=[{uri:"i.png",bufferView:0}];}]){
        const f=fixture();edit(f);await server({"/scene.gltf":encode(f.json)},async calls=>{await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/array limit|cannot coexist/);equal(calls.length,1);});
    }
});
test("external buffer length mismatch and missing dependencies fail without returning an asset",async()=>{
    for(const bytes of [new Uint8Array(77),new Uint8Array(79),undefined]){
        const f=fixture(),files:Record<string,Uint8Array>={"/scene.gltf":encode(f.json)};if(bytes)files["/scene.bin"]=bytes;
        await server(files,async()=>{await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/length mismatch|size limit|HTTP 404/);});
    }
});
test("streamed size checks cancel and unlock despite false Content-Length or cleanup errors",async()=>{
    const original=globalThis.fetch;
    for(const advertised of ["1","99999999"]){
        let cancelled=false,stream:ReadableStream<Uint8Array>;
        globalThis.fetch=async()=>{
            stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(2*1024*1024+1));},cancel(){cancelled=true;throw Error("cleanup");}});
            return new Response(stream,{headers:{"content-length":advertised}});
        };
        try{await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/size limit/);ok(cancelled);equal(stream!.locked,false);}finally{globalThis.fetch=original;}
    }
});
test("aggregate transfer limit includes root JSON and cancels the overflowing dependency",async()=>{
    const f=fixture(),size=2*1024*1024;f.json.buffers=Array.from({length:16},(_,i)=>({uri:`${i}.bin`,byteLength:size}));
    const original=globalThis.fetch;let cancelled=false,calls=0;
    globalThis.fetch=async()=>{
        calls++;if(calls===1)return new Response(encode(f.json).buffer);
        return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(size));},pull(c){c.close();},cancel(){cancelled=true;}}),{headers:{"content-length":String(size)}});
    };
    try{await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/aggregate size limit/);equal(calls,17);ok(cancelled);}finally{globalThis.fetch=original;}
});
test("abort before fetch and during a dependency stream preserves cancellation and unlocks",async()=>{
    const original=globalThis.fetch,controller=new AbortController();let calls=0,cancelled=false,stream:ReadableStream<Uint8Array>|undefined;
    const f=fixture();globalThis.fetch=async(_url,init)=>{calls++;equal(init?.signal,controller.signal);if(calls===1)return new Response(encode(f.json).buffer);
        stream=new ReadableStream({pull(c){controller.abort();c.enqueue(f.bin);},cancel(){cancelled=true;}});return new Response(stream);};
    try{
        await rejects(loadSpatialGltf("https://a.test/scene.gltf",{...options,signal:controller.signal}),/AbortError/);equal(calls,2);ok(cancelled);equal(stream!.locked,false);
        await rejects(loadSpatialGltf("https://a.test/scene.gltf",{...options,signal:controller.signal}),/AbortError/);equal(calls,2);
    }finally{globalThis.fetch=original;}
});
test("external image MIME inference, repeat URI reuse and bytes participate in identity",async()=>{
    const f=fixture(),png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10]);new DataView(png.buffer).setUint32(12,0x49484452);new DataView(png.buffer).setUint32(16,1);new DataView(png.buffer).setUint32(20,1);
    f.json.images=[{uri:"textures/pixel.png"},{uri:"textures/pixel.png",mimeType:"image/png"}];
    const bitmap=globalThis.createImageBitmap,read=SpatialModelImageReader.prototype.read;let closed=0;
    globalThis.createImageBitmap=(async()=>({width:1,height:1,close(){closed++;}})) as unknown as typeof createImageBitmap;
    SpatialModelImageReader.prototype.read=()=>new Uint8ClampedArray([255,255,255,255]);
    try{
        await server({"/scene.gltf":encode(f.json),"/scene.bin":f.bin,"/textures/pixel.png":png},async calls=>{
            const a=await loadSpatialGltf("https://a.test/scene.gltf",options);equal(calls.length,3);equal(closed,2);
            png[11]=1;const b=await loadSpatialGltf("https://a.test/scene.gltf",options);ok(a.contentId!==b.contentId);
        });
        f.json.images[0].mimeType="image/jpeg";
        await server({"/scene.gltf":encode(f.json),"/scene.bin":f.bin,"/textures/pixel.png":png},async()=>{await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/mimeType mismatch/);});
    }finally{globalThis.createImageBitmap=bitmap;SpatialModelImageReader.prototype.read=read;}
});
test("profile, unsupported root input and required features fail before dependency fetch",async()=>{
    for(const source of ["file:///scene.gltf","data:application/json,{}","https://a:b@a.test/scene.gltf"])
        await rejects(loadSpatialGltf(source,options),/HTTP\(S\)/);
    await rejects(loadSpatialGltf("https://a.test/scene.gltf",{materialProfile:"pbr"} as never),/diffuse/);
    const f=fixture();f.json.extensionsRequired=["KHR_draco_mesh_compression"];
    await server({"/scene.gltf":encode(f.json)},async calls=>{await rejects(loadSpatialGltf("https://a.test/scene.gltf",options),/unsupported/);equal(calls.length,1);});
});


test("null required extensions reject before any dependency fetch", async () => {
    const f = fixture();
    Object.assign(f.json, { extensionsRequired: null });
    await server({ "/scene.gltf": encode(f.json), "/scene.bin": f.bin }, async calls => {
        await rejects(loadSpatialGltf("https://a.test/scene.gltf", options), /required extensions/);
        equal(calls.length, 1);
    });
});
