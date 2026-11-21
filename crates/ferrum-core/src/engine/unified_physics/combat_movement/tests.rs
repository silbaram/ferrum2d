use super::*;
use crate::physics3d::{CharacterInput, Shape};

fn setup(space: Space) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let player = body(&mut e, BodyKind::Fixed, [1000., 0., 0.], [0.; 3], 0);
    assert!(e.configure_data_scene_gameplay_v2(true, player.id, player.generation, 0, true));
    e
}
fn body(
    e: &mut Engine,
    kind: BodyKind,
    position: [f32; 3],
    offset: [f32; 3],
    category: u32,
) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind,
            pose: Pose {
                position,
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc {
            sensor: true,
            category,
            ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
        },
        offset,
    )
    .unwrap()
}
fn tick(e: &mut Engine, n: usize) {
    for _ in 0..n {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
        assert_eq!(e.unified_physics_error(), None);
    }
}
fn position(e: &Engine, a: Entity) -> [f32; 3] {
    e.unified_body_state(a).unwrap().pose.position
}
fn velocity(e: &Engine, a: Entity) -> [f32; 3] {
    e.unified_body_state(a).unwrap().linear_velocity
}
fn pattern(e: &mut Engine, a: Entity, p: MovementPattern) {
    e.world.set_movement_pattern(a, p);
}

#[test]
fn native_combat_movement_chase_uses_physical_poses_for_every_body_kind_and_space() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for kind in [
            BodyKind::Dynamic,
            BodyKind::KinematicVelocity,
            BodyKind::KinematicPosition,
        ] {
            let mut e = setup(space);
            let a = body(&mut e, kind, [0.; 3], [100., 0., 0.], 2);
            let b = body(&mut e, BodyKind::Fixed, [10., 0., 0.], [-100., 0., 0.], 1);
            pattern(
                &mut e,
                a,
                MovementPattern::Chase {
                    target: MovementTarget::Entity(b),
                    speed: 2.,
                },
            );
            tick(&mut e, 30);
            assert!(
                (position(&e, a)[0] - 1.).abs() < 0.001,
                "{:?}",
                position(&e, a)
            );
            assert!((e.world.transform(a).unwrap().x - 101.).abs() < 0.001);
            assert!(e.world.rigid_body(a).is_none());
        }
    }
}

#[test]
fn native_combat_movement_nearest_uses_xyz_and_native_categories_without_world_colliders() {
    let mut e = setup(Space::Spatial);
    let a = body(
        &mut e,
        BodyKind::KinematicVelocity,
        [0.; 3],
        [100., 0., 0.],
        2,
    );
    body(&mut e, BodyKind::Fixed, [-0.1, 10., 0.], [100., 0., 0.], 2);
    let near = body(&mut e, BodyKind::Fixed, [2., 0., 0.], [-100., 0., 0.], 2);
    assert!(e.world.collider(near).is_none());
    pattern(
        &mut e,
        a,
        MovementPattern::Chase {
            target: MovementTarget::NearestEnemy,
            speed: 1.,
        },
    );
    tick(&mut e, 1);
    assert!(velocity(&e, a)[0] > 0.99);
    assert!(position(&e, a)[0] > 0.);
}

#[test]
fn native_combat_movement_targets_faction_tag_primary_and_stale_generations() {
    use crate::components::gameplay::{GameplayFaction, GameplayTags};
    let mut e = setup(Space::Spatial);
    let a = body(
        &mut e,
        BodyKind::KinematicVelocity,
        [0.; 3],
        [20., 0., 0.],
        2,
    );
    let b = body(&mut e, BodyKind::Fixed, [5., 0., 0.], [-20., 0., 0.], 1);
    e.world
        .set_gameplay_faction(b, GameplayFaction::new(7, 0).unwrap());
    let tags = GameplayTags::new(1 << 3).unwrap();
    e.world.set_gameplay_tags(b, tags);
    assert!(e.world.set_primary_actor_entity(b));
    for target in [
        MovementTarget::NearestFaction(7),
        MovementTarget::NearestTag(3),
        MovementTarget::PrimaryActor,
        MovementTarget::NearestPrimaryActor,
        MovementTarget::NearestLayer(CollisionLayer::Player),
    ] {
        pattern(&mut e, a, MovementPattern::Chase { target, speed: 1. });
        tick(&mut e, 1);
        assert!(velocity(&e, a)[0] > 0.99);
    }
    e.world.despawn(b);
    let replacement = body(&mut e, BodyKind::Fixed, [-5., 0., 0.], [0.; 3], 1);
    assert_eq!(replacement.id, b.id);
    assert_ne!(replacement.generation, b.generation);
    pattern(
        &mut e,
        a,
        MovementPattern::Chase {
            target: MovementTarget::Entity(b),
            speed: 1.,
        },
    );
    let before = position(&e, a);
    tick(&mut e, 1);
    assert_eq!(position(&e, a), before);
}

#[test]
fn native_combat_movement_planar_target_selection_obeys_native_floor_and_height() {
    let mut e = setup(Space::PlanarXy);
    let a = body(&mut e, BodyKind::KinematicVelocity, [0.; 3], [0.; 3], 2);
    let b = body(&mut e, BodyKind::Fixed, [1., 0., 0.], [0.; 3], 1);
    let c = body(&mut e, BodyKind::Fixed, [-2., 0., 0.], [0.; 3], 1);
    let ids = [a, b, c].map(|a| e.unified_body_id(a).unwrap());
    for (id, floor) in ids.into_iter().zip([4, 5, 4]) {
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .set_planar_collision_span(
                id,
                Some(PlanarCollisionSpan {
                    floor,
                    elevation: 0.,
                    height: 1.,
                }),
            )
            .unwrap();
    }
    pattern(
        &mut e,
        a,
        MovementPattern::Chase {
            target: MovementTarget::NearestLayer(CollisionLayer::Player),
            speed: 1.,
        },
    );
    tick(&mut e, 1);
    assert!(velocity(&e, a)[0] < -0.99);
    // A World visual-height edit must not replace the native filter.
    e.world.set_height_span(
        b,
        crate::components::HeightSpan {
            floor: crate::components::PhysicsFloorId(4),
            elevation: 0.,
            height: 1.,
        },
    );
    tick(&mut e, 1);
    assert!(velocity(&e, a)[0] < -0.99);
}

#[test]
fn native_combat_movement_patterns_share_math_and_preserve_spatial_vertical_and_angular_velocity() {
    let mut e = setup(Space::Spatial);
    let a = body(&mut e, BodyKind::KinematicVelocity, [0.; 3], [0.; 3], 2);
    let id = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_velocity(id, [0., 3., 0.], [0., 1., 0.])
        .unwrap();
    pattern(&mut e, a, MovementPattern::Linear { vx: 2., vy: 4. });
    tick(&mut e, 1);
    assert_eq!(velocity(&e, a), [2., 3., -4.]);
    pattern(
        &mut e,
        a,
        MovementPattern::Accelerate {
            acceleration_x: 1.,
            acceleration_y: 0.,
            max_speed: 10.,
        },
    );
    tick(&mut e, 1);
    assert_eq!(velocity(&e, a), [3., 3., -4.]);
    pattern(
        &mut e,
        a,
        MovementPattern::SeekTarget {
            target: MovementTarget::Entity(a),
            speed: 5.,
            turn_rate: 0.5,
        },
    );
    tick(&mut e, 1);
    assert_eq!(velocity(&e, a), [0., 3., 0.]);
    pattern(
        &mut e,
        a,
        MovementPattern::MoveToPoint {
            x: 10.,
            y: 0.,
            speed: 2.,
        },
    );
    tick(&mut e, 1);
    assert!(velocity(&e, a)[0] > 1.9);
    pattern(&mut e, a, MovementPattern::Static);
    tick(&mut e, 1);
    assert_eq!(velocity(&e, a), [0., 3., 0.]);
    assert_eq!(
        e.unified_body_state(a).unwrap().angular_velocity,
        [0., 1., 0.]
    );
}

#[test]
fn native_combat_movement_seek_and_orbit_use_physical_target_and_previous_velocity() {
    let mut e = setup(Space::Spatial);
    let a = body(
        &mut e,
        BodyKind::KinematicVelocity,
        [0.; 3],
        [100., 0., 0.],
        2,
    );
    let b = body(&mut e, BodyKind::Fixed, [10., 0., 0.], [-100., 0., 0.], 1);
    pattern(
        &mut e,
        a,
        MovementPattern::SeekTarget {
            target: MovementTarget::Entity(b),
            speed: 4.,
            turn_rate: 0.5,
        },
    );
    tick(&mut e, 1);
    assert_eq!(velocity(&e, a), [2., 0., 0.]);
    tick(&mut e, 1);
    assert_eq!(velocity(&e, a), [3., 0., 0.]);
    pattern(
        &mut e,
        a,
        MovementPattern::Orbit {
            target: MovementTarget::Entity(b),
            speed: 2.,
            radius: 10.,
            radial_band: 1.,
        },
    );
    tick(&mut e, 1);
    assert!(velocity(&e, a)[2] > 1.99);
}

fn character_scene(space: Space) -> (Engine, Entity) {
    let mut e = setup(space);
    e.set_unified_runtime_settings(
        [0., -10., 0.],
        e.unified_physics.as_ref().unwrap().physics.config().solver,
    )
    .unwrap();
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [0., -0.5, 0.],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [20., 0.5, 20.],
        }),
        [0.; 3],
    )
    .unwrap();
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [0., 1., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
            [100., 0., 0.],
        )
        .unwrap();
    e.enable_unified_character(a, CharacterConfig::default())
        .unwrap();
    tick(&mut e, 60);
    assert!(e.unified_character_state(a).unwrap().grounded);
    (e, a)
}

#[test]
fn native_combat_movement_character_hits_wall_preserves_jump_and_fixed_tick_pause() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut e, a) = character_scene(space);
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [2., 2., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.1, 2., 2.],
            }),
            [0.; 3],
        )
        .unwrap();
        pattern(&mut e, a, MovementPattern::Linear { vx: 3., vy: 0. });
        e.set_unified_character_input(
            a,
            CharacterInput {
                velocity: [0.; 3],
                jump_speed: 4.,
            },
        )
        .unwrap();
        let before = position(&e, a);
        e.fixed_timestep.pause();
        tick(&mut e, 10);
        assert_eq!(position(&e, a), before);
        e.fixed_timestep.resume();
        tick(&mut e, 1);
        assert!(position(&e, a)[0] > before[0] && position(&e, a)[1] > before[1]);
        assert!(e.unified_character_state(a).unwrap().vertical_speed > 3.);
        tick(&mut e, 120);
        assert!(
            (1.60..1.66).contains(&position(&e, a)[0]),
            "{:?}",
            position(&e, a)
        );
        assert!(e.unified_character_state(a).unwrap().grounded);
        assert!(e.world.collider(a).is_none());
    }
}

#[test]
fn native_combat_movement_never_overwrites_spatial_input_actor_even_if_primary_differs() {
    let (mut e, a) = character_scene(Space::Spatial);
    let primary = body(&mut e, BodyKind::Fixed, [-10., 0., 0.], [0.; 3], 1);
    assert!(e.world.set_primary_actor_entity(primary));
    e.spatial_scene.camera = crate::spatial_scene::SpatialCamera::new(&[
        0., 0., 8., 10., 0., 0., 0., 20., 0.1, 100., 100., 100.,
    ]);
    assert!(e.configure_spatial_actor(a.id, a.generation, 2., 0.3, 0.2));
    pattern(&mut e, a, MovementPattern::Linear { vx: -100., vy: 0. });
    e.input = crate::input::InputState {
        d: 1,
        ..crate::input::InputState::default()
    };
    tick(&mut e, 30);
    assert!(
        (position(&e, a)[0] - 1.).abs() < 0.01,
        "{:?}",
        position(&e, a)
    );
}

#[test]
fn native_combat_movement_invalid_speed_leaves_existing_intent_unchanged() {
    for kind in [
        BodyKind::Dynamic,
        BodyKind::KinematicVelocity,
        BodyKind::KinematicPosition,
    ] {
        let mut e = setup(Space::Spatial);
        let a = body(&mut e, kind, [0.; 3], [0.; 3], 2);
        let id = e.unified_body_id(a).unwrap();
        if kind == BodyKind::KinematicPosition {
            e.unified_physics
                .as_mut()
                .unwrap()
                .physics
                .set_kinematic_target(
                    id,
                    Pose {
                        position: [1., 0., 0.],
                        ..Pose::default()
                    },
                )
                .unwrap();
        } else {
            e.unified_physics
                .as_mut()
                .unwrap()
                .physics
                .set_velocity(id, [2., 0., 0.], [0.; 3])
                .unwrap();
        }
        pattern(&mut e, a, MovementPattern::Linear { vx: 1.0e7, vy: 0. });
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
        assert_eq!(
            e.unified_physics_error(),
            Some(UnifiedPhysicsError::Physics(PhysicsError::InvalidBody))
        );
        let expected = if kind == BodyKind::KinematicPosition {
            1.
        } else {
            2. / 60.
        };
        assert!((position(&e, a)[0] - expected).abs() < 0.001);
    }
}

#[test]
fn native_combat_movement_planar_acceleration_does_not_cap_ground_speed_by_jump_speed() {
    let (mut e, a) = character_scene(Space::PlanarXy);
    pattern(
        &mut e,
        a,
        MovementPattern::Accelerate {
            acceleration_x: 1.,
            acceleration_y: 0.,
            max_speed: 1.,
        },
    );
    e.set_unified_character_input(
        a,
        CharacterInput {
            velocity: [0.; 3],
            jump_speed: 4.,
        },
    )
    .unwrap();
    tick(&mut e, 1);
    let before = position(&e, a);
    tick(&mut e, 1);
    assert!(
        (position(&e, a)[0] - before[0] - 1. / 60.).abs() < 0.0001,
        "{:?}",
        velocity(&e, a)
    );
    assert!(e.unified_character_state(a).unwrap().vertical_speed > 3.);
}

#[test]
fn native_combat_movement_actor_cap_stops_native_intent_and_static_fixed_is_valid() {
    let mut e = setup(Space::Spatial);
    let mut last = None;
    for i in 0..513 {
        let a = body(
            &mut e,
            BodyKind::KinematicVelocity,
            [i as f32, 0., 0.],
            [0.; 3],
            2,
        );
        let id = e.unified_body_id(a).unwrap();
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .set_velocity(id, [3., 0., 0.], [0.; 3])
            .unwrap();
        pattern(&mut e, a, MovementPattern::Linear { vx: 1., vy: 0. });
        last = Some(a);
    }
    tick(&mut e, 1);
    let last = last.unwrap();
    assert_eq!(position(&e, last)[0], 512.);
    assert_eq!(velocity(&e, last), [0.; 3]);
    let mut e = setup(Space::Spatial);
    let fixed = body(&mut e, BodyKind::Fixed, [2., 0., 0.], [0.; 3], 2);
    pattern(&mut e, fixed, MovementPattern::Static);
    tick(&mut e, 1);
    assert_eq!(position(&e, fixed), [2., 0., 0.]);
}
