use super::*;
use crate::physics3d::p1b_tests::{report, TraceHash, MODES};
use std::time::Instant;

#[test]
#[ignore = "P1b compares two 405-tick replays of the native crowd in both modes"]
fn p1b_compare_crowd_64() {
    const FRAMES: usize = 81;
    const FRAME_SECONDS: f64 = 0.05;
    const DT: f32 = 0.01;
    for mode in MODES {
        let mut hashes = Vec::new();
        let mut checkpoint_hashes = Vec::new();
        for repeat in 0..2 {
            let (mut e, actors, primary) = dense_scene(WorldConfig {
                gravity: [0., -10., 0.],
                step_seconds: DT,
                ..Default::default()
            });
            assert_eq!(actors.len(), 64);
            mode.configure(&mut e.unified_physics.as_mut().unwrap().physics);
            enable_dense_navigation(&mut e, &actors, primary);
            for _ in 0..4 {
                e.step_rigid_bodies(DT);
                assert!(e.take_unified_physics_error().is_none());
            }
            let initial = positions(&e, &actors);
            let goal = e.unified_body_state(primary).unwrap().pose.position;
            let mut hash = TraceHash::new();
            for &position in &initial {
                hash.values(position);
            }
            let mut frames_with_error = 0;
            let mut frame_times = Vec::new();
            e.unified_physics
                .as_mut()
                .unwrap()
                .physics
                .observe_p1b_ticks();
            for _ in 0..FRAMES {
                let start = (!cfg!(debug_assertions)).then(Instant::now);
                e.update(FRAME_SECONDS);
                if let Some(t) = start {
                    frame_times.push(t.elapsed().as_secs_f64() * 1e6);
                }
                assert_eq!(e.last_fixed_update.steps, 5);
                frames_with_error += usize::from(e.take_unified_physics_error().is_some());
                for position in positions(&e, &actors) {
                    hash.values(position);
                }
            }
            for value in e.data_scene_combat_navigation_stats() {
                hash.bytes(&value.to_le_bytes());
            }
            let checkpoint = persistence::encode(&e).map(|bytes| {
                let mut hash = TraceHash::new();
                hash.bytes(&bytes);
                hash.finish()
            });
            let samples = e.unified_physics.as_mut().unwrap().physics.take_p1b_ticks();
            assert_eq!(samples.len(), 405);
            let hash = hash.finish();
            hashes.push(hash);
            checkpoint_hashes.push(checkpoint);
            if repeat == 0 {
                let final_positions = positions(&e, &actors);
                let distance = |p: &[f32; 3]| (p[0] - goal[0]).hypot(p[2] - goal[2]);
                let progress: Vec<_> = initial
                    .iter()
                    .zip(&final_positions)
                    .map(|(a, b)| distance(a) - distance(b))
                    .collect();
                let min_progress = progress.iter().copied().reduce(f32::min).unwrap();
                let total_progress = progress.iter().sum::<f32>();
                let time = frame_times
                    .iter()
                    .copied()
                    .reduce(f64::max)
                    .map(|max| (frame_times.iter().sum::<f64>() / FRAMES as f64, max));
                println!("P1B_CROWD mode={mode:?} frames={FRAMES} frames_with_error={frames_with_error} min_progress={min_progress:.7} total_progress={total_progress:.7} frame_us={time:?} checkpoint={:?}", checkpoint_hashes[0].as_ref().map(|hash| format!("{hash:016x}")));
                report("crowd-64", mode, &samples, hash);
            }
        }
        assert_eq!(hashes[0], hashes[1], "crowd-64 {mode:?}");
        assert_eq!(
            checkpoint_hashes[0], checkpoint_hashes[1],
            "crowd-64 checkpoint {mode:?}"
        );
    }
}
