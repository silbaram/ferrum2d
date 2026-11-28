use super::*;
use crate::collision::PHYSICS_DEBUG_CCD;
use crate::physics3d::{BodyKind, CharacterConfig, Shape};

fn engine(space: Space, limit: usize) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        max_events: limit,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn body(e: &mut Engine, kind: BodyKind, p: [f32; 3], v: [f32; 3], shape: Shape) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind,
            pose: Pose {
                position: p,
                ..Pose::default()
            },
            linear_velocity: v,
            ccd: true,
            can_sleep: false,
            ..BodyDesc::default()
        },
        ColliderDesc::new(shape),
        [
            20.0,
            30.0,
            if e.unified_physics.as_ref().unwrap().physics.config().space == Space::Spatial {
                40.0
            } else {
                0.0
            },
        ],
    )
    .unwrap()
}
fn register_distant_character(e: &mut Engine) {
    let character = body(
        e,
        BodyKind::KinematicPosition,
        [60., 2., 0.],
        [0.; 3],
        Shape::Capsule {
            half_height: 0.5,
            radius: 0.25,
        },
    );
    e.enable_unified_character(character, CharacterConfig::default())
        .unwrap();
}

fn wall_and_fast(e: &mut Engine, y: f32) -> Entity {
    body(
        e,
        BodyKind::Fixed,
        [0.0, y, 0.0],
        [0.0; 3],
        Shape::Box {
            half_extents: [0.05, 1.0, 2.0],
        },
    );
    body(
        e,
        BodyKind::Dynamic,
        [-2.0, y, 0.0],
        [300.0, 0.0, 0.0],
        Shape::Sphere { radius: 0.5 },
    )
}
fn tick(e: &mut Engine) {
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
}

#[test]
fn checked_manual_mesh_rejection_preserves_previous_tick_and_engine_checkpoint() {
    let dt = 0.01;
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        step_seconds: dt,
        ..WorldConfig::default()
    })
    .unwrap();
    let moving = wall_and_fast(&mut e, 20.);
    e.step_rigid_bodies_checked(dt).unwrap();
    let last_step = e.unified_physics_step_statistics().unwrap();
    assert_eq!(last_step.ccd_clamps, 1);
    register_distant_character(&mut e);
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .force_character_motion_proof();
    let mesh = body(
        &mut e,
        BodyKind::Fixed,
        [0.; 3],
        [0.; 3],
        Shape::TriangleMesh {
            vertices: vec![[-8., -1., -8.], [8., 1., -8.], [0., 0., 8.]],
            triangles: vec![[0, 2, 1]; 4096],
        },
    );
    body(
        &mut e,
        BodyKind::Dynamic,
        [0., 1.25, 0.],
        [0., -100., 0.],
        Shape::Box {
            half_extents: [0.5; 3],
        },
    );
    let mut frames = [0.; 20];
    frames[6] = 1.;
    frames[13] = 1.;
    let joint = e
        .create_unified_physics_joint(
            &[moving.id, moving.generation, mesh.id, mesh.generation],
            &[0, 3],
            &frames,
        )
        .unwrap();
    e.remove_unified_physics_joint(joint[0], joint[1]).unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .native_joint_events
            .len(),
        1
    );
    let saved = crate::engine::persistence::encode(&e).unwrap();
    let error = e.step_rigid_bodies_checked(dt).unwrap_err();
    assert!(error.contains("after 0 committed seconds"), "{error}");
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::Physics(PhysicsError::CapacityExceeded))
    );
    assert_eq!(e.unified_physics_step_statistics().unwrap(), last_step);
    let after = crate::engine::persistence::encode(&e).unwrap();
    assert!(
        saved == after,
        "checkpoint size before={}, after={}",
        saved.len(),
        after.len()
    );
    e.remove_unified_body(mesh).unwrap();
    e.step_rigid_bodies_checked(dt).unwrap();
}

/// A legacy planar force/impulse is staged inside the native rollback journal:
/// a zero-progress rejection restores pre-input bytes, and N rejected retries
/// do not integrate (N + 1) copies of the same component input.
#[test]
fn planar_legacy_inputs_are_rolled_back_with_a_zero_progress_rejection() {
    use crate::components::{CircleCollider, CollisionLayer, RigidBody, Velocity};
    let dt = 0.01;
    let run = |rejections: usize| {
        let mut e = Engine::new();
        e.activate_data_scene();
        e.configure_unified_physics(WorldConfig {
            space: Space::PlanarXy,
            gravity: [0.; 3],
            step_seconds: dt,
            ..WorldConfig::default()
        })
        .unwrap();
        let a = e.world.spawn_entity();
        e.world.set_transform(a, Transform2D { x: 40., y: 40. });
        e.world
            .set_circle_collider(a, CircleCollider::new(1., false, CollisionLayer::Enemy));
        e.world.set_rigid_body(a, RigidBody::dynamic_circle(1., 1.));
        e.step_rigid_bodies_checked(dt).unwrap();
        register_distant_character(&mut e);
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .force_character_motion_proof();
        let mesh = body(
            &mut e,
            BodyKind::Fixed,
            [0.; 3],
            [0.; 3],
            Shape::TriangleMesh {
                vertices: vec![[-8., -1., -8.], [8., 1., -8.], [0., 0., 8.]],
                triangles: vec![[0, 2, 1]; 4096],
            },
        );
        body(
            &mut e,
            BodyKind::Dynamic,
            [0., 1.25, 0.],
            [0., -100., 0.],
            Shape::Box {
                half_extents: [0.5; 3],
            },
        );
        let legacy = e.world.rigid_bodies[a.id as usize].as_mut().unwrap();
        legacy.force = Velocity { vx: 50., vy: 0. };
        legacy.impulse = Velocity { vx: 0., vy: 2. };
        for _ in 0..rejections {
            let saved = crate::engine::persistence::encode(&e).unwrap();
            let error = e.step_rigid_bodies_checked(dt).unwrap_err();
            assert!(error.contains("after 0 committed seconds"), "{error}");
            assert!(
                crate::engine::persistence::encode(&e).unwrap() == saved,
                "rejected planar tick changed the checkpoint"
            );
        }
        e.remove_unified_body(mesh).unwrap();
        e.step_rigid_bodies_checked(dt).unwrap();
        e.unified_body_state(a).unwrap()
    };
    let once = run(0);
    assert!(once.linear_velocity[0] > 0. && once.linear_velocity[1] > 0.);
    assert_eq!(run(2), once);
}

/// Pre-physics gameplay of a zero-progress rejected Data tick is not repeated:
/// the retry resumes at physics, so tweens and timers advance once per tick.
#[test]
fn rejected_frame_retry_does_not_repeat_pre_physics_gameplay() {
    use crate::tweens::{SpriteTint, TweenEasing};
    let dt = 0.01;
    let run = |rejections: usize| {
        let mut e = Engine::new();
        e.activate_data_scene();
        e.configure_unified_physics(WorldConfig {
            space: Space::Spatial,
            gravity: [0.; 3],
            step_seconds: dt,
            ..WorldConfig::default()
        })
        .unwrap();
        let sprite = e.world.spawn_enemy(10., 10., 1);
        assert!(e.tweens.start_sprite_tint(
            &mut e.world,
            sprite,
            SpriteTint::new(1., 1., 1., 1.),
            SpriteTint::new(0., 0., 0., 0.),
            1.,
            TweenEasing::Linear,
        ));
        register_distant_character(&mut e);
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .force_character_motion_proof();
        let mesh = body(
            &mut e,
            BodyKind::Fixed,
            [0.; 3],
            [0.; 3],
            Shape::TriangleMesh {
                vertices: vec![[-8., -1., -8.], [8., 1., -8.], [0., 0., 8.]],
                triangles: vec![[0, 2, 1]; 4096],
            },
        );
        body(
            &mut e,
            BodyKind::Dynamic,
            [0., 1.25, 0.],
            [0., -100., 0.],
            Shape::Box {
                half_extents: [0.5; 3],
            },
        );
        for _ in 0..rejections {
            let error = e
                .update_frame_checked(f64::from(dt), false, false, false)
                .unwrap_err();
            assert!(error.contains("after 0 committed seconds"), "{error}");
        }
        e.remove_unified_body(mesh).unwrap();
        e.update_frame_checked(f64::from(dt), false, false, false)
            .unwrap();
        e.world.sprite_at_index(sprite.id as usize).unwrap().r
    };
    let once = run(0);
    assert!(once < 1.);
    assert_eq!(run(3), once);
}

/// Checked frames report a native step skipped by clock or prepare failure;
/// gameplay-only diagnostics and the raw `update_frame` ABI stay unchanged.
#[test]
fn checked_frame_reports_skipped_native_step() {
    use crate::components::{CircleCollider, CollisionLayer, RigidBody, Velocity};
    let mut e = engine(Space::PlanarXy, 64);
    let error = e
        .update_frame_checked(f64::NAN, false, false, false)
        .unwrap_err();
    assert!(error.contains("native physics step skipped"), "{error}");
    e.update_frame_checked(0.0, false, false, false).unwrap();
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 4., y: 4. });
    e.world
        .set_circle_collider(a, CircleCollider::new(1., false, CollisionLayer::Enemy));
    let mut legacy = RigidBody::dynamic_circle(1., 1.);
    legacy.force = Velocity { vx: 2.0e6, vy: 0. };
    e.world.set_rigid_body(a, legacy);
    let step = f64::from(e.fixed_timestep.config().step_seconds);
    let error = e
        .update_frame_checked(step, false, false, false)
        .unwrap_err();
    assert!(error.contains("native physics step skipped"), "{error}");
    assert!(e.unified_body_state(a).is_err());
    e.world.rigid_bodies[a.id as usize].as_mut().unwrap().force = Velocity::default();
    e.update_frame_checked(step, false, false, false).unwrap();
    assert!(e.unified_body_state(a).is_ok());
}

#[test]
fn native_statistics_engine_retains_early_ccd_and_publishes_real_frame_counts_and_debug_lines() {
    let mut e = engine(Space::PlanarXy, 64);
    let moving = wall_and_fast(&mut e, 0.0);
    e.set_physics_debug_lines_enabled(true);
    e.set_physics_debug_line_flags(PHYSICS_DEBUG_CCD);
    e.update(3.0 * f64::from(e.fixed_timestep.config().step_seconds));
    let s = e.unified_physics_step_statistics().unwrap();
    let frame = e.unified_physics_frame_statistics().unwrap();
    assert_eq!(frame.fixed_steps, 3);
    assert_eq!(frame.totals.backend_steps, 3);
    assert_eq!(frame.totals.ccd_clamps, 1);
    assert_eq!(s.ccd_clamps, 0);
    assert_eq!(e.rigid_body_step_dynamic_bodies(), 1);
    assert_eq!(e.rigid_body_step_ccd_hits(), 0);
    assert_eq!(e.rigid_body_frame_stats.ccd_hits, 1);
    assert!(e.rigid_body_frame_stats.ccd_checks > 0);
    assert_eq!(e.unified_ccd_clamps().unwrap().len(), 1);
    assert_eq!(e.unified_ccd_clamps().unwrap()[0].moving, moving);
    assert_eq!(e.world.rigid_body_ccd_debug_hit_count(), 1);
    // Three XYZ witness axes plus the actual native normal. The projected Z
    // marker may be degenerate in XY; it remains part of the submitted buffer.
    assert_eq!(e.physics_debug_line_len(), 4);
    let (point, normal) = {
        let clamp = &e.unified_ccd_clamps().unwrap()[0].clamp;
        (clamp.point, clamp.normal)
    };
    let line = e.frame_buffers.physics_debug_lines.last().unwrap();
    assert_eq!([line.x0, line.y0], [point[0], point[1]]);
    let scale = e
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .config()
        .length_unit
        * 0.2;
    assert_eq!(
        [line.x1, line.y1],
        [point[0] + normal[0] * scale, point[1] + normal[1] * scale]
    );
    assert_eq!(e.frame_buffers.native_debug_state[0], 4);
    let hit = e.world.rigid_body_ccd_debug_hit_at(0).unwrap();
    assert!(hit.point_x.abs() < 0.1);
    assert!(hit.normal_x < -0.99);
    e.update(0.0);
    assert_eq!(
        e.unified_physics_frame_statistics().unwrap(),
        UnifiedPhysicsFrameStatistics::default()
    );
    assert!(e.unified_ccd_clamps().unwrap().is_empty());
    assert_eq!(e.world.rigid_body_ccd_debug_hit_count(), 0);
    assert_eq!(e.physics_debug_line_len(), 0);
    assert_eq!(e.unified_physics_step_statistics().unwrap(), s);
}

#[test]
fn native_statistics_engine_manual_rejections_queries_and_pause_do_not_recount_work() {
    let mut e = engine(Space::PlanarXy, 64);
    wall_and_fast(&mut e, 0.0);
    e.auto_rigid_body_step_enabled = false;
    let dt = e.fixed_timestep.config().step_seconds;
    tick(&mut e);
    assert_eq!(e.unified_physics_frame_statistics().unwrap().fixed_steps, 0);
    e.step_rigid_bodies(dt);
    let frame = e.unified_physics_frame_statistics().unwrap();
    let hits = e.unified_ccd_clamps().unwrap().to_vec();
    let step = e.unified_physics_step_statistics().unwrap();
    assert_eq!(frame.fixed_steps, 1);
    assert_eq!(frame.totals.ccd_clamps, 1);
    e.query_body_contacts(u32::MAX, u32::MAX);
    assert_eq!(e.unified_physics_frame_statistics().unwrap(), frame);
    for dt in [0.0, -1.0, dt * 2.0, f32::NAN] {
        e.step_rigid_bodies(dt);
        assert_eq!(e.unified_physics_frame_statistics().unwrap(), frame);
        assert_eq!(e.unified_ccd_clamps().unwrap(), hits);
    }
    tick(&mut e);
    assert_eq!(e.unified_physics_frame_statistics().unwrap().fixed_steps, 0);
    assert_eq!(e.unified_physics_step_statistics().unwrap(), step);
}

#[test]
fn native_statistics_engine_xyz_ccd_projection_and_native_overflow_are_explicit() {
    let mut e = engine(Space::Spatial, 1);
    wall_and_fast(&mut e, 3.0);
    wall_and_fast(&mut e, 6.0);
    tick(&mut e);
    let s = e.unified_physics_step_statistics().unwrap();
    assert_eq!(s.ccd_clamps, 2);
    assert_eq!(s.ccd_clamps_dropped, 1);
    let frame = e.unified_physics_frame_statistics().unwrap();
    assert_eq!(frame.ccd_observations_dropped, 1);
    assert_eq!(e.rigid_body_frame_stats.ccd_hits, 2);
    let full = e.unified_ccd_clamps().unwrap();
    assert_eq!(full.len(), 1);
    let projected = e.world.rigid_body_ccd_debug_hit_at(0).unwrap();
    assert!(full[0].clamp.point[1] > 2.0);
    assert_eq!(projected.point_x, full[0].clamp.point[0]);
    assert_eq!(projected.point_y, -full[0].clamp.point[2]);
    assert_eq!(projected.normal_y, -full[0].clamp.normal[2]);
    let old = full[0].moving;
    e.world.despawn(old);
    let reused = e.world.spawn_entity();
    assert_eq!(reused.id, old.id);
    assert_ne!(reused.generation, old.generation);
    assert_eq!(e.unified_ccd_clamps().unwrap()[0].moving, old);
}

#[test]
fn native_statistics_engine_resets_unsupported_legacy_counters_and_reports_sleep_gauges() {
    let mut e = engine(Space::PlanarXy, 64);
    let entity = body(
        &mut e,
        BodyKind::Dynamic,
        [0.0; 3],
        [0.0; 3],
        Shape::Sphere { radius: 0.5 },
    );
    e.rigid_body_step_stats.velocity_impulses = 12345;
    e.rigid_body_step_stats.contact_checks = 12345;
    e.rigid_body_step_stats.warm_start_impulses = 12345;
    tick(&mut e);
    assert_eq!(e.rigid_body_step_velocity_impulses(), 0);
    assert_eq!(e.rigid_body_step_contact_checks(), 0);
    assert_eq!(e.rigid_body_step_warm_start_impulses(), 0);
    assert_eq!(e.rigid_body_step_substeps(), 1);
    assert_eq!(e.rigid_body_step_dynamic_bodies(), 1);
    assert_eq!(e.rigid_body_step_angular_bodies(), 1);
    let id = e.unified_body_id(entity).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_sleeping(id, true)
        .unwrap();
    tick(&mut e);
    assert_eq!(e.rigid_body_step_sleeping_bodies(), 1);
    assert_eq!(e.rigid_body_step_sleeping_islands(), 1);
    assert_eq!(e.rigid_body_frame_stats.sleeping_bodies, 1);
    assert_eq!(e.rigid_body_step_bodies_put_to_sleep(), 0);
}

#[test]
fn native_statistics_engine_imported_bodies_and_geometric_joint_breaks_reach_telemetry() {
    use crate::components::{DistanceJoint, RigidBody};
    let mut e = engine(Space::PlanarXy, 64);
    let a = e.world.spawn_entity();
    let b = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D::default());
    e.world.set_transform(b, Transform2D { x: 2.0, y: 0.0 });
    e.world.set_rigid_body(a, RigidBody::static_body());
    e.world.set_rigid_body(b, RigidBody::dynamic(2.0));
    e.world
        .add_distance_joint(DistanceJoint::new(a, b, 1.0).with_break_distance(0.1));
    tick(&mut e);
    assert_eq!(e.rigid_body_step_dynamic_bodies(), 1);
    assert_eq!(e.rigid_body_step_broken_joints(), 1);
    assert_eq!(e.rigid_body_frame_stats.broken_joints, 1);
    let f = e.unified_physics_frame_statistics().unwrap();
    assert_eq!(f.authored_joint_breaks, 1);
    assert_eq!(f.totals.broken_joints, 0);
    tick(&mut e);
    assert_eq!(e.rigid_body_step_broken_joints(), 0);
}

#[test]
fn native_statistics_engine_frame_capacity_preserves_untruncated_ccd_counts() {
    let mut e = engine(Space::PlanarXy, 64);
    let a = wall_and_fast(&mut e, -3.0);
    let b = wall_and_fast(&mut e, 3.0);
    let dt = e.fixed_timestep.config().step_seconds;
    // Explicit manual ticks share the current frame until Engine.update begins.
    // Exercise the real 4096-entry boundary with two independent clamps per tick.
    for _ in 0..2050 {
        for (id, y) in [(a, -3.0), (b, 3.0)] {
            e.set_unified_body_pose(
                id,
                Pose {
                    position: [-2.0, y, 0.0],
                    ..Pose::default()
                },
            )
            .unwrap();
            e.set_unified_body_velocity(id, [300.0, 0.0, 0.0], [0.0; 3])
                .unwrap();
        }
        e.step_rigid_bodies(dt);
    }
    let f = e.unified_physics_frame_statistics().unwrap();
    assert_eq!(f.fixed_steps, 2050);
    assert_eq!(f.totals.ccd_clamps, 4100);
    assert_eq!(f.totals.ccd_clamps_dropped, 0);
    assert_eq!(f.ccd_observations_dropped, 4);
    assert_eq!(e.unified_ccd_clamps().unwrap().len(), 4096);
    assert_eq!(e.world.rigid_body_ccd_debug_hit_count(), 4096);
    assert_eq!(e.rigid_body_frame_stats.ccd_hits, 4100);
}
