import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(
  new URL("../../apps/placement-viewer/package.json", import.meta.url),
);
const ts = require("typescript");
async function moduleSource(name) {
  return ts.transpileModule(
    await readFile(
      new URL(`../../apps/placement-viewer/src/${name}.ts`, import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
}
const dataUrl = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const messagesUrl = dataUrl(await moduleSource("placementLocaleMessages"));
const { koreanMessages } = await import(messagesUrl);
const { uiMessage, formatUi, preferredLocale } = await import(
  dataUrl(
    (await moduleSource("placementLocale")).replace(
      '"./placementLocaleMessages"',
      JSON.stringify(messagesUrl),
    ),
  )
);

test("all Korean messages retain the English parameter contract", () => {
  const parameters = (text) =>
    [...new Set(text.match(/\{\d+\}/g) ?? [])].sort();
  assert(Object.keys(koreanMessages).length > 300);
  for (const [key, value] of Object.entries(koreanMessages)) {
    assert.equal(typeof value, "string");
    assert.deepEqual(parameters(value), parameters(key), key);
  }
});
test("language changes preserve authored parameter strings and English output", () => {
  const message = uiMessage(
    "{0} · {1} · Read-only · 4 Hz",
    "Save",
    uiMessage("Game Preview"),
  );
  assert.equal(
    formatUi(message, "ko"),
    "Save · 게임 미리보기 · 읽기 전용 · 4 Hz",
  );
  assert.equal(
    formatUi(message, "en"),
    "Save · Game Preview · Read-only · 4 Hz",
  );
  assert.equal(
    formatUi(message, "ko"),
    "Save · 게임 미리보기 · 읽기 전용 · 4 Hz",
  );
});
test("filenames, paths, JSON and nested-looking data are never translated as parameters", () => {
  for (const value of [
    "Inspector",
    "/assets/Save.png",
    '{"name":"Save"}',
    "{0}",
    "$&",
  ]) {
    assert.equal(
      formatUi(uiMessage("Apply Target · {0}", value), "ko"),
      "적용 대상 · " + value,
    );
  }
  assert.equal(
    formatUi(uiMessage("{0}", { key: "Save", values: [] }), "ko"),
    "[object Object]",
  );
});
test("unknown keys and prototype names fall back without throwing", () => {
  for (const key of ["Unknown message", "__proto__", "constructor"])
    assert.equal(formatUi(key, "ko"), key);
  assert.equal(
    formatUi(uiMessage("Unknown {0}", "Save"), "ko"),
    "Unknown Save",
  );
});
test("explicit saved locale takes precedence over browser language", () => {
  assert.equal(preferredLocale("en", ["ko-KR"]), "en");
  assert.equal(preferredLocale("ko", ["en-US"]), "ko");
});
test("missing or invalid preferences use supported browser language with English fallback", () => {
  for (const saved of [null, "broken", '{"language":"ko"}']) {
    assert.equal(preferredLocale(saved, ["ko-KR", "en-US"]), "ko");
    assert.equal(preferredLocale(saved, ["en-US", "ko-KR"]), "en");
    assert.equal(preferredLocale(saved, ["ja-JP"]), "en");
    assert.equal(preferredLocale(saved, ["kok-IN"]), "en");
    assert.equal(preferredLocale(saved, []), "en");
  }
});
test("bundled Hangul font matches its provenance and carries the redistribution license", async () => {
  const font = await readFile(
    new URL(
      "../../apps/placement-viewer/src/fonts/NotoSansKR-UI.woff2",
      import.meta.url,
    ),
  );
  const source = JSON.parse(
    await readFile(
      new URL(
        "../../apps/placement-viewer/public/fonts/NotoSansKR.source.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const license = await readFile(
    new URL(
      "../../apps/placement-viewer/public/fonts/NotoSansKR-OFL.txt",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(font.subarray(0, 4).toString(), "wOF2");
  assert.equal(
    createHash("sha256").update(font).digest("hex"),
    source.woff2Sha256,
  );
  assert.equal(font.length, source.bytes);
  assert(font.length < 1024 * 1024);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
});
