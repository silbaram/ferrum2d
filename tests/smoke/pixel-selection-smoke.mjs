import {clickPlacementToolAction} from "./placement-panel-navigation.mjs";
import assert from "node:assert/strict";
import { resolve } from "node:path";

/** Real pointer/keyboard selection at the fixture's DPR, plus source and Undo evidence. */
export async function smokePixelSelection(page, mode, run, { action, canvas, point, exportFile, baseline }) {
  const workspace = page.locator("#placement-pixel-workspace"), controls = workspace.locator(".placement-pixel-selection");
  let counter = 0;
  async function source() { return JSON.parse((await exportFile("export-source", `-selection-${counter++}.pixel.json`)).bytes); }
  async function waitFrame() { await page.evaluate(() => new Promise(requestAnimationFrame)); }
  async function select(x0 = 0, y0 = 0, x1 = 1, y1 = 2) {
    await clickPlacementToolAction(action("tool-select")); await page.keyboard.press("Escape"); const a = await point(x0, y0), b = await point(x1, y1);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 2 }); await page.mouse.up(); await waitFrame();
  }
  async function menu(key) { await controls.locator("summary").click(); await clickPlacementToolAction(action(key)); await waitFrame(); }
  async function unchanged() { assert.deepEqual(await source(), baseline, "selection/cancel/Undo must preserve the complete source"); }
  const sample = (value, x, y) => [...Buffer.from(value.rgba, "base64").subarray((y * value.width + x) * 4, (y * value.width + x + 1) * 4)];
  await select();
  assert.equal(await workspace.getAttribute("data-pixel-dirty"), "false");
  assert.deepEqual(JSON.parse(await canvas.getAttribute("data-pixel-selection")), { x: 0, y: 0, width: 2, height: 3 });
  await unchanged();
  const a = await point(0, 0), b = await point(2, 1);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up(); await waitFrame();
  assert.equal(await canvas.getAttribute("data-pixel-selection-pending"), "true");
  assert(await action("export-source").isDisabled()); assert(await action("apply").isDisabled());
  await page.keyboard.press("Control+s"); assert.equal(await canvas.getAttribute("data-pixel-selection-pending"), "true");
  assert.equal(await workspace.getAttribute("data-pixel-dirty"), "false");
  await page.keyboard.press("Escape"); await unchanged();
  // Enter must activate the focused control, rather than the canvas confirm shortcut.
  await canvas.focus(); await page.keyboard.press("ArrowRight");
  await action("selection-cancel").focus(); await page.keyboard.press("Enter"); await unchanged();
  await select(); await canvas.focus(); await page.keyboard.press("ArrowRight");
  await controls.locator("summary").focus(); await page.keyboard.press("Enter");
  assert(await controls.locator("details").evaluate(element => element.open), "Enter on summary opens the selection menu");
  await action("rotate").focus(); await page.keyboard.press("Enter"); await waitFrame();
  assert.equal(await canvas.getAttribute("data-pixel-selection-pending"), "true", "Enter on Rotate transforms the preview without confirming");
  assert.equal(JSON.parse(await canvas.getAttribute("data-pixel-selection")).width, 3);
  await clickPlacementToolAction(action("selection-cancel")); await unchanged();
  // Keyboard edits cannot commit or replace the target of a pointer gesture in progress.
  await select();
  const heldStart = await point(0, 0), heldEnd = await point(2, 1);
  await page.mouse.move(heldStart.x, heldStart.y); await page.mouse.down(); await page.mouse.move(heldEnd.x, heldEnd.y);
  const shortcutDefaults = await canvas.evaluate(element => [
    {code:"KeyC",ctrlKey:true}, {code:"KeyC",metaKey:true}, {code:"KeyS",ctrlKey:true},
    {code:"KeyC",ctrlKey:true,shiftKey:true}, {code:"KeyA",ctrlKey:true,shiftKey:true},
    {code:"KeyC",metaKey:true,shiftKey:true}, {code:"KeyC",ctrlKey:true,altKey:true},
  ].map(keys => {const event=new KeyboardEvent("keydown",{...keys,bubbles:true,cancelable:true});element.dispatchEvent(event);return event.defaultPrevented;}));
  assert.deepEqual(shortcutDefaults,[true,true,true,false,false,false,false],"gesture guard handles only editor shortcuts and preserves browser combinations");
  await page.keyboard.press("Enter"); await waitFrame();
  assert(await action("export-source").isDisabled(), "Enter while dragging cannot commit the pointer gesture");
  await page.keyboard.press("Escape"); await page.mouse.up(); await unchanged();
  await clickPlacementToolAction(action("tool-select")); await page.keyboard.press("Escape");
  const marqueeEnd = await point(1, 2);
  await page.mouse.move(heldStart.x, heldStart.y); await page.mouse.down(); await page.mouse.move(marqueeEnd.x, marqueeEnd.y);
  await page.keyboard.press("Control+x"); await page.keyboard.press("Escape"); await page.mouse.up(); await unchanged();
  for (const interruption of ["pointercancel", "lostpointercapture"]) {
    await select();
    await canvas.evaluate(element => element.addEventListener("pointerdown", event => { window.pixelSelectionReviewPointer = event.pointerId; }, { once: true }));
    await page.mouse.move(heldStart.x, heldStart.y); await page.mouse.down(); await page.mouse.move(heldEnd.x, heldEnd.y);
    await canvas.evaluate((element, type) => {
      if (type === "pointercancel") element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: window.pixelSelectionReviewPointer }));
      else element.releasePointerCapture(window.pixelSelectionReviewPointer);
    }, interruption);
    await page.mouse.up(); await waitFrame(); await unchanged();
  }
  await select();
  await menu("flip-x"); assert(await action("selection-confirm").isVisible());
  await clickPlacementToolAction(action("selection-confirm")); const flipped = await source();
  assert.deepEqual(sample(flipped, 0, 0), [0, 0, 0, 0]); assert.deepEqual(sample(flipped, 1, 0), [255, 0, 0, 255]);
  await canvas.focus(); await page.keyboard.press("Control+z"); await unchanged();
  await select(); await menu("rotate");
  assert.deepEqual(JSON.parse(await canvas.getAttribute("data-pixel-selection")), { x: 0, y: 0, width: 3, height: 2 });
  await page.keyboard.press("Enter"); const rotated = await source();
  assert.deepEqual(sample(rotated, 2, 0), [255, 0, 0, 255]); assert.deepEqual(sample(rotated, 0, 0), [0, 0, 0, 0]);
  await clickPlacementToolAction(action("undo")); await unchanged();
  await select(); await canvas.focus(); await page.keyboard.press("Control+c"); await page.keyboard.press("Control+v");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  const pasted = await source(); assert.deepEqual(sample(pasted, 0, 0), [255, 0, 0, 255]); assert.deepEqual(sample(pasted, 2, 1), [255, 0, 0, 255]);
  await clickPlacementToolAction(action("undo")); await unchanged();
  await select(); await canvas.focus(); await page.keyboard.press("Control+x");
  assert.deepEqual(sample(await source(), 0, 0), [0, 0, 0, 0]); await clickPlacementToolAction(action("undo")); await unchanged();
  await canvas.focus(); await page.keyboard.press("Control+a"); await page.keyboard.press("ArrowLeft");
  assert.match(await controls.locator("output").textContent(), /clipped/);
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await unchanged();
  const retained = await canvas.getAttribute("data-pixel-selection");
  await clickPlacementToolAction(action("tool-pan")); await clickPlacementToolAction(action("tool-select")); await waitFrame();
  assert.equal(await canvas.getAttribute("data-pixel-selection"), retained, "returning from pan preserves the selection");
  await canvas.hover(); await page.mouse.wheel(0, -100); await waitFrame();
  const panStart = await point(3, 3); await canvas.focus(); await page.keyboard.down("Space");
  await page.mouse.move(panStart.x, panStart.y); await page.mouse.down(); await page.mouse.move(panStart.x + 24, panStart.y + 16); await page.mouse.up(); await page.keyboard.up("Space");
  await select(1, 1, 2, 2); assert.deepEqual(JSON.parse(await canvas.getAttribute("data-pixel-selection")), { x: 1, y: 1, width: 2, height: 2 });
  await page.locator("[data-placement-language]").selectOption("ko"); await page.setViewportSize({ width: 390, height: 840 }); await waitFrame();
  assert.equal(await action("tool-select").textContent(), "선택 (M)");
  await controls.locator("summary").click();
  assert(await workspace.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await page.screenshot({ path: resolve(run, mode + "-pixel-selection-ko-narrow.png"), fullPage: true });
  await controls.locator("summary").click(); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("[data-placement-language]").selectOption("en"); await canvas.focus(); await page.keyboard.press("Escape");
  await clickPlacementToolAction(action("tool-pencil")); await clickPlacementToolAction(action("fit")); await unchanged();
  return { marquee: true, deferredMove: true, cancelAndBlur: true, focusedControlEnter: true, pointerKeyboardIsolation: true, flipAndRotate: true, clipboard: true, oneUndo: true, clippedWarning: true, panZoomCoordinates: true, localeAndNarrow: true };
}
