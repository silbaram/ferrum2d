// Generated once, with a center tap and no screen/frame-dependent rotation.
// Both shader languages and both light types use the same bounded sample disk.
export function spatialPcssDisk(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const radius = Math.sqrt(i / (count - 1)), angle = i * 2.399963229728653;
    return `${(Math.cos(angle) * radius).toFixed(8)},${(Math.sin(angle) * radius).toFixed(8)}`;
  });
}
