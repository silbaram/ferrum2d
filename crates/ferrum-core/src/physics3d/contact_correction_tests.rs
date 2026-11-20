use super::*;
use rapier3d::prelude::FrictionModel;

fn response() -> ContactCorrection {
    ContactCorrection {
        velocity_rate: 0.0,
        max_velocity: 10.0,
        position_rate: 0.0,
        position_slop: 0.0,
        velocity_slop: 0.0,
        split_impulse: false,
    }
}

fn setup(
    space: Space,
    model: FrictionModel,
    correction: ContactCorrection,
) -> (PhysicsWorld3d, BodyId, BodyId, ColliderId, ColliderDesc) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    w.backend.integration_parameters.friction_model = model;
    let floor = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0.0, -0.5, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [5.0, 0.5, 0.5],
            }),
        )
        .unwrap();
    let mut collider = ColliderDesc::new(Shape::Sphere { radius: 0.5 });
    collider.contact_correction = Some(correction);
    let body = w
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [0.0, 0.3, 0.0],
                    ..Pose::default()
                },
                can_sleep: false,
                ..BodyDesc::default()
            },
            collider.clone(),
        )
        .unwrap();
    let id = w.collider_ids(body).unwrap().next().unwrap();
    (w, floor, body, id, collider)
}

#[test]
fn contact_correction_separates_position_velocity_cap_and_split_in_both_spaces_and_models() {
    for space in [Space::Spatial, Space::PlanarXy] {
        for model in [FrictionModel::Simplified, FrictionModel::Coulomb] {
            for case in 0..5 {
                let mut c = response();
                match case {
                    1 => c.position_rate = 24.0,
                    2 | 3 => {
                        c.velocity_rate = 24.0;
                        c.max_velocity = 0.25;
                        c.split_impulse = case == 3;
                    }
                    4 => {
                        c.position_rate = 24.0;
                        c.position_slop = 0.25;
                    }
                    _ => {}
                }
                let (mut w, _, b, _, _) = setup(space, model, c);
                w.step();
                let s = w.body_state(b).unwrap();
                if case == 0 || case == 4 {
                    assert!((s.pose.position[1] - 0.3).abs() < 1e-5, "{case} {s:?}");
                } else {
                    assert!(s.pose.position[1] > 0.3005, "{case} {s:?}");
                }
                if case == 2 {
                    assert!((s.linear_velocity[1] - 0.25).abs() < 0.005, "{s:?}");
                } else {
                    assert!(s.linear_velocity[1].abs() < 0.001, "{case} {s:?}");
                }
            }
        }
    }
}

#[test]
fn contact_correction_zero_gain_still_blocks_approach_and_does_not_change_restitution() {
    for model in [FrictionModel::Simplified, FrictionModel::Coulomb] {
        let (mut w, _, b, id, mut collider) = setup(Space::PlanarXy, model, response());
        w.set_velocity(b, [0.0, -3.0, 0.0], [0.0; 3]).unwrap();
        w.step();
        assert!(w.body_state(b).unwrap().linear_velocity[1].abs() < 0.001);
        collider.restitution = 0.8;
        w.update_collider(id, collider).unwrap();
        w.set_pose(
            b,
            Pose {
                position: [0.0, 2.0, 0.0],
                ..Pose::default()
            },
        )
        .unwrap();
        w.set_velocity(b, [0.0, -3.0, 0.0], [0.0; 3]).unwrap();
        let mut peak = 0.0_f32;
        for _ in 0..60 {
            w.step();
            peak = peak.max(w.body_state(b).unwrap().linear_velocity[1]);
        }
        assert!((peak - 2.4).abs() < 0.03, "{peak}");
    }
}

#[test]
fn contact_correction_live_changes_pair_minimum_and_removed_generations_are_respected() {
    let mut c = response();
    c.position_rate = 24.0;
    let (mut w, floor, b, id, mut collider) = setup(Space::PlanarXy, FrictionModel::Simplified, c);
    let floor_id = w.collider_ids(floor).unwrap().next().unwrap();
    let mut floor_desc = ColliderDesc::new(Shape::Box {
        half_extents: [5.0, 0.5, 0.5],
    });
    floor_desc.contact_correction = Some(response());
    w.update_collider(floor_id, floor_desc.clone()).unwrap();
    w.step();
    assert!((w.body_state(b).unwrap().pose.position[1] - 0.3).abs() < 1e-5);
    // A live fixture edit must invalidate cached native manifold response.
    floor_desc.contact_correction = Some(c);
    w.update_collider(floor_id, floor_desc).unwrap();
    w.step();
    assert!(w.body_state(b).unwrap().pose.position[1] > 0.31);
    collider.contact_correction = Some(ContactCorrection {
        position_rate: f32::NAN,
        ..c
    });
    let before = w.body_state(b).unwrap();
    assert_eq!(
        w.update_collider(id, collider),
        Err(PhysicsError::InvalidCollider)
    );
    assert_eq!(w.body_state(b).unwrap(), before);
    w.remove_body(b).unwrap();
    assert!(!w.contact_policies.corrections.contains_key(&id));
    w.remove_collider(floor_id).unwrap();
    assert!(w.contact_policies.corrections.is_empty());
}

#[test]
fn contact_correction_can_be_cleared_live_and_velocity_slop_is_independent() {
    let mut c = response();
    c.velocity_rate = 24.0;
    c.velocity_slop = 0.25;
    let (mut w, _, b, id, mut collider) = setup(Space::PlanarXy, FrictionModel::Simplified, c);
    w.step();
    assert!((w.body_state(b).unwrap().pose.position[1] - 0.3).abs() < 1e-5);
    c.position_rate = 24.0;
    collider.contact_correction = Some(c);
    w.update_collider(id, collider.clone()).unwrap();
    w.step();
    let state = w.body_state(b).unwrap();
    assert!(state.pose.position[1] > 0.31);
    assert!(state.linear_velocity[1].abs() < 1e-5);
    collider.contact_correction = None;
    w.update_collider(id, collider).unwrap();
    assert!(!w.contact_policies.corrections.contains_key(&id));
    for _ in 0..120 {
        w.step();
    }
    let state = w.body_state(b).unwrap();
    assert!((state.pose.position[1] - 0.5).abs() < 0.001, "{state:?}");
    assert!(state.linear_velocity[1].abs() < 0.001);
}
