/** Eight independent channel bits; these are groups, not authored light indices. */
export function isLightingChannelMask(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}
export function resolveLightingChannelMask(value: unknown, path: string): number {
  if (!isLightingChannelMask(value)) throw Error(`${path} must be an integer in 0..255`);
  return value;
}
