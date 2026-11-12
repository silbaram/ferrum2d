import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { preparePlacementTestBuild } from './placement-test-build.mjs';
import { showPlacementMenu } from './placement-panel-navigation.mjs';
const base = await preparePlacementTestBuild(resolve('apps/studio/dist'));
const scene = JSON.parse(await readFile(resolve(base, 'placement.scene-authoring.json'), 'utf8'));
scene.display = { pixelPerfect: { width: 320, height: 180, snap: true, background: [.03, .06, .09] } };
const server = createServer(async (req, res) => { try {
    const url = new URL(req.url, 'http://localhost'), file = resolve(base, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    assert(file.startsWith(base + sep));
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2' })[extname(file)] ?? 'application/octet-stream');
    res.end(url.pathname === '/placement.scene-authoring.json' ? JSON.stringify(scene) : await readFile(file));
}
catch {
    res.writeHead(404).end();
} });
const out = resolve('artifacts/flat-pixel-perfect/viewer');
await mkdir(out, { recursive: true });
let browser;
const results = [];
const evidence = page => page.evaluate(() => JSON.stringify({ document: window.ferrumPlacementSpatialExportDocument(), patch: window.ferrumPlacementViewerExportPatch(), history: window.ferrumPlacementViewerHistory }));
const camera = page => page.evaluate(() => ({ x: window.ferrumEngine.cameraX(), y: window.ferrumEngine.cameraY(), viewport: window.ferrumRuntime.renderer.viewportSize() }));
try {
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    browser = await chromium.launch({ headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    for (const dpr of [1, 1.5, 2]) {
        const page = await browser.newPage({ viewport: { width: 1373, height: 943 }, deviceScaleFactor: dpr }), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' });
            await page.waitForFunction(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 6);
            await page.locator('[data-placement-language]').selectOption('en');
            assert.equal(await page.evaluate(() => window.ferrumRuntime.renderer.pixelPerfectPresentation()), undefined);
            const canvas = page.locator('canvas.demo-canvas'), box = await canvas.boundingBox();
            await page.mouse.move(box.x + box.width * .65, box.y + box.height * .65);
            await page.keyboard.down('Space');
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * .65 + 48, box.y + box.height * .65 + 24, { steps: 4 });
            await page.mouse.up();
            await page.keyboard.up('Space');
            await page.mouse.wheel(0, -120);
            await page.waitForTimeout(150);
            const before = await evidence(page), editCamera = await camera(page);
            for (let cycle = 0; cycle < 2; cycle++) {
                await page.getByRole('button', { name: 'Game Preview', exact: true }).click();
                await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === 'game' && window.ferrumRuntime.renderer.stats().presentationPassCount === 1);
                const game = await page.evaluate(() => ({ p: window.ferrumRuntime.renderer.pixelPerfectPresentation(), camera: { x: window.ferrumEngine.cameraX(), y: window.ferrumEngine.cameraY() }, frame: window.ferrumPlacementViewerRuntimeFrame, state: window.ferrumEngine.dataSceneState(), view: window.ferrumRuntime.renderer.viewportSize() }));
                assert.equal(game.p.settings.snap, true, 'authored snap must reach Game Preview');
                const visible=await page.evaluate(()=>{const canvas=document.querySelector('canvas.demo-canvas'),gl=canvas.getContext('webgl2'),data=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);if(gl.getError())throw Error('readback failed');let colored=0;for(let i=0;i<data.length;i+=4)if(data[i]>70||data[i+1]>70||data[i+2]>70)colored++;return colored;});
                assert(visible>1000,'preview must actually show textured objects');
                assert.equal(game.view.width, 320);
                assert.equal(game.view.height, 180);
                assert(game.p.integerScale);
                assert.equal(game.p.width, 320 * game.p.scale);
                assert.equal(game.state, "playing");
                assert(game.frame.drawCalls > 0 && game.frame.drawCalls <= 32);
                if (cycle === 0) {
                    await page.screenshot({ path: resolve(out, `dpr-${dpr}.png`) });
                    await page.setViewportSize({ width: 1197, height: 813 });
                    await page.waitForFunction(old => window.ferrumRuntime.renderer.pixelPerfectPresentation().canvasWidth !== old, game.p.canvasWidth);
                }
                await page.getByRole('button', { name: '2D', exact: true }).click();
                await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === '2d' && !window.ferrumRuntime.renderer.pixelPerfectPresentation());
                assert.equal(await evidence(page), before, 'preview must preserve source, patch and history');
                const restored = await camera(page);
                const selectionViewport=await page.evaluate(()=>({actual:window.ferrumPlacementViewerState.viewport,expected:window.ferrumRuntime.renderer.viewportSize(),camera:[window.ferrumEngine.cameraX(),window.ferrumEngine.cameraY()]}));
                assert(Math.abs(selectionViewport.actual.worldWidth-selectionViewport.expected.width)<.001&&Math.abs(selectionViewport.actual.cameraX-selectionViewport.camera[0])<.001,'selection viewport must match the restored editor camera: '+JSON.stringify(selectionViewport));

                assert(Math.abs(restored.x - editCamera.x) < .001 && Math.abs(restored.y - editCamera.y) < .001, 'edit camera position restoration');
                // Resize changes CSS dimensions; derive the preserved zoom from each current viewport.
                const zoom = await page.evaluate(() => document.querySelector('canvas.demo-canvas').clientWidth / window.ferrumRuntime.renderer.viewportSize().width);
                assert(Math.abs(zoom - box.width / editCamera.viewport.width) < .02, 'edit zoom restoration');
                assert.equal(selectionViewport.actual.presentation,undefined,'editor selection must leave the letterbox coordinate space');
                const point=await page.evaluate(()=>{const canvas=document.querySelector('canvas.demo-canvas'),rect=canvas.getBoundingClientRect(),size=window.ferrumRuntime.renderer.viewportSize(),pose=window.ferrumPlacementViewerState.instances.find(item=>item.instanceId==='crate_left').transform;return{x:rect.left+(pose.x-window.ferrumEngine.cameraX()+size.width/2)*rect.width/size.width,y:rect.top+(pose.y-window.ferrumEngine.cameraY()+size.height/2)*rect.height/size.height};});
                await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>window.ferrumPlacementViewerState.selectedInstanceId==='crate_left');

            }
            await page.locator('[data-placement-playback=play]').click();
            await page.waitForFunction(()=>window.ferrumEngine.dataSceneState()==='playing'&&!!window.ferrumRuntime.renderer.pixelPerfectPresentation());
            await page.locator('[data-placement-playback=pause]').click();await page.waitForFunction(()=>window.ferrumEngine.dataSceneState()==='paused');
            assert.equal(await page.evaluate(()=>window.ferrumRuntime.renderer.pixelPerfectPresentation().sourceWidth),320);
            await page.locator('[data-placement-playback=pause]').click();await page.waitForFunction(()=>window.ferrumEngine.dataSceneState()==='playing');
            await page.locator('[data-placement-playback=stop]').click();await page.waitForFunction(()=>window.ferrumPlacementWorkspaceMode==='2d'&&!window.ferrumRuntime.renderer.pixelPerfectPresentation());
            assert.equal(await evidence(page),before);
            const originalTab=await page.evaluate(()=>window.ferrumPlacementWorkspaceActiveDocument);
            await page.getByRole('button', { name: 'Game Preview', exact: true }).click();
            await page.waitForFunction(() => window.ferrumRuntime.renderer.stats().presentationPassCount === 1);
            const other=structuredClone(scene);other.display.pixelPerfect={width:256,height:144};
            await showPlacementMenu(page,'file');await page.locator('[data-placement-document-file]').setInputFiles({name:'second-pixel.scene-authoring.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(other))});
            await page.waitForFunction(()=>window.ferrumPlacementWorkspaceMode==='2d'&&!window.ferrumRuntime.renderer.pixelPerfectPresentation());
            await page.getByRole('button',{name:'Game Preview',exact:true}).click();await page.waitForFunction(()=>window.ferrumRuntime.renderer.pixelPerfectPresentation()?.sourceWidth===256);
            const secondTab=await page.evaluate(()=>window.ferrumPlacementWorkspaceActiveDocument);
            await page.locator(`[data-placement-document-key=${JSON.stringify(originalTab)}]`).click();
            await page.waitForFunction(()=>window.ferrumPlacementWorkspaceMode==='game'&&window.ferrumRuntime.renderer.pixelPerfectPresentation()?.sourceWidth===320);
            await page.locator('[data-placement-playback=stop]').click();await page.waitForFunction(()=>window.ferrumPlacementWorkspaceMode==='2d'&&!window.ferrumRuntime.renderer.pixelPerfectPresentation());
            const afterTabs=await camera(page);assert(Math.abs(afterTabs.x-editCamera.x)<.001&&Math.abs(afterTabs.y-editCamera.y)<.001,'tab switches must retain the original edit camera');
            assert.equal(await evidence(page),before);
            await page.locator(`[data-placement-close-document=${JSON.stringify(secondTab)}]`).click();
            await page.waitForFunction(key=>!document.querySelector(`[data-placement-document-key=${JSON.stringify(key)}]`),secondTab);
            await page.getByRole('button',{name:'Game Preview',exact:true}).click();await page.waitForFunction(()=>window.ferrumRuntime.renderer.pixelPerfectPresentation()?.sourceWidth===320);

            await showPlacementMenu(page, 'file');
            await page.locator('[data-placement-document-file]').setInputFiles({ name: 'hd.scene-authoring.json', mimeType: 'application/json', buffer: await readFile(resolve(base, 'placement.hd2d.scene-authoring.json')) });
            await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === 'spatial' && window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws !== undefined && !window.ferrumRuntime.renderer.pixelPerfectPresentation());
            assert.deepEqual(errors, []);
            results.push({ dpr, integerScale: true, visibleObjects: true, playing: true, resize: true, sourceHistoryUnchanged: true, editCameraRestored: true, selectionViewportRestored: true, actualSelection:true, playback:true, documentTabs:true, spatialSwitch: true, pageErrors: errors });
        }
        catch (error) {
            await page.screenshot({ path: resolve(out, `failure-${dpr}.png`) });
            throw error;
        }
        finally {
            await page.close();
        }
    }
    await writeFile(resolve(out, 'verification.json'), JSON.stringify({ ok: true, results }, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, results }, null, 2));
}
finally {
    await browser?.close();
    await new Promise(done => server.close(done));
}
