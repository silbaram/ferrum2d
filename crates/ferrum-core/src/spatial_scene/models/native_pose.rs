//! Native orientation is borrowed at render time; no second simulation pose is retained.
use super::{yaw_sin_cos, ModelBinding, Point};
use crate::physics3d::Pose;

impl ModelBinding {
    /// Compose current native orientation with model-local yaw and uniform scale.
    /// Position already includes the world-space visual anchor offset. Authored model
    /// elevation remains a world-Y offset, matching models without a native body.
    pub(super) fn pose_at_native(&self, pose: Pose) -> Option<([f32; 16], Point, Point)> {
        let [x, y, z, w] = pose.rotation;
        let norm = x * x + y * y + z * z + w * w;
        if !norm.is_finite() || norm <= 0. {
            return None;
        }
        let factor = 2. / norm;
        // Column-major native rotation; the backend uses the same XYZ convention as models.
        let basis = [
            [
                1. - factor * (y * y + z * z),
                factor * (x * y + z * w),
                factor * (x * z - y * w),
            ],
            [
                factor * (x * y - z * w),
                1. - factor * (x * x + z * z),
                factor * (y * z + x * w),
            ],
            [
                factor * (x * z + y * w),
                factor * (y * z - x * w),
                1. - factor * (x * x + y * y),
            ],
        ];
        let (sin, cos) = yaw_sin_cos(self.yaw);
        let mut matrix = [0.; 16];
        for i in 0..3 {
            matrix[i] = (basis[0][i] * cos - basis[2][i] * sin) * self.scale;
            matrix[4 + i] = basis[1][i] * self.scale;
            matrix[8 + i] = (basis[0][i] * sin + basis[2][i] * cos) * self.scale;
            matrix[12 + i] = pose.position[i];
        }
        matrix[13] += self.elevation;
        matrix[15] = 1.;
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for bits in 0..8 {
            let point: Point = std::array::from_fn(|i| {
                if bits & (1 << i) == 0 {
                    self.min[i]
                } else {
                    self.max[i]
                }
            });
            for i in 0..3 {
                let value = matrix[i] * point[0]
                    + matrix[4 + i] * point[1]
                    + matrix[8 + i] * point[2]
                    + matrix[12 + i];
                if !value.is_finite() {
                    return None;
                }
                min[i] = min[i].min(value);
                max[i] = max[i].max(value);
            }
        }
        matrix
            .iter()
            .all(|value| value.is_finite())
            .then_some((matrix, min, max))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding() -> ModelBinding {
        ModelBinding {
            receiver_masks: Default::default(),
            draw_index: None,
            asset: 1,
            flags: 3,
            elevation: 3.,
            yaw: std::f32::consts::FRAC_PI_2,
            scale: 2.,
            min: [0.; 3],
            max: [1., 2., 3.],
        }
    }

    #[test]
    fn quaternion_then_local_yaw_matches_transformed_bounds_and_world_elevation() {
        let half = std::f32::consts::FRAC_1_SQRT_2;
        let (matrix, min, max) = binding()
            .pose_at_native(Pose {
                position: [10., 20., 30.],
                rotation: [half, 0., 0., half],
            })
            .unwrap();
        let expected = [
            0., 2., 0., 0., 0., 0., 2., 0., 2., 0., 0., 0., 10., 23., 30., 1.,
        ];
        for (actual, expected) in matrix.into_iter().zip(expected) {
            assert!((actual - expected).abs() < 1e-5, "{matrix:?}");
        }
        assert_eq!(min, [10., 23., 30.]);
        assert_eq!(max, [16., 25., 34.]);
    }

    #[test]
    fn invalid_or_overflowed_native_products_are_rejected() {
        for rotation in [[0.; 4], [f32::NAN, 0., 0., 1.], [f32::INFINITY, 0., 0., 1.]] {
            assert!(binding()
                .pose_at_native(Pose {
                    rotation,
                    ..Pose::default()
                })
                .is_none());
        }
        let mut model = binding();
        model.max = [f32::MAX; 3];
        assert!(model.pose_at_native(Pose::default()).is_none());
    }
}
