import {
  createEngine,
  AssetLoader,
  WebGL2Renderer,
  decodeRenderCommands,
} from "@ferrum2d/ferrum-web/core";
import {
  applyDataSceneAuthoringDocument,
  importAsepriteAtlas,
} from "@ferrum2d/ferrum-web/authoring";
const check = (v, m) => {
  if (!v) throw Error(m);
};
const hash = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export async function probeAsepriteResume(provided) {
  const {
      bundle,
      document: scene,
      instance,
      animation,
    } = provided ?? await (await fetch("/resume.json")).json(),
    textures = {};
  const assetBase=new URL(provided?.assetBase??"/resume/",location.href);
  for (const rev of bundle.revisions) {
    const json = await (
        await fetch(new URL(rev.assetId + ".json",assetBase))
      ).arrayBuffer(),
      png = await (
        await fetch(new URL(rev.assetId + ".png",assetBase))
      ).arrayBuffer();
    check(
      (await hash(json)) === rev.jsonSha256 &&
        (await hash(png)) === rev.pngSha256,
      "Resume source hash differs",
    );
    if(rev.sourcePng) {
      const original=await(await fetch(new URL(rev.assetId+".source.png",assetBase))).arrayBuffer();
      check(await hash(original)===rev.sourcePng.sha256,"Resume original trim PNG hash differs");
      const identity=await hash(new TextEncoder().encode(JSON.stringify([rev.identityDocument,rev.logicalId,rev.jsonSha256,rev.sourcePng.sha256])));
      check(rev.assetId===`aseprite.${rev.logicalId}.${identity.slice(0,24)}`,"Resume original trim identity differs");
    }
    const imported = importAsepriteAtlas(
      JSON.parse(new TextDecoder().decode(json)),
      { texture: rev.assetId, stripFrameExtension: false },
    );
    check(
      JSON.stringify(rev.sourcePng?[...imported.frameNames].sort():imported.frameNames) ===
        JSON.stringify(rev.sourcePng?rev.frames.map(f=>f.id).sort():rev.frames.map(f=>f.id)),
      "Resume frame identity differs",
    );
    const bitmap = await createImageBitmap(new Blob([png]));
    try {
      check(
        bitmap.width === rev.width && bitmap.height === rev.height,
        "Resume image size differs",
      );
    } finally {
      bitmap.close();
    }
    textures[rev.assetId] = new URL(rev.assetId + ".png",assetBase).href;
  }
  const canvas = document.querySelector("canvas"),
    renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true }),
    loader = new AssetLoader(renderer),
    raf = requestAnimationFrame,
    cancel = cancelAnimationFrame,
    pending = new Map();
  let next = 0,
    engine,sample,spriteUvs=[],spatialUvs=[],maxDraws=0;
  const trimMode=bundle.revisions.some(rev=>rev.sourcePng);
  const visual=scene.sceneComposition.fragments.main.instances.find(item=>item.id===instance).props.components.visual;
  globalThis.requestAnimationFrame = (callback) => {
    pending.set(++next, callback);
    return next;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  try {
    await loader.loadAssets({
      textures: Object.fromEntries(Object.entries(textures).reverse()),
      textureOptions: bundle.manifest.textureOptions,
    });
    engine = await createEngine(
      (frame) => {
        renderer.render();
        renderer.renderCommands(frame.renderCommandBuffer);
        renderer.renderPostProcess();
        sample={state:frame.gameState,entities:frame.entityCount,draws:renderer.stats().drawCalls,switches:renderer.stats().textureSwitchCount};
        if(trimMode&&engine){
          const texture=engine.textureId(visual.texture??visual.asset);
          spriteUvs=decodeRenderCommands(frame.renderCommandBuffer).filter(c=>c.textureId===texture).map(c=>c.uv);
          spatialUvs=[];const spatial=frame.renderCommandBuffer.spatial;
          if(spatial)for(let i=0;i<spatial.billboardVertexCount;i++){const j=i*spatial.vertexStride;if(spatial.billboards[j+9]===texture)spatialUvs.push([spatial.billboards[j+3],spatial.billboards[j+4]]);}
        }
      },
      () => ({}),
      loader,
      () => renderer.viewportSize(),
      { fixedTimestep: false },
    );
    const size = renderer.viewportSize();
    engine.setViewportSize(size.width, size.height);
    const handles = applyDataSceneAuthoringDocument(
      engine,
      scene,
    ).entityHandles;
    engine.pauseDataScene();
    if (!scene.spatial) {
      const pose = scene.sceneComposition.fragments.main.instances.find(
        (i) => i.id === instance,
      );
      engine.setDataSceneCamera({ x: pose.x, y: pose.y - 32 });
    }
    engine.start();
    for (let i = 0; i < 2; i++) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
    }
    let playback;
    if (animation) {
      const handle = handles[instance],
        visited = new Set(),
        visible = new Set(),
        visual = scene.sceneComposition.fragments.main.instances.find(
          (item) => item.id === instance,
        ).props.components.visual,
        clip = visual.animationSet.clips.find(
          (item) => item.id === visual.animationSet.initialClip,
        );
      check(engine.resumeDataScene(), "Resume animation failed");
      const duration = (clip.frames.length * 1000) / clip.fps;
      for (let elapsed = 10; elapsed <= duration + 50; elapsed += 10) {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(elapsed);
        const state = engine.dataSceneSpriteAnimationState(handle),
          phase = (elapsed / 1000) * Math.fround(clip.fps),
          expected = Math.min(Math.floor(phase + 1e-5), clip.frames.length - 1);
        check(state.clip === clip.id, "Initial native clip ID changed");
        if (Math.abs(phase - Math.round(phase)) > 1e-4)
          check(
            state.frame === expected,
            `Native duration mismatch at ${elapsed}ms: ${state.frame}/${expected}`,
          );
        visited.add(state.frame);
        if(trimMode){
          check(sample.state===1&&sample.entities===1&&sample.draws>=1&&sample.draws<=16&&sample.switches<=16,"Trim runtime state or draw budget differs");
          maxDraws=Math.max(maxDraws,sample.draws);
          const f=clip.frames[state.frame],expected=[f.u0??0,f.v0??0,f.u1??1,f.v1??1];
          const actual=scene.spatial?(spatialUvs.length?[[Math.min(...spatialUvs.map(v=>v[0])),Math.min(...spatialUvs.map(v=>v[1])),Math.max(...spatialUvs.map(v=>v[0])),Math.max(...spatialUvs.map(v=>v[1]))]]:[]):spriteUvs;
          check(actual.length>0&&actual.every(uv=>uv.every((v,i)=>Math.abs(v-expected[i])<1e-6)),"Trim native rendered UV differs");
        }
        const gl = canvas.getContext("webgl2"),
          pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        let red = 0,
          green = 0,
          blue = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const [r, g, b] = pixels.subarray(i, i + 3);
          if (r > g * 2 && r > b * 2) red++;
          if (g > r * 2 && g > b * 1.5) green++;
          if (b > r * 2 && b > g * 1.5) blue++;
        }
        if (red + green + blue > 100)
          visible.add(
            red > green && red > blue ? "red" : green > blue ? "green" : "blue",
          );
      }
      const state = engine.dataSceneSpriteAnimationState(handle);
      check(
        state.finished && state.frame === clip.frames.length - 1,
        "Non-looping native clip did not finish",
      );
      playback = {
        finished: state.finished,
        clip: state.clip,
        visitedFrames: visited.size,
        visibleFrames: visible.size,
        sourceCycleMs: duration,
      };
    }
    const gl = canvas.getContext("webgl2"),
      bytes = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    check(gl.getError() === 0, "Resume GL failed");
    let coloredPixels = 0;
    for (let i = 0; i < bytes.length; i += 4)
      if (bytes[i] > bytes[i + 1] * 2 && bytes[i + 2] > bytes[i + 1] * 2)
        coloredPixels++;
    return {
      freshSession: true,
      hashes: true,
      frameIdentity: true,
      colorSpace: "srgb",
      coloredPixels,
      ...(playback ? { animation: playback } : {}),
      ...(trimMode?{trimRuntime:{playingState:sample.state,renderedUVs:true,maxDraws,visibleFrames:playback?.visibleFrames,sourceSidecarHash:true}}:{}),
    };
  } finally {
    engine?.destroy();
    renderer.destroy();
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancel;
  }
}
