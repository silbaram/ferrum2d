use super::*;
use crate::entity::Entity;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Pose, Shape, Space, WorldConfig};
fn engine(space: Space, limit: usize) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        step_seconds: 0.01,
        max_events: limit,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn body(e: &mut Engine, kind: BodyKind, x: f32) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind,
            pose: Pose {
                position: [x, 0.0, 0.0],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        [0.0; 3],
    )
    .unwrap()
}
fn endpoints(a: Entity, b: Entity) -> [u32; 4] {
    [a.id, a.generation, b.id, b.generation]
}
fn values(extra: &[f32]) -> Vec<f32> {
    let mut v = vec![0.0; 20];
    v[6] = 1.0;
    v[13] = 1.0;
    v.extend(extra);
    v
}
fn create(e: &mut Engine, a: Entity, b: Entity, kind: u32, flags: u32, v: &[f32]) -> Vec<u32> {
    e.create_unified_physics_joint(&endpoints(a, b), &[kind, flags], v)
        .unwrap()
}

#[test]
fn every_native_joint_kind_and_optional_response_round_trip_without_losing_identity() {
    let mut e = engine(Space::PlanarXy, 64);
    let a = body(&mut e, BodyKind::Fixed, 0.0);
    let b = body(&mut e, BodyKind::Dynamic, 2.0);
    let payloads: Vec<Vec<f32>> = vec![
        vec![],
        vec![],
        vec![-1.0, 1.0, 0.1, 1.0, 2.0, 3.0, 100.0],
        vec![-1.0, 1.0, 0.1, 1.0, 2.0, 3.0, 100.0],
        vec![2.0],
        vec![3.0],
        vec![2.0, 3.0, 0.5],
        vec![2.0, 4.0, 5.0],
        vec![2.0, 4.0, 5.0],
        vec![3.0, 4.0, 5.0],
        vec![2.0, 0.1, 4.0, 5.0],
        vec![0.0, 5.0, 0.0, 2.0, 5.0, 0.0, 10.0, 1.0, 4.0, 5.0],
        vec![-10.0, 10.0, 5.0, 1.0, 2.0, 3.0, 100.0],
    ];
    use crate::physics3d::{JointKind, JointMotor, SpringResponse};
    let motor = JointMotor {
        target_position: 0.1,
        target_velocity: 1.0,
        stiffness: 2.0,
        damping: 3.0,
        max_force: 100.0,
    };
    let spring = SpringResponse {
        stiffness: 4.0,
        damping: 5.0,
    };
    // Independent native descriptors: do not call the decoder under test for expected values.
    let expected_kinds = [
        JointKind::Fixed,
        JointKind::Spherical,
        JointKind::Revolute {
            limits: Some([-1.0, 1.0]),
            motor: Some(motor.clone()),
        },
        JointKind::Prismatic {
            limits: Some([-1.0, 1.0]),
            motor: Some(motor.clone()),
        },
        JointKind::Distance { length: 2.0 },
        JointKind::Rope { max_length: 3.0 },
        JointKind::FrequencySpring {
            rest_length: 2.0,
            frequency_hz: 3.0,
            damping_ratio: 0.5,
        },
        JointKind::AccelerationSpring {
            rest_length: 2.0,
            stiffness: 4.0,
            damping: 5.0,
        },
        JointKind::Spring {
            rest_length: 2.0,
            stiffness: 4.0,
            damping: 5.0,
        },
        JointKind::ElasticRope {
            max_length: 3.0,
            spring,
        },
        JointKind::Gear {
            ratio: 2.0,
            reference_angle: 0.1,
            spring: Some(spring),
        },
        JointKind::Pulley {
            ground_a: [0.0, 5.0, 0.0],
            ground_b: [2.0, 5.0, 0.0],
            length: 10.0,
            ratio: 1.0,
            slack: true,
            spring: Some(spring),
        },
        JointKind::ContinuousRevolute {
            limits: [-10.0, 10.0],
            motor: Some(JointMotor {
                target_position: 5.0,
                ..motor
            }),
        },
    ];
    for (kind, p) in payloads.iter().enumerate() {
        let mut v = values(p);
        let mut flags = 1 | 2 | 4 | 8;
        v[14] = 1000.0;
        v[15] = 1000.0;
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
        if kind == 0 {
            flags |= 16 | 32;
            v[16..20].copy_from_slice(&[4.0, 5.0, 6.0, 7.0]);
        }
        let id = create(&mut e, a, b, kind as u32, flags, &v);
        let r = e.unified_physics.as_ref().unwrap();
        let native = JointId {
            slot: id[0],
            generation: id[1],
        };
        let actual = r.physics.joint_desc(native).unwrap();
        assert_eq!(actual.kind, expected_kinds[kind]);
        assert_eq!(
            (actual.body_a, actual.body_b),
            (e.unified_body_id(a).unwrap(), e.unified_body_id(b).unwrap())
        );
        assert!(actual.enabled && actual.contacts_enabled);
        assert_eq!(
            (actual.break_force, actual.break_torque),
            (Some(1000.0), Some(1000.0))
        );
        assert_eq!(actual.linear_spring, (kind == 0).then_some(spring));
        assert_eq!(
            actual.angular_spring,
            (kind == 0).then_some(SpringResponse {
                stiffness: 6.0,
                damping: 7.0
            })
        );
        let q = std::f32::consts::FRAC_1_SQRT_2;
        let frame = if [2, 12].contains(&kind) {
            Pose {
                rotation: [0.0, -q, 0.0, q],
                ..Pose::default()
            }
        } else {
            Pose::default()
        };
        assert_eq!((actual.local_frame_a, actual.local_frame_b), (frame, frame));
        let h: Vec<_> = id.iter().copied().chain(endpoints(a, b)).collect();
        e.update_unified_physics_joint(&h, &[kind as u32, flags & !1], &v)
            .unwrap();
        e.query_unified_physics_joints(&id, false).unwrap();
        let row = e.unified_physics_joints.states[0];
        assert_eq!(row.code, kind as u32);
        assert_eq!(row.flags & 4, 0);
        assert_eq!(row.joint, [id[0], id[1]]);
        e.remove_unified_physics_joint(id[0], id[1]).unwrap();
    }
}

#[test]
fn invalid_joint_updates_are_atomic_and_bulk_query_clears_on_stale_identity() {
    let mut e = engine(Space::Spatial, 64);
    let a = body(&mut e, BodyKind::Fixed, 0.0);
    let b = body(&mut e, BodyKind::Dynamic, 2.0);
    let c = body(&mut e, BodyKind::Dynamic, 5.0);
    let id = create(&mut e, a, b, 4, 1, &values(&[2.0]));
    let h: Vec<_> = id.iter().copied().chain(endpoints(a, b)).collect();
    let native = JointId {
        slot: id[0],
        generation: id[1],
    };
    let before = e
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .joint_desc(native)
        .unwrap()
        .clone();
    for (m, v) in [
        (vec![4, 1], values(&[-1.0])),
        (vec![0, 1 | 64], values(&[])),
        (vec![4, 1], values(&[f32::NAN])),
        (vec![4, 1], vec![]),
        (vec![12, 1], values(&[0.0; 7])),
    ] {
        assert!(e.update_unified_physics_joint(&h, &m, &v).is_err());
        assert_eq!(
            e.unified_physics
                .as_ref()
                .unwrap()
                .physics
                .joint_desc(native)
                .unwrap(),
            &before
        );
    }
    let changed: Vec<_> = id.iter().copied().chain(endpoints(a, c)).collect();
    assert!(e
        .update_unified_physics_joint(&changed, &[4, 1], &values(&[2.0]))
        .is_err());
    let request: Vec<_> = id.iter().copied().chain(id.iter().copied()).collect();
    e.query_unified_physics_joints(&request, false).unwrap();
    assert_eq!(e.unified_physics_joints.states.len(), 2);
    e.remove_unified_physics_joint(id[0], id[1]).unwrap();
    let next = create(&mut e, a, b, 4, 1, &values(&[2.0]));
    assert_ne!(id, next);
    let mixed: Vec<_> = next.into_iter().chain(id.iter().copied()).collect();
    assert!(e.query_unified_physics_joints(&mixed, false).is_err());
    assert_eq!(e.unified_physics_joint_count(false), 0);
}

#[test]
fn real_force_and_torque_breaks_return_reaction_and_previous_endpoint_identities() {
    for case in 0..3 {
        let mut e = engine(Space::Spatial, 64);
        e.set_unified_physics_joint_events_enabled(true).unwrap();
        let a = body(&mut e, BodyKind::Fixed, 0.0);
        let b = body(&mut e, BodyKind::Dynamic, 0.0);
        let mut v = values(&[]);
        v[14] = 1.0;
        v[15] = 1.0;
        let id = create(&mut e, a, b, 0, 1 | 4 | 8, &v);
        let linear = if case != 1 { 10.0 } else { 0.0 };
        let torque = if case != 0 { 10.0 } else { 0.0 };
        e.command_unified_physics_bodies(
            2,
            &[b.id, b.generation],
            &[linear, 0.0, 0.0, 0.0, torque, 0.0],
        )
        .unwrap();
        e.update(0.01);
        e.remove_unified_body(b).unwrap();
        e.drain_unified_physics_joint_events().unwrap();
        let rows = &e.unified_physics_joints.events;
        assert_eq!(rows.len(), 1);
        let r = rows[0];
        assert_eq!(r.joint, [id[0], id[1]]);
        assert_eq!(r.code, case);
        assert_eq!(r.entity_b, [b.id, b.generation]);
        assert_eq!(r.flags, 3);
        if case != 1 {
            assert!(r.force > 1.0);
        }
        if case != 0 {
            assert!(r.torque > 1.0);
        }
    }
}

#[test]
fn body_removal_and_explicit_removal_retain_generations_across_slot_reuse() {
    let mut e = engine(Space::Spatial, 64);
    e.set_unified_physics_joint_events_enabled(true).unwrap();
    let a = body(&mut e, BodyKind::Fixed, 0.0);
    let b = body(&mut e, BodyKind::Dynamic, 2.0);
    let one = create(&mut e, a, b, 4, 1, &values(&[2.0]));
    e.remove_unified_physics_joint(one[0], one[1]).unwrap();
    let two = create(&mut e, a, b, 4, 1, &values(&[2.0]));
    e.remove_unified_body(b).unwrap();
    let replacement = body(&mut e, BodyKind::Dynamic, 2.0);
    assert_ne!(b, replacement);
    e.drain_unified_physics_joint_events().unwrap();
    let rows = &e.unified_physics_joints.events;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].code, 3);
    assert_eq!(rows[1].code, 4);
    assert_eq!(rows[1].joint, [two[0], two[1]]);
    assert_eq!(rows[1].entity_b, [b.id, b.generation]);
    e.query_unified_physics_joints(&[], true).unwrap();
    assert_eq!(e.unified_physics_joint_count(false), 0);
    e.drain_unified_physics_joint_events().unwrap();
    assert_eq!(e.unified_physics_joint_count(true), 0);
}

#[test]
fn joint_stream_overflow_recovers_live_snapshot_without_losing_legacy_pending() {
    let mut e = engine(Space::Spatial, 1);
    let a = body(&mut e, BodyKind::Fixed, 0.0);
    let b = body(&mut e, BodyKind::Dynamic, 2.0);
    let old = create(&mut e, a, b, 4, 1, &values(&[2.0]));
    e.remove_unified_physics_joint(old[0], old[1]).unwrap();
    e.set_unified_physics_joint_events_enabled(true).unwrap();
    e.drain_unified_physics_joint_events().unwrap();
    assert_eq!(e.unified_physics_joint_count(true), 0);
    for _ in 0..3 {
        create(&mut e, a, b, 4, 1, &values(&[2.0]));
    }
    e.remove_unified_body(b).unwrap();
    let c = body(&mut e, BodyKind::Dynamic, 2.0);
    let new = create(&mut e, a, c, 4, 1, &values(&[2.0]));
    e.remove_unified_physics_joint(new[0], new[1]).unwrap();
    e.set_unified_physics_joint_events_enabled(true).unwrap();
    e.drain_unified_physics_joint_events().unwrap();
    assert_eq!(e.unified_physics_joint_count(true), 1);
    assert_eq!(e.unified_physics_joint_dropped_native(), 2);
    assert_eq!(e.unified_physics_joint_dropped_events(), 1);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .native_joint_events
            .len(),
        1
    );
    e.query_unified_physics_joints(&[], true).unwrap();
    assert_eq!(e.unified_physics_joint_count(false), 0);
    e.update(0.01);
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .native_joint_events
        .is_empty());
    e.set_unified_physics_joint_events_enabled(false).unwrap();
    e.drain_unified_physics_joint_events().unwrap();
    assert_eq!(e.unified_physics_joint_dropped_native(), 0);
    assert_eq!(e.unified_physics_joint_dropped_events(), 0);
}

#[test]
fn imported_joint_is_queryable_but_its_source_component_keeps_edit_ownership() {
    use crate::components::{DistanceJoint, RigidBody, Transform2D};
    let mut e = Engine::new();
    e.activate_data_scene();
    let a = e.world.spawn_entity();
    let b = e.world.spawn_entity();
    for (entity, x) in [(a, 0.0), (b, 2.0)] {
        e.world.set_transform(entity, Transform2D { x, y: 0.0 });
        e.world.set_rigid_body(entity, RigidBody::dynamic(1.0));
    }
    e.world.add_distance_joint(DistanceJoint::new(a, b, 2.0));
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    e.query_unified_physics_joints(&[], true).unwrap();
    let id = e.unified_physics_joints.states[0].joint;
    assert!(e
        .remove_unified_physics_joint(id[0], id[1])
        .unwrap_err()
        .contains("authored component"));
    let h: Vec<_> = id.into_iter().chain(endpoints(a, b)).collect();
    assert!(e
        .update_unified_physics_joint(&h, &[4, 1], &values(&[3.0]))
        .is_err());
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    e.query_unified_physics_joints(&[], true).unwrap();
    assert_eq!(e.unified_physics_joints.states[0].joint, id);
}

#[test]
fn draining_web_breaks_does_not_consume_authored_joint_reconciliation() {
    use crate::components::{DistanceJoint, RigidBody, Transform2D};
    let mut e = Engine::new();
    e.activate_data_scene();
    let a = e.world.spawn_entity();
    let b = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 0.0, y: 0.0 });
    e.world.set_rigid_body(a, RigidBody::static_body());
    e.world.set_transform(b, Transform2D { x: 2.0, y: 0.0 });
    e.world.set_rigid_body(b, RigidBody::dynamic(1.0));
    let mut desc = DistanceJoint::new(a, b, 2.0);
    desc.break_force = 1.0;
    let authored = e.world.add_distance_joint(desc);
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    e.set_unified_physics_joint_events_enabled(true).unwrap();
    e.command_unified_physics_bodies(2, &[b.id, b.generation], &[10.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        .unwrap();
    // Interleave a Web drain after the actual native solve, before the legacy reduction.
    e.unified_physics.as_mut().unwrap().physics.step();
    e.drain_unified_physics_joint_events().unwrap();
    assert_eq!(e.unified_physics_joints.events.len(), 1);
    assert_eq!(e.unified_physics_joints.events[0].code, 0);
    assert!(e.world.distance_joint(authored).is_some());
    e.unified_physics
        .as_mut()
        .unwrap()
        .finish_planar_joints(&mut e.world);
    assert!(e.world.distance_joint(authored).is_none());
    assert_eq!(e.world.physics_diagnostics.breaks.len(), 1);
    assert_eq!(e.world.physics_diagnostics.breaks[0][3], 1.0);
    e.unified_physics
        .as_mut()
        .unwrap()
        .finish_planar_joints(&mut e.world);
    assert_eq!(e.world.physics_diagnostics.breaks.len(), 1);
}
