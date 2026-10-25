import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { smokePlacementToolbarUx } from "./placement-toolbar-ux-smoke.mjs";

/** Exercise the visible viewport controls through the real canvas resize path. */
export async function smokePlacementViewportSizing(page, timeoutMs, mode) {
  const artifact = "artifacts/viewport-navigation-sizing";
  await mkdir(artifact, { recursive: true });
  const viewport = page.viewportSize();
  const wait = (fn, arg) =>
    page.waitForFunction(fn, arg, { timeout: timeoutMs });
  const authored = () =>
    page.evaluate(() => JSON.stringify({
      document: globalThis.ferrumPlacementSpatialExportDocument(),
      patch: globalThis.ferrumPlacementViewerExportPatch(),
      history: globalThis.ferrumPlacementViewerHistory,
      selected: globalThis.ferrumPlacementViewerState.selectedInstanceIds,
      entities: globalThis.ferrumPlacementViewerState.instances.map((i) => i.entity),
    }));
  const dimensions = () => page.locator("canvas.demo-canvas").boundingBox();
  const ready = () => wait(() => {
    const canvas = document.querySelector("canvas.demo-canvas");
    return document.querySelector("[data-placement-viewport-size]").textContent ===
      `${canvas.clientWidth} × ${canvas.clientHeight}` &&
      globalThis.ferrumPlacementGrid?.lineCount > 0 &&
      globalThis.ferrumPlacementViewerRuntimeFrame?.drawCalls > 0;
  });
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await ready();
    await smokePlacementToolbarUx(page, timeoutMs, mode);
    const before = await authored(), initial = await dimensions();
    const expand = page.locator("[data-placement-viewport-expand]");
    await page.locator("[data-placement-language]").selectOption("ko");
    assert.equal(await expand.textContent(), "화면 확장");
    await expand.click();
    await wait(() => globalThis.ferrumPlacementWorkspaceLayout.focused);
    await ready();
    assert.equal(await expand.textContent(), "화면 복원");
    const expanded = await dimensions();
    assert(expanded.width > initial.width + 400);
    assert(expanded.height > initial.height + 100);
    await page.locator("[data-placement-language]").selectOption("en");
    assert.equal(await expand.textContent(), "Restore View");
    await expand.click();
    await wait(() => !globalThis.ferrumPlacementWorkspaceLayout.focused);
    await ready();
    const restored = await dimensions();
    assert(Math.abs(restored.width - initial.width) < 1);
    assert(Math.abs(restored.height - initial.height) < 1);
    for (const [dock, positive, negative, dimension] of [
      ["scene", "ArrowRight", "ArrowLeft", "width"],
      ["inspector", "ArrowLeft", "ArrowRight", "width"],
      ["runtime", "ArrowUp", "ArrowDown", "height"],
    ]) {
      await page.locator(`[data-placement-dock-resize=${dock}]`).focus();
      await page.keyboard.press(positive);
      await wait(({ dimension, size }) => {
        const rect = document.querySelector("canvas").getBoundingClientRect();
        return Math.abs(rect[dimension] - (size - 8)) < 1;
      }, { dimension, size: restored[dimension] });
      await ready();
      await page.keyboard.press(negative);
    }
    await ready();
    assert.equal(await authored(), before, "Viewport controls changed authored state");
    await page.screenshot({ path: `${artifact}/${mode}.png`, fullPage: true });
    await writeFile(`${artifact}/${mode}.json`, JSON.stringify({
      ok: true, initial, expanded, restored,
      checks: ["expand/restore", "actual CSS dimensions", "three dock keyboard resize", "Korean/English", "render/grid after resize", "draft/history/selection/entities preserved"],
    }, null, 2) + "\n");
  } catch (error) {
    await page.screenshot({ path: `${artifact}/${mode}-failure.png`, fullPage: true });
    throw error;
  } finally {
    await page.setViewportSize(viewport);
    await ready();
  }
}
