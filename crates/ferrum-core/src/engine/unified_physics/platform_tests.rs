use super::*;
use crate::physics3d::{BodyKind, QueryFilter, RayCast, Shape};

#[test]
fn runtime_checkpoint_replays_terrain_platform_phase_queued_jump_and_interpolation() {
    use crate::engine::runtime_checkpoint::tests::signature;
    let mut e = engine(0.01);
    let a = actor(&mut e);
    configure(&mut e, [1., 0.2, 0.], 0.3, 0.1);
    tick(&mut e, 13);
    e.set_unified_character_input(
        a,
        CharacterInput {
            velocity: [0.2, 0., 0.],
            jump_speed: 2.,
        },
    )
    .unwrap();
    e.update(0.004);
    let packet = e.runtime_checkpoint().unwrap();
    let before = signature(&e);
    let trace: Vec<_> = (0..90)
        .map(|_| {
            e.update(0.007);
            signature(&e)
        })
        .collect();
    assert!(e
        .unified_body_state(a)
        .unwrap()
        .pose
        .position
        .iter()
        .all(|v| v.is_finite()));
    e.restore_runtime_checkpoint_native(&packet).unwrap();
    assert_eq!(signature(&e), before);
    for expected in trace {
        e.update(0.007);
        assert_eq!(signature(&e), expected);
    }
}

pub(super) fn engine(dt: f32) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        step_seconds: dt,
        ..WorldConfig::default()
    })
    .unwrap();
    assert!(e.spatial_scene.configure_surfaces(
        &[-3.0, -3.0, 6.0, 6.0, -0.2, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
        &[1, 0, 0, 1]
    ));
    e
}
pub(super) fn actor(e: &mut Engine) -> Entity {
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [0.0, 0.51, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
            [0.0; 3],
        )
        .unwrap();
    e.enable_unified_character(a, CharacterConfig::default())
        .unwrap();
    tick(e, 5);
    assert!(e.unified_character_state(a).unwrap().grounded);
    a
}
pub(super) fn tick(e: &mut Engine, count: usize) {
    for _ in 0..count {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
        if e.unified_physics_error().is_some() {
            eprintln!(
                "C12_PLATFORM phase={:?}",
                e.capture_spatial_moving_platforms()
            );
        }
        assert_eq!(e.unified_physics_error(), None);
    }
}
pub(super) fn configure(e: &mut Engine, offset: [f64; 3], duration: f64, phase: f64) {
    assert!(e.configure_spatial_moving_platforms(&[
        2.0, 1.0, offset[0], offset[1], offset[2], duration, phase, 0.0
    ]));
}
fn platform_hit(e: &mut Engine) -> UnifiedTerrainRayHit {
    let mut hits = Vec::new();
    e.cast_unified_terrain_ray_all(
        &RayCast {
            origin: [0.0, 10.0, 0.0],
            direction: [0.0, -1.0, 0.0],
            max_distance: 30.0,
            solid: true,
        },
        &QueryFilter {
            respect_target_mask: false,
            ..QueryFilter::default()
        },
        &mut hits,
        16,
    )
    .unwrap();
    hits.remove(0)
}

#[test]
fn authored_platform_carries_capsule_in_xyz_through_reversals_without_query_teleports() {
    for offset in [[2.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 2.0]] {
        let mut e = engine(1.0 / 60.0);
        let a = actor(&mut e);
        let initial = platform_hit(&mut e).hit.target;
        configure(&mut e, offset, 1.0, 0.0);
        for _ in 0..150 {
            // Non-stepping queries must not cancel a queued platform move or its support.
            let current = e.unified_body_state(a).unwrap().pose.position;
            let mut hits = Vec::new();
            e.cast_unified_terrain_ray_all(
                &RayCast {
                    origin: [current[0], current[1] + 5.0, current[2]],
                    direction: [0.0, -1.0, 0.0],
                    max_distance: 10.0,
                    solid: true,
                },
                &QueryFilter::default(),
                &mut hits,
                16,
            )
            .unwrap();
            assert_eq!(hits[0].hit.target, initial);
            tick(&mut e, 1);
            let s = e.spatial_scene.surfaces[0];
            let p = e.unified_body_state(a).unwrap().pose.position;
            assert!(
                (p[0] - (s.bounds[0] + 3.0)).abs() < 0.04
                    && (p[2] + s.bounds[1] + 3.0).abs() < 0.04,
                "{offset:?}: {p:?} {:?}",
                s.bounds
            );
            assert!(
                (p[1] - s.heights[0] - 0.51).abs() < 0.03,
                "{offset:?}: {p:?} {}",
                s.heights[0]
            );
            assert!(e.unified_character_state(a).unwrap().grounded);
            assert_eq!(e.spatial_moving_platform_stats(), vec![1, 0]);
        }
        // Removing the path leaves a stationary support with the same identity.
        assert!(e.configure_spatial_moving_platforms(&[]));
        let before = e.unified_body_state(a).unwrap().pose.position;
        tick(&mut e, 20);
        let after = e.unified_body_state(a).unwrap().pose.position;
        assert!((after[0] - before[0]).abs() < 0.001 && (after[2] - before[2]).abs() < 0.001);
        assert_eq!(e.spatial_moving_platform_stats(), vec![0, 0]);
    }
}

#[test]
fn authored_platform_phase_advances_only_on_successful_native_ticks() {
    let mut e = engine(1.0 / 60.0);
    configure(&mut e, [2.0, 0.0, 0.0], 1.0, 0.0);
    let initial = e.capture_spatial_moving_platforms();
    platform_hit(&mut e);
    e.update(0.0);
    assert_eq!(e.capture_spatial_moving_platforms(), initial);
    assert!(e.pause_data_scene());
    tick(&mut e, 5);
    assert_eq!(e.capture_spatial_moving_platforms(), initial);
    assert!(e.resume_data_scene());
    e.auto_rigid_body_step_enabled = false;
    tick(&mut e, 5);
    assert_eq!(e.capture_spatial_moving_platforms(), initial);
    let dt = e.fixed_timestep.config().step_seconds;
    assert!(e.step_unified_manually(dt, None));
    assert!((e.capture_spatial_moving_platforms()[6] - f64::from(dt)).abs() < 1e-10);
    let phase = e.capture_spatial_moving_platforms();
    assert!(e.step_unified_manually(dt * 0.5, None));
    assert_eq!(e.capture_spatial_moving_platforms(), phase);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::ClockMismatch)
    );
}

#[test]
fn full_cycle_inside_tick_preserves_rider_transport_and_motion_work() {
    let mut e = engine(0.1);
    let a = actor(&mut e);
    configure(&mut e, [1.0, 0.0, 0.0], 0.05, 0.0);
    let start = e.unified_body_state(a).unwrap().pose.position;
    tick(&mut e, 1);
    let end = e.unified_body_state(a).unwrap().pose.position;
    eprintln!(
        "C12_FULL_CYCLE start={start:?} end={end:?} character={:?} phase={:?}",
        e.unified_character_state(a),
        e.capture_spatial_moving_platforms()
    );
    assert!((end[0] - start[0]).abs() < 0.03);
    assert!(e.unified_character_state(a).unwrap().grounded);
    assert!(e.unified_character_state(a).unwrap().carried_by.is_some());
    assert_eq!(e.spatial_moving_platform_stats(), vec![1, 0]);
    let stats = e
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .step_statistics();
    assert_eq!(stats.backend_steps, 2);
}

#[test]
fn rejected_physics_batch_does_not_advance_platform_phase_or_actor() {
    let mut e = engine(0.1);
    let a = actor(&mut e);
    // A pending malformed terrain edit must fail before consuming platform progress.
    configure(&mut e, [1_000_000.0, 0.0, 0.0], 0.05, 0.025);
    e.tilemap
        .set_layer(0, 1, 1, 1_000_000.0, 1.0, 0.0, 0.0, true, vec![1]);
    let phase = e.capture_spatial_moving_platforms();
    let before = e.unified_body_state(a).unwrap();
    e.update(0.1);
    assert!(e.unified_physics_error().is_some());
    assert_eq!(e.capture_spatial_moving_platforms(), phase);
    assert_eq!(e.unified_body_state(a).unwrap(), before);
}

#[test]
fn jumping_releases_native_platform_carry_and_live_path_edits_keep_identity() {
    let mut e = engine(1.0 / 60.0);
    let a = actor(&mut e);
    configure(&mut e, [2.0, 0.0, 0.0], 1.0, 0.0);
    tick(&mut e, 15);
    let ground = e.unified_character_state(a).unwrap().ground.unwrap();
    let revision = e.spatial_configuration_revision();
    e.set_unified_character_input(
        a,
        CharacterInput {
            velocity: [0.0; 3],
            jump_speed: 4.0,
        },
    )
    .unwrap();
    tick(&mut e, 1);
    assert!(e.unified_character_state(a).unwrap().carried_by.is_none());
    assert!(!e.unified_character_state(a).unwrap().grounded);
    let x = e.unified_body_state(a).unwrap().pose.position[0];
    tick(&mut e, 10);
    assert!((e.unified_body_state(a).unwrap().pose.position[0] - x).abs() < 1e-6);
    assert_eq!(e.spatial_configuration_revision(), revision);
    let phase = e.capture_spatial_moving_platforms()[6];
    configure(&mut e, [0.0, 0.0, 1.0], 1.0, phase);
    let h = platform_hit(&mut e);
    assert_eq!(h.hit.target, ground);
    tick(&mut e, 60);
    assert!(e.unified_character_state(a).unwrap().grounded);
}
