use super::*;
use crate::physics3d::{BodyDesc, BodyKind, CharacterConfig, ColliderDesc, Pose, Shape};

fn configured(space: u32) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics_world(
        &[space, 1, 1, 1, 100, 200, 100, 20, 100],
        &[0.0, 0.0, 0.0, 0.01, 1.0, 0.0],
    )
    .unwrap();
    e
}
fn ball(e: &mut Engine) -> Entity {
    e.create_unified_body(
        BodyDesc::default(),
        ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
        [0.0; 3],
    )
    .unwrap()
}
fn handles(es: &[Entity]) -> Vec<u32> {
    es.iter().flat_map(|e| [e.id, e.generation]).collect()
}

#[test]
fn wire_configuration_rejects_invalid_layout_and_preserves_existing_world() {
    let mut e = configured(1);
    let original = e.unified_physics.as_ref().unwrap().physics.config().clone();
    for m in [
        vec![],
        vec![2, 1, 1, 1, 100, 200, 100, 20, 100],
        vec![0, 1, 1, 2, 100, 200, 100, 20, 100],
    ] {
        assert!(e.configure_unified_physics_world(&m, &[0.0; 6]).is_err());
    }
    assert!(e
        .configure_unified_physics_world(
            &[0, 1, 1, 1, 100, 200, 100, 20, 100],
            &[0.0, 0.0, 1.0, 0.01, 1.0, 0.0]
        )
        .is_err());
    assert_eq!(
        e.unified_physics.as_ref().unwrap().physics.config(),
        &original
    );
    let mut wrong = crate::engine::legacy_test_fixture::engine();
    wrong.use_platformer_scene();
    assert!(wrong
        .configure_unified_physics_world(
            &[1, 1, 1, 1, 100, 200, 100, 20, 100],
            &[0.0, 0.0, 0.0, 0.01, 1.0, 0.0]
        )
        .is_err());
    assert!(wrong.unified_physics.is_none());
}

#[test]
fn batch_rejects_invalid_last_row_without_modifying_or_waking_the_first() {
    let mut e = configured(0);
    let a = ball(&mut e);
    let b = ball(&mut e);
    let id = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_sleeping(id, true)
        .unwrap();
    let before = e.unified_body_state(a).unwrap();
    for invalid in [f32::NAN, f32::INFINITY, 1e7, 1.0] {
        let mut v = [0.0; 12];
        v[0] = 5.0;
        v[8] = invalid; // Nonzero planar Z is also rejected.
        assert!(e
            .set_unified_physics_velocities(&handles(&[a, b]), &v)
            .is_err());
        assert_eq!(e.unified_body_state(a).unwrap(), before);
    }
    let stale = Entity {
        id: b.id,
        generation: b.generation + 1,
    };
    assert!(e
        .set_unified_physics_velocities(&handles(&[a, stale]), &[1.0; 12])
        .is_err());
    assert_eq!(e.unified_body_state(a).unwrap(), before);
    assert!(e.set_unified_physics_velocities(&[a.id], &[]).is_err());
    assert!(e
        .set_unified_physics_velocities(&handles(&[a]), &[0.0; 5])
        .is_err());
    assert!(e
        .set_unified_physics_velocities(&vec![0; (MAX_BATCH + 1) * 2], &[])
        .is_err());
}

#[test]
fn spatial_bulk_state_uses_simulation_xyz_and_rejects_deleted_entities() {
    let mut e = configured(1);
    let a = ball(&mut e);
    e.set_unified_physics_velocities(&handles(&[a]), &[1.0, 2.0, 3.0, 0.0, 0.0, 0.0])
        .unwrap();
    e.update(f64::from(0.01_f32));
    e.query_unified_physics_body_states(&handles(&[a, a]))
        .unwrap();
    assert_eq!(e.unified_physics_body_state_count(), 2);
    let r = &e.unified_physics_body_states[0];
    assert_eq!(r.entity_id, a.id);
    assert_eq!(r.generation, a.generation);
    assert_eq!(r.flags, 0);
    assert_eq!(r.linear_velocity, [1.0, 2.0, 3.0]);
    for (v, expected) in r.position.iter().zip([0.01, 0.02, 0.03]) {
        assert!((v - expected).abs() < 1e-5);
    }
    e.world.despawn(a); // Native binding is still pending retirement.
    assert!(e.query_unified_physics_body_states(&handles(&[a])).is_err());
    assert_eq!(e.unified_physics_body_state_count(), 0);
    assert!(e
        .set_unified_physics_velocities(&handles(&[a]), &[0.0; 6])
        .is_err());
}

#[test]
fn batch_preserves_controller_and_rotation_lock_ownership() {
    let mut e = configured(1);
    let a = ball(&mut e);
    let b = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [4.0, 0.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.2,
            }),
            [0.0; 3],
        )
        .unwrap();
    e.enable_unified_character(b, CharacterConfig::default())
        .unwrap();
    assert!(e
        .set_unified_physics_velocities(&handles(&[a, b]), &[1.0; 12])
        .is_err());
    assert_eq!(e.unified_body_state(a).unwrap().linear_velocity, [0.0; 3]);
    let id = e.unified_body_id(a).unwrap();
    let p = &mut e.unified_physics.as_mut().unwrap().physics;
    let opts = crate::physics3d::BodyOptions {
        lock_rotation: true,
        ..Default::default()
    };
    p.set_body_options(id, &opts).unwrap();
    assert!(e
        .set_unified_physics_velocities(&handles(&[a]), &[2.0, 0.0, 0.0, 0.0, 0.0, 1.0])
        .is_err());
    assert_eq!(e.unified_body_state(a).unwrap().linear_velocity, [0.0; 3]);
}

#[test]
fn duplicate_velocity_rows_use_the_last_command_and_empty_batches_require_a_world() {
    let mut e = configured(0);
    let a = ball(&mut e);
    e.set_unified_physics_velocities(
        &handles(&[a, a]),
        &[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    )
    .unwrap();
    assert_eq!(
        e.unified_body_state(a).unwrap().linear_velocity,
        [2.0, 0.0, 0.0]
    );
    e.query_unified_physics_body_states(&[]).unwrap();
    e.set_unified_physics_velocities(&[], &[]).unwrap();
    let mut e = crate::engine::legacy_test_fixture::engine();
    assert!(e.query_unified_physics_body_states(&[]).is_err());
    assert!(e.set_unified_physics_velocities(&[], &[]).is_err());
}
