use super::*;
use crate::components::{CircleCollider, CollisionLayer, RigidBody, Sprite, Transform2D};
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Pose, Shape, Space, WorldConfig};
fn engine(space: Space) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.camera.x = 0.0;
    e.camera.y = 0.0;
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        step_seconds: 0.01,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn visual(e: &mut Engine) -> Entity {
    let v = e.world.spawn_entity();
    e.world.set_transform(v, Transform2D { x: 17.0, y: 23.0 });
    assert!(e.world.set_sprite_for_test(
        v,
        Sprite {
            texture_id: 11,
            width: 2.0,
            height: 3.0,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
            rotation_radians: 0.0,
            render_layer: 10,
            origin_x: 0.5,
            origin_y: 0.5,
            sort_order: 0.0,
            depth_sort: false,
            project_ground: false,
        }
    ));
    v
}
fn ball() -> ColliderDesc {
    ColliderDesc::new(Shape::Sphere { radius: 0.5 })
}
#[test]
fn existing_visual_identity_follows_native_planar_and_xyz_motion_and_survives_unbinding() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space);
        let v = visual(&mut e);
        let texture = e.world.sprite_at_index(v.id as usize).unwrap().texture_id;
        let spatial = space == Space::Spatial;
        let desc = BodyDesc {
            pose: Pose {
                position: if spatial {
                    [2.0, 3.0, 4.0]
                } else {
                    [2.0, 3.0, 0.0]
                },
                ..Pose::default()
            },
            linear_velocity: if spatial {
                [1.0, 2.0, 3.0]
            } else {
                [1.0, 2.0, 0.0]
            },
            ..BodyDesc::default()
        };
        e.bind_unified_body(
            v,
            desc,
            ball(),
            if spatial { [0.0, -1.0, 0.0] } else { [0.0; 3] },
        )
        .unwrap();
        assert_eq!(e.entity_count(), 1);
        assert_eq!(
            e.world.sprite_at_index(v.id as usize).unwrap().texture_id,
            texture
        );
        e.update(0.01);
        let s = e.unified_body_state(v).unwrap();
        assert!((s.pose.position[0] - 2.01).abs() < 1e-4);
        let p = e.world.transform(v).unwrap();
        assert!((p.x - s.pose.position[0]).abs() < 1e-4);
        assert!(
            (p.y - if spatial {
                -s.pose.position[2]
            } else {
                s.pose.position[1]
            })
            .abs()
                < 1e-4
        );
        if spatial {
            assert!(
                (e.world.height_span(v).unwrap().elevation - (s.pose.position[1] - 1.0)).abs()
                    < 1e-4
            );
        }
        e.update(0.0);
        assert!(e
            .frame_buffers
            .render_commands
            .iter()
            .any(|c| c.texture_id == 11.0));
        e.unbind_unified_body(v).unwrap();
        let held = e.world.transform(v).unwrap();
        e.update(0.05);
        assert_eq!(e.world.transform(v), Some(held));
        assert!(e.world.is_current_entity(v));
        assert_eq!(e.entity_count(), 1);
        assert!(e.unified_body_state(v).is_err());
        assert_eq!(
            e.world.sprite_at_index(v.id as usize).unwrap().texture_id,
            11
        );
        e.bind_unified_body(v, BodyDesc::default(), ball(), [0.0; 3])
            .unwrap();
        assert_eq!(e.entity_count(), 1);
    }
}
#[test]
fn invalid_binding_never_replaces_visual_or_steals_physics_ownership() {
    let mut e = engine(Space::PlanarXy);
    let v = visual(&mut e);
    let original = e.world.transform(v);
    assert!(e
        .bind_unified_body(
            v,
            BodyDesc::default(),
            ColliderDesc::new(Shape::Sphere { radius: -1.0 }),
            [0.0; 3]
        )
        .is_err());
    assert_eq!(e.world.transform(v), original);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
    assert!(e
        .bind_unified_body(v, BodyDesc::default(), ball(), [0.0, 0.0, 1.0])
        .is_err());
    assert_eq!(e.world.transform(v), original);
    e.world
        .set_circle_collider(v, CircleCollider::new(1.0, false, CollisionLayer::Wall));
    assert!(e
        .bind_unified_body(v, BodyDesc::default(), ball(), [0.0; 3])
        .is_err());
    let other = visual(&mut e);
    e.world.set_rigid_body(other, RigidBody::dynamic(1.0));
    assert!(e
        .bind_unified_body(other, BodyDesc::default(), ball(), [0.0; 3])
        .is_err());
    let bound = visual(&mut e);
    e.bind_unified_body(bound, BodyDesc::default(), ball(), [0.0; 3])
        .unwrap();
    let before = e.unified_body_state(bound).unwrap();
    assert!(e
        .bind_unified_body(bound, BodyDesc::default(), ball(), [0.0; 3])
        .is_err());
    assert_eq!(e.unified_body_state(bound).unwrap(), before);
    e.world.despawn(v);
    let new = visual(&mut e);
    assert_ne!(v, new);
    assert!(e
        .bind_unified_body(v, BodyDesc::default(), ball(), [0.0; 3])
        .is_err());
}
#[test]
fn detaching_keeps_entity_but_retires_colliders_joints_and_their_original_event_ids() {
    let mut e = engine(Space::Spatial);
    e.set_unified_physics_collision_events_enabled(true)
        .unwrap();
    e.set_unified_physics_joint_events_enabled(true).unwrap();
    let v = visual(&mut e);
    e.bind_unified_body(v, BodyDesc::default(), ball(), [0.0; 3])
        .unwrap();
    let anchor = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                ..ball()
            },
            [0.0; 3],
        )
        .unwrap();
    let fixture = e
        .query_unified_physics_colliders(v.id, v.generation)
        .unwrap();
    let mut values = vec![0.0; 21];
    values[6] = 1.0;
    values[13] = 1.0;
    values[20] = 0.0;
    let joint = e
        .create_unified_physics_joint(
            &[v.id, v.generation, anchor.id, anchor.generation],
            &[4, 3],
            &values,
        )
        .unwrap();
    e.update(0.01);
    e.drain_unified_physics_collision_events().unwrap();
    assert_eq!(e.unified_physics_collision_count(), 1);
    e.unbind_unified_physics_body(v.id, v.generation).unwrap();
    assert!(e.world.is_current_entity(v));
    e.drain_unified_physics_joint_events().unwrap();
    let j = e.unified_physics_joints.events[0];
    assert_eq!(j.code, 4);
    assert_eq!(j.joint, [joint[0], joint[1]]);
    assert_eq!(j.entity_a, [v.id, v.generation]);
    e.drain_unified_physics_collision_events().unwrap();
    let c = &e.unified_physics_collisions.rows[0];
    assert_eq!(c.phase, 1);
    assert_eq!(c.first.collider, [fixture[0], fixture[1]]);
    assert!(e.unbind_unified_body(v).is_err());
    assert!(e.world.sprite_at_index(v.id as usize).is_some());
}
