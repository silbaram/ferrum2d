use super::platform_tests::{actor, configure, engine, tick};
use super::*;
use crate::physics3d::{BodyKind, Shape};
fn wall(e: &mut Engine, position: [f32; 3], half: [f32; 3]) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position,
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box { half_extents: half }),
        [0.0; 3],
    )
    .unwrap()
}

#[test]
fn platform_stops_before_native_wall_and_resumes_after_removal() {
    let mut e = engine(1.0 / 60.0);
    let obstacle = wall(&mut e, [4.0, 0.0, 0.0], [0.25, 2.0, 5.0]);
    configure(&mut e, [2.0, 0.0, 0.0], 1.0, 0.0);
    tick(&mut e, 90);
    let center = e.spatial_scene.surfaces[0].bounds[0] + 3.0;
    assert!((0.70..=0.751).contains(&center), "center={center}");
    assert_eq!(e.spatial_moving_platform_stats(), vec![0, 1]);
    let phase = e.capture_spatial_moving_platforms()[6];
    assert!((0.35..=0.376).contains(&phase), "phase={phase}");
    e.update(f64::from(e.fixed_timestep.config().step_seconds) * 2.0);
    let frame = e.unified_physics_frame_statistics().unwrap();
    assert_eq!(frame.fixed_steps, 2);
    assert_eq!(frame.totals.kinematic_path_stops, 2);
    assert!(frame.totals.kinematic_path_casts >= 2);
    assert_eq!(frame.totals.kinematic_path_failures, 0);
    e.remove_unified_body(obstacle).unwrap();
    tick(&mut e, 10);
    assert!(e.capture_spatial_moving_platforms()[6] > phase + 0.15);
    assert_eq!(e.spatial_moving_platform_stats(), vec![0, 0]);
}
#[test]
fn elevator_limits_progress_before_a_supported_capsule_is_squeezed() {
    let mut e = engine(1.0 / 60.0);
    let a = actor(&mut e);
    wall(&mut e, [0.0, 2.25, 0.0], [5.0, 0.25, 5.0]);
    configure(&mut e, [0.0, 0.0, 2.0], 1.0, 0.0);
    tick(&mut e, 90);
    let top = e.spatial_scene.surfaces[0].heights[0];
    let p = e.unified_body_state(a).unwrap().pose.position;
    assert!((0.9..=1.0).contains(&top), "top={top}, actor={p:?}");
    assert!(
        p[1] + 0.5 <= 2.001 && (p[1] - top - 0.51).abs() < 0.03,
        "top={top}, actor={p:?}"
    );
    assert!(e.unified_character_state(a).unwrap().grounded);
    assert_eq!(e.spatial_moving_platform_stats(), vec![0, 1]);
}
#[test]
fn approaching_platforms_stop_together_at_relative_contact_time() {
    let mut e = engine(0.1);
    assert!(e.spatial_scene.configure_surfaces(
        &[
            -2.5, -0.5, 1.0, 1.0, -0.2, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.5, -0.5, 1.0, 1.0, -0.2,
            0.0, 0.0, 1.0, 1.0, 1.0, 1.0
        ],
        &[1, 0, 0, 1, 2, 1, 0, 1]
    ));
    assert!(e.configure_spatial_moving_platforms(&[
        2.0, 1.0, 4.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 2.0, -4.0, 0.0, 0.0, 1.0, 0.0, 0.0
    ]));
    tick(&mut e, 8);
    let left = e.spatial_scene.surfaces[0].bounds[0] + 0.5;
    let right = e.spatial_scene.surfaces[1].bounds[0] + 0.5;
    assert!(
        (left + 0.5).abs() < 0.02 && (right - 0.5).abs() < 0.02,
        "{left}, {right}"
    );
    let phases = e.capture_spatial_moving_platforms();
    assert!(
        (phases[6] - 0.375).abs() < 0.005 && (phases[14] - 0.375).abs() < 0.005,
        "{phases:?}"
    );
    assert_eq!(e.spatial_moving_platform_stats(), vec![0, 2]);
}
#[test]
fn obstacle_before_turnaround_does_not_disappear_when_tick_endpoint_returns() {
    let mut e = engine(0.1);
    wall(&mut e, [4.0, 0.0, 0.0], [0.25, 2.0, 5.0]);
    configure(&mut e, [4.0, 0.0, 0.0], 0.05, 0.0);
    tick(&mut e, 1);
    let center = e.spatial_scene.surfaces[0].bounds[0] + 3.0;
    assert!((0.70..=0.751).contains(&center), "{center}");
    assert!((e.capture_spatial_moving_platforms()[6] - 0.009375).abs() < 0.0005);
    assert_eq!(e.spatial_moving_platform_stats(), vec![0, 1]);
}

#[test]
fn opposing_elevator_and_ceiling_stop_before_squeezing_the_rider() {
    let mut e = engine(0.1);
    assert!(e.spatial_scene.configure_surfaces(
        &[
            -3.0, -3.0, 6.0, 6.0, -0.2, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, -3.0, -3.0, 6.0, 6.0, 2.0,
            2.2, 2.2, 1.0, 1.0, 1.0, 1.0
        ],
        &[1, 0, 0, 1, 2, 1, 0, 1]
    ));
    let a = actor(&mut e);
    assert!(e.configure_spatial_moving_platforms(&[
        2.0, 1.0, 0.0, 0.0, 2.0, 1.0, 0.0, 0.0, 2.0, 2.0, 0.0, 0.0, -2.0, 1.0, 0.0, 0.0
    ]));
    tick(&mut e, 12);
    let bottom = e.spatial_scene.surfaces[0].heights[0];
    let ceiling = e.spatial_scene.surfaces[1].base;
    let y = e.unified_body_state(a).unwrap().pose.position[1];
    assert!(
        (bottom - 0.49).abs() < 0.02 && (ceiling - 1.51).abs() < 0.02,
        "{bottom} {ceiling} {y}"
    );
    assert!(
        y + 0.5 <= ceiling + 0.001 && y - 0.5 >= bottom,
        "{bottom} {ceiling} {y}"
    );
    assert!(e.unified_character_state(a).unwrap().grounded);
    assert_eq!(e.spatial_moving_platform_stats(), vec![0, 2]);
    assert_eq!(
        e.unified_physics_step_statistics()
            .unwrap()
            .kinematic_path_stops,
        2
    );
}

#[test]
fn diagonal_carry_stops_at_first_side_contact_and_resumes_after_wall_removal() {
    let mut e = engine(1.0 / 60.0);
    let a = actor(&mut e);
    // Above the platform: only the rider, not the platform, hits this wall.
    let obstacle = wall(&mut e, [1.0, 1.0, 0.0], [0.1, 0.5, 10.0]);
    configure(&mut e, [2.0, -2.0, 0.0], 1.0, 0.0);
    tick(&mut e, 20);
    let stopped = e.unified_body_state(a).unwrap();
    let [x, _, z] = stopped.pose.position;
    assert!((x - z).abs() < 0.0001, "{x}, {z}");
    assert_eq!(stopped.linear_velocity[2], 0.0);
    tick(&mut e, 60);
    let p = e.unified_body_state(a).unwrap().pose.position;
    let s = e.spatial_scene.surfaces[0];
    let x = s.bounds[0] + 3.0;
    assert!(
        (x - 0.64).abs() < 0.025 && (p[0] - x).abs() < 0.02 && (p[2] - x).abs() < 0.02,
        "{x} {p:?}"
    );
    assert!(e.unified_character_state(a).unwrap().grounded);
    e.remove_unified_body(obstacle).unwrap();
    tick(&mut e, 10);
    assert!(e.unified_body_state(a).unwrap().pose.position[0] > x + 0.3);
}

#[test]
fn native_engine_platform_and_receding_wall_preserve_carry_phase_and_diagnostics() {
    let mut e = engine(0.1);
    let a = actor(&mut e);
    let moving = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [1.0, 1.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 0.5, 5.0],
            }),
            [0.0; 3],
        )
        .unwrap();
    let id = e.unified_body_id(moving).unwrap();
    configure(&mut e, [20.0, 0.0, 0.0], 1.0, 0.0);
    for step in 1..=8 {
        let x = step as f32 * 2.0;
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .set_kinematic_target(
                id,
                Pose {
                    position: [x + 1.0, 1.0, 0.0],
                    ..Pose::default()
                },
            )
            .unwrap();
        tick(&mut e, 1);
        let state = e.unified_character_state(a).unwrap();
        assert!((e.unified_body_state(a).unwrap().pose.position[0] - x).abs() < 0.002);
        assert!(state.grounded && (state.carry_translation[0] - 2.0).abs() < 0.002);
        assert_eq!(e.spatial_moving_platform_stats(), vec![1, 0]);
        assert!((e.capture_spatial_moving_platforms()[6] - step as f64 * 0.1).abs() < 0.0001);
        let work = e.unified_physics_step_statistics().unwrap();
        assert!(work.character_preview_obstacle_casts > 0);
        assert_eq!(work.kinematic_path_stops, 0);
    }
}

#[test]
fn external_squeeze_stops_the_engine_body_and_accumulates_work_across_ticks() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        gravity: [0.0; 3],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
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
    wall(&mut e, [-1.0, 0.0, 0.0], [0.25, 2.0, 5.0]);
    let moving = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [3.0, 0.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 2.0, 5.0],
            }),
            [0.0; 3],
        )
        .unwrap();
    e.set_unified_body_velocity(moving, [-60.0, 0.0, 0.0], [0.0; 3])
        .unwrap();
    e.update(f64::from(e.fixed_timestep.config().step_seconds) * 2.0);
    assert_eq!(e.unified_physics_error(), None);
    let state = e.unified_body_state(moving).unwrap();
    assert!((state.pose.position[0] - 0.02).abs() < 0.001, "{state:?}");
    assert_eq!(state.linear_velocity, [0.0; 3]);
    assert!((e.unified_body_state(a).unwrap().pose.position[0] + 0.49).abs() < 0.001);
    let step = e.unified_physics_step_statistics().unwrap();
    let frame = e.unified_physics_frame_statistics().unwrap();
    assert_eq!(step.kinematic_character_stops, 0);
    assert_eq!(frame.fixed_steps, 2);
    assert_eq!(frame.totals.kinematic_character_stops, 1);
    assert!(frame.totals.character_preview_obstacle_contacts > 0);
    assert_eq!(frame.totals.character_preview_obstacle_failures, 0);
    assert_eq!(frame.totals.backend_steps, 3);
    e.update(0.0);
    assert_eq!(
        e.unified_physics_frame_statistics().unwrap().totals,
        crate::physics3d::StepStatistics::default()
    );
}

#[test]
fn coupled_capsules_stop_an_engine_pusher_and_report_preview_work() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        gravity: [0.0; 3],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
    .unwrap();
    let mut actors = Vec::new();
    for x in [0.0, -1.0] {
        let a = e
            .create_unified_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [x, 0.0, 0.0],
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
        actors.push(a);
    }
    wall(&mut e, [-3.0, 0.0, 0.0], [0.25, 2.0, 5.0]);
    let p = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [3.0, 0.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 2.0, 5.0],
            }),
            [0.0; 3],
        )
        .unwrap();
    e.set_unified_body_velocity(p, [-60.0, 0.0, 0.0], [0.0; 3])
        .unwrap();
    e.update(f64::from(e.fixed_timestep.config().step_seconds) * 2.0);
    assert_eq!(e.unified_physics_error(), None);
    let state = e.unified_body_state(p).unwrap();
    assert!((state.pose.position[0] + 1.47).abs() < 0.02, "{state:?}");
    assert_eq!(state.linear_velocity, [0.0; 3]);
    for (&a, expected) in actors.iter().zip([-1.98, -2.49]) {
        assert!((e.unified_body_state(a).unwrap().pose.position[0] - expected).abs() < 0.02);
    }
    let frame = e.unified_physics_frame_statistics().unwrap();
    assert_eq!(frame.fixed_steps, 2);
    assert_eq!(frame.totals.kinematic_character_stops, 1);
    assert!(
        frame.totals.character_preview_pair_contacts > 0
            && frame.totals.character_preview_coupling_visits > 0
    );
    // The bounded solver reports the incompatible moving/fixed pressure chain.
    assert!(frame.totals.character_preview_coupling_limits > 0);
    assert_eq!(
        e.unified_physics_step_statistics()
            .unwrap()
            .kinematic_character_stops,
        0
    );
    e.update(0.0);
    assert_eq!(
        e.unified_physics_frame_statistics().unwrap().totals,
        crate::physics3d::StepStatistics::default()
    );
}
