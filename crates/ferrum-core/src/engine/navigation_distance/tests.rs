use super::{finish, segment};
use crate::components::Transform2D;
use crate::engine::{persistence, Engine};

fn query(e: &mut Engine, index: usize, target: f32) -> bool {
    match index {
        0 => e.query_tilemap_navigation_path(0., 0., target, 0.),
        1 => e.query_tilemap_navigation_path_with_height_span(0., 0., target, 0., 0, 0., 1.),
        2 => e.query_tilemap_navigation_path_between_height_spans(
            0., 0., target, 0., 0, 0., 1., 0, 0., 1.,
        ),
        3 => e.query_tilemap_navigation_waypoint(0., 0., target, 0.),
        _ => e.query_tilemap_navigation_waypoint_with_height_span(0., 0., target, 0., 0, 0., 1.),
    }
}

#[test]
fn navigation_distance_public_finite_centers_have_finite_representable_distance() {
    let mut observations = Vec::new();
    for index in 0..5 {
        let mut engine = Engine::new();
        engine.set_shooter_tilemap_layer(0, 2, 1, 1.0e20, 1., 0., 0., true, vec![0, 0]);
        assert!(query(&mut engine, index, 1.0e20));
        observations.push((
            index,
            engine.physics_query_result.point_x,
            engine.physics_query_result.point_y,
            engine.physics_query_result.distance,
        ));
        let memory = persistence::encode(&engine).unwrap();
        let mut restored = persistence::decode(&memory).unwrap();
        assert!(query(&mut restored, index, 1.0e20));
        assert_eq!(persistence::encode(&restored).unwrap(), memory);
    }
    assert!(
        observations
            .iter()
            .all(|(_, x, y, d)| x.is_finite() && y.is_finite() && d.is_finite()),
        "finite points and a representable distance: {observations:?}"
    );
}

#[test]
fn navigation_distance_unrepresentable_total_uses_existing_false_output_and_recovers() {
    for index in 0..5 {
        let mut e = Engine::new();
        e.set_shooter_tilemap_layer(0, 2, 1, 10., 10., 0., 0., true, vec![0, 0]);
        assert!(e.query_tilemap_navigation_path(0., 0., 10., 0.));
        let old_points = e.frame_buffers.tilemap_navigation_path_points.clone();
        let old_lines = e.frame_buffers.tilemap_navigation_debug_lines.clone();
        e.set_shooter_tilemap_layer(0, 2, 1, 2.2e38, 2.0e38, 0., 0., true, vec![0, 0]);
        assert!(!query(&mut e, index, 2.2e38), "public query {index}");
        assert_eq!(e.physics_query_result.distance, 0.);
        assert_eq!(e.physics_query_result.point_x, 0.);
        assert_eq!(e.physics_query_result.point_y, 0.);
        if index < 3 {
            assert!(e.frame_buffers.tilemap_navigation_path_points.is_empty());
            assert!(e.frame_buffers.tilemap_navigation_debug_lines.is_empty());
        } else {
            // A failed waypoint query has always left earlier path output alone.
            assert_eq!(e.frame_buffers.tilemap_navigation_path_points, old_points);
            assert_eq!(e.frame_buffers.tilemap_navigation_debug_lines, old_lines);
        }
        let memory = persistence::encode(&e).unwrap();
        let mut restored = persistence::decode(&memory).unwrap();
        assert_eq!(persistence::encode(&restored).unwrap(), memory);
        for engine in [&mut e, &mut restored] {
            engine.set_shooter_tilemap_layer(0, 2, 1, 10., 10., 0., 0., true, vec![0, 0]);
            assert!(query(engine, index, 10.));
            assert!(engine.physics_query_result.distance.is_finite());
        }
        assert_eq!(
            persistence::encode(&e).unwrap(),
            persistence::encode(&restored).unwrap()
        );
    }
}

#[test]
fn navigation_distance_ordinary_f32_bits_and_wide_overflow_are_distinct() {
    for scale in [0., 1.0e-20, 0.01, 1., 17.25, 1.0e10, 1.0e19] {
        for seed in 0..128 {
            let from = Transform2D {
                x: (seed as f32 - 63.) * scale,
                y: (31. - seed as f32) * scale,
            };
            let points = std::array::from_fn::<_, 8, _>(|i| Transform2D {
                x: from.x + (i as f32 - 3.) * scale,
                y: from.y + (seed as f32 % 7. - 2.) * scale,
            });
            let mut previous = from;
            let mut legacy = 0.0f32;
            for point in points {
                let step = ((point.x - previous.x).powi(2) + (point.y - previous.y).powi(2)).sqrt();
                if step.is_finite() {
                    assert_eq!(segment(previous, point).unwrap().to_bits(), step.to_bits());
                }
                legacy += step;
                previous = point;
            }
            if legacy.is_finite() {
                assert_eq!(
                    finish(legacy, from, points.into_iter()).unwrap().to_bits(),
                    legacy.to_bits()
                );
            }
        }
    }
    let from = Transform2D { x: 0., y: 0. };
    let mut visited = 0;
    let mut next = Some(Transform2D { x: 1., y: 0. });
    assert_eq!(
        finish(
            1.,
            from,
            std::iter::from_fn(|| {
                visited += 1;
                next.take()
            })
        ),
        Some(1.)
    );
    assert_eq!(
        visited, 0,
        "finite legacy result must not add a path traversal"
    );
    assert_eq!(
        finish(
            f32::INFINITY,
            from,
            [
                Transform2D { x: 1.0e20, y: 0. },
                Transform2D {
                    x: 1.0e20,
                    y: 1.0e20
                }
            ]
            .into_iter()
        ),
        Some(2.0e20)
    );
    assert_eq!(
        segment(from, Transform2D { x: 1.0e20, y: 0. }),
        Some(1.0e20)
    );
    assert_eq!(
        segment(
            Transform2D {
                x: -f32::MAX,
                y: 0.
            },
            Transform2D { x: f32::MAX, y: 0. }
        ),
        None
    );
    let near = Transform2D {
        x: f32::MAX,
        y: 7.0e34,
    };
    let wide = f64::from(near.x).hypot(f64::from(near.y));
    assert!(wide > f64::from(f32::MAX));
    assert_eq!(
        wide as f32,
        f32::MAX,
        "rounding must not hide a range violation"
    );
    assert_eq!(segment(from, near), None);
    assert_eq!(segment(from, Transform2D { x: f32::NAN, y: 0. }), None);
    assert_eq!(
        finish(
            f32::INFINITY,
            from,
            [
                Transform2D { x: f32::MAX, y: 0. },
                Transform2D {
                    x: -f32::MAX,
                    y: 0.
                }
            ]
            .into_iter()
        ),
        None
    );
}
