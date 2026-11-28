use super::*;
use crate::collision::PHYSICS_DEBUG_CCD;
use crate::physics3d::{BodyKind, Shape};

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

fn configure_platform_slots(e: &mut Engine, count: u32) {
    let mut terrain = Vec::new();
    let mut metadata = Vec::new();
    let mut platforms = Vec::new();
    for id in 1..=16 {
        terrain.extend_from_slice(&[
            100. + id as f32 * 4.,
            30.,
            1.,
            1.,
            -0.2,
            0.,
            0.,
            1.,
            1.,
            1.,
            1.,
        ]);
        metadata.extend_from_slice(&[id, 0, 0, 1]);
        if id <= count {
            platforms.extend_from_slice(&[2., f64::from(id), 1., 0., 0., 1., 0., 0.]);
        }
    }
    if e.spatial_scene.surfaces.is_empty() {
        assert!(e.configure_spatial_terrain(&terrain, &metadata));
    }
    assert!(e.configure_spatial_moving_platforms(&platforms));
}

fn capture_bytes(e: &mut Engine) -> Vec<u8> {
    e.capture_native_file(b"{}{}{}{}{}{}", &[2; 6], 7, 9, &[])
        .unwrap()
}

fn queue_dash_before_last_platform(e: &mut Engine) {
    use crate::components::Velocity;
    let dash = body(
        e,
        BodyKind::KinematicVelocity,
        [0., 40., 0.],
        [0.; 3],
        Shape::Sphere { radius: 0.25 },
    );
    e.unified_physics
        .as_mut()
        .unwrap()
        .queue_native_dash(&e.world, dash, Velocity { vx: 1., vy: 0. }, 15)
        .unwrap();
    configure_platform_slots(e, 16);
}

#[test]
fn path_and_dash_preflight_preserves_diagnostics_checkpoint_and_native_file() {
    let mut e = engine(Space::Spatial, 128);
    let dt = e.fixed_timestep.config().step_seconds;
    configure_platform_slots(&mut e, 15);
    let moving = wall_and_fast(&mut e, 20.);
    e.step_rigid_bodies_checked(dt).unwrap();
    let stats = e.unified_physics_step_statistics().unwrap();
    assert_eq!(stats.ccd_clamps, 1);
    let anchor = body(
        &mut e,
        BodyKind::Fixed,
        [50., 0., 0.],
        [0.; 3],
        Shape::Sphere { radius: 0.5 },
    );
    let mut frames = [0.; 20];
    frames[6] = 1.;
    frames[13] = 1.;
    let joint = e
        .create_unified_physics_joint(
            &[moving.id, moving.generation, anchor.id, anchor.generation],
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
    queue_dash_before_last_platform(&mut e);
    let saved = crate::engine::persistence::encode(&e).unwrap();
    let native = capture_bytes(&mut e);
    let state = e.unified_body_state(moving).unwrap();
    for _ in 0..2 {
        let error = e.step_rigid_bodies_checked(dt).unwrap_err();
        assert!(error.contains("physics capacity exceeded"), "{error}");
        assert_eq!(
            e.unified_physics_error(),
            Some(UnifiedPhysicsError::Physics(PhysicsError::CapacityExceeded))
        );
        assert_eq!(e.unified_physics_step_statistics().unwrap(), stats);
        assert_eq!(e.unified_body_state(moving).unwrap(), state);
        assert!(crate::engine::persistence::encode(&e).unwrap() == saved);
        assert!(capture_bytes(&mut e) == native);
    }
    configure_platform_slots(&mut e, 15);
    e.step_rigid_bodies_checked(dt).unwrap();
}

#[test]
fn clock_preflight_preserves_legacy_planar_inputs_for_the_next_tick() {
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
        let legacy = e.world.rigid_bodies[a.id as usize].as_mut().unwrap();
        legacy.force = Velocity { vx: 50., vy: 0. };
        legacy.impulse = Velocity { vx: 0., vy: 2. };
        let saved = capture_bytes(&mut e);
        for _ in 0..rejections {
            assert!(e.step_rigid_bodies_checked(dt / 2.).is_err());
            assert_eq!(
                e.unified_physics_error(),
                Some(UnifiedPhysicsError::ClockMismatch)
            );
            assert!(capture_bytes(&mut e) == saved);
        }
        e.step_rigid_bodies_checked(dt).unwrap();
        e.unified_body_state(a).unwrap()
    };
    let once = run(0);
    assert!(once.linear_velocity[0] > 0. && once.linear_velocity[1] > 0.);
    assert_eq!(run(2), once);
}

#[test]
fn rejected_path_frame_retry_advances_tween_and_physics_once() {
    use crate::tweens::{SpriteTint, TweenEasing};
    let run = |rejections: usize| {
        let mut e = engine(Space::Spatial, 128);
        let dt = e.fixed_timestep.config().step_seconds;
        configure_platform_slots(&mut e, 15);
        let sprite = e.world.spawn_enemy(10., 10., 1);
        let site = e.world.spawn_enemy(12., 10., 1);
        assert!(e.set_gameplay_interaction(site.id, site.generation, 17, 30., false));
        assert!(e.configure_data_scene_gameplay(true, sprite.id, sprite.generation, 91));
        assert!(e.set_input_action_binding(
            91,
            0,
            crate::input::INPUT_ACTION_CONTROL_SPACE,
            crate::input::INPUT_ACTION_ACTIVATION_PRESSED,
        ));
        e.set_input(false, false, false, false, true, false, false, 0., 0.);

        assert!(e.tweens.start_sprite_tint(
            &mut e.world,
            sprite,
            SpriteTint::new(1., 1., 1., 1.),
            SpriteTint::new(0., 0., 0., 0.),
            1.,
            TweenEasing::Linear,
        ));
        let dynamic = body(
            &mut e,
            BodyKind::Dynamic,
            [40., 20., 0.],
            [0.; 3],
            Shape::Sphere { radius: 0.25 },
        );
        let id = e.unified_body_id(dynamic).unwrap();
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .add_force(id, [10., 0., 0.], [0.; 3])
            .unwrap();
        queue_dash_before_last_platform(&mut e);
        let before = capture_bytes(&mut e);
        for _ in 0..rejections {
            let error = e
                .update_frame_checked(f64::from(dt), false, false, false)
                .unwrap_err();
            assert!(error.contains("physics capacity exceeded"), "{error}");
            assert!(capture_bytes(&mut e) == before);
        }
        configure_platform_slots(&mut e, 15);
        e.update_frame_checked(f64::from(dt), false, false, false)
            .unwrap();
        assert_eq!(
            e.frame_buffers
                .gameplay_events
                .iter()
                .filter(|event| event.kind == crate::gameplay_event::GAMEPLAY_EVENT_INTERACTION)
                .count(),
            1
        );
        (
            e.world.sprite_at_index(sprite.id as usize).unwrap().r,
            e.unified_body_state(dynamic).unwrap().linear_velocity[0],
        )
    };
    let once = run(0);
    assert!(once.0 < 1. && once.1 > 0.);
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
