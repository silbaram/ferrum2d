import assert from 'node:assert/strict';

// Observe real Web Audio nodes. Do not replace decoding, playback or panning with mocks.
export function observeFeatureAudio() {
  const Base = window.AudioContext;
  window.featureAudio = { contexts: [], panners: [], taps: [], starts: 0 };
  window.AudioContext = class extends Base {
    constructor(...args) { super(...args); window.featureAudio.contexts.push(this); }
    createBufferSource() {
      const source = super.createBufferSource(), start = source.start.bind(source);
      source.start = (...args) => { start(...args); window.featureAudio.starts++; };
      return source;
    }
    createPanner() {
      const panner = super.createPanner(); window.featureAudio.panners.push(panner);
      const splitter = this.createChannelSplitter(2), mute = this.createGain(); mute.gain.value = 0;
      const channels = [this.createAnalyser(), this.createAnalyser()];
      panner.connect(splitter);
      channels.forEach((analyser, i) => { analyser.fftSize = 2048; splitter.connect(analyser, i); analyser.connect(mute); });
      mute.connect(this.destination);
      window.featureAudio.taps.push({ channels, splitter, mute });
      return panner;
    }
  };
}

export async function checkFeatureExtra({ page, id, control, snapshot, pixelHash }) {
  const set = async (key, v) => { await control(key).fill(String(v)); await control(key).dispatchEvent('input'); };
  const held = async (key, milliseconds) => {
    await page.locator('canvas').focus(); await page.keyboard.down(key); await page.waitForTimeout(milliseconds); await page.keyboard.up(key);
  };
  if (id === 'tilemap') {
    assert.equal((await snapshot()).actor.x, 160);
    const closed = await page.evaluate(pixelHash);
    await held('ArrowRight', 1600);
    const blocked = (await snapshot()).actor;
    assert(blocked.x > 290 && blocked.x < 320, `wall failed: ${blocked.x}`);
    await control('open-gate').click(); assert((await snapshot()).tilemap.gateOpen);
    assert.notEqual((await page.evaluate(pixelHash)).hash, closed.hash);
    await held('ArrowRight', 1300); assert((await snapshot()).actor.x > 440, 'opened tile passage blocked');
    await control('return-left').click(); await control('close-gate').click();
    await held('KeyD', 1400); assert((await snapshot()).actor.x < 320);
    // An actual pointer edit, not just the pre-defined gate buttons.
    const point = await page.locator('canvas').evaluate(c => { const r = c.getBoundingClientRect(); return { x: r.x + r.width * (336 / 640), y: r.y + r.height * (144 / 384) }; });
    await control('brush').selectOption('floor');
    const edits = (await snapshot()).tilemap.edits;
    await page.mouse.click(point.x, point.y);
    assert.equal((await snapshot()).tilemap.edits, edits + 1);
    await control('reset').click(); assert.deepEqual((await snapshot()).tilemap, { edits: 0, gateOpen: false });
    assert.equal((await snapshot()).actor.x, 160);
    await held('KeyD', 800);
    const away = (await snapshot()).actor;
    const startTile = await page.locator('canvas').evaluate(c => { const r = c.getBoundingClientRect(); return { x: r.x + r.width * (144 / 640), y: r.y + r.height * (176 / 384) }; });
    await page.mouse.click(startTile.x, startTile.y);
    await control('return-left').click();
    assert.deepEqual((await snapshot()).actor, away, 'return button teleported the player into an edited wall');
    assert.match(await page.locator('[data-value="edit"]').innerText(), /막혀/);
    await control('brush').selectOption('floor'); await page.mouse.click(startTile.x, startTile.y);
    await control('return-left').click(); assert.equal((await snapshot()).actor.x, 160);
    await control('pause').click(); await control('reset').click(); await held('KeyD', 250);
    assert((await snapshot()).actor.x > 175, 'reset from pause left input disabled');
    await control('reset').click();
    await control('open-gate').click();
    // Reach only the upper gate cell to catch an incorrectly partial two-cell close.
    await page.locator('canvas').focus(); await page.keyboard.down('KeyD');
    try { await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().actor.x >= 330); }
    finally { await page.keyboard.up('KeyD'); }
    await held('KeyW', 170);
    const open = (await snapshot()).tilemap;
    await control('close-gate').click();
    assert.deepEqual((await snapshot()).tilemap, open, 'closing an occupied gate partially changed its cells');
    assert.match(await page.locator('[data-value="edit"]').innerText(), /통로에/);
    await control('reset').click();
  }
  if (id === 'layers') {
    await control('pause').click();
    const before = await page.evaluate(pixelHash);
    await control('order').selectOption('middle'); await page.waitForTimeout(80);
    assert.equal((await snapshot()).layers.robot, 0); assert.equal((await snapshot()).state, 'paused');
    const middle = await page.evaluate(pixelHash); assert.notEqual(middle.hash, before.hash);
    await control('order').selectOption('back'); await page.waitForTimeout(80);
    assert.equal((await snapshot()).layers.robot, -2);
    assert.notEqual((await page.evaluate(pixelHash)).hash, middle.hash);
    await control('reset').click(); assert.equal((await snapshot()).layers.robot, 2);
  }
  if (id === 'particles') {
    assert.equal((await snapshot()).particles.count, 0);
    const empty = await page.evaluate(pixelHash);
    await control('emit').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().particles.count === 24);
    await control('pause').click();
    const frozen = await page.evaluate(pixelHash);
    assert.notEqual(frozen.hash, empty.hash, 'native particles must be visible');
    await page.waitForTimeout(250); assert.equal((await snapshot()).particles.count, 24);
    assert.equal((await page.evaluate(pixelHash)).hash, frozen.hash);
    await control('pause').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().particles.count === 0);
    await set('count', 8); await set('life', 12); await set('speed', 220);
    await control('vfx').selectOption('dust-loop'); await control('emit').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().particles.emittedBurstCount >= 3);
    assert((await snapshot()).particles.count >= 16);
    await control('stop-emitter').click(); const bursts = (await snapshot()).particles.emittedBurstCount;
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().particles.count === 0);
    assert.equal((await snapshot()).particles.emittedBurstCount, bursts);
    await control('vfx').selectOption('motion-trail'); await control('emit').click();
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + 80, box.y + 80); await page.waitForTimeout(180);
    await page.mouse.move(box.x + box.width - 80, box.y + box.height - 80, { steps: 12 });
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().particles.emittedBurstCount >= 2);
    await control('reset').click(); assert.equal((await snapshot()).particles.count, 0);
    assert.equal(await control('count').inputValue(), '24');
    await control('emit').click(); await page.waitForTimeout(200); await control('pause').click();
  }
  if (id === 'audio') {
    assert.equal((await snapshot()).audio.active, false);
    await control('audio-play').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().audio.active);
    assert.equal((await snapshot()).audio.spatialized, true);
    const levels = () => page.evaluate(async () => {
      const channels = window.featureAudio.taps.at(-1).channels;
      const sums = [0, 0], bytes = new Float32Array(2048);
      // Integrate one whole repeating cue, avoiding an envelope-dependent instantaneous assertion.
      for (let k = 0; k < 25; k++) {
        await new Promise(done => setTimeout(done, 50));
        channels.forEach((a, i) => { a.getFloatTimeDomainData(bytes); sums[i] += bytes.reduce((n, x) => n + x * x, 0) / bytes.length; });
      }
      return sums;
    });
    await set('pan', -160); const left = await levels();
    await set('pan', 160); const right = await levels();
    assert(left[0] > left[1] * 1.8 && right[1] > right[0] * 1.8, `actual stereo direction: ${left} / ${right}`);
    await set('pan', 0); await set('distance', 32); const near = await levels();
    await set('distance', 240); const far = await levels();
    assert(near[0] + near[1] > 4 * (far[0] + far[1]), `actual attenuation: ${near} / ${far}`);
    await control('audio-play').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().audio.active);
    assert.equal((await snapshot()).audio.spatialVoiceCount, 1, 'repeat play leaked voice');
    await control('pause').click(); assert.equal((await snapshot()).audio.spatialVoiceCount, 0);
    await control('pause').click(); await control('audio-play').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().audio.active);
    await control('reset').click(); assert.equal((await snapshot()).audio.active, false);
    await control('audio-play').click(); await control('audio-stop').click(); await page.waitForTimeout(150);
    assert.equal((await snapshot()).audio.spatialVoiceCount, 0);
    await control('audio-play').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().audio.active);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    assert.equal((await snapshot()).audio.spatialVoiceCount, 0, 'cached page left looping audio active');
    await control('audio-play').click(); await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().audio.active);
    // Leave a live source for the enclosing test to verify destruction closes its context.
  }
  if (id === 'input') {
    await held('KeyD', 400); assert((await snapshot()).actor.x > 190);
    const p = (await snapshot()).actor;
    await control('menu').click(); await page.locator('dialog input').fill('wasd');
    await page.keyboard.down('KeyD'); await page.waitForTimeout(400);
    const blocked = await snapshot();
    assert.equal(blocked.input.d, false); assert.deepEqual(blocked.actor, p);
    const time = blocked.input.time; await page.waitForTimeout(100); assert((await snapshot()).input.time > time, 'menu must block input, not freeze engine');
    await page.keyboard.press('Escape'); // Held key must not leak back into the game.
    await page.waitForTimeout(160); assert.deepEqual((await snapshot()).actor, p);
    await page.keyboard.up('KeyD'); await held('ArrowRight', 300); assert((await snapshot()).actor.x > p.x + 15);
    const stick = await page.locator('[data-ferrum-virtual-joystick]').boundingBox();
    const before = (await snapshot()).actor.x;
    await page.mouse.move(stick.x + stick.width - 4, stick.y + stick.height / 2); await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
    assert((await snapshot()).actor.x > before + 15, 'real pointer joystick did not move native actor');
    // Simulate only the hardware polling boundary. Engine/InputManager stay real.
    await page.evaluate(() => {
      window.featurePad = { index: 0, id: 'smoke-standard-pad', connected: true, mapping: 'standard', axes: [0, 0], buttons: [] };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.featurePad] });
    });
    await page.waitForTimeout(100);
    const beforePad = (await snapshot()).actor.x;
    await page.evaluate(() => { window.featurePad.axes[0] = -1; }); await page.waitForTimeout(300);
    const pad = (await snapshot()).actor.x;
    assert(pad < beforePad - 15, 'gamepad polling did not move native actor');
    await control('menu').click(); await page.waitForTimeout(200); const menuPad = (await snapshot()).actor;
    await page.locator('dialog button').click(); await page.waitForTimeout(250);
    assert.deepEqual((await snapshot()).actor, menuPad, 'held pad should require neutral after menu');
    await page.evaluate(() => { window.featurePad.axes[0] = 0; }); await page.waitForTimeout(100);
    await page.evaluate(() => { window.featurePad.axes[0] = -1; }); await page.waitForTimeout(250);
    assert((await snapshot()).actor.x < menuPad.x - 15);
    await page.evaluate(() => { window.featurePad.axes[0] = 0; });
    await control('reset').click(); assert.equal((await snapshot()).actor.x, 160);
    await page.setViewportSize({ width: 390, height: 844 });
    await control('menu').click(); const dialog = await page.locator('dialog').boundingBox();
    assert(dialog.x >= 0 && dialog.x + dialog.width <= 390); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}
