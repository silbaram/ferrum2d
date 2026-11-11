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

#[test]
fn spatial_sun_fixed_center_preserves_coverage_during_pan_zoom_and_capture_restore() {
    let mut engine = setup();
    let baseline = matrix(&mut engine, direction(35., 45.));
    let legacy = engine.capture_spatial_environment();
    let mut anchored = legacy.clone();
    anchored.resize(528, 0.);
    anchored[136] = 4.;
    anchored[138] = -1.;
    anchored[512] = 1.; // Fixed origin, matching the initial camera target.
    assert!(engine.configure_spatial_environment(&anchored));
    engine.build_render_commands();
    assert_eq!(engine.spatial_environment_abi_version(), 5);
    assert_eq!(engine.spatial_environment_len(), 528);
    assert_eq!(engine.spatial_scene.environment.shadow_matrices, baseline);
    for height in [40., 200., 800.] {
        let mut parameters = engine.spatial_scene.camera.as_ref().unwrap().parameters;
        parameters[1] += 300.;
        parameters[4] += 300.;
        parameters[7] = height;
        assert!(engine.configure_spatial_camera(&parameters));
        engine.build_render_commands();
        assert_eq!(engine.spatial_scene.environment.shadow_matrices, baseline);
        assert_eq!(engine.capture_spatial_environment(), anchored);
    }
    assert!(engine.configure_spatial_environment(&legacy));
    engine.build_render_commands();
    assert_ne!(engine.spatial_scene.environment.shadow_matrices, baseline);
    assert_eq!(engine.spatial_environment_abi_version(), 2);
    assert!(engine.configure_spatial_environment(&anchored));
    engine.build_render_commands();
    assert_eq!(engine.spatial_scene.environment.shadow_matrices, baseline);
}

#[test]
fn spatial_sun_fixed_center_rejects_invalid_extensions_atomically() {
    let mut engine = setup();
    matrix(&mut engine, direction(10., 30.));
    let mut good = engine.capture_spatial_environment();
    good.resize(528, 0.);
    good[136] = 4.;
    good[138] = -1.;
    good[512..516].copy_from_slice(&[1., 32., 8., -24.]);
    assert!(engine.configure_spatial_environment(&good));
    for (index, value) in [
        (512, 2.),
        (513, f32::NAN),
        (514, 1_000_001.),
        (515, f32::INFINITY),
        (516, 1.),
        (527, 1.),
        (512, 0.),
        (92, 0.),
    ] {
        let mut bad = good.clone();
        bad[index] = value;
        assert!(
            !engine.configure_spatial_environment(&bad),
            "accepted field {index}"
        );
        assert_eq!(engine.capture_spatial_environment(), good);
    }
    for length in [513, 527, 529] {
        let mut bad = good.clone();
        bad.resize(length, 0.);
        assert!(!engine.configure_spatial_environment(&bad));
        assert_eq!(engine.capture_spatial_environment(), good);
    }
    let mut orphan = good.clone();
    orphan[91..95].fill(0.);
    assert!(!engine.configure_spatial_environment(&orphan));
    assert_eq!(engine.capture_spatial_environment(), good);
}

#[test]
fn spatial_sun_coverage_debug_uses_actual_finite_bounds_and_inner_fade_planes() {
    let mut engine = setup();
    assert!(engine.configure_spatial_debug(128));
    assert!(
        engine.spatial_scene.debug.vertices.capacity() < 64,
        "sun-only diagnostics must not reserve the full 32768-vertex physics budget"
    );
    for elevation in [0., 0.01, 5., 45., 81.8, 81.9, 82., 89.99, 90.] {
        for azimuth in [-135., 0., 45., 90.] {
            let m = matrix(&mut engine, direction(elevation, azimuth));
            let vertices = &engine.spatial_scene.debug.vertices;
            assert!(
                (16..=24).contains(&vertices.len()),
                "missing ground-plane outlines at {elevation}/{azimuth}"
            );
            assert!(!engine.spatial_scene.debug.truncated);
            for vertex in vertices {
                assert_eq!(vertex.position[1], 0.);
                let clip = project(&m, vertex.position);
                let limits = if vertex.color[0] > 0.5 {
                    [
                        1. - 8. / RESOLUTION,
                        1. - 8. / RESOLUTION,
                        1. - 16. * EXTENT / RESOLUTION / 512.,
                    ]
                } else {
                    [1.; 3]
                };
                assert!(clip
                    .iter()
                    .zip(limits)
                    .all(|(v, limit)| v.abs() <= limit + 2e-5));
                assert!(
                    clip.iter()
                        .zip(limits)
                        .any(|(v, limit)| (v.abs() - limit).abs() < 2e-5),
                    "outline vertex is not on the actual map/fade boundary"
                );
            }
        }
    }
    let mut values = engine.capture_spatial_environment();
    values[1] = 1.;
    values[2] = 0.;
    values[3] = 128.;
    values[4] = 0.05;
    values[12..20].copy_from_slice(&[0., 32., 0., 200., 1., 1., 1., 1.]);
    assert!(engine.configure_spatial_environment(&values));
    engine.build_render_commands();
    assert_eq!(engine.spatial_scene.environment.shadow_matrices.len(), 112);
    assert!(
        engine.spatial_debug_len() >= 16,
        "point+sun must use the final sun matrix, not a cube face"
    );
    let sun: [f32; 16] = engine.spatial_scene.environment.shadow_matrices[96..112]
        .try_into()
        .unwrap();
    for vertex in &engine.spatial_scene.debug.vertices {
        let limits = if vertex.color[0] > 0.5 {
            [
                1. - 8. / RESOLUTION,
                1. - 8. / RESOLUTION,
                1. - 16. * EXTENT / RESOLUTION / 512.,
            ]
        } else {
            [1.; 3]
        };
        let clip = project(&sun, vertex.position);
        assert!(clip
            .iter()
            .zip(limits)
            .all(|(v, limit)| v.abs() <= limit + 2e-5));
        assert!(
            clip.iter()
                .zip(limits)
                .any(|(v, limit)| (v.abs() - limit).abs() < 2e-5),
            "point+sun outline must lie on the sun boundary"
        );
    }
    // A point-only frame must not reuse a stale sun outline or mistake a cube face for it.
    let mut point_only = values.clone();
    point_only[91..95].fill(0.);
    assert!(engine.configure_spatial_environment(&point_only));
    engine.build_render_commands();
    assert_eq!(engine.spatial_scene.environment.shadow_matrices.len(), 96);
    assert_eq!(engine.spatial_debug_len(), 0);
    assert!(!engine.spatial_scene.debug.truncated);
    assert!(engine.configure_spatial_environment(&[]));
    engine.build_render_commands();
    assert_eq!(engine.spatial_debug_len(), 0);
    assert!(engine.configure_spatial_environment(&values));
    engine.build_render_commands();
    assert!(engine.spatial_debug_len() >= 16);
    assert!(engine.configure_spatial_debug(0));
    engine.build_render_commands();
    assert_eq!(engine.spatial_debug_len(), 0);
}
