import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {chromium} from 'playwright-core';
import {loadExampleCatalog} from '../../scripts/validate/check-example-catalog.mjs';
import {smokeGuidedExample, smokePhysicsLabViewport, smokeStarterProfileReset} from './guided-examples-smoke.mjs';
import {smokeTopdownShowcase} from './topdown-showcase-smoke.mjs';
import {checkExampleLifecycles, checkPhysicsScenarioRequests} from './example-lifecycle-checks.mjs';

const catalog = loadExampleCatalog(), publicExamples = catalog.filter(item => item.kind !== 'reference');
const features = JSON.parse(await readFile('examples/shared/featureCatalog.json', 'utf8'));
const physicsTopics = JSON.parse(await readFile('examples/shared/physicsExamples.json', 'utf8'));
const topics = JSON.parse(await readFile('examples/shared/featureTopics.json', 'utf8'));
const totalExperiments = features.length + physicsTopics.length;
const parent = resolve('artifacts/example-suite'); await mkdir(parent, {recursive: true});
const run = await mkdtemp(resolve(parent, 'run-'));
await writeFile(resolve(parent, 'verification.json'), JSON.stringify({ok: false, status: 'running', run}));
const prefix = '/nested/engine-demo/', types = {'.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.mjs':'application/javascript', '.json':'application/json', '.png':'image/png', '.woff2':'font/woff2', '.wasm':'application/wasm', '.wav':'audio/wav'};
const server = createServer((req, res) => void (async () => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  const standalonePrefix = ['/standalone/', '/breakout/'].find(prefix => url.pathname.startsWith(prefix));
  const standalone = !!standalonePrefix;
  const referencePrefix = prefix + 'reference/minimal-game/';
  const reference = url.pathname.startsWith(referencePrefix);
  if (!standalone && !url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
  const root = resolve(reference ? 'examples/minimal-game/dist' : standalone ? 'examples/breakout/dist' : 'dist-pages');
  const relative = decodeURIComponent(url.pathname.slice(reference ? referencePrefix.length : standalone ? standalonePrefix.length : prefix.length));
  const path = resolve(root, relative.endsWith('/') || !relative ? relative + 'index.html' : relative);
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream'); res.end(await readFile(path));
})().catch(() => res.writeHead(404).end()));
let browser, activePage;
const results = [], errors = [];
function observe(page) {
  page.on('pageerror', error => errors.push(`${page.url()}: ${error.message}`));
  page.on('response', response => { if (!response.ok()) errors.push(`HTTP ${response.status()} ${response.url()}`); });
}
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('.demo-error-shell, .error-shell') ||
    (window.ferrumFeatureLab?.snapshot().nativeState === 1 && window.ferrumFeatureLab.snapshot().commands > 0) ||
    (window.ferrumPixelShowcase?.snapshot().entities > 0 && window.ferrumPixelShowcase.snapshot().commands > 0) ||
    (window.ferrumEnginePlayground?.snapshot().commands > 0) ||
    (window.ferrumEngine?.entityCount() > 0 && window.ferrumRuntime?.renderer.stats().renderCommandCount > 0));
  assert.equal(await page.locator('.demo-error-shell, .error-shell').count(), 0, await page.locator('body').innerText());
}
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`, base = origin + prefix;
  browser = await chromium.launch({headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--use-vulkan=swiftshader']});
  const page = await browser.newPage({viewport:{width:1440,height:1100}}); activePage = page; page.setDefaultTimeout(20000);
  observe(page);
  await page.goto(base);
  assert.equal(await page.locator('[data-feature-card]').count(), totalExperiments);
  assert.equal(await page.locator('[data-example-card]').count(), publicExamples.filter(item => item.kind === 'game' || item.kind === 'tool').length);
  assert.equal(await page.locator('a[href*="mode="], a[href*="minimal-game"]').count(), 0, 'reference demos must not appear in the public hub');
  const search = page.getByRole('searchbox', {name:'기능 예제 검색'});
  await search.fill('노멀'); assert.equal(await page.locator('[data-feature-card]:visible').count(), 1);
  await page.reload(); assert.equal(await search.inputValue(), '노멀');
  await search.fill('');
  for (const topic of topics) {
    await page.locator(`[data-feature-group="${topic.id}"]`).click();
    assert.equal(await page.locator('[data-feature-card]:visible').count(), features.filter(item => item.topic === topic.id).length + (topic.id === 'physics' ? physicsTopics.length : 0));
    assert.equal(await page.locator('[data-topic-section]:visible').count(), 1);
  }
  await page.locator('[data-feature-group="all"]').click();
  await page.locator('[data-feature-dimension]').selectOption('HD-2D');
  assert.equal(await page.locator('[data-feature-card]:visible').count(), features.filter(item => item.tags.includes('HD-2D')).length);
  await page.locator('[data-feature-dimension]').selectOption('all');
  await search.fill('없는기능xyz'); assert(await page.locator('[data-feature-empty]').isVisible());
  await search.fill(''); await page.locator('[data-feature-group="all"]').click();
  for (const width of [1440,390,320]) { await page.setViewportSize({width,height:1000}); assert.equal(await overflow(page), false, `hub overflow ${width}`); }
  await page.setViewportSize({width:1440,height:1100});
  await page.screenshot({path:resolve(run,'hub.png')});
  // Native links remain usable without the filter enhancement.
  const noJs = await browser.newPage({javaScriptEnabled:false}); observe(noJs); await noJs.goto(base);
  assert.equal(await noJs.locator('[data-feature-card]:visible').count(), totalExperiments); await noJs.close();

  for (const entry of publicExamples.filter(item => item.kind !== 'tool')) {
    console.log(`Example suite: ${entry.id}`);
    await page.goto(new URL(entry.path + '?preserveDrawingBuffer=true', base).href);
    await ready(page);
    const header = page.locator('.example-header'); assert.equal(await header.count(), 1);
    assert.equal(await header.getAttribute('data-example-id'), entry.id);
    const select = header.getByRole('combobox', {name:'예제 이동'});
    assert.equal(await select.locator('option').count(), publicExamples.length);
    assert.equal(await select.locator('option:checked').textContent(), entry.title);
    assert.equal(await select.locator('option[value*="mode="]').count(), 0);
    assert.equal(await header.locator('[data-example-home]').getAttribute('href'), base);
    await header.locator('summary').focus(); await page.keyboard.press('Enter');
    assert.match(await header.locator('details').innerText(), /직접 해보기[\s\S]*관찰할 결과/);
    assert.equal(await header.locator('.example-related a').count(), entry.features.length);
    await header.locator('summary').click();
    const theme = await header.evaluate(root => ({font:getComputedStyle(root).fontFamily, background:getComputedStyle(root.querySelector('select')).backgroundColor, radius:getComputedStyle(root.querySelector('select')).borderRadius}));
    assert.match(theme.font, /Ferrum Example UI/); assert.equal(theme.background, 'rgb(17, 24, 33)'); assert.equal(theme.radius, '2px');
    let controls;
    if (entry.id === 'breakout' || entry.id === 'platformer') controls = await smokeGuidedExample(page, entry.id);
    if (entry.id === 'platformer') {
      await page.locator('canvas').focus(); await page.keyboard.down('KeyD');
      assert.equal(await page.evaluate(() => window.ferrumRuntime.input.snapshot().d), true);
      await header.locator('summary').focus(); await page.keyboard.up('KeyD');
      assert.equal(await page.evaluate(() => window.ferrumRuntime.input.snapshot().d), false, 'release must reach game input after UI focus');
      await page.keyboard.press('Space');
      assert.equal(await header.locator('details').getAttribute('open'), '');
      assert.equal(await page.evaluate(() => window.ferrumRuntime.input.snapshot().space), false, 'UI activation must not jump');
      await page.keyboard.press('Space');
      assert.equal(await header.locator('details').getAttribute('open'), null);
    }
    if (entry.id === 'physics-sandbox') controls = await smokePhysicsLabViewport(page);
    if (entry.id === 'topdown-shooter') controls = await smokeTopdownShowcase(page, 20000);
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:1000}); await page.waitForTimeout(80);
      assert.equal(await overflow(page), false, `${entry.id} overflow ${width}`);
      if (width === 1440 && entry.id === 'pixel-art') await page.waitForFunction(() => window.ferrumPixelShowcase.snapshot().presentation.scale === 3);
      if (width === 1440 && (entry.id === 'breakout' || entry.id === 'platformer')) {
        const presentation = await page.evaluate(() => window.ferrumRuntime.renderer.pixelPerfectPresentation());
        assert.equal(presentation.canvasWidth, 800); assert.equal(presentation.width, 800);
      }
      const box = await select.boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= width);
      if (width !== 320) await page.screenshot({path:resolve(run,`${entry.id}-${width}.png`),fullPage:true});
    }
    const state = await page.evaluate(() => {
      const feature = window.ferrumFeatureLab?.snapshot(), pixel = window.ferrumPixelShowcase?.snapshot();
      if (feature) return {...feature, renderCommandCount:feature.commands};
      if (pixel) return {...pixel, renderCommandCount:pixel.commands};
      return {nativeState:window.ferrumEngine.gameState(), entities:window.ferrumEngine.entityCount(), ...window.ferrumRuntime.renderer.stats()};
    });
    assert(state.entities > 0 && state.entities <= 2500);
    assert(state.renderCommandCount > 0 && state.renderCommandCount <= 3000 && state.drawCalls > 0 && state.drawCalls <= 64);
    results.push({id:entry.id,theme,controls,widths:[1440,390,320],state});
    await page.setViewportSize({width:1440,height:1100});
  }
  await page.goto(base + 'starter-runtime/index.html?feature=lighting'); await ready(page);
  await page.getByRole('combobox',{name:'예제 이동'}).selectOption(new URL('platformer/',base).href);
  await page.waitForURL('**/platformer/'); await ready(page);
  assert.equal(await page.locator('.example-header').getAttribute('data-example-id'),'platformer');
  await page.goBack(); await ready(page);
  assert.equal(await page.getByRole('combobox',{name:'예제 이동'}).inputValue(), base + 'starter-runtime/');
  const highDpr = [];
  for (const id of ['breakout', 'platformer']) {
    const high = await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:2});
    observe(high);
    await high.goto(base + id + '/'); await ready(high);
    const presentation = await high.evaluate(() => window.ferrumRuntime.renderer.pixelPerfectPresentation());
    assert.equal(presentation.width, presentation.canvasWidth); assert.equal(presentation.height, presentation.canvasHeight);
    highDpr.push({id,presentation}); await high.close();
  }
  for (const mount of ['/standalone/', '/breakout/']) {
    await page.goto(origin + mount); await ready(page);
    assert.equal(await page.locator('.example-header a, .example-header select').count(),0,'standalone must not generate broken cross-app links, including matching folder names');
    await page.locator('.example-learning summary').click(); assert.match(await page.locator('.example-standalone').textContent(), /pnpm preview:examples/);
  }
  for (const entry of catalog.filter(item => item.id === 'engine-playground' || item.id === 'starter-profiles')) {
    await page.goto(new URL(entry.path, base).href); await ready(page);
    assert.match(await page.locator('.example-breadcrumb').textContent(), /참고·검증/);
    assert.equal(await page.locator('.example-header select option').count(), publicExamples.length + 1);
    if (entry.id === 'starter-profiles') await smokeStarterProfileReset(page);
  }
  assert.deepEqual(errors, []);
  console.log('Example suite: initialization/teardown and scenario requests');
  const lifecycles = await checkExampleLifecycles(browser, base);
  const scenarioRequests = await checkPhysicsScenarioRequests(browser, base);
  const report = {ok:true,run,hub:{features:features.length,topics:topics.length,physics:physicsTopics.length,totalExperiments,dimensions:true,search:true,keyboard:true,noJavaScript:true},results,highDpr,lifecycles,scenarioRequests,nestedPaths:true,standalone:true,standaloneMatchingFolder:true,historyNavigation:true,referenceRoutes:true,browser:browser.version()};
  await writeFile(resolve(run,'verification.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve(parent,'verification.json'),JSON.stringify(report,null,2)+'\n'); console.log(`Example suite passed: ${results.length} apps, hub search/navigation, reference routes, standalone and nested paths. ${run}`);
} catch (error) {
  await activePage?.screenshot({path:resolve(run,'failure.png'),fullPage:true}).catch(()=>{});
  const report = {ok:false,run,results,errors,error:String(error.stack??error)};
  await writeFile(resolve(parent,'verification.json'),JSON.stringify(report,null,2)+'\n'); throw error;
} finally { await browser?.close(); await new Promise(done=>server.close(done)); }
