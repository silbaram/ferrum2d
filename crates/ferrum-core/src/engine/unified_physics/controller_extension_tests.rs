use super::*;
use crate::components::{
    AabbCollider, CircleCollider, CollisionLayer, CollisionMask, CompoundCollider,
    CompoundColliderShape, RigidBody,
};
use crate::physics3d::{BodyKind, Shape};
use crate::tilemap::Hd2dTileKind;

fn scene() -> (Engine, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 5., y: 5. });
    e.world
        .set_circle_collider(a, CircleCollider::new(0.25, false, CollisionLayer::Player));
    e.world.set_rigid_body(a, RigidBody::kinematic());
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId::DEFAULT, 0., 1.).unwrap());
    e.configure_physics_spec_planar(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    e.set_auto_rigid_body_step_enabled(true);
    (e, a)
}
fn configure(e: &mut Engine, a: Entity, step: f32, drop: f32, ledge: bool) -> bool {
    e.configure_data_scene_kinematic_controller(
        a.id,
        a.generation,
        false,
        CollisionMask::ALL.bits,
        4,
        step,
        drop,
        ledge,
    )
}
fn reset(e: &mut Engine, a: Entity) -> bool {
    e.configure_data_scene_kinematic_controller(
        a.id,
        a.generation,
        true,
        CollisionMask::ALL.bits,
        4,
        0.,
        0.,
        false,
    )
}
fn floor(e: &mut Engine, id: u32, floor: u32, elevation: f32, kind: Hd2dTileKind) {
    // Definition setters return whether they changed state; repeated valid data is a no-op.
    e.tilemap
        .set_tile_height_span_definition(id, floor, elevation, 0.);
    e.tilemap
        .set_tile_hd2d_definition(id, kind.code(), false, false, false, 0., false, 0, 0., 0.);
}
fn steps(e: &mut Engine, a: Entity, from: f32, to: f32, kind: Hd2dTileKind) {
    e.world.set_transform(a, Transform2D { x: 5., y: 5. });
    e.world.set_height_span(
        a,
        HeightSpan::new(PhysicsFloorId::DEFAULT, from, 1.).unwrap(),
    );
    e.tilemap
        .set_layer(0, 2, 1, 10., 10., 0., 0., true, vec![1, 2]);
    floor(e, 1, 0, from, Hd2dTileKind::Flat);
    floor(e, 2, 0, to, kind);
    e.world.set_velocity(a, Velocity { vx: 1000., vy: 0. });
}
fn tick(e: &mut Engine) {
    e.update(0.01);
    assert_eq!(e.unified_physics_error(), None);
}
fn consistent(e: &Engine, a: Entity, x: f32, elevation: f32) {
    let p = e.world.transform(a).unwrap();
    assert!((p.x - x).abs() < 0.002, "{p:?}");
    assert_eq!(
        e.unified_body_state(a).unwrap().pose.position,
        [p.x, p.y, 0.]
    );
    assert!((e.world.height_span(a).unwrap().elevation - elevation).abs() < 0.002);
    let id = e.unified_body_id(a).unwrap();
    let span = e
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .planar_collision_span(id)
        .unwrap()
        .unwrap();
    assert_eq!(span.elevation, e.world.height_span(a).unwrap().elevation);
}

#[test]
fn controller_extension_circle_step_limits_and_reset_to_defaults() {
    let (mut e, a) = scene();
    steps(&mut e, a, 0., 3., Hd2dTileKind::Flat);
    tick(&mut e);
    consistent(&e, a, 5., 0.);
    assert!(configure(&mut e, a, 4., 4., false));
    tick(&mut e);
    consistent(&e, a, 15., 3.);
    steps(&mut e, a, 0., 3., Hd2dTileKind::Flat);
    assert!(reset(&mut e, a));
    tick(&mut e);
    consistent(&e, a, 5., 0.);
    assert_eq!(e.world.velocity(a).unwrap(), Velocity { vx: 1000., vy: 0. });
}

#[test]
fn controller_extension_drop_and_ledge_are_independent_per_body_settings() {
    for (drop, ledge, allowed) in [(2., true, false), (8., false, false), (8., true, true)] {
        let (mut e, a) = scene();
        steps(&mut e, a, 8., 0., Hd2dTileKind::Ledge);
        assert!(configure(&mut e, a, 0., drop, ledge));
        tick(&mut e);
        consistent(
            &e,
            a,
            if allowed { 15. } else { 5. },
            if allowed { 0. } else { 8. },
        );
    }
}

#[test]
fn controller_extension_invalid_settings_preserve_previous_and_do_not_tick_or_consume_impulse() {
    let (mut e, a) = scene();
    steps(&mut e, a, 0., 3., Hd2dTileKind::Flat);
    assert!(configure(&mut e, a, 4., 4., false));
    let clock = e.fixed_timestep;
    let before = e
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .capture_snapshot()
        .unwrap();
    for (iterations, step, drop) in [
        (0, 1., 1.),
        (9, 1., 1.),
        (4, f32::NAN, 1.),
        (4, -1., 1.),
        (4, 1., 65537.),
    ] {
        assert!(!e.configure_data_scene_kinematic_controller(
            a.id,
            a.generation,
            false,
            7,
            iterations,
            step,
            drop,
            false
        ));
    }
    assert_eq!(e.fixed_timestep, clock);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap()
            .encoded_bytes(),
        before.encoded_bytes()
    );
    tick(&mut e);
    consistent(&e, a, 15., 3.);
}

#[test]
fn controller_extension_checkpoint_restores_settings_and_exact_native_continuation() {
    let (mut e, a) = scene();
    steps(&mut e, a, 0., 3., Hd2dTileKind::Flat);
    assert!(configure(&mut e, a, 4., 4., false));
    let cp = e.capture_runtime_checkpoint().unwrap();
    tick(&mut e);
    consistent(&e, a, 15., 3.);
    let expected = e
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .capture_snapshot()
        .unwrap()
        .encoded_bytes()
        .to_vec();
    assert!(reset(&mut e, a));
    assert!(e.restore_runtime_checkpoint(&cp));
    tick(&mut e);
    consistent(&e, a, 15., 3.);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap()
            .encoded_bytes(),
        expected
    );
}

#[test]
fn controller_extension_compound_second_solid_controls_wall_and_changed_height_destination() {
    let (mut e, a) = scene();
    e.world.clear_collider(a);
    for fixture in [
        CompoundCollider::new(CompoundColliderShape::Circle(CircleCollider::new(
            0.25,
            false,
            CollisionLayer::Player,
        ))),
        CompoundCollider::new(CompoundColliderShape::Aabb(
            AabbCollider::new(0.25, 0.25, false, CollisionLayer::Player).with_offset(0., 2.),
        )),
    ] {
        assert!(e.world.add_compound_collider(a, fixture).is_some());
    }
    steps(&mut e, a, 0., 3., Hd2dTileKind::Flat);
    let target = e.world.spawn_entity();
    e.world.set_transform(target, Transform2D { x: 15., y: 7. });
    e.world.set_rigid_body(target, RigidBody::static_body());
    e.world.set_aabb_collider(
        target,
        AabbCollider::new(0.4, 0.4, false, CollisionLayer::Wall),
    );
    e.world.set_height_span(
        target,
        HeightSpan::new(PhysicsFloorId::DEFAULT, 3., 1.).unwrap(),
    );
    assert!(configure(&mut e, a, 4., 4., false));
    tick(&mut e);
    consistent(&e, a, 5., 0.);
    e.world.despawn(target);
    tick(&mut e);
    consistent(&e, a, 15., 3.);
}

#[test]
fn controller_extension_source_sensor_and_disabled_parts_do_not_block_movement() {
    let (mut e, a) = scene();
    e.world.set_transform(a, Transform2D { x: 0., y: 0. });
    e.world.clear_collider(a);
    for fixture in [
        CompoundCollider::new(CompoundColliderShape::Circle(CircleCollider::new(
            0.25,
            false,
            CollisionLayer::Player,
        ))),
        CompoundCollider::new(CompoundColliderShape::Circle(
            CircleCollider::new(3., true, CollisionLayer::Player).with_offset(5., 0.),
        )),
        CompoundCollider::new(CompoundColliderShape::Aabb(
            AabbCollider::new(4., 4., false, CollisionLayer::Player)
                .with_offset(5., 0.)
                .with_enabled(false),
        )),
    ] {
        assert!(e.world.add_compound_collider(a, fixture).is_some());
    }
    let wall = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [4., 0., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc {
                category: CollisionMask::WALL.bits,
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [0.25, 4., 2.],
                })
            },
            [0.; 3],
        )
        .unwrap();
    let id = e.unified_body_id(wall).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_planar_collision_span(
            id,
            Some(crate::physics3d::PlanarCollisionSpan {
                floor: 0,
                elevation: 0.,
                height: 1.,
            }),
        )
        .unwrap();
    assert!(configure(&mut e, a, 0., 0., false));
    e.world.set_velocity(a, Velocity { vx: 100., vy: 0. });
    tick(&mut e);
    consistent(&e, a, 1., 0.);
}

#[test]
fn controller_extension_wrong_owner_kind_space_and_generation_cannot_replace_settings() {
    let (mut e, a) = scene();
    assert!(configure(&mut e, a, 4., 4., false));
    assert!(!configure(
        &mut e,
        Entity {
            generation: a.generation + 1,
            ..a
        },
        8.,
        8.,
        true
    ));
    let n = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
            [0.; 3],
        )
        .unwrap();
    assert!(!configure(&mut e, n, 4., 4., false));
    assert!(!reset(&mut e, n));
    e.world.set_rigid_body(a, RigidBody::dynamic(1.));
    assert!(!configure(&mut e, a, 8., 8., true));
    assert!(reset(&mut e, a));
    let mut legacy = Engine::new();
    legacy.use_data_scene();
    assert!(!configure(&mut legacy, a, 4., 4., false));
}

#[test]
fn controller_extension_stale_generation_settings_are_retired() {
    let (mut e, a) = scene();
    assert!(configure(&mut e, a, 4., 4., false));
    e.world.despawn(a);
    let next = e.world.spawn_entity();
    e.world.set_transform(next, Transform2D { x: 5., y: 5. });
    e.world.set_circle_collider(
        next,
        CircleCollider::new(0.25, false, CollisionLayer::Player),
    );
    e.world.set_rigid_body(next, RigidBody::kinematic());
    steps(&mut e, next, 0., 3., Hd2dTileKind::Flat);
    tick(&mut e);
    consistent(&e, next, 5., 0.);
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .automatic_planar
        .settings
        .is_empty());
    assert!(!reset(&mut e, a));
}

#[test]
fn controller_extension_cold_settings_keep_clock_pending_impulse_and_unwrapped_angle() {
    let (mut e, a) = scene();
    let angle = 4. * std::f32::consts::PI;
    e.world.set_rotation(a, Rotation2D { radians: angle });
    let d = e.world.spawn_entity();
    e.world.set_transform(d, Transform2D { x: 100., y: 100. });
    e.world.set_rigid_body(d, RigidBody::dynamic(1.));
    e.world.apply_impulse(d, Velocity { vx: 3., vy: 0. });
    let clock = e.fixed_timestep;
    let id = e.unified_body_id(a).unwrap();
    assert!(configure(&mut e, a, 4., 4., false));
    assert_eq!(e.fixed_timestep, clock);
    assert_eq!(e.unified_body_id(a).unwrap(), id);
    assert_eq!(e.world.rigid_body(d).unwrap().impulse.vx, 3.);
    assert_eq!(e.unified_body_state(d).unwrap().linear_velocity, [0.; 3]);
    assert!((e.world.rotations[a.id as usize].unwrap().radians - angle).abs() < 0.001);
    tick(&mut e);
    assert!((e.world.velocity(d).unwrap().vx - 3.).abs() < 0.001);
    assert_eq!(e.world.rigid_body(d).unwrap().impulse, Velocity::default());
    tick(&mut e);
    assert!((e.world.velocity(d).unwrap().vx - 3.).abs() < 0.001);
}

#[test]
fn controller_extension_circle_ramp_and_floor_transition_use_authored_limits() {
    let (mut e, a) = scene();
    e.world.set_transform(a, Transform2D { x: 0., y: 5. });
    e.tilemap
        .set_layer(0, 1, 1, 10., 10., 0., 0., true, vec![1]);
    floor(&mut e, 1, 0, 0., Hd2dTileKind::Flat);
    assert!(e.tilemap.set_tile_hd2d_definition(
        1,
        Hd2dTileKind::Ramp.code(),
        false,
        false,
        false,
        0.,
        true,
        0,
        0.,
        8.
    ));
    assert!(configure(&mut e, a, 8., 8., false));
    e.world.set_velocity(a, Velocity { vx: 500., vy: 0. });
    tick(&mut e);
    consistent(&e, a, 5., 4.);
    steps(&mut e, a, 0., 3., Hd2dTileKind::Flat);
    floor(&mut e, 2, 1, 3., Hd2dTileKind::Stair);
    tick(&mut e);
    consistent(&e, a, 15., 3.);
    assert_eq!(e.world.height_span(a).unwrap().floor, PhysicsFloorId(1));
}

#[test]
fn controller_extension_manual_hd2d_contract_stays_single_aabb() {
    let (mut e, a) = scene();
    assert!(!e.move_hd2d_kinematic_body_with_tilemap(
        a.id,
        a.generation,
        1.,
        0.,
        u32::MAX,
        4,
        4.,
        4.,
        false
    ));
    e.world.clear_collider(a);
    for x in [0., 1.] {
        assert!(e
            .world
            .add_compound_collider(
                a,
                CompoundCollider::new(CompoundColliderShape::Aabb(
                    AabbCollider::new(0.25, 0.25, false, CollisionLayer::Player).with_offset(x, 0.)
                ))
            )
            .is_some());
    }
    let before = e.world.transform(a);
    assert!(!e.move_hd2d_kinematic_body_with_tilemap(
        a.id,
        a.generation,
        1.,
        0.,
        u32::MAX,
        4,
        4.,
        4.,
        false
    ));
    assert_eq!(e.world.transform(a), before);
    e.take_unified_physics_error();
    assert!(configure(&mut e, a, 4., 4., false));
}

#[test]
fn controller_extension_settings_are_isolated_between_live_actors() {
    let (mut e, a) = scene();
    let b = e.world.spawn_entity();
    e.world.set_transform(b, Transform2D { x: 5., y: 15. });
    e.world
        .set_circle_collider(b, CircleCollider::new(0.25, false, CollisionLayer::Player));
    e.world.set_rigid_body(b, RigidBody::kinematic());
    e.world
        .set_height_span(b, HeightSpan::new(PhysicsFloorId::DEFAULT, 0., 1.).unwrap());
    e.tilemap
        .set_layer(0, 2, 2, 10., 10., 0., 0., true, vec![1, 2, 1, 2]);
    floor(&mut e, 1, 0, 0., Hd2dTileKind::Flat);
    floor(&mut e, 2, 0, 3., Hd2dTileKind::Flat);
    e.world.set_velocity(a, Velocity { vx: 1000., vy: 0. });
    e.world.set_velocity(b, Velocity { vx: 1000., vy: 0. });
    assert!(configure(&mut e, a, 4., 4., false));
    assert!(configure(&mut e, b, 2., 2., false));
    tick(&mut e);
    consistent(&e, a, 15., 3.);
    consistent(&e, b, 5., 0.);
    assert!(reset(&mut e, a));
    assert!(configure(&mut e, b, 4., 4., false));
    e.world.set_transform(a, Transform2D { x: 5., y: 5. });
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId::DEFAULT, 0., 1.).unwrap());
    tick(&mut e);
    consistent(&e, a, 5., 0.);
    consistent(&e, b, 15., 3.);
}

#[test]
fn controller_extension_custom_mask_and_iteration_cap_affect_native_motion() {
    for (iterations, mask, expected_x, expected_y) in [
        (1, CollisionMask::WALL.bits, 6.5, 6.),
        (4, CollisionMask::WALL.bits, 6.5, 7.),
        (4, 0, 8., 7.),
    ] {
        let (mut e, a) = scene();
        let w = e.world.spawn_entity();
        e.world.set_transform(w, Transform2D { x: 7., y: 7. });
        e.world
            .set_aabb_collider(w, AabbCollider::new(0.25, 5., false, CollisionLayer::Wall));
        e.world.set_rigid_body(w, RigidBody::static_body());
        e.world
            .set_height_span(w, HeightSpan::new(PhysicsFloorId::DEFAULT, 0., 1.).unwrap());
        assert!(e.configure_data_scene_kinematic_controller(
            a.id,
            a.generation,
            false,
            mask,
            iterations,
            0.,
            0.,
            false
        ));
        e.world.set_velocity(a, Velocity { vx: 300., vy: 200. });
        tick(&mut e);
        consistent(&e, a, expected_x, 0.);
        assert!((e.world.transform(a).unwrap().y - expected_y).abs() < 0.002);
    }
}

#[test]
fn controller_extension_removed_components_retire_settings_before_entity_reuse() {
    let (mut e, a) = scene();
    assert!(configure(&mut e, a, 4., 4., false));
    e.world.clear_rigid_body(a);
    e.world.clear_collider(a);
    tick(&mut e);
    assert!(e.unified_body_state(a).is_err());
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .automatic_planar
        .settings
        .is_empty());
    e.world.despawn(a);
    let next = e.world.spawn_entity();
    e.world.set_circle_collider(
        next,
        CircleCollider::new(0.25, false, CollisionLayer::Player),
    );
    e.world.set_rigid_body(next, RigidBody::kinematic());
    steps(&mut e, next, 0., 3., Hd2dTileKind::Flat);
    tick(&mut e);
    consistent(&e, next, 5., 0.);
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .automatic_planar
        .settings
        .is_empty());
}

#[test]
fn controller_extension_removed_native_body_does_not_keep_component_settings() {
    let (mut e, a) = scene();
    assert!(configure(&mut e, a, 4., 4., false));
    e.remove_unified_body(a).unwrap();
    assert!(!e.world.is_current_entity(a));
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .automatic_planar
        .settings
        .is_empty());
    let cp = e.capture_runtime_checkpoint().unwrap();
    assert!(e.restore_runtime_checkpoint(&cp));
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .automatic_planar
        .settings
        .is_empty());
}
