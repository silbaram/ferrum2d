use super::*;
use crate::components::{AabbCollider, CollisionLayer, DistanceJoint, RigidBody, Transform2D};
use crate::engine::persistence;
use crate::entity::Entity;
use crate::physics3d::{
    BodyDesc, BodyKind, CharacterConfig, ColliderDesc, Pose, Shape, Space, WorldConfig,
};
fn limits() -> Limits {
    Limits {
        max_work: 50_000_000,
        max_scratch_bytes: 50_000_000,
    }
}
fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn check(e: &Engine) {
    let old = bytes(e);
    validate(e, limits()).unwrap();
    assert_eq!(bytes(e), old);
    let d = persistence::decode(&old).unwrap();
    validate(&d, limits()).unwrap();
    assert_eq!(bytes(&d), old);
}
fn legacy() -> (Engine, Entity, Entity) {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.activate_data_scene();
    let a = e.world.spawn_entity();
    let z = e.world.spawn_entity();
    for (entity, x, layer, body) in [
        (
            a,
            0.,
            CollisionLayer::Player,
            RigidBody::dynamic_box(1., 10., 10.),
        ),
        (z, 8., CollisionLayer::Enemy, RigidBody::static_body()),
    ] {
        e.world.set_transform(entity, Transform2D { x, y: 0. });
        e.world
            .set_aabb_collider(entity, AabbCollider::new(5., 5., false, layer));
        e.world.set_rigid_body(entity, body);
    }
    e.set_collision_lifecycle_events_enabled(true);
    e.step_rigid_bodies(0.01);
    e.query_point_bodies(0., 0., u32::MAX);
    e.query_aabb_bodies(0., 0., 20., 20., u32::MAX);
    e.query_circle_bodies(0., 0., 20., u32::MAX);
    e.query_oriented_box_bodies(0., 0., 20., 20., 0., u32::MAX);
    e.raycast_bodies(-20., 0., 1., 0., 100., u32::MAX);
    e.shape_cast_aabb_bodies(-20., 0., 1., 1., 1., 0., 100., u32::MAX);
    e.query_body_contacts(u32::MAX, u32::MAX);
    e.query_body_manifolds(u32::MAX, u32::MAX);
    e.query_rigid_contact_impulses();
    let joint = e.world.add_distance_joint(DistanceJoint::new(a, z, 8.));
    assert!(e.query_physics_joint(0, joint.index, joint.generation));
    assert!(e.query_physics_entity(z.id, z.generation));
    assert!(e.query_physics_body_collider(a.id, a.generation, 0));
    assert!(e.capture_physics_body_snapshot_bulk(vec![
        z.id,
        z.generation,
        a.id,
        a.generation,
        z.id,
        z.generation
    ]));
    e.tilemap
        .set_layer(0, 1, 1, 10., 10., 0., 0., true, vec![1]);
    e.query_nearest_tile_obstacle(-10., 5., 100.);
    e.raycast_tile_obstacles(-20., 5., 1., 0., 100.);
    e.shape_cast_aabb_tile_obstacles(-20., 5., 1., 1., 1., 0., 100.);
    e.query_aabb_tile_obstacle_contacts(5., 5., 2., 2.);
    e.query_aabb_tile_obstacle_manifolds(5., 5., 2., 2.);
    (e, a, z)
}
fn native() -> (Engine, Entity, Entity) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    let z = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0.9, 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    e.set_unified_physics_collision_events_enabled(true)
        .unwrap();
    e.set_unified_physics_joint_events_enabled(true).unwrap();
    let mut values = vec![0.; 20];
    values[6] = 1.;
    values[13] = 1.;
    let _joint = e
        .create_unified_physics_joint(&[a.id, a.generation, z.id, z.generation], &[0, 3], &values)
        .unwrap();
    e.update(0.01);
    e.query_unified_physics_body_states(&[
        z.id,
        z.generation,
        a.id,
        a.generation,
        z.id,
        z.generation,
    ])
    .unwrap();
    let c = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [4., 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.2,
            }),
            [0.; 3],
        )
        .unwrap();
    e.enable_unified_character(c, CharacterConfig::default())
        .unwrap();
    e.query_unified_physics_character_states(&[c.id, c.generation, c.id, c.generation])
        .unwrap();
    e.query_unified_physics_collision_pairs().unwrap();
    e.query_unified_physics_contacts(u32::MAX, u32::MAX, true, 32, 32)
        .unwrap();
    e.query_unified_physics_observations().unwrap();
    e.query_unified_physics_joints(&[], true).unwrap();
    let mut m = [0; 12];
    m[0] = 1;
    m[1] = 2;
    m[2] = u32::MAX;
    m[3] = u32::MAX;
    m[9] = 8;
    let mut v = [0.; 13];
    v[6] = 1.;
    v[0] = 0.9;
    e.query_unified_physics(&m, &v, &[], &[]).unwrap();
    (e, a, z)
}
#[test]
fn file_physics_output_default_actual_codec_readonly() {
    check(&Engine::new());
}
#[test]
fn file_physics_output_legacy_bulk_all_queries_inf_sentinels_and_stale_history() {
    let (mut e, a, z) = legacy();
    assert_eq!(e.physics_entity_snapshot.mass, f32::INFINITY);
    assert_eq!(e.physics_body_snapshot_u32s.len(), 15);
    assert!(!e.physics_tile_manifold_hits.is_empty());
    check(&e);
    e.world.despawn(a);
    e.world.despawn(z);
    e.clear_shooter_tilemap();
    check(&e);
    assert!(!e.query_physics_entity(u32::MAX, 0));
    assert!(!e.capture_physics_body_snapshot_bulk(vec![u32::MAX, 0]));
    check(&e);
}
#[test]
fn file_physics_output_native_all_six_roots_and_old_handles() {
    let (mut e, a, z) = native();
    assert_eq!(e.unified_physics_body_state_count(), 3);
    assert_eq!(e.unified_physics_character_state_count(), 2);
    assert!(e.unified_physics_query_hit_count() > 0);
    assert!(e.unified_physics_collision_count() > 0);
    assert!(e.unified_physics_observation_count(0) > 0);
    assert!(e.unified_physics_joint_count(false) > 0);
    check(&e);
    e.world.despawn(a);
    e.world.despawn(z);
    check(&e);
    e.drain_unified_physics_collision_events().unwrap();
    check(&e);
}
#[test]
fn file_physics_output_actual_codec_six_tick_and_next_query_continuation() {
    for (mut e, a, _) in [legacy(), native()] {
        let mut d = persistence::decode(&bytes(&e)).unwrap();
        for dt in [0., 0.001, 0.01, 0.025, 0.01, 0.] {
            e.update(dt);
            d.update(dt);
            assert_eq!(
                e.query_nearest_body(0., 0., 100., u32::MAX),
                d.query_nearest_body(0., 0., 100., u32::MAX)
            );
            check(&e);
            check(&d);
            assert_eq!(bytes(&e), bytes(&d));
        }
        assert_eq!(
            e.query_physics_entity(a.id, a.generation),
            d.query_physics_entity(a.id, a.generation)
        );
        assert_eq!(bytes(&e), bytes(&d));
    }
}
#[test]
fn file_physics_output_exact_one_below_and_aggregate_limits() {
    for e in [Engine::new(), legacy().0, native().0] {
        let old = bytes(&e);
        let u = validate(&e, limits()).unwrap();
        assert_eq!(
            validate(
                &e,
                Limits {
                    max_work: u.work,
                    max_scratch_bytes: u.scratch_bytes
                }
            ),
            Ok(u)
        );
        assert_eq!(
            validate(
                &e,
                Limits {
                    max_work: u.work - 1,
                    max_scratch_bytes: u.scratch_bytes
                }
            ),
            Err(Error::WorkLimit)
        );
        if u.scratch_bytes > 0 {
            assert_eq!(
                validate(
                    &e,
                    Limits {
                        max_work: u.work,
                        max_scratch_bytes: u.scratch_bytes - 1
                    }
                ),
                Err(Error::ScratchLimit)
            );
        }
        assert_eq!(bytes(&e), old);
    }
}
#[test]
fn file_physics_output_shooter_packed_catalog_and_variables_are_detached() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    assert!(e.capture_shooter_snapshot());
    assert!(!e.shooter_snapshot_entity_floats.is_empty());
    check(&e);
    let old = bytes(&e);
    e.activate_data_scene();
    check(&e);
    assert_eq!(
        e.shooter_snapshot_header_u32s,
        persistence::decode(&old)
            .unwrap()
            .shooter_snapshot_header_u32s
    );
}
#[test]
fn file_physics_output_legacy_valid_crc_rejects_all_numeric_and_packed_families() {
    let (e, _, _) = legacy();
    let old = bytes(&e);
    for case in 0..14 {
        let mut c = persistence::decode(&old).unwrap();
        match case {
            0 => c.physics_query_result.distance = f32::NAN,
            1 => c.physics_raycast_hits[0].normal_x = f32::INFINITY,
            2 => c.physics_tile_shape_cast_hits[0].distance = f32::NEG_INFINITY,
            3 => c.physics_tile_contact_hits[0].penetration = f32::NAN,
            4 => c.physics_tile_manifold_hits[0].point_count = 3,
            5 => c.physics_body_contact_hits[0].point_x = f32::NAN,
            6 => c.physics_body_manifold_hits[0].point1_y = f32::INFINITY,
            7 => c.physics_entity_snapshot.mass = f32::NEG_INFINITY,
            8 => c.physics_body_collider_snapshot.collider_type = 8,
            9 => c.physics_joint_snapshot.frequency_hz = Some(f32::NAN),
            10 => {
                c.physics_body_snapshot_u32s.pop();
            }
            11 => c.physics_raycast_scratch[0].distance = f32::NAN,
            12 => c.physics_tile_manifold_scratch[0].point_count = 9,
            _ => c.physics_body_manifold_scratch[0].points[0].penetration = f32::NAN,
        }
        let malformed = bytes(&c);
        let d = persistence::decode(&malformed).unwrap();
        assert!(
            matches!(validate(&d, limits()), Err(Error::Invalid { .. })),
            "case {case}"
        );
        assert_eq!(bytes(&d), malformed);
        assert_eq!(bytes(&e), old);
    }
}

#[test]
fn file_physics_output_unified_valid_crc_rejects_each_private_output_owner() {
    let (e, _, _) = native();
    let old = bytes(&e);
    for case in 0..21 {
        let mut c = persistence::decode(&old).unwrap();
        match case {
            0 => c.unified_physics_body_states[0].corrupt_output(0),
            1..=3 => c.unified_physics_character_states[0].corrupt_output(case - 1),
            4..=8 => c.unified_physics_queries.corrupt_output(case - 4),
            9..=12 => c.unified_physics_collisions.corrupt_output(case - 9),
            13..=16 => c.unified_physics_observations.corrupt_output(case - 13),
            17..=19 => c.unified_physics_joints.corrupt_output(case - 17),
            _ => c.unified_physics_body_states[0].corrupt_output(1),
        }
        let malformed = bytes(&c);
        let d = persistence::decode(&malformed).unwrap();
        assert!(
            matches!(validate(&d, limits()), Err(Error::Invalid { .. })),
            "case {case}"
        );
        assert_eq!(bytes(&d), malformed);
        assert_eq!(bytes(&e), old);
    }
}
#[test]
fn file_physics_output_tracker_pending_and_identity_graph_rejection() {
    let (mut e, a, z) = legacy();
    e.world.set_transform(a, Transform2D { x: 0., y: 0. });
    e.world.set_transform(z, Transform2D { x: 8., y: 0. });
    e.collision_event_counts = e.collision_event_tracker.update(&e.world, &mut Vec::new());
    check(&e);
    let old = bytes(&e);
    for case in 0..3 {
        let mut c = persistence::decode(&old).unwrap();
        c.collision_event_tracker.corrupt_output(case);
        let malformed = bytes(&c);
        let d = persistence::decode(&malformed).unwrap();
        assert!(matches!(validate(&d, limits()), Err(Error::Invalid { .. })));
        assert_eq!(bytes(&d), malformed);
    }
}
#[test]
fn file_physics_output_shooter_valid_crc_layout_and_metadata_rejections() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    assert!(e.capture_shooter_snapshot());
    let old = bytes(&e);
    for case in 0..7 {
        let mut c = persistence::decode(&old).unwrap();
        match case {
            0 => c.shooter_snapshot_header_floats[0] = f32::NAN,
            1 => c.shooter_snapshot_header_u32s[0] = 0,
            2 => {
                c.shooter_snapshot_entity_u32s.pop();
            }
            3 => c.shooter_snapshot_entity_floats[0] = f32::INFINITY,
            4 => c.shooter_snapshot_entity_u32s[0] = 3,
            5 => {
                c.shooter_snapshot_header_u32s
                    [crate::shooter_scene::SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET] = 255
            }
            _ => c.shooter_snapshot_header_u32s[9] = 0,
        }
        let malformed = bytes(&c);
        let d = persistence::decode(&malformed).unwrap();
        assert!(
            matches!(validate(&d, limits()), Err(Error::Invalid { .. })),
            "case {case}"
        );
        assert_eq!(bytes(&d), malformed);
        assert_eq!(bytes(&e), old);
    }
}

#[test]
fn file_physics_output_shooter_canonical_variable_zero_and_catalog_history() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    assert!(e.configure_gameplay_variable(1, 1, 0, -0.0, -0.0));
    assert!(e.register_gameplay_enemy_prefab(17));
    assert!(e.register_gameplay_bullet_prefab(18));
    assert!(e.capture_shooter_snapshot());
    let offset = crate::shooter_scene::SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET;
    assert_eq!(e.shooter_snapshot_header_u32s[offset + 2], 0);
    check(&e);
    assert!(e.set_gameplay_variable_value(1, 6.));
    assert!(e.register_gameplay_enemy_prefab(19));
    check(&e);
    assert_eq!(e.shooter_snapshot_header_u32s[offset + 2], 0);
    // The old variable parser normalizes raw -0; reject instead of replacing bits.
    let mut c = persistence::decode(&bytes(&e)).unwrap();
    c.shooter_snapshot_header_u32s[offset + 2] = 0x8000_0000;
    let bad = bytes(&c);
    let d = persistence::decode(&bad).unwrap();
    assert!(matches!(validate(&d, limits()), Err(Error::Invalid { .. })));
    assert_eq!(bytes(&d), bad);
}
#[test]
fn file_physics_output_raw_counter_masks_and_signed_zero_are_not_recomputed() {
    let (mut e, a, _) = legacy();
    e.physics_counters.fixed_steps = u32::MAX;
    e.physics_query_result.point_x = -0.;
    e.physics_body_collider_snapshot.collider_category_bits = u32::MAX;
    e.physics_body_collider_snapshot.collider_mask_bits = 0;
    check(&e);
    e.world.despawn(a);
    check(&e);
    assert_eq!(
        e.physics_query_result.point_x.to_bits(),
        (-0.0f32).to_bits()
    );
}

#[test]
fn file_physics_output_native_ccd_and_impulse_history_are_actual_outputs() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..WorldConfig::default()
    })
    .unwrap();
    e.tilemap
        .set_layer(0, 1, 1, 0.1, 2., 0., -1., true, vec![1]);
    let a = e
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [-2., 0., 0.],
                    ..Pose::default()
                },
                linear_velocity: [600., 0., 0.],
                ccd: true,
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    e.update(3. * f64::from(e.fixed_timestep.config().step_seconds));
    e.query_unified_physics_observations().unwrap();
    assert!(e.unified_physics_observation_count(3) > 0);
    check(&e);
    e.remove_unified_body(a).unwrap();
    e.tilemap
        .set_layer(0, 1, 1, 0.1, 2., 0., -1., true, vec![0]);
    e.query_unified_physics_contacts(u32::MAX, u32::MAX, true, 8, 8)
        .unwrap();
    e.query_unified_physics_observations().unwrap();
    check(&e);
    let old = bytes(&e);
    let mut c = persistence::decode(&old).unwrap();
    c.unified_physics_observations.corrupt_output(4);
    let bad = bytes(&c);
    let d = persistence::decode(&bad).unwrap();
    assert!(matches!(validate(&d, limits()), Err(Error::Invalid { .. })));
    assert_eq!(bytes(&d), bad);
    e.update(0.);
    e.query_unified_physics_observations().unwrap();
    assert_eq!(e.unified_physics_observation_count(3), 0);
    check(&e);
}
#[test]
fn file_physics_output_all_thirteen_native_joint_kinds_and_removal_events() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    let z = e
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [2., 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    e.set_unified_physics_joint_events_enabled(true).unwrap();
    let payloads: Vec<Vec<f32>> = vec![
        vec![],
        vec![],
        vec![-1., 1., 0.1, 1., 2., 3., 100.],
        vec![-1., 1., 0.1, 1., 2., 3., 100.],
        vec![2.],
        vec![3.],
        vec![2., 3., 0.5],
        vec![2., 4., 5.],
        vec![2., 4., 5.],
        vec![3., 4., 5.],
        vec![2., 0.1, 4., 5.],
        vec![0., 5., 0., 2., 5., 0., 10., 1., 4., 5.],
        vec![-10., 10., 5., 1., 2., 3., 100.],
    ];
    let mut ids = Vec::new();
    for (kind, p) in payloads.iter().enumerate() {
        let mut v = vec![0.; 20];
        v[6] = 1.;
        v[13] = 1.;
        v[14] = 1000.;
        v[15] = 1000.;
        v.extend(p);
        let mut flags = 1 | 2 | 4 | 8;
        if [2, 3, 12].contains(&kind) {
            flags |= 64 | 128;
        }
        if [10, 11].contains(&kind) {
            flags |= 256;
        }
        if kind == 11 {
            flags |= 512;
        }
        if [2, 12].contains(&kind) {
            let q = std::f32::consts::FRAC_1_SQRT_2;
            v[4] = -q;
            v[6] = q;
            v[11] = -q;
            v[13] = q;
        }
        let id = e
            .create_unified_physics_joint(
                &[a.id, a.generation, z.id, z.generation],
                &[kind as u32, flags],
                &v,
            )
            .unwrap();
        ids.push(id);
    }
    for id in &ids {
        e.query_unified_physics_joints(&[id[0], id[1], id[0], id[1]], false)
            .unwrap();
        assert_eq!(e.unified_physics_joint_count(false), 2);
        check(&e);
    }
    let id = &ids[12];
    e.remove_unified_physics_joint(id[0], id[1]).unwrap();
    e.drain_unified_physics_joint_events().unwrap();
    assert!(e.unified_physics_joint_count(true) > 0);
    check(&e);
}

#[test]
fn file_physics_output_mixed_native_queries_offsets_and_flags() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..WorldConfig::default()
    })
    .unwrap();
    for y in [0., -3.] {
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0., y, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    }
    let mut meta = Vec::new();
    let mut vals = Vec::new();
    for kind in 0..5 {
        let mut m = [0; 12];
        m[0] = kind;
        m[1] = 2 | if kind == 0 { 32 } else { 0 };
        m[2] = u32::MAX;
        m[3] = u32::MAX;
        m[9] = 8;
        let mut v = [0.; 13];
        v[6] = 1.;
        if kind == 0 {
            v[1] = 10.;
            v[8] = -7.;
            v[10] = 20.;
            m[9] = 1;
        }
        if kind == 2 {
            m[10] = 1;
            m[11] = 3;
        }
        if kind == 3 {
            v[1] = 2.;
            m[10] = 1;
            m[11] = 1;
            v[8] = -4.;
        }
        if kind == 4 {
            v[1] = 2.;
            v[10] = 5.;
        }
        meta.extend(m);
        vals.extend(v);
    }
    e.query_unified_physics(&meta, &vals, &[0, 1], &[0.25; 4])
        .unwrap();
    assert_eq!(e.unified_physics_query_count(), 5);
    assert_eq!(e.unified_physics_query_hit_count(), 6);
    check(&e);
    assert!(e.query_unified_physics(&[], &[0.], &[], &[]).is_err());
    assert_eq!(e.unified_physics_query_count(), 0);
    check(&e);
}
#[test]
fn file_physics_output_whole_manifold_truncation_and_independent_clears() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    for y in [0., 0.9] {
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0., y, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            }),
            [0.; 3],
        )
        .unwrap();
    }
    e.query_unified_physics_contacts(u32::MAX, u32::MAX, true, 8, 32)
        .unwrap();
    assert!(e.unified_physics_observation_count(1) >= 4);
    check(&e);
    e.query_unified_physics_contacts(u32::MAX, u32::MAX, true, 8, 3)
        .unwrap();
    assert!(e.unified_physics_contacts_truncated());
    assert_eq!(e.unified_physics_observation_count(0), 0);
    check(&e);
    e.query_unified_physics_observations().unwrap();
    check(&e);
    assert!(e.query_unified_physics_contacts(0, 0, true, 0, 0).is_err());
    check(&e);
}

#[test]
fn file_physics_output_geometric_query_unique_ids_and_distance_order() {
    let (e, _, _) = legacy();
    let old = bytes(&e);
    for case in 0..4 {
        let mut c = persistence::decode(&old).unwrap();
        match case {
            0 => c.physics_query_hits.push(c.physics_query_hits[0]),
            1 => c
                .physics_point_query_scratch
                .push(c.physics_point_query_scratch[0]),
            2 => {
                let mut h = c.physics_raycast_hits[0];
                h.distance = 0.;
                c.physics_raycast_hits.push(h);
            }
            _ => {
                let mut h = c.physics_tile_shape_cast_hits[0];
                h.distance = 0.;
                c.physics_tile_shape_cast_hits.push(h);
            }
        }
        let bad = bytes(&c);
        let d = persistence::decode(&bad).unwrap();
        assert!(
            matches!(validate(&d, limits()), Err(Error::Invalid { .. })),
            "case {case}"
        );
        assert_eq!(bytes(&d), bad);
    }
}

#[test]
fn file_physics_output_actual_solved_impulse_survives_body_retirement() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..WorldConfig::default()
    })
    .unwrap();
    let mut moving = None;
    for (y, kind) in [(0., BodyKind::Fixed), (1., BodyKind::Dynamic)] {
        let a = e
            .create_unified_body(
                BodyDesc {
                    kind,
                    pose: Pose {
                        position: [0., y, 0.],
                        ..Pose::default()
                    },
                    can_sleep: false,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.5; 3],
                }),
                [0.; 3],
            )
            .unwrap();
        if kind == BodyKind::Dynamic {
            moving = Some(a);
        }
    }
    let moving = moving.unwrap();
    e.set_unified_body_velocity(moving, [1., -6., 2.], [0.; 3])
        .unwrap();
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    e.query_unified_physics_observations().unwrap();
    assert!(e.unified_physics_observation_count(2) > 0);
    check(&e);
    e.remove_unified_body(moving).unwrap();
    e.query_unified_physics_contacts(u32::MAX, u32::MAX, true, 8, 32)
        .unwrap();
    e.query_unified_physics_observations().unwrap();
    check(&e);
    assert!(e.unified_physics_observation_count(2) > 0);
    let mut c = persistence::decode(&bytes(&e)).unwrap();
    c.unified_physics_observations.corrupt_output(5);
    let bad = bytes(&c);
    let d = persistence::decode(&bad).unwrap();
    assert!(matches!(validate(&d, limits()), Err(Error::Invalid { .. })));
    assert_eq!(bytes(&d), bad);
}
