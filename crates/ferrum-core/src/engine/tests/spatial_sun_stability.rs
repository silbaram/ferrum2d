use super::*;

const EXTENT: f32 = 64.;
const RESOLUTION: f32 = 512.;

fn camera(engine: &mut Engine, center: [f32; 3], eye_offset: [f32; 3]) {
    assert!(engine.configure_spatial_camera(&[
        0.,
        center[0] + eye_offset[0],
        center[1] + eye_offset[1],
        center[2] + eye_offset[2],
        center[0],
        center[1],
        center[2],
        200.,
        0.1,
        1000.,
        400.,
        300.,
    ]));
}

fn setup() -> Engine {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(400., 300.);
    camera(&mut engine, [0.; 3], [0., 160., 200.]);
    engine
}

fn matrix(engine: &mut Engine, direction: [f32; 3]) -> [f32; 16] {
    let mut values = vec![0.; 112];
    values[0] = 1.;
    values[2] = -1.;
    values[60..76].copy_from_slice(&[
        100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
    ]);
    values[83..95].copy_from_slice(&[
        1.,
        direction[0],
        direction[1],
        direction[2],
        1.,
        1.,
        1.,
        1.,
        512.,
        RESOLUTION,
        0.05,
        EXTENT,
    ]);
    assert!(engine.configure_spatial_environment(&values));
    engine.build_render_commands();
    assert_eq!(engine.capture_spatial_environment(), values);
    engine
        .spatial_scene
        .environment
        .shadow_matrices
        .as_slice()
        .try_into()
        .expect("one directional shadow matrix")
}

fn direction(elevation: f32, azimuth: f32) -> [f32; 3] {
    let (sin_elevation, cos_elevation) = elevation.to_radians().sin_cos();
    let (sin_azimuth, cos_azimuth) = azimuth.to_radians().sin_cos();
    [
        cos_elevation * cos_azimuth,
        sin_elevation,
        cos_elevation * sin_azimuth,
    ]
}

fn axis(matrix: &[f32; 16], row: usize) -> [f32; 3] {
    std::array::from_fn(|i| matrix[i * 4 + row] * EXTENT)
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a.into_iter().zip(b).map(|(x, y)| x * y).sum()
}

fn project(matrix: &[f32; 16], point: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|row| {
        matrix[12 + row] + (0..3).map(|i| matrix[i * 4 + row] * point[i]).sum::<f32>()
    })
}

#[test]
fn spatial_sun_stability_has_no_basis_jump_at_the_old_up_axis_threshold() {
    let mut engine = setup();
    for azimuth in [0., 30., 45., 90., 180., 270.] {
        let before = matrix(
            &mut engine,
            direction(0.9899_f32.asin().to_degrees(), azimuth),
        );
        let after = matrix(
            &mut engine,
            direction(0.9901_f32.asin().to_degrees(), azimuth),
        );
        for row in 0..2 {
            assert!(
                dot(axis(&before, row), axis(&after, row)) > 0.999,
                "sun sampling basis jumped at azimuth {azimuth}, row {row}"
            );
        }
        for point in [[55., 0., 55.], [-55., 16., 55.]] {
            let a = project(&before, point);
            let b = project(&after, point);
            for i in 0..2 {
                assert!(
                    (a[i] - b[i]).abs() < 2. / RESOLUTION,
                    "fixed receiver moved more than a shadow texel at azimuth {azimuth}"
                );
            }
        }
    }
}

#[test]
fn spatial_sun_stability_is_continuous_through_zenith_and_the_horizon() {
    let mut engine = setup();
    for azimuth in [0., 45., 90., 180., 270.] {
        for elevations in [[-0.01, 0., 0.01], [89.99, 90., 90.01]] {
            let mut previous = matrix(&mut engine, direction(elevations[0], azimuth));
            for elevation in &elevations[1..] {
                let next = matrix(&mut engine, direction(*elevation, azimuth));
                for row in 0..2 {
                    assert!(
                        dot(axis(&previous, row), axis(&next, row)) > 0.99999,
                        "basis jumped at elevation {elevation}, azimuth {azimuth}"
                    );
                }
                previous = next;
            }
        }
    }
}

#[test]
fn spatial_sun_stability_basis_is_orthonormal_and_finite_including_both_poles() {
    let mut engine = setup();
    for direction in [
        [0., 1., 0.],
        [0., -1., 0.],
        [1., 0., 0.],
        [0., 0., 1.],
        [1e-20, 1., -1e-20],
        [1e-20, -1., -1e-20],
        direction(81.9, 45.),
        direction(-89.99, 45.),
        direction(0., 45.),
    ] {
        let m = matrix(&mut engine, direction);
        let r = axis(&m, 0);
        let u = axis(&m, 1);
        assert!(m.iter().all(|value| value.is_finite()));
        for error in [
            dot(r, r) - 1.,
            dot(u, u) - 1.,
            dot(r, u),
            dot(r, direction),
            dot(u, direction),
        ] {
            assert!(
                error.abs() < 1e-5,
                "invalid light basis for {direction:?}: {error}"
            );
        }
        let center = project(&m, [0.; 3]);
        assert!(center.into_iter().all(|value| value.abs() < 1e-5));
    }
}

#[test]
fn spatial_sun_stability_preserves_texel_snapping_and_camera_rotation_independence() {
    let mut engine = setup();
    let sun = direction(60., 35.);
    let baseline = matrix(&mut engine, sun);
    camera(&mut engine, [0.; 3], [200., 160., 0.]);
    assert_eq!(
        matrix(&mut engine, sun),
        baseline,
        "camera orbit changed the sun matrix"
    );
    let r = axis(&baseline, 0);
    let texel = EXTENT * 2. / RESOLUTION;
    for (fraction, expected_shift) in [(0.1, 0.), (0.6, -2. / RESOLUTION)] {
        camera(
            &mut engine,
            r.map(|v| v * texel * fraction),
            [0., 160., 200.],
        );
        let moved = matrix(&mut engine, sun);
        let a = project(&baseline, [12., 0., 16.]);
        let b = project(&moved, [12., 0., 16.]);
        assert!((b[0] - a[0] - expected_shift).abs() < 1e-5);
        assert!((b[1] - a[1]).abs() < 1e-5);
        assert!((b[2] - a[2]).abs() < 1e-5);
    }
}
