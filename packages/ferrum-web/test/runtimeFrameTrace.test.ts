import {test} from 'node:test';
import {deepEqual,equal,throws,ok} from 'node:assert/strict';
import {RuntimeProfiler,type RuntimeDiagnosticsFrameSample} from '../src/runtimeProfiler.js';

const frame=(id:number,patch:Partial<RuntimeDiagnosticsFrameSample>={}):RuntimeDiagnosticsFrameSample=>({rendererFrameId:id,fps:60,frameTimeMs:16,frameIntervalMs:16,rustUpdateTimeMs:1,renderTimeMs:2,entityCount:216,spriteCount:0,drawCalls:216,batchCount:1,modelCount:216,modelUploadBytes:0,modelInstanceUploadBytes:16000,spatialShadowCacheHit:false,spatialShadowDrawCalls:432,...patch});

test('slow-frame windows retain before/after rows and join delayed GPU results to issuing frames',()=>{
 const p=new RuntimeProfiler({maxFrameSamples:1,frameTrace:{beforeFrames:2,afterFrames:2,maxCaptures:2}});
 p.recordFrame(frame(10));p.recordFrame(frame(11));
 p.recordFrame(frame(12,{frameIntervalMs:40,renderTimeMs:38,modelUploadBytes:69360}));
 p.recordFrame(frame(13,{gpuFrameId:11,gpuFrameTimeMs:5}));
 p.recordFrame(frame(14,{gpuFrameId:12,gpuFrameTimeMs:39.98}));
 p.recordFrame(frame(15,{gpuFrameId:13,gpuFrameTimeMs:6}));
 p.recordFrame(frame(16,{gpuFrameId:14,gpuFrameTimeMs:7}));
 const s=p.snapshot().frameTrace!,capture=s.captures[0];
 equal(capture.triggerFrameId,12);deepEqual(capture.causes,['interval','cpu','gpu']);equal(capture.complete,true);
 deepEqual(capture.frames.map(f=>f.rendererFrameId),[10,11,12,13,14]);
 equal(capture.frames[2].gpuFrameTimeMs,39.98);equal(capture.frames[2].modelUploadBytes,69360);
 equal(capture.frames[3].gpuFrameTimeMs,6);equal(capture.frames[4].gpuFrameTimeMs,7);
 equal(capture.frames[0].gpuFrameTimeMs,undefined);equal(s.measuredGpuFrameCount,4);equal(s.unmeasuredGpuFrameCount,1);
 equal(p.snapshot().frameSampleCount,1,'trace survives ordinary rolling profiler eviction');
 (capture.frames[2] as {modelUploadBytes:number}).modelUploadBytes=0;
 equal(p.snapshot().frameTrace!.captures[0].frames[2].modelUploadBytes,69360,'snapshots are independent copies');
});

test('late GPU-only stalls create historical windows instead of assigning time to current draw costs',()=>{
 const p=new RuntimeProfiler({frameTrace:{beforeFrames:1,afterFrames:1}});
 for(let i=1;i<=5;i++)p.recordFrame(frame(i,{modelUploadBytes:i*100}));
 p.recordFrame(frame(6,{gpuFrameId:3,gpuFrameTimeMs:40}));
 const c=p.snapshot().frameTrace!.captures[0];equal(c.triggerFrameId,3);deepEqual(c.causes,['gpu']);equal(c.complete,true);
 deepEqual(c.frames.map(f=>f.rendererFrameId),[2,3,4]);equal(c.frames[1].gpuFrameTimeMs,40);equal(c.frames[1].modelUploadBytes,300);
 p.recordFrame(frame(7,{gpuFrameId:3,gpuFrameTimeMs:100}));equal(p.snapshot().frameTrace!.duplicateGpuResultCount,1);
 equal(p.snapshot().frameTrace!.captures[0].frames[1].gpuFrameTimeMs,40);
});

test('trace storage is bounded under sustained stalls and reset drops prior IDs/results',()=>{
 const p=new RuntimeProfiler({frameTrace:{beforeFrames:2,afterFrames:2,maxCaptures:2}});
 for(let i=1;i<=1000;i++)p.recordFrame(frame(i,{frameIntervalMs:40}));
 const s=p.snapshot().frameTrace!;equal(s.captures.length,2);ok(s.droppedCaptureCount>0);ok(s.captures.every(c=>c.frames.length<=5));
 p.recordFrame(frame(1001,{gpuFrameId:1,gpuFrameTimeMs:40}));equal(p.snapshot().frameTrace!.droppedGpuResultCount,1);
 p.reset();equal(p.snapshot().frameTrace!.captures.length,0);p.recordFrame(frame(1,{frameIntervalMs:40}));
 equal(p.snapshot().frameTrace!.captures.length,1);equal(p.snapshot().frameTrace!.droppedCaptureCount,0);
 throws(()=>p.recordFrame(frame(1)),/strictly increase/);
});

test('trace is opt-in, validates capacities and never fabricates unsupported GPU times',()=>{
 const p=new RuntimeProfiler();p.recordFrame(frame(1,{frameIntervalMs:40}));equal(p.snapshot().frameTrace,undefined);
 for(const options of [{beforeFrames:241},{afterFrames:-1},{maxCaptures:0},{maxCaptures:33},{frameBudgetMs:0},{gpuBudgetMs:NaN}])throws(()=>new RuntimeProfiler({frameTrace:options}),/Invalid frame trace/);
 const active=new RuntimeProfiler({frameTrace:{beforeFrames:0,afterFrames:0}});
 active.recordFrame(frame(1,{frameIntervalMs:40}));equal(active.snapshot().frameTrace!.captures[0].frames[0].gpuFrameTimeMs,undefined);
 const missing=frame(2);delete missing.rendererFrameId;active.recordFrame(missing);equal(active.snapshot().frameTrace!.missingFrameIdCount,1);
 for(const patch of [{frameIntervalMs:-1},{rendererFrameId:NaN},{spatialShadowCacheHit:1},{modelUploadBytes:-1}])throws(()=>active.recordFrame(frame(3,patch as never)));
});
