/** Ferrum-owned representative directional sheet; shared by model, browser and profile checks. */
export function pixelCapacitySource({ side = 32, count = 64, layers = 2, tagged = true, version = 6 } = {}) {
  const metadata = Array.from({ length: layers }, (_, i) => ({ id: `layer-${i}`, name: `Layer ${i}`, visible: i === 0, locked: false }));
  const frames = Array.from({ length: count }, (_, f) => ({
    id: `frame-${f}`, durationMs: [83, 124, 90, 180][f % 4],
    cels: metadata.map((layer, l) => {
      const data = new Uint8Array(side * side * 4);
      for (let i = 0; i < data.length; i += 4) data.set([(f * 37 + 23) % 256, (l * 61 + 40) % 256, (i / 4 * 17 + f) % 256, i % 28 ? 255 : 0], i);
      let binary = '';
      for (let i = 0; i < data.length; i += 16384) binary += String.fromCharCode(...data.subarray(i, i + 16384));
      return { layerId: layer.id, rgba: btoa(binary) };
    }),
  }));
  const tags = Array.from({ length: Math.ceil(count / 8) }, (_, i) => ({ id: `direction-${i}`, name: `Direction ${i}`, clipId: i, frameIds: frames.slice(i * 8, i * 8 + 8).map(frame => frame.id), loop: true }));
  return { format: 'ferrum2d.pixel-document', version, name: 'capacity-sheet', width: side, height: side, colorSpace: 'srgb', palette: ['#ff0000ff'], layers: metadata, frames,
    ...(tagged ? { tags, initialTag: tags[0].id, nextClipId: tags.length } : {}) };
}
