import { equal } from "node:assert/strict";

export function rejectsWithMessage(run: () => unknown, expected: string): void {
  try {
    run();
  } catch (error) {
    equal(error instanceof Error ? error.message : String(error), expected);
    return;
  }
  throw new Error("Expected function to throw.");
}

export function compressedTiledLayerData(values: readonly number[]): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return btoa(String.fromCharCode(...bytes));
}
