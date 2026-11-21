use super::*;
use crate::collision_event::*;
use crate::components::gameplay::{CollisionReaction, CollisionTarget};
use crate::gameplay_event::GameplayEvent;
use crate::physics3d::{BodyKind, Shape};

fn engine(space: Space, max_events: usize) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        max_events,
        ..WorldConfig::default()
    })
    .unwrap();
    e.set_collision_lifecycle_events_enabled(true);
    e
}
fn sphere(sensor: bool) -> ColliderDesc {
    ColliderDesc {
        sensor,
        ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
    }
}
fn body(e: &mut Engine, position: [f32; 3], sensor: bool) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind: if sensor {
                BodyKind::Fixed
            } else {
                BodyKind::Dynamic
            },
            pose: Pose {
                position,
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        sphere(sensor),
        [30.0, 20.0, 0.0],
    )
    .unwrap()
}
fn tick(e: &mut Engine) {
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
}
fn kinds(e: &Engine) -> Vec<u32> {
    e.frame_buffers
        .collision_events
        .iter()
        .map(|event| event.kind)
        .collect()
}
fn pairs(e: &Engine) -> Vec<UnifiedCollisionPair> {
    let mut out = Vec::new();
    e.unified_collision_pairs(&mut out).unwrap();
    out
}
fn collider(e: &Engine, entity: Entity) -> crate::physics3d::ColliderId {
    let runtime = e.unified_physics.as_ref().unwrap();
    runtime
        .physics
        .collider_ids(e.unified_body_id(entity).unwrap())
        .unwrap()
        .next()
        .unwrap()
}

#[test]
fn native_solid_events_use_xyz_contacts_without_world_collider_geometry() {
    let mut e = engine(Space::Spatial, 64);
    let a = body(&mut e, [0.0; 3], false);
    let b = body(&mut e, [0.99, 0.0, 0.0], false);
    tick(&mut e);
    assert_eq!(
        e.frame_buffers.collision_events,
        [CollisionEvent::from_entities(COLLISION_EVENT_ENTER, a, b)]
    );
    assert_eq!(e.physics_counters.collision_solid_pairs, 1);
    assert_eq!(
        pairs(&e),
        [UnifiedCollisionPair {
            a,
            b,
            is_trigger: false
        }]
    );
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_STAY]);
    e.update(0.0);
    assert!(kinds(&e).is_empty());
    e.set_unified_body_pose(
        b,
        Pose {
            position: [0.0, 3.0, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_EXIT]);
    assert!(pairs(&e).is_empty());
}

#[test]
fn compound_fixtures_emit_one_pair_and_last_fixture_exit() {
    let mut e = engine(Space::PlanarXy, 64);
    let a = body(&mut e, [0.0; 3], true);
    let b = body(&mut e, [0.8, 0.0, 0.0], true);
    let id = e.unified_body_id(a).unwrap();
    let first = collider(&e, a);
    let second = e
        .unified_physics
        .as_mut()
        .unwrap()
        .physics
        .add_collider(id, sphere(true))
        .unwrap();
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_ENTER]);
    assert_eq!(pairs(&e).len(), 1);
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .remove_collider(first)
        .unwrap();
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_STAY]);
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .remove_collider(second)
        .unwrap();
    tick(&mut e);
    assert_eq!(
        e.frame_buffers.collision_events,
        [CollisionEvent::from_entities(
            COLLISION_EVENT_TRIGGER_EXIT,
            a,
            b
        )]
    );
}

#[test]
fn solid_and_sensor_channels_on_one_entity_pair_remain_independent() {
    let mut e = engine(Space::PlanarXy, 64);
    let a = body(&mut e, [0.0; 3], false);
    let b = body(&mut e, [0.99, 0.0, 0.0], false);
    let id = e.unified_body_id(a).unwrap();
    let sensor = e
        .unified_physics
        .as_mut()
        .unwrap()
        .physics
        .add_collider(id, sphere(true))
        .unwrap();
    tick(&mut e);
    let mut actual = kinds(&e);
    actual.sort_unstable();
    assert_eq!(
        actual,
        [COLLISION_EVENT_ENTER, COLLISION_EVENT_TRIGGER_ENTER]
    );
    assert_eq!(
        pairs(&e),
        [
            UnifiedCollisionPair {
                a,
                b,
                is_trigger: false
            },
            UnifiedCollisionPair {
                a,
                b,
                is_trigger: true
            }
        ]
    );
    assert_eq!(e.physics_counters.collision_solid_pairs, 1);
    assert_eq!(e.physics_counters.collision_trigger_pairs, 1);
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .remove_collider(sensor)
        .unwrap();
    tick(&mut e);
    let mut actual = kinds(&e);
    actual.sort_unstable();
    assert_eq!(actual, [COLLISION_EVENT_STAY, COLLISION_EVENT_TRIGGER_EXIT]);
}

#[test]
fn removed_body_retains_old_generation_across_slot_reuse_and_manual_pending_events() {
    let mut e = engine(Space::PlanarXy, 64);
    let a = body(&mut e, [0.0; 3], true);
    let old = body(&mut e, [0.8, 0.0, 0.0], true);
    let dt = e.fixed_timestep.config().step_seconds;
    e.step_rigid_bodies(dt); // Unpublished enter.
    e.remove_unified_body(old).unwrap();
    let new = body(&mut e, [10.0, 0.0, 0.0], true);
    assert_eq!(new.id, old.id);
    assert_ne!(new.generation, old.generation);
    tick(&mut e);
    assert_eq!(
        e.frame_buffers.collision_events,
        [
            CollisionEvent::from_entities(COLLISION_EVENT_TRIGGER_ENTER, a, old),
            CollisionEvent::from_entities(COLLISION_EVENT_TRIGGER_EXIT, a, old),
        ]
    );
    assert!(pairs(&e).is_empty());
}

#[test]
fn world_despawn_retires_native_contact_before_forgetting_entity_mapping() {
    let mut e = engine(Space::PlanarXy, 64);
    let a = body(&mut e, [0.0; 3], true);
    let b = body(&mut e, [0.8, 0.0, 0.0], true);
    tick(&mut e);
    e.world.despawn(a);
    tick(&mut e);
    assert_eq!(
        e.frame_buffers.collision_events,
        [CollisionEvent::from_entities(
            COLLISION_EVENT_TRIGGER_EXIT,
            a,
            b
        )]
    );
    assert!(pairs(&e).is_empty());
}

#[test]
fn overflow_recovers_all_active_pairs_and_reports_both_loss_layers() {
    let mut e = engine(Space::PlanarXy, 1);
    let a = body(&mut e, [0.0; 3], true);
    body(&mut e, [0.1, 0.0, 0.0], true);
    body(&mut e, [0.2, 0.0, 0.0], true);
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_ENTER]);
    assert_eq!(pairs(&e).len(), 3);
    let lost = e.unified_collision_event_diagnostics().unwrap();
    assert_eq!(lost.dropped_transitions, 2);
    assert_eq!(lost.dropped_events, 2);
    assert_eq!(e.physics_counters.collision_trigger_pairs, 3);
    e.remove_unified_body(a).unwrap();
    assert_eq!(pairs(&e).len(), 1);
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_EXIT]);
    assert_eq!(pairs(&e).len(), 1);
    assert_eq!(
        e.unified_collision_event_diagnostics()
            .unwrap()
            .dropped_transitions,
        1
    );
}

#[test]
fn max_events_bounds_whole_output_frame_across_fixed_substeps() {
    let mut e = engine(Space::PlanarXy, 1);
    body(&mut e, [0.0; 3], true);
    body(&mut e, [0.8, 0.0, 0.0], true);
    e.update(f64::from(e.fixed_timestep.config().step_seconds) * 3.0);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_ENTER]);
    assert_eq!(e.collision_event_counts.total(), 1);
    assert_eq!(
        e.unified_collision_event_diagnostics()
            .unwrap()
            .dropped_events,
        2
    );
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_STAY]);
    assert_eq!(
        e.unified_collision_event_diagnostics().unwrap(),
        UnifiedCollisionEventDiagnostics::default()
    );
}

#[test]
fn disabled_or_rejected_native_steps_do_not_fabricate_stays() {
    let mut e = engine(Space::PlanarXy, 64);
    let a = body(&mut e, [0.0; 3], true);
    body(&mut e, [0.8, 0.0, 0.0], true);
    tick(&mut e);
    e.auto_rigid_body_step_enabled = false;
    tick(&mut e);
    assert!(kinds(&e).is_empty());
    e.step_rigid_bodies(0.123);
    tick(&mut e);
    assert!(kinds(&e).is_empty());
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::ClockMismatch)
    );
    e.remove_unified_body(a).unwrap();
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_EXIT]);
}

#[test]
fn telemetry_toggle_rebuilds_enters_without_losing_gameplay_pair_state() {
    let mut e = engine(Space::PlanarXy, 64);
    body(&mut e, [0.0; 3], true);
    body(&mut e, [0.8, 0.0, 0.0], true);
    e.set_collision_lifecycle_events_enabled(false);
    tick(&mut e);
    assert!(kinds(&e).is_empty());
    assert_eq!(pairs(&e).len(), 1);
    e.set_collision_lifecycle_events_enabled(true);
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_ENTER]);
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_STAY]);
}

#[test]
fn live_sensor_conversion_ends_old_channel_and_begins_new_channel() {
    let mut e = engine(Space::PlanarXy, 64);
    let a = body(&mut e, [0.0; 3], false);
    let b = body(&mut e, [0.99, 0.0, 0.0], false);
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_ENTER]);
    let id = collider(&e, b);
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .update_collider(id, sphere(true))
        .unwrap();
    tick(&mut e);
    assert_eq!(
        kinds(&e),
        [COLLISION_EVENT_EXIT, COLLISION_EVENT_TRIGGER_ENTER]
    );
    assert_eq!(
        pairs(&e),
        [UnifiedCollisionPair {
            a,
            b,
            is_trigger: true
        }]
    );
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .update_collider(id, sphere(false))
        .unwrap();
    tick(&mut e);
    assert_eq!(
        kinds(&e),
        [COLLISION_EVENT_TRIGGER_EXIT, COLLISION_EVENT_ENTER]
    );
}

#[test]
fn spatial_pickup_uses_native_pairs_even_with_telemetry_off_and_misleading_visuals() {
    for telemetry in [false, true] {
        let mut e = engine(Space::Spatial, 64);
        let actor = body(&mut e, [0.0; 3], true);
        let pickup = body(&mut e, [0.8, 0.0, 0.0], true);
        // Distinct visual offsets cannot affect simulation overlap.
        e.unified_physics
            .as_mut()
            .unwrap()
            .bindings
            .get_mut(&(pickup.id, pickup.generation))
            .unwrap()
            .render_offset = [-30.0, -20.0, 0.0];
        assert!(e.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
        assert!(e.set_gameplay_pickup(pickup.id, pickup.generation, 2, 3, true));
        e.world.add_collision_reaction(
            actor,
            CollisionReaction::Pickup {
                target: CollisionTarget::OtherEntity,
            },
        );
        e.set_collision_lifecycle_events_enabled(telemetry);
        tick(&mut e);
        assert_eq!(
            e.frame_buffers.gameplay_events,
            [GameplayEvent::pickup_collected(actor, pickup, 2, 3, true)]
        );
        assert!(!e.world.is_current_entity(pickup));
        assert_eq!(
            kinds(&e),
            if telemetry {
                vec![COLLISION_EVENT_TRIGGER_ENTER]
            } else {
                vec![]
            }
        );
        tick(&mut e);
        assert_eq!(
            kinds(&e),
            if telemetry {
                vec![COLLISION_EVENT_TRIGGER_EXIT]
            } else {
                vec![]
            }
        );
        assert!(e.frame_buffers.gameplay_events.is_empty());
    }
}

#[test]
fn separated_height_cannot_collect_pickup_with_same_screen_projection() {
    let mut e = engine(Space::Spatial, 64);
    let actor = body(&mut e, [0.0; 3], true);
    let pickup = body(&mut e, [0.0, 3.0, 0.0], true);
    assert!(e.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(e.set_gameplay_pickup(pickup.id, pickup.generation, 2, 3, true));
    e.world.add_collision_reaction(
        actor,
        CollisionReaction::Pickup {
            target: CollisionTarget::OtherEntity,
        },
    );
    tick(&mut e);
    assert_eq!(e.world.transform(actor), e.world.transform(pickup));
    assert!(e.frame_buffers.gameplay_events.is_empty());
    assert!(kinds(&e).is_empty());
    assert!(e.world.is_current_entity(pickup));
}

#[test]
fn native_overflow_does_not_disable_pickup_collection_when_telemetry_is_off() {
    let mut e = engine(Space::PlanarXy, 1);
    let actor = body(&mut e, [0.0; 3], true);
    let decoration = body(&mut e, [0.1, 0.0, 0.0], true);
    let pickup = body(&mut e, [0.2, 0.0, 0.0], true);
    e.set_collision_lifecycle_events_enabled(false);
    assert!(e.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(e.set_gameplay_pickup(pickup.id, pickup.generation, 3, 2, true));
    e.world.add_collision_reaction(
        actor,
        CollisionReaction::Pickup {
            target: CollisionTarget::OtherEntity,
        },
    );
    tick(&mut e);
    assert_eq!(
        e.frame_buffers.gameplay_events,
        [GameplayEvent::pickup_collected(actor, pickup, 3, 2, true)]
    );
    assert!(e.world.is_current_entity(decoration));
    assert!(kinds(&e).is_empty());
    assert_eq!(
        e.unified_collision_event_diagnostics().unwrap(),
        UnifiedCollisionEventDiagnostics::default()
    );
    tick(&mut e);
    assert_eq!(
        pairs(&e),
        [UnifiedCollisionPair {
            a: actor,
            b: decoration,
            is_trigger: true
        }]
    );
}

#[test]
fn manual_transient_overlap_keeps_enter_and_exit_before_automatic_frame_flush() {
    let mut e = engine(Space::Spatial, 64);
    let a = body(&mut e, [0.0; 3], true);
    let b = body(&mut e, [0.8, 0.0, 0.0], true);
    e.auto_rigid_body_step_enabled = false;
    let dt = e.fixed_timestep.config().step_seconds;
    e.step_rigid_bodies(dt);
    e.set_unified_body_pose(
        b,
        Pose {
            position: [0.0, 5.0, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    e.step_rigid_bodies(dt);
    assert!(pairs(&e).is_empty());
    tick(&mut e);
    assert_eq!(
        e.frame_buffers.collision_events,
        [
            CollisionEvent::from_entities(COLLISION_EVENT_TRIGGER_ENTER, a, b),
            CollisionEvent::from_entities(COLLISION_EVENT_TRIGGER_EXIT, a, b)
        ]
    );
    tick(&mut e);
    assert!(kinds(&e).is_empty());
}

#[test]
fn imported_floor_filter_and_query_component_retirement_preserve_native_lifecycle() {
    use crate::components::{CircleCollider, CollisionLayer};
    let mut e = engine(Space::PlanarXy, 64);
    let a = e.world.spawn_entity();
    let b = e.world.spawn_entity();
    for entity in [a, b] {
        e.world
            .set_transform(entity, Transform2D { x: 0.0, y: 0.0 });
        e.world
            .set_circle_collider(entity, CircleCollider::new(0.5, true, CollisionLayer::Wall));
        e.world.set_height_span(
            entity,
            HeightSpan::new(PhysicsFloorId(entity.id), 0.0, 1.0).unwrap(),
        );
    }
    tick(&mut e);
    assert!(kinds(&e).is_empty());
    e.world
        .set_height_span(b, HeightSpan::new(PhysicsFloorId(a.id), 0.0, 1.0).unwrap());
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_ENTER]);
    e.world.clear_collider(a);
    assert_eq!(e.query_point_bodies(0.0, 0.0, u32::MAX), 1);
    assert!(pairs(&e).is_empty());
    // A query captures the removal but cannot publish, duplicate, or clear the frame.
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_ENTER]);
    e.auto_rigid_body_step_enabled = false;
    tick(&mut e);
    assert_eq!(
        e.frame_buffers.collision_events,
        [CollisionEvent::from_entities(
            COLLISION_EVENT_TRIGGER_EXIT,
            a,
            b
        )]
    );
    assert!(e.world.is_current_entity(a));
}

#[test]
fn imported_pickup_uses_same_native_contacts_as_public_trigger_events() {
    use crate::components::{CircleCollider, CollisionLayer};
    let mut e = engine(Space::PlanarXy, 64);
    let actor = e.world.spawn_entity();
    let pickup = e.world.spawn_entity();
    for entity in [actor, pickup] {
        e.world
            .set_transform(entity, Transform2D { x: 0.0, y: 0.0 });
        e.world
            .set_circle_collider(entity, CircleCollider::new(0.5, true, CollisionLayer::Wall));
    }
    assert!(e.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(e.set_gameplay_pickup(pickup.id, pickup.generation, 2, 1, true));
    e.world.add_collision_reaction(
        actor,
        CollisionReaction::Pickup {
            target: CollisionTarget::OtherEntity,
        },
    );
    tick(&mut e);
    assert_eq!(
        e.frame_buffers.gameplay_events,
        [GameplayEvent::pickup_collected(actor, pickup, 2, 1, true)]
    );
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_ENTER]);
    tick(&mut e);
    assert_eq!(kinds(&e), [COLLISION_EVENT_TRIGGER_EXIT]);
    assert!(pairs(&e).is_empty());
}
