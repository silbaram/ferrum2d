use super::*;
use crate::components::gameplay::{CollisionReaction, CollisionTarget, Interaction};
use crate::components::{CollisionLayer, CollisionMask};
use crate::gameplay_event::{GAMEPLAY_EVENT_COLLISION_DAMAGE, GAMEPLAY_EVENT_INTERACTION};
use crate::physics3d::{BodyKind, PlanarCollisionSpan, Shape};

fn engine(space: Space, events: usize) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        max_events: events,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn body(e: &mut Engine, p: [f32; 3], offset: [f32; 3], category: u32) -> Entity {
    e.create_unified_body(
        BodyDesc {
            pose: Pose {
                position: p,
                ..Pose::default()
            },
            can_sleep: false,
            ..BodyDesc::default()
        },
        ColliderDesc {
            sensor: true,
            category,
            ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
        },
        offset,
    )
    .unwrap()
}
fn enable(e: &mut Engine, actor: Entity, combat: bool) {
    assert!(e.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, combat));
}
fn tick(e: &mut Engine) {
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
}
fn health(e: &Engine, entity: Entity) -> f32 {
    e.world.health_at_index(entity.id as usize).unwrap()
}
fn react(e: &mut Engine, entity: Entity, reaction: CollisionReaction) {
    assert!(e.world.add_collision_reaction(entity, reaction));
}
fn damage(e: &mut Engine, source: Entity, target: Entity) {
    assert!(e.world.set_damage(source, 7.0));
    assert!(e.world.set_health(target, 100.0));
    react(
        e,
        source,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    );
}

#[test]
fn native_gameplay_damage_uses_actual_pairs_even_without_projected_colliders() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space, 64);
        let a = body(&mut e, [0.0; 3], [100.0, 0.0, 0.0], 1);
        let b = body(&mut e, [0.75, 0.0, 0.0], [-100.0, 0.0, 0.0], 2);
        enable(&mut e, a, true);
        damage(&mut e, a, b);
        tick(&mut e);
        assert!(e.world.collider(a).is_none());
        assert_eq!(health(&e, b), 93.0);
        assert_eq!(
            e.frame_buffers
                .gameplay_events
                .iter()
                .filter(|v| v.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE)
                .count(),
            1
        );
        e.update(0.0);
        assert_eq!(health(&e, b), 93.0);
        tick(&mut e);
        assert_eq!(health(&e, b), 86.0);
        e.set_unified_body_pose(
            b,
            Pose {
                position: if space == Space::Spatial {
                    [0.0, 10.0, 0.0]
                } else {
                    [10.0, 0.0, 0.0]
                },
                ..Pose::default()
            },
        )
        .unwrap();
        tick(&mut e);
        assert_eq!(health(&e, b), 86.0);
    }
}

#[test]
fn native_gameplay_damage_survives_event_overflow_and_deduplicates_fixtures() {
    let mut e = engine(Space::Spatial, 1);
    let a = body(&mut e, [0.0; 3], [0.0; 3], 1);
    let targets: Vec<_> = (0..3)
        .map(|i| body(&mut e, [i as f32 * 0.1, 0.0, 0.0], [0.0; 3], 2))
        .collect();
    enable(&mut e, a, true);
    e.world.set_damage(a, 7.0);
    react(
        &mut e,
        a,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    );
    let id = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .add_collider(
            id,
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
            },
        )
        .unwrap();
    for &target in &targets {
        e.world.set_health(target, 100.0);
    }
    e.set_collision_lifecycle_events_enabled(false);
    tick(&mut e);
    for &target in &targets {
        assert_eq!(health(&e, target), 93.0);
    }
    assert!(e.frame_buffers.collision_events.is_empty());
    assert_eq!(
        e.frame_buffers
            .gameplay_events
            .iter()
            .filter(|v| v.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE)
            .count(),
        3
    );
}

#[test]
fn native_gameplay_area_damage_uses_xyz_and_fixture_categories_once_per_entity() {
    let mut e = engine(Space::Spatial, 64);
    let a = body(&mut e, [0.0; 3], [100.0, 100.0, 0.0], 1);
    let trigger = body(&mut e, [0.1, 0.0, 0.0], [0.0; 3], 2);
    let near = body(
        &mut e,
        [1.5, 0.0, 0.0],
        [-100.0, 0.0, 0.0],
        CollisionMask::ENEMY.bits,
    );
    let high = body(&mut e, [0.0, 5.0, 0.0], [0.0; 3], CollisionMask::ENEMY.bits);
    let compound = body(&mut e, [-1.5, 0.0, 0.0], [0.0; 3], CollisionMask::WALL.bits);
    let body_id = e.unified_body_id(compound).unwrap();
    for _ in 0..2 {
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .add_collider(
                body_id,
                ColliderDesc {
                    sensor: true,
                    category: CollisionMask::ENEMY.bits,
                    mask: 0,
                    ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
                },
            )
            .unwrap();
    }
    enable(&mut e, a, true);
    e.world.set_damage(a, 7.0);
    for target in [trigger, near, high, compound] {
        e.world.set_health(target, 100.0);
    }
    react(
        &mut e,
        a,
        CollisionReaction::AreaDamage {
            radius: 2.0,
            target_layer: CollisionLayer::Enemy,
        },
    );
    tick(&mut e);
    assert_eq!(health(&e, near), 93.0);
    assert_eq!(health(&e, compound), 93.0);
    assert_eq!(health(&e, high), 100.0);
    // No old World collider/layer is necessary; the actual fixture category selects targets.
    assert!(e.world.collider(compound).is_none());
}

#[test]
fn native_gameplay_planar_area_damage_preserves_logical_floor_filter() {
    let mut e = engine(Space::PlanarXy, 64);
    let a = body(&mut e, [0.0; 3], [50.0, 0.0, 0.0], 1);
    let trigger = body(&mut e, [0.1, 0.0, 0.0], [0.0; 3], 2);
    let near = body(&mut e, [1.5, 0.0, 0.0], [0.0; 3], CollisionMask::ENEMY.bits);
    let other = body(
        &mut e,
        [-1.5, 0.0, 0.0],
        [0.0; 3],
        CollisionMask::ENEMY.bits,
    );
    for (entity, floor) in [(a, 1), (trigger, 1), (near, 1), (other, 2)] {
        let span = HeightSpan {
            floor: PhysicsFloorId(floor),
            elevation: 0.0,
            height: 1.0,
        };
        e.world.set_height_span(entity, span);
        let id = e.unified_body_id(entity).unwrap();
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .set_planar_collision_span(
                id,
                Some(PlanarCollisionSpan {
                    floor,
                    elevation: 0.0,
                    height: 1.0,
                }),
            )
            .unwrap();
    }
    enable(&mut e, a, true);
    e.world.set_damage(a, 7.0);
    for target in [near, other] {
        e.world.set_health(target, 100.0);
    }
    react(
        &mut e,
        a,
        CollisionReaction::AreaDamage {
            radius: 2.0,
            target_layer: CollisionLayer::Enemy,
        },
    );
    tick(&mut e);
    assert_eq!(health(&e, near), 93.0);
    assert_eq!(health(&e, other), 100.0);
}

#[test]
fn native_gameplay_knockback_changes_simulation_velocity_not_visual_projection() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space, 64);
        let a = body(&mut e, [0.0; 3], [100.0, 100.0, 0.0], 1);
        let b = body(&mut e, [0.0, 0.75, 0.0], [-100.0, -100.0, 0.0], 2);
        enable(&mut e, a, true);
        react(
            &mut e,
            a,
            CollisionReaction::Knockback {
                target: CollisionTarget::OtherEntity,
                impulse: 6.0,
            },
        );
        tick(&mut e);
        let state = e.unified_body_state(b).unwrap();
        assert!((state.linear_velocity[1] - 6.0).abs() < 1e-5);
        assert!(state.linear_velocity[0].abs() < 1e-5);
        if space == Space::Spatial {
            assert_eq!(
                e.world.velocity_at_index_or_default(b.id as usize),
                Velocity::default()
            );
        }
        e.world
            .replace_collision_reactions_at_index(a.id as usize, None);
        tick(&mut e);
        assert!((e.unified_body_state(b).unwrap().pose.position[1] - 0.85).abs() < 1e-4);
        assert!(e.unified_physics_error().is_none());
    }
}

#[test]
fn native_gameplay_interaction_uses_simulation_distance_and_preserves_once() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space, 64);
        let a = body(&mut e, [0.0; 3], [100.0, 100.0, 0.0], 1);
        let b = body(&mut e, [0.5, 0.0, 0.0], [-100.0, -100.0, 0.0], 2);
        let far = body(&mut e, [0.0, 5.0, 0.0], [100.0, 100.0, 0.0], 2);
        enable(&mut e, a, false);
        e.world.set_interaction(b, Interaction::new(11, 1.0, true));
        e.world
            .set_interaction(far, Interaction::new(22, 1.0, true));
        tick(&mut e);
        let ids: Vec<_> = e
            .frame_buffers
            .gameplay_events
            .iter()
            .filter(|v| v.kind == GAMEPLAY_EVENT_INTERACTION)
            .map(|v| v.token_id)
            .collect();
        assert_eq!(ids, [11]);
        assert!(
            e.world
                .interaction_at_index(b.id as usize)
                .unwrap()
                .consumed
        );
        assert!(
            !e.world
                .interaction_at_index(far.id as usize)
                .unwrap()
                .consumed
        );
        tick(&mut e);
        assert!(!e
            .frame_buffers
            .gameplay_events
            .iter()
            .any(|v| v.kind == GAMEPLAY_EVENT_INTERACTION));
    }
}

#[test]
fn native_gameplay_spatial_nonphysical_markers_have_real_height() {
    let mut e = engine(Space::Spatial, 64);
    let a = body(&mut e, [0.0; 3], [100.0, 100.0, 0.0], 1);
    enable(&mut e, a, false);
    for (height, action) in [(0.2, 11), (5.0, 22)] {
        let marker = e.world.spawn_entity();
        e.world
            .set_transform(marker, Transform2D { x: 0.1, y: 0.0 });
        e.world.set_height_span(
            marker,
            HeightSpan {
                floor: PhysicsFloorId(7),
                elevation: height,
                height: 0.0,
            },
        );
        e.world
            .set_interaction(marker, Interaction::new(action, 1.0, false));
    }
    tick(&mut e);
    let ids: Vec<_> = e
        .frame_buffers
        .gameplay_events
        .iter()
        .filter(|v| v.kind == GAMEPLAY_EVENT_INTERACTION)
        .map(|v| v.token_id)
        .collect();
    assert_eq!(ids, [11]);
}

#[test]
fn native_gameplay_planar_interactions_keep_floor_separation() {
    let mut e = engine(Space::PlanarXy, 64);
    let a = body(&mut e, [0.0; 3], [0.0; 3], 1);
    let b = body(&mut e, [0.1, 0.0, 0.0], [0.0; 3], 2);
    enable(&mut e, a, false);
    for (entity, floor) in [(a, 1), (b, 2)] {
        e.world.set_height_span(
            entity,
            HeightSpan {
                floor: PhysicsFloorId(floor),
                elevation: 0.0,
                height: 1.0,
            },
        );
    }
    e.world.set_interaction(b, Interaction::new(11, 1.0, false));
    tick(&mut e);
    assert!(!e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_INTERACTION));
}

#[test]
fn native_gameplay_retired_pair_does_not_damage_reused_entity() {
    let mut e = engine(Space::Spatial, 64);
    let a = body(&mut e, [0.0; 3], [0.0; 3], 1);
    let b = body(&mut e, [0.1, 0.0, 0.0], [0.0; 3], 2);
    enable(&mut e, a, true);
    damage(&mut e, a, b);
    tick(&mut e);
    e.remove_unified_body(b).unwrap();
    let next = body(&mut e, [0.0, 10.0, 0.0], [0.0; 3], 2);
    assert_eq!(next.id, b.id);
    assert_ne!(next.generation, b.generation);
    e.world.set_health(next, 100.0);
    tick(&mut e);
    assert_eq!(health(&e, next), 100.0);
}

#[test]
fn native_gameplay_imported_planar_components_keep_damage_and_knockback() {
    use crate::components::{CircleCollider, RigidBody};
    let mut e = engine(Space::PlanarXy, 64);
    let mut entities = Vec::new();
    for x in [0.0, 0.75] {
        let entity = e.world.spawn_entity();
        e.world.set_transform(entity, Transform2D { x, y: 0.0 });
        e.world.set_rigid_body(entity, RigidBody::dynamic(1.0));
        e.world.set_circle_collider(
            entity,
            CircleCollider::new(0.5, true, CollisionLayer::Enemy),
        );
        entities.push(entity);
    }
    let (a, b) = (entities[0], entities[1]);
    enable(&mut e, a, true);
    damage(&mut e, a, b);
    react(
        &mut e,
        a,
        CollisionReaction::Knockback {
            target: CollisionTarget::OtherEntity,
            impulse: 6.0,
        },
    );
    tick(&mut e);
    assert_eq!(health(&e, b), 93.0);
    assert_eq!(
        e.unified_body_state(b).unwrap().linear_velocity,
        [6.0, 0.0, 0.0]
    );
    e.world
        .replace_collision_reactions_at_index(a.id as usize, None);
    tick(&mut e);
    assert!((e.unified_body_state(b).unwrap().pose.position[0] - 0.85).abs() < 1e-4);
    assert_eq!(e.world.velocity_at_index_or_default(b.id as usize).vx, 6.0);
}

#[test]
fn native_gameplay_interaction_input_selects_nearest_in_three_dimensions() {
    let mut e = engine(Space::Spatial, 64);
    let a = body(&mut e, [0.0; 3], [100.0, 100.0, 0.0], 1);
    let high = body(&mut e, [0.0, 2.0, 0.0], [100.0, 100.0, 0.0], 2);
    let near = body(&mut e, [1.0, 0.0, 0.0], [-100.0, -100.0, 0.0], 2);
    assert!(e.configure_data_scene_gameplay_v2(true, a.id, a.generation, 91, false));
    assert!(e.set_input_action_binding(
        91,
        0,
        crate::input::INPUT_ACTION_CONTROL_SPACE,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    ));
    e.world
        .set_interaction(high, Interaction::new(11, 3.0, false));
    e.world
        .set_interaction(near, Interaction::new(22, 3.0, false));
    tick(&mut e);
    assert!(e.frame_buffers.gameplay_events.is_empty());
    e.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    tick(&mut e);
    let ids: Vec<_> = e
        .frame_buffers
        .gameplay_events
        .iter()
        .filter(|v| v.kind == GAMEPLAY_EVENT_INTERACTION)
        .map(|v| v.token_id)
        .collect();
    assert_eq!(ids, [22]);
    tick(&mut e);
    assert!(e.frame_buffers.gameplay_events.is_empty());
}

#[test]
fn native_gameplay_rejected_knockback_does_not_write_fake_world_velocity() {
    let mut e = engine(Space::Spatial, 64);
    let a = body(&mut e, [0.0; 3], [0.0; 3], 1);
    let fixed = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0.75, 0.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
            },
            [0.0; 3],
        )
        .unwrap();
    enable(&mut e, a, true);
    react(
        &mut e,
        a,
        CollisionReaction::Knockback {
            target: CollisionTarget::OtherEntity,
            impulse: 6.0,
        },
    );
    tick(&mut e);
    assert_eq!(
        e.unified_body_state(fixed).unwrap().linear_velocity,
        [0.0; 3]
    );
    assert_eq!(
        e.world.velocity_at_index_or_default(fixed.id as usize),
        Velocity::default()
    );
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::Physics(PhysicsError::WrongBodyKind))
    );
}
