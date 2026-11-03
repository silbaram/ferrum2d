use super::data_scene_visuals::sprite;
use super::*;

fn setup() -> (Engine, Entity) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = sprite(&mut engine, 1, 30.0, 30.0, 0);
    (engine, actor)
}
fn frames(count: usize) -> Vec<f32> {
    (0..count)
        .flat_map(|i| {
            [
                i as f32 / count as f32,
                0.0,
                (i + 1) as f32 / count as f32,
                1.0,
            ]
        })
        .collect()
}
fn timed(engine: &mut Engine, actor: Entity, direction: u32, looping: bool, events: bool) {
    assert!(engine.configure_data_scene_sprite_clips_v2(
        actor.id,
        actor.generation,
        &[
            7.0,
            3.0,
            0.0,
            u32::from(looping) as f32,
            direction as f32,
            u32::from(events) as f32,
            1.0
        ],
        &frames(3),
        &[90.0, 180.0, 270.0],
        7
    ));
}
fn state(engine: &Engine, actor: Entity) -> Vec<f64> {
    engine.data_scene_sprite_animation_state(actor.id, actor.generation)
}
fn seek(engine: &mut Engine, actor: Entity, frame: u32) -> bool {
    engine.update_data_scene_sprite_animations(&[actor.id, actor.generation, 2, 0, frame, 0, 0, 0])
}

#[test]
fn variable_time_reverse_and_pingpong_use_original_frames_and_canonical_seek() {
    for direction in 0..3 {
        let (mut engine, actor) = setup();
        timed(&mut engine, actor, direction, true, false);
        assert_eq!(
            state(&engine, actor)[1],
            if direction == 1 { 2.0 } else { 0.0 }
        );
        assert!(seek(&mut engine, actor, 1));
        let phase = state(&engine, actor)[2];
        assert!((phase - if direction == 1 { 0.27 } else { 0.09 }).abs() < 1e-12);
        assert_eq!(state(&engine, actor)[1], 1.0);
        assert_eq!(
            engine.world.sprite_playbacks[actor.id as usize]
                .as_ref()
                .unwrap()
                .clips[0]
                .frames
                .len(),
            3
        );
    }
    let (mut engine, actor) = setup();
    timed(&mut engine, actor, 0, true, false);
    engine.update(0.089);
    assert_eq!(state(&engine, actor)[1], 0.0);
    engine.update(0.002);
    assert_eq!(state(&engine, actor)[1], 1.0);
    engine.update(0.180);
    assert_eq!(state(&engine, actor)[1], 2.0);
}

#[test]
fn nonloop_pingpong_returns_to_zero_and_completed_progress_does_not_reemit() {
    let (mut engine, actor) = setup();
    timed(&mut engine, actor, 2, false, true);
    engine.update(1.0);
    assert_eq!(
        (state(&engine, actor)[1], state(&engine, actor)[4]),
        (0.0, 1.0)
    );
    let events: Vec<_> = engine
        .frame_buffers
        .gameplay_events
        .iter()
        .map(|e| (e.kind, e.payload_bits))
        .collect();
    assert_eq!(events, vec![(12, 1), (12, 2), (12, 1), (12, 0), (13, 0)]);
    let handles = [actor.id, actor.generation];
    let epoch = engine.data_scene_epoch();
    let progress = engine.capture_data_scene_progress(epoch, &handles);
    let animation = engine.capture_data_scene_animation_progress(epoch, &handles);
    let (mut fresh, replacement) = setup();
    timed(&mut fresh, replacement, 2, false, true);
    assert!(fresh.restore_data_scene_progress_with_animations(
        fresh.data_scene_epoch(),
        &[replacement.id, replacement.generation],
        &progress,
        &animation
    ));
    fresh.update(0.1);
    assert!(fresh.frame_buffers.gameplay_events.is_empty());
    assert_eq!(state(&fresh, replacement), state(&engine, actor));
}

#[test]
fn fractional_pingpong_phase_roundtrips_without_a_direction_cursor() {
    let (mut engine, actor) = setup();
    timed(&mut engine, actor, 2, true, true);
    engine.update(0.55);
    assert_eq!(state(&engine, actor)[1], 1.0);
    let handles = [actor.id, actor.generation];
    let epoch = engine.data_scene_epoch();
    let progress = engine.capture_data_scene_progress(epoch, &handles);
    let animation = engine.capture_data_scene_animation_progress(epoch, &handles);
    let expected = state(&engine, actor);
    assert!(seek(&mut engine, actor, 2));
    assert!(
        engine.restore_data_scene_progress_with_animations(epoch, &handles, &progress, &animation)
    );
    assert_eq!(state(&engine, actor), expected);
    engine.update(0.2);
    assert_eq!(state(&engine, actor)[1], 0.0);
    assert_eq!(
        engine
            .frame_buffers
            .gameplay_events
            .iter()
            .map(|e| e.payload_bits)
            .collect::<Vec<_>>(),
        vec![0]
    );
}

#[test]
fn single_frame_clips_loop_or_complete_once_for_all_directions() {
    for direction in 0..3 {
        for looping in [false, true] {
            let (mut engine, actor) = setup();
            assert!(engine.configure_data_scene_sprite_clips_v2(
                actor.id,
                actor.generation,
                &[
                    0.0,
                    1.0,
                    0.0,
                    u32::from(looping) as f32,
                    direction as f32,
                    1.0,
                    1.0
                ],
                &frames(1),
                &[100.0],
                0
            ));
            engine.update(0.25);
            let kinds: Vec<_> = engine
                .frame_buffers
                .gameplay_events
                .iter()
                .map(|e| e.kind)
                .collect();
            assert_eq!(kinds, if looping { vec![12, 12] } else { vec![13] });
            assert_eq!(state(&engine, actor)[1], 0.0);
        }
    }
}

#[test]
fn extended_frame_budget_and_atomic_validation_preserve_existing_playback() {
    let (mut engine, actor) = setup();
    let descriptor = [8.0, 256.0, 10.0, 1.0, 0.0, 0.0, 0.0];
    assert!(engine.configure_data_scene_sprite_clips_v2(
        actor.id,
        actor.generation,
        &descriptor,
        &frames(256),
        &[],
        8
    ));
    assert!(seek(&mut engine, actor, 255));
    assert!(!seek(&mut engine, actor, 256));
    let before = state(&engine, actor);
    for (index, value) in [
        (0, f32::NAN),
        (1, 257.0),
        (2, 0.0),
        (3, 2.0),
        (4, 3.0),
        (5, 2.0),
        (6, 2.0),
    ] {
        let mut bad = descriptor;
        bad[index] = value;
        assert!(!engine.configure_data_scene_sprite_clips_v2(
            actor.id,
            actor.generation,
            &bad,
            &frames(256),
            &[],
            8
        ));
        assert_eq!(state(&engine, actor), before);
    }
    let descriptors: Vec<_> = (0..17)
        .flat_map(|id| [id as f32, 256.0, 10.0, 1.0, 0.0, 0.0, 0.0])
        .collect();
    assert!(!engine.configure_data_scene_sprite_clips_v2(
        actor.id,
        actor.generation,
        &descriptors,
        &frames(256).repeat(17),
        &[],
        0
    ));
    for duration in [0.0, f32::NAN, 1_000_001.0] {
        assert!(!engine.configure_data_scene_sprite_clips_v2(
            actor.id,
            actor.generation,
            &[0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            &frames(1),
            &[duration],
            0
        ));
    }
    assert_eq!(state(&engine, actor), before);
    assert_eq!(crate::components::MAX_SPRITE_ANIMATION_FRAMES, 32);
}

#[test]
fn several_crossings_are_not_lost_when_the_displayed_frame_returns_to_start() {
    let (mut engine, actor) = setup();
    timed(&mut engine, actor, 2, true, true);
    engine.update(0.73);
    assert_eq!(state(&engine, actor)[1], 0.0);
    let events = &engine.frame_buffers.gameplay_events;
    assert_eq!(
        events
            .iter()
            .map(|e| (e.kind, e.token_id, e.payload_bits))
            .collect::<Vec<_>>(),
        vec![(12, 7, 1), (12, 7, 2), (12, 7, 1), (12, 7, 0)]
    );
    assert!(events.iter().all(|e| e.actor_id == actor.id
        && e.source_id == actor.id
        && e.actor_generation == actor.generation));
}

#[test]
fn event_budget_is_bounded_shared_and_reports_overflow_without_hot_growth() {
    let (mut engine, actor) = setup();
    for entity in [actor, sprite(&mut engine, 1, 60.0, 60.0, 0)] {
        assert!(engine.configure_data_scene_sprite_clips_v2(
            entity.id,
            entity.generation,
            &[0.0, 1.0, 1000.0, 1.0, 0.0, 1.0, 0.0],
            &frames(1),
            &[],
            0
        ));
    }
    let capacity = engine.frame_buffers.gameplay_events.capacity();
    engine.update(10.0);
    assert_eq!(engine.frame_buffers.gameplay_events.len(), 4097);
    assert_eq!(engine.frame_buffers.gameplay_events.capacity(), capacity);
    let overflow = engine.frame_buffers.gameplay_events.last().unwrap();
    assert_eq!(
        (overflow.kind, overflow.actor_id, overflow.payload_bits),
        (14, u32::MAX, 20000 - 4096)
    );
    engine.update(0.001);
    assert_eq!(engine.frame_buffers.gameplay_events.len(), 2);
    assert!(engine
        .frame_buffers
        .gameplay_events
        .iter()
        .all(|e| e.kind == 12));
}

#[test]
fn fixed_steps_accumulate_events_and_pause_does_not_emit() {
    let (mut engine, actor) = setup();
    assert!(engine.configure_data_scene_sprite_clips_v2(
        actor.id,
        actor.generation,
        &[0.0, 3.0, 8.0, 1.0, 0.0, 1.0, 0.0],
        &frames(3),
        &[],
        0
    ));
    engine.configure_fixed_timestep(true, 0.125, 1.0, 8);
    engine.update(0.51);
    assert_eq!(
        engine
            .frame_buffers
            .gameplay_events
            .iter()
            .map(|e| e.payload_bits)
            .collect::<Vec<_>>(),
        vec![1, 2, 0, 1]
    );
    assert!(engine.update_data_scene_sprite_animations(&[
        actor.id,
        actor.generation,
        16,
        0,
        0,
        0,
        0,
        1
    ]));
    engine.update(0.5);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
}

#[test]
fn huge_valid_deltas_preserve_subcycle_phase_and_bound_event_work() {
    // Binary-exact periods and deltas give an independent, exact remainder oracle.
    for (count, direction, delta, duration, expected_phase, expected_frame) in [
        (3, 0, 2.0_f32.powi(53), 0.375, 0.125, 1.0),
        (256, 2, 2.0_f32.powi(54), 63.75, 0.25, 2.0),
    ] {
        for emit in [false, true] {
            let (mut engine, actor) = setup();
            assert!(engine.configure_data_scene_sprite_clips_v2(
                actor.id,
                actor.generation,
                &[
                    0.0,
                    count as f32,
                    8.0,
                    1.0,
                    direction as f32,
                    u32::from(emit) as f32,
                    0.0
                ],
                &frames(count),
                &[],
                0,
            ));
            assert_eq!(f64::from(delta) % duration, expected_phase);
            let capacity = engine.frame_buffers.gameplay_events.capacity();
            engine.update(f64::from(delta));
            let actual = state(&engine, actor);
            assert_eq!(actual[2], expected_phase);
            assert_eq!(actual[1], expected_frame);
            assert_eq!(engine.frame_buffers.gameplay_events.capacity(), capacity);
            if emit {
                assert_eq!(engine.frame_buffers.gameplay_events.len(), 4097);
                let overflow = engine.frame_buffers.gameplay_events.last().unwrap();
                assert_eq!((overflow.kind, overflow.payload_bits), (14, u32::MAX));
            } else {
                assert!(engine.frame_buffers.gameplay_events.is_empty());
            }
        }
    }
}

#[test]
fn world_snapshot_restores_extended_clip_metadata_phase_pause_and_completion() {
    for (looping, elapsed) in [(true, 0.55), (false, 1.0)] {
        let (mut engine, actor) = setup();
        timed(&mut engine, actor, 2, looping, true);
        engine.update(elapsed);
        assert!(engine.update_data_scene_sprite_animations(&[
            actor.id,
            actor.generation,
            28,
            0,
            0,
            1,
            1,
            1,
        ]));
        let expected = state(&engine, actor);
        let snapshot = engine.world.snapshot();
        // Replace the actual clip metadata as well as its clock before restoration.
        timed(&mut engine, actor, 1, false, false);
        engine.update(0.2);
        engine.world.restore_snapshot(&snapshot);
        assert_eq!(state(&engine, actor), expected);
        engine.update(0.3);
        assert_eq!(state(&engine, actor), expected);
        assert!(engine.frame_buffers.gameplay_events.is_empty());
        assert!(engine.update_data_scene_sprite_animations(&[
            actor.id,
            actor.generation,
            16,
            0,
            0,
            0,
            0,
            0,
        ]));
        engine.update(0.2);
        if looping {
            assert_eq!(state(&engine, actor)[1], 0.0);
            assert_eq!(engine.frame_buffers.gameplay_events.len(), 1);
            let event = engine.frame_buffers.gameplay_events[0];
            assert_eq!((event.kind, event.payload_bits), (12, 0));
        } else {
            assert_eq!(state(&engine, actor)[4], 1.0);
            assert!(engine.frame_buffers.gameplay_events.is_empty());
        }
    }
}
