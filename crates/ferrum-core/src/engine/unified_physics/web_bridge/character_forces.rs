use super::{entity, validate_handles, Engine, UnifiedPhysicsError};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    /// Character external-force commands, independent of the unchanged input/state layouts.
    pub fn unified_physics_character_force_version(&self) -> u32 {
        1
    }

    /// Atomic bulk admission: 0 adds persistent XYZ force, 1 clears forces,
    /// 2 queues a one-shot XYZ impulse. Duplicate rows add, including bound checks.
    /// Clear has no values; other commands have three floats per handle.
    pub fn command_unified_physics_character_forces(
        &mut self,
        code: u32,
        handles: &[u32],
        values: &[f32],
    ) -> Result<(), String> {
        let stride = match code {
            0 | 2 => 3,
            1 => 0,
            _ => return Err("Unknown unified physics character force command".into()),
        };
        validate_handles(handles)?;
        if values.len() != handles.len() / 2 * stride {
            return Err("Invalid unified physics character force row length".into());
        }
        let commands = handles
            .chunks_exact(2)
            .enumerate()
            .map(|(index, handle)| {
                let id = self
                    .unified_body_id(entity(handle))
                    .map_err(|e| e.to_string())?;
                let value = if stride == 0 {
                    [0.; 3]
                } else {
                    let start = index * stride;
                    [values[start], values[start + 1], values[start + 2]]
                };
                Ok((id, code, value))
            })
            .collect::<Result<Vec<_>, String>>()?;
        self.unified_physics
            .as_mut()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?
            .physics
            .apply_character_force_commands(&commands)
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::Entity;
    use crate::physics3d::{
        BodyDesc, BodyKind, CharacterConfig, ColliderDesc, Shape, Space, WorldConfig,
    };

    fn engine() -> (Engine, Entity) {
        let mut e = Engine::new();
        e.use_data_scene();
        e.configure_unified_physics(WorldConfig {
            space: Space::PlanarXy,
            gravity: [0.; 3],
            step_seconds: 0.01,
            ..Default::default()
        })
        .unwrap();
        let actor = e
            .create_unified_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.5,
                    radius: 0.25,
                }),
                [0.; 3],
            )
            .unwrap();
        e.enable_unified_character(
            actor,
            CharacterConfig {
                push_mass: 2.,
                ..Default::default()
            },
        )
        .unwrap();
        (e, actor)
    }
    fn bytes(e: &Engine) -> Vec<u8> {
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap()
            .encoded_bytes()
            .to_vec()
    }

    #[test]
    fn invalid_late_character_force_rows_and_duplicate_overflow_are_atomic() {
        let (mut e, actor) = engine();
        let h = [actor.id, actor.generation];
        e.command_unified_physics_character_forces(0, &h, &[3., 0., 0.])
            .unwrap();
        let before = bytes(&e);
        for (code, handles, values) in [
            (0, [h, [u32::MAX, 0]].concat(), vec![2., 0., 0., 1., 0., 0.]),
            (2, [h, h].concat(), vec![2., 0., 0., 0., 0., 1.]),
            (0, [h, h].concat(), vec![500_000., 0., 0., 500_000., 0., 0.]),
            (
                2,
                [h, h].concat(),
                vec![1_000_000., 0., 0., 1_000_000., 0., 0.],
            ),
            (0, [h, h].concat(), vec![2., 0., 0., f32::NAN, 0., 0.]),
            (1, h.to_vec(), vec![1.]),
            (3, h.to_vec(), vec![]),
        ] {
            assert!(e
                .command_unified_physics_character_forces(code, &handles, &values)
                .is_err());
            assert_eq!(bytes(&e), before);
        }
    }

    #[test]
    fn public_bulk_character_force_impulse_clear_and_checkpoint_preserve_ownership() {
        let (mut e, actor) = engine();
        let h = [actor.id, actor.generation];
        assert_eq!(e.unified_physics_character_force_version(), 1);
        e.command_unified_physics_character_forces(0, &[h, h].concat(), &[4., 0., 0., 4., 0., 0.])
            .unwrap();
        e.command_unified_physics_character_forces(2, &h, &[4., 0., 0.])
            .unwrap();
        let checkpoint = e.runtime_checkpoint().unwrap();
        let mut expected = Vec::new();
        for _ in 0..3 {
            assert!(e.step_unified_physics(0.01));
            expected.push(e.unified_body_state(actor).unwrap());
        }
        assert!(expected[0].linear_velocity[0] > 2. && expected[0].linear_velocity[0] < 2.1);
        assert!(expected[2].linear_velocity[0] > expected[0].linear_velocity[0]);
        assert!(e.restore_runtime_checkpoint(&checkpoint));
        for state in expected {
            assert!(e.step_unified_physics(0.01));
            assert_eq!(e.unified_body_state(actor).unwrap(), state);
        }
        let previous = e.unified_body_state(actor).unwrap().linear_velocity;
        e.command_unified_physics_character_forces(1, &h, &[])
            .unwrap();
        assert!(e.step_unified_physics(0.01));
        assert_eq!(
            e.unified_body_state(actor).unwrap().linear_velocity,
            previous
        );
    }
}
