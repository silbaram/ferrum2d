import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, writeFile, cp } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
const { chromium } = await import(process.env.FERRUM_PLAYWRIGHT_MODULE ?? "playwright-core");
import { runReleaseCommand } from "./github-release-command.mjs";

const root = resolve(".");
const visualsOnly = process.argv.includes("--visuals-only");
const spawnOnly = process.argv.includes("--spawn-only");
const actionsOnly = process.argv.includes("--actions-only");
const movementOnly = process.argv.includes("--movement-only");
const schedulerOnly = process.argv.includes("--scheduler-only");
const crowdOnly = process.argv.includes("--crowd-only");
const navigationOnly = process.argv.includes("--navigation-only");
const inputOnly = process.argv.includes("--input-only");
const artifactRoot = resolve(
  root,
  process.env.FERRUM_COMBAT_ARTIFACT_PARENT ??
    `artifacts/hd2d-static-model/${inputOnly ? "combat-input" : "combat"}`,
);
await mkdir(artifactRoot, { recursive: true });
const output = await mkdtemp(resolve(artifactRoot, "run-"));
const benchmark = process.argv.includes("--benchmark");
const durationMs = benchmark ? Number(process.env.FERRUM_COMBAT_DURATION_MS ?? 60000) : 2500;
const warmupMs = benchmark ? Number(process.env.FERRUM_COMBAT_WARMUP_MS ?? 20000) : 2000;
const repeats = benchmark ? Number(process.env.FERRUM_COMBAT_REPEATS ?? 3) : 1;
assert(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
assert(Number.isFinite(durationMs) && durationMs > 0 && durationMs <= 120000);
assert(Number.isFinite(warmupMs) && warmupMs >= 0 && warmupMs <= 120000);
if (process.env.FERRUM_COMBAT_PREPARED_PACKAGE) {
  await cp(process.env.FERRUM_COMBAT_PREPARED_PACKAGE, resolve(output, "package"), {
    recursive: true,
  });
} else {
  await runReleaseCommand("pnpm", ["pack", "--pack-destination", output], {
    cwd: resolve(root, "packages/ferrum-web"),
  });
  const tarball = (await readdir(output)).find((name) => name.endsWith(".tgz"));
  assert(tarball);
  await runReleaseCommand("tar", ["-xzf", resolve(output, tarball), "-C", output]);
}
const html = `<!doctype html><meta charset="utf-8"><style>html,body,canvas{margin:0;width:100%;height:100%;display:block}</style><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/package/dist/core.js","@ferrum2d/ferrum-web/authoring":"/package/dist/authoring.js"}}</script><canvas></canvas><script type="module">import{startCombatProbe}from'/fixture.mjs';import{startInputProjectileProbe}from'/input-fixture.mjs';import{probeCombatNavigation}from'/navigation-fixture.mjs';import{probeCombatScheduler}from'/scheduler-fixture.mjs';import{probeCombatMovement}from'/movement-fixture.mjs';import{probeCombatActions}from'/actions-fixture.mjs';import{probeCombatSpawn}from'/spawn-fixture.mjs';import{probeCombatVisuals}from'/visuals-fixture.mjs';window.probeCombatVisuals=()=>probeCombatVisuals(document.querySelector('canvas'));window.probeCombatSpawn=()=>probeCombatSpawn(document.querySelector('canvas'));window.probeCombatActions=()=>probeCombatActions(document.querySelector('canvas'));window.probeCombatMovement=()=>probeCombatMovement(document.querySelector('canvas'));window.probeCombatScheduler=()=>probeCombatScheduler(document.querySelector('canvas'));window.probeCombatNavigation=()=>probeCombatNavigation(document.querySelector('canvas'));window.probeCombatCrowd=()=>probeCombatNavigation(document.querySelector('canvas'),true);window.startCombatProbe=n=>startCombatProbe(document.querySelector('canvas'),n);window.startInputProjectileProbe=()=>startInputProjectileProbe(document.querySelector('canvas'));</script>`;
const server = createServer((req, res) => {
  void (async () => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
      return;
    }
    let file;
    if (pathname === "/fixture.mjs")
      file = resolve(root, "tests/smoke/hd2d-combat-browser-fixture.mjs");
    else if (pathname === "/input-fixture.mjs")
      file = resolve(root, "tests/smoke/hd2d-input-projectile-browser-fixture.mjs");
    else if (pathname === "/visuals-fixture.mjs")
      file = resolve(root, "tests/smoke/hd2d-combat-visuals-browser-fixture.mjs");
    else if (pathname === "/spawn-fixture.mjs")
      file = resolve(root, "tests/smoke/hd2d-combat-spawn-browser-fixture.mjs");
    else if (pathname === "/actions-fixture.mjs")
      file = resolve(root, "tests/smoke/hd2d-combat-actions-browser-fixture.mjs");
    else if (pathname === "/movement-fixture.mjs")
      file = resolve(root, "tests/smoke/hd2d-combat-movement-browser-fixture.mjs");
    else if (pathname === "/scheduler-fixture.mjs")
      file = resolve(root, "tests/smoke/hd2d-combat-scheduler-browser-fixture.mjs");
    else if (pathname === "/navigation-fixture.mjs")
      file = resolve(root, "tests/smoke/hd2d-combat-navigation-browser-fixture.mjs");
    else if (pathname === "/rock.glb")
      file = resolve(root, "examples/data-scene-native/assets/rock.glb");
    else {
      file = resolve(output, "." + decodeURIComponent(pathname));
      if (!file.startsWith(resolve(output, "package") + sep) || !/\.(js|wasm)$/.test(file)) {
        res.writeHead(403).end();
        return;
      }
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".wasm")
        ? "application/wasm"
        : file.endsWith(".glb")
          ? "model/gltf-binary"
          : "application/javascript",
    );
    res.end(await readFile(file));
  })().catch(() => res.writeHead(404).end());
});
const summary = (values) => {
  assert(values.length > 0 && values.every((value) => Number.isFinite(value) && value >= 0));
  const sorted = values.toSorted((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    max: sorted.at(-1),
  };
};
const report = {
  format: "ferrum2d.hd2d-combat.smoke",
  version: 1,
  status: "running",
  benchmark,
  scope:
    "Synthetic native Data Scene combat with 216 shared rock models; not a measured consumer game or device guarantee.",
  protocol: { durationMs, warmupMs, repeats },
  cases: [],
  inputCases: [],
  checkpointCases: [],
  prefabCases: [],
  navigationCases: [],
  crowdCases: [],
  schedulerCases: [],
  movementCases: [],
  actionCases: [],
  spawnCases: [],
  visualCases: [],
  wasmSha256: createHash("sha256")
    .update(await readFile(resolve(output, "package/pkg/ferrum_core_bg.wasm")))
    .digest("hex"),
};
let browser;
try {
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const options = {
    headless: !process.env.FERRUM_COMBAT_HEADED,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  };
  if (process.env.FERRUM_BROWSER_EXECUTABLE)
    browser = await chromium.launch({
      ...options,
      executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
    });
  else {
    try {
      browser = await chromium.launch({
        ...options,
        channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chromium",
      });
    } catch (error) {
      if (process.env.FERRUM_BROWSER_CHANNEL) throw error;
      browser = await chromium.launch(options);
    }
  }
  report.browser = browser.version();
  const conditions = benchmark
    ? [{ viewport: { width: 1465, height: 800 }, deviceScaleFactor: 1 }]
    : [
        { width: 1280, height: 720 },
        { width: 390, height: 844 },
      ].flatMap((viewport) => [1, 2].map((deviceScaleFactor) => ({ viewport, deviceScaleFactor })));
  for (const condition of conditions) {
    const page = await browser.newPage(condition);
    page.setDefaultTimeout(durationMs + warmupMs + 60000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.startCombatProbe);
      const glInfo = await page.evaluate(() => {
        const gl = document.querySelector("canvas").getContext("webgl2"),
          ext = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : "unavailable",
          renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unavailable",
        };
      });
      for (let repeat = 0; repeat < repeats; repeat++)
        for (const enemyCount of visualsOnly ||
        spawnOnly ||
        inputOnly ||
        navigationOnly ||
        crowdOnly ||
        schedulerOnly ||
        movementOnly ||
        actionsOnly
          ? []
          : [0, 32, 128]) {
          await page.evaluate(async (count) => {
            window.combatProbe = await window.startCombatProbe(count);
          }, enemyCount);
          try {
            const result = await page.evaluate(
              async (protocol) => {
                const scene = window.combatProbe,
                  result = await scene.sample(protocol);
                result.pauseFrozen = await scene.pauseCheck();
                result.checkpoint = scene.saveCheck();
                result.resetClean = await scene.resetCheck();
                return result;
              },
              { warmupMs, durationMs },
            );
            const key = `${condition.viewport.width}x${condition.viewport.height}-dpr${condition.deviceScaleFactor}-enemies${enemyCount}-${repeat}`;
            await writeFile(resolve(output, `${key}.json`), JSON.stringify(result));
            report.activeCase = { ...condition, enemyCount, repeat, raw: `${key}.json` };
            assert.deepEqual(result.errors, []);
            assert.deepEqual(errors, []);
            assert(result.frames >= (benchmark ? 100 : 10), "insufficient live combat frames");
            assert(
              result.rows.every(
                (row) => row.models === 216 && row.modelDrawCalls > 0 && row.triangles === 216 * 8,
              ),
              "background models disappeared",
            );
            assert(result.pauseFrozen && result.checkpoint.version === 9 && result.resetClean);
            assert.equal(result.checkpoint.actors, 217 + enemyCount - Math.min(enemyCount, 4));
            for (const field of ["bufferCount", "textureCount", "programCount"])
              assert.equal(
                result.resources[field],
                result.resourceBaseline[field],
                `steady combat GPU ${field} grew`,
              );
            assert(
              result.resources.bufferBytes <= 2 * 1024 * 1024,
              "combat GPU buffers exceeded 2 MiB capacity budget",
            );
            if (enemyCount > 0) {
              assert(
                result.after.aiSteps > result.before.aiSteps &&
                  result.after.spawned > result.before.spawned,
                "AI or repeat fire stopped during sample",
              );
              assert(
                result.after.hits > result.before.hits &&
                  result.after.kills >= 1 &&
                  result.after.particlesSpawned > result.before.particlesSpawned &&
                  result.maxParticles > 0,
                `combat did not produce actual hits, kills and particles: ${JSON.stringify({ before: result.before, after: result.after, maxParticles: result.maxParticles })}`,
              );
              assert(
                result.aiBefore &&
                  result.aiAfter &&
                  Math.hypot(
                    result.aiAfter.x - result.aiBefore.x,
                    result.aiAfter.y - result.aiBefore.y,
                  ) > 0.1,
                "native AI counted steps without actual movement",
              );
              assert(
                result.actorHitEvents > 0,
                "projectiles did not deliver damage events to the primary actor during measurement",
              );
              assert.equal(result.after.capped, 0, "native combat capacity was exceeded");
              assert(
                result.maxBillboards > enemyCount + 1,
                "dynamic projectiles never reached spatial billboard rendering",
              );
            } else assert.equal(result.after.spawned, 0);
            const cpu = {
              rustMs: summary(result.rows.map((row) => row.rustMs)),
              renderMs: summary(result.rows.map((row) => row.renderMs)),
              intervalMs: summary(result.rows.map((row) => row.intervalMs)),
            };
            // CI budgets catch unbounded work; FPS remains descriptive across hardware/software renderers.
            assert(
              cpu.rustMs.max < 250 && cpu.renderMs.max < 1000,
              "combat runtime exceeded CI work budget",
            );
            if (benchmark)
              assert(
                result.gpuSamples.length > 0,
                "benchmark requires completed GPU timer queries",
              );
            const entry = {
              ...condition,
              repeat,
              enemyCount,
              frames: result.frames,
              fps: result.fps,
              cpu,
              gpuMs: result.gpuSamples.length
                ? summary(result.gpuSamples.map((value) => value.elapsedMs))
                : null,
              gpuSamples: result.gpuSamples.length,
              glInfo,
              combat: result.after,
              actorHitEvents: result.actorHitEvents,
              maxParticles: result.maxParticles,
              maxBillboards: result.maxBillboards,
              resources: result.resources,
              pauseFrozen: result.pauseFrozen,
              checkpoint: result.checkpoint,
              resetClean: result.resetClean,
              raw: `${key}.json`,
            };
            report.cases.push(entry);
            delete report.activeCase;
            console.log(JSON.stringify(entry));
          } finally {
            await page.evaluate(() => window.combatProbe.destroy());
          }
        }
      if (
        !benchmark &&
        !visualsOnly &&
        !spawnOnly &&
        !actionsOnly &&
        !navigationOnly &&
        !crowdOnly &&
        !schedulerOnly &&
        !movementOnly
      ) {
        await page.evaluate(async () => {
          window.inputProbe = await window.startInputProjectileProbe();
        });
        try {
          for (const projection of ["orthographic", "perspective"])
            for (const pixelArt of [false, true]) {
              const config = { projection, pixelArt, zoom: pixelArt ? 1.25 : 1 };
              report.activeInputCase = { ...condition, ...config };
              await page.evaluate((config) => window.inputProbe.setup(config), config);
              const aim = await page.evaluate(() => window.inputProbe.aim());
              await page.mouse.move(aim.x, aim.y);
              await page.mouse.down();
              await page.waitForFunction(() => window.inputProbe.status().combat.spawned === 1);
              const held = await page.evaluate(() => window.inputProbe.waitFrames(8));
              assert.equal(held.combat.spawned, 1, "pressed action repeated while held");
              assert(
                held.maxBillboards >= 4 && held.drawCalls > 0 && held.state === "playing",
                "input projectile did not render in active spatial scene",
              );
              await page.mouse.up();
              await page.evaluate(() => window.inputProbe.waitSimulation(0.4));
              const first = await page.evaluate(() => window.inputProbe.status());
              assert.equal(
                first.targetDamageEvents,
                1,
                "pointer aim did not hit the intended enemy",
              );
              assert(first.targetExists && first.upperExists && first.combat.kills === 0);
              // A separate keyboard binding fires the same native action at the retained pointer aim.
              for (let shot = 0; shot < 2; shot++) {
                await page.keyboard.down("Space");
                await page.waitForFunction(
                  (n) => window.inputProbe.status().combat.spawned === n,
                  shot + 2,
                );
                await page.keyboard.up("Space");
                await page.evaluate(() => window.inputProbe.waitSimulation(0.4));
              }
              const killed = await page.evaluate(() => window.inputProbe.status());
              assert.equal(killed.targetDamageEvents, 3);
              assert.equal(killed.targetExists, false);
              assert(killed.upperExists && killed.combat.kills === 1 && killed.combat.capped === 0);
              assert(await page.evaluate(() => window.inputProbe.pause()));
              await page.mouse.down();
              await page.evaluate(() => window.inputProbe.waitFrames(3));
              await page.mouse.up();
              await page.evaluate(() => window.inputProbe.waitFrames(3));
              assert(await page.evaluate(() => window.inputProbe.resume()));
              const resumed = await page.evaluate(() => window.inputProbe.waitFrames(4));
              assert.equal(
                resumed.combat.spawned,
                killed.combat.spawned,
                "paused press leaked into resumed combat",
              );
              const bar = await page.evaluate(() => window.inputProbe.bar());
              if (bar) {
                await page.mouse.move(bar.x, bar.y);
                await page.mouse.down();
                await page.evaluate(() => window.inputProbe.waitFrames(4));
                await page.mouse.up();
                assert.equal(
                  (await page.evaluate(() => window.inputProbe.status())).combat.spawned,
                  3,
                  "letterbox input spawned a projectile",
                );
              }
              await page.evaluate(
                (config) => window.inputProbe.setup({ ...config, wall: true }),
                config,
              );
              const blockedAim = await page.evaluate(() => window.inputProbe.aim());
              await page.mouse.move(blockedAim.x, blockedAim.y);
              await page.mouse.down();
              await page.waitForFunction(() => window.inputProbe.status().combat.spawned === 1);
              await page.mouse.up();
              const blocked = await page.evaluate(() => window.inputProbe.waitSimulation(0.6));
              assert(
                blocked.targetExists &&
                  blocked.upperExists &&
                  blocked.combat.projectiles === 0 &&
                  blocked.combat.hits === 0,
                "wall did not intercept the input projectile",
              );
              assert(
                blocked.frames > 10 && blocked.maxRustMs < 250 && blocked.maxRenderMs < 1000,
                "input runtime exceeded CI work budget",
              );
              assert(blocked.resources.bufferBytes < 2 * 1024 * 1024);
              assert.deepEqual(blocked.errors, []);
              assert.deepEqual(errors, []);
              const entry = {
                ...condition,
                ...config,
                first,
                killed,
                pausedPressDiscarded: true,
                letterboxRejected: !!bar,
                blocked,
              };
              report.inputCases.push(entry);
              console.log(
                JSON.stringify({
                  input: true,
                  ...condition,
                  ...config,
                  hits: killed.targetDamageEvents,
                  wallBlocked: true,
                }),
              );
              delete report.activeInputCase;
            }
          const resized = {
            width: condition.viewport.width - 20,
            height: condition.viewport.height - 30,
          };
          await page.setViewportSize(resized);
          await page.evaluate(() =>
            window.inputProbe.setup({ projection: "perspective", pixelArt: true, zoom: 1.5 }),
          );
          const aim = await page.evaluate(() => window.inputProbe.aim());
          await page.mouse.move(aim.x, aim.y);
          await page.mouse.down();
          await page.waitForFunction(() => window.inputProbe.status().combat.spawned === 1);
          await page.mouse.up();
          const resizeResult = await page.evaluate(() => window.inputProbe.waitSimulation(0.4));
          assert.equal(resizeResult.targetDamageEvents, 1, "resized viewport aim missed");
          assert.deepEqual(resizeResult.errors, []);
          assert.deepEqual(errors, []);
          report.inputCases.push({ ...condition, resized, resizeResult });
          await page.evaluate(() =>
            window.inputProbe.setup({ projection: "perspective", pixelArt: true }),
          );
          await page.evaluate(() => window.inputProbe.armCheckpoint());
          const checkpointAim = await page.evaluate(() => window.inputProbe.aim());
          await page.mouse.move(checkpointAim.x, checkpointAim.y);
          await page.mouse.down();
          await page.waitForFunction(() => window.inputProbe.checkpointReady());
          await page.mouse.up();
          const checkpoint = await page.evaluate(() => window.inputProbe.restoreCheckpoint());
          assert.equal(checkpoint.version, 9);
          assert.equal(checkpoint.projectiles, 1);
          assert(
            checkpoint.invalidPreserved && checkpoint.remappedHandles && checkpoint.continuedDamage,
          );
          assert.deepEqual(checkpoint.after.errors, []);
          assert.deepEqual(errors, []);
          report.checkpointCases.push({ ...condition, resized, ...checkpoint });
          report.activePrefabCase = condition;
          await page.evaluate(() =>
            window.inputProbe.setup({
              projection: "perspective",
              pixelArt: true,
              projectilePrefab: true,
            }),
          );
          await page.evaluate(() => window.inputProbe.armCheckpoint());
          const prefabAim = await page.evaluate(() => window.inputProbe.aim());
          await page.mouse.move(prefabAim.x, prefabAim.y);
          await page.mouse.down();
          await page.waitForFunction(() => window.inputProbe.checkpointReady());
          await page.mouse.up();
          await page.screenshot({
            path: resolve(
              output,
              `prefab-${condition.viewport.width}x${condition.viewport.height}-dpr${condition.deviceScaleFactor}.png`,
            ),
          });
          const prefab = await page.evaluate(() => window.inputProbe.restoreCheckpoint());
          assert.equal(prefab.prefab.version, 2);
          assert.equal(prefab.prefab.name, "spark");
          assert.deepEqual(
            prefab.prefab.rendered.map((row) => row.texture),
            [2, 3],
          );
          assert(
            prefab.invalidPreserved &&
              prefab.remappedHandles &&
              prefab.continuedDamage &&
              prefab.reconfigureInvalidated,
          );
          assert.deepEqual(prefab.after.errors, []);
          assert.deepEqual(errors, []);
          report.prefabCases.push({ ...condition, ...prefab });
          delete report.activePrefabCase;
        } finally {
          await page.evaluate(() => window.inputProbe.destroy());
        }
      }
      if (
        !benchmark &&
        !visualsOnly &&
        !spawnOnly &&
        !actionsOnly &&
        !crowdOnly &&
        !schedulerOnly &&
        !movementOnly
      ) {
        report.activeNavigationCase = condition;
        const result = await page.evaluate(() => window.probeCombatNavigation());
        assert(
          result.restored &&
            result.paused &&
            result.final.agents === 8 &&
            result.maxFrameSearches === 1 &&
            result.maxWorkUnits <= 1_000_000,
        );
        assert.deepEqual(result.errors, []);
        assert.deepEqual(errors, []);
        report.navigationCases.push({ ...condition, ...result });
        delete report.activeNavigationCase;
        console.log(JSON.stringify({ navigation: true, ...condition, ...result }));
      }
      if (
        !benchmark &&
        !visualsOnly &&
        !spawnOnly &&
        !actionsOnly &&
        !schedulerOnly &&
        !movementOnly
      ) {
        report.activeCrowdCase = condition;
        const result = await page.evaluate(() => window.probeCombatCrowd());
        assert(
          result.restored &&
            result.paused &&
            result.crowd.enabled &&
            result.crowd.neighborTests > 0 &&
            result.maxWorkUnits <= 1_000_000,
        );
        assert.deepEqual(result.errors, []);
        assert.deepEqual(errors, []);
        report.crowdCases.push({ ...condition, ...result });
        delete report.activeCrowdCase;
        console.log(JSON.stringify({ crowd: true, ...condition, ...result }));
      }
      if (
        !benchmark &&
        !visualsOnly &&
        !spawnOnly &&
        !actionsOnly &&
        !crowdOnly &&
        !navigationOnly &&
        !movementOnly
      ) {
        report.activeSchedulerCase = condition;
        const result = await page.evaluate(() => window.probeCombatScheduler());
        assert.equal(result.length, 2);
        assert(
          result[0].restored &&
            result[0].final.yieldedSlices > 0 &&
            result[1].final.cacheHits >= 60,
        );
        assert(
          result.every(
            (r) =>
              r.maxSearchWork <= 262144 && r.maxFrameWork <= 1_000_000 && r.errors.length === 0,
          ),
        );
        assert.deepEqual(errors, []);
        report.schedulerCases.push({ ...condition, result });
        delete report.activeSchedulerCase;
        console.log(JSON.stringify({ scheduler: true, ...condition, result }));
      }
      if (
        !benchmark &&
        !visualsOnly &&
        !spawnOnly &&
        !actionsOnly &&
        !crowdOnly &&
        !navigationOnly &&
        !schedulerOnly
      ) {
        report.activeMovementCase = condition;
        const result = await page.evaluate(() => window.probeCombatMovement());
        assert.deepEqual(
          result.map((r) => r.kind),
          ["seek", "accelerate-up", "accelerate-down"],
        );
        assert(
          result.every(
            (r) =>
              r.restored &&
              r.velocityRestored &&
              r.paused &&
              r.navigation.agents === 4 &&
              r.visualHeightFrames > 10 &&
              r.maxWorkUnits <= 1_000_000,
          ),
        );
        assert(result.every((r) => r.maxFrameSearches <= 1 && r.errors.length === 0));
        assert.deepEqual(errors, []);
        report.movementCases.push({ ...condition, result });
        delete report.activeMovementCase;
        await page.screenshot({
          path: resolve(
            output,
            `movement-${condition.viewport.width}x${condition.viewport.height}-dpr${condition.deviceScaleFactor}.png`,
          ),
        });
        console.log(JSON.stringify({ movement: true, ...condition, result }));
      }
      if (
        !benchmark &&
        !visualsOnly &&
        !spawnOnly &&
        !crowdOnly &&
        !navigationOnly &&
        !schedulerOnly &&
        !movementOnly
      ) {
        report.activeActionCase = condition;
        const result = await page.evaluate(() => window.probeCombatActions());
        assert.deepEqual(
          result.map((r) => `${r.projection}:${r.kind}`),
          ["orthographic:melee", "orthographic:dash", "perspective:melee", "perspective:dash"],
        );
        assert(
          result.every(
            (r) =>
              r.restored &&
              r.invalidPreserved &&
              r.paused &&
              r.timerExecuted &&
              r.frames > 4 &&
              r.errors.length === 0,
          ),
        );
        assert(result.filter((r) => r.kind === "dash").every((r) => r.renderedHeight));
        assert.deepEqual(errors, []);
        report.actionCases.push({ ...condition, result });
        delete report.activeActionCase;
        await page.screenshot({
          path: resolve(
            output,
            `actions-${condition.viewport.width}x${condition.viewport.height}-dpr${condition.deviceScaleFactor}.png`,
          ),
        });
        console.log(JSON.stringify({ actions: true, ...condition, result }));
      }
      if (
        !benchmark &&
        !visualsOnly &&
        !actionsOnly &&
        !inputOnly &&
        !crowdOnly &&
        !navigationOnly &&
        !schedulerOnly &&
        !movementOnly
      ) {
        report.activeSpawnCase = condition;
        const result = await page.evaluate(() => window.probeCombatSpawn());
        assert.deepEqual(
          result.map((r) => r.projection),
          ["orthographic", "perspective"],
        );
        assert(
          result.every(
            (r) =>
              r.restored &&
              r.invalidPreserved &&
              r.paused &&
              r.timerExecuted &&
              r.prototypeRemoved &&
              r.deadSourceRestored &&
              r.moved &&
              r.heightFrames > 2 &&
              r.shadowFrames > 2 &&
              r.resetClean &&
              r.frames > 4 &&
              r.errors.length === 0,
          ),
        );
        assert.deepEqual(errors, []);
        report.spawnCases.push({ ...condition, result });
        delete report.activeSpawnCase;
        await page.screenshot({
          path: resolve(
            output,
            `spawn-${condition.viewport.width}x${condition.viewport.height}-dpr${condition.deviceScaleFactor}.png`,
          ),
        });
        console.log(JSON.stringify({ spawn: true, ...condition, result }));
      }
      if (
        !benchmark &&
        !spawnOnly &&
        !actionsOnly &&
        !inputOnly &&
        !crowdOnly &&
        !navigationOnly &&
        !schedulerOnly &&
        !movementOnly
      ) {
        await page.setViewportSize(condition.viewport);
        report.activeVisualCase = condition;
        const result = await page.evaluate(() => window.probeCombatVisuals());
        assert.equal(result.length, 5);
        assert(
          result.every(
            (r) =>
              r.restored &&
              r.invalidPreserved &&
              r.paused &&
              r.resetClean &&
              r.pixelDifference === 0 &&
              r.remappedTexture === 3 &&
              (r.projection === "flat" || r.cameraChanged) &&
              r.checkedQuads > 4 &&
              r.frames > 4 &&
              r.errors.length === 0,
          ),
        );
        assert.deepEqual(errors, []);
        report.visualCases.push({ ...condition, glInfo, result });
        delete report.activeVisualCase;
        await page.screenshot({
          path: resolve(
            output,
            `visuals-${condition.viewport.width}x${condition.viewport.height}-dpr${condition.deviceScaleFactor}.png`,
          ),
        });
        console.log(JSON.stringify({ visuals: true, ...condition, result }));
      }
    } finally {
      await page.close();
    }
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error?.stack ?? error);
  throw error;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`HD-2D combat report: ${resolve(output, "report.json")}`);
}
