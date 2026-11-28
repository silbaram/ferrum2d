//! Staged tick inputs are applied inside the rollback journal.
use super::*;
use crate::physics3d::tick_inputs::TickInput;

#[test]
fn zero_progress_rejection_restores_staged_tick_inputs() {
    let dt = 0.01;
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: dt,
        ..WorldConfig::default()
    })
    .unwrap();
    w.force_character_motion_proof();
    let a = body(
        &mut w,
        BodyKind::Dynamic,
        [40., 40., 0.],
        Shape::Sphere { radius: 1. },
    );
    w.step_checked().unwrap();
    let character = body(
        &mut w,
        BodyKind::KinematicPosition,
        [60., 2., 0.],
        Shape::Capsule {
            half_height: 0.5,
            radius: 0.25,
        },
    );
    w.enable_character(character, crate::physics3d::CharacterConfig::default())
        .unwrap();
    body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::TriangleMesh {
            vertices: vec![[-8., -1., -8.], [8., 1., -8.], [0., 0., 8.]],
            triangles: vec![[0, 2, 1]; 4096],
        },
    );
    w.create_body(
        BodyDesc {
            kind: BodyKind::Dynamic,
            pose: Pose {
                position: [0., 1.25, 0.],
                ..Pose::default()
            },
            linear_velocity: [0., -100., 0.],
            ccd: true,
            can_sleep: false,
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.5; 3],
        }),
    )
    .unwrap();
    let before = w.capture_snapshot().unwrap().encoded_bytes().to_vec();
    w.stage_tick_input(
        a,
        TickInput {
            impulse: Some([0., 2., 0.]),
            ..TickInput::default()
        },
    )
    .unwrap();
    assert!(w.step_checked().is_err());
    assert_eq!(w.actual_motion_completed_time(), 0.);
    assert!(w.capture_snapshot().unwrap().encoded_bytes() == before.as_slice());
}
