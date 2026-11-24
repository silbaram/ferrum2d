import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {chromium} from 'playwright-core';

// The example site on the built Pages artifact, served under a nested path like GitHub Pages
// (docs/planning/example-site-rebuild-plan.md): the shell, then each example's screen, controls and lifecycle.
// Run `pnpm build:pages` first; `pnpm smoke:example-site` does.
const root = resolve('dist-pages'), prefix = '/ferrum2d/';
const formerRoutes = ['starter-runtime', 'physics-sandbox', 'breakout', 'platformer', 'topdown-shooter', 'pixel-art'];
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm'};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
  let file = resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  if (url.pathname.endsWith('/')) file = resolve(file, 'index.html');
  try { const body = await readFile(file); res.writeHead(200, {'content-type': types[extname(file)] ?? 'application/octet-stream'}).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
const parent = resolve('artifacts/example-site');
await mkdir(parent, {recursive: true});
const run = await mkdtemp(resolve(parent, 'run-'));
const browser = await chromium.launch();
// Every WebGL2 context a page creates and every draw it issues, so a test can see that leaving an example
// released its context and stopped its frame loop.
const trackContexts = () => {
  const contexts = window.__webgl2Contexts = [];
  window.__draws = 0;
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = getContext.call(this, type, ...rest);
    if (type === 'webgl2' && context && !contexts.includes(context)) contexts.push(context);
    return context;
  };
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
    const draw = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...args) { window.__draws++; return draw.apply(this, args); };
  }
};
const liveContexts = page => page.evaluate(() => window.__webgl2Contexts.filter(context => !context.isContextLost()).length);
/** Leaving released the WebGL2 context and no frame draws afterwards. */
async function released(page, label) {
  assert.equal(await liveContexts(page), 0, `${label}: the WebGL2 context is released`);
  const draws = await page.evaluate(() => window.__draws);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__draws), draws, `${label}: the frame loop stopped`);
}
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(`${page.url()}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${page.url()}: ${message.text()}`); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
};
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const status = async url => (await fetch(url)).status;
let activePage;
try {
  const page = await browser.newPage({locale: 'ko-KR', viewport: {width: 1440, height: 900}}); activePage = page; watch(page);
  await page.addInitScript(trackContexts);
  await page.goto(base); await page.waitForSelector('.home');
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.fonts.check('13px "Ferrum Example UI"')), 'the bundled Korean font must load');
  assert.equal(await page.title(), 'Ferrum2D 예제');
  assert.equal(await page.locator('html').getAttribute('lang'), 'ko');
  const language = page.locator('.tb-language');
  assert.equal(await language.inputValue(), 'ko');
  assert.deepEqual(await language.locator('option').allTextContents(), ['한국어', 'English']);

  // Top bar: brand to the entry, the place, docs and source.
  assert.equal(await page.locator('.brand').getAttribute('href'), './');
  assert.equal(await page.locator('.crumbs .crumb').count(), 0, 'the brand names the first screen');
  const docs = await page.locator('.tb-link', {hasText: '문서'}).evaluate(a => a.href);
  assert.equal(docs, base + 'docs/'); assert.equal(await status(docs), 200);
  assert.equal(await page.locator('.tb-link', {hasText: 'GitHub'}).getAttribute('target'), '_blank');

  // Wide screens fit the window: the page itself does not scroll.
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, 'the shell fits the window');
  assert.equal(await overflow(page), false);

  // List: the essential-feature groups, then games and tools. Examples arrive one at a time.
  const groups = page.locator('.group-row');
  assert.deepEqual(await groups.locator('.t').allTextContents(), ['그리기', '움직임과 화면', '충돌과 물리', '효과와 소리', '게임 구성', '게임 데모', '도구']);
  assert.deepEqual(await groups.locator('.n').allTextContents(), ['1', '0', '1', '0', '0', '0', '2']);
  assert.equal(await page.locator('.empty-row').count(), 4);
  // Tools are their own apps: they open in a new window and say so.
  const studioRow = page.getByRole('link', {name: 'Ferrum2D Studio (새 창)', exact: true});
  const studio = await studioRow.evaluate(a => a.href);
  assert.equal(studio, base + 'studio/'); assert.equal(await status(studio), 200);
  for (const row of [studioRow, page.getByRole('link', {name: '코드 레시피 · Data Scene (새 창)', exact: true})]) {
    assert.equal(await row.getAttribute('target'), '_blank');
    assert.equal(await row.locator('svg.ext').count(), 1);
  }
  await groups.first().click();
  assert.equal(await groups.first().getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#group-drawing').isHidden(), true);
  await groups.first().click();

  // First screen: cards per group, and one quiet line while examples arrive.
  assert.equal(await page.locator('.empty').count(), 0);
  assert.deepEqual(await page.locator('.home-group h2').allTextContents(), ['그리기', '충돌과 물리', '도구']);
  const spriteCard = page.locator('.card', {hasText: '스프라이트 그리기'});
  assert.equal(await spriteCard.getAttribute('href'), '?example=sprite');
  assert.equal(await spriteCard.getAttribute('target'), null);
  assert.equal(await spriteCard.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true, 'the example thumbnail loads');
  assert.equal(await page.locator('.card', {hasText: 'Ferrum2D Studio'}).getAttribute('target'), '_blank');
  assert.match(await page.locator('.home-note a').getAttribute('href'), /^https:\/\/github\.com\/silbaram\/ferrum2d\/tree\/[0-9a-f]{40}\/examples$/);
  assert.match(await page.locator('.sb').textContent(), /예제 2/);
  await page.screenshot({path: resolve(run, 'home-1440.png')});

  // Search filters the list and the first screen; "/" focuses it.
  await page.locator('.main').click({position: {x: 600, y: 600}});
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '예제 검색');
  await page.keyboard.type('studio');
  assert.deepEqual(await page.locator('.item-row .t').allTextContents(), ['Ferrum2D Studio']);
  assert.deepEqual(await page.locator('.card b').allTextContents(), ['Ferrum2D Studio']);
  await page.locator('.search input').fill('없는 예제 이름');
  assert.equal(await page.locator('.tree-empty').textContent(), '찾는 예제가 없습니다.');
  assert.equal(await page.locator('.home-none').textContent(), '찾는 예제가 없습니다.');
  await page.locator('.search input').fill('스프라이트');
  assert.deepEqual(await page.locator('.item-row .t').allTextContents(), ['스프라이트 그리기']);
  await page.locator('.search input').fill('drawing a sprite');
  assert.deepEqual(await page.locator('.card b').allTextContents(), ['스프라이트 그리기']);
  await page.locator('.search input').fill('');
  assert.equal(await page.locator('.group-row').count(), 7);

  // A fresh English browser opens the English home. A manual choice beats the browser on reload.
  const english = await browser.newPage({locale: 'en-US'}); activePage = english; watch(english);
  await english.goto(base); await english.waitForSelector('.home');
  assert.equal(await english.locator('html').getAttribute('lang'), 'en');
  assert.equal(await english.title(), 'Ferrum2D Examples');
  assert.equal(await english.locator('.home h1').textContent(), 'Ferrum2D Examples');
  const englishDocs = await english.getByRole('link', {name: 'Docs', exact: true}).evaluate(a => a.href);
  assert.equal(englishDocs, base + 'docs/en/'); assert.equal(await status(englishDocs), 200);
  await english.getByRole('searchbox', {name: 'Search Examples'}).fill('스프라이트');
  assert.deepEqual(await english.locator('.card b').allTextContents(), ['Drawing a Sprite']);
  await english.getByRole('combobox', {name: 'Language'}).selectOption('ko');
  assert.deepEqual(await english.locator('.card b').allTextContents(), ['스프라이트 그리기']);
  await english.reload(); await english.waitForSelector('.home');
  assert.equal(await english.locator('html').getAttribute('lang'), 'ko');
  assert.equal(await english.getByRole('combobox', {name: '언어'}).inputValue(), 'ko');
  await english.close(); activePage = page;

  // An example that is not here yet.
  await page.goto(base + '?example=breakout'); await page.waitForSelector('.missing');
  assert.equal(await page.locator('.missing h1').textContent(), '예제를 찾을 수 없습니다.');
  assert.deepEqual(await page.locator('.crumbs .crumb').allTextContents(), ['예제', 'breakout']);
  await page.locator('.missing .btn').click(); await page.waitForSelector('.home');
  assert.equal(page.url(), base);

  // Sprite drawing: opened from its card inside the site, without reloading the page.
  await page.evaluate(() => { window.__sameDocument = true; });
  await page.locator('.card', {hasText: '스프라이트 그리기'}).click();
  await page.waitForURL(base + '?example=sprite');
  await page.waitForSelector('.dot[data-state=running]', {timeout: 30000});
  assert.equal(await page.evaluate(() => window.__sameDocument), true, 'moving to an example keeps the page');
  assert.equal(await page.title(), '스프라이트 그리기 · Ferrum2D 예제');
  assert.deepEqual(await page.locator('.crumbs .crumb').allTextContents(), ['예제', '그리기', '스프라이트 그리기']);
  assert.equal(await page.locator('.item-row[aria-current=page] .t').textContent(), '스프라이트 그리기');
  assert.equal(await page.locator('.insp-name').textContent(), '스프라이트 그리기');
  assert.deepEqual(await page.locator('.field-k').allTextContents(), ['위치 X', '위치 Y', '회전', '크기', '기준점', '색', '불투명도', '처음 자리']);
  assert.equal(await page.locator('.observe li').count(), 3);
  assert.equal(await page.getByRole('button', {name: '이전 예제 없음'}).isDisabled(), true);
  // The canvas keeps the world's 5:3 ratio and the status bar shows engine numbers.
  const stage = await page.locator('.stage').boundingBox();
  assert(Math.abs(stage.width / stage.height - 640 / 384) < 0.02, `canvas ratio ${stage.width}x${stage.height}`);
  await page.waitForFunction(() => /오브젝트 3/.test(document.querySelector('.sb').textContent));
  assert.match(await page.locator('.sb').textContent(), /WebGL2.*FPS.*오브젝트 3.*그리기 명령 11.*드로우 콜 2.*텍스처 \d+/);
  assert.equal(await page.locator('.dock-panel').isHidden(), true, 'the dock starts closed');
  assert.equal(await overflow(page), false);
  await page.screenshot({path: resolve(run, 'sprite-1440.png')});

  // Settings change the picture and the scene document; the canvas drags the robot.
  const picture = () => page.locator('.stage').screenshot();
  const before = await picture();
  const setNumber = async (label, value) => { const field = page.getByLabel(`${label} 값`); await field.fill(String(value)); await field.press('Enter'); };
  await setNumber('회전', 30);
  await page.getByRole('button', {name: '발밑'}).click();
  await page.getByRole('button', {name: '빨강'}).click();
  await setNumber('불투명도', 60);
  await page.getByRole('tab', {name: '씬 파일'}).click();
  await page.waitForFunction(() => /"rotationRadians": 0\.5236/.test(document.querySelector('.dock-panel').textContent));
  const marked = await page.locator('.dock-panel .ln.hl').allTextContents();
  assert(marked.some(line => line.includes('"id": "robot"')) && marked.some(line => line.includes('"tint": "#ff8a8099"')) && marked.some(line => line.includes('"originY": 1')), 'the scene tab marks the edited robot');
  assert.notDeepEqual(await picture(), before, 'the settings change the picture');
  const pivot = await page.locator('.pivot').boundingBox();
  await page.mouse.move(pivot.x, pivot.y - 60); await page.mouse.down();
  await page.mouse.move(pivot.x - 160, pivot.y - 40, {steps: 6}); await page.mouse.up();
  const position = await page.getByLabel('위치 X 값').inputValue();
  assert(Number(position) < 320, 'dragging moves the robot');

  // Translate the active example without replacing the live canvas or touching edited scene data.
  const canvas = await page.locator('.ex-canvas').elementHandle();
  await page.waitForFunction(x => [...document.querySelectorAll('.dock-panel .ln.hl')]
    .some(line => line.textContent.trim() === `"x": ${x},`), position);
  const sceneJson = await page.locator('.dock-scene pre').textContent();
  const draws = await page.evaluate(() => window.__draws);
  await language.selectOption('en');
  assert.equal(page.url(), base + '?example=sprite');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.title(), 'Drawing a Sprite · Ferrum2D Examples');
  assert.equal(await canvas.evaluate(node => node === document.querySelector('.ex-canvas')), true);
  assert.equal(await liveContexts(page), 1);
  await page.waitForFunction(previous => window.__draws > previous, draws);
  assert.equal(await page.getByRole('combobox', {name: 'Renderer'}).inputValue(), 'webgl2');
  assert.equal(await page.getByLabel('Position X Value').inputValue(), position);
  assert.equal(await page.getByLabel('Rotation Value').inputValue(), '30');
  assert.equal(await page.getByRole('button', {name: 'Red'}).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('tab', {name: 'Scene File'}).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.dock-scene pre').textContent(), sceneJson);
  assert.equal(await page.getByRole('button', {name: 'Copy', exact: true}).isVisible(), true);
  assert.match(await page.locator('.sb').textContent(), /WebGL2.*Entities 3.*Draw Commands 11.*Draw Calls 2/);
  await page.getByRole('tab', {name: 'About', exact: true}).click();
  assert.match(await page.locator('.dock-text').textContent(), /When to Use It.*drag the robot in the live view/);
  await page.screenshot({path: resolve(run, 'sprite-en-1440.png')});
  await page.getByRole('tab', {name: 'API', exact: true}).click();
  assert.match(await page.locator('.dock-api').textContent(), /AssetLoader\.loadAssetsLoads the robot sprite sheet/);
  await page.getByRole('tab', {name: 'Source', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('.dock-source pre')?.textContent.includes('export default async function start'));
  assert.equal(await page.getByRole('link', {name: /scene\.json \(opens in a new window\)/}).count(), 1);
  await page.getByRole('tab', {name: 'Engine', exact: true}).click();
  assert.match(await page.locator('.dock-engine').textContent(), /StatusRunning.*RendererWebGL2.*World640 × 384/);
  await language.selectOption('ko');
  assert.equal(await page.getByRole('tab', {name: '엔진'}).getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('.dock-engine').textContent(), /상태실행 중.*렌더러WebGL2.*월드640 × 384/);
  await page.screenshot({path: resolve(run, 'sprite-changed-1440.png')});
  await page.getByRole('button', {name: '처음 값으로'}).click();
  await page.waitForTimeout(100);
  assert.deepEqual(await Promise.all(['위치 X', '회전', '불투명도'].map(label => page.getByLabel(`${label} 값`).inputValue())), ['320', '0', '100']);
  assert.equal(await page.getByRole('button', {name: '가운데'}).getAttribute('aria-pressed'), 'true');
  await page.getByRole('tab', {name: '엔진'}).click();
  assert.equal(await page.locator('.dock-panel').isHidden(), true, 'the chosen tab closes the dock again');

  // Panels: each splitter resizes in 8px steps (drag, arrow keys, double-click for the starting size), the list
  // and the inspector fold to icon rails, and both stay that way after a reload.
  const widthOf = async selector => (await page.locator(selector).boundingBox()).width;
  const dragBy = async (splitter, dx, dy) => {
    const line = await splitter.boundingBox();
    const x = line.x + line.width / 2, y = line.y + line.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, {steps: 5}); await page.mouse.up();
  };
  await page.getByRole('tab', {name: '설명'}).click();
  const dockSplitter = page.getByRole('separator', {name: '아래 패널 높이'});
  await dragBy(dockSplitter, 0, -101);
  assert.equal((await page.locator('.dock-panel').boundingBox()).height, 344, 'dragging the dock line up grows the dock in 8px steps');
  await dockSplitter.press('ArrowUp');
  assert.equal(await dockSplitter.getAttribute('aria-valuenow'), '352');
  await dockSplitter.dblclick();
  assert.equal((await page.locator('.dock-panel').boundingBox()).height, 240);
  await page.getByRole('tab', {name: '설명'}).click();
  const roomy = await widthOf('.stage');
  const inspectorSplitter = page.getByRole('separator', {name: '인스펙터 너비'});
  await dragBy(inspectorSplitter, -61, 0);
  assert.equal(await widthOf('.inspector'), 376, 'dragging the inspector line left widens it');
  assert(await widthOf('.stage') < roomy, 'a wider inspector leaves the canvas less room');
  await page.getByRole('button', {name: '인스펙터 접기'}).click();
  assert.equal(await widthOf('.inspector'), 36);
  assert.equal(await page.locator('.insp-body').isHidden(), true);
  assert(await widthOf('.stage') > roomy, 'a folded inspector gives the canvas its room');
  await dragBy(page.getByRole('separator', {name: '예제 목록 너비'}), 40, 0);
  assert.equal(await widthOf('.browser'), 304);
  await page.getByRole('button', {name: '예제 목록 접기'}).click();
  assert.equal(await widthOf('.browser'), 36);
  assert.equal(await page.locator('#site-tree').isHidden(), true);
  await page.screenshot({path: resolve(run, 'sprite-folded-1440.png')});
  await page.reload(); await page.waitForSelector('.dot[data-state=running]', {timeout: 30000});
  assert.deepEqual([await widthOf('.browser'), await widthOf('.inspector')], [36, 36], 'folded panels stay folded after a reload');
  // A rail icon opens its panel at that part.
  await page.getByRole('button', {name: '볼 것'}).click();
  assert.equal(await widthOf('.inspector'), 376, 'the inspector opens at its kept width');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-controls')), 'sec-observe');
  await page.getByRole('button', {name: '그리기', exact: true}).click();
  assert.equal(await widthOf('.browser'), 304);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-controls')), 'group-drawing');
  await inspectorSplitter.focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await widthOf('.inspector'), 384, 'the arrow key away from the inspector widens it');
  await inspectorSplitter.dblclick(); await page.getByRole('separator', {name: '예제 목록 너비'}).dblclick();
  assert.deepEqual([await widthOf('.browser'), await widthOf('.inspector')], [264, 312], 'double-click returns to the starting widths');

  // Another renderer restarts the example on a new canvas.
  const webgpu = page.locator('.pb-select option[value=webgpu]');
  let rendererSwitch = 'unavailable';
  if (!await webgpu.isDisabled()) {
    const first = await page.locator('.ex-canvas').elementHandle();
    await page.locator('.pb-select').selectOption('webgpu');
    await page.waitForURL(base + '?example=sprite&renderer=webgpu');
    await page.waitForSelector('.dot[data-state=running], .dot[data-state=error]', {timeout: 30000});
    assert.equal(await page.locator('.dot').getAttribute('data-state'), 'running');
    assert.equal(await first.evaluate(canvas => canvas.isConnected), false, 'a renderer switch uses a new canvas');
    await page.waitForFunction(() => /FPS/.test(document.querySelector('.sb').textContent));
    rendererSwitch = (await page.locator('.sb').textContent()).match(/WebGPU|WebGL2/)[0];
    await page.locator('.pb-select').selectOption('webgl2');
    await page.waitForURL(base + '?example=sprite');
    await page.waitForSelector('.dot[data-state=running]', {timeout: 30000});
  }

  // Leaving releases the renderer; so does leaving while the example is still starting.
  await page.goBack(); await page.waitForSelector('.home');
  assert.equal(page.url(), base);
  await released(page, 'leaving an example');
  assert.match(await page.locator('.sb').textContent(), /예제 2/);
  await page.goForward(); await page.waitForSelector('.dot[data-state=running]', {timeout: 30000});
  for (const wait of [0, 50, 250]) {
    await page.locator('.brand').click(); await page.waitForSelector('.home');
    await page.locator('.item-row', {hasText: '스프라이트 그리기'}).click();
    await page.waitForTimeout(wait);
    await page.locator('.brand').click(); await page.waitForSelector('.home');
    await page.waitForTimeout(1500);
    await released(page, `leaving ${wait}ms into startup`);
  }

  // Collisions and triggers: opened with the sprite example's "next" button. The robot moves by key; walls
  // block it, triggers report, the engine collects energy, and the "표시" menu and "이벤트" tab come from this example.
  await page.locator('.item-row', {hasText: '스프라이트 그리기'}).click();
  await page.waitForSelector('.dot[data-state=running]', {timeout: 30000});
  await page.getByRole('button', {name: '다음 예제: 충돌과 트리거'}).click();
  await page.waitForURL(base + '?example=collision');
  await page.waitForSelector('.dot[data-state=running]', {timeout: 30000});
  assert.deepEqual(await page.locator('.crumbs .crumb').allTextContents(), ['예제', '충돌과 물리', '충돌과 트리거']);
  assert.deepEqual(await page.getByRole('tab').allTextContents(), ['설명', '이벤트', '씬 파일', 'API', '소스', '엔진']);
  assert.deepEqual(await page.locator('.field-k').allTextContents(), ['속도', '로봇 모양', '안쪽 벽']);
  await page.waitForFunction(() => /접촉 0.*트리거 0.*에너지 0 \/ 3/.test(document.querySelector('.sb').textContent));
  await page.getByRole('tab', {name: /^이벤트/}).click();
  const logged = text => page.waitForFunction(line => [...document.querySelectorAll('.event-log tbody tr')]
    .some(row => row.textContent.replace(/^[\d.]+/, '') === line), text, {timeout: 15000});
  /** Holds a movement key until the event log shows the line. */
  const walkUntil = async (key, line) => { await page.keyboard.down(key); try { await logged(line); } finally { await page.keyboard.up(key); } };
  await page.evaluate(() => document.activeElement?.blur());
  // The status bar refreshes a few times a second, so wait for it.
  const statusShows = pattern => page.waitForFunction(source => new RegExp(source).test(document.querySelector('.sb').textContent), pattern.source);
  await walkUntil('ArrowUp', '에너지 수집robot ← energy_1');
  await statusShows(/에너지 1 \/ 3/);
  await walkUntil('ArrowUp', '접촉 시작robot ↔ wall_north');
  await statusShows(/접촉 1/);
  await walkUntil('ArrowRight', '트리거 들어감robot ↔ zone');
  assert.equal(await page.locator('.zone-mark').getAttribute('data-inside'), 'true');
  await walkUntil('ArrowDown', '트리거 나감robot ↔ zone');
  assert.equal(await page.locator('.zone-mark').getAttribute('data-inside'), 'false');
  // The inner wall blocks while solid and lets the robot through as a trigger, from the same place.
  await walkUntil('ArrowLeft', '접촉 시작robot ↔ inner_b');
  await page.getByRole('button', {name: '트리거', exact: true}).click();
  await page.getByRole('tab', {name: '씬 파일'}).click();
  // Only the inner walls turn see-through, so this tint marks the new document.
  await page.waitForFunction(() => document.querySelector('.dock-panel')?.textContent.includes('"tint": "#ffffff59"'));
  await page.getByRole('tab', {name: /^이벤트/}).click();
  await page.evaluate(() => document.activeElement?.blur());
  await walkUntil('ArrowLeft', '트리거 나감robot ↔ inner_b');
  assert.match(await page.locator('.event-log').textContent(), /트리거 들어감robot ↔ inner_b/);
  assert(Number(await page.locator('.dock-count').textContent()) >= 8, 'the events tab counts the lines');
  // "표시": the engine's collision lines go away and come back.
  const display = page.getByRole('button', {name: '표시'});
  await display.click();
  assert.deepEqual(await page.getByRole('menuitemcheckbox').evaluateAll(items => items.map(item => `${item.textContent}:${item.getAttribute('aria-checked')}`)),
    ['충돌 모양:true', '접촉:false']);
  const lines = await page.locator('.stage').screenshot();
  await page.getByRole('menuitemcheckbox', {name: '충돌 모양'}).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('pb-menu-btn')), true, 'Escape returns to the menu button');
  await page.waitForTimeout(100);
  assert.notDeepEqual(await page.locator('.stage').screenshot(), lines, 'turning off collision shapes changes the picture');
  await page.screenshot({path: resolve(run, 'collision-1440.png')});
  await page.getByRole('button', {name: '처음 값으로'}).click();
  await page.waitForFunction(() => /에너지 0 \/ 3/.test(document.querySelector('.sb').textContent));
  assert.equal(await page.getByRole('button', {name: '단단함'}).getAttribute('aria-pressed'), 'true');
  await page.locator('.brand').click(); await page.waitForSelector('.home');
  await released(page, 'leaving the collision example');

  // Former example addresses lead to the site.
  for (const route of formerRoutes) {
    await page.goto(base + route + '/');
    await page.waitForURL(base); await page.waitForSelector('.home');
  }

  // Narrow screens: the page scrolls and the list is a drawer.
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({width, height: 844}); await page.goto(base); await page.waitForSelector('.home');
    assert.equal(await overflow(page), false, `overflow at ${width}`);
    if (width === 1024) { assert.equal(await page.locator('.browser').isVisible(), true); }
    // The example screen: run first, then what to try and look at, then the dock.
    await page.goto(base + '?example=sprite'); await page.waitForSelector('.dot[data-state=running]', {timeout: 30000});
    assert.equal(await overflow(page), false, `example overflow at ${width}`);
    // Folding is for wide screens: fold the inspector here, and narrow screens still show all of it.
    if (width === 1024) await page.getByRole('button', {name: '인스펙터 접기'}).click();
    if (width < 900) {
      const top = async selector => (await page.locator(selector).boundingBox()).y;
      assert(await top('.viewport') < await top('.inspector') && await top('.inspector') < await top('.dock'), `example order at ${width}`);
      assert.equal(await page.locator('.insp-body').isVisible(), true, `the inspector is whole at ${width}`);
      assert.equal(await page.locator('.splitter:visible, .panel-toggle:visible').count(), 0, `no splitters or fold buttons at ${width}`);
    }
    await page.screenshot({path: resolve(run, `sprite-${width}.png`), fullPage: true});
    if (width === 320) {
      await language.selectOption('en');
      const bounds = await language.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'the language selector fits at 320px');
      assert((await page.getByRole('searchbox', {name: 'Search Examples'}).boundingBox()).width >= 64, 'search has room at 320px');
      await page.getByRole('tab', {name: 'About', exact: true}).click();
      assert.equal(await overflow(page), false, 'the English example fits at 320px');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({path: resolve(run, 'sprite-en-320.png'), fullPage: true});
      await language.selectOption('ko');
    }
    await page.goto(base); await page.waitForSelector('.home');
    if (width === 1024) continue;
    const menu = page.locator('.tb-menu');
    assert.equal(await menu.isVisible(), true); assert.equal(await page.locator('.browser').isVisible(), false);
    await menu.click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'true');
    await page.locator('.browser').waitFor({state: 'visible'});
    assert(await page.evaluate(() => document.activeElement?.closest('.browser') !== null), 'the drawer takes focus');
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    assert(await page.evaluate(() => document.activeElement?.classList.contains('tb-menu')), 'focus returns to the menu button');
    // Outside the drawer (at most 300px wide), the scrim closes it.
    await menu.click(); await page.locator('.scrim').click({position: {x: width - 8, y: 400}});
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    await page.screenshot({path: resolve(run, `home-${width}.png`), fullPage: true});
  }

  assert.deepEqual(errors, []);
  const report = {ok: true, run, base, groups: 7, examples: ['sprite', 'collision'], locales: ['ko', 'en'], rendererSwitch, formerRoutes: formerRoutes.length, widths: [1440, 1024, 390, 320], browser: browser.version()};
  await writeFile(resolve(run, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(parent, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Example site passed: shell, list, bilingual search, language selection, sprite example (controls, drag, scene, reset, panels, renderer ${rendererSwitch}, release), collision example (blocking, triggers, pickup, events, display menu), missing example, ${formerRoutes.length} former routes, drawer. ${run}`);
} catch (error) {
  await activePage?.screenshot({path: resolve(run, 'failure.png'), fullPage: true}).catch(() => {});
  throw error;
} finally {
  await browser.close(); server.close();
}
