import type { PixelFrameInfo } from "./placementPixelDocument";

/** View preferences only; never part of editable source or pixel history. */
export interface PixelOnionSettings {
  enabled: boolean;
  previous: boolean;
  next: boolean;
  opacity: number;
  previousCount: number;
  nextCount: number;
}
export const PIXEL_ONION_DEFAULTS: Readonly<PixelOnionSettings> = Object.freeze({
  enabled: false, previous: true, next: true, opacity: 30, previousCount: 1, nextCount: 1,
});

export const PIXEL_ONION_RANGE = 4;

/** Farthest first, without wrapping or including the editing frame. */
export function pixelOnionFrames(
  frames: readonly Pick<PixelFrameInfo, "id">[], selected: string,
  settings: PixelOnionSettings, playing = false,
): { id: string; side: "previous" | "next"; distance: number }[] {
  if (!Number.isInteger(settings.opacity) || settings.opacity < 0 || settings.opacity > 100)
    throw Error("Onion opacity must be an integer from 0 to 100");
  for(const count of [settings.previousCount,settings.nextCount])
    if(!Number.isInteger(count)||count<1||count>PIXEL_ONION_RANGE)throw Error("Onion range must be an integer from 1 to 4");
  if (!settings.enabled || !settings.opacity || playing) return [];
  const index = frames.findIndex(frame => frame.id === selected);
  if (index < 0) throw Error("Pixel frame not found");
  const result: { id: string; side: "previous" | "next"; distance: number }[] = [];
  for(let distance=Math.max(settings.previousCount,settings.nextCount);distance>=1;distance--) {
    if(settings.previous&&distance<=settings.previousCount&&index>=distance)
      result.push({id:frames[index-distance].id,side:"previous",distance});
    if(settings.next&&distance<=settings.nextCount&&index+distance<frames.length)
      result.push({id:frames[index+distance].id,side:"next",distance});
  }
  return result;
}
