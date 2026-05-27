import { screenshotCaptureDiagnosticError } from "./diagnostics.js";

export const SCREENSHOT_CAPTURE_SUMMARY_FORMAT = "ferrum-screenshot-capture-summary";
export const SCREENSHOT_CAPTURE_SUMMARY_VERSION = 1;

export interface ScreenshotCaptureSpec {
  name?: string;
  minNonTransparentPixelRatio?: number;
  comparison?: ScreenshotComparisonThreshold;
}

export interface ResolvedScreenshotCaptureSpec {
  name: string;
  minNonTransparentPixelRatio: number;
  comparison: Required<ScreenshotComparisonThreshold>;
}

export interface ScreenshotColorSummary {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ScreenshotPixelSummary {
  format: typeof SCREENSHOT_CAPTURE_SUMMARY_FORMAT;
  version: typeof SCREENSHOT_CAPTURE_SUMMARY_VERSION;
  width: number;
  height: number;
  pixelCount: number;
  opaquePixelRatio: number;
  nonTransparentPixelRatio: number;
  averageColor: ScreenshotColorSummary;
  contentHash: string;
}

export interface ScreenshotComparisonThreshold {
  maxAverageColorDelta?: number;
  maxOpaqueRatioDelta?: number;
  maxNonTransparentRatioDelta?: number;
}

export interface ScreenshotComparisonReport {
  passed: boolean;
  dimensionMismatch: boolean;
  actualHash: string;
  baselineHash: string;
  averageColorDelta: number;
  opaqueRatioDelta: number;
  nonTransparentRatioDelta: number;
  threshold: Required<ScreenshotComparisonThreshold>;
}

const DEFAULT_CAPTURE_SPEC: ResolvedScreenshotCaptureSpec = Object.freeze({
  name: "screenshot",
  minNonTransparentPixelRatio: 0.01,
  comparison: Object.freeze({
    maxAverageColorDelta: 0.02,
    maxOpaqueRatioDelta: 0.01,
    maxNonTransparentRatioDelta: 0.01,
  }),
});

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function resolveScreenshotCaptureSpec(
  spec: ScreenshotCaptureSpec = {},
  path = "screenshotCapture",
): ResolvedScreenshotCaptureSpec {
  if (!isRecord(spec)) {
    throw invalid(path, "must be an object");
  }
  const input = spec as ScreenshotCaptureSpec;
  return {
    name: sanitizeName(stringValue(input.name, `${path}.name`, DEFAULT_CAPTURE_SPEC.name)),
    minNonTransparentPixelRatio: unitNumber(
      input.minNonTransparentPixelRatio,
      `${path}.minNonTransparentPixelRatio`,
      DEFAULT_CAPTURE_SPEC.minNonTransparentPixelRatio,
    ),
    comparison: resolveComparisonThreshold(input.comparison, `${path}.comparison`),
  };
}

export function summarizeScreenshotPixels(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): ScreenshotPixelSummary {
  const resolvedWidth = positiveInteger(width, "screenshot.width");
  const resolvedHeight = positiveInteger(height, "screenshot.height");
  const expectedLength = resolvedWidth * resolvedHeight * 4;
  if (pixels.length !== expectedLength) {
    throw invalid("screenshot.pixels", `length must equal width * height * 4 (${expectedLength})`);
  }

  let hash = FNV_OFFSET;
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let alphaTotal = 0;
  let opaqueCount = 0;
  let nonTransparentCount = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = byteValue(pixels[index], `screenshot.pixels.${index}`);
    const green = byteValue(pixels[index + 1], `screenshot.pixels.${index + 1}`);
    const blue = byteValue(pixels[index + 2], `screenshot.pixels.${index + 2}`);
    const alpha = byteValue(pixels[index + 3], `screenshot.pixels.${index + 3}`);
    redTotal += red;
    greenTotal += green;
    blueTotal += blue;
    alphaTotal += alpha;
    if (alpha >= 255) {
      opaqueCount += 1;
    }
    if (alpha > 0) {
      nonTransparentCount += 1;
    }
    hash = fnvByte(hash, red);
    hash = fnvByte(hash, green);
    hash = fnvByte(hash, blue);
    hash = fnvByte(hash, alpha);
  }

  const pixelCount = resolvedWidth * resolvedHeight;
  hash = fnvByte(hash, resolvedWidth & 0xff);
  hash = fnvByte(hash, resolvedHeight & 0xff);
  return {
    format: SCREENSHOT_CAPTURE_SUMMARY_FORMAT,
    version: SCREENSHOT_CAPTURE_SUMMARY_VERSION,
    width: resolvedWidth,
    height: resolvedHeight,
    pixelCount,
    opaquePixelRatio: opaqueCount / pixelCount,
    nonTransparentPixelRatio: nonTransparentCount / pixelCount,
    averageColor: {
      r: redTotal / (pixelCount * 255),
      g: greenTotal / (pixelCount * 255),
      b: blueTotal / (pixelCount * 255),
      a: alphaTotal / (pixelCount * 255),
    },
    contentHash: hash.toString(16).padStart(8, "0"),
  };
}

export function assertScreenshotCaptureSummary(
  summary: ScreenshotPixelSummary,
  spec: ScreenshotCaptureSpec = {},
): ScreenshotPixelSummary {
  const resolved = resolveScreenshotCaptureSpec(spec);
  validateSummary(summary, "screenshot.summary");
  if (summary.nonTransparentPixelRatio < resolved.minNonTransparentPixelRatio) {
    throw invalid(
      "screenshot.summary.nonTransparentPixelRatio",
      `must be at least ${resolved.minNonTransparentPixelRatio}`,
    );
  }
  return summary;
}

export function compareScreenshotSummaries(
  actual: ScreenshotPixelSummary,
  baseline: ScreenshotPixelSummary,
  threshold: ScreenshotComparisonThreshold = {},
): ScreenshotComparisonReport {
  validateSummary(actual, "screenshot.actual");
  validateSummary(baseline, "screenshot.baseline");
  const resolvedThreshold = resolveComparisonThreshold(threshold, "screenshot.threshold");
  const dimensionMismatch = actual.width !== baseline.width || actual.height !== baseline.height;
  const averageColorDelta = averageColorDeltaFor(actual.averageColor, baseline.averageColor);
  const opaqueRatioDelta = Math.abs(actual.opaquePixelRatio - baseline.opaquePixelRatio);
  const nonTransparentRatioDelta = Math.abs(actual.nonTransparentPixelRatio - baseline.nonTransparentPixelRatio);
  const passed = !dimensionMismatch
    && averageColorDelta <= resolvedThreshold.maxAverageColorDelta
    && opaqueRatioDelta <= resolvedThreshold.maxOpaqueRatioDelta
    && nonTransparentRatioDelta <= resolvedThreshold.maxNonTransparentRatioDelta;
  return {
    passed,
    dimensionMismatch,
    actualHash: actual.contentHash,
    baselineHash: baseline.contentHash,
    averageColorDelta,
    opaqueRatioDelta,
    nonTransparentRatioDelta,
    threshold: resolvedThreshold,
  };
}

function resolveComparisonThreshold(
  input: ScreenshotComparisonThreshold | undefined,
  path: string,
): Required<ScreenshotComparisonThreshold> {
  if (input === undefined) {
    return { ...DEFAULT_CAPTURE_SPEC.comparison };
  }
  if (!isRecord(input)) {
    throw invalid(path, "must be an object");
  }
  return {
    maxAverageColorDelta: unitNumber(
      input.maxAverageColorDelta,
      `${path}.maxAverageColorDelta`,
      DEFAULT_CAPTURE_SPEC.comparison.maxAverageColorDelta,
    ),
    maxOpaqueRatioDelta: unitNumber(
      input.maxOpaqueRatioDelta,
      `${path}.maxOpaqueRatioDelta`,
      DEFAULT_CAPTURE_SPEC.comparison.maxOpaqueRatioDelta,
    ),
    maxNonTransparentRatioDelta: unitNumber(
      input.maxNonTransparentRatioDelta,
      `${path}.maxNonTransparentRatioDelta`,
      DEFAULT_CAPTURE_SPEC.comparison.maxNonTransparentRatioDelta,
    ),
  };
}

function validateSummary(summary: ScreenshotPixelSummary, path: string): void {
  if (!isRecord(summary)) {
    throw invalid(path, "must be an object");
  }
  if (summary.format !== SCREENSHOT_CAPTURE_SUMMARY_FORMAT) {
    throw invalid(`${path}.format`, `must be ${SCREENSHOT_CAPTURE_SUMMARY_FORMAT}`);
  }
  if (summary.version !== SCREENSHOT_CAPTURE_SUMMARY_VERSION) {
    throw invalid(`${path}.version`, `must be ${SCREENSHOT_CAPTURE_SUMMARY_VERSION}`);
  }
  positiveInteger(summary.width, `${path}.width`);
  positiveInteger(summary.height, `${path}.height`);
  positiveInteger(summary.pixelCount, `${path}.pixelCount`);
  unitNumber(summary.opaquePixelRatio, `${path}.opaquePixelRatio`);
  unitNumber(summary.nonTransparentPixelRatio, `${path}.nonTransparentPixelRatio`);
  validateColor(summary.averageColor, `${path}.averageColor`);
  stringValue(summary.contentHash, `${path}.contentHash`);
}

function validateColor(color: ScreenshotColorSummary, path: string): void {
  if (!isRecord(color)) {
    throw invalid(path, "must be an object");
  }
  unitNumber(color.r, `${path}.r`);
  unitNumber(color.g, `${path}.g`);
  unitNumber(color.b, `${path}.b`);
  unitNumber(color.a, `${path}.a`);
}

function averageColorDeltaFor(actual: ScreenshotColorSummary, baseline: ScreenshotColorSummary): number {
  return (
    Math.abs(actual.r - baseline.r)
    + Math.abs(actual.g - baseline.g)
    + Math.abs(actual.b - baseline.b)
    + Math.abs(actual.a - baseline.a)
  ) / 4;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || DEFAULT_CAPTURE_SPEC.name;
}

function fnvByte(hash: number, byte: number): number {
  return Math.imul((hash ^ byte) >>> 0, FNV_PRIME) >>> 0;
}

function byteValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
    throw invalid(path, "must be an integer byte");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw invalid(path, "must be a positive integer");
  }
  return value;
}

function unitNumber(value: unknown, path: string, fallback?: number): number {
  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw invalid(path, "must be between 0 and 1");
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalid(path, "must be between 0 and 1");
  }
  return value;
}

function stringValue(value: unknown, path: string, fallback?: string): string {
  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw invalid(path, "must be a non-empty string");
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, "must be a non-empty string");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, detail: string): Error {
  return screenshotCaptureDiagnosticError(path, detail);
}
