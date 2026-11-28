use super::*;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Shape, WorldConfig};

#[test]
fn dense_sensor_graph_path_completes_with_a_bounded_event_queue() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        max_bodies: 121,
        max_colliders: 121,
        max_characters: 1,
        max_events: 32,
        ..Default::default()
    })
    .unwrap();
    for _ in 0..120 {
        w.create_body(
            BodyDesc {
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
            },
        )
        .unwrap();
    }
    let mover = w
        .create_body_without_collider(BodyDesc {
            kind: BodyKind::KinematicPosition,
            pose: Pose {
                position: [20., 0., 0.],
                ..Default::default()
            },
            ..Default::default()
        })
        .unwrap();
    w.step_checked().unwrap();
    assert!(w.backend.narrow_phase.intersection_pairs().count() > 1000);
    let target = Pose {
        position: [21., 0., 0.],
        ..Default::default()
    };
    w.step_with_kinematic_paths(&[KinematicPath {
        body: mover,
        sweep_sensors: false,
        knots: vec![(1., target)],
    }])
    .unwrap();
    assert_eq!(w.step_statistics().backend_steps, 1);
    assert_eq!(w.body_state(mover).unwrap().pose, target);
}
