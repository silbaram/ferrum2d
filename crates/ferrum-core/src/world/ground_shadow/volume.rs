//! Bounded convex projection of a footprint, walls and an optional gable roof.
use super::GroundShadowProjection;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GroundShadowVolume {
    pub depth: f32,
    pub roof_height: f32,
    pub offset_x: f32,
    pub offset_y: f32,
}

/// Screen-space triangles. This optional sidecar does not change the sprite command ABI.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct GroundShadowVolumeVertex {
    pub x: f32,
    pub y: f32,
    pub opacity: f32,
}
const _: () = assert!(core::mem::size_of::<GroundShadowVolumeVertex>() == 12);
const _: () = assert!(core::mem::align_of::<GroundShadowVolumeVertex>() == 4);

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GroundShadowHull {
    pub foot: [f32; 2],
    pub points: [[f32; 2]; 10],
    pub len: usize,
}

impl GroundShadowVolume {
    pub fn project(
        self,
        foot: [f32; 2],
        width: f32,
        wall_height: f32,
        rotation: f32,
        sun: GroundShadowProjection,
    ) -> GroundShadowHull {
        let (sin, cos) = rotation.sin_cos();
        let mut points = [[0.0; 2]; 10];
        // Base and eaves have a fixed ground orientation. Only height displaces
        // their projection along the sun; the footprint never turns with it.
        for (i, point) in points.iter_mut().take(8).enumerate() {
            let x = if i & 1 == 0 {
                -width * 0.5
            } else {
                width * 0.5
            };
            let y = if i & 2 == 0 {
                -self.depth * 0.5
            } else {
                self.depth * 0.5
            };
            let height = if i < 4 { 0.0 } else { wall_height };
            *point = self.project_point(x, y, height, sin, cos, sun);
        }
        for (i, point) in points.iter_mut().skip(8).enumerate() {
            let y = if i == 0 {
                -self.depth * 0.5
            } else {
                self.depth * 0.5
            };
            *point = self.project_point(0.0, y, wall_height + self.roof_height, sin, cos, sun);
        }
        let mut hull = GroundShadowHull {
            foot,
            points: [[0.0; 2]; 10],
            len: 0,
        };
        if !points
            .iter()
            .flatten()
            .chain(foot.iter())
            .all(|v| v.is_finite())
        {
            return hull;
        }
        points.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
        let mut unique = 0;
        for i in 0..points.len() {
            if unique == 0 || points[i] != points[unique - 1] {
                points[unique] = points[i];
                unique += 1;
            }
        }
        if unique < 3 {
            return hull;
        }
        let mut chain = [[0.0; 2]; 20];
        let mut len = 0;
        for &point in &points[..unique] {
            while len >= 2 && cross(chain[len - 2], chain[len - 1], point) <= 0.0 {
                len -= 1;
            }
            chain[len] = point;
            len += 1;
        }
        let upper = len + 1;
        for &point in points[..unique - 1].iter().rev() {
            while len >= upper && cross(chain[len - 2], chain[len - 1], point) <= 0.0 {
                len -= 1;
            }
            chain[len] = point;
            len += 1;
        }
        len -= 1; // The closing point is the first vertex, not another triangle.
        hull.points[..len].copy_from_slice(&chain[..len]);
        hull.len = len;
        hull
    }

    fn project_point(
        self,
        x: f32,
        y: f32,
        height: f32,
        sin: f32,
        cos: f32,
        sun: GroundShadowProjection,
    ) -> [f32; 2] {
        let x = x + self.offset_x;
        let y = y + self.offset_y;
        let displacement = height * sun.length_scale;
        [
            x * cos - y * sin + sun.direction_x * displacement,
            x * sin + y * cos + sun.direction_y * displacement,
        ]
    }
}

fn cross(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f64 {
    // Small, almost collinear roof/footprint edges should not change winding.
    (f64::from(b[0]) - f64::from(a[0])) * (f64::from(c[1]) - f64::from(a[1]))
        - (f64::from(b[1]) - f64::from(a[1])) * (f64::from(c[0]) - f64::from(a[0]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_sun_rotation_contains_the_fixed_footprint_and_closes_continuously() {
        let volume = GroundShadowVolume {
            depth: 30.0,
            roof_height: 40.0,
            offset_x: 0.0,
            offset_y: -15.0,
        };
        let mut first = None;
        for degree in 0..=360 {
            let angle = (degree as f32).to_radians();
            let hull = volume.project(
                [25.0, 80.0],
                86.0,
                52.0,
                0.0,
                GroundShadowProjection {
                    direction_x: angle.cos(),
                    direction_y: angle.sin(),
                    length_scale: 0.7,
                },
            );
            assert!((4..=10).contains(&hull.len));
            assert_eq!(hull.foot, [25.0, 80.0]);
            for point in [[-43.0, -30.0], [43.0, -30.0], [-43.0, 0.0], [43.0, 0.0]] {
                for i in 0..hull.len {
                    assert!(
                        cross(hull.points[i], hull.points[(i + 1) % hull.len], point) >= -0.001,
                        "footprint escaped at {degree} degrees"
                    );
                }
            }
            if degree == 0 {
                first = Some(hull);
            }
            if degree == 360 {
                let start = first.unwrap();
                // Trig roundoff may split a collinear edge into extra vertices.
                // Compare the actual footprint/extent, not its tessellation count.
                for axis in 0..2 {
                    let bounds = |h: GroundShadowHull| {
                        h.points[..h.len]
                            .iter()
                            .map(|p| p[axis])
                            .fold([f32::INFINITY, f32::NEG_INFINITY], |a, v| {
                                [a[0].min(v), a[1].max(v)]
                            })
                    };
                    for (a, b) in bounds(hull).into_iter().zip(bounds(start)) {
                        assert!((a - b).abs() < 0.0001);
                    }
                }
            }
        }
    }

    #[test]
    fn roof_changes_the_projected_extent_without_moving_the_base() {
        let flat = GroundShadowVolume {
            depth: 30.0,
            roof_height: 0.0,
            offset_x: 0.0,
            offset_y: -15.0,
        };
        let sun = GroundShadowProjection {
            direction_x: 1.0,
            direction_y: 0.0,
            length_scale: 1.0,
        };
        let a = flat.project([0.0; 2], 86.0, 52.0, 0.0, sun);
        let b = GroundShadowVolume {
            roof_height: 80.0,
            ..flat
        }
        .project([0.0; 2], 86.0, 52.0, 0.0, sun);
        let max_x = |h: GroundShadowHull| {
            h.points[..h.len]
                .iter()
                .map(|p| p[0])
                .fold(f32::NEG_INFINITY, f32::max)
        };
        assert_eq!(max_x(a), 95.0);
        assert_eq!(max_x(b), 132.0);
    }
}
