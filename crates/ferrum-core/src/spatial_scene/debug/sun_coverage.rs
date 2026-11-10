//! Ground-plane intersections of the actual finite sun map. Diagnostics only, no shadow policy changes.
use super::{SpatialDebugGeometry, SUN_SHADOW_COVERAGE};

impl SpatialDebugGeometry {
    pub fn sun_shadow_coverage(
        &mut self,
        matrix: &[f32],
        extent: f32,
        distance: f32,
        resolution: f32,
    ) {
        if self.flags & SUN_SHADOW_COVERAGE == 0 {
            return;
        }
        let fade = 8. * extent / resolution;
        for (limits, color) in [
            ([1.; 3], [0., 0.8, 1., 1.]),
            (
                [
                    1. - 8. / resolution,
                    1. - 8. / resolution,
                    // The shader maps clip Z from [-1, 1] to [0, 1].
                    // Its depth edge is (1 - abs(clip_z)) * distance / 2.
                    1. - 2. * fade / distance,
                ],
                [1., 0.7, 0., 1.],
            ),
        ] {
            if limits.iter().any(|v| *v < 0.) {
                continue;
            }
            let Some((points, count)) = ground_cut(matrix, limits) else {
                self.truncated = true;
                continue;
            };
            for i in 0..count {
                self.line(points[i], points[(i + 1) % count], color);
            }
        }
    }
}

/// Intersect the twelve cube edges with elevation zero after inverting its affine matrix.
/// Fixed stack storage avoids per-frame allocation even while diagnostics are enabled.
fn ground_cut(matrix: &[f32], limits: [f32; 3]) -> Option<([[f32; 3]; 12], usize)> {
    if matrix.len() != 16 || matrix.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let row = |r: usize| {
        [
            f64::from(matrix[r]),
            f64::from(matrix[4 + r]),
            f64::from(matrix[8 + r]),
        ]
    };
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let rows = [row(0), row(1), row(2)];
    let inverse = [
        cross(rows[1], rows[2]),
        cross(rows[2], rows[0]),
        cross(rows[0], rows[1]),
    ];
    let det = (0..3).map(|i| rows[0][i] * inverse[0][i]).sum::<f64>();
    if !det.is_finite() || det.abs() < 1e-24 {
        return None;
    }
    let corners: [[f64; 3]; 8] = std::array::from_fn(|bits| {
        let clip: [f64; 3] = std::array::from_fn(|i| {
            f64::from(limits[i]) * if bits & (1 << i) == 0 { -1. } else { 1. }
                - f64::from(matrix[12 + i])
        });
        std::array::from_fn(|i| (0..3).map(|j| inverse[j][i] * clip[j]).sum::<f64>() / det)
    });
    let mut points = [[0.; 3]; 12];
    let mut count = 0;
    let mut append = |mut p: [f64; 3]| {
        p[1] = 0.;
        if points[..count]
            .iter()
            .any(|q: &[f64; 3]| (q[0] - p[0]).hypot(q[2] - p[2]) < 1e-6)
        {
            return;
        }
        if count < points.len() {
            points[count] = p;
            count += 1;
        }
    };
    for (i, a) in corners.iter().copied().enumerate() {
        if a[1] == 0. {
            append(a);
        }
        for axis in 0..3 {
            if i & (1 << axis) != 0 {
                continue;
            }
            let b = corners[i | (1 << axis)];
            if a[1] * b[1] < 0. {
                let t = -a[1] / (b[1] - a[1]);
                append(std::array::from_fn(|j| a[j] + (b[j] - a[j]) * t));
            }
        }
    }
    if count < 3 {
        return Some(([[0.; 3]; 12], 0));
    }
    let center = [
        points[..count].iter().map(|p| p[0]).sum::<f64>() / count as f64,
        points[..count].iter().map(|p| p[2]).sum::<f64>() / count as f64,
    ];
    points[..count].sort_unstable_by(|a, b| {
        (a[2] - center[1])
            .atan2(a[0] - center[0])
            .total_cmp(&(b[2] - center[1]).atan2(b[0] - center[0]))
    });
    let result = points.map(|p| p.map(|v| v as f32));
    result[..count]
        .iter()
        .flatten()
        .all(|v| v.is_finite())
        .then_some((result, count))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_strength_outline_matches_shader_depth_fade_and_can_be_absent() {
        let extent = 64.;
        let resolution = 128.;
        let fade = 8. * extent / resolution;
        for distance in [20., 8., 6.] {
            let matrix = [
                1. / extent,
                0.,
                0.,
                0.,
                0.,
                1. / extent,
                0.,
                0.,
                0.,
                0.,
                2. / distance,
                0.,
                0.,
                0.,
                0.,
                1.,
            ];
            let mut debug = SpatialDebugGeometry::default();
            assert!(debug.configure(SUN_SHADOW_COVERAGE));
            debug.sun_shadow_coverage(&matrix, extent, distance, resolution);
            assert!(!debug.truncated);
            let inner: Vec<_> = debug.vertices.iter().filter(|v| v.color[0] > 0.5).collect();
            if distance <= 2. * fade {
                assert!(inner.is_empty(), "no full-strength depth interior exists");
                assert_eq!(
                    debug.vertices.len(),
                    8,
                    "the outer boundary remains visible"
                );
                continue;
            }
            assert_eq!(inner.len(), 8);
            for vertex in inner {
                // Independent shader-space calculation, including the clip-to-UV mapping.
                let q: [f32; 3] = std::array::from_fn(|row| {
                    let clip = matrix[12 + row]
                        + (0..3)
                            .map(|i| matrix[i * 4 + row] * vertex.position[i])
                            .sum::<f32>();
                    clip * 0.5 + 0.5
                });
                let xy_edge = q[0].min(1. - q[0]).min(q[1].min(1. - q[1])) * 2. * extent;
                let depth_edge = q[2].min(1. - q[2]) * distance;
                assert!(
                    (xy_edge.min(depth_edge) - fade).abs() < 1e-4,
                    "full-strength outline must match the shader fade width"
                );
            }
        }
        // At distance == 2 * fade the interior collapses to a plane. If that plane
        // is the ground, its 2D full-strength area still has a meaningful outline.
        let distance = 2. * fade;
        let matrix = [
            1. / extent,
            0.,
            0.,
            0.,
            0.,
            0.,
            2. / distance,
            0.,
            0.,
            1. / extent,
            0.,
            0.,
            0.,
            0.,
            0.,
            1.,
        ];
        let mut debug = SpatialDebugGeometry::default();
        assert!(debug.configure(SUN_SHADOW_COVERAGE));
        debug.sun_shadow_coverage(&matrix, extent, distance, resolution);
        assert_eq!(debug.vertices.len(), 16);
        for vertex in debug.vertices.iter().filter(|v| v.color[0] > 0.5) {
            assert_eq!(vertex.position[1], 0.);
            assert_eq!(vertex.position[0].abs(), extent - fade);
            assert_eq!(vertex.position[2].abs(), extent - fade);
        }
    }
    #[test]
    fn ground_cut_is_finite_for_tilted_nearly_horizontal_and_vertical_maps() {
        for elevation in [0_f32, 0.01, 5., 45., 81.8, 81.9, 82., 89.99, 90.] {
            let (s, c) = elevation.to_radians().sin_cos();
            let matrix = [
                1. / 64.,
                0.,
                0.,
                0.,
                0.,
                s / 64.,
                c / 1200.,
                0.,
                0.,
                -c / 64.,
                s / 1200.,
                0.,
                0.,
                0.,
                0.,
                1.,
            ];
            let (points, count) = ground_cut(&matrix, [1.; 3]).unwrap();
            assert!((3..=6).contains(&count));
            for p in &points[..count] {
                assert_eq!(p[1], 0.);
                for row in 0..3 {
                    let clip =
                        matrix[12 + row] + (0..3).map(|i| matrix[i * 4 + row] * p[i]).sum::<f32>();
                    assert!(
                        clip.abs() <= 1.00001,
                        "{elevation}: outside clip bounds {clip}"
                    );
                }
            }
        }
    }
    #[test]
    fn ground_cut_handles_empty_coplanar_and_invalid_volumes() {
        let mut matrix = [
            1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
        ];
        assert_eq!(ground_cut(&matrix, [1.; 3]).unwrap().1, 4);
        matrix[13] = 1.;
        assert_eq!(ground_cut(&matrix, [1.; 3]).unwrap().1, 4);
        matrix[13] = 2.;
        assert_eq!(ground_cut(&matrix, [1.; 3]).unwrap().1, 0);
        matrix[0] = 0.;
        assert!(ground_cut(&matrix, [1.; 3]).is_none());
        matrix[0] = f32::NAN;
        assert!(ground_cut(&matrix, [1.; 3]).is_none());
    }
}
