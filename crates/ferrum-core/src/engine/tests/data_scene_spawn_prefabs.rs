use super::{
    data_scene_combat_navigation::enemy,
    data_scene_visuals::sprite,
    spatial_navigation::{pose, setup},
    *,
};

fn bind(e: &mut Engine, actor: Entity, offset: f32) {
    assert!(e.set_gameplay_action_spawn_prefab(
        actor.id,
        actor.generation,
        77,
        0.,
        1,
        0,
        0,
        offset,
        0.
    ));
    assert!(e.set_input_action_binding(
        77,
        0,
        crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    ));
}
fn configure(e: &mut Engine, actor: Entity, prototype: Entity) -> bool {
    e.configure_data_scene_gameplay_v7(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        0,
        &[1, prototype.id, prototype.generation],
    )
}
fn click(e: &mut Engine, down: bool, delta: f32) {
    e.set_input(false, false, false, false, false, false, down, -1., -1.);
    e.update(f64::from(delta));
}
fn actors(e: &Engine) -> Vec<Entity> {
    let values = e.data_scene_spawned_actor_handles();
    assert_eq!(values[0], 1);
    assert_eq!(values.len(), 3 + values[2] as usize * 5);
    values[3..]
        .chunks_exact(5)
        .filter(|v| v[4] == 1)
        .map(|v| Entity {
            id: v[2],
            generation: v[3],
        })
        .collect()
}
fn wall(e: &mut Engine, floor: u32, elevation: f32) {
    let entity = sprite(e, 71, 12., 80., 0);
    e.world.set_aabb_collider(
        entity,
        AabbCollider::new(3., 3., false, CollisionLayer::Wall),
    );
    e.world
        .set_collision_filter(entity, CollisionFilter::from_layer(CollisionLayer::Wall));
    e.world.set_height_span(
        entity,
        HeightSpan::new(PhysicsFloorId(floor), elevation, 8.).unwrap(),
    );
}

#[test]
fn spawn_prefabs_inherit_native_combat_and_projectile_catalog_after_prototype_dies() {
    let (mut e, actor) = setup(false);
    let prototype = enemy(&mut e, 24., 16., true);
    assert!(e.set_gameplay_health(prototype.id, prototype.generation, 3.));
    e.world
        .set_gameplay_faction(prototype, GameplayFaction::new(2, u32::MAX).unwrap());
    e.world
        .set_gameplay_tags(prototype, GameplayTags::new(1 << 7).unwrap());
    assert!(e.set_gameplay_action_projectile_with_target(
        prototype.id,
        prototype.generation,
        78,
        0.2,
        120.,
        1.,
        0.5,
        1,
        1,
        0
    ));
    assert!(e.set_gameplay_timer_action_trigger(prototype.id, prototype.generation, 9, 0.05, 78));
    assert!(e.configure_spatial_billboards(
        &[
            actor.id,
            actor.generation,
            prototype.id,
            prototype.generation
        ],
        &[1., 0.5, 0., 1., 0.3, 2.]
    ));
    bind(&mut e, actor, 12.);
    assert!(e.configure_data_scene_gameplay_v7(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[1, 99],
        &[8., 8., 0., 0., 1., 1., 2., 2., 1., 0.1, 0., 1., 1., 1., 1.],
        &[prototype.id, prototype.generation, 78, 1],
        &[],
        &[],
        &[],
        0,
        &[1, prototype.id, prototype.generation]
    ));
    e.world.despawn(prototype);
    click(&mut e, true, 0.001);
    let child = actors(&e)[0];
    assert_ne!(child, prototype);
    assert_eq!(e.world.health(child), Some(3.));
    assert_eq!(e.world.gameplay_faction(child).unwrap().faction_id, 2);
    assert!(e
        .world
        .gameplay_faction_query_indices(2)
        .contains(&(child.id as usize)));
    assert!(e
        .world
        .gameplay_tag_query_indices(7)
        .contains(&(child.id as usize)));
    assert!(!e.world.is_primary_actor_entity(child));
    assert!(e.world.action_binding(child, 78).is_some());
    assert!(e.world.gameplay_timer_trigger(child).is_some());
    let before = e.world.transform(child).unwrap();
    for _ in 0..6 {
        click(&mut e, false, 0.01);
    }
    assert!(
        e.world.transform(child).unwrap().x < before.x,
        "clone did not execute movement"
    );
    assert!(
        e.world.alive_indices().iter().any(|&i| e
            .world
            .sprite_at_index(i)
            .is_some_and(|s| s.texture_id == 99)),
        "clone lost its projectile-prefab binding"
    );
    assert!(e
        .spatial_scene
        .runtime_billboards
        .iter()
        .any(|(entity, _)| *entity == child));
    assert_eq!(e.data_scene_spawned_actor_handles()[1], 1);
}

#[test]
fn spawn_prefabs_place_on_source_floor_block_walls_and_missing_support_without_cooldown() {
    let (mut e, actor) = setup(true);
    let prototype = enemy(&mut e, 0., 16., true);
    e.world.clear_movement_pattern(prototype);
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    e.world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
    wall(&mut e, 0, 0.);
    bind(&mut e, actor, 12.);
    assert!(configure(&mut e, actor, prototype));
    click(&mut e, true, 0.001);
    let child = actors(&e)[0];
    assert_eq!(pose(&e, child), (12., 80., 1, 32.));
    wall(&mut e, 1, 32.);
    click(&mut e, false, 0.001);
    click(&mut e, true, 0.001);
    assert_eq!(actors(&e), [child]);
    assert_eq!(
        e.world
            .action_binding(actor, 77)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.
    );
    assert_eq!(
        e.data_scene_spawned_actor_handles()[1],
        1,
        "blocked birth consumed a serial"
    );
    bind(&mut e, actor, 48.);
    click(&mut e, false, 0.001);
    click(&mut e, true, 0.001);
    assert_eq!(
        actors(&e),
        [child],
        "upper-floor actor spawned without support"
    );
    assert!(!e.configure_data_scene_gameplay_v2(true, child.id, child.generation, 0, true));
    assert!(
        e.world.is_current_entity(child),
        "failed reconfiguration retired a live actor"
    );
    assert!(configure(&mut e, actor, prototype));
    assert!(!e.world.is_current_entity(child));
    assert_eq!(e.data_scene_spawned_actor_handles(), [1, 0, 0]);
}

#[test]
fn spawn_prefabs_share_atlas_definitions_but_keep_independent_playback_and_generations() {
    let (mut e, actor) = setup(false);
    let prototype = enemy(&mut e, 24., 16., true);
    e.world.clear_movement_pattern(prototype);
    assert!(e.configure_data_scene_sprite_clips(
        prototype.id,
        prototype.generation,
        &[1., 2., 10., 1.],
        &[0., 0., 0.5, 1., 0.5, 0., 1., 1.],
        1
    ));
    bind(&mut e, actor, 12.);
    assert!(configure(&mut e, actor, prototype));
    click(&mut e, true, 0.01);
    let first = actors(&e)[0];
    click(&mut e, false, 0.02);
    click(&mut e, true, 0.01);
    let second = actors(&e)[1];
    let a = e.world.sprite_playbacks[first.id as usize]
        .as_ref()
        .unwrap();
    let b = e.world.sprite_playbacks[second.id as usize]
        .as_ref()
        .unwrap();
    assert!(std::sync::Arc::ptr_eq(&a.clips, &b.clips));
    assert!(a.elapsed > b.elapsed);
    e.world.sprite_playbacks[first.id as usize]
        .as_mut()
        .unwrap()
        .paused = true;
    let before = e.world.sprite_playbacks[first.id as usize]
        .as_ref()
        .unwrap()
        .elapsed;
    click(&mut e, false, 0.02);
    assert_eq!(
        e.world.sprite_playbacks[first.id as usize]
            .as_ref()
            .unwrap()
            .elapsed,
        before
    );
    assert!(
        e.world.sprite_playbacks[second.id as usize]
            .as_ref()
            .unwrap()
            .elapsed
            > 0.01
    );
    e.world.despawn(first);
    click(&mut e, true, 0.01);
    let third = *actors(&e).last().unwrap();
    assert_eq!(first.id, third.id);
    assert_ne!(first.generation, third.generation);
    assert!(e.world.is_current_entity(third));
    assert_eq!(actors(&e).len(), 2);
}

#[test]
fn spawn_prefabs_reject_invalid_catalog_atomically_and_keep_primary_marker_unique() {
    let (mut e, actor) = setup(false);
    bind(&mut e, actor, 12.);
    assert!(configure(&mut e, actor, actor));
    click(&mut e, true, 0.001);
    let child = actors(&e)[0];
    assert_eq!(e.world.primary_actor_entity(), Some(actor));
    assert_eq!(e.world.gameplay_tag_query_indices(0), [actor.id as usize]);
    assert!(e.world.gameplay_tags(child).is_none());
    assert!(!e.configure_data_scene_gameplay_v7(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        0,
        &[2, actor.id, actor.generation]
    ));
    assert!(e.world.is_current_entity(child));
    assert!(
        !configure(&mut e, actor, child),
        "runtime generation became an authored prototype"
    );
    assert!(e.world.is_current_entity(child));
    assert_eq!(actors(&e), [child]);
}

#[test]
fn spawn_prefabs_use_offset_circle_support_instead_of_the_visual_pivot() {
    let (mut e, actor) = setup(false);
    let prototype = enemy(&mut e, 24., 16., true);
    e.world.clear_movement_pattern(prototype);
    e.world.set_circle_collider(
        prototype,
        crate::components::CircleCollider::new(1., true, CollisionLayer::Enemy)
            .with_offset(10., 0.),
    );
    bind(&mut e, actor, 60.);
    assert!(configure(&mut e, actor, prototype));
    let before = e.world.alive_count();
    click(&mut e, true, 0.001);
    assert!(actors(&e).is_empty());
    assert_eq!(e.world.alive_count(), before);
    assert_eq!(
        e.world
            .action_binding(actor, 77)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.
    );
}

mod checkpoint;

fn shadows() -> Vec<f32> {
    let mut values = vec![0.; 80];
    values[0..8].copy_from_slice(&[1., 1., 0., 128., 0.05, 0.15, 0.15, 0.15]);
    values[12..20].copy_from_slice(&[0., 64., 0., 200., 1., 1., 1., 2.]);
    values[60..76].copy_from_slice(&[
        100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
    ]);
    values
}

#[test]
fn spawn_prefabs_share_shadow_caster_and_texture_budgets_without_consuming_serial_or_cooldown() {
    for caster_limit in [false, true] {
        let (mut e, actor) = setup(false);
        let prototype = enemy(&mut e, 24., 16., true);
        e.world.clear_movement_pattern(prototype);
        let mut handles = vec![
            actor.id,
            actor.generation,
            prototype.id,
            prototype.generation,
        ];
        for i in 0..if caster_limit { 1022 } else { 62 } {
            let filler = sprite(
                &mut e,
                if caster_limit { 71 } else { 100 + i },
                1000. + i as f32 * 24.,
                1000.,
                0,
            );
            handles.extend([filler.id, filler.generation]);
        }
        let styles: Vec<_> = (0..handles.len() / 2).flat_map(|_| [1., 0.5, 0.]).collect();
        assert!(e.configure_spatial_billboards(&handles, &styles));
        bind(&mut e, actor, 12.);
        assert!(configure(&mut e, actor, prototype));
        if !caster_limit {
            e.world.despawn(prototype);
        }
        assert!(e.configure_spatial_environment(&shadows()));
        let before = e.world.alive_count();
        click(&mut e, true, 0.001);
        assert!(
            actors(&e).is_empty(),
            "shadow budget overflow was silently rendered"
        );
        assert_eq!(e.world.alive_count(), before);
        assert_eq!(e.data_scene_spawned_actor_handles(), [1, 0, 0]);
        assert_eq!(
            e.world
                .action_binding(actor, 77)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.
        );
        assert!(e.spatial_scene.runtime_billboards.is_empty());
    }
}

#[test]
fn spawn_prefabs_default_projectiles_keep_the_spawned_source_billboard_style() {
    let (mut e, actor) = setup(false);
    let prototype = enemy(&mut e, 24., 16., true);
    e.world.clear_movement_pattern(prototype);
    assert!(e.set_gameplay_action_projectile_with_target(
        prototype.id,
        prototype.generation,
        78,
        0.2,
        20.,
        1.,
        1.,
        1,
        1,
        0
    ));
    assert!(e.set_gameplay_timer_action_trigger(prototype.id, prototype.generation, 9, 0.03, 78));
    assert!(e.configure_spatial_billboards(
        &[
            actor.id,
            actor.generation,
            prototype.id,
            prototype.generation
        ],
        &[1., 0.5, 0., 0.75, 0.3, 2.]
    ));
    bind(&mut e, actor, 12.);
    assert!(configure(&mut e, actor, prototype));
    e.world.despawn(prototype);
    click(&mut e, true, 0.001);
    for _ in 0..5 {
        click(&mut e, false, 0.01);
    }
    let shot = find_layer(&e, CollisionLayer::Bullet);
    let style = e
        .spatial_scene
        .runtime_billboards
        .iter()
        .find(|(entity, _)| *entity == shot)
        .unwrap()
        .1;
    assert_eq!(
        (style.units_per_pixel, style.cutoff, style.elevation),
        (0.75, 0.3, 2.)
    );
}

#[test]
fn spawn_prefabs_inherit_chase_stop_distance_and_respect_the_shared_navigation_capacity() {
    let (mut e, actor) = setup(false);
    let prototype = enemy(&mut e, 32., 16., true);
    bind(&mut e, actor, 12.);
    assert!(e.configure_data_scene_gameplay_v7(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.05, 0., 2., -1.],
        &[prototype.id, prototype.generation],
        &[8.],
        0,
        &[1, prototype.id, prototype.generation]
    ));
    click(&mut e, true, 0.001);
    let child = actors(&e)[0];
    click(&mut e, false, 0.001);
    click(&mut e, true, 0.001);
    assert_eq!(actors(&e), [child], "birth exceeded maxAgents");
    assert_eq!(e.data_scene_spawned_actor_handles()[1], 1);
    for _ in 0..180 {
        click(&mut e, false, 1. / 60.);
    }
    let at = e.world.transform(child).unwrap();
    assert!(
        (at.x.hypot(at.y - 16.) - 8.).abs() < 0.01,
        "clone lost authored stopDistance: {at:?}"
    );
    assert!(e.data_scene_combat_navigation_stats()[2] <= 2);
}

#[test]
fn spawn_prefabs_keep_sparse_semantic_ids_through_native_events_and_checkpoints() {
    for prefab in [42, u32::MAX] {
        let (mut e, actor) = setup(false);
        let prototype = enemy(&mut e, 24., 16., true);
        e.world.clear_movement_pattern(prototype);
        bind(&mut e, actor, 12.);
        assert!(e.set_gameplay_action_spawn_prefab(
            actor.id,
            actor.generation,
            77,
            0.,
            prefab,
            0,
            0,
            12.,
            0.
        ));
        assert!(e.configure_data_scene_gameplay_v7(
            true,
            actor.id,
            actor.generation,
            0,
            true,
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            0,
            &[prefab, prototype.id, prototype.generation]
        ));
        click(&mut e, true, 0.001);
        assert_eq!(actors(&e).len(), 1);
        assert_eq!(e.data_scene_spawned_actor_handles()[4], prefab);
        let saved = e.capture_data_scene_combat_progress(
            e.data_scene_epoch(),
            &[
                actor.id,
                actor.generation,
                prototype.id,
                prototype.generation,
            ],
        );
        assert!(!saved.is_empty());
        assert_eq!(saved[6 + 2 * 72 + 1], prefab as f64);
        let events =
            unsafe { std::slice::from_raw_parts(e.gameplay_event_ptr(), e.gameplay_event_len()) };
        assert!(events.iter().any(|event| event.kind
            == crate::gameplay_event::GAMEPLAY_EVENT_PREFAB_SPAWNED
            && event.token_id == prefab));
    }
}

#[test]
fn spawn_prefabs_reconfiguration_cannot_capture_a_target_that_the_new_catalog_will_retire() {
    let (mut e, actor) = setup(false);
    let prototype = enemy(&mut e, 24., 16., true);
    bind(&mut e, actor, 12.);
    assert!(configure(&mut e, actor, prototype));
    click(&mut e, true, 0.001);
    let child = actors(&e)[0];
    assert!(e.set_gameplay_movement_chase_entity(
        prototype.id,
        prototype.generation,
        child.id,
        child.generation,
        8.
    ));
    assert!(!configure(&mut e, actor, prototype));
    assert_eq!(actors(&e), [child]);
    assert!(e.world.is_current_entity(child));
}

#[test]
fn spawn_prefabs_live_limit_and_mass_retirement_do_not_leak_slots_or_reset_serials() {
    let mut e = Engine::new();
    e.use_data_scene();
    let actor = sprite(&mut e, 71, 0., 0., 0);
    let prototype = sprite(&mut e, 72, -32., 0., 0);
    bind(&mut e, actor, 12.);
    assert!(configure(&mut e, actor, prototype));
    for i in 0..515 {
        e.world.set_transform(
            actor,
            Transform2D {
                x: i as f32 * 32.,
                y: 0.,
            },
        );
        click(&mut e, false, 0.001);
        click(&mut e, true, 0.001);
    }
    let old = actors(&e);
    assert_eq!(old.len(), 512);
    assert_eq!(e.world.alive_count(), 514);
    assert_eq!(e.data_scene_spawned_actor_handles()[1], 512);
    for &child in &old {
        e.world.despawn(child);
    }
    click(&mut e, false, 0.001);
    assert_eq!(e.data_scene_spawned_actor_handles(), [1, 512, 0]);
    click(&mut e, true, 0.001);
    let child = actors(&e)[0];
    assert_eq!(e.world.alive_count(), 3);
    assert_eq!(e.data_scene_spawned_actor_handles()[1], 513);
    assert!(old
        .iter()
        .all(|&previous| !e.world.is_current_entity(previous)));
    assert!(old
        .iter()
        .any(|previous| previous.id == child.id && previous.generation != child.generation));
}

#[test]
fn spawn_prefabs_execute_authored_and_inherited_spawn_timers_without_input() {
    let mut e = Engine::new();
    e.use_data_scene();
    let actor = sprite(&mut e, 71, 0., 16., 0);
    let prototype = sprite(&mut e, 72, 40., 16., 0);
    bind(&mut e, actor, 12.);
    assert!(e.set_gameplay_action_spawn_prefab(
        prototype.id,
        prototype.generation,
        78,
        0.,
        1,
        0,
        0,
        12.,
        0.
    ));
    assert!(e.set_gameplay_timer_action_trigger(actor.id, actor.generation, 9, 0.01, 77));
    assert!(e.set_gameplay_timer_action_trigger(prototype.id, prototype.generation, 10, 0.01, 78));
    assert!(configure(&mut e, actor, prototype));
    e.world.despawn(prototype);
    click(&mut e, false, 0.011);
    let first = actors(&e)[0];
    assert_eq!(e.world.transform(first).unwrap().x, 12.);
    let timer = e
        .world
        .gameplay_timer_trigger_mut_at_index(actor.id as usize)
        .unwrap();
    timer.fired = false;
    timer.remaining_seconds = 1.;
    click(&mut e, false, 0.011);
    let spawned = actors(&e);
    assert_eq!(spawned.len(), 2);
    assert_eq!(e.world.transform(spawned[1]).unwrap().x, 24.);
    assert!(e.world.action_binding(spawned[1], 78).is_some());
    assert!(e.world.gameplay_timer_trigger(spawned[1]).is_some());
    assert_eq!(e.data_scene_spawned_actor_handles()[1], 2);
}
