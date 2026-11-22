// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
use crate::math::{Pose, Real, Vector};
use crate::query::details;
use crate::query::details::ShapeCastOptions;
use crate::query::gjk::{self, VoronoiSimplex};
use crate::query::{ShapeCastHit, ShapeCastStatus};
use crate::shape::{RoundShapeRef, SupportMap};
use num::Zero;

/// Time of impacts between two support-mapped shapes under translational movement.
pub fn cast_shapes_support_map_support_map<G1, G2>(
    pos12: &Pose,
    vel12: Vector,
    g1: &G1,
    g2: &G2,
    options: ShapeCastOptions,
) -> Option<ShapeCastHit>
where
    G1: ?Sized + SupportMap,
    G2: ?Sized + SupportMap,
{
    let gjk_result = if options.target_distance > 0.0 {
        let round_g1 = RoundShapeRef {
            inner_shape: g1,
            border_radius: options.target_distance,
        };
        gjk::directional_distance(pos12, &round_g1, g2, vel12, &mut VoronoiSimplex::new())
    } else {
        gjk::directional_distance(pos12, g1, g2, vel12, &mut VoronoiSimplex::new())
    };

    gjk_result.and_then(|(time_of_impact, normal1, witness1, witness2)| {
        if time_of_impact > options.max_time_of_impact {
            None
        } else if (options.compute_impact_geometry_on_penetration || !options.stop_at_penetration)
            && time_of_impact < 1.0e-4
        {
            // The GJK-derived normal becomes unreliable for very small TOIs — typically
            // when the cast starts at (or very close to) the `target_distance` boundary
            // with a direction nearly tangent to the contact. Fall back on the contact
            // query, which gives a robust closest-point normal and lets us detect the
            // case where the cast direction is actually moving away from the contact.
            let contact = details::contact_support_map_support_map(pos12, g1, g2, Real::MAX)?;
            let normal_vel = contact.normal1.dot(vel12);

            if !options.stop_at_penetration && normal_vel >= 0.0 {
                None
            } else {
                Some(ShapeCastHit {
                    time_of_impact,
                    normal1: contact.normal1,
                    normal2: contact.normal2,
                    witness1: contact.point1,
                    witness2: contact.point2,
                    // A cast starting exactly touching, neither penetrating nor within
                    // the target distance, converged like ball-ball does.
                    status: if contact.dist < options.target_distance {
                        ShapeCastStatus::PenetratingOrWithinTargetDist
                    } else {
                        ShapeCastStatus::Converged
                    },
                    subshape1: 0,
                    subshape2: 0,
                })
            }
        } else {
            Some(ShapeCastHit {
                time_of_impact,
                normal1,
                normal2: pos12.rotation.inverse() * -normal1,
                witness1: witness1 - normal1 * options.target_distance,
                witness2: pos12.inverse_transform_point(witness2),
                status: if time_of_impact.is_zero() {
                    // A zero TOI means either a real penetration (or a start within the
                    // target distance) or a mere touching contact; only the former is
                    // `PenetratingOrWithinTargetDist`, as for ball-ball.
                    match details::contact_support_map_support_map(pos12, g1, g2, Real::MAX) {
                        Some(contact) if contact.dist >= options.target_distance => {
                            ShapeCastStatus::Converged
                        }
                        _ => ShapeCastStatus::PenetratingOrWithinTargetDist,
                    }
                } else {
                    ShapeCastStatus::Converged
                },
                subshape1: 0,
                subshape2: 0,
            })
        }
    })
}

#[cfg(all(test, feature = "dim3", feature = "f32"))]
mod ferrum_near_origin_tests {
    use super::*;
    use crate::shape::{Capsule, Cuboid, RoundShape, SupportMap};
    use core::cell::Cell;

    fn geometry(scale: Real) -> (Pose, Cuboid, Capsule, Vector) {
        (
            Pose::translation(-10. * scale, 0.6101 * scale, 10. * scale),
            Cuboid::new(Vector::new(20., 0.1, 20.) * scale),
            Capsule::new_y(0.25 * scale, 0.25 * scale),
            Vector::new(0., -0.09892499, 0.008333334).normalize(),
        )
    }
    fn options(scale: Real) -> ShapeCastOptions {
        ShapeCastOptions {
            max_time_of_impact: 0.1 * scale,
            target_distance: 0.01 * scale,
            stop_at_penetration: false,
            compute_impact_geometry_on_penetration: true,
        }
    }

    #[test]
    fn near_origin_oblique_capsule_box_cast_has_analytic_positive_toi() {
        for scale in [0.25, 1., 4.] {
            let (p, box_shape, capsule, direction) = geometry(scale);
            let hit = cast_shapes_support_map_support_map(
                &p,
                direction,
                &box_shape,
                &capsule,
                options(scale),
            )
            .expect("real approaching face must not be lost on simplex stagnation");
            let expected = (p.translation.y - 0.6 * scale - 0.01 * scale) / -direction.y;
            assert!(hit.time_of_impact > 0.00008 * scale, "{scale}: {hit:?}");
            assert!(
                (hit.time_of_impact - expected).abs() < 1e-5 * scale,
                "{scale}: {hit:?}, expected={expected}"
            );
            assert!(hit.normal1.dot(Vector::Y) > 0.9999, "{hit:?}");
            assert!(
                (hit.witness1.y - 0.1 * scale).abs() < 2e-5 * scale,
                "{hit:?}"
            );
            let impact = p * hit.witness2 + direction * hit.time_of_impact;
            assert!(
                (impact.y - 0.11 * scale).abs() < 2e-5 * scale,
                "{hit:?}, impact={impact:?}"
            );
        }
    }

    #[test]
    fn horizontal_dominant_approaches_do_not_hide_the_floor_separation_axis() {
        let (p, box_shape, capsule, _) = geometry(1.);
        for displacement in [
            Vector::new(0., -0.00048069, 0.0035),
            Vector::new(0., -0.09892499, 0.5),
            Vector::new(0.2, -0.09892499, 0.5),
        ] {
            let direction = displacement.normalize();
            let mut opts = options(1.);
            opts.max_time_of_impact = displacement.length();
            let hit =
                cast_shapes_support_map_support_map(&p, direction, &box_shape, &capsule, opts)
                    .expect("horizontal ray dominance is not the floor's separation axis");
            let expected = (p.translation.y - 0.61) / -direction.y;
            assert!(
                (hit.time_of_impact - expected).abs() < 3e-5,
                "{displacement:?}: {hit:?}, expected={expected}"
            );
            assert!(hit.time_of_impact > 0.);
            assert!(hit.normal1.dot(Vector::Y) > 0.99, "{hit:?}");
        }
    }

    #[test]
    fn near_origin_cast_keeps_short_max_toi_tangent_away_and_miss_results() {
        let (p, box_shape, capsule, direction) = geometry(1.);
        let mut short = options(1.);
        short.max_time_of_impact = 0.00004;
        assert!(
            cast_shapes_support_map_support_map(&p, direction, &box_shape, &capsule, short)
                .is_none()
        );
        for direction in [Vector::Y, Vector::Z] {
            assert!(
                cast_shapes_support_map_support_map(
                    &p,
                    direction,
                    &box_shape,
                    &capsule,
                    options(1.)
                )
                .is_none(),
                "{direction:?}"
            );
        }
        let off_edge = Pose::translation(21., 0.6101, 10.);
        assert!(cast_shapes_support_map_support_map(
            &off_edge,
            direction,
            &box_shape,
            &capsule,
            options(1.)
        )
        .is_none());
    }

    #[test]
    fn shape_order_and_rotation_keep_the_same_physical_near_origin_contact() {
        let (p, box_shape, capsule, direction) = geometry(1.);
        let inverse = p.inverse();
        let forward =
            cast_shapes_support_map_support_map(&p, direction, &box_shape, &capsule, options(1.))
                .unwrap();
        let backward = cast_shapes_support_map_support_map(
            &inverse,
            -direction,
            &capsule,
            &box_shape,
            options(1.),
        )
        .unwrap();
        assert!(
            (forward.time_of_impact - backward.time_of_impact).abs() < 1e-5,
            "{forward:?}, {backward:?}"
        );
        assert!(backward.normal1.dot(-Vector::Y) > 0.9999, "{backward:?}");
        // This rotates the whole physical scene, not just the cast direction.
        let rotate = crate::math::Rotation::from_rotation_z(0.4);
        let rotated_box = crate::shape::SharedShape::cuboid(20., 0.1, 20.);
        let rotation_pose = Pose::from_rotation(rotate);
        let character_pose = rotation_pose * p;
        let hit = crate::query::cast_shapes(
            &rotation_pose,
            Vector::ZERO,
            rotated_box.as_ref(),
            &character_pose,
            rotate * direction,
            &capsule,
            options(1.),
        )
        .unwrap()
        .unwrap();
        assert!(
            (hit.time_of_impact - forward.time_of_impact).abs() < 1e-5,
            "{hit:?}"
        );
        assert!(
            (rotate * hit.normal1).dot(rotate * Vector::Y) > 0.9999,
            "{hit:?}"
        );
    }

    #[test]
    fn near_origin_other_convex_pairs_keep_real_hit_and_separation_results() {
        let (_, box_shape, capsule, direction) = geometry(1.);
        let small_box = Cuboid::new(Vector::new(0.25, 0.5, 0.25));
        let ball = crate::shape::Ball::new(0.25);
        let mut missing = 0;
        for (label, other, height) in [
            ("capsule", &capsule as &dyn SupportMap, 0.6101),
            ("box", &small_box as &dyn SupportMap, 0.6101),
            ("ball", &ball as &dyn SupportMap, 0.3601),
        ] {
            let p = Pose::translation(-10., height, 10.);
            let Some(hit) =
                cast_shapes_support_map_support_map(&p, direction, &box_shape, other, options(1.))
            else {
                missing += 1;
                continue;
            };
            #[cfg(feature = "std")]
            std::println!("CONVEX_PAIR {label}: {hit:?}");
            assert!(
                hit.time_of_impact > 0.00008 && hit.time_of_impact < 0.00013,
                "{label}: {hit:?}"
            );
            // The existing box-box GJK normal has a small face-normal error;
            // this regression checks TOI and physical witnesses, not a new
            // guarantee of exact normals for every convex pair.
            assert!(hit.normal1.dot(Vector::Y) > 0.999, "{label}: {hit:?}");
            assert!((hit.witness1.y - 0.1).abs() < 1e-5, "{label}: {hit:?}");
            assert!(
                cast_shapes_support_map_support_map(&p, Vector::Y, &box_shape, other, options(1.))
                    .is_none(),
                "{label}"
            );
        }
        assert_eq!(missing, 0, "approaching convex pair lost its hit");
    }

    #[test]
    fn within_skin_and_real_penetration_preserve_approaching_and_separating_policy() {
        let (_, box_shape, capsule, _) = geometry(1.);
        for physical_gap in [0.005, -0.01] {
            let p = Pose::translation(-10., 0.6 + physical_gap, 10.);
            let hit = cast_shapes_support_map_support_map(
                &p,
                -Vector::Y,
                &box_shape,
                &capsule,
                options(1.),
            )
            .unwrap();
            assert_eq!(hit.time_of_impact, 0.);
            assert_eq!(hit.status, ShapeCastStatus::PenetratingOrWithinTargetDist);
            for direction in [Vector::Y, Vector::Z] {
                assert!(
                    cast_shapes_support_map_support_map(
                        &p,
                        direction,
                        &box_shape,
                        &capsule,
                        options(1.)
                    )
                    .is_none(),
                    "gap={physical_gap}, direction={direction:?}"
                );
            }
        }
    }

    struct CountingMap<'a> {
        inner: &'a dyn SupportMap,
        calls: &'a Cell<usize>,
    }
    impl SupportMap for CountingMap<'_> {
        fn local_support_point(&self, dir: Vector) -> Vector {
            self.calls.set(self.calls.get() + 1);
            self.inner.local_support_point(dir)
        }
        fn local_support_point_toward(&self, dir: Vector) -> Vector {
            self.calls.set(self.calls.get() + 1);
            self.inner.local_support_point_toward(dir)
        }
    }

    #[test]
    fn near_origin_restart_has_bounded_support_work_and_preserves_fast_paths() {
        let (near, box_shape, capsule, oblique) = geometry(1.);
        let rounded = RoundShape {
            inner_shape: box_shape,
            border_radius: 0.01,
        };
        let mut near_hit = false;
        for (label, p, direction) in [
            ("near-oblique", near, oblique),
            ("near-vertical", near, -Vector::Y),
            ("ordinary-hit", Pose::translation(-10., 2., 10.), oblique),
            ("ordinary-away", Pose::translation(-10., 2., 10.), Vector::Y),
            ("ordinary-miss", Pose::translation(21., 2., 10.), -Vector::Y),
            ("near-tangent", near, Vector::Z),
        ] {
            let a = Cell::new(0);
            let b = Cell::new(0);
            let first = CountingMap {
                inner: &rounded,
                calls: &a,
            };
            let second = CountingMap {
                inner: &capsule,
                calls: &b,
            };
            let hit = gjk::directional_distance(
                &p,
                &first,
                &second,
                direction,
                &mut VoronoiSimplex::new(),
            );
            assert_eq!(a.get(), b.get());
            // Initial support + at most 100 iterations. A restart consumes an
            // iteration rather than rearming the bound or adding another loop.
            assert!(a.get() <= 101, "{label}: {}", a.get());
            #[cfg(feature = "std")]
            std::println!("SUPPORT_WORK {label} pairs={} hit={hit:?}", a.get());
            if label == "near-oblique" {
                near_hit = hit.is_some();
            }
        }
        assert!(near_hit, "real near-origin approach must converge");
    }
}
