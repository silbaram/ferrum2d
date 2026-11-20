use super::*;
use crate::physics3d::{
    BodyDesc, BodyKind, CharacterConfig, ColliderDesc, Pose, Shape, WorldConfig,
};

#[test]
fn committed_geometry_keeps_zero_mass_snapshots_valid_and_preserves_finite_momentum() {
    for mass in [0., 10.] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            ..Default::default()
        })
        .unwrap();
        let actor = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.25,
                    radius: 0.25,
                }),
            )
            .unwrap();
        world
            .enable_character(
                actor,
                CharacterConfig {
                    push_mass: mass,
                    ..Default::default()
                },
            )
            .unwrap();
        let translation = rp::Vector::new(0.25, 0.125, 0.);
        // Feedback follows an already accepted backend write; it records this
        // displacement without another integration or pose change.
        world
            .set_pose(
                actor,
                Pose {
                    position: translation.to_array(),
                    ..Default::default()
                },
            )
            .unwrap();
        let row = BackendCharacterFeedback {
            body: actor,
            translation,
            carry_translation: rp::Vector::X * 0.125,
            velocity_delta: rp::Vector::new(3., 2., 0.),
            blocked_moving: true,
            blocked_character: true,
            hit_ceiling: true,
        };
        let dt = world.config.step_seconds;
        world.publish_backend_motion_feedback(&[row], dt).unwrap();
        let runtime = &world.characters[&actor];
        assert_eq!(runtime.state.translation, translation.to_array());
        assert_eq!(runtime.state.velocity, (translation / dt).to_array());
        assert_eq!(runtime.state.carry_translation, [0.125, 0., 0.]);
        assert!(runtime.state.blocked_by_moving_obstacle);
        assert!(runtime.state.blocked_by_character);
        assert!(runtime.state.hit_ceiling);
        assert_eq!(runtime.external_force, [0.; 3]);
        assert_eq!(runtime.pending_impulse, [0.; 3]);
        assert_eq!(runtime.contact_velocity, [0.; 3]);
        assert_eq!(
            runtime.external_velocity,
            if mass == 0. { [0.; 3] } else { [3., 2., 0.] }
        );
        let saved = world.capture_snapshot().unwrap();
        let restored = PhysicsWorld3d::from_snapshot(&saved).unwrap();
        assert_eq!(world.body_state(actor), restored.body_state(actor));
        assert_eq!(
            world.character_state(actor),
            restored.character_state(actor)
        );
        assert_eq!(
            saved.encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}
