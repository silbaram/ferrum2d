import type { Engine } from "../pkg/ferrum_core.js";
import { finiteNumber, uint32Number } from "./particlePreset.js";
export interface PhysicsImpactFeedbackProfile {
  /** Collision category bits representing a material; first qualifying profile wins. */
  categoryBits: number;
  minImpulse?: number;
  cooldownSeconds?: number;
  soundId?: number;
  particlePresetId?: number;
  volume?: number;
}
export interface PhysicsImpactFeedbackStats { emitted: number; dropped: number; activeCooldowns: number }
export function configureImpactFeedback(engine: Engine, profiles: readonly PhysicsImpactFeedbackProfile[]): void {
  if (profiles.length > 32) throw new RangeError("at most 32 impact profiles");
  const packet = new Float64Array(profiles.length * 6);
  profiles.forEach((p, index) => {
    const mask = uint32Number(p.categoryBits, "categoryBits");
    const sound = p.soundId === undefined ? 0xffffffff : uint32Number(p.soundId, "soundId");
    const particle = p.particlePresetId === undefined ? 0xffffffff : uint32Number(p.particlePresetId, "particlePresetId");
    const impulse = finiteNumber(p.minImpulse ?? 1, "minImpulse");
    const cooldown = finiteNumber(p.cooldownSeconds ?? 0.15, "cooldownSeconds");
    const volume = finiteNumber(p.volume ?? 1, "volume");
    if (mask === 0 || impulse < 0 || impulse > 3.402823466e38 || cooldown < 0 || cooldown > 60 || volume < 0 || volume > 1 || (p.soundId !== undefined && sound > 16777216)) throw new RangeError("invalid impact feedback profile");
    packet.set([mask, impulse, cooldown, sound, particle, volume], index * 6);
  });
  if (!engine.configure_physics_impact_feedback(packet)) throw new Error("impact feedback rejected; register particle presets first");
}
