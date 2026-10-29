/** Web Audio coordinates: X right, Y up, forward -Z. Distances use the same unit as positions. */
export interface SpatialAudioOptions {
  x: number;
  y: number;
  z?: number;
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  distanceModel?: DistanceModelType;
  panningModel?: PanningModelType;
  direction?: { x: number; y: number; z: number };
  coneInnerAngle?: number;
  coneOuterAngle?: number;
  coneOuterGain?: number;
  loop?: boolean;
}

export interface SpatialAudioVoice {
  readonly active: boolean;
  /** false means a browser without PannerNode is playing ordinary SFX. */
  readonly spatialized: boolean;
  setPose(x: number, y: number, z: number, directionX?: number, directionY?: number, directionZ?: number): void;
  setVolume(volume: number): void;
  stop(): void;
}

export function audioNumber(value: number, label: string, min = -1e9, max = 1e9): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Spatial audio ${label} must be finite in [${min}, ${max}].`);
  }
  return value;
}

export function validateSpatialAudioOptions(options: SpatialAudioOptions): void {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Spatial audio options must be an object.");
  for (const key of ["z", "refDistance", "maxDistance", "rolloffFactor", "coneInnerAngle", "coneOuterAngle", "coneOuterGain"] as const) {
    if (options[key] !== undefined) audioNumber(options[key]!, key);
  }
  if (options.distanceModel !== undefined && !["linear", "inverse", "exponential"].includes(options.distanceModel)) throw new Error("Invalid spatial audio distanceModel.");
  if (options.panningModel !== undefined && !["equalpower", "HRTF"].includes(options.panningModel)) throw new Error("Invalid spatial audio panningModel.");
  audioNumber(options.x, "x"); audioNumber(options.y, "y"); audioNumber(options.z ?? 0, "z");
  const ref = audioNumber(options.refDistance ?? 1, "refDistance", 1e-6);
  const max = audioNumber(options.maxDistance ?? 10000, "maxDistance", 1e-6);
  if (max <= ref) throw new Error("Spatial audio maxDistance must exceed refDistance.");
  const model = options.distanceModel ?? "inverse";
  if (!["linear", "inverse", "exponential"].includes(model)) throw new Error("Invalid spatial audio distanceModel.");
  if (!["equalpower", "HRTF"].includes(options.panningModel ?? "equalpower")) throw new Error("Invalid spatial audio panningModel.");
  audioNumber(options.rolloffFactor ?? 1, "rolloffFactor", 0, model === "linear" ? 1 : 64);
  const inner = audioNumber(options.coneInnerAngle ?? 360, "coneInnerAngle", 0, 360);
  const outer = audioNumber(options.coneOuterAngle ?? 360, "coneOuterAngle", 0, 360);
  if (outer < inner) throw new Error("Spatial audio coneOuterAngle must be at least coneInnerAngle.");
  audioNumber(options.coneOuterGain ?? 0, "coneOuterGain", 0, 1);
  if (options.loop !== undefined && typeof options.loop !== "boolean") throw new Error("Spatial audio loop must be boolean.");
  if (options.direction !== undefined) {
    if (!options.direction || typeof options.direction !== "object" || Array.isArray(options.direction)) throw new Error("Spatial audio direction must be an object.");
    validateAudioDirection(options.direction.x, options.direction.y, options.direction.z);
  }
}

export function validateAudioDirection(x: number, y: number, z: number): number {
  audioNumber(x, "direction.x"); audioNumber(y, "direction.y"); audioNumber(z, "direction.z");
  const length = Math.hypot(x, y, z);
  if (length < 1e-12) throw new Error("Spatial audio direction must be nonzero.");
  return length;
}

function param3(x: AudioParam, y: AudioParam, z: AudioParam, a: number, b: number, c: number, time: number): void {
  x.setValueAtTime(a, time); y.setValueAtTime(b, time); z.setValueAtTime(c, time);
}

export function setAudioListenerPosition(context: AudioContext, x: number, y: number, z: number): void {
  audioNumber(x, "listener.x"); audioNumber(y, "listener.y"); audioNumber(z, "listener.z");
  const listener = context.listener;
  if (listener.positionX) param3(listener.positionX, listener.positionY, listener.positionZ, x, y, z, context.currentTime);
  else listener.setPosition?.(x, y, z);
}

export function validateAudioListenerPose(x: number, y: number, z: number,
  fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
  audioNumber(x, "listener.x"); audioNumber(y, "listener.y"); audioNumber(z, "listener.z");
  const f = validateAudioDirection(fx, fy, fz), u = validateAudioDirection(ux, uy, uz);
  if (Math.abs((fx * ux + fy * uy + fz * uz) / (f * u)) > .999) throw new Error("Spatial audio listener forward/up must not be parallel.");
}

export function setAudioListenerPose(context: AudioContext, x: number, y: number, z: number,
  fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
  validateAudioListenerPose(x, y, z, fx, fy, fz, ux, uy, uz);
  const f = Math.hypot(fx, fy, fz), u = Math.hypot(ux, uy, uz);
  const listener = context.listener, time = context.currentTime;
  setAudioListenerPosition(context, x, y, z);
  if (listener.forwardX) {
    param3(listener.forwardX, listener.forwardY, listener.forwardZ, fx / f, fy / f, fz / f, time);
    param3(listener.upX, listener.upY, listener.upZ, ux / u, uy / u, uz / u, time);
  } else listener.setOrientation?.(fx / f, fy / f, fz / f, ux / u, uy / u, uz / u);
}

/** Cold node creation. The returned voice reuses these nodes for every pose update. */
export function startSpatialAudioVoice(context: AudioContext, buffer: AudioBuffer, destination: AudioNode,
  options: SpatialAudioOptions, volume: number, pitch: number, onEnded: (voice: SpatialAudioVoice) => void): SpatialAudioVoice {
  validateSpatialAudioOptions(options); audioNumber(volume, "volume", 0, 16); audioNumber(pitch, "pitch", .01, 16);
  let source: AudioBufferSourceNode | undefined, gain: GainNode | undefined, panner: PannerNode | undefined;
  let active = true, spatialized = false;
  let clock: AudioContext | undefined = context;
  let notify: ((voice: SpatialAudioVoice) => void) | undefined = onEnded;
  const cleanup = () => {
    if (!active) return;
    active = false;
    if (source) source.onended = null;
    for (const node of [source, panner, gain]) { try { node?.disconnect(); } catch { /* Already released by the platform. */ } }
    source = undefined; panner = undefined; gain = undefined; clock = undefined;
    const ended = notify; notify = undefined; ended?.(voice);
  };
  const voice: SpatialAudioVoice = {
    get active() { return active; },
    get spatialized() { return spatialized; },
    setPose(x, y, z, dx = 0, dy = 0, dz = -1) {
      audioNumber(x, "x"); audioNumber(y, "y"); audioNumber(z, "z");
      const length = validateAudioDirection(dx, dy, dz);
      if (!active || !panner || !clock) return;
      if (panner.positionX) {
        param3(panner.positionX, panner.positionY, panner.positionZ, x, y, z, clock.currentTime);
        param3(panner.orientationX, panner.orientationY, panner.orientationZ, dx / length, dy / length, dz / length, clock.currentTime);
      } else { panner.setPosition(x, y, z); panner.setOrientation(dx / length, dy / length, dz / length); }
    },
    setVolume(value) { audioNumber(value, "volume", 0, 16); if (active && gain && clock) gain.gain.setValueAtTime(value, clock.currentTime); },
    stop() { if (!active) return; try { source?.stop(); } catch { /* The browser may already have ended it. */ } finally { cleanup(); } },
  };
  try {
    source = context.createBufferSource(); gain = context.createGain();
    if (typeof context.createPanner === "function") { panner = context.createPanner(); spatialized = true; }
    source.buffer = buffer; source.loop = options.loop ?? false; source.playbackRate.value = pitch;
    gain.gain.value = volume;
    if (panner) {
      panner.panningModel = options.panningModel ?? "equalpower";
      panner.distanceModel = options.distanceModel ?? "inverse";
      panner.refDistance = options.refDistance ?? 1; panner.maxDistance = options.maxDistance ?? 10000;
      panner.rolloffFactor = options.rolloffFactor ?? 1;
      panner.coneInnerAngle = options.coneInnerAngle ?? 360; panner.coneOuterAngle = options.coneOuterAngle ?? 360;
      panner.coneOuterGain = options.coneOuterGain ?? 0;
      voice.setPose(options.x, options.y, options.z ?? 0, options.direction?.x, options.direction?.y, options.direction?.z);
      source.connect(panner); panner.connect(gain);
    } else source.connect(gain);
    gain.connect(destination); source.onended = cleanup;
    source.start();
    return voice;
  } catch (error) { cleanup(); throw error; }
}
