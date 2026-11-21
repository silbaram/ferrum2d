//! Fallible work admission for the original point-cloud Native contact path.
//!
//! The ordinary APIs do not call this module. All mutable simplex/EPA storage
//! belongs to this invocation; only a completed contact escapes it.
use crate::math::{Pose, Real, Vector};
use crate::num::Bounded;
use crate::query::{Contact, PointProjection};
use crate::shape::{FeatureId, Shape, SupportMap, TypedShape};

use crate::query::native_work::Meter;
pub use crate::query::native_work::{
    NativeContactError, NativeContactPhase, NativeContactStorage, NativeContactWork,
};

/// Meter the same Native contact dispatcher for shapes exactly representable
/// by a `ToiProxy`. Composite/custom shapes are outside this leaf entry, as in
/// its Core caller. The ordinary, general `contact` API is unchanged.
pub fn contact_point_cloud_metered<E, F>(
    pose_a: &Pose,
    shape_a: &dyn Shape,
    pose_b: &Pose,
    shape_b: &dyn Shape,
    prediction: Real,
    admit: &mut F,
) -> Result<Option<Contact>, NativeContactError<E>>
where
    F: FnMut(NativeContactWork) -> Result<(), E>,
{
    let mut meter = Meter { admit };
    meter.charge(NativeContactWork::Fixed(NativeContactPhase::Dispatch))?;
    let a = crate::query::sweep_toi::ToiProxy::from_shape(shape_a)
        .ok_or(NativeContactError::Unsupported)?;
    let b = crate::query::sweep_toi::ToiProxy::from_shape(shape_b)
        .ok_or(NativeContactError::Unsupported)?;
    let points = [a.points().len(), b.points().len()];
    let pos12 = pose_a.inv_mul(pose_b);
    let ball_a = shape_a.as_ball();
    let ball_b = shape_b.as_ball();
    let mut contact = if let (Some(a), Some(b)) = (ball_a, ball_b) {
        crate::query::details::contact_ball_ball(&pos12, a, b, prediction)
    } else if let (Some(ball), true) = (ball_a, shape_b.is_convex()) {
        ball_contact(
            &pos12.inverse(),
            shape_b,
            ball,
            prediction,
            points[1],
            &mut meter,
        )?
        .map(|c| c.flipped())
    } else if let (true, Some(ball)) = (shape_a.is_convex(), ball_b) {
        ball_contact(&pos12, shape_a, ball, prediction, points[0], &mut meter)?
    } else if let (Some(a), Some(b)) = (shape_a.as_support_map(), shape_b.as_support_map()) {
        support_contact(&pos12, a, b, prediction, points, &mut meter)?
    } else {
        return Err(NativeContactError::Unsupported);
    };
    if let Some(contact) = &mut contact {
        contact.transform_by_mut(pose_a, pose_b);
    }
    Ok(contact)
}

fn support_contact<E, F>(
    pos12: &Pose,
    a: &dyn SupportMap,
    b: &dyn SupportMap,
    prediction: Real,
    points: [usize; 2],
    meter: &mut Meter<'_, F>,
) -> Result<Option<Contact>, NativeContactError<E>>
where
    F: FnMut(NativeContactWork) -> Result<(), E>,
{
    use crate::query::gjk::{self, CsoPoint, GJKResult, VoronoiSimplex};
    let simplex = &mut VoronoiSimplex::new();
    let dir = if let Some(init_dir) = pos12.translation.try_normalize() {
        init_dir
    } else {
        Vector::X
    };
    meter.support(points)?;
    simplex.reset(CsoPoint::from_shapes(pos12, a, b, dir));
    let mut result =
        gjk::closest_points_metered(pos12, a, b, prediction, true, simplex, points, meter)?;
    if result == GJKResult::Intersection {
        let mut epa = crate::query::epa::EPA::new();
        result = if let Some((p1, p2, n)) =
            epa.closest_points_metered(pos12, a, b, simplex, points, meter)?
        {
            GJKResult::ClosestPoints(p1, p2, n)
        } else {
            GJKResult::NoIntersection(Vector::X)
        };
    }
    Ok(match result {
        GJKResult::ClosestPoints(point1, point2_1, normal1) => {
            let dist = (point2_1 - point1).dot(normal1);
            let point2 = pos12.inverse_transform_point(point2_1);
            let normal2 = pos12.rotation.inverse() * -normal1;
            Some(Contact::new(point1, point2, normal1, normal2, dist))
        }
        GJKResult::NoIntersection(_) => None,
        GJKResult::Intersection | GJKResult::Proximity(_) => unreachable!(),
    })
}

fn support_projection<G: ?Sized + SupportMap, E, F>(
    shape: &G,
    point: Vector,
    points: usize,
    meter: &mut Meter<'_, F>,
) -> Result<PointProjection, NativeContactError<E>>
where
    F: FnMut(NativeContactWork) -> Result<(), E>,
{
    use crate::query::gjk::{self, ConstantOrigin, CsoPoint, GJKResult, VoronoiSimplex};
    let m = Pose::new(-point, Vector::ZERO);
    let m_inv = Pose::new(point, Vector::ZERO);
    let dir = (-m.translation).try_normalize().unwrap_or(Vector::X);
    let mut simplex = VoronoiSimplex::new();
    meter.support([points, 1])?;
    let support_point = CsoPoint::from_shapes(&m_inv, shape, &ConstantOrigin, dir);
    simplex.reset(support_point);
    let projection = match gjk::closest_points_metered(
        &m.inverse(),
        shape,
        &ConstantOrigin,
        Real::max_value(),
        true,
        &mut simplex,
        [points, 1],
        meter,
    )? {
        GJKResult::Intersection => None,
        GJKResult::ClosestPoints(p, _, _) => Some(p),
        _ => unreachable!(),
    };
    Ok(if let Some(proj) = projection {
        PointProjection::new(false, proj)
    } else {
        let mut epa = crate::query::epa::EPA::new();
        if let Some((pt, _, _)) = epa.closest_points_metered(
            &m.inverse(),
            shape,
            &ConstantOrigin,
            &simplex,
            [points, 1],
            meter,
        )? {
            PointProjection::new(true, pt)
        } else {
            PointProjection::new(true, point)
        }
    })
}

fn projection<E, F>(
    shape: &dyn Shape,
    point: Vector,
    points: usize,
    meter: &mut Meter<'_, F>,
) -> Result<(PointProjection, FeatureId), NativeContactError<E>>
where
    F: FnMut(NativeContactWork) -> Result<(), E>,
{
    meter.charge(NativeContactWork::Fixed(NativeContactPhase::PointQuery))?;
    match shape.as_typed_shape() {
        TypedShape::ConvexPolyhedron(poly) => {
            let proj = support_projection(poly, point, points, meter)?;
            let dpt = point - proj.point;
            let local_dir = if proj.is_inside { -dpt } else { dpt };
            let feature = if let Some(local_dir) = local_dir.try_normalize() {
                meter.charge(NativeContactWork::Fixed(NativeContactPhase::Feature))?;
                meter.charge(NativeContactWork::PointVisits(points))?;
                // Original feature lookup scans one vertex's adjacent faces and
                // edges. The admitted stored adjacency slice bounds both scans.
                let adjacency = poly
                    .faces_adj_to_vertex()
                    .len()
                    .checked_mul(2)
                    .ok_or(NativeContactError::Allocation)?;
                meter.charge(NativeContactWork::PointVisits(adjacency))?;
                poly.support_feature_id_toward(local_dir)
            } else {
                FeatureId::Unknown
            };
            Ok((proj, feature))
        }
        TypedShape::RoundCuboid(_)
        | TypedShape::RoundTriangle(_)
        | TypedShape::RoundConvexPolyhedron(_) => {
            let support = shape
                .as_support_map()
                .ok_or(NativeContactError::Unsupported)?;
            Ok((
                support_projection(support, point, points, meter)?,
                FeatureId::Unknown,
            ))
        }
        _ => Ok(shape.project_local_point_and_get_feature(point)),
    }
}

fn ball_contact<E, F>(
    pos12: &Pose,
    shape: &dyn Shape,
    ball: &crate::shape::Ball,
    prediction: Real,
    points: usize,
    meter: &mut Meter<'_, F>,
) -> Result<Option<Contact>, NativeContactError<E>>
where
    F: FnMut(NativeContactWork) -> Result<(), E>,
{
    let center2_1 = pos12.translation;
    let (proj, feature) = projection(shape, center2_1, points, meter)?;
    let dist;
    let normal1;
    let (dir1, len) = (proj.point - center2_1).normalize_and_length();
    if len >= crate::math::DEFAULT_EPSILON {
        if proj.is_inside {
            dist = -len - ball.radius;
            normal1 = dir1;
        } else {
            dist = len - ball.radius;
            normal1 = -dir1;
        }
    } else {
        dist = -ball.radius;
        meter.charge(NativeContactWork::Fixed(NativeContactPhase::Feature))?;
        if let TypedShape::ConvexPolyhedron(poly) = shape.as_typed_shape() {
            if let FeatureId::Vertex(id) = feature {
                let count = poly.vertices()[id as usize].num_adj_faces_or_edge as usize;
                meter.charge(NativeContactWork::PointVisits(count))?;
            }
        }
        normal1 = shape
            .feature_normal_at_point(proj.subshape, feature, proj.point)
            .or_else(|| proj.point.try_normalize())
            .unwrap_or(Vector::Y);
    }
    Ok(if dist <= prediction {
        let normal2 = pos12.rotation.inverse() * -normal1;
        let point2 = normal2 * ball.radius;
        Some(Contact::new(proj.point, point2, normal1, normal2, dist))
    } else {
        None
    })
}
