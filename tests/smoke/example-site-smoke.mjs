import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {chromium} from 'playwright-core';

// The example site shell on the built Pages artifact, served under a nested path like GitHub Pages
// (docs/planning/example-site-rebuild-plan.md). Run `pnpm build:pages` first; `pnpm smoke:example-site` does.
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
  const page = await browser.newPage({viewport: {width: 1440, height: 900}}); activePage = page; watch(page);
  await page.goto(base); await page.waitForSelector('.home');
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.fonts.check('13px "Ferrum Example UI"')), 'the bundled Korean font must load');
  assert.equal(await page.title(), 'Ferrum2D 예제');

  // Top bar: brand to the entry, the place, docs and source.
  assert.equal(await page.locator('.brand').getAttribute('href'), './');
  assert.equal(await page.locator('.crumbs .crumb').count(), 0, 'the brand names the first screen');
  const docs = await page.locator('.tb-link', {hasText: '문서'}).evaluate(a => a.href);
  assert.equal(docs, base + 'docs/'); assert.equal(await status(docs), 200);
  assert.equal(await page.locator('.tb-link', {hasText: 'GitHub'}).getAttribute('target'), '_blank');

  // Wide screens fit the window: the page itself does not scroll.
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true, 'the shell fits the window');
  assert.equal(await overflow(page), false);

  // List: four groups; examples arrive one at a time, tools link to their own apps.
  const groups = page.locator('.group-row');
  assert.deepEqual(await groups.locator('.t').allTextContents(), ['게임 데모', '기능 실험', '물리', '도구']);
  assert.deepEqual(await groups.locator('.n').allTextContents(), ['0', '0', '0', '2']);
  assert.equal(await page.locator('.empty-row').count(), 3);
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
  assert.equal(await page.locator('#group-games').isHidden(), true);
  await groups.first().click();

  // First screen without examples: say so and point to what works now.
  const empty = page.locator('.empty');
  assert.equal(await empty.locator('h2').textContent(), '예제를 하나씩 다시 만들고 있습니다.');
  assert.deepEqual(await empty.locator('.btn').allTextContents(), ['문서 열기', 'Studio 열기 (새 창)', '이전 예제 코드 (새 창)']);
  assert.equal(await empty.locator('.btn', {hasText: 'Studio 열기'}).getAttribute('target'), '_blank');
  assert.equal(await empty.locator('.btn', {hasText: '문서 열기'}).getAttribute('target'), null);
  assert.equal(await page.locator('.card', {hasText: 'Ferrum2D Studio'}).getAttribute('target'), '_blank');
  assert.match(await empty.locator('.btn', {hasText: '이전 예제 코드'}).getAttribute('href'), /^https:\/\/github\.com\/silbaram\/ferrum2d\/tree\/[0-9a-f]{40}\/examples$/);
  assert.match(await page.locator('.sb').textContent(), /예제 0/);
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
  await page.locator('.search input').fill('');
  assert.equal(await page.locator('.group-row').count(), 4);

  // An example that is not here yet.
  await page.goto(base + '?example=breakout'); await page.waitForSelector('.missing');
  assert.equal(await page.locator('.missing h1').textContent(), '예제를 찾을 수 없습니다.');
  assert.deepEqual(await page.locator('.crumbs .crumb').allTextContents(), ['예제', 'breakout']);
  await page.locator('.missing .btn').click(); await page.waitForSelector('.home');
  assert.equal(page.url(), base);

  // Former example addresses lead to the site.
  for (const route of formerRoutes) {
    await page.goto(base + route + '/');
    await page.waitForURL(base); await page.waitForSelector('.home');
  }

  // Narrow screens: the page scrolls and the list is a drawer.
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({width, height: 844}); await page.goto(base); await page.waitForSelector('.home');
    assert.equal(await overflow(page), false, `overflow at ${width}`);
    if (width === 1024) { assert.equal(await page.locator('.browser').isVisible(), true); continue; }
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
  const report = {ok: true, run, base, groups: 4, formerRoutes: formerRoutes.length, widths: [1440, 1024, 390, 320], browser: browser.version()};
  await writeFile(resolve(run, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(parent, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Example site passed: shell, list, search, missing example, ${formerRoutes.length} former routes, drawer. ${run}`);
} catch (error) {
  await activePage?.screenshot({path: resolve(run, 'failure.png'), fullPage: true}).catch(() => {});
  throw error;
} finally {
  await browser.close(); server.close();
}
