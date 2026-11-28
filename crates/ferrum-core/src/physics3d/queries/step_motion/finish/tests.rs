use super::*;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Pose, QueryFilter, Shape, WorldConfig};

#[test]
fn exhausted_capture_preserves_the_tree_and_replay_recovers() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                linear_velocity: [1., 0., 0.],
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.01 }),
        )
        .unwrap();
    world.set_step_motion_enabled(true);
    world.step_checked().unwrap();
    assert!(world.step_motion.ready);
    let tree = postcard::to_allocvec(&world.step_motion.bvh).unwrap();
    let mut exhausted = Work {
        used: 97,
        limit: 97,
    };
    world
        .step_motion
        .finish(&world.backend.colliders, &mut exhausted);
    assert_eq!(exhausted.used, 97);
    assert_eq!(postcard::to_allocvec(&world.step_motion.bvh).unwrap(), tree);
    assert!(!world.step_motion.ready);
    world.step_motion.validate_saved_payload().unwrap();

    let snapshot = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
    for world in [&world, &restored] {
        assert_eq!(
            world.sweep_step_motion(
                &Shape::Sphere { radius: 0.001 },
                Pose::default(),
                [0.; 3],
                &QueryFilter::default(),
                &mut Vec::new(),
                8,
            ),
            Err(PhysicsError::InvalidQuery)
        );
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            snapshot.encoded_bytes()
        );
    }
    for _ in 0..6 {
        world.step_checked().unwrap();
        restored.step_checked().unwrap();
        assert!(world.step_motion.ready);
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}
