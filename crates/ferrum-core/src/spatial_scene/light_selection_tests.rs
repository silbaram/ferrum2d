use super::*;

fn input(count: usize, cap: usize, hysteresis: f32, fade: f32) -> Vec<f32> {
    let mut v = vec![0.; 580];
    v[0] = 1.;
    v[136] = cap as f32;
    v[137] = count as f32;
    v[138] = -1.;
    v[576..580].copy_from_slice(&[1., hysteresis, fade, 0.]);
    v
}
fn candidates(scores: &[f32]) -> Candidates {
    let mut result = Candidates {
        positions: [[0.; 3]; 16],
        visible: [true; 16],
        scores: [-1.; 16],
        unavailable: [0; 16],
        count: scores.len(),
    };
    result.scores[..scores.len()].copy_from_slice(scores);
    result
}
fn row(selection: &LightSelection, slot: usize) -> [f64; 4] {
    let values = selection.capture();
    values[7 + slot * 4..11 + slot * 4].try_into().unwrap()
}

#[test]
fn hysteresis_rejects_border_jitter_then_fades_out_swaps_and_fades_in_within_one_slot() {
    let v = input(2, 1, 0.2, 0.2);
    let mut s = LightSelection::new(&v);
    s.advance(&v, &candidates(&[1., 0.95]), [0.; 3], 0.);
    s.advance(&v, &candidates(&[1., 1.1]), [0.; 3], 0.1);
    assert_eq!(row(&s, 0), [0., -1., 1., 1.]);
    assert_eq!(s.diagnostics()[0].reason, 4);
    assert_eq!(s.diagnostics()[1].reason, 5);
    let data = candidates(&[1., 1.3]);
    s.advance(&v, &data, [0.; 3], 0.1);
    assert_eq!(row(&s, 0), [0., 1., 0.5, 3.]);
    assert_eq!(s.diagnostics()[1].reason, 10);
    s.advance(&v, &data, [0.; 3], 0.1);
    assert_eq!(row(&s, 0), [1., -1., 0., 2.]);
    s.advance(&v, &data, [0.; 3], 0.1);
    assert_eq!(row(&s, 0), [1., -1., 0.5, 2.]);
    s.advance(&v, &data, [0.; 3], 0.1);
    assert_eq!(row(&s, 0), [1., -1., 1., 1.]);
    assert!(s.capture()[11..]
        .chunks_exact(4)
        .all(|r| r == [-1., -1., 0., 0.]));
}

#[test]
fn interrupted_fades_reverse_continuously_and_large_steps_consume_both_legs() {
    let v = input(2, 1, 0., 0.2);
    let mut s = LightSelection::new(&v);
    s.advance(&v, &candidates(&[2., 1.]), [0.; 3], 0.);
    s.advance(&v, &candidates(&[1., 2.]), [0.; 3], 0.1);
    assert_eq!(row(&s, 0)[2], 0.5);
    s.advance(&v, &candidates(&[2., 1.]), [0.; 3], 0.05);
    assert_eq!(row(&s, 0), [0., -1., 0.75, 2.]);
    s.advance(&v, &candidates(&[1., 2.]), [0.; 3], 1.);
    assert_eq!(row(&s, 0), [1., -1., 1., 1.]);
    let mut tiny = LightSelection::new(&v);
    tiny.advance(&v, &candidates(&[2., 1.]), [0.; 3], 0.);
    tiny.advance(&v, &candidates(&[1., 2.]), [0.; 3], f32::MIN_POSITIVE);
    assert_eq!(row(&tiny, 0), [0., 1., 1., 3.]);
    tiny.advance(&v, &candidates(&[2., 1.]), [0.; 3], 0.1);
    assert_eq!(row(&tiny, 0), [0., -1., 1., 1.]);
    let v = input(2, 1, 0., 0.);
    let mut instant = LightSelection::new(&v);
    instant.advance(&v, &candidates(&[2., 1.]), [0.; 3], 0.);
    instant.advance(&v, &candidates(&[1., 2.]), [0.; 3], 0.01);
    assert_eq!(row(&instant, 0), [1., -1., 1., 1.]);
}

#[test]
fn fade_out_rounding_at_the_last_fraction_keeps_cold_history_restorable() {
    let v = input(2, 1, 0., 0.0025);
    let mut s = LightSelection::new(&v);
    s.advance(&v, &candidates(&[2., 1.]), [0.; 3], 0.);
    let mut history = s.capture();
    history[8] = 1.; // queued replacement
    history[9] = f64::from(0.0005f32);
    history[10] = 3.; // fading out
    assert!(s.restore(&history, &v));
    let time = 0.0005f32 * v[578];
    let dt = f32::from_bits(time.to_bits() - 1);
    s.advance(&v, &candidates(&[1., 2.]), [0.; 3], dt);
    assert_eq!(row(&s, 0), [1., -1., 0., 2.]);
    assert!(LightSelection::new(&v).restore(&s.capture(), &v));
}

#[test]
fn render_previews_zero_steps_and_invalid_delta_do_not_change_history() {
    let v = input(2, 1, 0.1, 0.2);
    let mut a = LightSelection::new(&v);
    let mut b = LightSelection::new(&v);
    let before = a.capture();
    for _ in 0..5 {
        assert_eq!(
            a.display(&v, &candidates(&[2., 1.])).0,
            [Some(0), None, None, None]
        );
    }
    assert_eq!(a.capture(), before);
    for s in [&mut a, &mut b] {
        s.advance(&v, &candidates(&[2., 1.]), [0.; 3], 0.);
    }
    let paused = a.capture();
    for dt in [0., -1., f32::NAN, f32::INFINITY] {
        a.advance(&v, &candidates(&[1., 2.]), [0.; 3], dt);
    }
    assert_eq!(a.capture(), paused);
    a.advance(&v, &candidates(&[1., 2.]), [0.; 3], 0.1);
    b.advance(&v, &candidates(&[1., 2.]), [0.; 3], 0.1);
    assert_eq!(a.capture(), b.capture());
}

#[test]
fn pinned_shadow_owner_cut_reset_and_missing_binding_diagnostics_are_explicit() {
    let mut v = input(3, 2, 0.2, 0.2);
    v[138] = 2.;
    v[579] = 10.;
    let mut s = LightSelection::new(&v);
    let mut data = candidates(&[2., 1., -1.]);
    data.visible[2] = false;
    data.unavailable[2] = 6;
    s.advance(&v, &data, [0.; 3], 0.);
    assert_eq!(row(&s, 0), [2., -1., 1., 1.]);
    assert_eq!(s.diagnostics()[2].reason, 6);
    assert_eq!(s.diagnostics()[2].flags & 1, 1);
    data.scores[1] = 3.;
    s.advance(&v, &data, [20., 0., 0.], 0.);
    assert_eq!(row(&s, 1), [1., -1., 1., 1.]);
    s.reset();
    assert_eq!(s.capture()[2], 0.);
    assert!(s.capture()[3..7].iter().all(|n| *n == 0.));
    s.advance(&v, &data, [0.; 3], 0.);
    v[0] = 0.;
    s.advance(&v, &data, [0.; 3], 0.1);
    assert_eq!(s.capture()[2], 0.);
    assert!(s
        .diagnostics()
        .iter()
        .all(|r| r.reason == 8 && r.weight == 0.));
}

#[test]
fn snapshot_validation_is_atomic_and_preserves_mid_fade_deterministic_replay_without_duplicate_sources(
) {
    let v = input(16, 4, 0.15, 0.2);
    let mut a = LightSelection::new(&v);
    let mut scores = [0.; 16];
    for (i, s) in scores.iter_mut().enumerate() {
        *s = (i + 1) as f32;
    }
    a.advance(&v, &candidates(&scores), [0.; 3], 0.);
    for step in 0..120 {
        for (i, s) in scores.iter_mut().enumerate() {
            *s = (((i * 37 + step * 19) % 79) + 1) as f32 / 10.;
        }
        let data = candidates(&scores);
        a.advance(&v, &data, [0.; 3], 0.03);
        let saved = a.capture();
        let mut b = LightSelection::new(&v);
        assert!(b.restore(&saved, &v));
        let before = b.capture();
        for (at, bad) in [
            (0, 2.),
            (1, -1.),
            (3, 1.5),
            (4, f64::NAN),
            (7, 16.),
            (9, -1e-100),
            (10, 7.),
            (11, saved[7]),
        ] {
            let mut invalid = saved.clone();
            invalid[at] = bad;
            // The duplicate case only applies when both slots carry different active sources.
            assert!(!b.restore(&invalid, &v), "accepted invalid field{at}");
            assert_eq!(b.capture(), before);
        }
        a.advance(&v, &data, [0.; 3], 0.02);
        b.advance(&v, &data, [0.; 3], 0.02);
        assert_eq!(a.capture(), b.capture());
        let (active, _) = a.display(&v, &data);
        let mut unique = std::collections::BTreeSet::new();
        for source in active.into_iter().flatten() {
            assert!(unique.insert(source));
        }
        assert!(unique.len() <= 4);
    }
}
