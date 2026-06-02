use super::*;

#[test]
fn audio_policy_controls_event_volume_and_pitch() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    scene.set_audio_policy(ShooterAudioPolicy::from_values(
        0.2, 1.2, 0.5, 0.9, 0.8, 0.7,
    ));
    scene.set_sound_ids(10, 20, 30);
    let player = world.player.unwrap();

    scene.fire_bullet_toward_mouse(
        &mut world,
        &camera,
        InputState {
            mouse_x: 800.0,
            mouse_y: 240.0,
            ..InputState::default()
        },
        player,
        &mut audio_events,
    );

    assert_eq!(audio_events[0].sound_id as u32, 10);
    assert_eq!(audio_events[0].volume, 0.2);
    assert_eq!(audio_events[0].pitch, 1.2);
    assert_eq!(audio_events[0].channel_id, AUDIO_CHANNEL_SFX);
}

#[test]
fn firing_bullet_pushes_shoot_audio_event() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    let player = world.player.unwrap();

    scene.fire_bullet_toward_mouse(
        &mut world,
        &camera,
        InputState::default(),
        player,
        &mut audio_events,
    );

    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id as u32, 10);
    assert_eq!(audio_events[0].volume, DEFAULT_SHOOT_VOLUME);
    assert_eq!(audio_events[0].channel_id, AUDIO_CHANNEL_SFX);
}

#[test]
fn bullet_enemy_collision_pushes_hit_audio_event() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id as u32, 20);
    assert_eq!(audio_events[0].channel_id, AUDIO_CHANNEL_SFX);
}

#[test]
fn game_over_pushes_event_once_and_clear_events_removes_it() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    let player = world.player.unwrap();
    let pt = world.transforms[player.id as usize].unwrap();
    world.spawn_enemy(pt.x, pt.y, DEFAULT_TEXTURE_ID);

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.game_state(), GameState::GameOver);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id as u32, 30);
    assert_eq!(audio_events[0].channel_id, AUDIO_CHANNEL_SFX);

    audio_events.clear();
    assert!(audio_events.is_empty());
}
