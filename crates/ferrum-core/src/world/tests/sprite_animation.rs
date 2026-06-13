use super::*;

#[test]
fn sprite_animation_advances_horizontal_uv_frames() {
    let mut world = World::default();
    let template = EntityTemplate::new(32.0, 32.0).with_animation(4, 8.0);
    let entity = world.spawn_enemy_from_template(10.0, 20.0, 7, template, 1.0, 1);

    let sprite = world
        .sprite_at_index(entity.id as usize)
        .expect("template-spawned enemy should have a sprite");
    assert_eq!(sprite.u0, 0.0);
    assert_eq!(sprite.u1, 0.25);

    world.update(0.125);

    let sprite = world
        .sprite_at_index(entity.id as usize)
        .expect("template-spawned enemy should keep its sprite");
    assert_eq!(sprite.u0, 0.25);
    assert_eq!(sprite.u1, 0.5);
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

    let sprite = world
        .sprite_at_index(entity.id as usize)
        .expect("template-spawned bullet should keep its sprite");
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

    let sprite = world
        .sprite_at_index(entity.id as usize)
        .expect("template-spawned bullet should keep its sprite");
    assert_eq!(sprite.u0, 0.25);
    assert_eq!(sprite.u1, 0.5);
    assert_eq!(sprite.v0, 0.5);
    assert_eq!(sprite.v1, 1.0);
}
