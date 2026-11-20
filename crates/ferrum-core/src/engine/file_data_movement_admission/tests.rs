use super::*;
use crate::components::{AabbCollider, CollisionLayer, RigidBody, Transform2D};
use crate::engine::persistence;
use crate::entity::Entity;

fn limits() -> Limits {
    Limits {
        max_work: 10_000_000,
        max_scratch_bytes: 10_000_000,
    }
}
fn bytes(engine: &Engine) -> Vec<u8> {
    persistence::encode(engine).unwrap()
}
fn spawn(engine: &mut Engine, x: f32, y: f32, layer: u32) -> Entity {
    assert!(engine.spawn_data_scene_entity(
        x,
        y,
        0.0,
        0,
        1,
        8.0,
        8.0,
        0.0,
        0.0,
        1.0,
        1.0,
        0,
        0.0,
        layer,
        crate::engine::PHYSICS_COLLIDER_TYPE_AABB,
        0.0,
        0.0,
        true,
        false,
        1.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        Vec::new(),
    ));
    Entity {
        id: engine.data_scene_entity_id(),
        generation: engine.data_scene_entity_generation(),
    }
}
pub(in crate::engine) fn fixture(native: bool) -> (Engine, Entity, Entity) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = spawn(&mut engine, 10.0, 50.0, crate::engine::PHYSICS_LAYER_PLAYER);
    engine.world.set_rigid_body(actor, RigidBody::kinematic());
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    let gate = spawn(&mut engine, 30.0, 10.0, crate::engine::PHYSICS_LAYER_WALL);
    engine.world.set_rigid_body(gate, RigidBody::static_body());
    let fixed = spawn(&mut engine, 130.0, 10.0, crate::engine::PHYSICS_LAYER_WALL);
    engine.world.set_rigid_body(fixed, RigidBody::static_body());
    assert!(engine.configure_data_scene_navigation_with_obstacles(
        5,
        5,
        20.0,
        20.0,
        -0.0,
        0.0,
        &[1; 25],
        &[
            gate.id,
            gate.generation,
            0,
            fixed.id,
            fixed.generation,
            3,
            3,
            0,
            1,
            0,
            4,
            0,
        ]
    ));
    let descriptors: Vec<f32> = (0..8).flat_map(|id| [id as f32, 2.0, 4.0, 1.0]).collect();
    let frames: Vec<f32> = (0..8)
        .flat_map(|_| [0.0, 0.0, 0.5, 1.0, 0.5, 0.0, 1.0, 1.0])
        .collect();
    assert!(engine.configure_data_scene_sprite_clips(
        actor.id,
        actor.generation,
        &descriptors,
        &frames,
        0
    ));
    let poses: Vec<u32> = (0..8).flat_map(|id| [id, id % 2, (id / 2) % 2]).collect();
    assert!(engine.configure_data_scene_movement_animation(&poses, 3));
    if native {
        engine
            .configure_unified_physics(crate::physics3d::WorldConfig {
                space: crate::physics3d::Space::PlanarXy,
                gravity: [0.0; 3],
                step_seconds: 0.01,
                ..Default::default()
            })
            .unwrap();
    }
    assert!(engine.move_data_scene_actor_to(90.0, 50.0, 3.0, 0.0, u32::MAX, true));
    (engine, actor, gate)
}
fn check(engine: &Engine) -> Usage {
    let original = bytes(engine);
    let usage = validate(engine, limits()).unwrap();
    assert_eq!(bytes(engine), original);
    let restored = persistence::decode(&original).unwrap();
    let decoded_usage = validate(&restored, limits()).unwrap();
    // BinaryHeap's wire stores its sequence, not reserved capacity. The live
    // source may have larger backing storage than a fresh decoded candidate.
    // Repeated decodes of the same file must have identical metered usage.
    let repeated = persistence::decode(&original).unwrap();
    assert_eq!(validate(&repeated, limits()), Ok(decoded_usage));
    assert_eq!(bytes(&restored), original);
    usage
}

#[test]
fn file_data_movement_public_producers_actual_codec_and_six_tick_continuation() {
    for native in [false, true] {
        let (mut engine, _, _) = fixture(native);
        check(&engine);
        let mut restored = persistence::decode(&bytes(&engine)).unwrap();
        for delta in [0.0, 0.004, 0.015, 0.1, 0.25, 0.01] {
            engine.update(delta);
            restored.update(delta);
            check(&engine);
            check(&restored);
            assert_eq!(bytes(&engine), bytes(&restored));
        }
    }
}

#[test]
fn file_data_movement_pending_obstacle_geometry_despawn_and_grid_replacement_are_history() {
    for change in 0..4 {
        let (mut engine, _, gate) = fixture(false);
        engine.update(0.1);
        match change {
            0 => {
                engine.world.despawn(gate);
            }
            1 => engine
                .world
                .set_transform(gate, Transform2D { x: 130.0, y: 10.0 }),
            2 => {
                assert!(engine.clear_data_scene_navigation());
            }
            3 => {
                assert!(engine.configure_data_scene_navigation(1, 1, 5.0, 5.0, 200.0, 200.0, &[1]));
            }
            _ => unreachable!(),
        }
        // Do not synchronize/replan before serializing this legitimate boundary.
        check(&engine);
        let mut restored = persistence::decode(&bytes(&engine)).unwrap();
        for _ in 0..6 {
            engine.update(0.01);
            restored.update(0.01);
            assert_eq!(bytes(&engine), bytes(&restored));
            check(&engine);
        }
    }
}

#[test]
fn file_data_movement_stale_actor_and_animation_binding_are_retired_by_existing_consumer() {
    let (mut engine, actor, _) = fixture(false);
    engine.world.despawn(actor);
    check(&engine);
    let mut restored = persistence::decode(&bytes(&engine)).unwrap();
    engine.update(0.01);
    restored.update(0.01);
    assert_eq!(engine.data_scene_move_status(), 4);
    assert_eq!(bytes(&engine), bytes(&restored));
    check(&engine);
}

#[test]
fn file_data_movement_actual_valid_crc_owner_damage_is_rejected_without_repair() {
    let (live, _, _) = fixture(false);
    let original = bytes(&live);
    for case in 0..14 {
        let mut candidate = persistence::decode(&original).unwrap();
        match case {
            0..=4 => candidate
                .data_scene
                .movement
                .corrupt_file_movement_fixture(case),
            5..=7 => candidate
                .data_scene
                .movement_animation
                .corrupt_file_animation_fixture(case - 5),
            8..=13 => candidate
                .data_scene
                .navigation_obstacles
                .corrupt_file_obstacles_fixture(case - 8),
            _ => unreachable!(),
        }
        let malformed = bytes(&candidate); // actual header and CRC, no raw mock.
        let decoded = persistence::decode(&malformed).unwrap();
        assert!(
            matches!(validate(&decoded, limits()), Err(Error::Invalid { .. })),
            "case {case}"
        );
        assert_eq!(bytes(&decoded), malformed);
        assert_eq!(bytes(&live), original);
    }
    check(&live);
}

#[test]
fn file_data_movement_shared_exact_and_one_below_work_scratch_budgets_are_readonly() {
    let (engine, _, _) = fixture(false);
    let original = bytes(&engine);
    let usage = check(&engine);
    assert!(usage.scratch_bytes > 0);
    assert_eq!(
        validate(
            &engine,
            Limits {
                max_work: usage.work,
                max_scratch_bytes: usage.scratch_bytes
            }
        ),
        Ok(usage)
    );
    assert!(validate(
        &engine,
        Limits {
            max_work: usage.work - 1,
            max_scratch_bytes: usage.scratch_bytes
        }
    )
    .is_err());
    assert!(validate(
        &engine,
        Limits {
            max_work: usage.work,
            max_scratch_bytes: usage.scratch_bytes - 1
        }
    )
    .is_err());
    assert_eq!(bytes(&engine), original);
}

#[test]
fn file_data_movement_maximum_automatic_overlay_is_charged_before_enumeration() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let mut bindings = Vec::new();
    for _ in 0..64 {
        let gate = engine.world.spawn_entity();
        engine
            .world
            .set_transform(gate, Transform2D { x: 32.0, y: 32.0 });
        engine.world.set_aabb_collider(
            gate,
            AabbCollider::new(32.0, 32.0, false, CollisionLayer::Wall),
        );
        bindings.extend([gate.id, gate.generation, 0]);
    }
    assert!(engine.configure_data_scene_navigation_with_obstacles(
        64, 64, 1.0, 1.0, 0.0, 0.0, &[1; 4096], &bindings
    ));
    let original = bytes(&engine);
    let usage = check(&engine);
    assert!(usage.work >= 64 * 4096);
    assert!(validate(
        &engine,
        Limits {
            max_work: 64 * 4096 - 1,
            max_scratch_bytes: usage.scratch_bytes
        }
    )
    .is_err());
    assert_eq!(bytes(&engine), original);
}

#[test]
fn file_data_movement_negative_rounding_credit_is_preserved_in_the_actual_codec() {
    let (mut engine, _, _) = fixture(false);
    engine.update(0.1);
    assert!(engine.data_scene.movement.file_distance_credit() < 0.0);
    check(&engine);
    let mut restored = persistence::decode(&bytes(&engine)).unwrap();
    for _ in 0..6 {
        engine.update(0.1);
        restored.update(0.1);
        assert_eq!(bytes(&engine), bytes(&restored));
        check(&engine);
    }
}

#[test]
fn file_data_movement_nested_sweep_is_admitted_without_clearing_bad_debug_history() {
    let (live, _, _) = fixture(false);
    let original = bytes(&live);
    let mut candidate = persistence::decode(&original).unwrap();
    candidate
        .data_scene
        .movement
        .corrupt_file_movement_fixture(5);
    let malformed = bytes(&candidate);
    let decoded = persistence::decode(&malformed).unwrap();
    assert!(matches!(validate(&decoded, limits()), Err(Error::Sweep(_))));
    assert_eq!(bytes(&decoded), malformed);
    assert_eq!(bytes(&live), original);
}
