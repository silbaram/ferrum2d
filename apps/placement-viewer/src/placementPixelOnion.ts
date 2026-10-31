import type { PixelFrameInfo } from "./placementPixelDocument";

/** View preferences only; never part of editable source or pixel history. */
export interface PixelOnionSettings {
  enabled: boolean;
  previous: boolean;
  next: boolean;
  opacity: number;
}
export const PIXEL_ONION_DEFAULTS: Readonly<PixelOnionSettings> = Object.freeze({
  enabled: false, previous: true, next: true, opacity: 30,
});

/** Adjacent source frames, without wrapping or including the editing frame. */
export function pixelOnionFrames(
  frames: readonly Pick<PixelFrameInfo, "id">[], selected: string,
  settings: PixelOnionSettings, playing = false,
): { id: string; side: "previous" | "next" }[] {
  if (!Number.isInteger(settings.opacity) || settings.opacity < 0 || settings.opacity > 100)
    throw Error("Onion opacity must be an integer from 0 to 100");
  if (!settings.enabled || !settings.opacity || playing) return [];
  const index = frames.findIndex(frame => frame.id === selected);
  if (index < 0) throw Error("Pixel frame not found");
  const result: { id: string; side: "previous" | "next" }[] = [];
  if (settings.previous && index > 0) result.push({ id: frames[index - 1].id, side: "previous" });
  if (settings.next && index + 1 < frames.length) result.push({ id: frames[index + 1].id, side: "next" });
  return result;
}
