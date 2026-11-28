use super::world::native_id;
use super::*;

#[test]
fn kcc_with_additional_body_iterations_preserves_full_tick_and_replays() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        space: Space::PlanarXy,
        ..Default::default()
    })
    .unwrap();
    w.create_body(
        BodyDesc {
            kind: BodyKind::KinematicVelocity,
            angular_velocity: [0., 0., 40.],
            can_sleep: false,
            ..Default::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [2., 0.025, 0.1],
        }),
    )
    .unwrap();
    let actor = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [1.2, 1., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    w.enable_character(
        actor,
        CharacterConfig {
            step_height: 0.,
            snap_distance: 0.,
            ..Default::default()
        },
    )
    .unwrap();
    let tuned = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                can_sleep: false,
                pose: Pose {
                    position: [100., 0., 0.],
                    ..Default::default()
                },
                linear_velocity: [0., 1., 0.],
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
        )
        .unwrap();
    // This is an admitted restored backend setting, not a new public Core
    // setter. The actual private native codec must accept and retain it.
    w.backend.bodies[native_id(tuned)].set_additional_solver_iterations(32);
    w.backend.bodies[native_id(tuned)].set_additional_pgs_iterations(32);
    w.set_step_motion_enabled(true);
    let saved = w.capture_snapshot().unwrap();
    w.restore_snapshot(&saved).unwrap();
    assert_eq!(
        w.backend.bodies[native_id(tuned)].additional_solver_iterations(),
        32
    );
    w.step_checked().unwrap();
    assert_eq!(w.step_statistics().backend_steps, 1);
    assert!((w.body_state(tuned).unwrap().pose.position[1] - 0.1).abs() < 1e-6);
    assert_eq!(
        w.backend.bodies[native_id(tuned)].additional_pgs_iterations(),
        32
    );
    let mut expected = Vec::new();
    expected.push(w.capture_snapshot().unwrap());
    for _ in 0..6 {
        w.step_checked().unwrap();

        expected.push(w.capture_snapshot().unwrap());
    }
    w.restore_snapshot(&saved).unwrap();
    for expected in expected {
        w.step_checked().unwrap();

        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            expected.encoded_bytes()
        );
    }
}
