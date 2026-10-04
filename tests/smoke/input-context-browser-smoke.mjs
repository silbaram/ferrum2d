#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { runReleaseCommand } from "./github-release-command.mjs";

// A consumer imports only /core from the actual tarball, never workspace source.
const root = resolve(".");
await mkdir(resolve(root, "artifacts"), { recursive: true });
const output = await mkdtemp(resolve(root, "artifacts/input-context-consumer-"));
await runReleaseCommand("pnpm", ["pack", "--pack-destination", output], { cwd: resolve(root, "packages/ferrum-web") });
const tarball = (await readdir(output)).find((name) => name.endsWith(".tgz"));
assert(tarball);
await runReleaseCommand("tar", ["-xzf", resolve(output, tarball), "-C", output]);
const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0}canvas{width:300px;height:200px}#field{position:absolute;top:220px}</style>
<script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/package/dist/core.js"}}</script></head>
<body><canvas id="game" tabindex="0"></canvas><dialog id="menu"><input id="modal" aria-label="Menu field"></dialog><input id="field" aria-label="Text field">
<script type="module">
import { InputManager, VirtualControls, resolveInputActionProfile } from '@ferrum2d/ferrum-web/core';
const virtual = new VirtualControls(document.body);
window.pad = { axes: [0, 0], buttons: [], connected: true, index: 0, id: 'simulated-standard-pad' };
window.padPolls = 0;
Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { window.padPolls++; return [window.pad]; } });
const input = new InputManager(document.querySelector('canvas'), {
  virtualControls: virtual,
  keyBindings: { w: ['KeyW', 'ArrowUp'] },
  actionProfile: resolveInputActionProfile(JSON.parse(JSON.stringify({
    actions: { up: [{control:'w'}], down: [{control:'s'}], interact: [{code:'KeyE'}, {virtualButton:'primary'}, {control:'space'}], sprint: [{code:'ShiftLeft'}, {code:'ShiftRight'}] },
    axes: { moveY: {negative:'up',positive:'down'} }
  })))
});
window.inputTest = { input, virtual };
document.querySelector('canvas').addEventListener('pointerdown', event => { window.canvasPointerId = event.pointerId; });
document.addEventListener('contextmenu', event => event.preventDefault());
</script></body></html>`;
const server = createServer((request, response) => { void (async () => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
  const file = resolve(output, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(resolve(output, "package") + sep) || !file.endsWith(".js")) { response.writeHead(403).end(); return; }
  response.setHeader("Content-Type", "application/javascript");
  response.end(await readFile(file));
})().catch(() => response.writeHead(404).end()); });
let browser;
const report = { format: "ferrum2d.input-context.consumer-smoke", version: 1, status: "running", tarball, cases: [] };
try {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = `http://127.0.0.1:${server.address().port}/`;
  const options = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) browser = await chromium.launch({ ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE });
  else { try { browser = await chromium.launch({ ...options, channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" }); }
    catch (error) { if (process.env.FERRUM_BROWSER_CHANNEL) throw error; browser = await chromium.launch(options); } }
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) for (const deviceScaleFactor of [1, 2]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(address);
    await page.waitForFunction(() => window.inputTest);
    const sample = () => page.evaluate(() => window.inputTest.input.actionSnapshot());
    await page.locator("canvas").focus();
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ArrowUp");
    await page.keyboard.up("KeyW");
    assert.equal((await sample()).axes.moveY, -1);
    await page.keyboard.up("ArrowUp");
    assert.equal((await sample()).axes.moveY, 0);
    await page.keyboard.press("KeyE"); // Both events precede the frame sample.
    await page.keyboard.down("ShiftLeft");
    let state = await sample();
    assert.deepEqual(state.justPressedActions, ["interact", "sprint"]);
    assert.deepEqual(state.releasedActions, ["interact"]);
    assert.deepEqual(state.pressedActions, ["sprint"]);
    await page.keyboard.up("ShiftLeft");
    await sample();

    // Modal release, keys held through re-enable, and editable DOM input.
    await page.keyboard.down("KeyW");
    await page.evaluate(() => { window.inputTest.input.setEnabled(false); document.querySelector("dialog").showModal(); });
    await page.locator("#modal").focus();
    await page.keyboard.up("KeyW");
    await page.keyboard.down("ArrowUp");
    assert.equal((await sample()).input.w, false);
    await page.evaluate(() => { document.querySelector("dialog").close(); window.inputTest.input.setEnabled(true); });
    await page.locator("canvas").focus();
    await page.keyboard.down("ArrowUp"); // Browser repeat from the still-held key.
    assert.equal((await sample()).input.w, false);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.down("ArrowUp");
    assert.equal((await sample()).input.w, true);
    await page.keyboard.up("ArrowUp");
    await page.locator("#field").focus();
    await page.keyboard.press("KeyE");
    assert.equal((await sample()).actions.interact, false);
    assert.equal(await page.locator("#field").inputValue(), "e");
    // Open shadow-root fields must receive normal text input while gameplay is enabled.
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'shadow-host';
      host.attachShadow({mode:'open'}).appendChild(document.createElement('input'));
      document.body.appendChild(host);
    });
    await page.locator('#shadow-host input').focus();
    await page.keyboard.press('KeyE');
    assert.equal(await page.locator('#shadow-host input').inputValue(), 'e');
    assert.deepEqual((await sample()).justPressedActions, []);
    await page.locator("canvas").focus();
    await sample();

    // Real virtual button capture and short press/release transitions.
    const button = page.locator('[data-ferrum-virtual-button="primary"]');
    await button.click();
    state = await sample();
    assert.deepEqual(state.justPressedActions, ["interact"]);
    assert.deepEqual(state.releasedActions, ["interact"]);
    const box = await button.boundingBox(); assert(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    assert.equal((await sample()).actions.interact, true);
    await page.evaluate(() => { window.inputTest.input.setEnabled(false); window.inputTest.input.setEnabled(true); });
    await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2);
    state = await sample();
    assert.equal(state.actions.interact, false);
    assert.deepEqual(state.justPressedActions, []);
    await page.mouse.up();

    // Cancellation from a subscription must not reacquire orphan joystick capture.
    await page.evaluate(() => {
      const { input, virtual } = window.inputTest;
      window.cancelSubscription = virtual.subscribe(() => input.clear());
      document.querySelector('[data-ferrum-virtual-joystick]').addEventListener('pointerdown', event => { window.joystickPointerId = event.pointerId; });
    });
    const joystick = page.locator('[data-ferrum-virtual-joystick]');
    const stick = await joystick.boundingBox(); assert(stick);
    await page.mouse.move(stick.x + stick.width - 2, stick.y + stick.height / 2);
    await page.mouse.down();
    assert.equal(await joystick.evaluate(element => element.hasPointerCapture(window.joystickPointerId)), false);
    assert.equal((await sample()).input.d, false);
    await page.mouse.up();
    await page.evaluate(() => window.cancelSubscription());
    const multiPointer = await page.evaluate(() => {
      const primary = document.querySelector('[data-ferrum-virtual-button="primary"]');
      const menu = document.querySelector('[data-ferrum-virtual-button="menu"]');
      const dispatch = (element, type, pointerId, isPrimary = false) => element.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', isPrimary, button: 0, bubbles: true }));
      dispatch(primary, 'pointerdown', 42, true); dispatch(menu, 'pointerdown', 43);
      const both = window.inputTest.virtual.state().buttons;
      dispatch(primary, 'pointercancel', 43); // Other finger must not release primary.
      const retained = window.inputTest.virtual.state().buttons.primary;
      dispatch(primary, 'lostpointercapture', 42); dispatch(menu, 'pointercancel', 43);
      const released = window.inputTest.virtual.state().buttons;
      return { both, retained, released };
    });
    assert.deepEqual(multiPointer, { both: {primary:true,menu:true}, retained:true, released:{primary:false,menu:false} });

    // One lost capture must leave the keyboard source active.
    await page.locator("canvas").focus();
    await page.keyboard.down("KeyW");
    await page.mouse.move(120, 80); await page.mouse.down();
    await page.mouse.move(121, 80); // Activate pending capture before requesting its loss.
    assert.equal(await page.evaluate(() => document.querySelector('canvas').hasPointerCapture(window.canvasPointerId)), true);
    await page.evaluate(() => document.querySelector('canvas').releasePointerCapture(window.canvasPointerId));
    await page.mouse.move(122, 80); // Let the browser dispatch native lostpointercapture.
    const capture = await page.evaluate(() => window.inputTest.input.snapshot());
    assert.equal(capture.w, true); assert.equal(capture.mouseLeft, false);
    await page.mouse.up(); await page.keyboard.up("KeyW");

    // Primary mouse release during a chord arrives before the final pointerup.
    await page.mouse.move(120, 80);
    await page.mouse.down({button:'left'}); await page.mouse.down({button:'right'});
    assert.equal((await sample()).input.mouseLeft, true);
    await page.mouse.up({button:'left'});
    assert.equal((await sample()).input.mouseLeft, false);
    await page.mouse.up({button:'right'});

    // Virtual buttons and joystick must also release when only the right button remains.
    const virtualMouseChord = [];
    for (const kind of ['primary', 'joystick']) {
      const target = kind === 'primary' ? button : joystick;
      const bounds = await target.boundingBox(); assert(bounds);
      await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + bounds.height / 2);
      await page.mouse.down({button:'left'}); await page.mouse.down({button:'right'});
      const held = () => page.evaluate(kind => {
        const state = window.inputTest.virtual.state();
        return kind === 'primary' ? state.buttons.primary : state.d;
      }, kind);
      const pressed = await held();
      await page.mouse.up({button:'left'});
      virtualMouseChord.push({kind, pressed, released: !await held()});
      await page.mouse.up({button:'right'});
    }
    assert.deepEqual(virtualMouseChord, [
      {kind:'primary',pressed:true,released:true}, {kind:'joystick',pressed:true,released:true},
    ]);

    // Browser gamepad polling is simulated; no claim of physical-device coverage.
    const gamepad = await page.evaluate(() => {
      const { input } = window.inputTest;
      input.snapshot();
      window.pad.axes = [1, 0];
      const held = input.snapshot().d;
      input.setEnabled(false); input.setEnabled(true);
      const blocked = input.snapshot().d;
      window.pad.axes = [0, 0]; input.snapshot();
      window.pad.axes = [1, 0];
      const rearmed = input.snapshot().d;
      window.dispatchEvent(new Event('blur'));
      const blurred = input.snapshot().d;
      window.dispatchEvent(new Event('focus'));
      const afterFocus = input.snapshot().d;
      window.pad.axes = [0, 0]; input.snapshot();
      return { held, blocked, rearmed, blurred, afterFocus };
    });
    assert.deepEqual(gamepad, { held: true, blocked: false, rearmed: true, blurred: false, afterFocus: false });
    const lifecycle = await page.evaluate(() => {
      const { input, virtual } = window.inputTest;
      input.destroy(); input.destroy();
      const before = window.padPolls;
      window.pad.axes = [1, 0];
      virtual.setButtonPressed('primary', true);
      const state = input.actionSnapshot();
      const stillOwned = virtual.state().buttons.primary;
      virtual.destroy();
      return { neutral: !state.input.d && !state.actions.interact, noPoll: before === window.padPolls, stillOwned };
    });
    assert.deepEqual(lifecycle, { neutral: true, noPoll: true, stillOwned: true });
    const exceptionCleanup = await page.evaluate(async () => {
      const { VirtualControls } = await import('@ferrum2d/ferrum-web/core');
      const parent = document.createElement('div'); document.body.appendChild(parent);
      const controls = new VirtualControls(parent);
      controls.setButtonPressed('primary', true);
      controls.subscribe(() => { throw new Error('expected cancellation failure'); });
      let propagated = false, disposed = false;
      try { controls.destroy(); } catch (error) { propagated = error.message === 'expected cancellation failure'; }
      try { controls.setJoystickVector(1, 0); } catch { disposed = true; }
      const result = { propagated, disposed, neutral: !controls.state().buttons.primary, removed: parent.childElementCount === 0 };
      controls.destroy(); parent.remove();
      return result;
    });
    assert.deepEqual(exceptionCleanup, {propagated:true,disposed:true,neutral:true,removed:true});
    assert.deepEqual(errors, []);
    report.cases.push({ viewport, deviceScaleFactor, keyboard: "passed", nativeModal: "passed", shadowInput: "passed", mouseChord: "passed", virtualMouseChord, virtualPointer: "passed", exceptionCleanup, gamepadSource: "simulated", gamepad, lifecycle, browserErrors: errors });
    await page.close();
  }
  report.status = "passed";
} catch (error) { report.status = "failed"; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally { await browser?.close(); await new Promise((done) => server.close(done)); await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify({ ...report, artifactDir: output }, null, 2));
