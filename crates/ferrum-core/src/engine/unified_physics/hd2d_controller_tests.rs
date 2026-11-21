use super::*;
use crate::components::{AabbCollider, CollisionLayer, CollisionMask, PhysicsFloorId, RigidBody};
use crate::physics3d::{BodyKind, PlanarCollisionSpan, Shape};
use crate::tilemap::{Hd2dRampAxis, Hd2dTileKind};

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
    e.configure_physics_spec_planar(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    (e, actor)
}
fn move_by(
    e: &mut Engine,
    actor: Entity,
    x: f32,
    y: f32,
    step: f32,
    drop: f32,
    ledge: bool,
) -> bool {
    e.move_hd2d_kinematic_body_with_tilemap(
        actor.id,
        actor.generation,
        x,
        y,
        CollisionMask::WALL.bits,
        4,
        step,
        drop,
        ledge,
    )
}
fn wall(e: &mut Engine, x: f32, y: f32, half: [f32; 3]) -> Entity {
    let mut c = ColliderDesc::new(Shape::Box { half_extents: half });
    c.category = CollisionMask::WALL.bits;
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [x, y, 0.],
                ..Default::default()
            },
            ..Default::default()
        },
        c,
        [0.; 3],
    )
    .unwrap()
}
fn span(e: &mut Engine, actor: Entity, elevation: f32, height: f32) {
    e.world.set_height_span(
        actor,
        HeightSpan::new(PhysicsFloorId::DEFAULT, elevation, height).unwrap(),
    );
}
fn flat(e: &mut Engine, id: u32, floor: u32, elevation: f32, kind: Hd2dTileKind) {
    assert!(e
        .tilemap
        .set_tile_height_span_definition(id, floor, elevation, 0.));
    assert!(e.tilemap.set_tile_hd2d_definition(
        id,
        kind.code(),
        false,
        false,
        false,
        0.,
        false,
        0,
        0.,
        0.
    ));
}
fn steps(e: &mut Engine, actor: Entity, initial: f32, next: f32, kind: Hd2dTileKind) {
    e.world.set_transform(actor, Transform2D { x: 5., y: 5. });
    span(e, actor, initial, 1.);
    e.tilemap
        .set_layer(0, 2, 1, 10., 10., 0., 0., true, vec![1, 2]);
    flat(e, 1, 0, initial, Hd2dTileKind::Flat);
    flat(e, 2, 0, next, kind);
}
fn consistent(e: &Engine, actor: Entity) {
    let at = e.world.transform(actor).unwrap();
    assert_eq!(
        e.unified_body_state(actor).unwrap().pose.position,
        [at.x, at.y, 0.]
    );
    let id = e.unified_body_id(actor).unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .planar_collision_span(id)
            .unwrap(),
        e.world.height_span(actor).map(|s| PlanarCollisionSpan {
            floor: s.floor.0,
            elevation: s.elevation,
            height: s.height
        })
    );
}

#[test]
fn hd2d_native_slide_uses_native_only_wall_and_corner() {
    let (mut e, a) = scene();
    let w = wall(&mut e, 2., 2., [0.25, 4., 2.]);
    assert!(e.world.collider(w).is_none());
    assert!(move_by(&mut e, a, 3., 2., 0., 0., false));
    let at = e.world.transform(a).unwrap();
    assert!(
        (at.x - 1.5).abs() < 0.002 && (at.y - 2.5).abs() < 0.002,
        "{at:?}"
    );
    assert!(e.hd2d_kinematic_hit_count() > 0);
    assert_ne!(e.hd2d_kinematic_flags() & (1 << 6), 0);
    wall(&mut e, 1., 4., [4., 0.25, 2.]);
    assert!(move_by(&mut e, a, 3., 3., 0., 0., false));
    let at = e.world.transform(a).unwrap();
    assert!(
        (at.x - 1.5).abs() < 0.002 && (at.y - 3.5).abs() < 0.002,
        "{at:?}"
    );
    consistent(&e, a);
}

#[test]
fn hd2d_native_ramp_interpolates_elevation() {
    let (mut e, a) = scene();
    e.world.set_transform(a, Transform2D { x: 0., y: 5. });
    span(&mut e, a, 0., 1.);
    e.tilemap
        .set_layer(0, 1, 1, 10., 10., 0., 0., true, vec![1]);
    flat(&mut e, 1, 0, 0., Hd2dTileKind::Flat);
    assert!(e.tilemap.set_tile_hd2d_definition(
        1,
        Hd2dTileKind::Ramp.code(),
        false,
        false,
        false,
        0.,
        true,
        Hd2dRampAxis::X.code(),
        0.,
        8.
    ));
    assert!(move_by(&mut e, a, 5., 0., 8., 8., false));
    assert!((e.hd2d_kinematic_elevation_delta() - 4.).abs() < 0.001);
    assert_ne!(e.hd2d_kinematic_flags() & 1, 0);
    consistent(&e, a);
}

#[test]
fn hd2d_native_step_acceptance_and_rejection_keep_both_poses() {
    for (height, allowed) in [(3., true), (10., false)] {
        let (mut e, a) = scene();
        steps(&mut e, a, 0., height, Hd2dTileKind::Flat);
        assert!(move_by(&mut e, a, 10., 0., 4., 4., false));
        assert_eq!(
            e.world.transform(a).unwrap().x,
            if allowed { 15. } else { 5. }
        );
        assert_eq!(
            e.world.height_span(a).unwrap().elevation,
            if allowed { height } else { 0. }
        );
        assert_eq!(e.hd2d_kinematic_flags() & (1 << 4) != 0, !allowed);
        consistent(&e, a);
    }
}

#[test]
fn hd2d_native_ledge_requires_explicit_drop_and_preserves_layer() {
    for allowed in [false, true] {
        let (mut e, a) = scene();
        steps(&mut e, a, 8., 0., Hd2dTileKind::Ledge);
        assert!(move_by(&mut e, a, 10., 0., 8., 8., allowed));
        assert_eq!(
            e.world.transform(a).unwrap().x,
            if allowed { 15. } else { 5. }
        );
        assert_eq!(e.hd2d_kinematic_flags() & (1 << 5) != 0, !allowed);
        consistent(&e, a);
    }
}

#[test]
fn hd2d_native_high_speed_bridge_pass_preserves_lower_floor() {
    let (mut e, a) = scene();
    e.world.set_transform(a, Transform2D { x: 0., y: 5. });
    span(&mut e, a, 0., 1.);
    let mut tiles = vec![0; 20];
    tiles[3] = 1;
    e.tilemap.set_layer(0, 20, 1, 1., 10., 0., 0., true, tiles);
    flat(&mut e, 1, 1, 16., Hd2dTileKind::Bridge);
    assert!(move_by(&mut e, a, 20., 0., 4., 4., false));
    assert_eq!(e.world.transform(a).unwrap().x, 20.);
    assert_ne!(e.hd2d_kinematic_flags() & (1 << 3), 0);
    assert_eq!(
        e.world.height_span(a).unwrap().floor,
        PhysicsFloorId::DEFAULT
    );
    consistent(&e, a);
}

#[test]
fn hd2d_native_new_elevation_cannot_enter_occupied_native_geometry() {
    let (mut e, a) = scene();
    steps(&mut e, a, 0., 3., Hd2dTileKind::Flat);
    let w = wall(&mut e, 15., 5., [2., 2., 2.]);
    let id = e.unified_body_id(w).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_planar_collision_span(
            id,
            Some(PlanarCollisionSpan {
                floor: 0,
                elevation: 3.,
                height: 1.,
            }),
        )
        .unwrap();
    assert!(move_by(&mut e, a, 10., 0., 4., 4., false));
    assert_eq!(e.world.transform(a).unwrap().x, 5.);
    assert_eq!(e.world.height_span(a).unwrap().elevation, 0.);
    assert_ne!(e.hd2d_kinematic_flags() & (1 << 4), 0);
    consistent(&e, a);
}

#[test]
fn hd2d_native_velocity_angle_pending_impulse_and_clock_survive_cold_move() {
    let (mut e, a) = scene();
    e.world.set_velocity(a, Velocity { vx: 2., vy: 1. });
    let angle = 4. * std::f32::consts::PI;
    e.world.set_rotation(a, Rotation2D { radians: angle });
    let d = e.world.spawn_entity();
    e.world.set_transform(d, Transform2D { x: 20., y: 20. });
    e.world.set_rigid_body(d, RigidBody::dynamic(1.));
    e.world.apply_impulse(d, Velocity { vx: 3., vy: 0. });
    let clock = e.fixed_timestep;
    let id = e.unified_body_id(a).unwrap();
    assert!(move_by(&mut e, a, 1., 0., 0., 0., false));
    assert_eq!(e.world.velocity(a).unwrap(), Velocity { vx: 2., vy: 1. });
    assert_eq!(e.world.rigid_body(d).unwrap().impulse.vx, 3.);
    assert_eq!(e.fixed_timestep, clock);
    assert_eq!(e.unified_body_id(a).unwrap(), id);
    assert!((e.world.rotations[a.id as usize].unwrap().radians - angle).abs() < 1e-5);
    consistent(&e, a);
}

#[test]
fn hd2d_native_wrong_kind_and_stale_identity_do_not_select_legacy() {
    let (mut e, a) = scene();
    e.world.set_rigid_body(a, RigidBody::dynamic(1.));
    let at = e.world.transform(a).unwrap();
    assert!(!move_by(&mut e, a, 2., 0., 0., 0., false));
    assert_eq!(e.world.transform(a).unwrap(), at);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::Physics(PhysicsError::WrongBodyKind))
    );
    assert!(!e.move_hd2d_kinematic_body_with_tilemap(
        a.id,
        a.generation + 1,
        2.,
        0.,
        8,
        4,
        0.,
        0.,
        false
    ));
}

#[test]
fn hd2d_native_invalid_destination_span_rolls_back_world_and_native() {
    let (mut e, a) = scene();
    steps(&mut e, a, 0., 1e6, Hd2dTileKind::Flat);
    assert!(!move_by(&mut e, a, 10., 0., 1e6, 1e6, false));
    assert_eq!(e.world.transform(a).unwrap().x, 5.);
    assert_eq!(e.world.height_span(a).unwrap().elevation, 0.);
    consistent(&e, a);
}

#[test]
fn hd2d_native_checkpoint_replays_manual_displacement_and_surface_state() {
    let (mut e, a) = scene();
    steps(&mut e, a, 0., 3., Hd2dTileKind::Flat);
    assert!(move_by(&mut e, a, 1., 0., 4., 4., false));
    let checkpoint = e.capture_runtime_checkpoint().unwrap();
    assert!(move_by(&mut e, a, 9., 0., 4., 4., false));
    let expected = (
        e.world.transform(a),
        e.world.height_span(a),
        e.hd2d_kinematic_flags(),
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap(),
    );
    assert!(e.restore_runtime_checkpoint(&checkpoint));
    assert!(move_by(&mut e, a, 9., 0., 4., 4., false));
    assert_eq!(
        (
            e.world.transform(a),
            e.world.height_span(a),
            e.hd2d_kinematic_flags()
        ),
        (expected.0, expected.1, expected.2)
    );
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap()
            .encoded_bytes(),
        expected.3.encoded_bytes()
    );
}

#[test]
fn hd2d_native_stair_changes_floor_and_refilters_immediate_queries() {
    let (mut e, a) = scene();
    steps(&mut e, a, 0., 3., Hd2dTileKind::Flat);
    flat(&mut e, 2, 1, 3., Hd2dTileKind::Stair);
    assert!(move_by(&mut e, a, 10., 0., 4., 4., false));
    assert_eq!(e.world.height_span(a).unwrap().floor, PhysicsFloorId(1));
    assert_ne!(e.hd2d_kinematic_flags() & (1 << 2), 0);
    consistent(&e, a);
}
