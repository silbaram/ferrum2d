use super::*;
use crate::components::{AabbCollider, CollisionFilter, CollisionLayer, CollisionMask};
use crate::gameplay_event::*;
use crate::physics3d::{BodyKind, Shape};

fn engine(space: Space) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn body(e: &mut Engine, p: [f32; 3], category: u32, offset: [f32; 3]) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: p,
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc {
            category,
            sensor: true,
            ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
        },
        offset,
    )
    .unwrap()
}
fn attack(e: &mut Engine, a: Entity, range: f32) {
    assert!(e.set_gameplay_action_melee(a.id, a.generation, 77, 1., range, 2.));
    assert!(e.set_input_action_binding(
        77,
        0,
        crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    ));
    assert!(e.configure_data_scene_gameplay_v2(true, a.id, a.generation, 0, true));
}
fn click(e: &mut Engine, down: bool) {
    e.set_input(false, false, false, false, false, false, down, -1., -1.);
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
}
fn hp(e: &mut Engine, target: Entity) {
    assert!(e.world.set_health(target, 10.));
}
fn cooldown(e: &Engine, source: Entity) -> f32 {
    e.world
        .action_binding(source, 77)
        .unwrap()
        .cooldown
        .remaining_seconds
}
fn fixture(e: &Engine, body: Entity) -> crate::physics3d::ColliderId {
    e.unified_physics
        .as_ref()
        .unwrap()
        .physics
        .collider_ids(e.unified_body_id(body).unwrap())
        .unwrap()
        .next()
        .unwrap()
}
fn wall(e: &mut Engine, p: [f32; 3], sensor: bool, mask: u32) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: p,
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc {
            category: CollisionMask::WALL.bits,
            mask,
            sensor,
            ..ColliderDesc::new(Shape::Box {
                half_extents: [0.1, 0.4, 0.4],
            })
        },
        [0.; 3],
    )
    .unwrap()
}

#[test]
fn native_melee_uses_simulation_origin_and_xyz_range_without_legacy_colliders() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space);
        let a = body(
            &mut e,
            [0., 1., 0.],
            CollisionMask::PLAYER.bits,
            [100., 100., 0.],
        );
        let near = body(
            &mut e,
            [1., 1., 0.],
            CollisionMask::ENEMY.bits,
            [-100., 100., 0.],
        );
        let far = body(
            &mut e,
            [0., 8., 0.],
            CollisionMask::ENEMY.bits,
            [100., -7., 0.],
        );
        hp(&mut e, near);
        hp(&mut e, far);
        attack(&mut e, a, 2.);
        click(&mut e, true);
        assert!(e.world.collider(a).is_none());
        assert_eq!(e.world.health(near), Some(8.));
        assert_eq!(e.world.health(far), Some(10.));
        assert!(cooldown(&e, a) > 0.9);
        click(&mut e, false);
        click(&mut e, true);
        assert_eq!(e.world.health(near), Some(8.), "cooldown ignored");
        assert_eq!(e.unified_physics_error(), None);
    }
}

#[test]
fn native_melee_wall_masks_sensors_disabled_fixtures_and_floor_are_respected() {
    for variant in 0..5 {
        let mut e = engine(Space::Spatial);
        let a = body(&mut e, [0., 1., 0.], CollisionMask::PLAYER.bits, [0.; 3]);
        let target = body(&mut e, [2., 1., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
        hp(&mut e, target);
        attack(&mut e, a, 3.);
        let w = wall(
            &mut e,
            if variant == 4 {
                [1., -1., 0.]
            } else {
                [1., 1., 0.]
            },
            variant == 1,
            if variant == 2 { 0 } else { u32::MAX },
        );
        if variant == 3 {
            let id = e.unified_body_id(w).unwrap();
            e.unified_physics
                .as_mut()
                .unwrap()
                .physics
                .set_body_options(
                    id,
                    &crate::physics3d::BodyOptions {
                        enabled: false,
                        ..crate::physics3d::BodyOptions::default()
                    },
                )
                .unwrap();
        }
        click(&mut e, true);
        assert_eq!(
            e.world.health(target),
            Some(if variant == 0 { 10. } else { 8. }),
            "variant {variant}"
        );
        assert!(
            cooldown(&e, a) > 0.9,
            "an admitted miss still consumes cooldown"
        );
    }
}

#[test]
fn native_melee_matches_secondary_fixture_and_local_pose_once_per_entity() {
    let mut e = engine(Space::Spatial);
    let a = body(&mut e, [0., 1., 0.], CollisionMask::PLAYER.bits, [0.; 3]);
    let target = body(&mut e, [10., 1., 0.], CollisionMask::WALL.bits, [0.; 3]);
    hp(&mut e, target);
    attack(&mut e, a, 3.);
    let id = e.unified_body_id(target).unwrap();
    for _ in 0..3 {
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .add_collider(
                id,
                ColliderDesc {
                    pose: Pose {
                        position: [-8., 0., 0.],
                        ..Pose::default()
                    },
                    sensor: true,
                    category: CollisionMask::ENEMY.bits,
                    ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
                },
            )
            .unwrap();
    }
    click(&mut e, true);
    assert_eq!(e.world.health(target), Some(8.));
    assert_eq!(
        e.frame_buffers
            .gameplay_events
            .iter()
            .filter(|event| event.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE)
            .count(),
        1
    );
}

#[test]
fn native_melee_tries_an_exposed_secondary_fixture_when_nearest_is_occluded() {
    let mut e = engine(Space::Spatial);
    let a = body(&mut e, [0., 1., 0.], CollisionMask::PLAYER.bits, [0.; 3]);
    let target = body(&mut e, [2., 1., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
    wall(&mut e, [1., 1., 0.], false, u32::MAX);
    let id = e.unified_body_id(target).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .add_collider(
            id,
            ColliderDesc {
                pose: Pose {
                    position: [0., 0., 2.],
                    ..Pose::default()
                },
                sensor: true,
                category: CollisionMask::ENEMY.bits,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
            },
        )
        .unwrap();
    hp(&mut e, target);
    attack(&mut e, a, 4.);
    click(&mut e, true);
    assert_eq!(e.world.health(target), Some(8.));
}

#[test]
fn native_melee_mutual_filters_factions_and_nonhealth_entities() {
    let mut e = engine(Space::Spatial);
    let a = body(&mut e, [0., 1., 0.], CollisionMask::PLAYER.bits, [0.; 3]);
    let filtered = body(&mut e, [1., 1., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
    let friendly = body(&mut e, [-1., 1., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
    let decor = body(&mut e, [0., 1., 1.], CollisionMask::ENEMY.bits, [0.; 3]);
    hp(&mut e, filtered);
    hp(&mut e, friendly);
    let id = fixture(&e, filtered);
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .update_collider(
            id,
            ColliderDesc {
                sensor: true,
                category: CollisionMask::ENEMY.bits,
                mask: 0,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
            },
        )
        .unwrap();
    assert!(e.set_gameplay_faction(a.id, a.generation, 1, 0));
    assert!(e.set_gameplay_faction(friendly.id, friendly.generation, 1, u32::MAX));
    attack(&mut e, a, 2.);
    click(&mut e, true);
    assert_eq!(e.world.health(filtered), Some(10.));
    assert_eq!(e.world.health(friendly), Some(10.));
    assert_eq!(e.world.health(decor), None);
    assert!(e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|event| event.kind == GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED));
}

#[test]
fn native_melee_keeps_dispatch_origin_when_attacker_moves_before_resolution() {
    let mut e = engine(Space::Spatial);
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                linear_velocity: [300., 0., 0.],
                pose: Pose {
                    position: [0., 1., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                category: CollisionMask::PLAYER.bits,
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
            },
            [100., 0., 0.],
        )
        .unwrap();
    let start = body(&mut e, [0.8, 1., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
    let end = body(&mut e, [5.8, 1., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
    hp(&mut e, start);
    hp(&mut e, end);
    attack(&mut e, a, 1.);
    click(&mut e, true);
    assert!(e.unified_body_state(a).unwrap().pose.position[0] > 4.9);
    assert_eq!(e.world.health(start), Some(8.));
    assert_eq!(e.world.health(end), Some(10.));
}

#[test]
fn native_melee_capacity_rejection_is_atomic_and_keeps_cooldown_ready() {
    let mut e = engine(Space::Spatial);
    let a = body(&mut e, [0., 1., 0.], CollisionMask::PLAYER.bits, [0.; 3]);
    let targets: Vec<_> = (0..200)
        .map(|_| {
            let b = body(&mut e, [1., 1., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
            hp(&mut e, b);
            b
        })
        .collect();
    attack(&mut e, a, 2.);
    click(&mut e, true);
    assert!(targets.iter().all(|&b| e.world.health(b) == Some(10.)));
    assert_eq!(cooldown(&e, a), 0.);
    assert!(e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|event| event.kind == GAMEPLAY_EVENT_ACTION_FAILED));
    for &b in &targets[40..] {
        e.world.despawn(b);
    }
    click(&mut e, false);
    click(&mut e, true);
    assert!(targets[..40].iter().all(|&b| e.world.health(b) == Some(8.)));
}

#[test]
fn native_melee_planar_component_import_preserves_floor_filtering_on_first_tick() {
    let mut e = engine(Space::PlanarXy);
    let mut entities = Vec::new();
    for (x, layer, floor) in [
        (0., CollisionLayer::Player, 0),
        (1., CollisionLayer::Enemy, 0),
        (-1., CollisionLayer::Enemy, 1),
    ] {
        let entity = e.world.spawn_entity();
        e.world.set_transform(entity, Transform2D { x, y: 0. });
        e.world
            .set_aabb_collider(entity, AabbCollider::new(0.2, 0.2, true, layer));
        e.world
            .set_collision_filter(entity, CollisionFilter::from_layer(layer));
        e.world.set_height_span(
            entity,
            HeightSpan::new(PhysicsFloorId(floor), 0., 1.).unwrap(),
        );
        hp(&mut e, entity);
        entities.push(entity);
    }
    attack(&mut e, entities[0], 2.);
    click(&mut e, true);
    assert_eq!(e.world.health(entities[1]), Some(8.));
    assert_eq!(e.world.health(entities[2]), Some(10.));
    assert_eq!(e.unified_physics_error(), None);
}

#[test]
fn native_melee_planar_sight_uses_physics_span_overlap_above_the_floor() {
    for floor_block in [false, true] {
        let mut e = engine(Space::PlanarXy);
        let a = body(&mut e, [0.; 3], CollisionMask::PLAYER.bits, [0.; 3]);
        let target = body(&mut e, [2., 0., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
        let ground = wall(&mut e, [1., 0., 0.], false, u32::MAX);
        let other_floor = body(&mut e, [-1., 0., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
        for (entity, floor, height) in [
            (a, 0, 2.),
            (target, 0, 2.),
            (ground, 0, if floor_block { 1.5 } else { 0. }),
            (other_floor, 1, 2.),
        ] {
            let id = e.unified_body_id(entity).unwrap();
            e.unified_physics
                .as_mut()
                .unwrap()
                .physics
                .set_planar_collision_span(
                    id,
                    Some(crate::physics3d::PlanarCollisionSpan {
                        floor,
                        elevation: 0.,
                        height,
                    }),
                )
                .unwrap();
        }
        hp(&mut e, target);
        hp(&mut e, other_floor);
        attack(&mut e, a, 3.);
        click(&mut e, true);
        assert_eq!(
            e.world.health(target),
            Some(if floor_block { 10. } else { 8. })
        );
        assert_eq!(e.world.health(other_floor), Some(10.));
    }
}

#[test]
fn native_melee_timer_targets_primary_actor_and_respects_pause() {
    let mut e = engine(Space::Spatial);
    let a = body(
        &mut e,
        [0., 1., 0.],
        CollisionMask::PLAYER.bits,
        [100., 0., 0.],
    );
    let source = body(
        &mut e,
        [1., 1., 0.],
        CollisionMask::ENEMY.bits,
        [-100., 0., 0.],
    );
    let other_player = body(&mut e, [1.5, 1., 0.], CollisionMask::PLAYER.bits, [0.; 3]);
    hp(&mut e, a);
    hp(&mut e, other_player);
    attack(&mut e, a, 2.);
    assert!(e.set_gameplay_action_melee_with_target(
        source.id,
        source.generation,
        78,
        0.,
        2.,
        2.,
        1
    ));
    assert!(e.set_gameplay_timer_action_trigger(source.id, source.generation, 9, 0.1, 78));
    for _ in 0..7 {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
    }
    assert_eq!(e.world.health(a), Some(8.));
    assert_eq!(e.world.health(other_player), Some(10.));
    assert!(e.pause_data_scene());
    e.update(5.);
    assert_eq!(e.world.health(a), Some(8.));
    assert!(e.resume_data_scene());
    for _ in 0..7 {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
    }
    assert_eq!(e.world.health(a), Some(6.));
}

#[test]
fn native_melee_primary_source_mask_and_disabled_source_gate_action() {
    for disabled in [false, true] {
        let mut e = engine(Space::Spatial);
        let a = body(&mut e, [0., 1., 0.], CollisionMask::PLAYER.bits, [0.; 3]);
        let target = body(&mut e, [1., 1., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
        hp(&mut e, target);
        attack(&mut e, a, 2.);
        if disabled {
            let body = e.unified_body_id(a).unwrap();
            e.unified_physics
                .as_mut()
                .unwrap()
                .physics
                .set_body_options(
                    body,
                    &crate::physics3d::BodyOptions {
                        enabled: false,
                        ..crate::physics3d::BodyOptions::default()
                    },
                )
                .unwrap();
        } else {
            let id = fixture(&e, a);
            e.unified_physics
                .as_mut()
                .unwrap()
                .physics
                .update_collider(
                    id,
                    ColliderDesc {
                        sensor: true,
                        category: CollisionMask::PLAYER.bits,
                        mask: CollisionMask::WALL.bits,
                        ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
                    },
                )
                .unwrap();
        }
        click(&mut e, true);
        assert_eq!(e.world.health(target), Some(10.));
        assert_eq!(cooldown(&e, a) == 0., disabled);
        assert_eq!(
            e.frame_buffers
                .gameplay_events
                .iter()
                .any(|event| event.kind == GAMEPLAY_EVENT_ACTION_FAILED),
            disabled
        );
    }
}

#[test]
fn native_melee_kill_is_reported_once_and_retires_native_body() {
    let mut e = engine(Space::Spatial);
    let a = body(&mut e, [0., 1., 0.], CollisionMask::PLAYER.bits, [0.; 3]);
    let target = body(&mut e, [1., 1., 0.], CollisionMask::ENEMY.bits, [0.; 3]);
    e.world.set_health(target, 2.);
    attack(&mut e, a, 2.);
    click(&mut e, true);
    assert!(!e.world.is_current_entity(target));
    let damage: Vec<_> = e
        .frame_buffers
        .gameplay_events
        .iter()
        .filter(|event| event.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE)
        .collect();
    assert_eq!(damage.len(), 1);
    assert_eq!(damage[0].actor_id, target.id);
    click(&mut e, false);
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .bindings
        .contains_key(&(target.id, target.generation)));
}
