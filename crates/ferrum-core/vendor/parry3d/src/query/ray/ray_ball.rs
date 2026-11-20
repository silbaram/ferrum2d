use crate::math::{ComplexField, Real, Vector};
use crate::query::{Ray, RayCast, RayIntersection};
use crate::shape::{Ball, FeatureId};
use num::Zero;

impl RayCast for Ball {
    #[inline]
    fn cast_local_ray(&self, ray: &Ray, max_time_of_impact: Real, solid: bool) -> Option<Real> {
        ray_toi_with_ball(Vector::ZERO, self.radius, ray, solid)
            .1
            .filter(|time_of_impact| *time_of_impact <= max_time_of_impact)
    }

    #[inline]
    fn cast_local_ray_and_get_normal(
        &self,
        ray: &Ray,
        max_time_of_impact: Real,
        solid: bool,
    ) -> Option<RayIntersection> {
        ray_toi_and_normal_with_ball(Vector::ZERO, self.radius, ray, solid)
            .1
            .filter(|int| int.time_of_impact <= max_time_of_impact)
    }
}

/// Computes the time of impact of a ray on a ball.
///
/// The first result element is `true` if the ray started inside of the ball.
#[inline]
pub fn ray_toi_with_ball(
    center: Vector,
    radius: Real,
    ray: &Ray,
    solid: bool,
) -> (bool, Option<Real>) {
    let dcenter = ray.origin - center;

    let a = ray.dir.length_squared();
    let b = dcenter.dot(ray.dir);
    let c = dcenter.length_squared() - radius * radius;

    // Special case for when the dir is zero.
    if a.is_zero() {
        if c > 0.0 {
            return (false, None);
        } else {
            return (true, Some(0.0));
        }
    }

    if c > 0.0 && b > 0.0 {
        (false, None)
    } else {
        let delta = b * b - a * c;

        if delta < 0.0 {
            // no solution
            (false, None)
        } else {
            let t = (-b - <Real as ComplexField>::sqrt(delta)) / a;

            if t <= 0.0 {
                // origin inside of the ball
                if solid {
                    (true, Some(0.0))
                } else {
                    (true, Some((-b + delta.sqrt()) / a))
                }
            } else {
                (false, Some(t))
            }
        }
    }
}

/// Computes the time of impact and contact normal of a ray on a ball.
#[inline]
pub fn ray_toi_and_normal_with_ball(
    center: Vector,
    radius: Real,
    ray: &Ray,
    solid: bool,
) -> (bool, Option<RayIntersection>) {
    let (inside, inter) = ray_toi_with_ball(center, radius, ray, solid);

    (
        inside,
        inter.map(|n| {
            let pos = ray.origin + ray.dir * n - center;
            // At the center (including solid TOI=0), the normal is undefined.
            // Match the finite zero fallback already used for capsule rays.
            let normal = pos.normalize_or_zero();

            RayIntersection::new(n, if inside { -normal } else { normal }, FeatureId::Face(0))
        }),
    )
}

#[cfg(all(test, feature = "dim3"))]
mod ferrum_tests {
    use super::*;

    #[test]
    fn ball_ray_center_returns_finite_zero_normal() {
        for center in [Vector::ZERO, Vector::new(2., -1., 3.)] {
            for direction in [Vector::X, -Vector::X, Vector::new(1., 2., 3.), Vector::ZERO] {
                let ray = Ray::new(center, direction);
                let (inside, hit) = ray_toi_and_normal_with_ball(center, 0.5, &ray, true);
                let hit = hit.unwrap();
                assert!(inside);
                assert_eq!(hit.time_of_impact, 0.);
                assert!(hit.normal.is_finite());
                assert_eq!(hit.normal, Vector::ZERO);
            }
        }
    }

    #[test]
    fn ball_ray_defined_normals_preserve_original_bits_and_toi() {
        let mut compared = 0;
        for radius in [0.125, 0.5, 2.] {
            for origin in [
                Vector::new(-2. * radius, 0., 0.),
                Vector::new(0., 0.25 * radius, 0.),
                Vector::new(0., -0.25 * radius, 0.25 * radius),
                Vector::ZERO,
            ] {
                for direction in [Vector::X, -Vector::X, Vector::Y, Vector::new(1., 0.3, -0.2)] {
                    for solid in [false, true] {
                        let ray = Ray::new(origin, direction);
                        let (inside, toi) = ray_toi_with_ball(Vector::ZERO, radius, &ray, solid);
                        let (actual_inside, actual) =
                            ray_toi_and_normal_with_ball(Vector::ZERO, radius, &ray, solid);
                        assert_eq!(inside, actual_inside);
                        assert_eq!(
                            toi.map(|v| v.to_bits()),
                            actual.as_ref().map(|v| v.time_of_impact.to_bits())
                        );
                        if let Some(toi) = toi {
                            let original = (origin + direction * toi).normalize();
                            if original.is_finite() {
                                let original = if inside { -original } else { original };
                                assert_eq!(
                                    actual.unwrap().normal.to_array().map(|v| v.to_bits()),
                                    original.to_array().map(|v| v.to_bits())
                                );
                                compared += 1;
                            }
                        }
                    }
                }
            }
        }
        assert!(compared >= 64);
    }
}
