import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Logic half of smoke:example-site: list groups and counts, search in both languages and the
// catalog data the frame shows. Layout, fonts, focus, dragging and WebGL release stay in the browser.
const ts = createRequire(new URL("../../examples/site/package.json", import.meta.url))("typescript");
async function siteModule(path, imports = []) {
  let code = ts.transpileModule(await readFile(new URL(`../../examples/site/src/${path}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [name, url] of imports) code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}
const copy = name => siteModule(`examples/${name}/messages.ts`);
const { examples, groups, tools } = await import(await siteModule("catalog.ts", [
  ["./examples/breakout/messages", await copy("breakout")],
  ["./examples/collision/messages", await copy("collision")],
  ["./examples/sprite/messages", await copy("sprite")],
]));
const { siteEntries, treeGroups, homeGroups, searchQuery } = await import(await siteModule("listing.ts"));
const { siteText } = await import(await siteModule("messages.ts"));
const entries = siteEntries(examples, tools);
const titles = (rows, locale = "ko") => rows.map(entry => entry.item.title[locale]);
const treeTitles = query => treeGroups(groups, entries, searchQuery(query)).flatMap(row => titles(row.shown));
const homeTitles = (query, locale) => homeGroups(groups, entries, searchQuery(query)).flatMap(row => titles(row.items, locale));

test("the list keeps every group in order with its full count, and the home shows only filled groups", () => {
  const tree = treeGroups(groups, entries, "");
  assert.deepEqual(tree.map(row => row.group.title.ko), ["그리기", "움직임과 화면", "충돌과 물리", "효과와 소리", "게임 구성", "게임 데모", "도구"]);
  assert.deepEqual(tree.map(row => row.items.length), [1, 0, 1, 0, 0, 1, 2]);
  assert.equal(tree.filter(row => !row.items.length).length, 3, "empty groups stay listed as coming soon");
  assert.deepEqual(homeGroups(groups, entries, "").map(row => row.group.title.ko), ["그리기", "충돌과 물리", "게임 데모", "도구"]);
  assert.deepEqual(groups.map(group => group.title.en), ["Rendering", "Movement & View", "Collision & Physics", "Effects & Audio", "Game Systems", "Game Demos", "Tools"]);
  assert.equal(siteText.exampleCount(examples.length).ko, "예제 3");
  assert.equal(siteText.groupCount(groups.length - 1, tools.length).en, "Categories 6 · Tools 2");
});

test("search matches titles and summaries in either language and hides groups without a match", () => {
  assert.equal(searchQuery("  StUdIo "), "studio");
  assert.deepEqual(treeTitles("studio"), ["Ferrum2D Studio"]);
  assert.deepEqual(homeTitles("studio"), ["Ferrum2D Studio"]);
  assert.deepEqual(treeTitles("없는 예제 이름"), []);
  assert.deepEqual(homeTitles("없는 예제 이름"), []);
  assert.deepEqual(treeTitles("스프라이트"), ["스프라이트 그리기"]);
  assert.deepEqual(homeTitles("drawing a sprite"), ["스프라이트 그리기"], "an English query finds the Korean page entry");
  assert.deepEqual(homeTitles("스프라이트", "en"), ["Drawing a Sprite"], "a Korean query finds the English page entry");
  assert.equal(treeGroups(groups, entries, searchQuery("")).length, 7, "clearing the search restores every group");
});

test("catalog entries carry the data the frame and list need", () => {
  const ids = new Set();
  for (const example of examples) {
    assert.match(example.id, /^[a-z][a-z0-9-]*$/);
    assert(!ids.has(example.id), `duplicate example ${example.id}`); ids.add(example.id);
    assert(groups.some(group => group.id === example.group) && example.group !== "tools", `${example.id} group`);
    for (const locale of ["ko", "en"]) {
      assert(example.title[locale]?.trim() && example.summary[locale]?.trim(), `${example.id} ${locale} copy`);
      assert(example.observe.every(text => text[locale]?.trim()), `${example.id} ${locale} observe`);
    }
    assert(example.observe.length >= 2 && example.observe.length <= 3, `${example.id} observe count`);
    assert(example.world.width > 0 && example.world.height > 0, `${example.id} world`);
    assert(example.api.length > 0 && example.about.steps.length > 0, `${example.id} tabs`);
    for (const path of example.sources) assert(existsSync(new URL(`../../${path}`, import.meta.url)), `${example.id} source ${path}`);
    if (example.thumbnail) assert(existsSync(new URL(`../../examples/site/public/${example.thumbnail}`, import.meta.url)), `${example.id} thumbnail`);
  }
  assert.deepEqual(examples.find(example => example.id === "sprite").world, { width: 640, height: 384 });
  assert.equal(examples.find(example => example.id === "sprite").observe.length, 3);
  for (const tool of tools) {
    assert(tool.title.ko && tool.title.en && tool.summary.ko && tool.summary.en, `${tool.id} copy`);
    if (tool.thumbnail) assert(existsSync(new URL(`../../examples/site/public/${tool.thumbnail}`, import.meta.url)), `${tool.id} thumbnail`);
  }
});
