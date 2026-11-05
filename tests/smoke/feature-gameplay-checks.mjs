import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Resolve the consumer's public ESM entry; this root test runner has no workspace SDK dependency.
const packageUrl = new URL('../../packages/ferrum-web/package.json', import.meta.url);
const sdkPackage = JSON.parse(await readFile(packageUrl, 'utf8'));
const { hashGameStateSnapshot, validateGameStateSnapshot, DATA_SCENE_VARIABLES_SNAPSHOT_KEY } = await import(new URL(sdkPackage.exports['./core'].import, packageUrl).href);

export async function checkFeatureGameplay({ page, id, control, snapshot, pixelHash }) {
  const reset = () => control('reset').click();
  const move = async (x, y) => {
    await page.locator(`[data-move="${x},${y}"]`).click();
    await page.waitForFunction(({ x, y }) => { const p = window.ferrumFeatureLab.snapshot().actor; return Math.hypot(p.x - x, p.y - y) < 2; }, { x, y });
  };
  if (id === 'scenes') {
    await control('count').click(); await control('count').click();
    assert.equal((await snapshot()).transition.total, 2);
    const pixels = await page.evaluate(pixelHash);
    await page.evaluate(() => {
      const next = document.querySelector('[data-control="next-scene"]');
      next.click(); next.click();
      document.querySelector('[data-control="count"]').click();
    });
    // Freeze the first room mid-fade so GPU evidence cannot be supplied merely by the second room.
    await page.waitForFunction(() => {
      const t = window.ferrumFeatureLab.snapshot().transition;
      if (t.phase !== 'out' || t.opacity < .2) return false;
      document.querySelector('[data-control="pause"]').click(); return true;
    });
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().postProcessPassCount > 0);
    const paused = (await snapshot()).transition;
    assert.equal(paused.room, 'lab'); assert.equal(paused.total, 2);
    assert(paused.opacity > 0 && paused.opacity < 1);
    assert.notEqual((await page.evaluate(pixelHash)).hash, pixels.hash, 'fade must actually change pixels before scene replacement');
    await page.waitForTimeout(150); assert.deepEqual((await snapshot()).transition, paused);
    await control('next-scene').click(); assert.deepEqual((await snapshot()).transition, paused);
    await control('pause').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().transition.phase === 'idle');
    assert.deepEqual((await snapshot()).transition, { room: 'other', phase: 'idle', opacity: 0, local: 0, total: 2 });
    assert.notEqual((await page.evaluate(pixelHash)).hash, pixels.hash);
    const resources = (await snapshot()).resources;
    for (let i = 0; i < 4; i++) {
      await control('next-scene').click();
      await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().transition.phase === 'idle');
      assert.equal((await snapshot()).entities, 62);
    }
    for (const key of ['textureCount', 'bufferCount', 'programCount', 'renderTargetCount']) assert.equal((await snapshot()).resources[key], resources[key], `transition leaked ${key}`);
    await control('next-scene').click(); await reset();
    await page.waitForTimeout(600);
    assert.deepEqual((await snapshot()).transition, { room: 'lab', phase: 'idle', opacity: 0, local: 0, total: 0 });
    assert.equal((await snapshot()).postProcessPassCount, 0);
  }
  if (id === 'interaction') {
    await control('interact').click(); await page.waitForTimeout(100);
    assert.equal((await snapshot()).interaction.unlocked, false, 'remote switch must reject');
    await move(480, 208); await control('interact').click(); await page.waitForTimeout(100);
    assert.equal((await snapshot()).interaction.uses, 0, 'locked door must reject');
    await move(224, 208); await control('interact').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().interaction.unlocked);
    await move(480, 208); await page.locator('canvas').focus();
    await page.keyboard.down('Space');
    try {
      await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().interaction.uses === 1);
      await page.waitForTimeout(200); assert.equal((await snapshot()).interaction.uses, 1, 'held input repeats interaction');
    } finally { await page.keyboard.up('Space'); }
    await move(320, 272);
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().interaction.enter > 0);
    await move(128, 192);
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().interaction.exit > 0);
    await control('pause').click(); const before = (await snapshot()).actor;
    await page.locator('[data-move="320,272"]').click(); await control('interact').click();
    await page.waitForTimeout(150); assert.deepEqual((await snapshot()).actor, before);
    await reset();
    assert.deepEqual((await snapshot()).interaction, { unlocked: false, uses: 0, enter: 0, exit: 0 });
  }
  if (id === 'save-load') {
    const key = (await snapshot()).save.key;
    await page.evaluate(() => localStorage.setItem('feature-unrelated', 'keep'));
    try {
      await control('delete-save').click(); await control('load').click();
      assert.match(await page.locator('[data-value=gameplay-status]').textContent(), /데이터가 없습니다/);
      await move(448, 192);
      await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().save.collected === 1);
      assert.equal((await snapshot()).save.energyPresent, false);
      await control('save').click(); assert.equal((await snapshot()).save.lastOperation, 'save');
      const saved = await page.evaluate(key => localStorage.getItem(key), key);
      assert(saved);
      await reset(); assert.equal((await snapshot()).save.collected, 0);
      assert.equal((await snapshot()).save.energyPresent, true);
      await control('load').click();
      assert.equal((await snapshot()).save.lastOperation, 'load');
      assert.equal((await snapshot()).save.collected, 1); assert.equal((await snapshot()).save.energyPresent, false);
      assert(Math.abs((await snapshot()).actor.x - 448) < 2);
      assert((await snapshot()).animation, 'restored diagnostics must use the live actor generation');
      // Re-saving restored entities catches stale native handle/generation bugs.
      await move(128, 192); await control('save').click();
      await page.reload(); await page.waitForFunction(() => window.ferrumFeatureLab?.snapshot().nativeState === 1);
      assert.equal((await snapshot()).save.collected, 0);
      await control('load').click();
      assert.equal((await snapshot()).save.collected, 1); assert.equal((await snapshot()).save.energyPresent, false);
      assert(Math.abs((await snapshot()).actor.x - 128) < 2);
      // These are SDK-valid snapshots, but incomplete/unplayable for this particular example.
      // Rehashing distinguishes the app's contract from generic JSON/checksum validation.
      const partialCases = {
        'missing-progress': candidate => { delete candidate.dataScene.progress; },
        'missing-variables': candidate => { delete candidate.dataScene.custom[DATA_SCENE_VARIABLES_SNAPSHOT_KEY]; },
        'missing-actor': candidate => {
          const actor = candidate.dataScene.progress.instances.find(i => i.id === 'robot');
          actor.removed = true; delete actor.animation; delete actor.bodyEnabled; delete actor.colliderEnabled;
        },
        'disabled-actor': candidate => { candidate.dataScene.progress.instances.find(i => i.id === 'robot').bodyEnabled = false; },
        'wrong-collected-count': candidate => { candidate.dataScene.custom[DATA_SCENE_VARIABLES_SNAPSHOT_KEY].collected = 0; },
        'disabled-pickup': candidate => {
          candidate.dataScene.custom[DATA_SCENE_VARIABLES_SNAPSHOT_KEY].collected = 0;
          const energy = candidate.dataScene.progress.instances.find(i => i.id === 'energy');
          energy.removed = false; energy.bodyEnabled = false;
        },
        'outside-walkable-area': candidate => { candidate.dataScene.custom.actor.x = 624; },
      };
      const checkpoint = await snapshot();
      for (const [label, mutate] of Object.entries(partialCases)) {
        const candidate = JSON.parse(saved); mutate(candidate); candidate.snapshotHash = hashGameStateSnapshot(candidate);
        validateGameStateSnapshot(candidate);
        await page.evaluate(({ key, data }) => localStorage.setItem(key, data), { key, data: JSON.stringify(candidate) });
        await control('load').click();
        const after = await snapshot();
        assert.equal(after.save.lastOperation, 'error', label);
        assert.deepEqual(after.actor, checkpoint.actor, `${label} mutated the live actor`);
        assert.equal(after.entities, checkpoint.entities, `${label} replaced the live scene`);
        assert.equal(after.save.collected, checkpoint.save.collected, label);
        assert.equal(after.save.energyPresent, checkpoint.save.energyPresent, label);
      }
      const before = await snapshot();
      await page.evaluate(key => localStorage.setItem(key, '{broken'), key);
      await control('load').click(); assert.equal((await snapshot()).save.lastOperation, 'error');
      assert.deepEqual((await snapshot()).actor, before.actor); assert.equal((await snapshot()).save.collected, 1);
      await control('pause').click(); await control('save').click();
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '{broken', 'paused save must not overwrite slot');
      await control('pause').click();
      await page.evaluate(({ key, data }) => localStorage.setItem(key, data), { key, data: saved });
      await page.evaluate(key => {
        window.featureStorageSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, data) {
          if (name === key) throw new DOMException('Storage quota test', 'QuotaExceededError');
          return window.featureStorageSetItem.call(this, name, data);
        };
      }, key);
      try {
        await control('save').click(); assert.equal((await snapshot()).save.lastOperation, 'error');
        assert.equal(await page.evaluate(key => localStorage.getItem(key), key), saved, 'failed save overwrote the old slot');
      } finally {
        await page.evaluate(() => { Storage.prototype.setItem = window.featureStorageSetItem; delete window.featureStorageSetItem; });
      }
      await control('delete-save').click();
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
      assert.equal(await page.evaluate(() => localStorage.getItem('feature-unrelated')), 'keep');
      await reset();
    } finally { await page.evaluate(key => { localStorage.removeItem(key); localStorage.removeItem('feature-unrelated'); }, key); }
  }
  if (id === 'dialogue') {
    const preview = page.locator('.feature-content-preview');
    const action = name => preview.getByRole('button', { name, exact: true });
    assert.equal(await preview.locator('[data-ferrum-ui-dialog]').evaluate(p => getComputedStyle(p).borderTopWidth), '1px');
    await action('나중에 할게요').click(); assert.equal((await snapshot()).dialogue.nodeId, 'declined');
    assert.equal((await snapshot()).quests.quests[0].status, 'inactive');
    await action('다시 이야기하기').focus(); await page.keyboard.press('Enter');
    await action('도와드릴게요').focus(); await page.keyboard.press('Enter');
    assert.equal((await snapshot()).quests.quests[0].status, 'active');
    assert.deepEqual((await snapshot()).choices, ['take'], 'condition must hide delivery');
    assert.equal(await action('소포 챙기기').evaluate(b => b === document.activeElement), true);
    await page.waitForTimeout(350);
    assert.equal(await action('소포 챙기기').evaluate(b => b === document.activeElement), true, 'frame updates steal keyboard focus');
    await control('pause').click(); assert.equal(await action('소포 챙기기').isDisabled(), true);
    await control('pause').click(); await action('소포 챙기기').click();
    assert.deepEqual((await snapshot()).dialogue.flags, ['parcel']);
    await action('소포 전달하기').click();
    assert.equal((await snapshot()).dialogue.ended, true);
    assert.equal((await snapshot()).quests.quests[0].status, 'completed');
    assert((await snapshot()).quests.quests[0].completedObjectives.length > 0);
    assert.equal(await preview.locator('button').count(), 0);
    await reset(); assert.equal((await snapshot()).dialogue.nodeId, 'hello');
    assert.equal((await snapshot()).quests.quests[0].status, 'inactive');
  }
  if (id === 'hud') {
    const meter = page.locator('.feature-content-preview [role=progressbar]');
    await control('damage').click(); assert.equal((await snapshot()).hud.health, 75);
    assert.equal(await meter.getAttribute('aria-valuenow'), '75');
    await control('locale').selectOption('en'); assert.equal(await meter.getAttribute('aria-label'), 'Health');
    assert.equal(await page.locator('.feature-content-preview').getAttribute('lang'), 'en');
    const panel = page.locator('[data-ferrum-ui-panel=health]');
    const background = await panel.evaluate(p => getComputedStyle(p).backgroundColor);
    await control('text-size').selectOption('22');
    assert.equal(await panel.evaluate(p => getComputedStyle(p).fontSize), '22px');
    await control('contrast').selectOption('high-contrast');
    assert.notEqual(await panel.evaluate(p => getComputedStyle(p).backgroundColor), background);
    assert.equal((await snapshot()).hud.health, 75);
    for (let i = 0; i < 5; i++) await control('damage').click();
    assert.equal(await meter.getAttribute('aria-valuenow'), '0');
    assert.match(await panel.innerText(), /Time to rest/);
    await control('pause').click(); await control('heal').click(); assert.equal((await snapshot()).hud.health, 0);
    await control('pause').click(); await control('heal').click(); assert.equal((await snapshot()).hud.health, 25);
    // Largest text must fit the smallest supported viewport, not only the defaults.
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await reset(); assert.deepEqual((await snapshot()).hud, { health: 100, locale: 'ko', textSize: 14, contrast: 'default' });
  }
}
