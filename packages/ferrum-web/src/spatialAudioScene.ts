import type { AudioManager } from "./audioManager.js";
import type { AudioPoseBufferView } from "./audioPoseBuffer.js";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { SpatialPoint, SpatialRenderBufferView } from "./dataSceneSpatial.js";
import { audioNumber, validateSpatialAudioOptions } from "./spatialAudio.js";
import type { SpatialAudioOptions, SpatialAudioVoice } from "./spatialAudio.js";

export type SpatialAudioListener = "camera" | { instanceId: string; offset?: SpatialPoint };
export interface SpatialAudioSourceSpec {
  id: string;
  sound: string;
  /** Exactly one of instanceId/position. Instance offsets rotate with the native body yaw. */
  instanceId?: string;
  position?: SpatialPoint;
  offset?: SpatialPoint;
  options?: Omit<SpatialAudioOptions, "x" | "y" | "z">;
  volume?: number;
  pitch?: number;
}
export interface SpatialAudioSceneSpec {
  listener: SpatialAudioListener;
  sources: readonly SpatialAudioSourceSpec[];
}
export interface SpatialAudioScene {
  /** Call after rendering the frame. Camera pose is copied before the single bulk native query. */
  update(frame?: SpatialRenderBufferView): void;
  setEnabled(enabled: boolean): void;
  setListener(listener: SpatialAudioListener): void;
  /** Rebind current/live-only handles. Missing instances stay silent until a later rebind supplies them. */
  rebind(handles: Readonly<Record<string, GameplayEntityHandle>>): void;
  destroy(): void;
}
interface PoseReader { queryAudioPoseBuffer(handles: Uint32Array): AudioPoseBufferView }
const zero = { x: 0, y: 0, elevation: 0 };
function name(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) throw new Error("Spatial audio names must contain 1..128 characters.");
  return value;
}
function point(value: SpatialPoint): SpatialPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Spatial audio point must be an object.");
  return { x: audioNumber(value.x, "point.x"), y: audioNumber(value.y, "point.y"), elevation: audioNumber(value.elevation, "point.elevation") };
}
function listenerSpec(value: SpatialAudioListener): SpatialAudioListener {
  if (value === "camera") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid spatial audio listener.");
  return { instanceId: name(value.instanceId), offset: point(value.offset === undefined ? zero : value.offset) };
}

/** Platform binding metadata only; simulation positions/generations come from one native bulk query. */
export function createSpatialAudioScene(engine: PoseReader, audio: AudioManager, spec: SpatialAudioSceneSpec,
  options: { handles: Readonly<Record<string, GameplayEntityHandle>>; soundId: (name: string) => number; allowMissingEntities?: boolean }): SpatialAudioScene {
  if (!spec || !Array.isArray(spec.sources) || spec.sources.length > 64) throw new Error("Spatial audio scene supports at most 64 sources.");
  if (!options || typeof options !== "object" || typeof options.soundId !== "function") throw new Error("Spatial audio binding options require a soundId resolver.");
  if (options.allowMissingEntities !== undefined && typeof options.allowMissingEntities !== "boolean") throw new Error("Spatial audio allowMissingEntities must be boolean.");
  const allowMissing = options.allowMissingEntities === true;
  let listener = listenerSpec(spec.listener), handles = options.handles;
  const ids = new Set<string>();
  const sources = spec.sources.map(s => {
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("Invalid spatial audio source.");
    const id = name(s.id); if (ids.has(id)) throw new Error(`Duplicate spatial audio source '${id}'.`); ids.add(id);
    if ((s.instanceId === undefined) === (s.position === undefined)) throw new Error("Spatial audio source requires exactly one instanceId/position.");
    if (s.options !== undefined && (!s.options || typeof s.options !== "object" || Array.isArray(s.options))) throw new Error("Invalid spatial audio source options.");
    const settings = { ...s.options, direction: s.options?.direction && { ...s.options.direction } };
    validateSpatialAudioOptions({ ...settings, x: 0, y: 0, z: 0 });
    // Direction magnitude has no meaning. Normalize before rotating so valid large
    // input vectors cannot leave the numeric domain during a native yaw update.
    if (settings.direction) {
      const d = settings.direction, length = Math.hypot(d.x, d.y, d.z);
      d.x /= length; d.y /= length; d.z /= length;
    }
    const soundId = options.soundId(name(s.sound));
    if (!Number.isSafeInteger(soundId) || soundId <= 0 || !audio.hasSound(soundId)) throw new Error(`Spatial audio source '${id}' requires a loaded sound.`);
    const position = s.position === undefined ? undefined : point(s.position);
    const offset = point(s.offset === undefined ? zero : s.offset);
    if (position) {
      audioNumber(position.x + offset.x, "source.x"); audioNumber(position.y + offset.y, "source.y");
      audioNumber(position.elevation + offset.elevation, "source.elevation");
    }
    return { id, soundId, instanceId: s.instanceId === undefined ? undefined : name(s.instanceId),
      position, offset,
      settings, volume: audioNumber(s.volume === undefined ? 1 : s.volume, "volume", 0, 16),
      pitch: audioNumber(s.pitch === undefined ? 1 : s.pitch, "pitch", .01, 16) };
  });
  let targetHandles = new Uint32Array(0), listenerRow = -1, sourceRows = new Int32Array(sources.length);
  let enabled = true, destroyed = false;
  const voices: SpatialAudioVoice[] = [], pose = new Float64Array(6), camera = new Float64Array(9);
  function bind(nextHandles: typeof handles, nextListener: SpatialAudioListener,
    missing: { sources: boolean; listener: boolean }) {
    if (!nextHandles || typeof nextHandles !== "object" || Array.isArray(nextHandles)) throw new Error("Spatial audio handles must be an object.");
    const entries: number[] = [], rows = new Int32Array(sources.length).fill(-1);
    const append = (id: string, optional: boolean) => {
      if (!Object.prototype.hasOwnProperty.call(nextHandles, id) && optional) return -1;
      const h = Object.prototype.hasOwnProperty.call(nextHandles, id) ? nextHandles[id] : undefined;
      if (!h || !Number.isInteger(h.entityId) || h.entityId < 0 || h.entityId > 0xffffffff
        || !Number.isInteger(h.entityGeneration) || h.entityGeneration < 0 || h.entityGeneration > 0xffffffff) throw new Error(`Missing/invalid spatial audio entity '${id}'.`);
      const row = entries.length / 2; entries.push(h.entityId, h.entityGeneration); return row;
    };
    const nextListenerRow = nextListener === "camera" ? -1 : append(nextListener.instanceId, missing.listener);
    sources.forEach((s, i) => { if (s.instanceId !== undefined) rows[i] = append(s.instanceId, missing.sources); });
    targetHandles = Uint32Array.from(entries); sourceRows = rows; listenerRow = nextListenerRow;
    handles = nextHandles; listener = nextListener;
  }
  bind(handles, listener, { sources: allowMissing, listener: allowMissing });
  const alive = () => { if (destroyed) throw new Error("Spatial audio scene has been destroyed."); };
  const mute = () => { for (const voice of voices) voice.setVolume(0); };
  function entityPose(view: AudioPoseBufferView, row: number, offset: SpatialPoint): boolean {
    const at = row * 8;
    if (!view.words[at] || view.words[at + 1] !== targetHandles[row * 2] || view.words[at + 2] !== targetHandles[row * 2 + 1]) return false;
    const yaw = view.floats[at + 7], c = Math.cos(yaw), s = Math.sin(yaw);
    pose[0] = view.floats[at + 4] + c * offset.x - s * offset.y;
    pose[1] = view.floats[at + 6] + offset.elevation;
    pose[2] = -(view.floats[at + 5] + s * offset.x + c * offset.y);
    pose[3] = -s; pose[4] = 0; pose[5] = -c;
    return pose.every(v => Number.isFinite(v) && Math.abs(v) <= 1e9);
  }
  const scene: SpatialAudioScene = {
    update(frame) {
      alive();
      if (!enabled) return;
      if (listener !== "camera" && listenerRow < 0) { mute(); return; }
      if (listener === "camera") {
        const v = frame?.camera;
        if (!v || v.length !== 28 || !v.every(Number.isFinite)) { mute(); return; }
        camera[0] = v[17]; camera[1] = v[18]; camera[2] = v[19];
        if (Math.abs(camera[0]) > 1e9 || Math.abs(camera[1]) > 1e9 || Math.abs(camera[2]) > 1e9) { mute(); return; }
        const fx = v[20] - v[17], fy = v[21] - v[18], fz = v[22] - v[19], len = Math.hypot(fx, fy, fz);
        if (len < 1e-12) { mute(); return; }
        camera[3] = fx / len; camera[4] = fy / len; camera[5] = fz / len;
        // Same Y-up look-at basis as the native spatial camera. A vertical camera is invalid.
        const side = Math.hypot(camera[3], camera[5]);
        if (side < 1e-12) { mute(); return; }
        const rx = -camera[5] / side, rz = camera[3] / side;
        camera[6] = -rz * camera[4];
        camera[7] = rz * camera[3] - rx * camera[5];
        camera[8] = rx * camera[4];
      }
      const view = engine.queryAudioPoseBuffer(targetHandles);
      if (view.count !== targetHandles.length / 2 || view.stride !== 8 || view.words.length !== view.count * 8 || view.floats.length !== view.count * 8) throw new Error("Invalid audio pose buffer.");
      if (listener === "camera") audio.setListenerPose(camera[0],camera[1],camera[2],camera[3],camera[4],camera[5],camera[6],camera[7],camera[8]);
      else {
        if (!entityPose(view, listenerRow, listener.offset ?? zero)) { mute(); return; }
        audio.setListenerPose(pose[0],pose[1],pose[2],pose[3],pose[4],pose[5]);
      }
      sources.forEach((s, i) => {
        const voice = voices[i]; if (!voice.active) return;
        if (s.instanceId !== undefined) {
          if (sourceRows[i] < 0 || !entityPose(view, sourceRows[i], s.offset)) { voice.setVolume(0); return; }
          const d = s.settings.direction;
          if (d) {
            const angle = view.floats[sourceRows[i]*8+7], c = Math.cos(angle), sn = Math.sin(angle);
            pose[3] = c*d.x + sn*d.z; pose[4] = d.y; pose[5] = -sn*d.x + c*d.z;
          }
          voice.setPose(pose[0],pose[1],pose[2],pose[3],pose[4],pose[5]);
        } else {
          const p = s.position!, d = s.settings.direction;
          voice.setPose(p.x+s.offset.x,p.elevation+s.offset.elevation,-(p.y+s.offset.y),d?.x,d?.y,d?.z);
        }
        voice.setVolume(s.volume);
      });
    },
    setEnabled(value) { alive(); if (typeof value !== "boolean") throw new Error("Spatial audio enabled must be boolean."); enabled = value; if (!value) mute(); },
    setListener(next) { alive(); bind(handles, listenerSpec(next), { sources: true, listener: allowMissing }); mute(); },
    rebind(next) { alive(); bind(next, listener, { sources: true, listener: true }); mute(); },
    destroy() { if (destroyed) return; destroyed = true; for (const voice of voices) voice.stop(); },
  };
  try {
    for (const s of sources) {
      const voice = audio.playSpatial(s.soundId, { ...s.settings, x: 0, y: 0, z: 0, loop: s.settings.loop ?? true }, 0, s.pitch);
      if (!voice) throw new Error("Spatial audio voice could not start.");
      voices.push(voice);
    }
    return scene;
  } catch (error) { scene.destroy(); throw error; }
}
