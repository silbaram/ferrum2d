export function withSlices(data, version = 0) {
  data.json.meta.slices = [
    { name: 'feet', keys: [
      { frame: 0, bounds: { x: 2, y: 1, w: 20, h: 22 }, pivot: { x: version ? 11 : 10, y: 21 }, center: { x: 4, y: 4, w: 12, h: 14 } },
      { frame: 12, bounds: { x: 0, y: 0, w: 24, h: 24 }, pivot: { x: 6, y: 24 } },
    ] },
    { name: 'panel', keys: [{ frame: 0, bounds: { x: 1, y: 1, w: 20, h: 20 }, center: { x: 4, y: 4, w: 12, h: 12 } }] },
  ];
  return data;
}
