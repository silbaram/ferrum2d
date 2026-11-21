import { readFile } from "node:fs/promises";

export async function probeNativeTerrainResourceAcceptance(page, wasmUrl) {
  const assets = new URL("../../examples/topdown-shooter/public/assets/", import.meta.url);
  const [png, wav] = await Promise.all(["player.png", "hit.wav"].map(async name =>
    (await readFile(new URL(name, assets))).toString("base64")
  ));

  return page.evaluate(async ({ wasmUrl, png, wav }) => {
    const {
      BrowserPlatformHost, WebGL2Renderer, createEngine, createNativeGameFileSession,
      createUnifiedPhysicsQueryBatch, decodeRenderCommands,
      UNIFIED_PHYSICS_QUERY_LAYOUT: query, UNIFIED_PHYSICS_STATE_LAYOUT: body,
    } = await import("@ferrum2d/ferrum-web/core");
    const { createDataSceneRuntimeTarget } = await import("@ferrum2d/ferrum-web/authoring");
    const dt = Math.fround(0.01);
    const extent = 64;
    const targetId = 17;
    function check(condition, message) {
      if (!condition) throw new Error(message);
    }
    function equal(actual, expected, field) {
      check(JSON.stringify(actual) === JSON.stringify(expected), field + " differs");
    }
    function assetUrl(base64, type) {
      return URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), s => s.charCodeAt(0))], { type }));
    }
    function platform() {
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "width:64px;height:64px;display:block";
      document.body.append(canvas);
      const renderer = new WebGL2Renderer(canvas, { preserveDrawingBuffer: true, clearColor: [0, 0, 0, 1] });
      const host = new BrowserPlatformHost(renderer);
      const gl = canvas.getContext("webgl2");
      const scope = {
        host, renderer, calls: 0,
        onFrame(frame) {
          const packet = frame.renderCommandBuffer;
          const markers = decodeRenderCommands(packet).filter(r => r.textureId === host.textureId("player"));
          check(markers.length === 1, "expected one textured physics actor");
          scope.marker = [markers[0].x, markers[0].y];
          renderer.render();
          renderer.renderCommands(packet);
          renderer.renderPostProcess();
          if (scope.captureTarget) renderer.renderToTexture(scope.captureTarget, packet, { clearColor: [0, 0, 0] });
        },
        pixels() {
          const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          check(gl.getError() === gl.NO_ERROR, "WebGL readback failed");
          return pixels;
        },
        dispose() {
          scope.calls++;
          host.destroy();
          renderer.destroy();
          canvas.remove();
          const stats = renderer.resourceStats();
          check(["textureCount", "renderTargetCount", "programCount", "bufferCount"].every(k => stats[k] === 0),
            "platform retained GPU resources");
        },
      };
      return scope;
    }
    // One zero-delta render frame exposes the Native command buffer without advancing physics.
    function renderFrame(engine, scope) {
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
      const pending = new Map();
      let id = 0;
      window.requestAnimationFrame = cb => { pending.set(++id, cb); return id; };
      window.cancelAnimationFrame = handle => pending.delete(handle);
      try {
        scope.marker = undefined;
        engine.start();
        for (let i = 0; i < 2; i++) {
          check(pending.size === 1, "expected one render callback");
          const [handle, cb] = pending.entries().next().value;
          pending.delete(handle);
          cb(0);
        }
        check(scope.marker, "render callback did not receive physics actor");
        return scope.pixels();
      } finally {
        engine.stop();
        window.requestAnimationFrame = request;
        window.cancelAnimationFrame = cancel;
      }
    }
    function targetPixels(scope) {
      const { renderer } = scope;
      renderer.render();
      renderer.renderCommands({ commandCount: 1, floatsPerCommand: 15,
        buffer: new Float32Array([0, 0, extent, extent, 0, 0, 1, 1, 1, 1, 1, 1, targetId, 0, 0]) });
      renderer.renderPostProcess();
      return scope.pixels();
    }
    async function pixelHash(data) {
      return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
        b => b.toString(16).padStart(2, "0")).join("");
    }
    // The fixture PNG contains blue and off-white texels. Count its blue body
    // to distinguish the loaded image from an untextured white sprite.
    function bluePlayerPixels(data) {
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = data.subarray(i, i + 3);
        if (b > 170 && b > r + 40 && g > r + 25) n++;
      }
      return n;
    }
    function resourceState(scope) {
      const { host, renderer } = scope;
      const sound = host.soundId("hit");
      return { sprite: host.textureId("player"), sound, decodedSound: host.hasSound(sound),
        hits: host.getJsonAsset("game").hits, targets: renderer.resourceStats().renderTargetCount };
    }

    const results = [];
    for (const side of [8, 32, 64]) {
      const source = platform();
      let restoredScope, engine, session;
      const urls = [assetUrl(png, "image/png"), assetUrl(wav, "audio/wav"),
        URL.createObjectURL(new Blob([JSON.stringify({ hits: 0 })], { type: "application/json" }))];
      try {
        engine = await createEngine(source.onFrame, undefined, source.host);
        await engine.loadAssets({ textures: { player: urls[0] }, sounds: { hit: urls[1] }, json: { game: urls[2] } });
        const actor = createDataSceneRuntimeTarget(engine).spawnSceneInstance({
          id: "actor", sourceId: "actor", prefab: "actor", x: 19.25, y: 20.75, rotationRadians: 0, scale: 1, layer: 0,
          props: { components: { sprite: { texture: "player", width: 12, height: 12 }, collider: "none", layer: "player" } },
        });
        engine.setViewportSize(extent, extent);
        engine.setDataSceneCamera({ x: 20, y: 20 });
        engine.configureUnifiedPhysics({ space: "planar-xy", gravity: [0, 0, 0], lengthUnit: 1, stepSeconds: dt });
        engine.configureAutoRigidBodyStep(false);
        check(engine.configureDataSceneCollisionTilemap({ columns: side, rows: side, tileWidth: 1, tileHeight: 1,
          originX: 20, originY: 20, tiles: new Uint32Array(side * side).fill(1), definitions: [{ id: 1, height: 1 }] }),
        "could not install collision terrain");
        engine.bindUnifiedPhysicsBody(actor, { kind: "dynamic", canSleep: false, ccd: true,
          pose: { position: [19.25, 20.75, 0] }, linearVelocity: [2, 1, 0],
          collider: { shape: { type: "sphere", radius: 0.2 }, friction: 0 } });
        const handles = new Uint32Array([actor.entityId, actor.entityGeneration]);
        const state = target => {
          const s = target.queryUnifiedPhysicsBodyStates(handles);
          check(s.count === 1, "missing body");
          return { floats: Array.from(s.floats), words: Array.from(s.words) };
        };
        const rays = createUnifiedPhysicsQueryBatch([{ type: "ray", origin: [19, 20.5, 0], direction: [1, 0, 0],
          maxDistance: side + 2, limit: side, filter: { terrain: "all" } }]);
        const tiles = target => {
          const v = target.queryUnifiedPhysics(rays);
          check(v.hitCount === side && v.summaries[query.summaryFlags] === 0, "unexpected terrain ray count");
          return Array.from({ length: v.hitCount }, (_, i) => {
            const at = i * query.hitStride;
            check(v.words[at + query.terrainKind] === query.tileTerrain &&
              v.words[at + query.terrainTileIndex] === i, "unexpected tile identity");
            return v.words[at + query.terrainTileIndex];
          });
        };
        // Read a ray before and after the actor reaches the wall; the actor never crosses its surface.
        const initialTiles = tiles(engine);
        const start = state(engine).floats[body.position];
        for (let i = 0; i < 60; i++) engine.stepRigidBodies(dt);
        const saved = state(engine);
        const x = saved.floats[body.position], y = saved.floats[body.position + 1];
        check(x > start + 0.4 && x < 19.83 && y > 21.1 && y < 21.5, "body did not reach and slide along terrain");
        source.host.getJsonAsset("game").hits = initialTiles.length;
        source.captureTarget = source.renderer.createRenderTexture(targetId, { width: extent, height: extent });
        const image = renderFrame(engine, source);
        source.captureTarget = undefined;
        const targetImage = targetPixels(source);
        const blue = bluePlayerPixels(image);
        check(blue > 8 && bluePlayerPixels(targetImage) > 8, "player PNG missing from frame or capture target");
        const originalImageHash = await pixelHash(image), savedTargetHash = await pixelHash(targetImage);
        const resources = resourceState(source);
        check(resources.decodedSound && resources.hits === side && resources.targets >= 1, "source resource data missing");
        session = await createNativeGameFileSession(engine, {
          wasm: new URL(wasmUrl),
          preparePlatform() {
            restoredScope = platform();
            return { assetHost: restoredScope.host, callbacks: { "frame.onFrame": restoredScope.onFrame },
              dispose: () => restoredScope.dispose() };
          },
        });
        const bytes = await session.capture();
        for (const url of urls) URL.revokeObjectURL(url);
        const ready = await session.prepare(bytes);
        const commit = await session.commit(ready);
        const restored = session.current();
        check(restored !== engine && commit.epoch === 1 && commit.cleanupErrors.length === 0, "file commit failed");
        equal(state(restored), saved, "restored native body");
        equal(tiles(restored), initialTiles, "restored tile row");
        equal(resourceState(restoredScope), resources, "restored JSON, audio and texture identity");
        const restoredImage = renderFrame(restored, restoredScope);
        equal(restoredScope.marker, source.marker, "rendered body position");
        const savedSpriteY = restoredScope.marker[1];
        check(await pixelHash(restoredImage) === originalImageHash, "restored actor framebuffer changed");
        check(await pixelHash(targetPixels(restoredScope)) === savedTargetHash, "restored render target pixels changed");
        for (let tick = 1; tick <= 6; tick++) {
          engine.stepRigidBodies(dt);
          restored.stepRigidBodies(dt);
          equal(state(restored), state(engine), "body at replay step " + tick);
        }
        check(state(restored).floats[body.position + 1] > y + 0.03, "restored actor stopped along terrain");
        const replayImage = renderFrame(restored, restoredScope);
        equal(await pixelHash(replayImage), await pixelHash(renderFrame(engine, source)), "replayed frame pixels");
        check(restoredScope.marker[1] > savedSpriteY, "rendered actor did not follow the sliding body");
        await session.dispose();
        check(restoredScope.calls === 1 && source.calls === 0, "unexpected platform ownership after disposal");
        results.push({ cells: side * side, tileIds: initialTiles, xAtContact: x, yAtCapture: y, fileBytes: bytes.length,
          resources, bluePlayerPixels: blue, actorImageSha256: originalImageHash, capturedTargetSha256: savedTargetHash,
          replaySteps: 6, sourceUrlsRevoked: urls.length });
      } finally {
        for (const url of urls) URL.revokeObjectURL(url);
        await session?.dispose();
        engine?.destroy();
        source.dispose();
      }
    }
    return results;
  }, { wasmUrl, png, wav });
}
