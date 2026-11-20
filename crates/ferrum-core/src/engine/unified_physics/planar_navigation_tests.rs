use super::*;
use crate::components::{
    AabbCollider, CollisionLayer, CollisionMask, HeightSpan, PhysicsFloorId, RigidBody,
};
use crate::physics3d::{BodyKind, PlanarCollisionSpan, Shape};

fn scene() -> (Engine, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    let actor = e.world.spawn_entity();
    e.world.set_transform(actor, Transform2D { x: 0.5, y: 0.5 });
    e.world.set_aabb_collider(
        actor,
        AabbCollider::new(0.25, 0.25, false, CollisionLayer::Player),
    );
    e.world.set_rigid_body(actor, RigidBody::kinematic());
    assert!(e.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(e.configure_data_scene_navigation(12, 6, 1., 1., 0., 0., &[1; 72]));
    e.configure_physics_spec_planar(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    e.set_auto_rigid_body_step_enabled(true);
    (e, actor)
}
fn native_wall(e: &mut Engine, x: f32, y: f32, mut collider: ColliderDesc) -> Entity {
    collider.category = CollisionMask::WALL.bits;
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [x, y, 0.],
                ..Default::default()
            },
            ..Default::default()
        },
        collider,
        [0.; 3],
    )
    .unwrap()
}
fn box_shape() -> ColliderDesc {
    ColliderDesc::new(Shape::Box {
        half_extents: [0.25, 1., 2.],
    })
}
fn go(e: &mut Engine, x: f32, y: f32, speed: f32) {
    assert!(e.move_data_scene_actor_to(x, y, speed, 0., CollisionMask::WALL.bits, true));
}
fn tick(e: &mut Engine, count: usize) {
    for _ in 0..count {
        e.update(0.01);
        assert_eq!(e.unified_physics_error(), None);
    }
}

#[test]
fn planar_actor_native_only_curved_obstacle_blocks_at_actual_shape() {
    let (mut e, actor) = scene();
    let obstacle = native_wall(
        &mut e,
        4.5,
        1.05,
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
    );
    assert!(e.world.collider(obstacle).is_none());
    go(&mut e, 9.5, 0.5, 1000.);
    tick(&mut e, 1);
    let at = e.world.transform(actor).unwrap();
    assert_eq!(e.data_scene_move_status(), 3);
    assert!(
        at.x > 3.8 && at.x < 4.,
        "native curved geometry, not target AABB: {at:?}"
    );
    assert_eq!(
        e.unified_body_state(actor).unwrap().pose.position,
        [at.x, at.y, 0.]
    );
    assert!(e.physics_counters.kinematic_entity_hits > 0);
    // Retrying cannot tunnel through a touching obstacle; reverse travel can leave it.
    go(&mut e, 9.5, 0.5, 1000.);
    tick(&mut e, 1);
    assert!(e.world.transform(actor).unwrap().x < 4.);
    go(&mut e, 0.5, 0.5, 1000.);
    tick(&mut e, 1);
    assert_eq!(e.data_scene_move_status(), 2);
    assert_eq!(e.world.transform(actor).unwrap().x, 0.5);
}

#[test]
fn planar_actor_native_filters_sensors_masks_disabled_and_floor_ranges() {
    let (mut e, actor) = scene();
    e.world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(7), 0., 1.).unwrap());
    let mut sensor = box_shape();
    sensor.sensor = true;
    native_wall(&mut e, 2., 0.5, sensor);
    let mut masked = box_shape();
    masked.mask = CollisionMask::ENEMY.bits;
    native_wall(&mut e, 3., 0.5, masked);
    let disabled = native_wall(&mut e, 4., 0.5, box_shape());
    let wrong_floor = native_wall(&mut e, 5., 0.5, box_shape());
    let real = native_wall(&mut e, 7., 0.5, box_shape());
    let disabled_body = e.unified_body_id(disabled).unwrap();
    let wrong_body = e.unified_body_id(wrong_floor).unwrap();
    let real_body = e.unified_body_id(real).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    let options = crate::physics3d::BodyOptions {
        enabled: false,
        ..Default::default()
    };
    runtime
        .physics
        .set_body_options(disabled_body, &options)
        .unwrap();
    runtime
        .physics
        .set_planar_collision_span(
            wrong_body,
            Some(PlanarCollisionSpan {
                floor: 8,
                elevation: 0.,
                height: 1.,
            }),
        )
        .unwrap();
    runtime
        .physics
        .set_planar_collision_span(
            real_body,
            Some(PlanarCollisionSpan {
                floor: 7,
                elevation: 0.,
                height: 1.,
            }),
        )
        .unwrap();
    go(&mut e, 10.5, 0.5, 1000.);
    tick(&mut e, 1);
    assert_eq!(e.data_scene_move_status(), 3);
    assert!((e.world.transform(actor).unwrap().x - 6.5).abs() < 0.002);
}

#[test]
fn planar_actor_native_route_exact_corners_clock_pause_and_velocity_handoff() {
    let (mut e, actor) = scene();
    assert!(e.set_data_scene_navigation_cost(2, 0, 0));
    go(&mut e, 9.25, 0.25, 200.);
    e.update(0.001);
    assert_eq!(e.world.transform(actor).unwrap().x, 0.5);
    assert!(e.pause_data_scene());
    e.update(0.2);
    assert_eq!(e.world.transform(actor).unwrap().x, 0.5);
    assert!(e.resume_data_scene());
    tick(&mut e, 10);
    assert_eq!(
        e.world.transform(actor).unwrap(),
        Transform2D { x: 9.25, y: 0.25 }
    );
    assert_eq!(e.data_scene_move_status(), 2);
    go(&mut e, 5.5, 0.5, 10.);
    e.world.set_velocity(actor, Velocity { vx: 5., vy: 0. });
    e.set_input(false, false, false, true, false, false, false, 0., 0.);
    tick(&mut e, 1);
    assert_eq!(e.data_scene_move_status(), 4);
    assert!((e.world.transform(actor).unwrap().x - 9.3).abs() < 1e-5);
}

#[test]
fn planar_actor_native_live_obstacle_edits_and_actor_teleport_replan() {
    let (mut e, actor) = scene();
    let wall = native_wall(&mut e, 4., 0.5, box_shape());
    go(&mut e, 9.5, 0.5, 1000.);
    tick(&mut e, 1);
    assert_eq!(e.data_scene_move_status(), 3);
    let body = e.unified_body_id(wall).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_pose(
            body,
            Pose {
                position: [4., 4., 0.],
                ..Default::default()
            },
        )
        .unwrap();
    e.world.set_transform(actor, Transform2D { x: 1.5, y: 1.5 });
    go(&mut e, 9.5, 0.5, 1000.);
    tick(&mut e, 2);
    assert_eq!(e.data_scene_move_status(), 2);
    assert_eq!(
        e.world.transform(actor).unwrap(),
        Transform2D { x: 9.5, y: 0.5 }
    );
}

#[test]
fn planar_actor_native_tile_blocks_without_legacy_aabb_resolution() {
    let (mut e, actor) = scene();
    e.tilemap.set_layer(0, 1, 1, 1., 1., 4., 0., true, vec![1]);
    go(&mut e, 9.5, 0.5, 1000.);
    tick(&mut e, 1);
    assert_eq!(e.data_scene_move_status(), 3);
    assert!((e.world.transform(actor).unwrap().x - 3.75).abs() < 0.002);
    assert!(e.physics_counters.kinematic_tile_hits > 0);
    assert_eq!(
        e.physics_counters.tile_candidate_checks, 0,
        "legacy tile resolver must not run"
    );
    assert!(e.tilemap.set_tile(0, 0, 0, 0));
    go(&mut e, 9.5, 0.5, 1000.);
    tick(&mut e, 1);
    assert_eq!(e.data_scene_move_status(), 2);
}

#[test]
fn planar_actor_native_checkpoint_replays_pending_route_and_clock() {
    let (mut e, actor) = scene();
    go(&mut e, 9.5, 0.5, 4.);
    e.update(0.015);
    let checkpoint = e.capture_runtime_checkpoint().unwrap();
    e.update(0.1);
    let expected = (
        e.world.transform(actor).unwrap(),
        e.data_scene_move_status(),
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap(),
    );
    assert!(e.restore_runtime_checkpoint(&checkpoint));
    e.update(0.1);
    assert_eq!(e.world.transform(actor).unwrap(), expected.0);
    assert_eq!(e.data_scene_move_status(), expected.1);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap()
            .encoded_bytes(),
        expected.2.encoded_bytes()
    );
}

#[test]
fn planar_actor_native_query_preparation_preserves_other_body_pending_impulse_and_identity() {
    let (mut e, actor) = scene();
    let dynamic = e.world.spawn_entity();
    e.world
        .set_transform(dynamic, Transform2D { x: 10., y: 4. });
    e.world.set_rigid_body(dynamic, RigidBody::dynamic(1.));
    e.world.apply_impulse(dynamic, Velocity { vx: 3., vy: 0. });
    let identity = e.unified_body_id(actor).unwrap();
    let clock = e.fixed_timestep;
    let mut context = PlanarNavigationContext {
        runtime: e.unified_physics.as_mut().unwrap(),
        config: e.auto_rigid_body_step_config,
        tiles: &e.tilemap,
        spatial: &e.spatial_scene,
    };
    assert!(context.prepare(&mut e.world, actor));
    assert!(context
        .move_body(
            &mut e.world,
            actor,
            Velocity { vx: 0.1, vy: 0. },
            CollisionMask::WALL,
            &mut e.physics_counters
        )
        .is_some());
    assert_eq!(e.world.rigid_body(dynamic).unwrap().impulse.vx, 3.);
    assert_eq!(e.unified_body_id(actor).unwrap(), identity);
    assert_eq!(e.fixed_timestep, clock);
}

#[test]
fn planar_actor_native_invalid_batch_blocks_without_legacy_fallback() {
    let (mut e, actor) = scene();
    let invalid = e.world.spawn_entity();
    e.world
        .set_transform(invalid, Transform2D { x: 10., y: 4. });
    let mut body = RigidBody::dynamic(1.);
    body.force.vx = f32::NAN;
    e.world.set_rigid_body(invalid, body);
    go(&mut e, 9.5, 0.5, 1000.);
    e.update(0.01);
    assert_eq!(e.data_scene_move_status(), 3);
    assert_eq!(
        e.world.transform(actor).unwrap(),
        Transform2D { x: 0.5, y: 0.5 }
    );
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::Physics(PhysicsError::InvalidBody))
    );
    assert_eq!(e.physics_counters.kinematic_moves, 0);
}

#[test]
fn planar_actor_native_uses_live_source_rotation_and_collider_offset() {
    let (mut e, actor) = scene();
    let mut collider = AabbCollider::new(0.4, 0.1, false, CollisionLayer::Player);
    collider.offset_x = 0.4;
    e.world.set_aabb_collider(actor, collider);
    let angle = std::f32::consts::FRAC_PI_2 + 4. * std::f32::consts::PI;
    e.world
        .set_rotation(actor, crate::components::Rotation2D { radians: angle });
    native_wall(&mut e, 4.5, 0.9, box_shape());
    go(&mut e, 9.5, 0.5, 1000.);
    tick(&mut e, 1);
    assert_eq!(e.data_scene_move_status(), 3);
    let at = e.world.transform(actor).unwrap();
    assert!(
        (at.x - 4.15).abs() < 0.002,
        "source must use native rotation/offset: {at:?}"
    );
    assert_eq!(
        e.unified_body_state(actor).unwrap().pose.position,
        [at.x, at.y, 0.]
    );
    assert!((e.world.rotations[actor.id as usize].unwrap().radians - angle).abs() < 1e-5);
}
