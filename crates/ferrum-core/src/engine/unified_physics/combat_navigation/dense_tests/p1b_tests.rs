use super::*;

#[test]
fn native_crowd_replays_64_actors_through_405_ticks() {
    const DT: f32 = 0.01;
    let (mut first, actors, primary) = dense_scene(WorldConfig {
        gravity: [0., -10., 0.],
        step_seconds: DT,
        ..Default::default()
    });
    assert_eq!(actors.len(), 64);
    enable_dense_navigation(&mut first, &actors, primary);
    for _ in 0..4 {
        first.step_rigid_bodies(DT);
        assert!(first.take_unified_physics_error().is_none());
    }
    let initial = positions(&first, &actors);
    let goal = first.unified_body_state(primary).unwrap().pose.position;
    let mut second = file_clone(&first);
    for frame in 0..81 {
        for engine in [&mut first, &mut second] {
            engine.update(0.05);
            assert_eq!(engine.last_fixed_update.steps, 5, "frame {frame}");
            assert!(
                engine.take_unified_physics_error().is_none(),
                "frame {frame}"
            );
        }
        assert_eq!(
            positions(&first, &actors),
            positions(&second, &actors),
            "frame {frame}"
        );
        assert_eq!(
            first.data_scene_combat_navigation_stats(),
            second.data_scene_combat_navigation_stats()
        );
    }
    assert_eq!(bytes(&first), bytes(&second));
    let distance = |p: &[f32; 3]| (p[0] - goal[0]).hypot(p[2] - goal[2]);
    let progress: f32 = initial
        .iter()
        .zip(positions(&first, &actors))
        .map(|(start, end)| distance(start) - distance(&end))
        .sum();
    assert!(progress > 0., "total crowd progress={progress}");
}
