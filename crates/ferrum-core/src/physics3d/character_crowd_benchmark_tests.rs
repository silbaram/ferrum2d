use super::*;
use std::time::Instant;

#[test]
#[ignore = "release-only crowd timing; use --ignored --nocapture"]
fn p2b_crowd_tick_benchmark() {
    for (side, spacing) in [(16, 0.6), (32, 0.6), (32, 1.2)] {
        let count = side * side;
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            max_characters: count,
            ..WorldConfig::default()
        })
        .unwrap();
        for row in 0..side {
            for column in 0..side {
                let id = world
                    .create_body(
                        BodyDesc {
                            kind: BodyKind::KinematicPosition,
                            pose: Pose {
                                position: [column as f32 * spacing, 0., row as f32 * spacing],
                                ..Pose::default()
                            },
                            ..BodyDesc::default()
                        },
                        ColliderDesc::new(Shape::Capsule {
                            half_height: 0.25,
                            radius: 0.25,
                        }),
                    )
                    .unwrap();
                world
                    .enable_character(id, CharacterConfig::default())
                    .unwrap();
                world
                    .set_character_input(
                        id,
                        CharacterInput {
                            velocity: [1., 0., 0.],
                            ..CharacterInput::default()
                        },
                    )
                    .unwrap();
            }
        }
        let mut sum = 0.;
        let mut max = 0.0_f64;
        let mut ticks = 0;
        for tick in 0..120 {
            let start = Instant::now();
            let result = world.step_checked();
            let ms = start.elapsed().as_secs_f64() * 1000.;
            if let Err(error) = result {
                println!("P2B_CROWD count={count} spacing={spacing} rejection={error:?} tick={} elapsed_ms={ms:.4}", tick + 1);
                break;
            }
            if tick >= 20 {
                sum += ms;
                max = max.max(ms);
                ticks += 1;
            }
        }
        if ticks > 0 {
            println!("P2B_CROWD count={count} spacing={spacing} ticks={ticks} mean_ms={:.4} max_ms={max:.4}", sum / f64::from(ticks));
        }
    }
}
