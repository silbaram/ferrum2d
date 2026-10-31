import { createEngine, AssetLoader, WebGL2Renderer, decodeRenderCommands } from "@ferrum2d/ferrum-web/core";
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
  let id = 0, engine, sample, spriteUvs=[],spatialUvs=[];
  globalThis.requestAnimationFrame = callback => { pending.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = key => pending.delete(key);
  try {
    window.pixelResumeStage = "textures";
    await loader.loadAssets({ textures, textureOptions: bundle.manifest.textureOptions });
    window.pixelResumeStage = "engine";
    engine = await createEngine(frame => {
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
        sprites: frame.spriteCount, drawCalls: renderer.stats().drawCalls,
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
    if(visual.animationSet&&bundle.assets.find(asset=>asset.id===visual.texture)?.source.version!==5) {
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
    const normalName=bundle.sceneDocument.spatial?.billboards?.[pose.id]?.normalTexture;
    if(normalName) {
      window.pixelResumeStage="normalLighting";
      const asset=bundle.assets.find(asset=>asset.id===normalName);
      if(!asset||bundle.manifest.textureOptions[normalName]?.colorSpace!=="none")throw Error('Normal pixels or color space missing');
      const mapped=structuredClone(bundle.sceneDocument);
      mapped.spatial.environment={...mapped.spatial.environment,lighting:{ambient:[0.05,0.05,0.05],lights:[{position:{x:65,y:-80,elevation:70},radius:300,intensity:2}]}};
      const flat=structuredClone(mapped);delete flat.spatial.billboards[pose.id].normalTexture;
      let now=10000;
      const render=document=>{
        applyDataSceneAuthoringDocument(engine,document);engine.pauseDataScene();
        for(let i=0;i<3;i++){now+=16;const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(now);}
        const output=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,output);
        if(gl.getError()||sample.entities!==1||sample.drawCalls<1||sample.drawCalls>16||sample.textureSwitches>16)throw Error('Normal lighting state or budget differs');
        return output;
      };
      const shaded=render(mapped),unmapped=render(flat);let difference=0;
      for(let i=0;i<shaded.length;i+=4)if(Math.abs(shaded[i]-unmapped[i])+Math.abs(shaded[i+1]-unmapped[i+1])+Math.abs(shaded[i+2]-unmapped[i+2])>8)difference++;
      if(difference<20)throw Error('Actual HD-2D normal map did not affect lighting: '+difference);
      render(mapped);engine.resumeDataScene();now+=16;const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(now);
      if(sample.state!==1)throw Error('Normal mapped game did not resume Playing');
      normalMapping={lightingChanged:true,differentPixels:difference,colorSpace:'none',playingState:sample.state,drawCalls:sample.drawCalls,textureSwitches:sample.textureSwitches,controlledLighting:true};
    }
    return { freshSession: true, assets: bundle.assets.length, hashes: true, bluePixels: blue, ...pausedSample,...(playback?{playback}:{}),...(fixedAtlas?{fixedAtlas}:{}),...(taggedPlayback?{taggedPlayback}:{}),...(normalMapping?{normalMapping}:{}) };
  } finally {
    engine?.destroy(); renderer.destroy();
    globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel;
  }
}
