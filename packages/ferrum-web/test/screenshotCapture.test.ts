import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  assertScreenshotCaptureSummary,
  compareScreenshotSummaries,
  resolveScreenshotCaptureSpec,
  summarizeScreenshotPixels,
} from "../src/screenshotCapture.js";

test("summarizeScreenshotPixels records stable capture metadata", () => {
  const pixels = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 128,
    0, 0, 0, 0,
  ]);
  const summary = summarizeScreenshotPixels(pixels, 2, 2);

  equal(summary.width, 2);
  equal(summary.height, 2);
  equal(summary.pixelCount, 4);
  equal(summary.opaquePixelRatio, 0.5);
  equal(summary.nonTransparentPixelRatio, 0.75);
  equal(summary.averageColor.a, (255 + 255 + 128) / (4 * 255));
  equal(summary.contentHash.length, 8);
});

test("compareScreenshotSummaries applies image comparison thresholds", () => {
  const baseline = summarizeScreenshotPixels(new Uint8Array([
    10, 20, 30, 255,
    10, 20, 30, 255,
  ]), 2, 1);
  const close = summarizeScreenshotPixels(new Uint8Array([
    12, 21, 30, 255,
    10, 20, 30, 255,
  ]), 2, 1);
  const far = summarizeScreenshotPixels(new Uint8Array([
    240, 20, 30, 255,
    240, 20, 30, 255,
  ]), 2, 1);

  equal(compareScreenshotSummaries(close, baseline, { maxAverageColorDelta: 0.01 }).passed, true);
  equal(compareScreenshotSummaries(far, baseline, { maxAverageColorDelta: 0.01 }).passed, false);
});

test("resolveScreenshotCaptureSpec normalizes names and validates summary thresholds", () => {
  const spec = resolveScreenshotCaptureSpec({
    name: "Topdown Title!",
    minNonTransparentPixelRatio: 0.5,
  });
  const summary = summarizeScreenshotPixels(new Uint8Array([
    255, 255, 255, 255,
    0, 0, 0, 0,
  ]), 2, 1);

  equal(spec.name, "Topdown-Title");
  equal(assertScreenshotCaptureSummary(summary, spec), summary);
  expectThrows(
    () => assertScreenshotCaptureSummary(summary, { minNonTransparentPixelRatio: 0.75 }),
    /Invalid screenshot capture data: kind=screenshot-capture path='screenshot\.summary\.nonTransparentPixelRatio'/,
  );
});

function expectThrows(callback: () => void, pattern: RegExp): void {
  let message = "";
  try {
    callback();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  ok(pattern.test(message), `Expected '${message}' to match ${pattern}.`);
}
