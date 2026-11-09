import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, access} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const builder = resolve('scripts/build/build-pages.mjs');
const catalog = JSON.parse(await readFile('examples/shared/exampleCatalog.json', 'utf8'));
const features = JSON.parse(await readFile('examples/shared/featureCatalog.json', 'utf8'));
const publicEntries = catalog.filter(item => item.kind !== 'reference');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ferrum-example-build-'));
  const put = async (path, data) => { await mkdir(dirname(join(root,path)), {recursive:true}); await writeFile(join(root,path), data); };
  await put('examples/shared/exampleCatalog.json', JSON.stringify(catalog));
  await put('examples/shared/featureCatalog.json', JSON.stringify(features));
  for (const path of ['examples/shared/featureTopics.json','examples/shared/physicsExamples.json','examples/physics-sandbox/public/catalog.json']) await put(path,await readFile(path,'utf8'));
  await put('package.json', JSON.stringify({scripts:Object.fromEntries(catalog.map(item=>[item.command.slice(5),'fixture dev']))}));
  for (const item of catalog) await put(join(dirname(item.source),'package.json'), '{}');
  for (const feature of features) {
    const path = `examples/starter-runtime/public/features/${feature.id}.json`;
    await put(path, await readFile(path, 'utf8'));
  }
  for (const entry of publicEntries) await put(join(entry.source,'index.html'), '<!doctype html><html><head><title>Fixture</title></head><body></body></html>');
  await put('docs/README.md', '# Fixture docs\n');
  await put('apps/placement-viewer/public/fonts/notice.txt', 'Fixture notice');
  await put('apps/placement-viewer/src/fonts/NotoSansKR-UI.woff2', 'Fixture font');
  await put('dist-pages/previous-build.txt', 'last successful build');
  return root;
}
function build(root) { return spawnSync(process.execPath,[builder],{cwd:root,encoding:'utf8',timeout:15000}); }

test('missing example build input preserves the previous Pages artifact', async () => {
  const root=await fixture();
  try {
    await rm(join(root,'examples/pixel-art/dist/index.html'));
    const result=build(root);
    assert.notEqual(result.status,0);
    assert.equal(await readFile(join(root,'dist-pages/previous-build.txt'),'utf8'),'last successful build');
    assert.match(result.stderr,/Missing .*pixel-art.*index\.html/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('incomplete learning instructions fail before replacing the previous Pages artifact', async () => {
  const root=await fixture();
  try {
    const broken=structuredClone(features); broken[0].lesson.steps=['한 단계만 있는 설명'];
    await writeFile(join(root,'examples/shared/featureCatalog.json'),JSON.stringify(broken));
    const result=build(root); assert.notEqual(result.status,0);
    assert.equal(await readFile(join(root,'dist-pages/previous-build.txt'),'utf8'),'last successful build');
    assert.match(result.stderr,/learning steps/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('invalid example HTML fails before replacing a successful Pages artifact', async () => {
  const root=await fixture();
  try {
    await writeFile(join(root,'examples/breakout/dist/index.html'),'<html><body>No head</body></html>');
    const result=build(root);
    assert.notEqual(result.status,0);
    assert.equal(await readFile(join(root,'dist-pages/previous-build.txt'),'utf8'),'last successful build');
    assert.match(result.stderr,/head/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('unknown topics and physics scenarios preserve the previous Pages artifact', async () => {
  for (const kind of ['topic', 'physics']) {
    const root = await fixture();
    try {
      if (kind === 'topic') {
        const broken = structuredClone(features); broken[0].topic = 'missing';
        await writeFile(join(root,'examples/shared/featureCatalog.json'),JSON.stringify(broken));
      } else {
        const path = join(root,'examples/shared/physicsExamples.json');
        const broken = JSON.parse(await readFile(path,'utf8')); broken[0].id = 'missing';
        await writeFile(path,JSON.stringify(broken));
      }
      const result = build(root); assert.notEqual(result.status,0);
      assert.match(result.stderr,kind === 'topic' ? /Invalid topic/ : /Invalid physics entry/);
      assert.equal(await readFile(join(root,'dist-pages/previous-build.txt'),'utf8'),'last successful build');
    } finally { await rm(root,{recursive:true,force:true}); }
  }
});

test('suite markers are added only to published copies', async () => {
  const root=await fixture();
  try {
    const result=build(root); assert.equal(result.status,0,result.stderr);
    const entryHtml=await readFile(join(root,'dist-pages/index.html'),'utf8');
    assert.match(entryHtml,/<meta http-equiv="refresh" content="0; url=\.\/starter-runtime\/"/);
    assert.match(entryHtml,/<a href="\.\/starter-runtime\/">/);
    assert(!entryHtml.includes('data-example-hub'));
    for (const removed of ['exampleHub.css','exampleHub.mjs','exampleTheme.css']) await assert.rejects(access(join(root,'dist-pages',removed)),{code:'ENOENT'});
    for (const entry of publicEntries) {
      const source=await readFile(join(root,entry.source,'index.html'),'utf8');
      const published=await readFile(join(root,'dist-pages',entry.id,'index.html'),'utf8');
      assert(!source.includes('ferrum-example-suite'));
      assert.equal((published.match(/name="ferrum-example-suite" content="1"/g)??[]).length,1);
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});
