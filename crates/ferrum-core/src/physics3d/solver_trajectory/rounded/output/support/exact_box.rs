//! Supplemental whole support, after every original output proof. The original
//! r=0 Cuboid inputs are represented coordinates: RN(p+0) has no numeric error.
//! This support-only fact never changes a Native output image or signed-zero key.
use super::*;
mod dyadic_tangent;
mod oblique_pole;

fn dot_value(point: [Bound; 3], normal: rp::Vector) -> Bound {
    point
        .into_iter()
        .zip(normal.to_array())
        .fold(Bound::exact(0.), |sum, (p, n)| {
            sum.add(p.mul(Bound::exact(f64::from(n))))
        })
}
fn projected_error(error: [f64; 3], normal: rp::Vector) -> f64 {
    error
        .into_iter()
        .zip(normal.to_array())
        .fold(0., |sum, (error, n)| {
            upper_add(sum, upper_mul(error, f64::from(n).abs()))
        })
}
fn cloud_lower(
    cloud: &Cloud<'_>,
    normal: rp::Vector,
    norm: Bound,
    work: &mut Work,
) -> Result<Option<f64>, TrajectoryError> {
    let count = u64::try_from(cloud.points.len()).map_err(|_| TrajectoryError::WorkLimit)?;
    work.charge(
        count
            .checked_mul(64)
            .and_then(|v| v.checked_add(128))
            .ok_or(TrajectoryError::WorkLimit)?,
    )?;
    let mut lower = f64::INFINITY;
    for &p in cloud.points {
        let point = cloud.ideal.point(p);
        if !p.is_finite() || point.iter().any(|v| !v.finite()) {
            return Ok(None);
        }
        lower = lower.min(dot_value(point, normal).lo);
    }
    let margin = upper_add(
        upper_mul(f64::from(cloud.radius), upper_mul(cloud.scale, norm.hi)),
        projected_error(cloud.error, normal),
    );
    let lower = (lower - margin).next_down();
    Ok(lower.is_finite().then_some(lower))
}

// Original dyadic visits retain first refusal and their exact Work.
const ORIGINAL_WEIGHTS: [f64; 5] = [0., 0.5, 0.75, 0.875, 1.];
// Exact dyadic residual 2^-16, not an epsilon or a changed radius.
const NEAR_POLE_WEIGHT: f64 = 65535. / 65536.;
// A second exact dyadic for the cells in the shared-translation proof.
const CELL_WEIGHT: f64 = 255. / 256.;

// Same whole-sphere dual as before. Keep the already paid immutable hull,
// original RN pole and real-world-radius bound for a possible later visit.
struct CapsuleProjection {
    translation: Translation,
    points: [rp::Vector; 2],
    normal: rp::Vector,
    errors: [f64; 3],
    radius: f32,
    axis: usize,
    pole_support: f64,
    world_upper: f64,
}
impl CapsuleProjection {
    fn prepare(
        frames: &Frames,
        capsule: &rapier3d::parry::shape::Capsule,
        normal: rp::Vector,
        norm: Bound,
        work: &mut Work,
    ) -> Result<Option<Self>, TrajectoryError> {
        let frame = union(frames);
        let q = frame.rotation.components;
        if (0..3).any(|i| !exact_value(q[i], 0.)) || !exact_value(q[3], 1.) {
            return Ok(None);
        }
        let a = capsule.segment.a;
        let b = capsule.segment.b;
        if !a.is_finite()
            || !b.is_finite()
            || !capsule.radius.is_finite()
            || capsule.radius < 0.
            || (0..3).filter(|&i| a[i] != b[i]).count() > 1
        {
            return Ok(None);
        }
        work.charge(512)?; // complete line/radius hull, original local and post-add RN
        let lo = a.min(b);
        let hi = a.max(b);
        let local: [Float; 3] =
            std::array::from_fn(|i| Float::span(lo[i] - capsule.radius, hi[i] + capsule.radius));
        let actual: [Float; 3] = std::array::from_fn(|i| frame.translation[i].add(local[i]));
        if local.iter().chain(actual.iter()).any(|v| !v.finite()) {
            return Ok(None);
        }
        let errors: [f64; 3] = std::array::from_fn(|i| {
            upper_add(
                half_ulp(local[i]),
                rounding(frame.translation[i], local[i], actual[i], Op::Add),
            )
        });
        let axis = (0..3)
            .max_by(|&i, &j| normal[i].abs().total_cmp(&normal[j].abs()))
            .ok_or(TrajectoryError::InvalidReference)?;
        let positive = normal[axis] >= 0.;
        let pole = if positive {
            hi[axis] + capsule.radius
        } else {
            lo[axis] - capsule.radius
        };
        let pole = frame.translation[axis].add(Float::exact(pole));
        if !pole.finite() {
            return Ok(None);
        }
        let pole_support = if positive {
            f64::from(pole.hi)
        } else {
            -f64::from(pole.lo)
        };
        // Original qI world-core coordinates are monotone in the one variable
        // local segment coordinate. Its two endpoints cover the entire line;
        // unlike radius arithmetic no rounded interior extrema are omitted.
        let mut world_upper = f64::NEG_INFINITY;
        for point in [a, b] {
            work.charge(256)?;
            let core = std::array::from_fn(|i| {
                let v = frame.translation[i].add(Float::exact(point[i]));
                Bound {
                    lo: f64::from(v.lo),
                    hi: f64::from(v.hi),
                }
            });
            world_upper = world_upper.max(dot_value(core, normal).hi);
        }
        world_upper = Bound::exact(world_upper)
            .add(Bound::exact(f64::from(capsule.radius)).mul(norm))
            .hi;
        Ok(Some(Self {
            translation: frame.translation,
            points: [a, b],
            normal,
            errors,
            radius: capsule.radius,
            axis,
            pole_support,
            world_upper,
        }))
    }
    fn upper(&self, weights: &[f64], work: &mut Work) -> Result<Option<f64>, TrajectoryError> {
        let translation = self.translation;
        let [a, b] = self.points;
        let normal = self.normal;
        let errors = self.errors;
        let radius = self.radius;
        let axis = self.axis;
        let pole_support = self.pole_support;
        let world_upper = self.world_upper;
        let mut local_upper = f64::INFINITY;
        for &weight in weights {
            work.charge(512)?; // actual residual/pole projection over the complete hull
            if !weight.is_finite() || !(0. ..=1.).contains(&weight) {
                return Ok(None);
            }
            let residual: [f64; 3] = std::array::from_fn(|i| {
                f64::from(normal[i]) * if i == axis { 1. - weight } else { 1. }
            });
            let mut norm2 = Bound::exact(0.);
            let mut error = 0.;
            for i in 0..3 {
                norm2 = norm2.add(Bound::exact(residual[i]).mul(Bound::exact(residual[i])));
                error = upper_add(error, upper_mul(residual[i].abs(), errors[i]));
            }
            let radius = Bound::exact(f64::from(radius)).mul(norm2.sqrt());
            let pole = Bound::exact(weight)
                .mul(Bound::exact(f64::from(normal[axis]).abs()))
                .mul(Bound::exact(pole_support));
            let mut center = f64::NEG_INFINITY;
            for point in [a, b] {
                let mut value = Bound::exact(0.);
                for i in 0..3 {
                    value = value.add(
                        Bound {
                            lo: f64::from(translation[i].lo),
                            hi: f64::from(translation[i].hi),
                        }
                        .add(Bound::exact(f64::from(point[i])))
                        .mul(Bound::exact(residual[i])),
                    );
                }
                center = center.max(value.hi);
            }
            let upper = Bound::exact(center)
                .add(radius)
                .add(pole)
                .add(Bound::exact(error));
            if !upper.finite() {
                return Ok(None);
            }
            local_upper = local_upper.min(upper.hi);
        }
        let upper = local_upper.max(world_upper);
        Ok(upper.is_finite().then_some(upper))
    }
}
#[cfg(test)]
fn capsule_upper(
    frames: &Frames,
    capsule: &rapier3d::parry::shape::Capsule,
    normal: rp::Vector,
    norm: Bound,
    work: &mut Work,
) -> Result<Option<f64>, TrajectoryError> {
    let Some(projection) = CapsuleProjection::prepare(frames, capsule, normal, norm, work)? else {
        return Ok(None);
    };
    projection.upper(&ORIGINAL_WEIGHTS, work)
}

pub(in crate::physics3d::solver_trajectory::rounded::output) fn ramp_capsule_separated(
    context: Context<'_>,
    prepared: &PreparedFrames<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (shape, hull_frames, capsule, capsule_frames, motion, mut normal) =
        if let Some(cap) = context.sb.as_capsule() {
            (context.sa, &prepared.a, cap, &prepared.b, context.b, normal)
        } else if let Some(cap) = context.sa.as_capsule() {
            (
                context.sb,
                &prepared.b,
                cap,
                &prepared.a,
                context.a,
                -normal,
            )
        } else {
            return Ok(false);
        };
    let hull = shape.as_convex_polyhedron();
    let triangle = shape.as_triangle();
    let box_vertices = shape
        .as_cuboid()
        .map(crate::physics3d::solver_trajectory::feature_contact::vertices);
    let points = if let Some(hull) = hull {
        hull.points()
    } else if let Some(triangle) = triangle {
        triangle.vertices().as_slice()
    } else if let Some(vertices) = box_vertices.as_ref() {
        vertices.as_slice()
    } else {
        return Ok(false);
    };
    let axis_a = capsule.segment.a;
    let axis_b = capsule.segment.b;
    let delta = axis_b - axis_a;
    let components = |axis: rp::Vector| axis.to_array().into_iter().filter(|&v| v != 0.).count();
    if components(normal) == 3 {
        // A prism edge can carry a small tangent component in the Native
        // witness. Try a planar axis against the entire original shapes.
        let tangent = normal.abs().min_position();
        if normal[tangent].abs() <= normal.abs().max_element() * (64. * f32::EPSILON) {
            normal[tangent] = 0.;
        }
    }
    let oblique = components(normal) == 3;
    if (components(normal) != 2 && !(oblique && hull.is_some()))
        || !axis_a.is_finite()
        || !axis_b.is_finite()
        || delta.to_array().into_iter().filter(|&v| v != 0.).count() != 1
    {
        return Ok(false);
    }
    let aligned = hull_frames.len == 1
        && hull_frames.values[0].rotation.exact == Some(rp::Rotation::IDENTITY);
    let normal = if let Some(hull) = hull.filter(|_| aligned && oblique) {
        // Keep the two in-plane coefficients perpendicular to a sloping edge.
        // It only nominates the direction: all original hull points are tested.
        let mut direction = normal;
        for edge in hull.edges() {
            work.charge(32)?;
            let [a, b] = edge.vertices.map(|i| hull.points()[i as usize]);
            let delta = b - a;
            if components(delta) != 2 || edge.dir.dot(normal).abs() > 0.001 {
                continue;
            }
            let remaining = delta.abs().min_position();
            let i = (remaining + 1) % 3;
            let j = (remaining + 2) % 3;
            let scale = normal[i] / delta[j];
            let mut trial = normal;
            trial[i] = delta[j];
            trial[j] = -delta[i];
            trial[remaining] /= scale;
            trial *= scale.signum();
            if trial.is_finite() && trial.dot(normal) > 0. {
                direction = trial;
                break;
            }
        }
        direction
    } else if let Some(hull) = hull.filter(|_| aligned) {
        // The unit witness normal has two independently rounded components.
        // Use a face edge cross product so their ratio can remain exact.
        let mut direction = normal;
        for face in hull.faces() {
            work.charge(32)?;
            if face.num_vertices_or_edges < 3 || face.normal.dot(normal) < 0.9999 {
                continue;
            }
            let start = face.first_vertex_or_edge as usize;
            let point = |i| hull.points()[hull.vertices_adj_to_face()[start + i] as usize];
            let plane = (point(1) - point(0)).cross(point(2) - point(0));
            if plane.is_finite() && components(plane) == 2 && plane.dot(normal) > 0. {
                direction = plane;
                break;
            }
        }
        direction
    } else if let Some(triangle) = triangle.filter(|_| aligned) {
        work.charge(32)?;
        // Either side of a mesh triangle can support the capsule. Use the
        // edge cross product in the direction of the observed contact.
        let plane = (triangle.b - triangle.a).cross(triangle.c - triangle.a);
        let facing = plane.dot(normal);
        if plane.is_finite() && components(plane) == 2 && facing.is_finite() && facing != 0. {
            plane * facing.signum()
        } else {
            normal
        }
    } else {
        normal
    };
    let norm2 = super::super::super::dot(normal, normal);
    if norm2.lo <= 0. || !norm2.finite() {
        return Ok(false);
    }
    let norm = norm2.sqrt();
    let axis = delta.abs().max_position();
    let point = if (delta[axis] > 0.) == (normal[axis] > 0.) {
        axis_a
    } else {
        axis_b
    };
    let count = (hull_frames.len as u64)
        .checked_mul(points.len() as u64)
        .and_then(|n| n.checked_mul(128))
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(count)?;
    let mut hull_upper = f64::NEG_INFINITY;
    for frame in &hull_frames.values[..hull_frames.len] {
        for &point in points {
            let Some(support) = project(frame.full_point(point, 0.), normal) else {
                return Ok(false);
            };
            hull_upper = hull_upper.max(support.hi);
        }
    }
    let required =
        Bound::exact(hull_upper).add(Bound::exact(f64::from(context.clearance)).mul(norm));
    if !required.finite() {
        return Ok(false);
    }
    if let Some(support) = translating_capsule_bound(
        motion,
        point,
        capsule.radius,
        -normal,
        norm,
        -required.hi,
        context.start,
        context.end,
        work,
    )? {
        if -support > required.hi
            || (!oblique
                && dyadic_tangent::separated(
                    motion,
                    point,
                    capsule.radius,
                    -normal,
                    norm,
                    -required.hi,
                    context.start,
                    context.end,
                    work,
                )?)
        {
            return Ok(true);
        }
    }
    // Under identity rotation, adding the same sphere offset at the near
    // endpoint bounds every intervening point on this one-axis segment.
    let cap = rp::Capsule::new(point, point, capsule.radius);
    let Some(projection) = CapsuleProjection::prepare(capsule_frames, &cap, -normal, norm, work)?
    else {
        return Ok(false);
    };
    if projection
        .upper(&ORIGINAL_WEIGHTS, work)?
        .is_some_and(|support| -support > required.hi)
    {
        return Ok(true);
    }
    translating_capsule_cells(
        motion,
        point,
        capsule.radius,
        -normal,
        norm,
        -required.hi,
        context.start,
        context.end,
        work,
    )
}

#[allow(clippy::too_many_arguments)]
fn translating_capsule_bound(
    motion: ShapeMotion,
    point: rp::Vector,
    radius: f32,
    normal: rp::Vector,
    norm: Bound,
    limit: f64,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<f64>, TrajectoryError> {
    let Some(kernel) = motion.translation_kernel() else {
        return Ok(None);
    };
    let origin = kernel.native.motion.start.translation;
    let velocity = kernel.native.linear_velocity;
    if !radius.is_finite() || radius <= 0. {
        return Ok(None);
    }
    let dt = Float::span(kernel.local_delta(start), kernel.local_delta(end));
    if !dt.finite() {
        return Ok(None);
    }
    work.charge(1024)?;
    let exact = |v| Bound::exact(f64::from(v));
    let value = |v| Value::input(Float::exact(v));
    let mut base = [Bound::exact(0.); 3];
    let mut local_error = [0.; 3];
    let mut world_error = [0.; 3];
    let mut translations = [Value::input(Float::ZERO); 3];
    for i in 0..3 {
        let raw = value(origin[i]).add(value(velocity[i]).mul(Value::input(dt)));
        let center = motion.local_center[i];
        let offset = motion.local_pose.translation[i];
        // The first subtraction is exact by Sterbenz in this range. The
        // inverse addition then recovers the same represented COM value.
        let exact_inverse = center == offset
            && (center == 0.
                || [raw.actual.lo, raw.actual.hi].into_iter().all(|v| {
                    v.is_sign_negative() == center.is_sign_negative()
                        && f64::from(v.abs()) >= f64::from(center.abs()) * 0.5
                        && f64::from(v.abs()) <= f64::from(center.abs()) * 2.
                }));
        let translation = if exact_inverse {
            raw
        } else {
            raw.sub(value(center)).add(value(offset))
        };
        let local = translation.add(Value::local(point[i], radius));
        let world = translation.add(value(point[i]));
        if !local.finite() || !world.finite() {
            return Ok(None);
        }
        base[i] = exact(origin[i])
            .sub(exact(center))
            .add(exact(offset))
            .add(exact(point[i]));
        local_error[i] = local.error;
        world_error[i] = world.error;
        translations[i] = translation;
    }
    let world_error = projected_error(world_error, normal);
    let local_error = projected_error(local_error, normal);
    // The same represented physical delta drives every coordinate. Combine
    // the slopes before taking its interval, or tangent motion loses its gap.
    let ideal = dot_value(base, normal)
        .add(dot_value(velocity.to_array().map(exact), normal).mul(Value::input(dt).ideal))
        .add(exact(radius).mul(norm));
    let mut support = ideal.add(Bound::exact(local_error.max(world_error)));
    const POLAR_WORK: u64 = 512;
    if support.hi >= limit
        && local_error > world_error
        && ideal.add(Bound::exact(world_error)).hi < limit
        && work.limit.saturating_sub(work.used) >= POLAR_WORK
    {
        work.charge(POLAR_WORK)?;
        if let Some(tighter) =
            polar_rounding_error(translations, point, normal, norm, radius, local_error)
        {
            support = ideal.add(Bound::exact(local_error.min(tighter).max(world_error)));
        }
    }
    Ok(support.finite().then_some(support.hi))
}

// If a real radius vector u is more than E short of the ideal supporting
// plane, even the original full-hull rounding error E cannot cross it. For
// every other u, |u - r*n/|n||² <= 2*r*E/|n|. Bound the original local-point
// and world-add roundings on just this cap, over the whole translation.
fn polar_rounding_error(
    translations: [Value; 3],
    point: rp::Vector,
    normal: rp::Vector,
    norm: Bound,
    radius: f32,
    full_error: f64,
) -> Option<f64> {
    if !norm.finite() || norm.lo <= 0. || !full_error.is_finite() {
        return None;
    }
    let scale = Bound::exact(f64::from(radius)).mul(Bound {
        lo: (1. / norm.hi).next_down(),
        hi: (1. / norm.lo).next_up(),
    });
    let width = scale
        .mul(Bound::exact(2.))
        .mul(Bound::exact(full_error))
        .sqrt();
    if !width.finite() {
        return None;
    }
    let mut errors = [0.; 3];
    for (i, translation) in translations.into_iter().enumerate() {
        if normal[i] == 0. {
            continue;
        }
        let local = Bound::exact(f64::from(point[i]))
            .add(scale.mul(Bound::exact(f64::from(normal[i]))))
            .add(Bound {
                lo: -width.hi,
                hi: width.hi,
            });
        // Actual local points are RN(point + u); nearest conversion of both
        // outward real endpoints bounds every such represented coordinate.
        let local = Float::span(local.lo as f32, local.hi as f32);
        let t = translation.actual;
        let sum = t.add(local);
        if !local.finite() || !sum.finite() {
            return None;
        }
        let cancels_exactly = [t.lo, t.hi].into_iter().all(|a| {
            [local.lo, local.hi].into_iter().all(|b| {
                a.is_sign_negative() != b.is_sign_negative()
                    && f64::from(a.abs()) <= 2. * f64::from(b.abs())
                    && f64::from(b.abs()) <= 2. * f64::from(a.abs())
            })
        });
        let addition = if cancels_exactly {
            0.
        } else {
            rounding(t, local, sum, Op::Add)
        };
        errors[i] = upper_add(translation.error, upper_add(half_ulp(local), addition));
    }
    Some(projected_error(errors, normal))
}

#[allow(clippy::too_many_arguments)]
fn translating_capsule_cells(
    motion: ShapeMotion,
    point: rp::Vector,
    radius: f32,
    normal: rp::Vector,
    norm: Bound,
    limit: f64,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Some(kernel) = motion.translation_kernel() else {
        return Ok(false);
    };
    const MAX_CELLS: u32 = 128;
    let axis = normal.abs().max_position();
    let origin = kernel.native.motion.start.translation;
    let velocity = kernel.native.linear_velocity;
    let at = |key, i: usize| {
        ((origin[i] + velocity[i] * f32::from_bits(key)) - motion.local_center[i])
            + motion.local_pose.translation[i]
    };
    let mut first = kernel.local_delta(start).to_bits();
    let last = kernel.local_delta(end).to_bits();
    let bounds = [at(first, axis), at(last, axis)];
    if first > last
        || bounds.iter().any(|x| !x.is_finite())
        || bounds[0].is_sign_negative() != bounds[1].is_sign_negative()
        || bounds[0].to_bits().abs_diff(bounds[1].to_bits()) >= MAX_CELLS
    {
        return Ok(false);
    }
    let radius_bound = Bound::exact(f64::from(radius)).mul(norm);
    let local = point.to_array().map(|p| Value::local(p, radius));
    for _ in 0..MAX_CELLS {
        work.charge(256)?;
        let fixed = at(first, axis);
        let mut through = first;
        let mut high = last;
        // The dominant rounded coordinate is monotone in the physical
        // delta. The other coordinates keep their original endpoint bounds
        // in each of its cells, including both radius graphs.
        while through < high {
            work.charge(16)?;
            let mid = through + (high - through).div_ceil(2);
            if at(mid, axis) == fixed {
                through = mid;
            } else {
                high = mid - 1;
            }
        }
        let translation: [f32; 3] = std::array::from_fn(|i| {
            let a = at(first, i);
            let b = at(through, i);
            if normal[i] < 0. {
                a.min(b)
            } else {
                a.max(b)
            }
        });
        let local_error = std::array::from_fn(|i| {
            Value::input(Float::exact(translation[i]))
                .add(local[i])
                .error
        });
        let local = dot_value(
            std::array::from_fn(|i| {
                Bound::exact(f64::from(translation[i])).add(Bound::exact(f64::from(point[i])))
            }),
            normal,
        )
        .add(radius_bound)
        .add(Bound::exact(projected_error(local_error, normal)));
        let world = dot_value(
            std::array::from_fn(|i| Bound::exact(f64::from(translation[i] + point[i]))),
            normal,
        )
        .add(radius_bound);
        if !local.finite() || !world.finite() || world.hi >= limit {
            return Ok(false);
        }
        if local.hi >= limit && normal.to_array().into_iter().all(|v| v != 0.) {
            return Ok(false);
        }
        if local.hi >= limit
            && !matches!(
                rounded_cap_projection(
                    translation,
                    point,
                    radius,
                    normal,
                    limit,
                    local_error,
                    CapQuery::Plane,
                    work
                )?,
                CapPlane::Below
            )
        {
            return Ok(false);
        }
        if through == last {
            return Ok(true);
        }
        first = through + 1;
    }
    Ok(false)
}

enum CapPlane {
    Below,
    Reaches(rp::Vector),
    Upper(f64),
    Unknown,
}

enum CapQuery<'a> {
    Plane,
    Edge(EdgeProjection<'a>),
    Witness(&'a dyn Fn(rp::Vector) -> bool),
    Upper,
}

struct EdgeProjection<'a> {
    shape: &'a rp::ConvexPolyhedron,
    pose: rp::Pose,
    point: rp::Vector,
    skin: Bound,
}

/// Strictly separate both the real world-radius and rounded local-radius
/// graphs at the left endpoint of an adjacent-time bracket.
pub(in crate::physics3d::solver_trajectory) fn rounded_capsule_pair_separated(
    poses: [rp::Pose; 2],
    capsules: [&rp::Capsule; 2],
    mut normal: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let segment_axis = (capsules[0].segment.b - capsules[0].segment.a)
        .abs()
        .max_position();
    if clearance <= 0.
        || poses
            .iter()
            .any(|p| !p.is_finite() || p.rotation != rp::Rotation::IDENTITY)
        || capsules.iter().any(|c| {
            c.segment.a[segment_axis] == c.segment.b[segment_axis]
                || (0..3).any(|i| i != segment_axis && c.segment.a[i] != c.segment.b[i])
        })
    {
        return Ok(false);
    }
    normal[segment_axis] = 0.;
    if normal.to_array().into_iter().filter(|&v| v != 0.).count() != 2 {
        return Ok(false);
    }
    work.charge(512)?;
    let norm = super::super::super::dot(normal, normal).sqrt();
    let limit = -Bound::exact(f64::from(clearance)).mul(norm).hi;
    let f = |v| Bound::exact(f64::from(v));
    let mut sum = Bound::exact(0.);
    for ((pose, capsule), axis) in poses.into_iter().zip(capsules).zip([normal, -normal]) {
        let translation = pose.translation.to_array();
        let point = capsule.segment.a;
        let radius = capsule.radius;
        let extension = f(radius).mul(norm);
        let centers = std::array::from_fn(|i| {
            Value::input(Float::exact(translation[i])).add(Value::local(point[i], radius))
        });
        let other_end = Value::input(Float::exact(translation[segment_axis]))
            .add(Value::local(capsule.segment.b[segment_axis], radius));
        if !other_end.finite() || centers.iter().any(|center| !center.finite()) {
            return Ok(false);
        }
        // The transverse projection annihilates the whole axial segment.
        let world =
            dot_value(std::array::from_fn(|i| f(translation[i] + point[i])), axis).add(extension);
        let local = dot_value(
            std::array::from_fn(|i| f(translation[i]).add(f(point[i]))),
            axis,
        )
        .add(extension);
        let errors = centers.map(|center| center.error);
        let rounding = Bound::exact(projected_error(errors, axis));
        let cutoff = local.sub(rounding).lo;
        let local_upper = match rounded_cap_projection(
            translation,
            point,
            radius,
            axis,
            cutoff,
            errors,
            CapQuery::Upper,
            work,
        )? {
            CapPlane::Below => cutoff,
            CapPlane::Upper(upper) => upper,
            _ => local.add(rounding).hi,
        };
        sum = sum.add(Bound::exact(world.hi.max(local_upper)));
    }
    Ok(sum.finite() && sum.hi < limit)
}

#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn rounded_cap_edge_separated(
    hull: &rp::ConvexPolyhedron,
    hull_pose: rp::Pose,
    edge: rp::Vector,
    capsule: &rp::Capsule,
    translations: [rp::Vector; 2],
    inward: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let [a, b] = [capsule.segment.a, capsule.segment.b];
    let axis = (b - a).abs().max_position();
    if hull_pose.rotation != rp::Rotation::IDENTITY
        || inward.to_array().into_iter().filter(|&v| v != 0.).count() != 2
        || inward[axis] == 0.
        || (0..3).any(|i| i != axis && a[i] != b[i])
        || !clearance.is_finite()
        || clearance <= 0.
    {
        return Ok(false);
    }
    let point = if (b[axis] - a[axis]) * inward[axis] > 0. {
        b
    } else {
        a
    };
    let translation = std::array::from_fn(|i| {
        let [a, b] = translations.map(|v| v[i]);
        if inward[i] < 0. {
            a.min(b)
        } else {
            a.max(b)
        }
    });
    let [x, y, z] = edge.to_array().map(|p| Bound::exact(f64::from(p)));
    let plane = dot_value([x, y, z], inward);
    let norm = super::super::super::dot(inward, inward).sqrt();
    let f = |v| Bound::exact(f64::from(v));
    let skin = f(clearance);
    let limit = plane.sub(skin.mul(norm));
    let core = dot_value(
        std::array::from_fn(|i| f(translation[i] + point[i])),
        inward,
    );
    if !limit.finite() || core.add(f(capsule.radius).mul(norm)).hi >= limit.lo {
        return Ok(false);
    }
    work.charge(hull.points().len() as u64 * 64 + 128)?;
    if hull.points().iter().any(|&vertex| {
        let p = hull_pose * vertex;
        let relative = std::array::from_fn(|i| f(p[i]).sub(f(edge[i])));
        dot_value(relative, inward).lo < 0.
    }) {
        return Ok(false);
    }
    let error = std::array::from_fn(|i| {
        Value::input(Float::exact(translation[i]))
            .add(Value::local(point[i], capsule.radius))
            .error
    });
    let edge = EdgeProjection {
        shape: hull,
        pose: hull_pose,
        point: edge,
        skin,
    };
    Ok(matches!(
        rounded_cap_projection(
            translation,
            point,
            capsule.radius,
            inward,
            limit.lo,
            error,
            CapQuery::Edge(edge),
            work,
        )?,
        CapPlane::Below
    ))
}

pub(in crate::physics3d::solver_trajectory) fn rounded_cap_plane_witness(
    translation: rp::Vector,
    point: rp::Vector,
    radius: f32,
    normal: rp::Vector,
    limit: f64,
    accept: impl Fn(rp::Vector) -> bool,
    work: &mut Work,
) -> Result<Option<rp::Vector>, TrajectoryError> {
    if normal.to_array().into_iter().all(|x| x != 0.) {
        return oblique_pole::witness(translation, point, radius, normal, limit, accept, work);
    }
    let error = std::array::from_fn(|i| {
        Value::input(Float::exact(translation[i]))
            .add(Value::local(point[i], radius))
            .error
    });
    match rounded_cap_projection(
        translation.to_array(),
        point,
        radius,
        normal,
        limit,
        error,
        CapQuery::Witness(&accept),
        work,
    )? {
        CapPlane::Reaches(point) => Ok(Some(point)),
        _ => Ok(None),
    }
}

#[allow(clippy::too_many_arguments)]
fn rounded_cap_projection(
    translation: [f32; 3],
    point: rp::Vector,
    radius: f32,
    normal: rp::Vector,
    limit: f64,
    error: [f64; 3],
    query: CapQuery<'_>,
    work: &mut Work,
) -> Result<CapPlane, TrajectoryError> {
    use CapPlane::*;
    let major = normal.abs().max_position();
    let minor = (0..3).find(|&i| i != major && normal[i] != 0.);
    let Some(minor) = minor else {
        return Ok(Unknown);
    };
    let signed = |i: usize, v: f32| normal[i].signum() * v;
    let t = translation.map(f64::from);
    let f = |x| Bound::exact(f64::from(x));
    let n = normal.abs();
    let center = dot_value(
        std::array::from_fn(|i| Bound::exact(t[i]).add(f(point[i]))),
        normal,
    );
    let distance = Bound::exact(limit).sub(center);
    let need = distance.sub(Bound::exact(projected_error(error, normal)));
    let [x, y] = [f(n[minor]), f(n[major])];
    let n2 = x.mul(x).add(y.mul(y));
    let r2 = f(radius).mul(f(radius));
    if !need.finite() || need.lo <= 0. || n2.lo <= 0. {
        return Ok(Unknown);
    }
    // A point that could reach the plane lies in this circular slice. Its
    // axial ends are on the cut unless the disk pole itself is in the slice.
    let inverse = Bound {
        lo: (1. / n2.hi).next_down(),
        hi: (1. / n2.lo).next_up(),
    };
    let slice = |axial: Bound, tangent: Bound, core, need| {
        let need = Bound::exact(need);
        let discriminant = r2.mul(n2).sub(need.mul(need));
        if discriminant.hi < 0. {
            return None;
        }
        let radius = f(radius);
        let width = tangent.mul(
            Bound {
                lo: discriminant.lo.max(0.),
                hi: discriminant.hi,
            }
            .sqrt(),
        );
        let mid = axial.mul(need);
        let lo = mid.sub(width).mul(inverse).lo;
        let hi = if axial.mul(radius).hi >= need.lo {
            radius.hi
        } else {
            mid.add(width).mul(inverse).hi
        };
        let bounds = f(core).add(Bound { lo, hi });
        Some(Float::span(bounds.lo as f32, bounds.hi as f32))
    };
    let ty = signed(major, translation[major]);
    let ey = signed(major, point[major]);
    let tx = signed(minor, translation[minor]);
    let ex = signed(minor, point[minor]);
    let (Some(local_y), Some(local_x)) = (slice(y, x, ey, need.lo), slice(x, y, ex, need.lo))
    else {
        return Ok(Below);
    };
    let edge = if let CapQuery::Edge(edge) = &query {
        let [edge_x, edge_y] = [minor, major].map(|i| f(signed(i, edge.point[i])));
        let away = |p: Bound, world: Float| {
            p.sub(Bound {
                lo: f64::from(world.lo),
                hi: f64::from(world.hi),
            })
        };
        let dx = away(edge_x, Float::exact(tx).add(local_x));
        let dy = away(edge_y, Float::exact(ty).add(local_y));
        // For every threatening rounded cap point, its vector from the
        // crest must support the entire projected hull. This also covers
        // its shaft, which extends away from the crest along the cap axis.
        work.charge(edge.shape.points().len() as u64 * 64 + 128)?;
        if dx.lo <= 0.
            || dy.lo <= 0.
            || edge.shape.points().iter().any(|&vertex| {
                let p = edge.pose * vertex;
                let x = f(signed(minor, p[minor])).sub(edge_x);
                let y = f(signed(major, p[major])).sub(edge_y);
                dx.mul(x).add(dy.mul(y)).lo < 0.
            })
        {
            return Ok(Unknown);
        }
        Some((edge_x, edge_y, edge.skin.mul(edge.skin)))
    } else {
        None
    };
    work.charge(128)?;
    // Only points in the first slice can reach the plane. Recompute their
    // rounding contribution, including exact cancellation on this subrange.
    let (x_rounding, _) = cap_slice_rounding(tx, local_x);
    let (y_rounding, exact_y) = cap_slice_rounding(ty, local_y);
    let project_rounding = |minor_rounding| {
        Bound::exact(upper_add(
            upper_mul(x.hi, error[minor].min(minor_rounding)),
            upper_mul(y.hi, error[major].min(y_rounding)),
        ))
    };
    let projected_rounding = project_rounding(x_rounding);
    let ideal = center.add(r2.mul(n2).sqrt());
    let support = ideal.add(projected_rounding);
    let world_x = Float::exact(tx).add(local_x);
    if exact_y {
        let steps = [grid_step(world_x) * x.hi, grid_step(local_y) * y.hi];
        let unit = steps[0].min(steps[1]);
        // With exact axial addition, these projected coordinates lie on
        // a grid translated by the axial shift. If the spacings divide,
        // the first possible projected point can be above the support.
        if unit > 0. && unit.is_finite() && steps[0].max(steps[1]) % unit == 0. {
            let shift = f(ty).mul(y);
            let index = (Bound::exact(limit).sub(shift).lo / unit)
                .next_down()
                .ceil();
            let first = shift.add(Bound::exact(index).mul(Bound::exact(unit)));
            if support.hi < first.lo {
                return Ok(Below);
            }
            // If only this odd plane is reachable, its minor coordinate
            // must have an odd grid index: the axial term is an even multiple
            // after removing the fixed shift. Such an output cannot take a tie.
            const ODD_PLANE_WORK: u64 = 64;
            if steps[0] == unit
                && steps[1] % (2. * unit) == 0.
                && index.abs() % 2. == 1.
                && support.hi < first.add(Bound::exact(unit)).lo
                && work.limit.saturating_sub(work.used) >= ODD_PLANE_WORK
            {
                work.charge(ODD_PLANE_WORK)?;
                if let Some(error) = odd_cap_slice_rounding(tx, local_x, world_x) {
                    if ideal.add(project_rounding(error)).hi < first.lo {
                        return Ok(Below);
                    }
                }
            }
        }
    } else {
        // Both final coordinates are F32 outputs even when adding the
        // translation rounds. Their projected plane levels share an origin
        // at zero and a grid when one weighted spacing divides the other.
        let world_y = Float::exact(ty).add(local_y);
        let dx = grid_step(world_x) * x.hi;
        let dy = grid_step(world_y) * y.hi;
        let unit = dx.min(dy);
        if unit > 0. && unit.is_finite() && dx.max(dy) % unit == 0. {
            let index = (limit / unit).next_down().ceil();
            let first = Bound::exact(index).mul(Bound::exact(unit));
            if first.finite() && support.hi < first.lo {
                return Ok(Below);
            }
        }
    }
    let refined = distance.sub(projected_rounding);
    let Some(local) = slice(y, x, ey, need.lo.max(refined.lo)) else {
        return Ok(Below);
    };
    let local = [local.lo, local.hi];
    let world = local.map(|q| ty + q);
    let span = |[lo, hi]: [f32; 2]| {
        if lo.is_finite() && hi.is_finite() && lo.is_sign_negative() == hi.is_sign_negative() {
            lo.to_bits().abs_diff(hi.to_bits())
        } else {
            u32::MAX
        }
    };
    // Cancellation can make the represented world grid finer than the
    // local grid. Walk local cells in that case, so unreachable world bins
    // cannot hide a reachable contact or prevent a separation proof.
    let walk_local = span(local) < span(world);
    let [mut cell, last] = if walk_local { local } else { world };
    // Cap this optional proof before entering the running loop. A wider
    // local range still takes less work than its skipped world image.
    const MAX_WORLD_CELLS: u32 = 1024;
    const MAX_LOCAL_CELLS: u32 = 4096;
    let max_cells = if walk_local {
        MAX_LOCAL_CELLS
    } else {
        MAX_WORLD_CELLS
    };
    if span([cell, last]) >= max_cells {
        return Ok(Unknown);
    }
    let mut uncertain = false;
    let mut upper = limit;
    while cell <= last {
        work.charge(24)?;
        let (q, ay) = if walk_local {
            (ty + cell, cap_cell_start(cell).sub(f(ey)))
        } else {
            let Some(ay) = cap_output_cell_start(cell, ty, ey) else {
                return Ok(Unknown);
            };
            (cell, ay)
        };
        if ay.lo == f64::INFINITY {
            cell = cell.next_up();
            continue;
        }
        let axial = ay.lo.max(0.);
        let remaining = r2.sub(Bound::exact(axial).mul(Bound::exact(axial)));
        if remaining.hi >= 0. {
            let width = Bound {
                lo: remaining.lo.max(0.),
                hi: remaining.hi,
            }
            .sqrt()
            .hi;
            let other = tx + (f(ex).add(Bound::exact(width)).hi as f32);
            let projection = f(q).mul(y).add(f(other).mul(x));
            if matches!(query, CapQuery::Upper) {
                upper = upper.max(projection.hi);
            } else if projection.hi >= limit {
                if let Some((edge_x, edge_y, skin2)) = edge {
                    let dx = edge_x.sub(f(other));
                    let dy = edge_y.sub(f(q));
                    if dx.lo >= 0. && dy.lo >= 0. && dx.mul(dx).add(dy.mul(dy)).lo > skin2.hi {
                        cell = cell.next_up();
                        continue;
                    }
                }
                let CapQuery::Witness(accept) = query else {
                    return Ok(Unknown);
                };
                uncertain = true;
                for candidate in [other, other.next_down()] {
                    let Some(ax) = cap_output_cell_start(candidate, tx, ex) else {
                        continue;
                    };
                    if ax.lo > 0.
                        && ay.lo > 0.
                        && ax.mul(ax).add(ay.mul(ay)).hi < r2.lo
                        && f(q).mul(y).add(f(candidate).mul(x)).lo >= limit
                    {
                        // The closest corner lies strictly inside the disk,
                        // so the two closed cells have a reachable interior.
                        let mut sample = rp::Vector::from_array(translation) + point;
                        sample[major] = signed(major, q);
                        sample[minor] = signed(minor, candidate);
                        if accept(sample) {
                            return Ok(Reaches(sample));
                        }
                    }
                }
            }
        }
        cell = cell.next_up();
    }
    Ok(if matches!(query, CapQuery::Upper) {
        Upper(upper)
    } else if uncertain {
        Unknown
    } else {
        Below
    })
}

fn cap_slice_rounding(shift: f32, local: Float) -> (f64, bool) {
    let shift_cells = Float::exact(shift);
    let sum_error = half_ulp(shift_cells.add(local));
    // A sum of two points on the same dyadic grid is exact when its
    // result bins are at least as fine as the two input grids.
    let exact_grid =
        sum_error.is_finite() && sum_error * 2. <= grid_step(shift_cells).min(grid_step(local));
    let exact = exact_grid
        || [local.lo, local.hi].into_iter().all(|v| {
            v.is_sign_negative() != shift.is_sign_negative()
                && f64::from(v.abs()) * 2. >= f64::from(shift.abs())
                && f64::from(v.abs()) <= f64::from(shift.abs()) * 2.
        });
    let addition = if exact { 0. } else { sum_error };
    (upper_add(half_ulp(local), addition), exact)
}

fn odd_cap_slice_rounding(shift: f32, local: Float, output: Float) -> Option<f64> {
    let half = half_ulp(output);
    let operand_step = grid_step(Float::exact(shift)).min(grid_step(local));
    if !half.is_finite()
        || grid_step(output) != 2. * half
        || operand_step <= 0.
        || operand_step > half
    {
        return None;
    }
    // A uniform output grid identifies odd indices with odd significands.
    // The exact sum and the midpoint are both on the operand grid, so a
    // nontie is at least one operand step away from the midpoint.
    let addition = Bound::exact(half).sub(Bound::exact(operand_step));
    Some(upper_add(half_ulp(local), addition.hi))
}

fn grid_step(range: Float) -> f64 {
    if !range.finite() {
        return f64::INFINITY;
    }
    let smallest = if range.lo > 0. {
        range.lo
    } else {
        (-range.hi).max(0.)
    };
    half_ulp(Float::exact(smallest)) * 2.
}

fn cap_cell_start(value: f32) -> Bound {
    Bound::exact(f64::from(value))
        .add(Bound::exact(f64::from(value.next_down())))
        .mul(Bound::exact(0.5))
}

fn cap_output_cell_start(output: f32, translation: f32, end: f32) -> Option<Bound> {
    let f = |v| Bound::exact(f64::from(v));
    let lower = cap_cell_start(output).sub(f(translation)).lo;
    let mut local = lower as f32;
    if translation + local < output {
        local = local.next_up();
    }
    if translation + local < output || translation + local.next_down() >= output {
        return None;
    }
    if translation + local > output {
        return Some(Bound::exact(f64::INFINITY));
    }
    Some(cap_cell_start(local).sub(f(end)))
}

fn box_upper(
    frames: &Frames,
    bounds: [rp::Vector; 2],
    normal: rp::Vector,
    work: &mut Work,
) -> Result<Option<f64>, TrajectoryError> {
    // Same established per-cloud hull/coefficient/eight streamed vertex prices.
    // The full represented closed slab is the input, never face samples.
    work.charge(4096 + 8 * 512 + frames.len as u64 * 32 + 8 * 64 + 128)?;
    let frame = union(frames);
    let output = transform(
        frame,
        std::array::from_fn(|i| Value::input(Float::span(bounds[0][i], bounds[1][i]))),
    );
    if output.iter().any(|v| !v.finite()) {
        return Ok(None);
    }
    let error = projected_error(output.map(|v| v.error), normal);
    let ideal = IdealTransform::new(frame);
    let mut upper = f64::NEG_INFINITY;
    for key in 0..8 {
        let p = rp::Vector::from_array(std::array::from_fn(|i| {
            bounds[usize::from(key & (1 << i) != 0)][i]
        }));
        let point = ideal.point(p);
        if point.iter().any(|v| !v.finite()) {
            return Ok(None);
        }
        upper = upper.max(dot_value(point, normal).hi);
    }
    let upper = (upper + error).next_up();
    Ok(upper.is_finite().then_some(upper))
}

#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory::rounded::output) fn separated(
    context: Context<'_>,
    a: &Frames,
    pa: &ToiProxy<'_>,
    b: &Frames,
    pb: &ToiProxy<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if separated_impl::<false, false>(context, a, pa, b, pb, normal, work)? {
        return Ok(true);
    }
    shared_translation_cells(context, normal, work)
}

// The independent support bounds can combine the Box's lowest COM with
// a capsule COM from an earlier time. Keep the same moving pair and split
// the time domain at each attained value of their shared Native component.
fn shared_translation_cells(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    const MAX_CELLS: u32 = 128;

    let (cuboid, capsule) = if context.sa.as_cuboid().is_some() && context.sb.as_capsule().is_some()
    {
        (context.a, context.b)
    } else if context.sb.as_cuboid().is_some() && context.sa.as_capsule().is_some() {
        (context.b, context.a)
    } else {
        return Ok(false);
    };
    let (
        Curve::Integrated(b),
        Curve::Anchored {
            carrier, rotation, ..
        },
    ) = (cuboid.curve, capsule.curve)
    else {
        return Ok(false);
    };
    let Some(axis) = (0..3).max_by(|&i, &j| normal[i].abs().total_cmp(&normal[j].abs())) else {
        return Ok(false);
    };
    let origin = b.native.motion.start.translation[axis];
    let velocity = b.native.linear_velocity[axis];
    let stored_end = b.native.motion.end.translation[axis];
    let identity = |q: rp::Rotation| q.to_array().map(f32::to_bits) == [0, 0, 0, 1_f32.to_bits()];
    if !normal.is_finite()
        || normal[axis] == 0.
        || !context.start.is_finite()
        || !context.end.is_finite()
        || context.start.is_sign_negative()
        || context.start >= context.end
        || context.start < b.domain.start
        || context.end > b.domain.end
        || !origin.is_finite()
        || !stored_end.is_finite()
        || stored_end <= 0.
        || !velocity.is_finite()
        || velocity >= 0.
        || b.native.angular_velocity == rp::Vector::ZERO
        || carrier.native.angular_velocity != rp::Vector::ZERO
        || !identity(carrier.native.motion.start.rotation)
        || !identity(carrier.native.motion.end.rotation)
        || !identity(rotation)
        || ![cuboid, capsule].into_iter().all(|m| {
            m.local_center == rp::Vector::ZERO
                && m.local_pose.translation == rp::Vector::ZERO
                && identity(m.local_pose.rotation)
        })
        || carrier.domain.start.to_bits() != b.domain.start.to_bits()
        || carrier.domain.end.to_bits() != b.domain.end.to_bits()
        || carrier.native.integration_seconds.to_bits() != b.native.integration_seconds.to_bits()
        || carrier.native.motion.start.translation[axis].to_bits() != origin.to_bits()
        || carrier.native.motion.end.translation[axis].to_bits() != stored_end.to_bits()
        || carrier.native.linear_velocity[axis].to_bits() != velocity.to_bits()
    {
        return Ok(false);
    }
    work.charge(512)?;
    Kernel::from_native(b.native, b.domain)?;
    Kernel::from_native(carrier.native, carrier.domain)?;
    if (origin + velocity * b.native.integration_seconds).to_bits() != stored_end.to_bits() {
        return Ok(false);
    }

    // This scalar uses the original physical dt, multiply and add. On the
    // positive translation domain the endpoints and interior form a
    // monotone decreasing bit sequence, including Native dt=0/h.
    let component = |time| (origin + velocity * b.local_delta(Time::from_bits(time))).to_bits();
    let mut cursor = context.start.to_bits();
    let end = context.end.to_bits();
    let mut value = component(cursor);
    let final_value = component(end);
    let Some(delta) = value.checked_sub(final_value) else {
        return Ok(false);
    };
    if delta >= MAX_CELLS {
        return Ok(false);
    }
    for _ in 0..=delta {
        work.charge(64)?;
        let cell_end = if value == final_value {
            end
        } else {
            // At these nonnegative finite times, consecutive bit keys are
            // adjacent represented instants. End just before the first key
            // with a different component. No represented time is skipped.
            let (mut low, mut high) = (cursor + 1, end);
            while low < high {
                work.charge(32)?;
                let middle = low + (high - low) / 2;
                if component(middle) == value {
                    low = middle + 1;
                } else {
                    high = middle;
                }
            }
            low - 1
        };
        let local_axis =
            [rp::Vector::X, rp::Vector::Y, rp::Vector::Z][axis] * normal[axis].signum();
        let complete = |first, last, work: &mut Work| {
            shared_cell_separated(context, first, last, b, local_axis, normal, work)
        };
        if !complete(cursor, cell_end, work)? {
            if cursor == cell_end {
                return Ok(false);
            }
            work.charge(64)?;
            let middle = cursor + (cell_end - cursor) / 2;
            for (first, last) in [(cursor, middle), (middle + 1, cell_end)] {
                if complete(first, last, work)? {
                    continue;
                }
                if first == last {
                    return Ok(false);
                }
                work.charge(64)?;
                let middle = first + (last - first) / 2;
                if !complete(first, middle, work)? || !complete(middle + 1, last, work)? {
                    return Ok(false);
                }
            }
        }
        if cell_end == end {
            return Ok(true);
        }
        cursor = cell_end + 1;
        work.charge(32)?;
        value = component(cursor);
    }
    Ok(false)
}

fn shared_cell_separated(
    context: Context<'_>,
    first: u64,
    last: u64,
    cuboid: Kernel,
    local_axis: rp::Vector,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let cell = Context {
        start: Time::from_bits(first),
        end: Time::from_bits(last),
        ..context
    };
    let Some(prepared) = super::super::prepare(cell, work)? else {
        return Ok(false);
    };
    // A representative pose chooses a direction only. Every original
    // pose and both radius graphs in the entire cell are still enclosed.
    work.charge(512)?;
    let middle = Time::from_bits(first + (last - first) / 2);
    let face = cuboid.position_at_time(middle).rotation * local_axis;
    let complete = |direction, work: &mut Work| {
        separated_impl::<false, true>(
            cell,
            &prepared.a,
            &prepared.pa,
            &prepared.b,
            &prepared.pb,
            direction,
            work,
        )
    };
    Ok(complete(face, work)? || (face != normal && complete(normal, work)?))
}

// An actual collider-pose cell is already after COM/local transforms. Reuse
// the identical complete shape support on exact frames, without reapplying a
// local pose, normalizing q, traversing time or issuing a Native query.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory::rounded::output) fn strict_static(
    pose_a: &rp::Pose,
    sa: &dyn rp::Shape,
    pa: &ToiProxy<'_>,
    pose_b: &rp::Pose,
    sb: &dyn rp::Shape,
    pb: &ToiProxy<'_>,
    normal: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if !((sa.as_cuboid().is_some() && pa.radius == 0. && pb.radius > 0.)
        || (sb.as_cuboid().is_some() && pb.radius == 0. && pa.radius > 0.))
    {
        return Ok(false);
    }
    // For a horizontal oblique face, the distant ends of a wide wall can
    // dominate rounding along both world coordinates of the normal.
    let pair = if let (Some(cube), Some(cap)) = (sa.as_cuboid(), sb.as_capsule()) {
        Some((*pose_a, cube, *pose_b, cap, normal))
    } else {
        sb.as_cuboid()
            .zip(sa.as_capsule())
            .map(|(cube, cap)| (*pose_b, cube, *pose_a, cap, -normal))
    };
    if let Some((wall, cube, actor, cap, direction)) = pair {
        if wall.rotation != rp::Rotation::IDENTITY
            && direction.y == 0.
            && direction.x != 0.
            && direction.z != 0.
            && super::tight_face::static_separated(
                wall, cube, actor, cap, direction, clearance, work,
            )?
        {
            return Ok(true);
        }
    }
    work.charge(128)?; // exact actual collider-frame admission, no pose evaluation
    let mut a = Frames::new();
    let mut b = Frames::new();
    if a.push(Frame::exact(*pose_a)).is_none() || b.push(Frame::exact(*pose_b)).is_none() {
        return Ok(false);
    }
    let motion = |pose| ShapeMotion {
        curve: Curve::Constant {
            pose,
            start_time: 0.,
            end_time: 0.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let context = Context {
        a: motion(*pose_a),
        sa,
        b: motion(*pose_b),
        sb,
        start: 0.,
        end: 0.,
        clearance,
    };
    separated_impl::<true, false>(context, &a, pa, &b, pb, normal, work)
}

#[allow(clippy::too_many_arguments)]
fn separated_impl<const STRICT: bool, const SHARED_CELL: bool>(
    context: Context<'_>,
    a: &Frames,
    pa: &ToiProxy<'_>,
    b: &Frames,
    pb: &ToiProxy<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (box_frames, cuboid, other_frames, other_proxy, n) =
        if let Some(cuboid) = context.sa.as_cuboid() {
            if pa.radius != 0. || pb.radius <= 0. {
                return Ok(false);
            }
            (a, cuboid, b, pb, normal)
        } else if let Some(cuboid) = context.sb.as_cuboid() {
            if pb.radius != 0. || pa.radius <= 0. {
                return Ok(false);
            }
            (b, cuboid, a, pa, -normal)
        } else {
            return Ok(false);
        };
    work.charge(64 + (a.len + b.len) as u64 * 32)?;
    if a.len == 0
        || b.len == 0
        || !normal.is_finite()
        || !context.clearance.is_finite()
        || !cuboid.half_extents.is_finite()
        || cuboid.half_extents.min_element() <= 0.
    {
        return Ok(false);
    }
    // Existing Frames enclose every stored/interior output in the entire
    // context. The same complete range is used for every closed box slab.
    let norm2 = super::super::super::dot(n, n);
    if norm2.lo <= 0. || !norm2.hi.is_finite() {
        return Ok(false);
    }
    let norm = norm2.sqrt();
    let margin = Bound::exact(f64::from(context.clearance)).mul(norm);
    let Some(other) = prepare_cloud(other_frames, other_proxy, work)? else {
        return Ok(false);
    };
    let Some(mut lower) = cloud_lower(&other, n, norm, work)? else {
        return Ok(false);
    };
    let other_shape = if context.sa.as_cuboid().is_some() {
        context.sb
    } else {
        context.sa
    };
    let projection = if let Some(capsule) = other_shape.as_capsule() {
        CapsuleProjection::prepare(other_frames, capsule, -n, norm, work)?
    } else {
        None
    };
    if let Some(projection) = &projection {
        // The shared-cell midpoint plane is near the capsule pole. Use its
        // tight dual first. This changes neither the visited point set nor
        // the original local/world radius maximum.
        let weights: &[f64] = if SHARED_CELL {
            &[CELL_WEIGHT, NEAR_POLE_WEIGHT]
        } else {
            &ORIGINAL_WEIGHTS
        };
        if let Some(upper) = projection.upper(weights, work)? {
            lower = lower.max(-upper);
        }
    }
    let half = cuboid.half_extents;
    let axis = (0..3)
        .max_by(|&i, &j| n[i].abs().total_cmp(&n[j].abs()))
        .ok_or(TrajectoryError::InvalidReference)?;
    // Five complete slab bounds, local to this immutable proof invocation.
    // None=unvisited; Some(None)=unavailable; Some(Some(v))=complete upper.
    // Reusing only performed work cannot turn a partial/unavailable slab clear.
    let mut uppers: [Option<Option<f64>>; 5] = [None; 5];
    let mut attempt = |lower: f64, work: &mut Work| -> Result<bool, TrajectoryError> {
        let mut check = |slot: usize, bounds, work: &mut Work| -> Result<bool, TrajectoryError> {
            let upper = match uppers[slot] {
                Some(upper) => upper,
                None => {
                    let upper = box_upper(box_frames, bounds, n, work)?;
                    uppers[slot] = Some(upper);
                    upper
                }
            };
            Ok(upper.is_some_and(|upper| {
                let gap = Bound::exact(lower).sub(Bound::exact(upper)).sub(margin).lo;
                if STRICT {
                    gap > 0.
                } else {
                    gap >= 0.
                }
            }))
        };
        if !SHARED_CELL && check(0, [-half, half], work)? {
            return Ok(true);
        }
        let near_lower = n[axis] < 0.;
        let near_split = if near_lower {
            -half[axis] * 0.5
        } else {
            half[axis] * 0.5
        };
        let splits = [(0, 0.), (1, near_split)];
        let order = if SHARED_CELL { [1, 0] } else { [0, 1] };
        for index in order {
            let (i, split) = splits[index];
            let mut lower_half = [-half, half];
            lower_half[1][axis] = split;
            let mut upper_half = [-half, half];
            upper_half[0][axis] = split;
            let lower = (1 + i * 2, lower_half);
            let upper = (2 + i * 2, upper_half);
            let (a, b) = if SHARED_CELL && i == 1 && !near_lower {
                (upper, lower)
            } else {
                (lower, upper)
            };
            if check(a.0, a.1, work)? && check(b.0, b.1, work)? {
                return Ok(true);
            }
        }
        Ok(SHARED_CELL && check(0, [-half, half], work)?)
    };
    if attempt(lower, work)? {
        return Ok(true);
    }
    // General calls keep their original additional near-pole visit.
    // Shared cells fall back to the original dual weights after the
    // tight near-pole weights fail.
    if let Some(projection) = &projection {
        let weights: &[f64] = if SHARED_CELL {
            &ORIGINAL_WEIGHTS
        } else {
            &[NEAR_POLE_WEIGHT]
        };
        for &weight in weights {
            if let Some(upper) = projection.upper(&[weight], work)? {
                let tighter = lower.max(-upper);
                if tighter > lower {
                    if attempt(tighter, work)? {
                        return Ok(true);
                    }
                    lower = tighter;
                }
            }
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests;
