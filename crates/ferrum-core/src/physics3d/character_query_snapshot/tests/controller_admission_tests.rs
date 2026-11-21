use super::*;
#[test]
fn controller_admission_saved_snapshot_census_numeric_and_stale_headers_are_separate() {
    let (mut world, actor, floor) = fixture(Space::Spatial);
    let id = world.collider_ids(floor).unwrap().next().unwrap();
    world
        .set_terrain_one_way(
            id,
            Some(super::super::super::one_way::TerrainOneWay {
                point: [0.; 3],
                normal: [0., 1., 0.],
            }),
        )
        .unwrap();
    let config = world.character_config(actor).unwrap().clone();
    let pose = world.body_state(actor).unwrap().pose;
    let snapshot = world.capture_character_query_snapshot(actor, true).unwrap();
    let fixed = world.capture_fixed_query_snapshot();
    assert!(snapshot.saved_controller_payload_valid(actor, &config, pose, true));
    assert!(fixed.saved_controller_payload_valid());
    assert!(snapshot.saved_controller_work().unwrap() > 96);
    let original = crate::checkpoint_codec::encode(&snapshot).unwrap();
    for case in 0..11 {
        let mut bad = snapshot.clone();
        match case {
            0 => bad.colliders.reverse(),
            1 => bad.colliders.push(bad.colliders[0].clone()),
            2 => bad.colliders[0].pose.translation.x = f32::NAN,
            3 => bad.config.skin_width = 0.,
            4 => bad.pose.rotation = [0.; 4],
            5 => bad.body.generation = bad.body.generation.wrapping_add(1),
            6 => bad.fixed_only = false,
            8 => bad.colliders[0].pose.rotation = rp::Rotation::from_array([0.; 4]),
            9 => bad.colliders[0].pose.rotation = rp::Rotation::from_array([0., 0., 0., 1.001]),
            10 => bad.colliders[0].pose.rotation = rp::Rotation::from_array([0., 0., 0., 1.00002]),
            _ => {
                bad.colliders[0].span = Some(PlanarCollisionSpan {
                    floor: 0,
                    elevation: 0.,
                    height: -1.,
                })
            }
        }
        let wire = crate::checkpoint_codec::encode(&bad).unwrap();
        let c: CharacterQuerySnapshot = crate::checkpoint_codec::decode(&wire).unwrap();
        assert!(
            !c.saved_controller_payload_valid(actor, &config, pose, true),
            "case{case}"
        );
        assert_eq!(crate::checkpoint_codec::encode(&c).unwrap(), wire);
    }
    world.remove_body(floor).unwrap();
    world.remove_body(actor).unwrap();
    assert!(snapshot.saved_controller_payload_valid(actor, &config, pose, true));
    assert!(fixed.saved_controller_payload_valid());
    assert!(!world.character_query_snapshot_matches(&snapshot));
    assert!(!world.fixed_query_snapshot_matches(&fixed));
    assert_eq!(
        crate::checkpoint_codec::encode(&snapshot).unwrap(),
        original
    );
}

#[test]
fn controller_admission_derived_snapshot_rotation_preserves_normal_stale_composition() {
    let (mut world, actor, floor) = fixture(Space::Spatial);
    let id = world.collider_ids(floor).unwrap().next().unwrap();
    let scaled = [0., 0., 0., 1.000004f32];
    world
        .set_pose(
            floor,
            Pose {
                rotation: scaled,
                ..Pose::default()
            },
        )
        .unwrap();
    world
        .update_collider(
            id,
            ColliderDesc {
                pose: Pose {
                    rotation: scaled,
                    ..Pose::default()
                },
                ..box_desc()
            },
        )
        .unwrap();
    let config = world.character_config(actor).unwrap().clone();
    let pose = world.body_state(actor).unwrap().pose;
    let saved = world.capture_character_query_snapshot(actor, true).unwrap();
    let c = saved
        .colliders
        .iter()
        .find(|c| c.id.into_raw_parts() == (id.slot, id.generation))
        .unwrap();
    let norm = (c
        .pose
        .rotation
        .to_array()
        .iter()
        .map(|v| f64::from(*v).powi(2))
        .sum::<f64>()
        - 1.)
        .abs();
    assert!(norm > 1e-5 && norm <= SAVED_DERIVED_ROTATION_ERROR);
    println!("normal derived quaternion norm error={norm}");
    world.set_pose(floor, Pose::default()).unwrap();
    world.step();
    assert!(PhysicsWorld3d::from_snapshot(&world.capture_snapshot().unwrap()).is_ok());
    assert!(!world.character_query_snapshot_matches(&saved));
    let before = crate::checkpoint_codec::encode(&saved).unwrap();
    assert!(saved.saved_controller_payload_valid(actor, &config, pose, true));
    assert_eq!(crate::checkpoint_codec::encode(&saved).unwrap(), before);
}
