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
const parent = resolve('artifacts/example-suite'); await mkdir(parent, {recursive: true});
const run = await mkdtemp(resolve(parent, 'run-'));
await writeFile(resolve(parent, 'verification.json'), JSON.stringify({ok: false, status: 'running', run}));
const prefix = '/nested/engine-demo/', types = {'.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.mjs':'application/javascript', '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png', '.woff2':'font/woff2', '.wasm':'application/wasm', '.wav':'audio/wav'};
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
  // The site entry is the example gallery rendered from the shared catalogs.
  await page.goto(base);
  const gallery = page.locator('[data-example-gallery]'); await gallery.waitFor();
  const galleryCards = publicExamples.filter(item => item.kind === 'game' || item.kind === 'tool').length + features.length + physicsTopics.length + 1;
  assert.equal(await gallery.locator('[data-gallery-card]').count(), galleryCards);
  await page.waitForFunction(() => [...document.images].every(image => image.complete));
  assert(await page.evaluate(() => [...document.images].every(image => image.naturalWidth > 0)), 'gallery thumbnails must load');
  for (const feature of features) assert.equal(await gallery.locator(`a[href="./starter-runtime/?feature=${feature.id}"]`).count(), 1, feature.id);
  for (const item of physicsTopics) assert.equal(await gallery.locator(`a[href="./physics-sandbox/?demo=${item.id}"] .badge.issue`).count(), item.knownIssue ? 1 : 0, item.id);
  await gallery.locator('[data-gallery-filter="topic:physics"]').click();
  assert.equal(await gallery.locator('[data-gallery-card]:visible').count(), features.filter(item => item.topic === 'physics').length);
  assert.match(page.url(), /group=topic%3Aphysics/);
  await gallery.locator('[data-gallery-filter="all"]').click();
  await page.keyboard.press('/'); await page.keyboard.type('충돌');
  const searched = await gallery.locator('[data-gallery-card]:visible').count();
  assert(searched > 0 && searched < galleryCards, `search must narrow the gallery: ${searched}`);
  await page.locator('[data-gallery-search] input').fill('');
  for (const width of [1440, 390, 320]) { await page.setViewportSize({width, height: 1000}); assert.equal(await overflow(page), false, `gallery overflow ${width}`); }
  await page.setViewportSize({width:1440,height:1100});
  await page.screenshot({path:resolve(run,'gallery.png')});
  // Cards are relative links that stay under the deployment prefix.
  await gallery.locator(`a[href="./starter-runtime/?feature=${features[0].id}"]`).click();
  await page.waitForURL(base+`starter-runtime/?feature=${features[0].id}`); await ready(page);
  assert.equal(await page.locator('.example-header [data-example-home]').getAttribute('href'), base);
  await page.goto(base+'starter-runtime/'); await ready(page);
  // Wide screens list topics beside the stage; opening a topic shows its experiments with thumbnails.
  for (const topic of topics) {
    const button = page.locator(`.example-sidebar button[data-topic="${topic.id}"]`);
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
    assert.equal(await button.getAttribute('aria-expanded'), 'true');
    const visible = page.locator(`.example-sidebar a[data-topic="${topic.id}"]:visible`);
    // The physics topic adds one row to the separate physics lab, marked as a new page.
    assert.equal(await visible.count(),features.filter(item=>item.topic===topic.id).length+(topic.id==='physics'?1:0));
    assert.equal(await page.locator('.example-sidebar a:visible').count(), await visible.count(), 'only one topic is open');
  }
  await page.waitForFunction(() => [...document.querySelectorAll('.example-sidebar a img')].filter(image => image.offsetParent).every(image => image.complete && image.naturalWidth > 0));
  const physicsLab = page.locator('.example-sidebar a.example-item-external');
  assert.equal(await physicsLab.getAttribute('href'), new URL('physics-sandbox/', base).href);
  assert.match(await physicsLab.innerText(), new RegExp(`시나리오 ${physicsTopics.length}개 · 새 화면`));
  // Keyboard focus walks the open topic and keeps the focused experiment inside the scrolled list.
  const topicLinks=page.locator('.example-sidebar a:visible');
  await topicLinks.first().focus();
  for(let i=1;i<await topicLinks.count();i++)await page.keyboard.press('Tab');
  assert(await topicLinks.last().evaluate(link=>document.activeElement===link),'Tab must reach the final example');
  assert(await topicLinks.last().evaluate(link=>{
    const r=link.getBoundingClientRect(),list=link.closest('.example-sidebar').getBoundingClientRect();
    return r.top>=list.top-1&&r.bottom<=list.bottom+1;
  }),'keyboard focus must reveal the focused example in the topic list');
  assert.equal(await overflow(page),false,'the topic list must not overflow the page');
  // Narrower screens keep the stage wide and switch to the compact picker.
  for (const width of [1024, 390]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.locator('.example-sidebar-list').isVisible(), false);
    assert.equal(await page.locator('.example-picker option').count(),features.length+1);
    assert.equal(await overflow(page),false,`picker overflow ${width}`);
  }
  await page.setViewportSize({width:1440,height:1100});
  // Previous and next follow the topic order across topic boundaries.
  const order = topics.flatMap(topic => features.filter(item => item.topic === topic.id));
  const position = order.findIndex(item => item.id === features[0].id);
  assert.equal(await page.locator('.example-pager a[rel=prev]').getAttribute('href'), new URL(`starter-runtime/?feature=${order[position - 1].id}`, base).href);
  assert.equal(await page.locator('.example-pager a[rel=next]').getAttribute('href'), new URL(`starter-runtime/?feature=${order[position + 1].id}`, base).href);
  await page.locator(`.example-sidebar button[data-topic="${features[0].topic}"]`).click();
  // Inside the suite the code view links the public API reference on this site.
  const apiDocs = await page.locator('#example-code-api a').getAttribute('href');
  assert.equal(apiDocs, new URL('docs/engine/public-api.html', base).href);
  assert.equal(await page.evaluate(async url => (await fetch(url)).status, apiDocs), 200);
  await page.screenshot({path:resolve(run,'entry.png')});
  // Without JavaScript every gallery card and link is present; only search stays hidden.
  const noJs = await browser.newPage({javaScriptEnabled:false}); observe(noJs); await noJs.goto(base);
  assert.equal(await noJs.locator('[data-gallery-card]').count(), galleryCards);
  assert.equal(await noJs.locator('[data-gallery-search]').isHidden(), true);
  await noJs.close();

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
    if (entry.parent) {
      // An app that extends a lab topic links back to that topic in the lab.
      const parentTitle = catalog.find(item => item.id === entry.parent.id).title;
      assert.equal((await header.locator('.example-breadcrumb').textContent()).trim(), `${parentTitle} › ${entry.parent.label}`);
      assert.equal(await header.locator('.example-breadcrumb a').getAttribute('href'), new URL(`${entry.parent.id}/?feature=${entry.parent.feature}`, base).href);
    } else assert.equal(await header.locator('.example-breadcrumb').count(),0);
    assert.equal(await header.locator('[data-example-docs]').getAttribute('href'),base+'docs/');
    assert.deepEqual(await select.locator('option').evaluateAll(options=>options.map(o=>o.value)),publicExamples.map(e=>new URL(e.path,base).href));
    await header.locator('summary').focus(); await page.keyboard.press('Enter');
    assert.match(await header.locator('details').innerText(), /직접 해보기[\s\S]*관찰할 결과/);
    assert.equal(await header.locator('.example-related a').count(), entry.features.length);
    await header.locator('summary').click();
    const theme = await header.evaluate(root => ({font:getComputedStyle(root).fontFamily, background:getComputedStyle(root.querySelector('select')).backgroundColor, radius:getComputedStyle(root.querySelector('select')).borderRadius}));
    assert.match(theme.font, /Ferrum Example UI/); assert.equal(theme.background, 'rgb(17, 24, 33)'); assert.equal(theme.radius, '2px');
    if (entry.kind === 'game') {
      // Game pages share the lab's frame: the games and this game's topics beside the stage,
      // a guide card leading the panel, then the code view and the previous/next game.
      const games = publicExamples.filter(item => item.kind === 'game'), index = games.indexOf(entry);
      const rows = page.locator('.example-sidebar .example-item-parent');
      assert.deepEqual(await rows.evaluateAll(links => links.map(link => link.href)), games.map(item => new URL(item.path, base).href));
      assert.equal(await page.locator('.example-item-parent[aria-current=page]').getAttribute('data-example'), entry.id);
      await page.waitForFunction(() => [...document.querySelectorAll('.example-sidebar img')].every(image => image.complete && image.naturalWidth > 0));
      const topicLinks = page.locator('.example-sidebar .example-subitem'), topicCount = await topicLinks.count();
      assert(topicCount >= 2, `${entry.id} lists its topics`);
      assert.equal(await page.locator('.example-subitem[aria-current]').count(), 1);
      assert.equal(await page.locator('.example-picker option').count(), topicCount);
      await topicLinks.last().click();
      const lastTopic = await topicLinks.last().getAttribute('data-topic');
      assert.equal(new URL(page.url()).searchParams.get('topic'), lastTopic);
      assert.equal(await page.locator('.example-intro h2').textContent(), await topicLinks.last().textContent());
      assert.equal(await page.locator('.example-picker select').inputValue(), lastTopic);
      await topicLinks.first().click();
      const tabs = await page.locator('.example-code [role=tab]').allTextContents();
      assert.deepEqual(tabs.slice(-2), ['API', '코드 위치']);
      if (tabs.length === 3) {
        // The data tab shows the exact file the game loads.
        await page.waitForFunction(() => document.querySelector('.example-code')?.dataset.dataLines);
        const file = JSON.parse(await readFile(await page.locator('.example-code-path').textContent(), 'utf8'));
        assert.deepEqual(JSON.parse(await page.locator('.example-code-json').textContent()), file);
      }
      assert.equal(await page.locator('#example-code-api a').getAttribute('href'), new URL('docs/engine/public-api.html', base).href);
      for (const [rel, other] of [['prev', games[index - 1]], ['next', games[index + 1]]]) {
        const link = page.locator(`.example-pager a[rel=${rel}]`);
        if (other) assert.equal(await link.getAttribute('href'), new URL(other.path, base).href); else assert.equal(await link.count(), 0);
      }
    }
    let controls;
    if (entry.id === 'breakout' || entry.id === 'platformer') controls = await smokeGuidedExample(page, entry.id);
    if (entry.id === 'physics-sandbox') {
      // The physics lab shares the frame too: scenarios beside the canvas, a scenario line over it,
      // the guide leading the panel, then the current Physics Spec and the previous/next scenario.
      const links = page.locator('.example-sidebar-list .example-item[data-scenario]');
      assert.deepEqual(await links.evaluateAll(items => items.map(item => item.dataset.scenario)), physicsTopics.map(item => item.id));
      assert.equal(await page.locator('.example-item-note[data-issue]').count(), physicsTopics.filter(item => item.knownIssue).length);
      await page.waitForFunction(() => [...document.querySelectorAll('.example-sidebar img')].every(image => image.complete && image.naturalWidth > 0));
      assert.equal(await page.locator('.example-picker option').count(), physicsTopics.length);
      assert.equal(await page.locator('.example-panel .example-guide .action-button').count() > 0, true);
      const initial = await page.evaluate(() => window.ferrumPhysicsSandboxSmokeFrame.demoId), target = physicsTopics.at(-1).id;
      const specPath = id => `examples/physics-sandbox/public/demos/${id}.physics.json`;
      const showsSpec = async id => {
        await page.waitForFunction(path => document.querySelector('.example-code-path')?.textContent === path && document.querySelector('.example-code')?.dataset.dataLines, specPath(id));
        assert.deepEqual(JSON.parse(await page.locator('.example-code-json').textContent()), JSON.parse(await readFile(specPath(id), 'utf8')));
      };
      await showsSpec(initial);
      assert.deepEqual(await page.locator('.example-code [role=tab]').allTextContents(), ['Physics Spec', 'API', '코드 위치']);
      assert.equal(await page.locator('#example-code-api a').getAttribute('href'), new URL('docs/engine/public-api.html', base).href);
      await page.locator(`.example-item[data-scenario="${target}"]`).click();
      await page.waitForFunction(id => window.ferrumPhysicsSandboxSmokeFrame?.demoId === id, target);
      assert.equal(new URL(page.url()).searchParams.get('demo'), target);
      assert.equal(await page.locator('.example-item[aria-current]').getAttribute('data-scenario'), target);
      assert.equal(await page.locator('.example-picker select').inputValue(), target);
      assert.equal(await page.locator('.example-intro h2').textContent(), physicsTopics.at(-1).title);
      await showsSpec(target);
      // The last scenario has no next link; previous switches in place.
      assert.equal(await page.locator('.example-pager a[rel=next]').isHidden(), true);
      const previous = physicsTopics.at(-2).id;
      assert.equal(await page.locator('.example-pager a[rel=prev]').getAttribute('data-scenario'), previous);
      await page.locator('.example-pager a[rel=prev]').click();
      await page.waitForFunction(id => window.ferrumPhysicsSandboxSmokeFrame?.demoId === id, previous);
      assert.equal(new URL(page.url()).searchParams.get('demo'), previous);
      // Later checks expect the scenario the page opened with.
      await page.locator(`.example-item[data-scenario="${initial}"]`).click();
      await page.waitForFunction(id => window.ferrumPhysicsSandboxSmokeFrame?.demoId === id, initial);
    }
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
    if (entry.id === 'pixel-art') {
      await page.setViewportSize({width:1600,height:1000});
      await page.waitForFunction(() => window.ferrumPixelShowcase.snapshot().presentation.scale === 3);
    }
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:1000}); await page.waitForTimeout(80);
      assert.equal(await overflow(page), false, `${entry.id} overflow ${width}`);
      // Beside the game list the garden keeps whole-number scaling: 2x at 1440px, 3x from 1520px.
      if (width === 1440 && entry.id === 'pixel-art') await page.waitForFunction(() => window.ferrumPixelShowcase.snapshot().presentation.scale === 2);
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
    assert.equal(await page.locator('.example-header a:not([data-example-source]), .example-header select').count(),0,'standalone must not generate broken cross-app links, including matching folder names');
    // The source link is absolute (GitHub), so it stays valid without the suite.
    assert.match(await page.locator('.example-header [data-example-source]').getAttribute('href'), /^https:\/\/github\.com\/silbaram\/ferrum2d\/tree\/main\/examples\/[a-z-]+$/);
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
  const report = {ok:true,run,navigation:{features:features.length,topics:topics.length,physics:physicsTopics.length,publicApps:publicExamples.length,galleryCards,galleryFilter:true,gallerySearch:true,noJavaScriptGallery:true,headerHome:true,gameFrame:true,physicsFrame:true},results,highDpr,lifecycles,scenarioRequests,nestedPaths:true,standalone:true,standaloneMatchingFolder:true,historyNavigation:true,referenceRoutes:true,browser:browser.version()};
  await writeFile(resolve(run,'verification.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve(parent,'verification.json'),JSON.stringify(report,null,2)+'\n'); console.log(`Example suite passed: ${results.length} apps, gallery entry and menu navigation, reference routes, standalone and nested paths. ${run}`);
} catch (error) {
  await activePage?.screenshot({path:resolve(run,'failure.png'),fullPage:true}).catch(()=>{});
  const report = {ok:false,run,results,errors,error:String(error.stack??error)};
  await writeFile(resolve(parent,'verification.json'),JSON.stringify(report,null,2)+'\n'); throw error;
} finally { await browser?.close(); await new Promise(done=>server.close(done)); }
