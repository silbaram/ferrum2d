use super::{data_scene_visuals::sprite, *};

fn configure(e: &mut Engine, count: u32, low: u32) -> Entity {
    let actor = sprite(e, 1, 0., 0., 0);
    let frames: Vec<f32> = (0..count)
        .flat_map(|i| {
            [
                i as f32 / count as f32,
                0.,
                (i + 1) as f32 / count as f32,
                1.,
            ]
        })
        .collect();
    assert!(e.configure_data_scene_sprite_clips(
        actor.id,
        actor.generation,
        &[0., count as f32, 6., 1.],
        &frames,
        0
    ));
    assert!(e.spatial_scene.models.configure(
        &e.world,
        &[actor.id, actor.generation, 1, 3, 1, 12],
        &[0., 0., 1., -4., 0., -4., 4., 24., 4.]
    ));
    assert!(e.configure_spatial_model_streaming(
        &[],
        &[
            actor.id,
            actor.generation,
            1,
            1,
            12,
            0,
            actor.id,
            actor.generation,
            low,
            1,
            2,
            0
        ],
        &[0., 100.]
    ));
    actor
}
fn asset(e: &mut Engine, actor: Entity, x: f32) -> u32 {
    let camera = crate::spatial_scene::SpatialCamera::new(&[
        0., x, 40., 1., 0., 0., 0., 200., 0.1, 2000., 200., 200.,
    ])
    .unwrap();
    e.spatial_scene
        .models
        .build(&e.world, &camera, &[], false, &Default::default());
    e.spatial_scene
        .models
        .draw_snapshot((actor.id, actor.generation))[0]
}

#[test]
fn authoring_continuity_keeps_exact_native_playback_and_lod_hysteresis() {
    let mut e = Engine::new();
    e.use_data_scene();
    let actor = configure(&mut e, 4, 2);
    assert!(e.update_data_scene_sprite_animations(&[
        actor.id,
        actor.generation,
        2 | 4 | 16,
        0,
        1,
        1,
        0,
        1
    ]));
    let playback = e.data_scene_sprite_animation_state(actor.id, actor.generation);
    assert_eq!(asset(&mut e, actor, 200.), 2);
    assert_eq!(asset(&mut e, actor, 100.), 2);
    let token = e.begin_data_scene_authoring_continuity(&[actor.id, actor.generation], &[3]);
    assert_ne!(token, 0);
    assert_eq!(e.begin_data_scene_authoring_continuity(&[], &[]), 0);
    assert!(
        !e.finish_data_scene_authoring_continuity(token, &[actor.id, actor.generation]),
        "must not finish in the source epoch"
    );
    e.use_data_scene();
    let next = configure(&mut e, 4, 2);
    assert!(!e.finish_data_scene_authoring_continuity(token + 1, &[next.id, next.generation]));
    assert!(!e.finish_data_scene_authoring_continuity(token, &[next.id, next.generation + 1]));
    assert!(e.finish_data_scene_authoring_continuity(token, &[next.id, next.generation]));
    assert_eq!(
        e.data_scene_sprite_animation_state(next.id, next.generation),
        playback
    );
    assert!(
        e.frame_buffers.gameplay_events.is_empty(),
        "restoring phase must not replay animation events"
    );
    assert_eq!(
        asset(&mut e, next, 100.),
        2,
        "retained low LOD inside the hysteresis band"
    );
    assert_eq!(asset(&mut e, next, 80.), 1);
    assert!(!e.finish_data_scene_authoring_continuity(token, &[next.id, next.generation]));
}

#[test]
fn authoring_continuity_skips_changed_clips_and_lod_policy_and_releases_canceled_state() {
    let mut e = Engine::new();
    e.use_data_scene();
    let actor = configure(&mut e, 4, 2);
    assert!(e.update_data_scene_sprite_animations(&[
        actor.id,
        actor.generation,
        2 | 4,
        0,
        1,
        1,
        0,
        0
    ]));
    assert_eq!(asset(&mut e, actor, 200.), 2);
    assert_eq!(
        e.begin_data_scene_authoring_continuity(
            &[actor.id, actor.generation, actor.id, actor.generation],
            &[3, 3]
        ),
        0
    );
    assert_eq!(
        e.begin_data_scene_authoring_continuity(&[actor.id, actor.generation], &[4]),
        0
    );
    let clips = std::sync::Arc::downgrade(
        &e.world.sprite_playbacks[actor.id as usize]
            .as_ref()
            .unwrap()
            .clips,
    );
    let canceled = e.begin_data_scene_authoring_continuity(&[actor.id, actor.generation], &[3]);
    assert_eq!(clips.strong_count(), 2);
    assert!(!e.cancel_data_scene_authoring_continuity(canceled + 1));
    assert!(e.cancel_data_scene_authoring_continuity(canceled));
    assert_eq!(
        clips.strong_count(),
        1,
        "cancellation releases the captured clip Arc"
    );
    let token = e.begin_data_scene_authoring_continuity(&[actor.id, actor.generation], &[3]);
    assert_ne!(token, canceled);
    e.use_data_scene();
    let next = configure(&mut e, 2, 3);
    assert!(!e.cancel_data_scene_authoring_continuity(canceled));
    assert!(e.finish_data_scene_authoring_continuity(token, &[next.id, next.generation]));
    let animation = e.data_scene_sprite_animation_state(next.id, next.generation);
    assert_eq!(animation[1], 0.);
    assert_eq!(animation[2], 0.);
    assert_eq!(animation[5], 0.);
    assert_eq!(
        asset(&mut e, next, 100.),
        1,
        "changed native LOD policy starts with the authored default"
    );
    let token = e.begin_data_scene_authoring_continuity(&[next.id, next.generation], &[0]);
    assert_ne!(token, 0);
    assert!(e.cancel_data_scene_authoring_continuity(token));
}

#[test]
fn authoring_continuity_rejects_a_stale_later_target_without_partially_restoring() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = configure(&mut e, 4, 2);
    let b = configure(&mut e, 4, 2);
    assert!(e.update_data_scene_sprite_animations(&[
        a.id,
        a.generation,
        2,
        0,
        1,
        0,
        0,
        0,
        b.id,
        b.generation,
        2,
        0,
        2,
        0,
        0,
        0
    ]));
    let token =
        e.begin_data_scene_authoring_continuity(&[a.id, a.generation, b.id, b.generation], &[1, 1]);
    assert_ne!(token, 0);
    e.use_data_scene();
    let a = configure(&mut e, 4, 2);
    let b = configure(&mut e, 4, 2);
    assert!(!e.finish_data_scene_authoring_continuity(
        token,
        &[a.id, a.generation, b.id, b.generation + 1]
    ));
    assert_eq!(
        e.data_scene_sprite_animation_state(a.id, a.generation)[1],
        0.
    );
    assert!(
        !e.finish_data_scene_authoring_continuity(token, &[a.id, a.generation, a.id, a.generation])
    );
    assert!(
        e.finish_data_scene_authoring_continuity(token, &[a.id, a.generation, b.id, b.generation])
    );
    assert_eq!(
        e.data_scene_sprite_animation_state(a.id, a.generation)[1],
        1.
    );
    assert_eq!(
        e.data_scene_sprite_animation_state(b.id, b.generation)[1],
        2.
    );
}
