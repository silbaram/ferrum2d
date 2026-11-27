import assert from 'node:assert/strict';
import {access, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

// The Pages artifact: the example site at the root, Studio beside it, the docs site, and the former
// example routes as redirects to the site (docs/planning/example-site-rebuild-plan.md).
const builder = resolve('scripts/build/build-pages.mjs');
const formerRoutes = ['starter-runtime', 'physics-sandbox', 'breakout', 'platformer', 'topdown-shooter', 'pixel-art'];
const siteHtml = '<!doctype html><html><head><title>Ferrum2D 예제</title></head><body><div id="app"></div></body></html>';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ferrum-pages-build-'));
  const put = async (path, data) => { await mkdir(dirname(join(root, path)), {recursive: true}); await writeFile(join(root, path), data); };
  await put('examples/site/dist/index.html', siteHtml);
  await put('examples/site/dist/assets/site.js', 'site script');
  await put('apps/studio/dist/index.html', '<!doctype html><html><head><title>Studio</title></head><body></body></html>');
  await put('docs/README.md', '# Fixture docs\n');
  await put('apps/studio/public/fonts/notice.txt', 'Fixture notice');
  await put('apps/studio/src/fonts/NotoSansKR-UI.woff2', 'Fixture font');
  await put('dist-pages/previous-build.txt', 'last successful build');
  return root;
}
const build = root => spawnSync(process.execPath, [builder], {cwd: root, encoding: 'utf8', timeout: 15000});
async function keepsPrevious(root, result, message) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
  assert.equal(await readFile(join(root, 'dist-pages/previous-build.txt'), 'utf8'), 'last successful build');
}

for (const [name, path] of [['site', 'examples/site/dist/index.html'], ['Studio', 'apps/studio/dist/index.html']]) {
  test(`a missing ${name} build preserves the previous Pages artifact`, async () => {
    const root = await fixture();
    try {
      await rm(join(root, path));
      await keepsPrevious(root, build(root), new RegExp(`Missing ${path.replaceAll('/', '\\/').replaceAll('.', '\\.')}`));
    } finally { await rm(root, {recursive: true, force: true}); }
  });
}

test('a site build without a head fails before replacing the previous Pages artifact', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'examples/site/dist/index.html'), '<html><body>No head</body></html>');
    await keepsPrevious(root, build(root), /Missing head/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('the site is the entry, Studio sits beside it and former example routes lead to the site', async () => {
  const root = await fixture();
  try {
    const result = build(root); assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(root, 'dist-pages/index.html'), 'utf8'), siteHtml);
    assert.equal(await readFile(join(root, 'dist-pages/assets/site.js'), 'utf8'), 'site script');
    await access(join(root, 'dist-pages/studio/index.html'));
    await access(join(root, 'dist-pages/docs/index.html'));
    await access(join(root, 'dist-pages/.nojekyll'));
    await assert.rejects(access(join(root, 'dist-pages/previous-build.txt')), {code: 'ENOENT'});
    // The previous gallery is not published any more.
    await assert.rejects(access(join(root, 'dist-pages/gallery')), {code: 'ENOENT'});
    for (const route of formerRoutes) {
      const html = await readFile(join(root, 'dist-pages', route, 'index.html'), 'utf8');
      assert.match(html, /<meta http-equiv="refresh" content="0; url=\.\.\/">/, route);
      assert.match(html, /<a href="\.\.\/">Ferrum2D 예제<\/a>/, route);
      assert.match(html, /<meta name="robots" content="noindex">/, route);
    }
  } finally { await rm(root, {recursive: true, force: true}); }
});
