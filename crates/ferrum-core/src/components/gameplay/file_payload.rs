//! Shared readonly predicates for World and captured gameplay authoring payloads.
//! These are external-file finite/layout policies, not constructor normalization.
use super::*;

fn finite(values: &[f32]) -> bool {
    values.iter().all(|v| v.is_finite())
}

pub(crate) fn cooldown(c: Cooldown) -> bool {
    finite(&[c.duration_seconds, c.remaining_seconds])
}
fn target(t: MovementTarget) -> bool {
    match t {
        MovementTarget::NearestFaction(id) | MovementTarget::NearestTag(id) => id < 32,
        // Entity targets are resolver-safe tokens. Target despawn/reuse/reset
        // deliberately leaves stale handles; there is no alive requirement.
        _ => true,
    }
}
pub(crate) fn movement(m: MovementPattern) -> bool {
    match m {
        MovementPattern::Static => true,
        MovementPattern::TopdownInput { speed } => speed.is_finite(),
        MovementPattern::PlatformerInput {
            horizontal_speed,
            gravity,
            jump_speed,
            max_fall_speed,
            ground_probe_distance,
            step_offset,
            coyote_time_seconds,
            jump_buffer_seconds,
        } => finite(&[
            horizontal_speed,
            gravity,
            jump_speed,
            max_fall_speed,
            ground_probe_distance,
            step_offset,
            coyote_time_seconds,
            jump_buffer_seconds,
        ]),
        MovementPattern::Linear { vx, vy } => finite(&[vx, vy]),
        MovementPattern::Oscillate {
            origin_x,
            origin_y,
            amplitude_x,
            amplitude_y,
            phase_speed,
        } => finite(&[origin_x, origin_y, amplitude_x, amplitude_y, phase_speed]),
        MovementPattern::MoveToPoint { x, y, speed } => finite(&[x, y, speed]),
        MovementPattern::Chase { target: t, speed } => target(t) && speed.is_finite(),
        MovementPattern::SeekTarget {
            target: t,
            speed,
            turn_rate,
        } => target(t) && finite(&[speed, turn_rate]),
        MovementPattern::Orbit {
            target: t,
            speed,
            radius,
            radial_band,
        } => target(t) && finite(&[speed, radius, radial_band]),
        MovementPattern::Accelerate {
            acceleration_x,
            acceleration_y,
            max_speed,
        } => finite(&[acceleration_x, acceleration_y, max_speed]),
    }
}
fn projectile(speed: f32, damage: f32, lifetime_seconds: f32) -> bool {
    finite(&[speed, damage, lifetime_seconds])
}
pub(crate) fn action(p: ActionPattern) -> bool {
    match p {
        ActionPattern::Projectile {
            speed,
            damage,
            lifetime_seconds,
            ..
        } => projectile(speed, damage, lifetime_seconds),
        ActionPattern::Dash { distance, .. } => distance.is_finite(),
        ActionPattern::Melee { range, damage, .. } => finite(&[range, damage]),
        ActionPattern::SpawnPrefab {
            projectile: p,
            offset_x,
            offset_y,
            ..
        } => {
            finite(&[offset_x, offset_y])
                && p.is_none_or(|p| projectile(p.speed, p.damage, p.lifetime_seconds))
        }
    }
}
pub(crate) fn reaction(r: CollisionReaction) -> bool {
    match r {
        CollisionReaction::Damage { .. }
        | CollisionReaction::Pickup { .. }
        | CollisionReaction::Despawn { .. } => true,
        CollisionReaction::AreaDamage { radius, .. } => radius.is_finite(),
        CollisionReaction::Knockback { impulse, .. } => impulse.is_finite(),
        CollisionReaction::PlaySound {
            volume,
            pitch,
            cooldown: c,
            ..
        } => finite(&[volume, pitch]) && cooldown(c),
        CollisionReaction::SpawnParticle { cooldown: c, .. }
        | CollisionReaction::CameraShake { cooldown: c, .. } => cooldown(c),
        CollisionReaction::EmitEffect {
            intensity,
            radius,
            cooldown: c,
            ..
        } => finite(&[intensity, radius]) && cooldown(c),
        CollisionReaction::SpawnPrefab {
            offset_x,
            offset_y,
            cooldown: c,
            ..
        } => finite(&[offset_x, offset_y]) && cooldown(c),
    }
}
