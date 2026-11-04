import { verifyPairedPlayback } from "./aseprite-paired-runtime-fixture.mjs";
import { createEngine, AssetLoader, WebGL2Renderer, decodeRenderCommands, createDataSceneView } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

/** A fresh runtime consumes only exported PNGs, manifest and ordinary scene data. */
export async function probePixelResume(providedBundle) {
  window.pixelResumeStage = "source";
  const bundle = providedBundle ?? await (await fetch("/resume.json")).json();
  const canvas = document.querySelector("canvas");
  const textures = {};
  for (const asset of bundle.assets) {
    if (bundle.manifest.textures[asset.id] !== asset.path ||
      bundle.manifest.textureOptions[asset.id]?.colorSpace !== (asset.source ? "srgb" : "none"))
      throw Error("Pixel manifest differs");
    const bytes = Uint8Array.from(atob(asset.pngBase64), c => c.charCodeAt(0));
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map(n => n.toString(16).padStart(2, "0")).join("");
    if (hash !== asset.sha256) throw Error("Pixel PNG hash differs");
    textures[asset.id] = "data:image/png;base64," + asset.pngBase64;
  }
  const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true });
  const loader = new AssetLoader(renderer);
  const raf = requestAnimationFrame, cancel = cancelAnimationFrame, pending = new Map();
  let id = 0, engine, sample, view, worldLighting, spriteUvs=[],spatialUvs=[];
  globalThis.requestAnimationFrame = callback => { pending.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = key => pending.delete(key);
  try {
    window.pixelResumeStage = "textures";
    await loader.loadAssets({ textures, textureOptions: bundle.manifest.textureOptions });
    window.pixelResumeStage = "engine";
    engine = await createEngine(frame => {
      renderer.setLighting(worldLighting&&view?view.lighting(worldLighting,view.snapshot(frame)):false);
      renderer.render(); renderer.renderCommands(frame.renderCommandBuffer); renderer.renderPostProcess();
      if(engine) {
        const visual=bundle.sceneDocument.sceneComposition.fragments.main.instances[0].props.components.visual;
        const texture=engine.textureId(visual.texture);
        spriteUvs=decodeRenderCommands(frame.renderCommandBuffer).filter(command=>command.textureId===texture).map(command=>command.uv);
        spatialUvs=[];
        const spatial=frame.renderCommandBuffer.spatial;
        // Native spatial vertices: XYZ, UV, RGBA, texture ID, alpha cutoff.
        if(spatial)for(let vertex=0;vertex<spatial.billboardVertexCount;vertex++) {
          const offset=vertex*spatial.vertexStride;
          if(spatial.billboards[offset+9]===texture)spatialUvs.push([spatial.billboards[offset+3],spatial.billboards[offset+4]]);
        }
      }
      sample = { state: frame.gameState, entities: frame.entityCount,
        sprites: frame.spriteCount, drawCalls: renderer.stats().drawCalls, normalDrawCalls: renderer.stats().normalDrawCalls??0,
        textureSwitches: renderer.stats().textureSwitchCount };
    }, () => ({}), loader, () => renderer.viewportSize(), { fixedTimestep: false });
    const size = renderer.viewportSize(); engine.setViewportSize(size.width, size.height);
    window.pixelResumeStage = "scene";
    const handles=applyDataSceneAuthoringDocument(engine, bundle.sceneDocument).entityHandles;
    if (!engine.pauseDataScene()) throw Error("Pixel runtime did not enter the paused scene");
    if (!bundle.sceneDocument.spatial) {
      const pose = bundle.sceneDocument.sceneComposition.fragments.main.instances[0];
      engine.setDataSceneCamera({ x: pose.x, y: pose.y - 32 });
    }
    engine.start();
    window.pixelResumeStage = "frames";
    for (let frame = 0; frame < 3; frame++) {
      const callbacks = [...pending.values()]; pending.clear();
      for (const callback of callbacks) callback(frame * 16);
    }
    const gl = canvas.getContext("webgl2"), pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (gl.getError()) throw Error("Pixel runtime readback failed");
    if (sample?.state !== 3 || sample.entities !== 1 || sample.sprites < 1 ||
      sample.drawCalls < 1 || sample.drawCalls > 16 || sample.textureSwitches > 16)
      throw Error("Pixel runtime state or draw budget differs: " + JSON.stringify(sample));
    let blue = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 2] > pixels[i] * 2 && pixels[i + 2] > pixels[i + 1] * 1.5) blue++;
    const pausedSample={...sample};
    let playback;
    const pose=bundle.sceneDocument.sceneComposition.fragments.main.instances[0],visual=pose.props.components.visual;
    if(visual.animationSet&&![5,6,7,8,9,10].includes(bundle.assets.find(asset=>asset.id===visual.texture)?.source.version)) {
      const source=bundle.assets.find(asset=>asset.id===visual.texture)?.source;
      if(source?.version!==3||source.frames.length!==2)throw Error('Fresh animation source metadata missing');
      const clip=visual.animationSet.clips[0],handle=handles[pose.id],nativeFrames=new Set(),sourceFrames=new Set(),visible=new Set();
      const durations=source.frames.map(frame=>frame.durationMs),cycleMs=durations.reduce((sum,ms)=>sum+ms,0),columns=Math.ceil(Math.sqrt(source.frames.length)),rows=Math.ceil(source.frames.length/columns);
      if(!engine.resumeDataScene())throw Error('Pixel animation did not enter Playing');
      let maxDraws=0;
      for(let elapsed=10;elapsed<=cycleMs*2;elapsed+=10) {
        const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(32+elapsed);
        const state=engine.dataSceneSpriteAnimationState(handle);
        if(!state||state.paused||state.clip!==0||sample.state!==1||sample.entities!==1||sample.drawCalls<1||sample.drawCalls>16||sample.textureSwitches>16)
          throw Error('Pixel animation runtime state/budget differs');
        maxDraws=Math.max(maxDraws,sample.drawCalls);nativeFrames.add(state.frame);
        let phase=elapsed%cycleMs,index=0;while(index<durations.length-1&&phase>=durations[index]){phase-=durations[index++];}
        const tick=1000/Math.fround(clip.fps);
        if(Math.abs(elapsed/tick-Math.round(elapsed/tick))>1e-4) {
          const uv=clip.frames[state.frame],expected={u0:(index%columns)/columns,v0:Math.floor(index/columns)/rows,u1:(index%columns+1)/columns,v1:(Math.floor(index/columns)+1)/rows};
          if(Object.keys(expected).some(key=>Math.abs(uv[key]-expected[key])>1e-6))throw Error('Native UV duration differs from authored frame time at '+elapsed+'ms');
          sourceFrames.add(index);
        }
        if([50,150,250,350].includes(elapsed)) {
          gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          if(gl.getError())throw Error('Animated pixel readback failed');
          let red=0,blue=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>pixels[i+1]*2&&pixels[i]>pixels[i+2]*2)red++;if(pixels[i+2]>pixels[i]*2&&pixels[i+2]>pixels[i+1]*1.5)blue++;}
          const expected=index===0?'blue':'red';if((expected==='blue'?blue:red)<100)throw Error('Animated frame not visible at '+elapsed+'ms');visible.add(expected);
        }
      }
      if(nativeFrames.size!==3||sourceFrames.size!==2||visible.size!==2)throw Error('Pixel animation did not visit the full authored sequence');
      playback={playingState:sample.state,sourceFrames:sourceFrames.size,nativeFrames:nativeFrames.size,visibleFrames:visible.size,cycleMs,maxDraws};
    }
    let taggedPlayback;
    const taggedSource=bundle.assets.find(asset=>asset.id===visual.texture)?.source;
    if(taggedSource?.version===5) {
      window.pixelResumeStage="taggedPlayback";
      const handle=handles[pose.id],set=visual.animationSet,seen=new Set();
      if(!set||set.clips.length!==taggedSource.tags.length||set.initialClip!==taggedSource.tags.find(tag=>tag.id===taggedSource.initialTag)?.clipId)throw Error('Tagged metadata differs from runtime clips');
      if(!engine.resumeDataScene())throw Error('Tagged animation did not enter Playing');
      let time=32,maxDraws=0;const clips=[];
      for(const clip of set.clips) {
        if(!engine.updateDataSceneSpriteAnimations([{entity:handle,clip:clip.id,restart:true}]))throw Error('Tagged clip switch failed');
        const visited=new Set(),cycleMs=clip.frames.length*1000/clip.fps;
        for(let elapsed=10;elapsed<=cycleMs+50;elapsed+=10) {
          time+=10;const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(time);
          const state=engine.dataSceneSpriteAnimationState(handle);
          if(!state||state.clip!==clip.id||sample.state!==1||sample.entities!==1||sample.drawCalls<1||sample.drawCalls>16||sample.textureSwitches>16)throw Error('Tagged clip state or budget differs');
          maxDraws=Math.max(maxDraws,sample.drawCalls);visited.add(state.frame);
          const uv=clip.frames[state.frame],expected=['u0','v0','u1','v1'].map(key=>uv[key]);
          const actual=bundle.sceneDocument.spatial ? spatialUvs.length ? [[Math.min(...spatialUvs.map(uv=>uv[0])),Math.min(...spatialUvs.map(uv=>uv[1])),Math.max(...spatialUvs.map(uv=>uv[0])),Math.max(...spatialUvs.map(uv=>uv[1]))]] : [] : spriteUvs;
          if(!actual.length||actual.some(uv=>uv.some((v,i)=>Math.abs(v-expected[i])>1e-6)))throw Error('Tagged rendered UV differs');
          if(elapsed%50===0) {
            gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError())throw Error('Tagged readback failed');
            let blue=0,red=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+2]>pixels[i]*2&&pixels[i+2]>pixels[i+1]*1.5)blue++;if(pixels[i]>pixels[i+1]*2&&pixels[i]>pixels[i+2]*2)red++;}
            const expectedColor=uv.u0===0?'blue':'red';if((expectedColor==='blue'?blue:red)<100)throw Error('Tagged frame pixels differ');seen.add(expectedColor);
          }
        }
        const final=engine.dataSceneSpriteAnimationState(handle);
        if(visited.size!==clip.frames.length||(!clip.loop&&!final.finished))throw Error('Tagged loop or completion differs');
        clips.push({id:clip.id,nativeFrames:visited.size,loop:clip.loop,finished:final.finished});
      }
      if(seen.size!==2)throw Error('Tagged clips did not display both source cels');
      taggedPlayback={clips:clips.length,allClipsPlayed:true,clipStates:clips,renderedUVs:true,visibleFrames:seen.size,maxDraws,playingState:sample.state};
      playback={sourceFrames:seen.size,playingState:sample.state};
    }
    let capacityPlayback;
    if(taggedSource?.version===6) {
      window.pixelResumeStage="capacityPlayback";
      const capacityStarted=performance.now();
      const handle=handles[pose.id],set=visual.animationSet,seen=new Set();
      if(!set||set.clips.length!==taggedSource.tags.length)throw Error('Capacity tags differ from native clips');
      if(!engine.resumeDataScene())throw Error('Capacity animation did not enter Playing');
      let time=32,maxDraws=0,pixelChecks=0,renders=0;
      const columns=Math.ceil(Math.sqrt(taggedSource.frames.length)),rows=Math.ceil(taggedSource.frames.length/columns);
      for(const clip of set.clips) {
        window.pixelResumeStage="capacityPlayback:clip-"+clip.id;
        const tag=taggedSource.tags.find(tag=>tag.clipId===clip.id),visited=new Set();
        if(!tag||clip.fps!==undefined||clip.frames.length!==tag.frameIds.length||!clip.frameDurationsMs)throw Error('Capacity export duplicated or lost source frames');
        if(!engine.updateDataSceneSpriteAnimations([{entity:handle,clip:clip.id,restart:true}]))throw Error('Capacity clip switch failed');
        const duration=clip.frameDurationsMs.reduce((sum,ms)=>sum+ms,0);
        // 50ms is the actual GameLoop clamp and is shorter than every fixture
        // frame (83ms minimum), so every original cel must still be displayed.
        for(let elapsed=0;elapsed<=duration+50;elapsed+=50) {
          time+=50;const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(time);renders++;
          const state=engine.dataSceneSpriteAnimationState(handle);
          if(!state||state.clip!==clip.id||sample.state!==1||sample.entities!==1||sample.drawCalls<1||sample.drawCalls>16||sample.textureSwitches>16)throw Error('Capacity runtime state or budget differs');
          maxDraws=Math.max(maxDraws,sample.drawCalls);
          const id=tag.frameIds[state.frame],index=taggedSource.frames.findIndex(frame=>frame.id===id);
          const expected=[index%columns/columns,Math.floor(index/columns)/rows,(index%columns+1)/columns,(Math.floor(index/columns)+1)/rows];
          const actual=bundle.sceneDocument.spatial ? spatialUvs.length ? [[Math.min(...spatialUvs.map(uv=>uv[0])),Math.min(...spatialUvs.map(uv=>uv[1])),Math.max(...spatialUvs.map(uv=>uv[0])),Math.max(...spatialUvs.map(uv=>uv[1]))]] : [] : spriteUvs;
          if(!actual.length||actual.some(uv=>uv.some((v,i)=>Math.abs(v-expected[i])>1e-6)))throw Error('Capacity native UV differs from original cel: '+JSON.stringify({id,actual,expected}));
          if(!visited.has(id)) {
            gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
            if(gl.getError())throw Error('Capacity readback failed');
            const rgba=atob(taggedSource.frames[index].cels[0].rgba),red=rgba.charCodeAt(4),green=rgba.charCodeAt(5);
            let matches=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-red)<=2&&Math.abs(pixels[i+1]-green)<=2&&pixels[i+3]>240)matches++;
            if(matches<20)throw Error('Capacity source cel is absent from actual pixels: '+id+' '+matches);
            pixelChecks++;visited.add(id);seen.add(id);
          }
        }
        if(visited.size!==tag.frameIds.length)throw Error('Capacity playback skipped original frames');
      }
      if(seen.size!==64||taggedSource.frames.length!==64)throw Error('Capacity fixture must exercise all64 original frames');
      capacityPlayback={originalFrames:64,clips:set.clips.length,visitedOriginalFrames:seen.size,renderedUVs:true,pixelChecks,maxDraws,renders,elapsedMs:performance.now()-capacityStarted,playingState:sample.state};
      playback={sourceFrames:64,nativeFrames:64,playingState:sample.state};
    }
    let directionPlayback;
    if(visual.animationSet&&(taggedSource?.version===7||taggedSource?.version===8||taggedSource?.version===9||taggedSource?.version===10)) {
      window.pixelResumeStage='directionPlayback';
      const handle=handles[pose.id],set=visual.animationSet,results=[];
      const tags=taggedSource.tags??[{id:'all',clipId:0,frameIds:taggedSource.frames.map(frame=>frame.id),loop:true}];
      if(set.clips.length!==tags.length||set.initialClip!==tags.find(tag=>tag.id===(taggedSource.initialTag??'all'))?.clipId||!engine.resumeDataScene())throw Error('Direction source did not enter Playing');
      let time=32;
      for(const tag of tags) {
        const clip=set.clips.find(clip=>clip.id===tag.clipId),ids=tag.frameIds,count=ids.length;
        let order=Array.from({length:count},(_,i)=>i);
        if(tag.direction==='reverse')order.reverse();
        else if(tag.direction==='pingpong'&&count>1)order.push(...order.slice(tag.loop?1:0,-1).reverse());
        const durations=ids.map(id=>taggedSource.frames.find(frame=>frame.id===id).durationMs);
        const cycle=order.reduce((n,i)=>n+durations[i],0),visited=new Set();let samples=0;
        if(!engine.updateDataSceneSpriteAnimations([{entity:handle,clip:tag.clipId,restart:true}]))throw Error('Direction clip switch failed');
        for(let elapsed=10;elapsed<=cycle+50;elapsed+=10) {
          time+=10;const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(time);
          const state=engine.dataSceneSpriteAnimationState(handle);
          if(!state||state.clip!==tag.clipId||sample.state!==1||sample.entities!==1||sample.drawCalls<1||sample.drawCalls>16||sample.textureSwitches>16)throw Error('Direction runtime state/budget differs');
          let phase=tag.loop?elapsed%cycle:Math.min(elapsed,cycle-.001),step=0;
          while(step<order.length-1&&phase>=durations[order[step]])phase-=durations[order[step++]];
          if(phase<.01||durations[order[step]]-phase<.01)continue;
          const expectedIndex=order[step];if(state.frame!==expectedIndex)throw Error('Native direction/time mismatch '+JSON.stringify({tag,elapsed,expectedIndex,state}));
          const sourceIndex=taggedSource.frames.findIndex(frame=>frame.id===ids[expectedIndex]);
          const columns=Math.ceil(Math.sqrt(taggedSource.frames.length)),rows=Math.ceil(taggedSource.frames.length/columns);
          const expected=[sourceIndex%columns/columns,Math.floor(sourceIndex/columns)/rows,(sourceIndex%columns+1)/columns,(Math.floor(sourceIndex/columns)+1)/rows];
          const actual=bundle.sceneDocument.spatial?spatialUvs.length?[[Math.min(...spatialUvs.map(uv=>uv[0])),Math.min(...spatialUvs.map(uv=>uv[1])),Math.max(...spatialUvs.map(uv=>uv[0])),Math.max(...spatialUvs.map(uv=>uv[1]))]]:[]:spriteUvs;
          if(!actual.length||actual.some(uv=>uv.some((v,i)=>Math.abs(v-expected[i])>1e-6)))throw Error('Direction rendered UV differs from source');
          if(elapsed%50===0) {
            gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError())throw Error('Direction readback failed');
            const channel=[2,0,1][sourceIndex];let visible=0;
            for(let i=0;i<pixels.length;i+=4)if(pixels[i+channel]>100&&pixels[i+channel]>pixels[i+(channel+1)%3]*1.5&&pixels[i+channel]>pixels[i+(channel+2)%3]*1.5)visible++;
            if(visible<100)throw Error('Direction pixels differ '+sourceIndex);samples++;
          }
          visited.add(state.frame);
        }
        const final=engine.dataSceneSpriteAnimationState(handle);
        if(visited.size!==count||final.finished===tag.loop)throw Error('Direction completion differs');
        results.push({direction:tag.direction??'forward',loop:tag.loop,frames:visited.size,pixelChecks:samples});
      }
      directionPlayback={clips:results,playingState:sample.state,renderedUVs:true,sourceTiming:true};
    }
    let fixedAtlas;
    const atlasSource=bundle.assets.find(asset=>asset.id===visual.texture)?.source;
    if(atlasSource?.version===4) {
      const expected=['u0','v0','u1','v1'].map(key=>visual.frame[key]);
      const actual=bundle.sceneDocument.spatial ? spatialUvs.length ? [[Math.min(...spatialUvs.map(uv=>uv[0])),Math.min(...spatialUvs.map(uv=>uv[1])),
        Math.max(...spatialUvs.map(uv=>uv[0])),Math.max(...spatialUvs.map(uv=>uv[1]))]] : [] : spriteUvs;
      if(!actual.length||actual.some(uv=>uv.some((value,index)=>Math.abs(value-expected[index])>1e-6)))throw Error('Native fixed atlas UV differs: '+JSON.stringify({actual,expected}));
      if(!engine.resumeDataScene())throw Error('Fixed atlas game did not enter Playing');
      for(const time of [64,80,96]){const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(time);}
      if(sample.state!==1||sample.entities!==1||sample.sprites<1||sample.drawCalls<1||sample.drawCalls>16||sample.textureSwitches>16)throw Error('Fixed atlas runtime state or budget differs');
      fixedAtlas={uv:expected,playingState:sample.state,drawCalls:sample.drawCalls,textureSwitches:sample.textureSwitches};
    }
    let normalMapping;
    const normalName=bundle.sceneDocument.spatial?.billboards?.[pose.id]?.normalTexture ?? visual.normalTexture;
    if(normalName) {
      window.pixelResumeStage="normalLighting";
      const asset=bundle.assets.find(asset=>asset.id===normalName);
      if(!asset||bundle.manifest.textureOptions[normalName]?.colorSpace!=="none")throw Error('Normal pixels or color space missing');
      const mapped=structuredClone(bundle.sceneDocument);
      if(mapped.spatial) mapped.spatial.environment={...mapped.spatial.environment,lighting:{ambient:[0.05,0.05,0.05],lights:[{position:{x:65,y:-80,elevation:70},radius:300,intensity:2}]}};
      else mapped.lighting={ambient:[0.05,0.05,0.05,1],pointLights:[{x:pose.x+65,y:pose.y-80,radius:300,height:70,intensity:0.8}]};
      const flat=structuredClone(mapped);if(flat.spatial)delete flat.spatial.billboards[pose.id].normalTexture;else delete flat.sceneComposition.fragments.main.instances[0].props.components.visual.normalTexture;
      let now=10000;
      const render=document=>{
        applyDataSceneAuthoringDocument(engine,document);engine.pauseDataScene();
        if(!document.spatial){worldLighting=document.lighting;view=createDataSceneView(engine,renderer,canvas,{x:pose.x,y:pose.y-32});}
        for(let i=0;i<3;i++){now+=16;const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(now);}
        const output=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,output);
        if(gl.getError()||sample.entities!==1||sample.drawCalls<1||sample.drawCalls>16||sample.textureSwitches>16)throw Error('Normal lighting state or budget differs');
        return output;
      };
      const shaded=render(mapped),mappedStats={...sample},unmapped=render(flat);let difference=0;
      if(!mapped.spatial&&(mappedStats.normalDrawCalls!==1||sample.normalDrawCalls!==0))throw Error("2D normal draw accounting differs");
      for(let i=0;i<shaded.length;i+=4)if(Math.abs(shaded[i]-unmapped[i])+Math.abs(shaded[i+1]-unmapped[i+1])+Math.abs(shaded[i+2]-unmapped[i+2])>8)difference++;
      if(difference<20)throw Error('Actual normal map did not affect lighting: '+difference);
      let pairedPlayback;
      const mappedVisual=mapped.sceneComposition.fragments.main.instances[0].props.components.visual;
      const finite=mappedVisual.animationSet?.clips.find(clip=>!clip.loop&&new Set(clip.frames.map(frame=>JSON.stringify(frame))).size>=2);
      if(finite){
        const animated=structuredClone(mapped);animated.sceneComposition.fragments.main.instances[0].props.components.visual.animationSet.initialClip=finite.id;
        let anchor=now,lastElapsed=Infinity;
        pairedPlayback=verifyPairedPlayback(engine,animated,elapsed=>{
          if(elapsed<=lastElapsed)anchor=now+16;lastElapsed=elapsed;now=anchor+elapsed;
          const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(now);
          if(sample.entities!==1||sample.drawCalls>16||sample.textureSwitches>16)throw Error('Paired frame budget differs');
        },()=>{const output=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,output);if(gl.getError())throw Error('Paired frame readback failed');return output;});
      }
      render(mapped);engine.resumeDataScene();now+=16;const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(now);
      if(sample.state!==1)throw Error('Normal mapped game did not resume Playing');
      normalMapping={lightingChanged:true,differentPixels:difference,colorSpace:'none',playingState:sample.state,drawCalls:sample.drawCalls,textureSwitches:sample.textureSwitches,controlledLighting:true,...(pairedPlayback?{pairedPlayback}:{}),...(!mapped.spatial?{normalDrawCalls:mappedStats.normalDrawCalls,flatNormalDrawCalls:0}:{})};
    }
    return { freshSession: true, assets: bundle.assets.length, hashes: true, bluePixels: blue, ...pausedSample,...(playback?{playback}:{}),...(fixedAtlas?{fixedAtlas}:{}),...(directionPlayback?{directionPlayback}:{}),...(taggedPlayback?{taggedPlayback}:{}),...(capacityPlayback?{capacityPlayback}:{}),...(normalMapping?{normalMapping}:{}) };
  } finally {
    engine?.destroy(); renderer.destroy();
    globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel;
  }
}
