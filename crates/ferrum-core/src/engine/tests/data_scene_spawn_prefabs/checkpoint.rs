use super::*;

struct Saved {
    states: Vec<u32>,
    animation: Vec<f64>,
    spatial: Vec<f64>,
    rotations: Vec<f64>,
    combat: Vec<f64>,
}
fn capture(e: &Engine, handles: &[u32]) -> Saved {
    let epoch = e.data_scene_epoch();
    let saved = Saved {
        states: e.capture_data_scene_progress(epoch, handles),
        animation: e.capture_data_scene_animation_progress(epoch, handles),
        spatial: e.capture_data_scene_spatial_progress(epoch, handles),
        rotations: e.capture_data_scene_spatial_rotations(epoch, handles),
        combat: e.capture_data_scene_combat_progress(epoch, handles),
    };
    assert!(
        !saved.combat.is_empty(),
        "native capture refused a supported scene"
    );
    assert_eq!(saved.combat[0], 3.);
    assert!(e.preflight_data_scene_combat_progress(&saved.states, &saved.combat));
    saved
}
fn restore(e: &mut Engine, handles: &[u32], saved: &Saved) -> bool {
    e.restore_data_scene_progress_with_combat(
        e.data_scene_epoch(),
        handles,
        &saved.states,
        &saved.animation,
        &saved.spatial,
        &[],
        &saved.rotations,
        false,
        &saved.combat,
    )
}
fn scene(
    e: &mut Engine,
    texture: u32,
    animation: bool,
    compound: bool,
) -> (Entity, Entity, Vec<u32>) {
    e.use_data_scene();
    let actor = sprite(e, texture, 0., 16., 0);
    let prototype = sprite(e, texture + 1, 40., 16., 0);
    e.world
        .set_collision_filter(actor, CollisionFilter::from_layer(CollisionLayer::Player));
    e.world.set_collision_filter(
        prototype,
        CollisionFilter::from_layer(CollisionLayer::Enemy),
    );
    for entity in [actor, prototype] {
        assert!(e.configure_data_scene_body(entity.id, entity.generation, 1, true, 0, 0., 8.));
    }
    if compound {
        e.world.add_compound_collider(
            prototype,
            crate::components::CompoundCollider::new(
                crate::components::CompoundColliderShape::Circle(
                    crate::components::CircleCollider::new(1., true, CollisionLayer::Enemy)
                        .with_offset(3., 0.),
                ),
            ),
        );
    }
    assert!(e.set_gameplay_health(prototype.id, prototype.generation, 6.));
    assert!(e.set_gameplay_lifetime(prototype.id, prototype.generation, 5.));
    assert!(e.set_gameplay_interaction(prototype.id, prototype.generation, 90, 2., true));
    assert!(e.set_gameplay_action_projectile_with_target(
        prototype.id,
        prototype.generation,
        78,
        0.2,
        12.,
        1.,
        2.,
        1,
        1,
        0
    ));
    assert!(e.set_gameplay_timer_action_trigger(prototype.id, prototype.generation, 9, 0.05, 78));
    if animation {
        assert!(e.configure_data_scene_sprite_clips(
            prototype.id,
            prototype.generation,
            &[1., 2., 10., 1.],
            &[0., 0., 0.5, 1., 0.5, 0., 1., 1.],
            1
        ));
        e.world.sprite_animations[prototype.id as usize] = Some(
            crate::components::SpriteAnimation::atlas(
                &[
                    crate::components::SpriteFrame {
                        u0: 0.,
                        v0: 0.,
                        u1: 0.5,
                        v1: 1.,
                    },
                    crate::components::SpriteFrame {
                        u0: 0.5,
                        v0: 0.,
                        u1: 1.,
                        v1: 1.,
                    },
                ],
                10.,
                &[],
                10.,
            )
            .unwrap(),
        );
    }
    bind(e, actor, 12.);
    assert!(configure(e, actor, prototype));
    (
        actor,
        prototype,
        vec![
            actor.id,
            actor.generation,
            prototype.id,
            prototype.generation,
        ],
    )
}

#[test]
fn spawned_checkpoint_keeps_dead_projectile_source_when_its_slot_is_reused_then_recaptures() {
    let mut e = Engine::new();
    let (_, prototype, handles) = scene(&mut e, 10, false, false);
    e.world.despawn(prototype);
    click(&mut e, true, 0.001);
    let first = actors(&e)[0];
    click(&mut e, false, 0.05);
    assert_eq!(
        e.data_scene_combat_stats()[2],
        1,
        "timer={:?} stats={:?} child={:?}",
        e.world.gameplay_timer_trigger(first),
        e.data_scene_combat_stats(),
        e.world.transform(first)
    );
    e.world.despawn(first);
    click(&mut e, true, 0.001);
    let second = actors(&e)[0];
    assert_eq!(first.id, second.id);
    assert_ne!(first.generation, second.generation);
    let saved = capture(&e, &handles);
    assert_eq!(saved.combat[4..6], [2., 2.]);
    // The shot points to serial 1, even though the same physical slot now belongs to serial 2.
    let shots = 6 + 2 * 72 + 2 * 89;
    assert_eq!(saved.combat[shots], 2.);
    let (_, fresh_prototype, fresh) = scene(&mut e, 70, false, false);
    assert_ne!(prototype, fresh_prototype);
    assert!(restore(&mut e, &fresh, &saved));
    assert!(!e.world.is_current_entity(fresh_prototype));
    assert_eq!(actors(&e).len(), 1);
    let bullet = find_layer(&e, CollisionLayer::Bullet);
    assert_eq!(
        e.world
            .sprite_at_index(bullet.id as usize)
            .unwrap()
            .texture_id,
        71
    );
    assert_eq!(capture(&e, &fresh).combat, saved.combat);
    for _ in 0..6 {
        click(&mut e, false, 0.01);
    }
    assert!(e.data_scene_combat_stats()[2] >= 1);
    // A second cold restore also uses logical serials; no reserved source leaks into world slots.
    let next = capture(&e, &fresh);
    let (_, _, third) = scene(&mut e, 90, false, false);
    assert!(restore(&mut e, &third, &next));
    assert!(e.world.alive_indices().iter().all(|&index| index < 2048));
}

#[test]
fn spawned_checkpoint_restores_independent_atlas_legacy_health_and_compound_flags() {
    let mut e = Engine::new();
    let (_, prototype, handles) = scene(&mut e, 10, true, true);
    e.world.despawn(prototype);
    click(&mut e, true, 0.017);
    let child = actors(&e)[0];
    e.world.replace_health(child, Some(2.));
    e.world
        .interaction_mut_at_index(child.id as usize)
        .unwrap()
        .consumed = true;
    e.world.apply_actor_collider_enabled_mask(child, 1);
    e.world.rigid_bodies[child.id as usize]
        .as_mut()
        .unwrap()
        .enabled = false;
    let mut sprite = e.world.sprite_at_index(child.id as usize).unwrap();
    let playback = e.world.sprite_playbacks[child.id as usize]
        .as_mut()
        .unwrap();
    playback.elapsed = 0.13;
    playback.paused = true;
    playback.flip_x = true;
    playback.flip_y = true;
    playback.write_sprite(&mut sprite);
    *e.world.sprite_mut_at_index(child.id as usize).unwrap() = sprite;
    let animation = e.world.sprite_animations[child.id as usize]
        .as_mut()
        .unwrap();
    animation.current_frame = 1;
    animation.elapsed_seconds = 0.02;
    let saved = capture(&e, &handles);
    let (_, _, fresh) = scene(&mut e, 70, true, true);
    assert!(restore(&mut e, &fresh, &saved));
    let restored = actors(&e)[0];
    assert_eq!(e.world.health(restored), Some(2.));
    assert!(!e.world.rigid_body(restored).unwrap().enabled);
    assert_eq!(e.world.actor_collider_enabled_mask(restored), 1);
    assert!(e.world.interaction(restored).unwrap().consumed);
    let playback = e.world.sprite_playbacks[restored.id as usize]
        .as_ref()
        .unwrap();
    assert_eq!(playback.elapsed, 0.13);
    assert!(playback.paused && playback.flip_x && playback.flip_y);
    assert_eq!(
        e.world.sprite_animations[restored.id as usize]
            .unwrap()
            .current_frame,
        1
    );
    assert_eq!(capture(&e, &fresh).combat, saved.combat);
}

#[test]
fn spawned_checkpoint_invalid_states_and_definition_edits_are_atomic() {
    let mut e = Engine::new();
    let (_, prototype, handles) = scene(&mut e, 10, true, true);
    e.world.despawn(prototype);
    click(&mut e, true, 0.017);
    let mut saved = capture(&e, &handles);
    let original = saved.combat.clone();
    let (_, _, fresh) = scene(&mut e, 70, true, true);
    let before = e.world.alive_count();
    let record = 6 + 2 * 72;
    for (offset, value) in [
        (0, 0.),
        (1, 2.),
        (2, 2.),
        (3 + 13, 7.),
        (3 + 18, 0.06),
        (75 + 1, 2.),
        (75 + 2, 0.2),
        (81 + 2, 2.),
        (81 + 3, 0.1),
        (88, 4.),
    ] {
        saved.combat.clone_from(&original);
        saved.combat[record + offset] = value;
        assert!(
            !restore(&mut e, &fresh, &saved),
            "accepted invalid spawn field {offset}"
        );
        assert_eq!(e.world.alive_count(), before);
        assert!(actors(&e).is_empty());
    }
    saved.combat.clone_from(&original);
    assert!(restore(&mut e, &fresh, &saved));
    let child = actors(&e)[0];
    let health = e.world.health(child);
    assert!(e.set_gameplay_damage(child.id, child.generation, 9.));
    assert!(
        e.capture_data_scene_combat_progress(e.data_scene_epoch(), &fresh)
            .is_empty(),
        "unsupported definition edit was silently lost"
    );
    assert_eq!(e.world.health(child), health);
}
