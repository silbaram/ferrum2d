use super::*;
use crate::physics3d::{BodyDesc, BodyKind, CharacterConfig, ColliderDesc, Pose, Shape};

fn engine(space: Space) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        step_seconds: 0.01,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn spawn(e: &mut Engine, kind: BodyKind, x: f32) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind,
            pose: Pose {
                position: [x, 0.0, 0.0],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.5; 3],
        }),
        [0.0; 3],
    )
    .unwrap()
}
fn handles(entities: &[Entity]) -> Vec<u32> {
    entities.iter().flat_map(|e| [e.id, e.generation]).collect()
}
fn state(e: &Engine, h: Entity) -> BodyState {
    e.unified_body_state(h).unwrap()
}
fn tick(e: &mut Engine) {
    e.update(f64::from(0.01_f32));
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 1e-4, "{a} != {b}");
}
fn pose(x: f32, z: f32) -> [f32; 7] {
    [x, 0.0, z, 0.0, 0.0, 0.0, 1.0]
}

#[test]
fn teleports_project_immediately_and_targets_commit_on_tick_with_atomic_admission() {
    let mut e = engine(Space::Spatial);
    let a = spawn(&mut e, BodyKind::KinematicPosition, 0.0);
    let b = spawn(&mut e, BodyKind::Fixed, 20.0);
    e.command_unified_physics_bodies(
        0,
        &handles(&[a, a]),
        &[pose(1.0, 2.0), pose(3.0, 4.0)].concat(),
    )
    .unwrap();
    assert_eq!(state(&e, a).pose.position, [3.0, 0.0, 4.0]);
    let visual = e.world.transform(a).unwrap();
    assert_eq!([visual.x, visual.y], [3.0, -4.0]);
    e.command_unified_physics_bodies(
        1,
        &handles(&[a, a]),
        &[pose(4.0, 4.0), pose(5.0, 4.0)].concat(),
    )
    .unwrap();
    assert_eq!(state(&e, a).pose.position, [3.0, 0.0, 4.0]);
    assert!(e
        .command_unified_physics_bodies(
            1,
            &handles(&[a, b]),
            &[pose(9.0, 4.0), pose(21.0, 0.0)].concat()
        )
        .is_err());
    tick(&mut e);
    near(state(&e, a).pose.position[0], 5.0);
    assert_eq!(state(&e, b).pose.position, [20.0, 0.0, 0.0]);
    let id = e.unified_body_id(a).unwrap();
    let world = &mut e.unified_physics.as_mut().unwrap().physics;
    let options = crate::physics3d::BodyOptions {
        kind: BodyKind::KinematicPosition,
        lock_rotation: true,
        ..crate::physics3d::BodyOptions::default()
    };
    world.set_body_options(id, &options).unwrap();
    e.command_unified_physics_bodies(1, &handles(&[a]), &pose(6.0, 4.0))
        .unwrap();
    let mut rotated = pose(7.0, 4.0);
    rotated[5] = std::f32::consts::FRAC_1_SQRT_2;
    rotated[6] = std::f32::consts::FRAC_1_SQRT_2;
    assert!(e
        .command_unified_physics_bodies(1, &handles(&[a, a]), &[pose(8.0, 4.0), rotated].concat())
        .is_err());
    tick(&mut e);
    near(state(&e, a).pose.position[0], 6.0);
}

#[test]
fn persistent_force_clear_impulse_sleep_and_locked_axes_share_native_dynamics() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut e = engine(space);
        let a = spawn(&mut e, BodyKind::Dynamic, 0.0);
        let h = handles(&[a]);
        let forces = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0];
        e.command_unified_physics_bodies(2, &handles(&[a, a]), &[forces, forces].concat())
            .unwrap();
        tick(&mut e);
        tick(&mut e);
        near(state(&e, a).linear_velocity[0], 0.04);
        e.command_unified_physics_bodies(3, &h, &[]).unwrap();
        tick(&mut e);
        near(state(&e, a).linear_velocity[0], 0.04);
        // Unit-mass cube: angular inverse inertia is 6. Locked planar axes discard force components.
        e.command_unified_physics_bodies(4, &h, &[1.0, 0.0, 2.0, 3.0, 0.0, 1.0])
            .unwrap();
        let s = state(&e, a);
        near(s.linear_velocity[0], 1.04);
        near(s.angular_velocity[2], 6.0);
        if space == Space::PlanarXy {
            assert_eq!(s.linear_velocity[2], 0.0);
            assert_eq!(s.angular_velocity[0], 0.0);
        } else {
            near(s.linear_velocity[2], 2.0);
            near(s.angular_velocity[0], 18.0);
        }
        e.command_unified_physics_bodies(5, &h, &[]).unwrap();
        let s = state(&e, a);
        assert!(s.sleeping);
        assert_eq!(s.linear_velocity, [0.0; 3]);
        assert_eq!(s.angular_velocity, [0.0; 3]);
        e.command_unified_physics_bodies(6, &h, &[]).unwrap();
        assert!(!state(&e, a).sleeping);
    }
}

#[test]
fn invalid_late_dynamics_or_stale_handle_preserves_force_velocity_and_sleep() {
    let mut e = engine(Space::Spatial);
    let a = spawn(&mut e, BodyKind::Dynamic, 0.0);
    let b = spawn(&mut e, BodyKind::Dynamic, 10.0);
    let fixed = spawn(&mut e, BodyKind::Fixed, 20.0);
    let h = handles(&[a, b]);
    e.command_unified_physics_bodies(5, &h, &[]).unwrap();
    let mut bad = [1.0; 12];
    bad[11] = f32::NAN;
    for code in [2, 4] {
        assert!(e.command_unified_physics_bodies(code, &h, &bad).is_err());
        assert!(state(&e, a).sleeping);
        assert_eq!(state(&e, a).linear_velocity, [0.0; 3]);
    }
    for code in [2, 4] {
        assert!(e
            .command_unified_physics_bodies(code, &handles(&[a, fixed]), &[1.0; 12])
            .is_err());
        assert!(state(&e, a).sleeping);
    }
    e.command_unified_physics_bodies(2, &handles(&[a]), &[2.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        .unwrap();
    assert!(e
        .command_unified_physics_bodies(5, &handles(&[a, fixed]), &[])
        .is_err());
    assert!(!state(&e, a).sleeping);
    e.remove_unified_body(b).unwrap();
    assert!(e.command_unified_physics_bodies(3, &h, &[]).is_err());
    tick(&mut e);
    near(state(&e, a).linear_velocity[0], 0.02);
    for code in [0, 1, 2, 3, 4, 5, 6] {
        let stride = match code {
            0 | 1 => 7,
            2 | 4 => 6,
            _ => 0,
        };
        assert!(e
            .command_unified_physics_bodies(code, &h, &vec![0.0; stride * 2])
            .is_err());
    }
}

#[test]
fn pose_batches_enforce_planar_quaternion_and_controller_ownership_before_mutation() {
    let mut e = engine(Space::PlanarXy);
    let a = spawn(&mut e, BodyKind::Dynamic, 0.0);
    let b = spawn(&mut e, BodyKind::Dynamic, 10.0);
    assert!(e
        .command_unified_physics_bodies(
            0,
            &handles(&[a, b]),
            &[pose(1.0, 0.0), pose(10.0, 1.0)].concat()
        )
        .is_err());
    assert_eq!(state(&e, a).pose.position, [0.0; 3]);
    let mut invalid = pose(10.0, 0.0);
    invalid[6] = 0.0;
    assert!(e
        .command_unified_physics_bodies(0, &handles(&[a, b]), &[pose(1.0, 0.0), invalid].concat())
        .is_err());
    assert_eq!(state(&e, a).pose.position, [0.0; 3]);
    let c = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
            [0.0; 3],
        )
        .unwrap();
    e.enable_unified_character(c, CharacterConfig::default())
        .unwrap();
    assert!(e
        .command_unified_physics_bodies(1, &handles(&[c]), &pose(2.0, 0.0))
        .is_err());
    let tilt = [
        2.0,
        0.0,
        0.0,
        0.0,
        0.0,
        std::f32::consts::FRAC_1_SQRT_2,
        std::f32::consts::FRAC_1_SQRT_2,
    ];
    assert!(e
        .command_unified_physics_bodies(0, &handles(&[a, c]), &[pose(1.0, 0.0), tilt].concat())
        .is_err());
    assert_eq!(state(&e, a).pose.position, [0.0; 3]);
    e.command_unified_physics_bodies(0, &handles(&[c]), &pose(2.0, 0.0))
        .unwrap();
    assert_eq!(state(&e, c).pose.position, [2.0, 0.0, 0.0]);
}

#[test]
fn command_codec_rejects_unknown_codes_malformed_rows_and_capacity() {
    let mut e = engine(Space::Spatial);
    let a = spawn(&mut e, BodyKind::Dynamic, 0.0);
    let h = handles(&[a]);
    assert_eq!(e.unified_physics_command_version(), 1);
    assert!(e.command_unified_physics_bodies(7, &h, &[]).is_err());
    assert!(e.command_unified_physics_bodies(5, &[a.id], &[]).is_err());
    assert!(e
        .command_unified_physics_bodies(5, &vec![0; 131074], &[])
        .is_err());
    for code in [0, 1, 2, 3, 4, 5, 6] {
        assert!(e.command_unified_physics_bodies(code, &h, &[0.0]).is_err());
    }
    e.command_unified_physics_bodies(
        4,
        &handles(&[a, a]),
        &[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    )
    .unwrap();
    near(state(&e, a).linear_velocity[0], 3.0);
    e.command_unified_physics_bodies(0, &[], &[]).unwrap();
    let mut unconfigured = crate::engine::legacy_test_fixture::engine();
    assert!(unconfigured
        .command_unified_physics_bodies(0, &[], &[])
        .is_err());
}
