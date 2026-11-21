//! Read-only presentation observations, independent of legacy snapshots.
use super::Engine;
use crate::components::gameplay::{ActionAimSource, ActionPattern, ProjectileCollisionTarget};
use crate::entity::Entity;
use crate::shooter_scene::{SHOOTER_DASH_ACTION_ID, SHOOTER_PRIMARY_FIRE_ACTION_ID};
use wasm_bindgen::prelude::*;

const MAX_POSITIONS: usize = 65_536;

#[wasm_bindgen]
impl Engine {
    /// One f64 row per input id/generation pair: valid (0/1), simulation XYZ.
    /// Stale/missing positions produce [0, 0, 0, 0], preserving order and duplicates.
    /// Native-bound entities use their simulation pose, independent of projection;
    /// other entities use their authored XY transform with Z zero.
    pub fn query_gameplay_positions(&self, handles: &[u32]) -> Result<Vec<f64>, String> {
        if !handles.len().is_multiple_of(2) || handles.len() / 2 > MAX_POSITIONS {
            return Err("Gameplay positions require at most 65536 id/generation pairs.".into());
        }
        let mut output = Vec::new();
        output
            .try_reserve_exact(handles.len() / 2 * 4)
            .map_err(|_| "Gameplay position output allocation failed.")?;
        for handle in handles.chunks_exact(2) {
            let entity = Entity {
                id: handle[0],
                generation: handle[1],
            };
            let position = if self.world.is_current_entity(entity) {
                match self.unified_gameplay_position(entity) {
                    Some(position) => position,
                    None => self.world.transform(entity).map(|p| [p.x, p.y, 0.]),
                }
            } else {
                None
            };
            if let Some([x, y, z]) = position.filter(|p| p.iter().all(|v| v.is_finite())) {
                output.extend_from_slice(&[1., f64::from(x), f64::from(y), f64::from(z)]);
            } else {
                output.extend_from_slice(&[0.; 4]);
            }
        }
        Ok(output)
    }

    /// Empty outside the built-in Shooter; otherwise wave index, elapsed seconds,
    /// spawned count. f64 represents the native f32 timer and u32 counts exactly.
    pub fn built_in_shooter_progress(&self) -> Vec<f64> {
        if !self.is_built_in_shooter() {
            return Vec::new();
        }
        let (index, elapsed, spawned) = self.scenes.shooter().progress();
        vec![f64::from(index), f64::from(elapsed), f64::from(spawned)]
    }

    /// Read-only built-in player's primary projectile and input-dash bindings.
    /// Ten f64 values: primary id/cooldown/remaining/speed/damage/lifetime,
    /// dash id/cooldown/remaining/distance. Zero id denotes an absent binding.
    pub fn built_in_shooter_player_actions(&self) -> Vec<f64> {
        let Some(player) = self.entity_from_handle(
            self.built_in_shooter_player_entity_id(),
            self.built_in_shooter_player_entity_generation(),
        ) else {
            return Vec::new();
        };
        let mut values = vec![0.; 10];
        if let Some(binding) = self
            .world
            .action_binding(player, SHOOTER_PRIMARY_FIRE_ACTION_ID)
        {
            if let ActionPattern::Projectile {
                speed,
                damage,
                lifetime_seconds,
                aim: ActionAimSource::Input,
                collision_target: ProjectileCollisionTarget::Enemies,
                ..
            } = binding.pattern
            {
                values[..6].copy_from_slice(&[
                    f64::from(binding.action_id),
                    f64::from(binding.cooldown.duration_seconds),
                    f64::from(binding.cooldown.remaining_seconds),
                    f64::from(speed),
                    f64::from(damage),
                    f64::from(lifetime_seconds),
                ]);
            }
        }
        if let Some(binding) = self.world.action_binding(player, SHOOTER_DASH_ACTION_ID) {
            if let ActionPattern::Dash {
                distance,
                aim: ActionAimSource::Input,
            } = binding.pattern
            {
                values[6..].copy_from_slice(&[
                    f64::from(binding.action_id),
                    f64::from(binding.cooldown.duration_seconds),
                    f64::from(binding.cooldown.remaining_seconds),
                    f64::from(distance),
                ]);
            }
        }
        values
    }
}

#[cfg(test)]
mod tests;
