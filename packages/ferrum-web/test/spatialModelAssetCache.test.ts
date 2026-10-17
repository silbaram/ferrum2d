import { test } from "node:test";
import { equal, deepEqual, ok, rejects, throws } from "node:assert/strict";
import { SpatialModelAssetCache, type SpatialModelAssetSource } from "../src/core.js";

function fixture(copies = 1) {
    const bin = new Uint8Array(78), dv = new DataView(bin.buffer);
    [0,0,0,0,0,1,1,0,0,0,1,0,0,1,0,0,1,0].forEach((v,i)=>dv.setFloat32(i*4,v,true));
    [0,1,2].forEach((v,i)=>dv.setUint16(72+i*2,v,true));
    const json={asset:{version:"2.0"},scene:0,scenes:[{nodes:Array.from({length:copies},(_,i)=>i)}],nodes:Array.from({length:copies},()=>({mesh:0})),
        buffers:[{byteLength:78,uri:"scene.bin"}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36},{buffer:0,byteOffset:72,byteLength:6}],
        accessors:[{bufferView:0,componentType:5126,count:3,type:"VEC3"},{bufferView:1,componentType:5126,count:3,type:"VEC3"},{bufferView:2,componentType:5123,count:3,type:"SCALAR"}],
        meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2}]}]};
    const document=new TextEncoder().encode(JSON.stringify(json)),embedded={...json,buffers:[{byteLength:78}]};
    const encoded=new TextEncoder().encode(JSON.stringify(embedded)),padded=Math.ceil(encoded.length/4)*4;
    const glb=new Uint8Array(28+padded+80),header=new DataView(glb.buffer);
    [0x46546c67,2,glb.length,padded,0x4e4f534a].forEach((v,i)=>header.setUint32(i*4,v,true));
    glb.fill(32,20,20+padded);glb.set(encoded,20);header.setUint32(20+padded,80,true);header.setUint32(24+padded,0x004e4942,true);glb.set(bin,28+padded);
    return {glb,document,bin};
}
const source=(name="a"):SpatialModelAssetSource=>({url:`https://assets.test/${name}.glb`,format:"glb",materialProfile:"diffuse"});
function deferred<T>() {
    let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;
    const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};
}
async function mock<T>(fetch:typeof globalThis.fetch,run:()=>Promise<T>):Promise<T>{
    const previous=globalThis.fetch;globalThis.fetch=fetch;
    try{return await run();}finally{globalThis.fetch=previous;}
}
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

test("model cache shares a single pending decode and opaque handle across leases",async()=>{
    const data=fixture(),gate=deferred<Response>(),cache=new SpatialModelAssetCache();let calls=0;
    await mock(async()=>{calls++;return gate.promise;},async()=>{
        const one=cache.acquire(source()),two=cache.acquire({...source(),url:"https://assets.test/./a.glb"});
        deepEqual(cache.stats(),{entryCount:1,pendingLoadCount:1,waitingRequestCount:2,activeLeaseCount:0,byteLength:0,evictionCount:0,destroyed:false});
        gate.resolve(new Response(data.glb.slice().buffer));const [a,b]=await Promise.all([one,two]);
        equal(calls,1);equal(a.asset,b.asset);ok(Object.isFrozen(a)&&Object.isFrozen(a.asset));equal(a.asset.triangleCount,1);
        equal(cache.stats().activeLeaseCount,2);equal(cache.stats().byteLength,a.asset.byteLength);
        a.release();a.release();throws(()=>a.asset,/released/);equal(cache.stats().activeLeaseCount,1);equal(cache.evictUnused(),0);
        b.release();const c=await cache.acquire(source());equal(calls,1);c.release();equal(cache.evictUnused(),1);equal(cache.stats().byteLength,0);
    });cache.destroy();
});
test("model cache uses the separate glTF loader and shares dependency requests",async()=>{
    const data=fixture(),cache=new SpatialModelAssetCache();const calls:string[]=[];
    await mock(async input=>{const url=String(input);calls.push(url);return new Response((url.endsWith("gltf")?data.document:data.bin).slice().buffer);},async()=>{
        const request:SpatialModelAssetSource={url:"https://assets.test/scene.gltf",format:"gltf",materialProfile:"diffuse"};
        const [a,b]=await Promise.all([cache.acquire(request),cache.acquire(request)]);
        equal(a.asset,b.asset);deepEqual(a.asset.bounds,[0,0,0,1,0,1]);equal(calls.length,2);a.release();b.release();
    });cache.destroy();
});
test("cancelling one waiter preserves the shared load for another caller",async()=>{
    const data=fixture(),cache=new SpatialModelAssetCache(),gate=deferred<Response>(),controller=new AbortController();let loadSignal:AbortSignal|undefined;
    await mock(async(_input,init)=>{loadSignal=init?.signal??undefined;return gate.promise;},async()=>{
        const cancelled=cache.acquire(source(),{signal:controller.signal}),kept=cache.acquire(source());
        controller.abort(Error("consumer stopped"));await rejects(cancelled,/consumer stopped/);equal(loadSignal!.aborted,false);
        equal(cache.stats().waitingRequestCount,1);gate.resolve(new Response(data.glb.slice().buffer));
        const lease=await kept;equal(lease.asset.triangleCount,1);lease.release();
    });cache.destroy();
});
test("last waiter cancellation aborts the load; stale completion cannot delete its replacement",async()=>{
    const data=fixture(),cache=new SpatialModelAssetCache(),gate=deferred<Response>(),controller=new AbortController();let calls=0,loadSignal:AbortSignal|undefined;
    await mock(async(_input,init)=>{calls++;if(calls===1){loadSignal=init?.signal??undefined;return gate.promise;}return new Response(data.glb.slice().buffer);},async()=>{
        const first=cache.acquire(source(),{signal:controller.signal});controller.abort();await rejects(first,/AbortError/);
        ok(loadSignal!.aborted);equal(cache.stats().entryCount,0);
        const replacement=await cache.acquire(source());gate.resolve(new Response(data.glb.slice().buffer));await tick();
        const hit=await cache.acquire(source());equal(hit.asset,replacement.asset);equal(calls,2);equal(cache.stats().entryCount,1);
        hit.release();replacement.release();
    });cache.destroy();
});
test("already aborted and cached-hit cancellation do not leave pins",async()=>{
    const data=fixture(),cache=new SpatialModelAssetCache();let calls=0;
    await mock(async()=>{calls++;return new Response(data.glb.slice().buffer);},async()=>{
        const controller=new AbortController();controller.abort();await rejects(cache.acquire(source(),{signal:controller.signal}),/AbortError/);equal(calls,0);
        const a=await cache.acquire(source());a.release();
        const next=new AbortController(),pending=cache.acquire(source(),{signal:next.signal});next.abort();await rejects(pending,/AbortError/);
        equal(cache.stats().activeLeaseCount,0);equal(cache.stats().waitingRequestCount,0);equal(cache.evictUnused(),1);equal(calls,1);
    });cache.destroy();
});
test("cancelled loads retain their concurrency slot until decoder cleanup actually finishes",async()=>{
    const data=fixture(),gate=deferred<Response>(),cache=new SpatialModelAssetCache({maxPendingLoads:1}),controller=new AbortController();let calls=0;
    await mock(async()=>{calls++;return calls===1?gate.promise:new Response(data.glb.slice().buffer);},async()=>{
        const first=cache.acquire(source(),{signal:controller.signal});controller.abort();await rejects(first,/AbortError/);
        equal(cache.stats().entryCount,0);equal(cache.stats().pendingLoadCount,1);
        await rejects(cache.acquire(source("new")),/pending load limit/);equal(calls,1);
        gate.resolve(new Response(data.glb.slice().buffer));await tick();equal(cache.stats().pendingLoadCount,0);
        const next=await cache.acquire(source("new"));next.release();equal(calls,2);
    });cache.destroy();
});
test("caller source mutations after acquire cannot change the pending key or expected identity",async()=>{
    const data=fixture(),gate=deferred<Response>(),cache=new SpatialModelAssetCache(),request=source();let calls=0;
    await mock(async()=>{calls++;return gate.promise;},async()=>{
        const pending=cache.acquire(request);request.url="https://assets.test/changed.glb";request.contentId="0".repeat(64);
        gate.resolve(new Response(data.glb.slice().buffer));const a=await pending,b=await cache.acquire(source());
        equal(a.asset,b.asset);equal(calls,1);a.release();b.release();
    });cache.destroy();
});
test("entry capacity evicts the least recently used idle asset but never an active lease",async()=>{
    const data=fixture(),cache=new SpatialModelAssetCache({maxEntries:2});const calls:string[]=[];
    await mock(async input=>{calls.push(String(input));return new Response(data.glb.slice().buffer);},async()=>{
        const a=await cache.acquire(source("a")),handle=a.asset;a.release();const b=await cache.acquire(source("b"));b.release();
        const recent=await cache.acquire(source("a"));recent.release();const c=await cache.acquire(source("c"));
        const same=await cache.acquire(source("a"));equal(same.asset,handle);equal(calls.length,3);
        await rejects(cache.acquire(source("b")),/entry capacity is pinned/);equal(calls.length,3);equal(cache.stats().evictionCount,1);
        c.release();same.release();
    });cache.destroy();
});
test("byte capacity evicts idle assets and counts one shared resource rather than each lease",async()=>{
    const data=fixture(),cache=new SpatialModelAssetCache({maxBytes:216,maxEntries:4});
    await mock(async()=>new Response(data.glb.slice().buffer),async()=>{
        const a=await cache.acquire(source("a")),shared=await cache.acquire(source("a"));equal(a.asset.byteLength,108);equal(cache.stats().byteLength,108);
        const b=await cache.acquire(source("b"));b.release();const c=await cache.acquire(source("c"));
        equal(cache.stats().byteLength,216);equal(cache.stats().entryCount,2);equal(cache.stats().evictionCount,1);equal(shared.asset,a.asset);
        a.release();shared.release();c.release();
    });cache.destroy();
});
test("failed byte admission preserves pinned and idle assets without partial eviction",async()=>{
    const data=fixture(),large=fixture(2),cache=new SpatialModelAssetCache({maxBytes:216,maxEntries:4});let calls=0;
    await mock(async input=>{calls++;return new Response((String(input).includes("large")?large.glb:data.glb).slice().buffer);},async()=>{
        const a=await cache.acquire(source("a")),b=await cache.acquire(source("b")),handle=b.asset;b.release();
        await rejects(cache.acquire(source("large")),/byte capacity is pinned/);equal(cache.stats().entryCount,2);equal(cache.stats().evictionCount,0);
        const hit=await cache.acquire(source("b"));equal(hit.asset,handle);equal(calls,3);a.release();hit.release();
    });cache.destroy();
});
test("oversized assets, decode failures and expected-identity failures release the slot for retry",async()=>{
    const data=fixture(),cache=new SpatialModelAssetCache({maxBytes:108,maxEntries:2});let bad=true;
    await mock(async()=>new Response((bad?new Uint8Array(3):data.glb).slice().buffer),async()=>{
        await rejects(cache.acquire(source()),/file size/);equal(cache.stats().entryCount,0);bad=false;
        await rejects(cache.acquire({...source(),contentId:"0".repeat(64)}),/contentId mismatch/);equal(cache.stats().entryCount,0);
        const good=await cache.acquire(source()),id=good.asset.contentId;good.release();cache.evictUnused();
        const verified=await cache.acquire({...source(),contentId:id});equal(verified.asset.contentId,id);verified.release();
    });cache.destroy();
    const small=new SpatialModelAssetCache({maxBytes:107});
    await mock(async()=>new Response(data.glb.slice().buffer),async()=>{await rejects(small.acquire(source()),/asset exceeds byte capacity/);equal(small.stats().entryCount,0);equal(small.stats().byteLength,0);});small.destroy();
});
test("distinct pending load limit rejects before fetching while duplicate requests still share",async()=>{
    const data=fixture(),gate=deferred<Response>(),cache=new SpatialModelAssetCache({maxPendingLoads:1});let calls=0;
    await mock(async()=>{calls++;return gate.promise;},async()=>{
        const a=cache.acquire(source()),b=cache.acquire(source());await rejects(cache.acquire(source("other")),/pending load limit/);equal(calls,1);
        gate.resolve(new Response(data.glb.slice().buffer));const leases=await Promise.all([a,b]);leases.forEach(l=>l.release());
    });cache.destroy();
});
test("destroy rejects pending waiters promptly and preserves already delivered leases",async()=>{
    const data=fixture(),gate=deferred<Response>(),cache=new SpatialModelAssetCache();let calls=0,loadSignal:AbortSignal|undefined;
    await mock(async(_input,init)=>{calls++;if(calls===1)return new Response(data.glb.slice().buffer);loadSignal=init?.signal??undefined;return gate.promise;},async()=>{
        const a=await cache.acquire(source()),handle=a.asset,pending=cache.acquire(source("b"));cache.destroy();cache.destroy();
        await rejects(pending,/AbortError/);ok(loadSignal!.aborted);equal(a.asset,handle);equal(cache.stats().byteLength,0);equal(cache.stats().activeLeaseCount,1);
        await rejects(cache.acquire(source()),/destroyed/);a.release();a.release();equal(cache.stats().activeLeaseCount,0);
        gate.resolve(new Response(data.glb.slice().buffer));await tick();equal(cache.stats().entryCount,0);equal(cache.stats().waitingRequestCount,0);
    });
});
test("invalid cache capacities and source revisions fail before any fetch",async()=>{
    for(const options of [{maxEntries:0},{maxEntries:65},{maxBytes:0},{maxBytes:129*1024*1024},{maxPendingLoads:9},{maxPendingLoads:1.5}])throws(()=>new SpatialModelAssetCache(options),/capacity/);
    const cache=new SpatialModelAssetCache();let calls=0;
    await mock(async()=>{calls++;return new Response();},async()=>{
        for(const edit of [{format:"obj"},{materialProfile:"pbr"},{contentId:"ABC"},{url:"data:application/octet-stream,1"},{url:"https://a:b@assets.test/a.glb"},{url:"https://assets.test/a.glb#x"}])
            await rejects(cache.acquire({...source(),...edit} as SpatialModelAssetSource),/source|HTTP\(S\)/);
        equal(calls,0);
    });cache.destroy();
});
