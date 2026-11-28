use super::*;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Shape, WorldConfig};

#[test]
fn dense_sensor_graph_path_ticks_without_the_proof_journal_budget() {
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
    w.begin_backend_motion_tick();
    // Reproduce the old path admission directly. The journal's graph budget
    // rejected this valid world even though ordinary Rapier could step it.
    assert!(w.begin_backend_step_rollback().is_err());
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
