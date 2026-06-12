use super::*;

#[test]
fn sprite_animation_advances_horizontal_uv_frames() {
    let mut world = World::default();
    let template = EntityTemplate::new(32.0, 32.0).with_animation(4, 8.0);
    let entity = world.spawn_enemy_from_template(10.0, 20.0, 7, template, 1.0, 1);

    assert_eq!(world.sprites[entity.id as usize].unwrap().u0, 0.0);
    assert_eq!(world.sprites[entity.id as usize].unwrap().u1, 0.25);

    world.update(0.125);

    assert_eq!(world.sprites[entity.id as usize].unwrap().u0, 0.25);
    assert_eq!(world.sprites[entity.id as usize].unwrap().u1, 0.5);
}

#[test]
fn sprite_animation_switches_rows_for_moving_state() {
    let mut world = World::default();
    let animation = SpriteAnimation::new(
        4,
        2,
        SpriteAnimationState {
            row: 0,
            frame_count: 1,
            frames_per_second: 1.0,
        },
        SpriteAnimationState {
            row: 1,
            frame_count: 4,
            frames_per_second: 8.0,
        },
    );
    let template = EntityTemplate::new(32.0, 32.0).with_sprite_animation(animation);
    let entity = world.spawn_bullet_from_template(
        Transform2D { x: 10.0, y: 20.0 },
        Velocity { vx: 5.0, vy: 0.0 },
        7,
        1.0,
        template,
        1.0,
    );

    world.update(0.125);

    let sprite = world.sprites[entity.id as usize].unwrap();
    assert_eq!(sprite.u0, 0.25);
    assert_eq!(sprite.u1, 0.5);
    assert_eq!(sprite.v0, 0.5);
    assert_eq!(sprite.v1, 1.0);
}

#[test]
fn sprite_animation_advances_atlas_frame_sequence() {
    let mut world = World::default();
    let idle = [
        SpriteFrame::from_values(0.0, 0.0, 0.25, 0.5).unwrap(),
        SpriteFrame::from_values(0.25, 0.0, 0.5, 0.5).unwrap(),
    ];
    let moving = [
        SpriteFrame::from_values(0.0, 0.5, 0.25, 1.0).unwrap(),
        SpriteFrame::from_values(0.25, 0.5, 0.5, 1.0).unwrap(),
    ];
    let animation = SpriteAnimation::atlas(&idle, 4.0, &moving, 8.0).unwrap();
    let template =
        EntityTemplate::new(32.0, 32.0).with_frame_animation(32.0, 32.0, idle[0], animation);
    let entity = world.spawn_bullet_from_template(
        Transform2D { x: 10.0, y: 20.0 },
        Velocity { vx: 5.0, vy: 0.0 },
        7,
        1.0,
        template,
        1.0,
    );

    world.update(0.125);

    let sprite = world.sprites[entity.id as usize].unwrap();
    assert_eq!(sprite.u0, 0.25);
    assert_eq!(sprite.u1, 0.5);
    assert_eq!(sprite.v0, 0.5);
    assert_eq!(sprite.v1, 1.0);
}

#[test]
fn sprite_animation_emits_frame_events_as_gameplay_events() {
    let mut world = World::default();
    let mut animation = SpriteAnimation::horizontal(4, 8.0).unwrap();
    assert!(animation.add_frame_event(
        crate::components::SPRITE_ANIMATION_CLIP_IDLE,
        1,
        crate::components::SPRITE_ANIMATION_EVENT_HITBOX,
        99,
    ));
    let template = EntityTemplate::new(32.0, 32.0).with_sprite_animation(Some(animation));
    let entity = world.spawn_enemy_from_template(10.0, 20.0, 7, template, 1.0, 1);

    world.update(0.125);

    assert_eq!(world.sprite_animation_events.len(), 1);
    assert_eq!(
        world.sprite_animation_events[0].kind,
        crate::gameplay_event::GAMEPLAY_EVENT_ANIMATION_FRAME
    );
    assert_eq!(world.sprite_animation_events[0].source_id, entity.id);
    assert_eq!(world.sprite_animation_events[0].token_id, 99);
    assert_eq!(
        world.sprite_animation_events[0].flags,
        crate::components::SPRITE_ANIMATION_EVENT_HITBOX
    );
}

#[test]
fn sprite_animation_emits_frame_zero_event_when_custom_clip_starts() {
    let mut animation = SpriteAnimation::horizontal(4, 8.0).unwrap();
    let attack = [SpriteFrame::from_values(0.0, 0.0, 0.25, 0.25).unwrap()];
    assert!(animation.set_atlas_clip(
        crate::components::SPRITE_ANIMATION_CLIP_ATTACK,
        &attack,
        8.0,
        false,
    ));
    assert!(animation.add_frame_event(
        crate::components::SPRITE_ANIMATION_CLIP_ATTACK,
        0,
        crate::components::SPRITE_ANIMATION_EVENT_HITBOX,
        42,
    ));
    assert!(animation.play_clip(crate::components::SPRITE_ANIMATION_CLIP_ATTACK));

    let mut events = [crate::components::SpriteAnimationFrameEvent::default();
        crate::components::MAX_SPRITE_ANIMATION_FRAME_EVENTS];
    let event_count = animation.advance_collect_events(0.125, false, &mut events);

    assert_eq!(event_count, 1);
    assert_eq!(
        events[0].clip_id,
        crate::components::SPRITE_ANIMATION_CLIP_ATTACK
    );
    assert_eq!(events[0].frame, 0);
    assert_eq!(events[0].token_id, 42);
    assert!(animation.clip_finished);
}

#[test]
fn sprite_animation_custom_non_looping_clip_returns_to_motion_clip() {
    let mut animation = SpriteAnimation::horizontal(4, 8.0).unwrap();
    let attack = [
        SpriteFrame::from_values(0.0, 0.0, 0.25, 0.25).unwrap(),
        SpriteFrame::from_values(0.25, 0.0, 0.5, 0.25).unwrap(),
    ];
    assert!(animation.set_atlas_clip(
        crate::components::SPRITE_ANIMATION_CLIP_ATTACK,
        &attack,
        8.0,
        false,
    ));
    assert!(animation.play_clip(crate::components::SPRITE_ANIMATION_CLIP_ATTACK));

    animation.advance(0.125, false);
    assert_eq!(
        animation.active_clip_id(),
        crate::components::SPRITE_ANIMATION_CLIP_ATTACK
    );
    animation.advance(0.125, false);
    assert!(animation.clip_finished);
    animation.advance(0.125, false);

    assert_eq!(
        animation.active_clip_id(),
        crate::components::SPRITE_ANIMATION_CLIP_IDLE
    );
}
