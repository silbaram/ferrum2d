use super::*;

fn bytes(animation: &SpriteAnimation) -> Vec<u8> {
    crate::checkpoint_codec::encode(animation).unwrap()
}

// Original arithmetic and state-switch order, with a test-only stop so the
// reference can never hang the suite. Returns false outside the bounded domain.
fn original_bounded(animation: &mut SpriteAnimation, delta: f32, moving: bool) -> bool {
    let next = if moving {
        SpriteAnimationKind::Moving
    } else {
        SpriteAnimationKind::Idle
    };
    if animation.current_state != next {
        animation.current_state = next;
        animation.current_frame = 0;
        animation.elapsed_seconds = 0.0;
    }
    if delta <= 0.0 || !delta.is_finite() {
        return true;
    }
    let state = animation.active_state();
    animation.elapsed_seconds += delta;
    let duration = 1.0 / state.frames_per_second;
    let mut steps = 0;
    while animation.elapsed_seconds >= duration {
        if steps == 4096 || animation.elapsed_seconds - duration == animation.elapsed_seconds {
            return false;
        }
        animation.elapsed_seconds -= duration;
        animation.current_frame = (animation.current_frame + 1) % state.frame_count;
        steps += 1;
    }
    true
}

fn normalized(animation: &SpriteAnimation) {
    let state = animation.active_state();
    assert!(animation.current_frame < state.frame_count);
    assert!(animation.elapsed_seconds.is_finite());
    assert!(animation.elapsed_seconds >= 0.0);
    assert!(animation.elapsed_seconds < 1.0 / state.frames_per_second);
}

#[test]
fn sprite_advance_ordinary_f32_path_is_byte_exact_against_bounded_original() {
    let mut compared = 0;
    for fps in [
        f32::from_bits(1),
        0.01,
        0.5,
        1.0,
        8.0,
        24.0,
        60.0,
        120.0,
        1000.0,
        8192.0,
    ] {
        for count in [2, 3, 32, u32::MAX] {
            for delta in [
                -1.0,
                -0.0,
                0.0,
                f32::NAN,
                f32::INFINITY,
                f32::NEG_INFINITY,
                1.0 / 60.0,
                0.1,
                0.5,
            ] {
                let mut actual = SpriteAnimation::horizontal(count, fps).unwrap();
                let mut original = actual;
                assert!(original_bounded(&mut original, delta, false));
                actual.advance(delta, false);
                assert_eq!(
                    bytes(&actual),
                    bytes(&original),
                    "fps={fps}, count={count}, dt={delta}"
                );
                compared += 1;
            }
        }
    }
    assert_eq!(compared, 360);
    // Exactly 4096 original updates; no quotient/remainder replacement here.
    let mut actual = SpriteAnimation::horizontal(3, 1.0).unwrap();
    let mut original = actual;
    assert!(original_bounded(&mut original, 4096.0, false));
    actual.advance(4096.0, false);
    assert_eq!(bytes(&actual), bytes(&original));
    // This quotient is >4096, yet the original rounded f32 subtraction ends
    // after exactly 4096 frames. The preflight margin must preserve its bytes.
    let mut actual = SpriteAnimation::horizontal(3, 1000.0).unwrap();
    let delta = f32::from_bits(1_082_331_760);
    assert!(f64::from(delta) / f64::from(1.0f32 / 1000.0) > 4096.0);
    let mut original = actual;
    assert!(original_bounded(&mut original, delta, false));
    actual.advance(delta, false);
    assert_eq!(bytes(&actual), bytes(&original));
    // Stateful ordinary f32 accumulation and state switches remain exact too.
    let mut actual = SpriteAnimation::new(
        3,
        2,
        SpriteAnimationState {
            row: 0,
            frame_count: 2,
            frames_per_second: 8.0,
        },
        SpriteAnimationState {
            row: 1,
            frame_count: 3,
            frames_per_second: 12.0,
        },
    )
    .unwrap();
    let mut original = actual;
    for tick in 0..128 {
        let dt = [0.0, 1.0 / 60.0, 0.1, 0.25][tick % 4];
        let moving = tick % 11 < 4;
        assert!(original_bounded(&mut original, dt, moving));
        actual.advance(dt, moving);
        assert_eq!(bytes(&actual), bytes(&original), "tick {tick}");
    }
}

#[test]
fn sprite_advance_invalid_delta_preserves_original_state_switch_order() {
    for delta in [
        -1.0,
        -0.0,
        0.0,
        f32::NAN,
        f32::from_bits(0xffc0_0017),
        f32::INFINITY,
        f32::NEG_INFINITY,
    ] {
        for moving in [false, true] {
            let mut actual = SpriteAnimation::horizontal(3, 8.0).unwrap();
            actual.advance(0.2, false);
            let mut original = actual;
            assert!(original_bounded(&mut original, delta, moving));
            actual.advance(delta, moving);
            assert_eq!(bytes(&actual), bytes(&original));
            if moving {
                assert_eq!(actual.current_state, SpriteAnimationKind::Moving);
                assert_eq!(actual.current_frame, 0);
                assert_eq!(actual.elapsed_seconds.to_bits(), 0.0f32.to_bits());
            }
        }
    }
}

#[test]
fn sprite_advance_extreme_fps_returns_with_analytic_dyadic_phase_and_valid_counts() {
    // The before child process hangs on this exact public fixture. Its rounded
    // f32 period is 2^-128; 1/60f32 is 0x888889 * 2^-29.
    let frames = 0x88_8889u128 << 99;
    assert_eq!((1.0f32 / f32::MAX).to_bits(), 0x0020_0000);
    for count in [2, 3, 31, u32::MAX] {
        let mut animation = SpriteAnimation::horizontal(count, f32::MAX).unwrap();
        animation.advance(1.0 / 60.0, false);
        assert_eq!(animation.current_frame, (frames % u128::from(count)) as u32);
        assert_eq!(animation.elapsed_seconds.to_bits(), 0.0f32.to_bits());
        normalized(&animation);
        let mut exact = SpriteAnimation::horizontal(count, 16_777_216.0).unwrap();
        exact.advance(1.0, false); // 2^24 whole frames, no fractional phase.
        assert_eq!(exact.current_frame, 16_777_216 % count);
        assert_eq!(exact.elapsed_seconds.to_bits(), 0.0f32.to_bits());
        normalized(&exact);
    }
    // Atlas constructors also allow the one-frame boundary.
    let mut one = SpriteAnimation::atlas(&[SpriteFrame::FULL], f32::MAX, &[], f32::MAX).unwrap();
    one.advance(f32::MAX, true);
    assert_eq!(one.current_frame, 0);
    assert_eq!(one.uv(), SpriteFrame::FULL.uv());
    normalized(&one);
    assert!(SpriteAnimation::horizontal(0, 1.0).is_none());
    assert!(SpriteAnimation::horizontal(1, 1.0).is_none());
    for fps in [0.0, -1.0, f32::NAN, f32::INFINITY] {
        assert!(SpriteAnimation::horizontal(2, fps).is_none());
    }
}

#[test]
fn sprite_advance_cap_boundary_and_max_frame_count_wrap_are_bounded() {
    for delta in [4096.0, 4097.0, 8192.0, 8193.0] {
        let mut animation = SpriteAnimation::horizontal(3, 1.0).unwrap();
        animation.advance(delta, false);
        assert_eq!(animation.current_frame, delta as u32 % 3);
        assert_eq!(animation.elapsed_seconds, 0.0);
        normalized(&animation);
    }
    let mut animation = SpriteAnimation::horizontal(u32::MAX, 1.0).unwrap();
    animation.advance(4_294_967_040.0, false); // Exactly representable f32.
    assert_eq!(animation.current_frame, u32::MAX - 255);
    let mut original = animation;
    assert!(original_bounded(&mut original, 254.0, false));
    animation.advance(254.0, false);
    assert_eq!(animation.current_frame, u32::MAX - 1);
    assert_eq!(bytes(&animation), bytes(&original));
    animation.advance(1.0, false);
    assert_eq!(animation.current_frame, 0);
    normalized(&animation);
}

#[test]
fn sprite_advance_overflow_and_rounding_to_period_use_explicit_finite_policy() {
    // All values come through the public constructor and advance calls. Wide
    // remainder is just below 2^125, but rounds UP to that f32 period.
    let fps = f32::from_bits(0x0100_0000); // 2^-125.
    let period = 1.0f32 / fps;
    let prior_delta = f32::from_bits(0x737f_ffff); // next_down(2^104).
    let mut animation = SpriteAnimation::horizontal(2, fps).unwrap();
    animation.advance(prior_delta, false);
    let total = f64::from(animation.elapsed_seconds) + f64::from(f32::MAX);
    assert!((animation.elapsed_seconds + f32::MAX).is_infinite());
    let remainder = total % f64::from(period);
    assert!(remainder < f64::from(period));
    assert_eq!(remainder as f32, period);
    animation.advance(f32::MAX, false);
    assert_eq!(animation.current_frame, 0); // Rounded phase carries the last frame.
    assert_eq!(animation.elapsed_seconds.to_bits(), 0.0f32.to_bits());
    normalized(&animation);

    let mut tiny = SpriteAnimation::horizontal(2, f32::from_bits(1)).unwrap();
    assert!((1.0 / tiny.idle.frames_per_second).is_infinite());
    tiny.advance(f32::MAX, false);
    assert_eq!(tiny.elapsed_seconds, f32::MAX); // Original finite non-overflow path.
    tiny.advance(f32::MAX, false);
    assert_eq!(tiny.current_frame, 0); // Wider period is longer than both deltas.
    assert_eq!(tiny.elapsed_seconds, f32::MAX); // Unrepresentable remainder saturates.
    normalized(&tiny);
    for fps in [1e-30, 1e-10, 1.0, 60.0, 1e10, 1e30, f32::MAX] {
        let mut animation = SpriteAnimation::horizontal(31, fps).unwrap();
        for _ in 0..4 {
            animation.advance(f32::MAX, false);
            normalized(&animation);
        }
    }
}

#[test]
fn sprite_advance_fallback_private_checkpoint_continues_exactly() {
    let mut source = SpriteAnimation::horizontal(3, f32::MAX).unwrap();
    source.advance(1.0 / 60.0, false);
    let before = bytes(&source);
    let mut restored: SpriteAnimation = crate::checkpoint_codec::decode(&before).unwrap();
    assert_eq!(bytes(&restored), before);
    for (delta, moving) in [
        (0.0, false),
        (f32::MAX, false),
        (1.0 / 60.0, true),
        (-1.0, false),
        (0.1, false),
    ] {
        source.advance(delta, moving);
        restored.advance(delta, moving);
        assert_eq!(bytes(&source), bytes(&restored));
        normalized(&source);
    }
}

#[test]
fn sprite_advance_native_wasi_phase_golden() {
    let mut words = Vec::new();
    for (count, fps, deltas) in [
        (3, 8.0, [0.01, 0.25, 0.017, 0.0]),
        (3, 60.0, [1.0 / 60.0, 0.1, 0.25, 0.017]),
        (3, f32::MAX, [1.0 / 60.0, f32::MAX, 0.1, 0.0]),
        (u32::MAX, 16_777_216.0, [1.0, 8193.0, 0.5, 0.017]),
        (2, f32::from_bits(1), [f32::MAX, f32::MAX, 0.0, 0.1]),
        (
            2,
            f32::from_bits(0x0100_0000),
            [f32::from_bits(0x737f_ffff), f32::MAX, 0.0, 1.0],
        ),
    ] {
        let mut animation = SpriteAnimation::horizontal(count, fps).unwrap();
        for (index, delta) in deltas.into_iter().enumerate() {
            animation.advance(delta, index == 3);
            normalized(&animation);
            words.extend([
                count,
                fps.to_bits(),
                delta.to_bits(),
                index as u32,
                animation.current_frame,
                animation.elapsed_seconds.to_bits(),
            ]);
        }
    }
    let golden = words
        .iter()
        .map(|word| format!("{word:08x}"))
        .collect::<String>();
    println!("SPRITE_PHASE_GOLDEN {golden}");
    assert_eq!(words.len(), 144);
}
