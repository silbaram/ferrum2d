use crate::math::{Pose, Real};
use crate::query::{sat, Contact, PointQuery};
use crate::shape::{Cuboid, SupportMap};
use approx::AbsDiffEq;

/// Contact between two cuboids.
#[inline]
pub fn contact_cuboid_cuboid(
    pos12: &Pose,
    cuboid1: &Cuboid,
    cuboid2: &Cuboid,
    prediction: Real,
) -> Option<Contact> {
    let pos21 = pos12.inverse();

    let sep1 = sat::cuboid_cuboid_find_local_separating_normal_oneway(cuboid1, cuboid2, pos12);
    if sep1.0 > prediction {
        return None;
    }

    let sep2 = sat::cuboid_cuboid_find_local_separating_normal_oneway(cuboid2, cuboid1, &pos21);
    if sep2.0 > prediction {
        return None;
    }

    #[cfg(feature = "dim2")]
    let sep3 = (-Real::MAX, crate::math::Vector::Y); // This case does not exist in 2D.
    #[cfg(feature = "dim3")]
    let sep3 = sat::cuboid_cuboid_find_local_separating_edge_twoway(cuboid1, cuboid2, pos12);
    if sep3.0 > prediction {
        return None;
    }

    // The best separating axis is face-vertex.
    if sep1.0 >= sep2.0 && sep1.0 >= sep3.0 {
        // To compute the closest points, we need to project the support point
        // from cuboid2 on the support-face of cuboid1. For simplicity, we just
        // project the support point from cuboid2 on cuboid1 itself (not just the face).
        let pt2 = cuboid2.local_support_point(pos12.rotation.inverse() * -sep1.1);
        let pt2_1 = *pos12 * pt2;
        let mut proj1 = cuboid1.project_local_point(pt2_1, false);
        if sep1.0 <= 0.0 {
            // A support vertex can also lie on an unrelated box boundary.
            // Projecting to the nearest arbitrary boundary then returns itself
            // and loses the negative SAT gap. Use the selected finite face.
            for axis in 0..crate::math::DIM {
                proj1.point[axis] = if sep1.1[axis] != 0.0 {
                    cuboid1.half_extents[axis] * sep1.1[axis]
                } else {
                    pt2_1[axis].clamp(-cuboid1.half_extents[axis], cuboid1.half_extents[axis])
                };
            }
        }

        let separation = (pt2_1 - proj1.point).dot(sep1.1);
        let (mut normal1, mut dist) = (pt2_1 - proj1.point).normalize_and_length();

        // NOTE: we had to recompute the normal because we can't use
        // the separation vector for the case where we have a vertex-vertex contact.
        if separation < 0.0 || dist <= Real::default_epsilon() {
            // Penetration or contact lying on the boundary exactly.
            normal1 = sep1.1;
            dist = separation;
        }

        if dist > prediction {
            return None;
        }

        return Some(Contact::new(
            proj1.point,
            pt2,
            normal1,
            pos12.rotation.inverse() * -normal1,
            dist,
        ));
    }

    // The best separating axis is vertex-face.
    if sep2.0 >= sep1.0 && sep2.0 >= sep3.0 {
        // To compute the actual closest points, we need to project the support point
        // from cuboid1 on the support-face of cuboid2. For simplicity, we just
        // project the support point from cuboid1 on cuboid2 itself (not just the face).
        let pt1 = cuboid1.local_support_point(pos21.rotation.inverse() * -sep2.1);
        let pt1_2 = pos21 * pt1;
        let mut proj2 = cuboid2.project_local_point(pt1_2, false);
        if sep2.0 <= 0.0 {
            for axis in 0..crate::math::DIM {
                proj2.point[axis] = if sep2.1[axis] != 0.0 {
                    cuboid2.half_extents[axis] * sep2.1[axis]
                } else {
                    pt1_2[axis].clamp(-cuboid2.half_extents[axis], cuboid2.half_extents[axis])
                };
            }
        }

        let separation = (pt1_2 - proj2.point).dot(sep2.1);
        let (mut normal2, mut dist) = (pt1_2 - proj2.point).normalize_and_length();

        // NOTE: we had to recompute the normal because we can't use
        // the separation vector for the case where we have a vertex-vertex contact.
        if separation < 0.0 || dist <= Real::default_epsilon() {
            // Penetration or contact lying on the boundary exactly.
            normal2 = sep2.1;
            dist = separation;
        }

        if dist > prediction {
            return None;
        }

        return Some(Contact::new(
            pt1,
            proj2.point,
            pos12.rotation * -normal2,
            normal2,
            dist,
        ));
    }

    // The best separating axis is edge-edge.
    #[cfg(feature = "dim3")]
    if sep3.0 >= sep2.0 && sep3.0 >= sep1.0 {
        use crate::query::{details, ClosestPoints};
        // To compute the actual distance, we need to compute the closest
        // points between the two edges that generated the separating axis.
        let edge1 = cuboid1.local_support_edge_segment(sep3.1);
        let edge2 = cuboid2.local_support_edge_segment(pos21.rotation * -sep3.1);

        match details::closest_points_segment_segment(pos12, &edge1, &edge2, prediction) {
            ClosestPoints::Disjoint => return None,
            ClosestPoints::WithinMargin(a, b) => {
                let normal1 = sep3.1;
                let normal2 = pos12.rotation.inverse() * -normal1;
                return Some(Contact::new(a, b, normal1, normal2, sep3.0));
            }
            ClosestPoints::Intersecting => unreachable!(),
        }
    }

    unreachable!()
}
