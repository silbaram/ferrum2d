use super::super::{BodyDesc, BodyKind, ColliderDesc, Shape, WorldConfig};
use super::*;
#[test]
fn controller_admission_profile_all_private_numeric_fields_are_checked_without_repair() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let body = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
        )
        .unwrap();
    world
        .enable_character(body, CharacterConfig::default())
        .unwrap();
    let profile = world.character_route_profile(body).unwrap();
    assert!(profile.saved_controller_profile_valid());
    let original = crate::checkpoint_codec::encode(&profile).unwrap();
    for case in 0..10 {
        let mut bad = profile.clone();
        match case {
            0 => bad.config.up = [0.; 3],
            1 => bad.capsule[0] = f32::NAN,
            2 => bad.capsule[6] = 0.,
            3 => bad.rotation = [0.; 4],
            4 => bad.local.translation.x = f32::INFINITY,
            5 => bad.config.push_mass = -1.,
            6 => {
                bad.span = Some(PlanarCollisionSpan {
                    floor: 0,
                    elevation: 0.,
                    height: -1.,
                })
            }
            8 => bad.config.skin_width = 0.125,
            9 => {
                bad.rotation = rp::Rotation::from_rotation_x(std::f32::consts::FRAC_PI_2).to_array()
            }
            _ => bad.config.skin_width = 0.,
        }
        let bytes = crate::checkpoint_codec::encode(&bad).unwrap();
        let c: CharacterRouteProfile = crate::checkpoint_codec::decode(&bytes).unwrap();
        assert!(!c.saved_controller_profile_valid(), "case{case}");
        assert_eq!(crate::checkpoint_codec::encode(&c).unwrap(), bytes);
        assert_eq!(crate::checkpoint_codec::encode(&profile).unwrap(), original);
    }
    world.remove_body(body).unwrap();
    assert!(profile.saved_controller_profile_valid());
}
