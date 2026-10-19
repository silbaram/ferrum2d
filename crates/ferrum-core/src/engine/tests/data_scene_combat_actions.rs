use super::{
    data_scene_combat_navigation::enemy,
    data_scene_visuals::sprite,
    spatial_navigation::{pose, setup},
    *,
};
use crate::components::{CompoundCollider, CompoundColliderShape};

fn activate(e: &mut Engine, actor: Entity) {
    assert!(e.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
}
fn click(e: &mut Engine, down: bool) {
    e.set_input(false, false, false, false, false, false, down, -1., -1.);
}
fn input_binding(e: &mut Engine, action: u32) {
    assert!(e.set_input_action_binding(
        action,
        0,
        crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    ));
}
fn wall(e: &mut Engine, x: f32, y: f32) -> Entity {
    let w = sprite(e, 73, x, y, 0);
    e.world
        .set_aabb_collider(w, AabbCollider::new(1., 8., false, CollisionLayer::Wall));
    e.world
        .set_collision_filter(w, CollisionFilter::from_layer(CollisionLayer::Wall));
    e.world
        .set_height_span(w, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
    w
}

#[test]
fn combat_actions_melee_input_respects_height_mutual_masks_wall_and_cooldown() {
    let (mut e, actor) = setup(false);
    let visible = enemy(&mut e, 8., 16., true);
    let upper = enemy(&mut e, 8., 16., true);
    let filtered = enemy(&mut e, 0., 24., true);
    let blocked = enemy(&mut e, -12., 16., true);
    for target in [visible, upper, filtered, blocked] {
        e.world.clear_movement_pattern(target);
        assert!(e.set_gameplay_health(target.id, target.generation, 5.));
    }
    e.world
        .set_height_span(upper, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
    e.world.set_collision_filter(
        filtered,
        CollisionFilter {
            category: CollisionMask::ENEMY,
            mask: CollisionMask::NONE,
        },
    );
    wall(&mut e, -6., 16.);
    assert!(e.set_gameplay_action_melee(actor.id, actor.generation, 77, 0.5, 32., 2.));
    input_binding(&mut e, 77);
    activate(&mut e, actor);
    click(&mut e, true);
    e.update(1. / 60.);
    assert_eq!(e.world.health(visible), Some(3.));
    for target in [upper, filtered, blocked] {
        assert_eq!(e.world.health(target), Some(5.));
    }
    e.update(0.1);
    assert_eq!(
        e.world.health(visible),
        Some(3.),
        "held pressed input repeated"
    );
    click(&mut e, false);
    e.update(0.6);
    click(&mut e, true);
    e.update(0.01);
    assert_eq!(e.world.health(visible), Some(1.));
    assert_eq!(e.data_scene_combat_stats()[5], 2);
}

#[test]
fn combat_actions_melee_on_spatial_ground_does_not_treat_the_floor_as_an_occluder() {
    let (mut e, actor) = setup(false);
    let target = enemy(&mut e, 8., 16., true);
    e.world.clear_movement_pattern(target);
    assert!(e.set_gameplay_health(target.id, target.generation, 2.));
    assert!(e.set_gameplay_action_melee(actor.id, actor.generation, 77, 0., 24., 2.));
    input_binding(&mut e, 77);
    activate(&mut e, actor);
    click(&mut e, true);
    e.update(1. / 60.);
    assert!(!e.world.is_current_entity(target));
    assert_eq!(e.data_scene_combat_stats()[6], 1);
    assert!(e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE
            && v.actor_id == target.id
            && v.source_id == actor.id));
}

#[test]
fn combat_actions_timer_melee_repeats_and_pause_discards_input_edges() {
    let (mut e, actor) = setup(false);
    let source = enemy(&mut e, 8., 16., true);
    e.world.clear_movement_pattern(source);
    assert!(e.set_gameplay_health(actor.id, actor.generation, 10.));
    assert!(e.set_gameplay_action_melee_with_target(
        source.id,
        source.generation,
        78,
        0.,
        24.,
        2.,
        1
    ));
    assert!(e.set_gameplay_timer_action_trigger(source.id, source.generation, 9, 0.1, 78));
    assert!(e.set_gameplay_health(source.id, source.generation, 5.));
    assert!(e.set_gameplay_action_melee(actor.id, actor.generation, 77, 0., 24., 1.));
    input_binding(&mut e, 77);
    activate(&mut e, actor);
    e.update(0.11);
    assert_eq!(e.world.health(actor), Some(8.));
    e.update(0.11);
    assert_eq!(e.world.health(actor), Some(6.));
    assert!(e.pause_data_scene());
    click(&mut e, true);
    e.update(5.);
    click(&mut e, false);
    e.update(5.);
    assert_eq!(e.world.health(actor), Some(6.));
    assert!(e.resume_data_scene());
    e.update(0.11);
    assert_eq!(e.world.health(actor), Some(4.));
    assert_eq!(
        e.world.health(source),
        Some(5.),
        "paused attack leaked after resume"
    );
}

#[test]
fn combat_actions_keyboard_dash_crosses_real_ramp_gateway_both_ways_and_preserves_intent() {
    let (mut e, actor) = setup(true);
    assert!(e.set_gameplay_action_dash(actor.id, actor.generation, 77, 0., 64.));
    input_binding(&mut e, 77);
    activate(&mut e, actor);
    e.set_input(false, false, true, false, false, false, true, -1., -1.);
    e.update(1. / 120.);
    let up = pose(&e, actor);
    assert!(up.1 >= 80. && up.2 == 1 && up.3 == 32., "{up:?}");
    click(&mut e, false);
    e.update(1. / 120.);
    e.set_input(true, false, false, false, false, false, true, -1., -1.);
    e.update(1. / 120.);
    let down = pose(&e, actor);
    assert!(down.1 <= 16.01 && down.2 == 0 && down.3 == 0., "{down:?}");
    assert_eq!(e.world.velocity(actor), Some(Velocity::default()));
}

#[test]
fn combat_actions_timer_dash_cannot_teleport_through_walls_or_onto_unconnected_floor() {
    let (mut e, actor) = setup(true);
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    e.world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
    let source = enemy(&mut e, 0., 16., true);
    e.world.clear_movement_pattern(source);
    assert!(e.set_gameplay_action_dash_with_aim(source.id, source.generation, 77, 0., 64., 1));
    assert!(e.set_gameplay_timer_action_trigger(source.id, source.generation, 9, 0.01, 77));
    assert!(e.spatial_scene.configure_connections(&[]));
    activate(&mut e, actor);
    e.update(0.02);
    assert_eq!(pose(&e, source).2, 0, "dash invented a floor gateway");

    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 48., y: 16. });
    let source = enemy(&mut e, 0., 16., true);
    e.world.clear_movement_pattern(source);
    wall(&mut e, 16., 16.);
    assert!(e.set_gameplay_action_dash_with_aim(source.id, source.generation, 77, 1., 48., 1));
    assert!(e.set_gameplay_timer_action_trigger(source.id, source.generation, 9, 0.01, 77));
    activate(&mut e, actor);
    e.update(0.02);
    let p = pose(&e, source);
    assert!(p.0 > 0. && p.0 <= 13.001, "{p:?}");
    assert!(
        e.world
            .action_binding(source, 77)
            .unwrap()
            .cooldown
            .remaining_seconds
            > 0.
    );
}

#[test]
fn combat_actions_flat_dash_sweeps_world_walls_and_respects_the_body_height() {
    for upper in [false, true] {
        let mut e = Engine::new();
        e.use_data_scene();
        let actor = sprite(&mut e, 72, 0., 16., 0);
        let source = sprite(&mut e, 73, -24., 16., 0);
        for a in [actor, source] {
            e.world
                .set_aabb_collider(a, AabbCollider::new(2., 2., true, CollisionLayer::Player));
            e.world
                .set_collision_filter(a, CollisionFilter::from_layer(CollisionLayer::Player));
            assert!(e.configure_data_scene_body(a.id, a.generation, 1, true, 0, 0., 8.));
        }
        let w = wall(&mut e, -12., 16.);
        if upper {
            e.world
                .set_height_span(w, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
        }
        assert!(e.set_gameplay_action_dash_with_aim(source.id, source.generation, 77, 1., 48., 1));
        assert!(e.set_gameplay_timer_action_trigger(source.id, source.generation, 9, 0.01, 77));
        activate(&mut e, actor);
        e.update(0.02);
        let x = e.world.transform(source).unwrap().x;
        assert!(
            if upper {
                (x - 24.).abs() < 0.01
            } else {
                x > -24. && x <= -14.999
            },
            "upper={upper} x={x}"
        );
    }
}

#[test]
fn combat_actions_flat_dash_cannot_skip_an_intermediate_high_tile_or_missing_support() {
    for middle in [0, 2] {
        let mut e = Engine::new();
        e.use_data_scene();
        let actor = sprite(&mut e, 72, 40., 8., 0);
        let source = sprite(&mut e, 73, 8., 8., 0);
        for entity in [actor, source] {
            e.world.set_aabb_collider(
                entity,
                AabbCollider::new(2., 2., true, CollisionLayer::Player),
            );
            assert!(e.configure_data_scene_body(entity.id, entity.generation, 1, true, 0, 0., 8.));
        }
        for id in [1, 2] {
            e.tilemap
                .set_tile_definition(id, 1, 0., 0., 1., 1., 1., 1., 1., 1.);
            assert!(e.tilemap.set_tile_height_span_definition(
                id,
                0,
                if id == 1 { 0. } else { 64. },
                1.
            ));
            assert!(e
                .tilemap
                .set_tile_hd2d_definition(id, 0, false, false, false, 0., false, 0, 0., 0.));
        }
        e.tilemap
            .set_layer(0, 3, 1, 16., 16., 0., 0., true, vec![1, middle, 1]);
        assert!(e.set_gameplay_action_dash_with_aim(source.id, source.generation, 77, 1., 32., 1));
        assert!(e.set_gameplay_timer_action_trigger(source.id, source.generation, 9, 0.01, 77));
        activate(&mut e, actor);
        e.update(0.02);
        let p = e.world.transform(source).unwrap();
        assert!(p.x >= 8. && p.x < 16., "middle={middle} pose={p:?}");
        assert_eq!(e.world.height_span(source).unwrap().elevation, 0.);
    }
}

#[test]
fn combat_actions_diagonal_dash_visits_brief_tile_corner_crossings_in_both_directions() {
    for middle in [0, 2] {
        for (reverse, offset_x) in [(false, 0.), (true, 0.), (false, 4.), (true, 4.)] {
            let mut e = Engine::new();
            e.use_data_scene();
            let (start, end) = if reverse {
                ((24.5, 24.4), (8.5, 8.4))
            } else {
                ((8.5, 8.4), (24.5, 24.4))
            };
            let actor = sprite(&mut e, 72, end.0 - offset_x, end.1, 0);
            let source = sprite(&mut e, 73, start.0 - offset_x, start.1, 0);
            for entity in [actor, source] {
                e.world.set_aabb_collider(
                    entity,
                    AabbCollider::new(0.01, 0.01, true, CollisionLayer::Player)
                        .with_offset(offset_x, 0.),
                );
                assert!(e.configure_data_scene_body(
                    entity.id,
                    entity.generation,
                    1,
                    true,
                    0,
                    0.,
                    8.
                ));
            }
            for id in [1, 2] {
                e.tilemap
                    .set_tile_definition(id, 1, 0., 0., 1., 1., 1., 1., 1., 1.);
                assert!(e.tilemap.set_tile_height_span_definition(
                    id,
                    0,
                    if id == 1 { 0. } else { 64. },
                    1.
                ));
                assert!(e
                    .tilemap
                    .set_tile_hd2d_definition(id, 0, false, false, false, 0., false, 0, 0., 0.));
            }
            e.tilemap
                .set_layer(0, 2, 2, 16., 16., 0., 0., true, vec![1, middle, 1, 1]);
            assert!(e.set_gameplay_action_dash_with_aim(
                source.id,
                source.generation,
                77,
                1.,
                16_f32.hypot(16.),
                1
            ));
            assert!(e.set_gameplay_timer_action_trigger(source.id, source.generation, 9, 0.01, 77));
            activate(&mut e, actor);
            e.update(0.02);
            let p = e.world.transform(source).unwrap();
            assert!(
                if reverse {
                    p.y >= 16.
                } else {
                    p.x + offset_x < 16.
                },
                "middle={middle} reverse={reverse} offset={offset_x} pose={p:?}"
            );
            assert_eq!(e.world.height_span(source).unwrap().elevation, 0.);
        }
    }
}

#[test]
fn combat_actions_melee_damages_all_admitted_targets_instead_of_truncating_at_32() {
    let (mut e, actor) = setup(false);
    let targets: Vec<_> = (0..64)
        .map(|_| {
            let target = enemy(&mut e, 8., 16., true);
            e.world.clear_movement_pattern(target);
            assert!(e.set_gameplay_health(target.id, target.generation, 1.));
            target
        })
        .collect();
    assert!(e.set_gameplay_action_melee(actor.id, actor.generation, 77, 1., 24., 1.));
    input_binding(&mut e, 77);
    activate(&mut e, actor);
    click(&mut e, true);
    e.update(1. / 60.);
    assert!(targets
        .iter()
        .all(|&target| !e.world.is_current_entity(target)));
    assert_eq!(e.data_scene_combat_stats()[6], 64);
}

#[test]
fn combat_actions_melee_filters_the_actual_overlapping_compound_and_keeps_unhealth_objects_immutable(
) {
    let (mut e, actor) = setup(false);
    let target = enemy(&mut e, 8., 16., true);
    e.world.clear_movement_pattern(target);
    assert!(e.set_gameplay_health(target.id, target.generation, 5.));
    e.world.set_collision_filter(
        target,
        CollisionFilter {
            category: CollisionMask::ENEMY,
            mask: CollisionMask::NONE,
        },
    );
    e.world.add_compound_collider(
        target,
        CompoundCollider::new(CompoundColliderShape::Aabb(
            AabbCollider::new(2., 2., true, CollisionLayer::Enemy).with_offset(100., 0.),
        ))
        .with_filter(CollisionFilter::from_layer(CollisionLayer::Enemy)),
    );
    let decor = enemy(&mut e, 4., 16., true);
    e.world.clear_movement_pattern(decor);
    assert!(e.set_gameplay_action_melee(actor.id, actor.generation, 77, 1., 24., 1.));
    input_binding(&mut e, 77);
    activate(&mut e, actor);
    click(&mut e, true);
    e.update(1. / 60.);
    assert_eq!(e.world.health(target), Some(5.));
    assert_eq!(e.world.health(decor), None);
    assert_eq!(e.data_scene_combat_stats()[5], 0);
}

#[test]
fn combat_actions_melee_sight_uses_the_selected_collider_center_including_its_offset() {
    let (mut e, actor) = setup(false);
    let target = enemy(&mut e, 100., 16., true);
    e.world.clear_movement_pattern(target);
    e.world.set_aabb_collider(
        target,
        AabbCollider::new(2., 2., true, CollisionLayer::Enemy).with_offset(-92., 0.),
    );
    assert!(e.set_gameplay_health(target.id, target.generation, 5.));
    wall(&mut e, 40., 16.); // Behind the collider, in front of the unrelated visual pivot.
    assert!(e.set_gameplay_action_melee(actor.id, actor.generation, 77, 1., 24., 1.));
    input_binding(&mut e, 77);
    activate(&mut e, actor);
    click(&mut e, true);
    e.update(1. / 60.);
    assert_eq!(e.world.health(target), Some(4.));
}

fn checkpoint_scene(e: &mut Engine) -> (Entity, Entity, Vec<u32>) {
    e.use_data_scene();
    let actor = sprite(e, 72, 0., 16., 0);
    let source = enemy(e, 32., 16., true);
    e.world.clear_movement_pattern(source);
    assert!(e.configure_data_scene_body(actor.id, actor.generation, 1, true, 0, 0., 8.));
    assert!(e.set_gameplay_health(actor.id, actor.generation, 10.));
    assert!(e.set_gameplay_health(source.id, source.generation, 10.));
    assert!(e.set_gameplay_action_melee(actor.id, actor.generation, 77, 0.5, 48., 2.));
    assert!(e.set_gameplay_action_dash_with_aim(source.id, source.generation, 78, 1., 16., 1));
    assert!(e.set_gameplay_timer_action_trigger(source.id, source.generation, 9, 0.1, 78));
    input_binding(e, 77);
    activate(e, actor);
    (
        actor,
        source,
        vec![actor.id, actor.generation, source.id, source.generation],
    )
}

#[test]
fn combat_actions_checkpoint_restores_melee_health_dash_pose_and_both_cooldowns_with_fresh_handles()
{
    let mut e = Engine::new();
    let (actor, source, handles) = checkpoint_scene(&mut e);
    click(&mut e, true);
    e.update(0.11);
    assert_eq!(e.world.health(source), Some(8.));
    let before = e.world.transform(source).unwrap();
    assert!((before.x - 16.).abs() < 0.001);
    let epoch = e.data_scene_epoch();
    let flags = e.capture_data_scene_progress(epoch, &handles);
    let combat = e.capture_data_scene_combat_progress(epoch, &handles);
    let animations = e.capture_data_scene_animation_progress(epoch, &handles);
    let spatial = e.capture_data_scene_spatial_progress(epoch, &handles);
    let rotations = e.capture_data_scene_spatial_rotations(epoch, &handles);
    assert!(!combat.is_empty());
    assert!(e.preflight_data_scene_combat_progress(&flags, &combat));
    let mut next = Engine::new();
    next.use_data_scene(); // Retire generations before applying the fresh scene.
    let _ = sprite(&mut next, 74, 0., 0., 0);
    let (next_actor, next_source, next_handles) = checkpoint_scene(&mut next);
    assert_ne!(actor, next_actor);
    assert!(next.restore_data_scene_progress_with_combat(
        next.data_scene_epoch(),
        &next_handles,
        &flags,
        &animations,
        &spatial,
        &[],
        &rotations,
        false,
        &combat
    ));
    assert_eq!(next.world.transform(next_source), Some(before));
    assert_eq!(next.world.health(next_source), Some(8.));
    for (old, new, action) in [(actor, next_actor, 77), (source, next_source, 78)] {
        assert_eq!(
            next.world.action_binding(new, action).unwrap().cooldown,
            e.world.action_binding(old, action).unwrap().cooldown
        );
    }
    next.update(0.11);
    assert_eq!(
        next.world.transform(next_source),
        Some(before),
        "restored dash cooldown was lost"
    );
    assert_eq!(
        next.world.health(next_source),
        Some(8.),
        "restored input edge repeated melee"
    );
    next.update(1.);
    assert!(
        next.world.transform(next_source).unwrap().x < before.x,
        "timer dash did not continue after restore"
    );
}
