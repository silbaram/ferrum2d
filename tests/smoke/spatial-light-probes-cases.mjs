export const PROBE_TERRAIN = [
  { id: "floor", x: -200, y: -140, width: 400, depth: 360, elevation: 0, baseElevation: -4, color: [1, 1, 1, 1], lightMask: 0 },
  { id: "block", floorId: 1, x: -12, y: 30, width: 24, depth: 24, elevation: 30, baseElevation: 0, color: [1, 1, 1, 1], lightMask: 0 },
];
export const probeCamera = projection => ({ projection, position: { x: 0, y: -160, elevation: 150 }, target: { x: 0, y: 20, elevation: 0 }, ...(projection === "orthographic" ? { height: 180 } : { fovDegrees: 48 }), near: .1, far: 800 });
export const PROBE_BASE = { composition: "separated", lighting: { ambient: [.12, .2, .28], lights: [] } };
const red = { position: { x: -35, y: 20, elevation: 10 }, radius: 120, color: [1, .1, .05], intensity: .8 };
const blue = { position: { x: 35, y: 20, elevation: 10 }, radius: 120, color: [.05, .2, 1], intensity: .8 };
const scene = (probes, extra = {}) => ({ ...PROBE_BASE, ...extra, lighting: { ...PROBE_BASE.lighting, ...extra.lighting, ...(probes === undefined ? {} : { probes }) } });
export const PROBE_CASES = [
  { name: "plain", environment: scene() },
  { name: "empty", environment: scene([]) },
  { name: "single", environment: scene([red]) },
  { name: "black", environment: scene([{ ...red, intensity: 0 }]) },
  { name: "overlap", environment: scene([red, blue]) },
  { name: "reverse", environment: scene([blue, red]) },
  { name: "duplicate", environment: scene([red, red]) },
  { name: "eight", environment: scene(Array.from({ length: 8 }, (_, i) => ({ ...red, position: { x: -100 + i * 30, y: 20, elevation: 5 }, color: [i / 7, 1 - i / 7, .4] }))) },
  { name: "moved", environment: scene([{ ...red, position: { x: 70, y: 0, elevation: 0 } }]) },
  { name: "outside", environment: scene([{ ...red, position: { x: 1000, y: 1000, elevation: 1000 } }]) },
  { name: "hemisphere", environment: scene([red, blue], { lighting: { hemisphere: { skyColor: [.2, .4, .1], groundColor: [.3, .05, .1], intensity: .5 } } }) },
  { name: "legacy", environment: scene([red, blue], { composition: "legacy" }) },
  { name: "lighting-off-plain", environment: scene(undefined, { lighting: { enabled: false } }) },
  { name: "lighting-off", environment: scene([red, blue], { lighting: { enabled: false } }) },
  { name: "ao-zero", environment: scene([red, blue], { ambientOcclusion: { strength: 0, radius: 20, bias: .1 } }) },
  { name: "ao", environment: scene([red, blue], { ambientOcclusion: { strength: 1, radius: 20, bias: .1 } }), ao: true },
];
export const PROBE_STATES = [...PROBE_CASES.map(c => c.name), "saved", "fresh-restore", "off", "re-enabled"];
