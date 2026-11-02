import { createRenderer, createFerrumRuntime, createDataSceneView, AssetLoader, pixelPerfectPointToViewport } from '@ferrum2d/ferrum-web/core';
const check = (value, label) => { if (!value)
    throw Error(label); };
const config = { width: 32, height: 24, background: [.03, .06, .09] };
function image(normal = false) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const data = new Uint8ClampedArray(64);
    for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++)
            data.set(normal ? [128, 128, 255, 255] : [(x & 1) ? 240 : 30, (y & 1) ? 220 : 20, (x + y) & 1 ? 60 : 200, 255], (y * 4 + x) * 4);
    canvas.getContext('2d').putImageData(new ImageData(data, 4, 4), 0, 0);
    return canvas.toDataURL();
}
function commands(mapped = false) {
    return { commandCount: 2, floatsPerCommand: 15, groundYScale: 1,
        buffer: new Float32Array([16, 12, 32, 24, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 8, 7, 4.5, 3.5, 0, 0, 1, 1, .8, .7, .2, .8, 1, 0, .3]),
        ...(mapped ? { spriteNormalMaterials: { version: 1, stride: 2, buffer: new Uint32Array([2, 0, 16777215, 0]) } } : {}) };
}
async function pixels(renderer, canvas) {
    const gpu = typeof renderer.gpuDevice === 'function';
    if (!gpu) {
        const gl = canvas.getContext('webgl2'), raw = new Uint8Array(canvas.width * canvas.height * 4), out = new Uint8Array(raw.length);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        check(gl.getError() === 0, 'GL error');
        for (let y = 0; y < canvas.height; y++)
            out.set(raw.subarray((canvas.height - 1 - y) * canvas.width * 4, (canvas.height - y) * canvas.width * 4), y * canvas.width * 4);
        return out;
    }
    const device = renderer.gpuDevice(), texture = canvas.getContext('webgpu').getCurrentTexture(), stride = Math.ceil(canvas.width * 4 / 256) * 256;
    const buffer = device.createBuffer({ size: stride * canvas.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 });
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const raw = new Uint8Array(buffer.getMappedRange()), out = new Uint8Array(canvas.width * canvas.height * 4);
        for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++) {
                const a = y * stride + x * 4, b = (y * canvas.width + x) * 4;
                out.set(raw.subarray(a, a + 4), b);
                if (texture.format.startsWith('bgra'))
                    [out[b], out[b + 2]] = [out[b + 2], out[b]];
            }
        buffer.unmap();
        return out;
    }
    finally {
        buffer.destroy();
    }
}
function verifyBlocks(data, p) {
    check(p.integerScale && Number.isInteger(p.scale), 'integer presentation');
    const s = p.scale;
    for (let sy = 0; sy < p.sourceHeight; sy++)
        for (let sx = 0; sx < p.sourceWidth; sx++) {
            const first = ((p.y + sy * s) * p.canvasWidth + p.x + sx * s) * 4;
            for (let y = 0; y < s; y++)
                for (let x = 0; x < s; x++) {
                    const i = ((p.y + sy * s + y) * p.canvasWidth + p.x + sx * s + x) * 4;
                    for (let c = 0; c < 4; c++)
                        check(data[i + c] === data[first + c], `nonuniform block ${sx},${sy} at ${x},${y} channel ${c}`);
                }
        }
    const background = config.background.map(x => Math.round(x * 255));
    if (p.x || p.y)
        for (let c = 0; c < 3; c++)
            check(Math.abs(data[c] - background[c]) <= 1, 'letterbox color');
    const center = ((p.y + Math.floor(p.height / 2)) * p.canvasWidth + p.x + Math.floor(p.width / 2)) * 4;
    check(data[center] + data[center + 1] + data[center + 2] > 60, 'actual colored scene');
}
export async function probeFlatPixels(preferred, colorManagement = 'legacy') {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:713px;height:471px';
    canvas.dataset.spatialGpuTarget = 'true';
    document.body.append(canvas);
    const renderer = await createRenderer(canvas, { preferred, colorManagement, pixelPerfect: config, webgl2: { preserveDrawingBuffer: true }, fallbackBehavior: 'silent' });
    const backend = typeof renderer.gpuDevice === 'function' ? 'webgpu' : 'webgl2';
    check(backend === (colorManagement === 'linear-srgb' ? 'webgl2' : preferred), 'backend selection');
    const device = backend === 'webgpu' ? renderer.gpuDevice() : undefined, errors = [];
    device?.addEventListener('uncapturederror', event => errors.push(event.error.message));
    let final;
    try {
        await renderer.loadTexture(1, image());
        await renderer.loadTexture(2, image(true), { colorSpace: 'none' });
        const states = [];
        async function draw(mapped = false, post = undefined) {
            renderer.setLighting(mapped ? { enabled: true, ambient: [.3, .3, .3, 1], pointLights: [{ x: 16, y: 12, radius: 40, height: 20, color: [1, 1, 1, 1], intensity: .8, falloff: 1 }] } : false);
            renderer.setPostProcess(post);
            renderer.render();
            let blocked=false;try{renderer.setPixelPerfect(config);}catch(error){blocked=/between frames/.test(String(error));}check(blocked,"mid-frame display change must reject before touching targets");
            renderer.renderCommands(commands(mapped));
            const stats = renderer.renderPostProcess();
            await device?.queue.onSubmittedWorkDone();
            check(!errors.length, errors.join('\n'));
            const p = renderer.pixelPerfectPresentation(), data = await pixels(renderer, canvas);
            verifyBlocks(data, p);
            check(stats.presentationPassCount === 1 && stats.drawCalls <= 20 && stats.spriteCount === 2, 'presentation stats/scale');
            states.push({ mapped, post: !!post, layout: p, resources: renderer.resourceStats(), stats });
            return data;
        }
        const base = await draw(), baseline = renderer.pixelPerfectPresentation(), reference = new Uint8Array(32 * 24 * 4);
        for (let y = 0; y < 24; y++)
            for (let x = 0; x < 32; x++) {
                const i = ((baseline.y + y * baseline.scale) * baseline.canvasWidth + baseline.x + x * baseline.scale) * 4;
                reference.set(base.subarray(i, i + 4), (y * 32 + x) * 4);
            }
        await draw(true);
        await draw(true, [{ kind: 'fade', color: [1, 0, 0, .25] }]);
        if (backend === 'webgl2') {
            await draw(true, [{ kind: 'fade', color: [1, 0, 0, .1] }, { kind: 'fade', color: [0, 0, 1, .1] }]);
            renderer.setLighting(false);
            renderer.setPostProcess(undefined);
            renderer.render();
            const target = renderer.createRenderTexture(50, { width: 8, height: 8, filter: 'nearest' }), before = JSON.stringify(renderer.pixelPerfectPresentation());
            renderer.renderToTexture(target, commands(), { viewport: { width: 32, height: 24 } });
            renderer.renderCommands(commands());
            renderer.renderPostProcess();
            verifyBlocks(await pixels(renderer, canvas), renderer.pixelPerfectPresentation());
            check(JSON.stringify(renderer.pixelPerfectPresentation()) === before, 'capture isolation');
            renderer.destroyRenderTexture(target);
        }
        const fixedBytes = (await draw()).length; // Readback is the physical image, not the virtual allocation.
        const memory = renderer.resourceStats().textureBytes;
        canvas.style.width = '333px';
        canvas.style.height = '255px';
        renderer.resize();
        await draw();
        check(renderer.resourceStats().textureBytes === memory, 'virtual targets must not scale with CSS/DPR');
        const prior = JSON.stringify(renderer.pixelPerfectPresentation());
        try {
            renderer.setPixelPerfect({ width: 0, height: 1 });
            throw Error('invalid size accepted');
        }
        catch (error) {
            check(!String(error).includes('accepted'), 'validation');
        }
        check(prior === JSON.stringify(renderer.pixelPerfectPresentation()), 'invalid options changed presentation');
        canvas.style.width = '11px';
        canvas.style.height = '9px';
        renderer.resize();
        check(!renderer.pixelPerfectPresentation().integerScale, 'small viewport fallback');
        renderer.render();
        renderer.renderCommands(commands());
        renderer.renderPostProcess();
        await pixels(renderer, canvas);
        renderer.setPixelPerfect(false);
        check(!renderer.pixelPerfectPresentation(), 'disabled layout');
        check(renderer.viewportSize().width === 11, 'legacy CSS viewport restored');
        let recovery = false;
        if (backend === 'webgpu') {
            canvas.style.width = '333px';
            canvas.style.height = '255px';
            renderer.setPixelPerfect(config);
            device.destroy();
            await device.lost;
            await Promise.resolve();
            check(renderer.deviceState().status === 'lost', 'device loss not observed');
            await renderer.recoverDevice();
            check(renderer.pixelPerfectPresentation().sourceWidth === 32, 'recovery lost virtual settings');
            renderer.setLighting(false);
            renderer.setPostProcess(undefined);
            renderer.render();
            renderer.renderCommands(commands());
            renderer.renderPostProcess();
            await renderer.gpuDevice().queue.onSubmittedWorkDone();
            verifyBlocks(await pixels(renderer, canvas), renderer.pixelPerfectPresentation());
            renderer.setPixelPerfect(false);
            recovery = true;
        }
        final = { preferred, backend, colorManagement, states, recovery, physicalReadbackBytes: fixedBytes, initialColoredBytes: base.length, reference: btoa(String.fromCharCode(...reference)), errors };
    }
    finally {
        renderer.destroy();
        const remaining = renderer.resourceStats();
        check(remaining.textureCount === 0 && remaining.bufferCount === 0 && remaining.programCount === 0, 'renderer resources leaked');
        window.disposeSpatialGpuTarget?.(canvas);
        canvas.remove();
    }
    return final;
}
export async function probeFlatPixelRuntime(preferred) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:713px;height:471px';
    canvas.dataset.spatialGpuTarget = 'true';
    document.body.append(canvas);
    const scene = { format: 'ferrum2d.consumer.scene-authoring', version: 1, display: { pixelPerfect: config }, behaviorRecipes: { entities: {} }, sceneComposition: { initialFragment: 'main', prefabs: { object: {} }, fragments: { main: { instances: [{ id: 'hero', prefab: 'object', x: 800, y: 480, props: { components: { visual: { kind: 'sprite', texture: 'hero', width: 4, height: 4 }, collider: 'none', layer: 'wall' } } }] } } } };
    let last, observedInput;
    const renderer = await createRenderer(canvas, { preferred, webgl2: { preserveDrawingBuffer: true } }), loader = new AssetLoader(renderer);
    await loader.loadAssets({ textures: { hero: image() } });
    const runtime = await createFerrumRuntime({ canvas, renderer, assetHost: loader, dataScene: scene, autostart: false, onFrame: frame => { last = frame; }, inputTransform: snapshot => { observedInput = snapshot; return snapshot; } });
    const raf = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame, pending = new Map();
    let frameId = 0, timestamp = 0;
    globalThis.requestAnimationFrame = callback => { pending.set(++frameId, callback); return frameId; };
    globalThis.cancelAnimationFrame = id => pending.delete(id);
    const pump = () => { timestamp += 16; const callbacks = [...pending.values()]; pending.clear(); check(callbacks.length, "missing real GameLoop frame"); for (const callback of callbacks)
        callback(timestamp); };
    try {
        runtime.start();
        pump();
        pump();
        check(last.frame.gameState === 1 && last.frame.entityCount === 1, 'actual Playing Data Scene');
        check(runtime.renderer.viewportSize().width === 32 && last.rendererStats.presentationPassCount === 1, 'authored display not applied');
        const visibleLayout=runtime.renderer.pixelPerfectPresentation(),visiblePixels=await pixels(runtime.renderer,canvas),centerIndex=((visibleLayout.y+Math.floor(visibleLayout.height/2))*visibleLayout.canvasWidth+visibleLayout.x+Math.floor(visibleLayout.width/2))*4;
        check(visiblePixels[centerIndex+2]>100,'Playing Data Scene must actually show its sprite');
        const view = createDataSceneView(runtime.engine, runtime.renderer, canvas), p = runtime.renderer.pixelPerfectPresentation(), rect = canvas.getBoundingClientRect();
        const center = { x: (p.x + p.width / 2) * rect.width / p.canvasWidth, y: (p.y + p.height / 2) * rect.height / p.canvasHeight };
        canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + center.x, clientY: rect.top + center.y, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + center.x, clientY: rect.top + center.y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true }));
        pump();
        check(observedInput.mouseLeft && Math.abs(last.frame.mouseX - 16) < .1 && Math.abs(last.frame.mouseY - 12) < .1, 'runtime pointer center ' + JSON.stringify({ dpr: devicePixelRatio, input: observedInput, mouse: [last.frame.mouseX, last.frame.mouseY], p, rect: [rect.width, rect.height] }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true }));
        if (p.x || p.y) {
            canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + 1, clientY: rect.top + 1, bubbles: true }));
            canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + 1, clientY: rect.top + 1, button: 0, buttons: 1, pointerId: 2, pointerType: 'mouse', isPrimary: true, bubbles: true }));
            check(runtime.input.snapshot().mouseLeft, 'outside test must contain a held pointer');
            pump();
            check(!observedInput.mouseLeft, 'letterbox pointer reached simulation');
            canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerId: 2, pointerType: 'mouse', isPrimary: true, bubbles: true }));
        }
        const eventMapped = pixelPerfectPointToViewport(p, center.x, center.y, rect.width, rect.height);
        check(Math.abs(eventMapped.x - 16) < 1e-8 && Math.abs(eventMapped.y - 12) < 1e-8, 'exact fractional center transform');
        const world = view.pointerToWorld({ x: rect.left + center.x, y: rect.top + center.y });
        check(Math.abs(world.x - runtime.engine.cameraX()) < .01, 'view/runtime pointer mismatch');
        view.setZoom(2);view.setGroundYScale(.5);view.setCamera({x:796,y:474});pump();
        const actorScreen=view.worldToScreen({x:800,y:480}),actorPixels=await pixels(runtime.renderer,canvas),px=Math.floor(actorScreen.x*canvas.width/canvas.clientWidth),py=Math.floor(actorScreen.y*canvas.height/canvas.clientHeight),at=(py*canvas.width+px)*4;
        check(Math.max(actorPixels[at],actorPixels[at+1],actorPixels[at+2])>100,'native sprite and view disagree under zoom/ground projection');
        const client={x:rect.left+actorScreen.x*rect.width/canvas.clientWidth,y:rect.top+actorScreen.y*rect.height/canvas.clientHeight};
        canvas.dispatchEvent(new PointerEvent('pointerdown',{clientX:client.x,clientY:client.y,button:0,buttons:1,pointerId:3,pointerType:'mouse',isPrimary:true,bubbles:true}));pump();
        check(observedInput.mouseLeft&&Math.abs(observedInput.mouseX-12)<.1&&Math.abs(observedInput.mouseY-9)<.1,'zoomed runtime input coordinates');
        canvas.dispatchEvent(new PointerEvent('pointerup',{button:0,pointerId:3,pointerType:'mouse',isPrimary:true,bubbles:true}));
        view.setZoom(1);view.setGroundYScale(1);view.setCamera({x:800,y:480});
        const invalid = structuredClone(scene);
        invalid.display.pixelPerfect.width = 0;
        try {
            runtime.dataScene.reapply(invalid);
            throw Error('invalid transition accepted');
        }
        catch (error) {
            check(!String(error).includes('accepted'), 'transition validation');
        }
        check(runtime.renderer.pixelPerfectPresentation().sourceWidth === 32, 'invalid transition changed display');
        const plain = structuredClone(scene);
        plain.display.pixelPerfect = false;
        runtime.dataScene.reapply(plain);
        check(!runtime.renderer.pixelPerfectPresentation(), 'scene false did not restore legacy');
        pump();
        runtime.dataScene.reapply(scene);
        pump();
        check(runtime.renderer.pixelPerfectPresentation().sourceWidth === 32, 'reapply pixel display');
        return { preferred, state: last.frame.gameState, entities: last.frame.entityCount, presentation: last.rendererStats.presentationPassCount, pointer: true, letterbox: true, zoomAndGround: true, transition: true, resources: runtime.renderer.resourceStats() };
    }
    finally {
        runtime.destroy();
        renderer.destroy();
        globalThis.requestAnimationFrame = raf;
        globalThis.cancelAnimationFrame = cancel;
        window.disposeSpatialGpuTarget?.(canvas);
        canvas.remove();
    }
}

export {pixels};
