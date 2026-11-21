use super::*;
use crate::engine::file_runtime_observation_admission as admission;
use crate::engine::{file_candidate, file_envelope, persistence};
use crate::physics3d::Shape;

fn limits() -> admission::Limits {
    admission::Limits {
        max_work: 50_000_000,
        max_scratch_bytes: 50_000_000,
    }
}
fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn check(e: &Engine) -> admission::Usage {
    let before = bytes(e);
    let usage = admission::validate(e, limits()).unwrap();
    assert_eq!(bytes(e), before);
    let decoded = persistence::decode(&before).unwrap();
    assert_eq!(admission::validate(&decoded, limits()).unwrap(), usage);
    assert_eq!(bytes(&decoded), before);
    usage
}
fn reject(e: &Engine, original: &Engine, label: &str) {
    let raw = bytes(e);
    let live = bytes(original);
    let decoded = persistence::decode(&raw).unwrap();
    let file = wire(&decoded);
    file_envelope::read(
        &file,
        &file_candidate::profile(0x12345678),
        &file_candidate::Limits::default().framing,
    )
    .unwrap();
    assert!(
        matches!(
            admission::validate(&decoded, limits()),
            Err(admission::Error::Invalid { .. })
        ),
        "{label}"
    );
    assert_eq!(bytes(&decoded), raw);
    assert_eq!(bytes(e), raw);
    assert_eq!(bytes(original), live);
}

fn fixture() -> (Engine, Entity, Entity) {
    let mut engine = Engine::new();
    engine.activate_data_scene();
    engine
        .configure_unified_physics(WorldConfig {
            gravity: [0.; 3],
            max_events: 32,
            ..WorldConfig::default()
        })
        .unwrap();
    engine.set_collision_lifecycle_events_enabled(true);
    engine
        .set_unified_physics_collision_events_enabled(true)
        .unwrap();
    engine
        .set_unified_physics_joint_events_enabled(true)
        .unwrap();
    let first = engine
        .create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::Dynamic,
                linear_velocity: [1., 0., 0.],
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    let second = engine
        .create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::Fixed,
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
    for (kind, position, velocity, shape) in [
        (
            crate::physics3d::BodyKind::Fixed,
            [0., 10., 0.],
            [0.; 3],
            Shape::Box {
                half_extents: [0.05, 1., 2.],
            },
        ),
        (
            crate::physics3d::BodyKind::Dynamic,
            [-2., 10., 0.],
            [300., 0., 0.],
            Shape::Sphere { radius: 0.5 },
        ),
    ] {
        engine
            .create_unified_body(
                BodyDesc {
                    kind,
                    pose: Pose {
                        position,
                        ..Pose::default()
                    },
                    linear_velocity: velocity,
                    ccd: true,
                    can_sleep: false,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(shape),
                [0.; 3],
            )
            .unwrap();
    }
    engine.update(f64::from(engine.fixed_timestep.config().step_seconds));
    assert!(!engine.unified_contact_impulses().unwrap().is_empty());
    assert!(!engine.unified_ccd_clamps().unwrap().is_empty());
    let mut joint_values = [0.; 20];
    joint_values[6] = 1.;
    joint_values[13] = 1.;
    let joint = engine
        .create_unified_physics_joint(
            &[first.id, first.generation, second.id, second.generation],
            &[0, 3],
            &joint_values,
        )
        .unwrap();
    engine
        .remove_unified_physics_joint(joint[0], joint[1])
        .unwrap();
    engine
        .set_unified_body_pose(
            first,
            Pose {
                position: [0.4, 0., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    for kind in [0, 1, 3, 4] {
        let mut metadata = [0; 12];
        metadata[0] = kind;
        metadata[1] = if kind == 0 { 35 } else { 3 };
        metadata[2] = u32::MAX;
        metadata[3] = u32::MAX;
        metadata[9] = 32;
        let mut values = [0.; 13];
        values[6] = 1.;
        match kind {
            0 => {
                values[0] = -5.;
                values[7] = 1.;
                values[10] = 100.;
            }
            1 => values[0] = 0.9,
            3 => {
                values[0] = -5.;
                values[7] = 10.;
                metadata[10] = 1;
                metadata[11] = 1;
            }
            4 => {
                values[0] = -2.;
                values[10] = 100.;
            }
            _ => unreachable!(),
        }
        engine
            .query_unified_physics(
                &metadata,
                &values,
                if kind == 3 { &[1] } else { &[] },
                if kind == 3 { &[0.1] } else { &[] },
            )
            .unwrap();
    }
    engine
        .query_unified_physics_contacts(u32::MAX, u32::MAX, true, 32, 32)
        .unwrap();
    engine
        .unified_physics
        .as_mut()
        .unwrap()
        .gameplay_collision_pairs();
    let runtime = engine.unified_physics.as_ref().unwrap();
    assert!(!runtime.native_ray_hits.is_empty());
    assert!(!runtime.native_point_hits.is_empty());
    assert!(!runtime.native_sweep_hits.is_empty());
    assert!(!runtime.native_nearest_hits.is_empty());
    assert!(!runtime.native_contact_manifolds.is_empty());
    assert!(!runtime.native_joint_events.is_empty());
    (engine, first, second)
}

fn wire(engine: &Engine) -> Vec<u8> {
    let limits = file_candidate::Limits::default();
    let section = file_candidate::capture_engine_section(engine, &limits).unwrap();
    file_envelope::encode(
        &file_candidate::profile(0x12345678),
        &file_envelope::Sections {
            engine: &section,
            variables: b"{}",
            authoring: b"{}",
            resource_manifest: b"{}",
            resource_data: b"{}",
            dialogue_quest: b"{}",
            host_bindings: b"{}",
        },
        &limits.framing,
    )
    .unwrap()
}

#[test]
fn runtime_observation_admission_actual_valid_crc_owner11_payloads_reject_without_mutation() {
    let (engine, first, _) = fixture();
    crate::engine::file_runtime_observation_admission::validate(
        &engine,
        crate::engine::file_runtime_observation_admission::Limits {
            max_work: 50_000_000,
            max_scratch_bytes: 50_000_000,
        },
    )
    .unwrap();
    let original = persistence::encode(&engine).unwrap();
    let limits = file_candidate::Limits::default();
    assert!(file_candidate::prepare(&wire(&engine), 0x12345678, &limits).is_ok());
    for case in 0..11 {
        let mut damaged = persistence::decode(&original).unwrap();
        let runtime = damaged.unified_physics.as_mut().unwrap();
        match case {
            0 => runtime.lifecycle.corrupt_runtime_observation_before(),
            1 => runtime.contacts.corrupt_runtime_observation_before(),
            2 => runtime
                .gameplay_collision_pairs
                .push(crate::collision::CollisionPair { a: first, b: first }),
            3 => runtime.native_ray_hits[0].distance = f32::NAN,
            4 => runtime.native_point_hits.push(runtime.native_point_hits[0]),
            5 => runtime.native_sweep_hits[0].fraction = 2.,
            6 => runtime.native_nearest_hits[0].distance = -1.,
            7 => runtime.native_contact_manifolds[0].points[0].penetration = f32::NAN,
            8 => runtime.native_joint_events[0].reaction.force = f32::NAN,
            9 => runtime.joint_stream.corrupt_runtime_observation_before(),
            10 => runtime.statistics.corrupt_runtime_observation_before(),
            _ => unreachable!(),
        }
        let raw = persistence::encode(&damaged).unwrap();
        let decoded = persistence::decode(&raw).unwrap();
        assert_eq!(persistence::encode(&decoded).unwrap(), raw);
        crate::engine::file_physics_output_admission::validate(
            &decoded,
            crate::engine::file_physics_output_admission::Limits {
                max_work: 50_000_000,
                max_scratch_bytes: 50_000_000,
            },
        )
        .unwrap();
        let file = wire(&decoded);
        file_envelope::read(&file, &file_candidate::profile(0x12345678), &limits.framing).unwrap();
        assert!(
            crate::engine::file_runtime_observation_admission::validate(
                &decoded,
                crate::engine::file_runtime_observation_admission::Limits {
                    max_work: 50_000_000,
                    max_scratch_bytes: 50_000_000
                }
            )
            .is_err(),
            "owner {case}"
        );
        assert_eq!(persistence::encode(&damaged).unwrap(), raw);
        assert_eq!(persistence::encode(&engine).unwrap(), original);
        println!("owner {case}: actual private codec + validCRC file + outer40 accepted; new readonly guard rejected; source unchanged");
    }
}

#[test]
fn runtime_observation_admission_default_configured_and_exact_cumulative_quotas_are_pure() {
    let (full, _, _) = fixture();
    let mut empty = Engine::new();
    empty.activate_data_scene();
    empty
        .configure_unified_physics(WorldConfig::default())
        .unwrap();
    for e in [&Engine::new(), &empty, &full] {
        let old = bytes(e);
        let usage = check(e);
        assert_eq!(
            admission::validate(
                e,
                admission::Limits {
                    max_work: usage.work,
                    max_scratch_bytes: usage.scratch_bytes
                }
            ),
            Ok(usage)
        );
        assert_eq!(
            admission::validate(
                e,
                admission::Limits {
                    max_work: usage.work - 1,
                    max_scratch_bytes: usage.scratch_bytes
                }
            ),
            Err(admission::Error::WorkLimit)
        );
        if usage.scratch_bytes > 0 {
            assert_eq!(
                admission::validate(
                    e,
                    admission::Limits {
                        max_work: usage.work,
                        max_scratch_bytes: usage.scratch_bytes - 1
                    }
                ),
                Err(admission::Error::ScratchLimit)
            );
        }
        assert_eq!(bytes(e), old);
    }
}

#[test]
fn runtime_observation_admission_lifecycle_and_collision_stream_all_private_relations_reject() {
    let (source, _, _) = fixture();
    let original = bytes(&source);
    for case in 0..26 {
        let mut bad = persistence::decode(&original).unwrap();
        bad.unified_physics
            .as_mut()
            .unwrap()
            .lifecycle
            .corrupt_runtime_observation(case);
        reject(&bad, &source, &format!("lifecycle/stream {case}"));
    }
}

#[test]
fn runtime_observation_admission_contact_fields_copy_bits_and_diagnostics_reject() {
    let (source, _, _) = fixture();
    let original = bytes(&source);
    for case in 0..24 {
        let mut bad = persistence::decode(&original).unwrap();
        bad.unified_physics
            .as_mut()
            .unwrap()
            .contacts
            .corrupt_runtime_observation(case);
        reject(&bad, &source, &format!("contacts {case}"));
    }
}

#[test]
fn runtime_observation_admission_joint_stream_fields_and_independent_queue_corruption_reject() {
    let (source, _, _) = fixture();
    let original = bytes(&source);
    for case in 0..13 {
        let mut bad = persistence::decode(&original).unwrap();
        bad.unified_physics
            .as_mut()
            .unwrap()
            .joint_stream
            .corrupt_runtime_observation(case);
        reject(&bad, &source, &format!("joint stream {case}"));
    }
    for case in 0..4 {
        let mut bad = persistence::decode(&original).unwrap();
        let r = bad.unified_physics.as_mut().unwrap();
        match case {
            0 => r.native_joint_events[0].reaction.force = -1.,
            1 => r.native_joint_events[0].reaction.torque = f32::INFINITY,
            2 => r.native_joint_events.push(r.native_joint_events[0].clone()),
            3 => r.native_joint_events.resize(
                r.physics.config().max_events + 1,
                r.native_joint_events[0].clone(),
            ),
            _ => unreachable!(),
        }
        reject(&bad, &source, &format!("native joint events {case}"));
    }
}

#[test]
fn runtime_observation_admission_statistics_frame_and_full_ccd_copy_fields_reject() {
    let (source, _, _) = fixture();
    let original = bytes(&source);
    for case in 0..29 {
        let mut bad = persistence::decode(&original).unwrap();
        bad.unified_physics
            .as_mut()
            .unwrap()
            .statistics
            .corrupt_runtime_observation(case);
        reject(&bad, &source, &format!("statistics {case}"));
    }
}

#[test]
fn runtime_observation_admission_native_query_numeric_order_unique_and_nested_points_reject() {
    let (source, _, _) = fixture();
    let original = bytes(&source);
    for case in 0..45 {
        let mut bad = persistence::decode(&original).unwrap();
        let r = bad.unified_physics.as_mut().unwrap();
        match case {
            0 => r.native_ray_hits[0].distance = f32::NAN,
            1 => r.native_ray_hits[0].distance = -1.,
            2..=4 => r.native_ray_hits[0].point[case - 2] = f32::NAN,
            5..=7 => r.native_ray_hits[0].normal[case - 5] = f32::INFINITY,
            8 => {
                r.native_ray_hits.reverse();
            }
            9 => {
                let mut v = r.native_ray_hits.last().unwrap().clone();
                v.distance += 1.;
                r.native_ray_hits.push(v);
            }
            10 => r.native_point_hits.push(r.native_point_hits[0]),
            11 => r.native_point_hits.reverse(),
            12 => r.native_sweep_hits[0].fraction = f32::NAN,
            13 => r.native_sweep_hits[0].fraction = 2.,
            14..=16 => r.native_sweep_hits[0].point[case - 14] = f32::NAN,
            17..=19 => r.native_sweep_hits[0].normal[case - 17] = f32::INFINITY,
            20 => r.native_sweep_hits[0].initial_overlap = !r.native_sweep_hits[0].initial_overlap,
            21 => r.native_sweep_hits.push(r.native_sweep_hits[0].clone()),
            22 => r.native_nearest_hits[0].distance = -1.,
            23..=25 => r.native_nearest_hits[0].point[case - 23] = f32::NAN,
            26 => r.native_nearest_hits.reverse(),
            27 => {
                let mut v = r.native_nearest_hits.last().unwrap().clone();
                v.distance += 1.;
                r.native_nearest_hits.push(v);
            }
            28..=30 => r.native_contact_manifolds[0].normal[case - 28] = f32::NAN,
            31..=33 => r.native_contact_manifolds[0].points[0].first[case - 31] = f32::NAN,
            34..=36 => r.native_contact_manifolds[0].points[0].second[case - 34] = f32::INFINITY,
            37 => r.native_contact_manifolds[0].points[0].penetration = -1.,
            38 => r.native_contact_manifolds[0].points.clear(),
            39 => {
                r.native_contact_manifolds[0].second.collider =
                    r.native_contact_manifolds[0].first.collider
            }
            40 => {
                r.native_contact_manifolds[0].second.body = r.native_contact_manifolds[0].first.body
            }
            41 => {
                let first = r.native_contact_manifolds[0].clone();
                let mut z = first.clone();
                z.first_subshape += 1;
                r.native_contact_manifolds = vec![z, first];
            }
            42 => r.native_contact_manifolds[0].points[0].penetration = f32::NAN,
            43 => r.native_nearest_hits[0].distance = f32::INFINITY,
            44 => r
                .native_point_hits
                .resize(r.physics.config().max_colliders + 1, r.native_point_hits[0]),
            _ => unreachable!(),
        }
        reject(&bad, &source, &format!("native query {case}"));
    }
}

#[test]
fn runtime_observation_admission_success_failure_and_stale_history_replay_six_steps() {
    let (mut source, a, z) = fixture();
    let before = bytes(&source);
    let usage = check(&source);
    for _ in 0..3 {
        assert_eq!(check(&source), usage);
    }
    assert_eq!(bytes(&source), before);
    let mut decoded = persistence::decode(&before).unwrap();
    for dt in [0., 0.001, 1. / 60., 0.025, 1. / 60., 0.] {
        source.update(dt);
        decoded.update(dt);
        check(&source);
        check(&decoded);
        assert_eq!(bytes(&source), bytes(&decoded));
    }
    source.world.despawn(a);
    source.world.despawn(z);
    check(&source);
    source.drain_unified_physics_collision_events().unwrap();
    source.drain_unified_physics_joint_events().unwrap();
    check(&source);
    source.drain_unified_physics_collision_events().unwrap();
    source.drain_unified_physics_joint_events().unwrap();
    check(&source);
    source
        .set_unified_physics_collision_events_enabled(false)
        .unwrap();
    source
        .set_unified_physics_joint_events_enabled(false)
        .unwrap();
    check(&source);
}

fn sensor_engine(limit: usize, count: usize) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        gravity: [0.; 3],
        max_events: limit,
        ..WorldConfig::default()
    })
    .unwrap();
    e.set_collision_lifecycle_events_enabled(true);
    e.set_unified_physics_collision_events_enabled(true)
        .unwrap();
    for i in 0..count {
        e.create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::Dynamic,
                pose: Pose {
                    position: [i as f32 * 0.1, 0., 0.],
                    ..Pose::default()
                },
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 1. })
            },
            [0.; 3],
        )
        .unwrap();
    }
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    e
}

#[test]
fn runtime_observation_admission_overflow_full_active_snapshot_and_disabled_frame_history() {
    let mut e = sensor_engine(1, 4);
    let history = e
        .unified_physics
        .as_ref()
        .unwrap()
        .lifecycle
        .observation_history_for_test();
    assert_eq!(history.0, 6);
    assert_eq!(history.1, 6);
    assert!(history.2 > 0);
    assert_eq!(history.3, 1);
    e.query_unified_physics_contacts(u32::MAX, u32::MAX, true, 1, 1)
        .unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .native_contact_manifolds
            .len(),
        6
    );
    assert!(e.unified_physics_contacts_truncated());
    check(&e);
    e.set_collision_lifecycle_events_enabled(false);
    let disabled = e
        .unified_physics
        .as_ref()
        .unwrap()
        .lifecycle
        .observation_history_for_test();
    assert_eq!(disabled.2, history.2);
    assert_eq!(disabled.3, 1);
    check(&e);
    e.set_unified_physics_collision_events_enabled(false)
        .unwrap();
    check(&e);
    e.set_collision_lifecycle_events_enabled(true);
    check(&e);
    e.update(0.);
    check(&e);
}

#[test]
fn runtime_observation_admission_joint_legacy_and_web_overflow_have_independent_drains() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        gravity: [0.; 3],
        max_events: 1,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = e
        .create_unified_body(
            BodyDesc::default(),
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    let z = e
        .create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::Fixed,
                pose: Pose {
                    position: [10., 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    e.set_unified_physics_joint_events_enabled(true).unwrap();
    let mut v = [0.; 20];
    v[6] = 1.;
    v[13] = 1.;
    for _ in 0..3 {
        let joint = e
            .create_unified_physics_joint(&[a.id, a.generation, z.id, z.generation], &[0, 3], &v)
            .unwrap();
        e.remove_unified_physics_joint(joint[0], joint[1]).unwrap();
    }
    let history = e
        .unified_physics
        .as_ref()
        .unwrap()
        .joint_stream
        .observation_history_for_test();
    assert_eq!(history, (true, 1, 2, 2));
    check(&e);
    e.drain_unified_physics_joint_events().unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .joint_stream
            .observation_history_for_test(),
        (true, 0, 2, 0)
    );
    check(&e);
    e.set_unified_physics_joint_events_enabled(false).unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .joint_stream
            .observation_history_for_test(),
        (false, 0, 2, 0)
    );
    check(&e);
    let old = bytes(&e);
    let mut d = persistence::decode(&old).unwrap();
    for _ in 0..6 {
        let dt = f64::from(e.fixed_timestep.config().step_seconds);
        e.update(dt);
        d.update(dt);
        check(&e);
        assert_eq!(bytes(&e), bytes(&d));
    }
}

#[test]
fn runtime_observation_admission_interior_zero_normal_and_failed_queries_keep_native_caches() {
    let (mut e, _, _) = fixture();
    let mut m = [0; 12];
    m[0] = 0;
    m[1] = 35;
    m[2] = u32::MAX;
    m[3] = u32::MAX;
    m[9] = 32;
    let mut v = [0.; 13];
    v[0] = 50.;
    v[6] = 1.;
    v[7] = 1.;
    v[10] = 100.;
    e.create_unified_body(
        BodyDesc {
            kind: crate::physics3d::BodyKind::Fixed,
            pose: Pose {
                position: [50., 0., 0.],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [1.; 3],
        }),
        [0.; 3],
    )
    .unwrap();
    e.query_unified_physics(&m, &v, &[], &[]).unwrap();
    let ray = e.unified_physics.as_ref().unwrap().native_ray_hits.clone();
    assert!(ray
        .iter()
        .any(|hit| hit.distance == 0. && hit.normal == [0.; 3]));
    check(&e);
    v[7] = 0.;
    assert!(e.query_unified_physics(&m, &v, &[], &[]).is_err());
    assert_eq!(e.unified_physics.as_ref().unwrap().native_ray_hits, ray);
    check(&e);
    let manifolds = e
        .unified_physics
        .as_ref()
        .unwrap()
        .native_contact_manifolds
        .clone();
    assert!(e
        .query_unified_physics_contacts(u32::MAX, u32::MAX, true, 0, 32)
        .is_err());
    assert_eq!(
        e.unified_physics.as_ref().unwrap().native_contact_manifolds,
        manifolds
    );
    check(&e);
}

#[test]
fn runtime_observation_admission_max_event_backing_and_many_uncapped_manifolds_are_budgeted() {
    let mut empty = Engine::new();
    empty.activate_data_scene();
    empty
        .configure_unified_physics(WorldConfig {
            max_events: 65536,
            ..WorldConfig::default()
        })
        .unwrap();
    let usage = check(&empty);
    assert!(usage.work >= 65536);
    assert_eq!(usage.scratch_bytes, 0);
    let mut e = sensor_engine(1, 12);
    e.query_unified_physics_contacts(u32::MAX, u32::MAX, true, 1, 1)
        .unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .native_contact_manifolds
            .len(),
        66
    );
    let usage = check(&e);
    assert!(usage.scratch_bytes > 0);
    assert_eq!(
        admission::validate(
            &e,
            admission::Limits {
                max_work: usage.work,
                max_scratch_bytes: usage.scratch_bytes
            }
        ),
        Ok(usage)
    );
    assert_eq!(
        admission::validate(
            &e,
            admission::Limits {
                max_work: usage.work,
                max_scratch_bytes: usage.scratch_bytes - 1
            }
        ),
        Err(admission::Error::ScratchLimit)
    );
}

fn ccd_engine() -> (Engine, Entity) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    e.create_unified_body(
        BodyDesc {
            kind: crate::physics3d::BodyKind::Fixed,
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.05, 1., 2.],
        }),
        [0.; 3],
    )
    .unwrap();
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::Dynamic,
                pose: Pose {
                    position: [-2., 0., 0.],
                    ..Pose::default()
                },
                linear_velocity: [300., 0., 0.],
                ccd: true,
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    (e, a)
}

#[test]
fn runtime_observation_admission_frame_ccd_is_not_replaced_by_last_tick_or_current_identities() {
    let (mut e, a) = ccd_engine();
    let dt = e.fixed_timestep.config().step_seconds;
    e.update(3. * f64::from(dt));
    assert_eq!(e.unified_physics_frame_statistics().unwrap().fixed_steps, 3);
    assert_eq!(e.unified_physics_step_statistics().unwrap().ccd_clamps, 0);
    assert_eq!(e.unified_ccd_clamps().unwrap().len(), 1);
    check(&e);
    let old_native = e.unified_body_id(a).unwrap();
    e.remove_unified_body(a).unwrap();
    let reused = e
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [100., 100., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
            [0.; 3],
        )
        .unwrap();
    let new_native = e.unified_body_id(reused).unwrap();
    assert_eq!(old_native.slot, new_native.slot);
    assert_ne!(old_native.generation, new_native.generation);
    assert_eq!(e.unified_ccd_clamps().unwrap()[0].moving, a);
    check(&e);
    e.update(0.);
    assert_eq!(
        e.unified_physics_frame_statistics().unwrap(),
        UnifiedPhysicsFrameStatistics::default()
    );
    check(&e);
}

#[test]
fn runtime_observation_admission_configured_query_max64_all_four_native_caches_and_exact_quota() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        gravity: [0.; 3],
        max_bodies: 64,
        max_colliders: 64,
        max_events: 1,
        ..WorldConfig::default()
    })
    .unwrap();
    for i in 0..64 {
        e.create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::Fixed,
                pose: Pose {
                    position: [i as f32 * 2., 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
            [0.; 3],
        )
        .unwrap();
    }
    for kind in [0, 2, 3, 4] {
        let mut m = [0; 12];
        m[0] = kind;
        m[1] = if kind == 0 { 35 } else { 3 };
        m[2] = u32::MAX;
        m[3] = u32::MAX;
        m[9] = 64;
        let mut v = [0.; 13];
        v[6] = 1.;
        let (sm, sv): (Vec<u32>, Vec<f32>) = match kind {
            0 => {
                v[0] = -2.;
                v[7] = 1.;
                v[10] = 256.;
                (vec![], vec![])
            }
            2 => {
                v[0] = 64.;
                m[10] = 1;
                m[11] = 3;
                (vec![0], vec![200., 1., 1.])
            }
            3 => {
                v[0] = -2.;
                v[7] = 256.;
                m[10] = 1;
                m[11] = 1;
                (vec![1], vec![0.1])
            }
            4 => {
                v[0] = 64.;
                v[10] = 256.;
                (vec![], vec![])
            }
            _ => unreachable!(),
        };
        e.query_unified_physics(&m, &v, &sm, &sv).unwrap();
    }
    let r = e.unified_physics.as_ref().unwrap();
    assert_eq!(
        [
            r.native_ray_hits.len(),
            r.native_point_hits.len(),
            r.native_sweep_hits.len(),
            r.native_nearest_hits.len()
        ],
        [64; 4]
    );
    let u = check(&e);
    assert!(u.scratch_bytes >= 64 * 8 * 3);
    assert_eq!(
        admission::validate(
            &e,
            admission::Limits {
                max_work: u.work,
                max_scratch_bytes: u.scratch_bytes
            }
        ),
        Ok(u)
    );
    assert_eq!(
        admission::validate(
            &e,
            admission::Limits {
                max_work: u.work - 1,
                max_scratch_bytes: u.scratch_bytes
            }
        ),
        Err(admission::Error::WorkLimit)
    );
}

#[test]
fn runtime_observation_admission_terrain_unmapped_native_ccd_and_impulses_keep_all_rows() {
    let mut e = Engine::new();
    e.activate_data_scene();
    assert!(e.configure_spatial_camera(&[0., 0., 8., 10., 0., 0., 0., 20., 0.1, 100., 100., 100.]));
    e.configure_unified_physics(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    assert!(e.configure_spatial_terrain(
        &[-10., -10., 20., 20., -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1]
    ));
    e.create_unified_body(
        BodyDesc {
            kind: crate::physics3d::BodyKind::Dynamic,
            pose: Pose {
                position: [0., 2., 0.],
                ..Pose::default()
            },
            linear_velocity: [0., -300., 0.],
            ccd: true,
            can_sleep: false,
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        [0.; 3],
    )
    .unwrap();
    let dt = f64::from(e.fixed_timestep.config().step_seconds);
    e.update(dt);
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .statistics
        .observations
        .is_empty());
    assert!(e.unified_ccd_clamps().unwrap().is_empty());
    check(&e);
    e.update(dt);
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .contacts
        .observations
        .is_empty());
    assert!(e.unified_contact_impulses().unwrap().is_empty());
    check(&e);
    let mut d = persistence::decode(&bytes(&e)).unwrap();
    for _ in 0..6 {
        e.update(dt);
        d.update(dt);
        check(&e);
        assert_eq!(bytes(&e), bytes(&d));
    }
}

#[test]
fn runtime_observation_admission_real_feedback_categories_remain_after_profile_changes() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    for (kind, y, category) in [
        (crate::physics3d::BodyKind::Fixed, 0., 2),
        (crate::physics3d::BodyKind::Dynamic, 1., 4),
    ] {
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
                ColliderDesc {
                    category,
                    ..ColliderDesc::new(Shape::Box {
                        half_extents: [0.5; 3],
                    })
                },
                [0.; 3],
            )
            .unwrap();
        if kind == crate::physics3d::BodyKind::Dynamic {
            e.set_unified_body_velocity(a, [0., -6., 0.], [0.; 3])
                .unwrap();
        }
    }
    assert!(e.configure_physics_impact_feedback(&[4., 0.001, 0.2, 7., u32::MAX as f64, 0.8]));
    e.configure_physics_contact_impacts(true, 1.);
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .contacts
        .feedback_categories
        .is_empty());
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .contacts
        .feedback_categories
        .iter()
        .all(|c| *c == 6));
    check(&e);
    assert!(e.configure_physics_impact_feedback(&[]));
    check(&e);
    let mut d = persistence::decode(&bytes(&e)).unwrap();
    for _ in 0..6 {
        let dt = f64::from(e.fixed_timestep.config().step_seconds);
        e.update(dt);
        d.update(dt);
        check(&e);
        assert_eq!(bytes(&e), bytes(&d));
    }
}
