//! Product preflight must precede staged input consumption.
use super::*;
use crate::physics3d::tick_inputs::TickInput;

#[test]
fn invalid_path_does_not_consume_staged_inputs() {
    let dt = 0.01;
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: dt,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = body(
        &mut w,
        BodyKind::Dynamic,
        [40., 40., 0.],
        Shape::Sphere { radius: 1. },
    );
    let mover = cube(&mut w, BodyKind::KinematicPosition, [0.; 3]);
    w.step_checked().unwrap();
    let start = w.capture_snapshot().unwrap();
    let mut control = PhysicsWorld3d::from_snapshot(&start).unwrap();
    let input = TickInput {
        impulse: Some([0., 2., 0.]),
        ..TickInput::default()
    };
    for world in [&mut w, &mut control] {
        world.stage_tick_input(a, input).unwrap();
    }
    for bad_knot in [0.5, f32::from_bits(1)] {
        let mut knots = vec![(bad_knot, Pose::default())];
        if bad_knot < 0.5 {
            // A positive f32 knot whose Rapier interval would underflow.
            knots.push((1., Pose::default()));
        }
        assert_eq!(
            w.step_with_kinematic_paths(&[KinematicPath {
                body: mover,
                sweep_sensors: false,
                knots,
            }]),
            Err(PhysicsError::InvalidBody)
        );
        assert_eq!(w.staged_tick_inputs, [(a, input)]);
        assert!(w.capture_snapshot().unwrap().encoded_bytes() == start.encoded_bytes());
    }
    let path = KinematicPath {
        body: mover,
        sweep_sensors: false,
        knots: vec![(1., Pose::default())],
    };
    w.step_with_kinematic_paths(std::slice::from_ref(&path))
        .unwrap();
    control.step_with_kinematic_paths(&[path]).unwrap();
    assert!(w.staged_tick_inputs.is_empty());
    assert!(w.body_state(a).unwrap().linear_velocity[1] > 0.);
    same(&w, &control, &[a, mover]);
}
