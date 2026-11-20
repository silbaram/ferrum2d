//! Full-shape separation for an integrated cuboid against a stationary sphere.
//! The moving face proof encloses both radius paths and preserves the common
//! Native time in the projection when its rounded coefficients permit it.
use super::*;
mod translating_capsule;
pub(in crate::physics3d::solver_trajectory::rounded::output) use translating_capsule::{
    fixed_wall_overlap, fixed_wall_separated, fixed_wall_time_hint,
};

// Test the same moving box face at every represented time. For a real
// quaternion q, R(q) scales by s=|q|². Thus n=R(q)*e_i has length s, and the
// ideal face support relative to the box origin is s²*h_i. Bound the errors
// of the original scalar transform over the complete box and ball hulls.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory::rounded::output) fn rotating_box_ball_face(
    frames: &Frames,
    cuboid: &rp::Cuboid,
    ball_frames: &Frames,
    ball: &rp::Ball,
    direction: rp::Vector,
    clearance: f32,
    context: Context<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(512 + (frames.len + ball_frames.len) as u64 * 64)?;
    if frames.len == 0
        || ball_frames.len == 0
        || !direction.is_finite()
        || !cuboid.half_extents.is_finite()
        || !ball.radius.is_finite()
        || cuboid.half_extents.min_element() < 0.
        || ball.radius < 0.
    {
        return Ok(false);
    }
    rotating_round_face(
        frames,
        cuboid,
        union(ball_frames),
        ball,
        direction,
        clearance,
        context,
        None,
        work,
    )
}

#[derive(Clone, Copy)]
struct CapsuleSlab {
    axis: usize,
    translation: Float,
    core: Float,
}

fn target_value(frame: Frame, slab: Option<CapsuleSlab>, i: usize, radial: Float) -> Value {
    let radial = Value {
        error: if radial.lo == radial.hi {
            0.
        } else {
            let r = radial.lo.abs().max(radial.hi.abs());
            half_ulp(Float::exact(r.next_down()))
        },
        ..Value::input(radial)
    };
    let Some(slab) = slab.filter(|slab| slab.axis == i) else {
        return radial.add(Value::input(frame.translation[i]));
    };
    let shift = Value::input(slab.translation);
    let core = Value::input(slab.core);
    let actual = slab.core.add(radial.actual);
    let local = Value {
        actual,
        ideal: core.ideal.add(radial.ideal),
        error: half_ulp(actual),
    }
    .add(shift);
    let world = core.add(shift).add(radial);
    Value {
        actual: Float::span(
            local.actual.lo.min(world.actual.lo),
            local.actual.hi.max(world.actual.hi),
        ),
        ideal: local.ideal,
        error: local.error.max(world.error),
    }
}

#[allow(clippy::too_many_arguments)]
fn rotating_round_face(
    frames: &Frames,
    cuboid: &rp::Cuboid,
    ball_frame: Frame,
    ball: &rp::Ball,
    direction: rp::Vector,
    clearance: f32,
    context: Context<'_>,
    slab: Option<CapsuleSlab>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let test = |box_frame, work: &mut Work| {
        rotating_box_ball_face_frame(
            box_frame, cuboid, ball_frame, ball, direction, clearance, context, slab, work,
        )
    };
    if test(union(frames), work)? {
        return Ok(true);
    }
    if !(2..=4).contains(&frames.len) {
        return Ok(false);
    }
    for &frame in &frames.values[..frames.len] {
        if !test(frame, work)? {
            return Ok(false);
        }
    }
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
fn rotating_box_ball_face_frame(
    box_frame: Frame,
    cuboid: &rp::Cuboid,
    ball_frame: Frame,
    ball: &rp::Ball,
    direction: rp::Vector,
    clearance: f32,
    context: Context<'_>,
    slab: Option<CapsuleSlab>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let q = ball_frame.rotation.components;
    if (0..3).any(|i| !exact_value(q[i], 0.)) || !exact_value(q[3], 1.) {
        return Ok(false);
    }
    let q = box_frame.rotation.components;
    if (0..3).all(|i| exact_value(q[i], 0.)) {
        return Ok(false);
    }
    work.charge(1536)?; // one full box/ball hull and three axis nominations
    let ideal = IdealTransform::new(Frame {
        translation: [Float::ZERO; 3],
        ..box_frame
    });
    let reference = box_frame.rotation;
    let (axis, sign) = [rp::Vector::X, rp::Vector::Y, rp::Vector::Z]
        .into_iter()
        .enumerate()
        .map(|(i, n)| {
            let n = reference.vector(n);
            let n = rp::Vector::from_array(n.map(|v| v.lo));
            (i, n.dot(direction))
        })
        .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
        .ok_or(TrajectoryError::InvalidReference)?;
    if !sign.is_finite() || sign == 0. {
        return Ok(false);
    }
    let mut local_normal = rp::Vector::ZERO;
    local_normal[axis] = sign.signum();
    let pivot = (0..3).find(|&i| {
        i != axis && !exact_value(q[i], 0.) && (0..3).all(|j| j == i || exact_value(q[j], 0.))
    });
    let planar = pivot.map(|pivot| {
        let tangent = 3 - pivot - axis;
        let orientation = if (pivot + 1) % 3 == axis { 1. } else { -1. };
        let scale = Value::input(q[3].mul(q[3]).sub(q[pivot].mul(q[pivot])));
        let spin = Value::input(q[pivot]);
        let twice_w = Value::input(q[3]).mul(Value::input(Float::exact(2.)));
        let signed = Bound::exact(f64::from(sign.signum()));
        let mut n = [Bound::exact(0.); 3];
        n[axis] = scale.ideal.mul(signed);
        n[tangent] = spin
            .ideal
            .mul(twice_w.ideal)
            .mul(Bound::exact(orientation))
            .mul(signed);
        let squared = n[axis].mul(n[axis]).add(n[tangent].mul(n[tangent]));
        (
            tangent,
            orientation as f32,
            scale,
            spin,
            twice_w,
            n,
            squared,
        )
    });
    let (n, squared, magnitude_n) = if let Some((_, _, _, _, _, n, squared)) = planar {
        (n, squared, squared.sqrt())
    } else {
        let scale = ideal
            .q
            .into_iter()
            .fold(Bound::exact(0.), |a, q| a.add(q.mul(q)));
        (ideal.point(local_normal), scale.mul(scale), scale)
    };
    if !magnitude_n.finite() || magnitude_n.lo <= 0. || n.iter().any(|x| !x.finite()) {
        return Ok(false);
    }
    let box_values = transform(
        box_frame,
        cuboid
            .half_extents
            .to_array()
            .map(|half| Value::input(Float::span(-half, half))),
    );
    let ball_values = std::array::from_fn::<_, 3, _>(|i| {
        let r = ball.radius;
        let toward_box = if n[i].lo >= 0. {
            Float::span(-r, 0.)
        } else if n[i].hi <= 0. {
            Float::span(0., r)
        } else {
            Float::span(-r, r)
        };
        target_value(ball_frame, slab, i, toward_box)
    });
    let ball_centers: [Bound; 3] = std::array::from_fn(|i| {
        if let Some(slab) = slab.filter(|slab| slab.axis == i) {
            Value::input(slab.translation)
                .ideal
                .add(Value::input(slab.core).ideal)
        } else {
            Value::input(ball_frame.translation[i]).ideal
        }
    });
    // With identity rotation, replacing an away-facing local coordinate
    // with zero leaves a point in the ball and can only lower the projected
    // rounded world output. The half-hull covers every remaining minimum.
    if box_values.iter().chain(&ball_values).any(|v| !v.finite())
        || ball_frame
            .translation
            .into_iter()
            .any(|core| !world_radius_range(core, ball.radius).finite())
    {
        return Ok(false);
    }
    // When the side face is perpendicular to a pure spin axis, both
    // projected coordinates are monotone toward that face. Use the shared
    // rounded diagonal as the exact coefficient in the proof; the real
    // comparison plane remains orthogonal to the ideal tangent with that
    // same coefficient. No actual multiply/add is regrouped.
    let mut box_error = box_values.map(|v| v.error);
    let mut box_origin = box_frame.translation.map(|t| Value::input(t).ideal);
    let mut direct_box_error = box_error;
    if let Some((tangent, orientation, scale, spin, twice_w, _, _)) = planar {
        work.charge(1024)?;
        let h = cuboid.half_extents;
        let flip = Value::input(Float::exact(orientation));
        let rotate_slab = |local: Float, along: Float| {
            let local = Value::input(local);
            let along = Value::input(along);
            let x = along.mul(spin).mul(flip).mul(twice_w);
            let y = local.mul(spin).mul(flip).mul(twice_w);
            [
                face_difference(local.mul(scale), x),
                along.mul(scale).add(y),
            ]
        };
        let full = rotate_slab(
            Float::span(-h[axis], h[axis]),
            Float::span(-h[tangent], h[tangent]),
        );
        let full = [
            full[0].add(Value::input(box_frame.translation[axis])),
            full[1].add(Value::input(box_frame.translation[tangent])),
        ];
        if full.iter().any(|v| !v.finite()) {
            return Ok(false);
        }
        let delta: [Bound; 3] = std::array::from_fn(|i| {
            ball_centers[i].sub(Value::input(box_frame.translation[i]).ideal)
        });
        let mut errors = [0.; 3];
        errors[axis] = full[0].error;
        errors[tangent] = full[1].error;
        let mut along = [Bound::exact(0.); 3];
        along[tangent] = scale.ideal;
        along[axis] = negate(
            spin.ideal
                .mul(twice_w.ideal)
                .mul(Bound::exact(f64::from(orientation))),
        );
        let projection = |n: [Bound; 3]| {
            n.into_iter()
                .zip(delta)
                .fold(Bound::exact(0.), |d, (axis, x)| d.add(axis.mul(x)))
        };
        let error = |n: [Bound; 3]| {
            n.into_iter().zip(errors).fold(0., |e, (axis, v)| {
                upper_add(e, upper_mul(magnitude(axis), v))
            })
        };
        let side_gap = projection(n)
            .sub(squared.mul(Bound::exact(f64::from(h[axis]))))
            .sub(Bound::exact(error(n)));
        let sphere_values: [Value; 3] = std::array::from_fn(|i| {
            target_value(ball_frame, slab, i, Float::span(-ball.radius, ball.radius))
        });
        let sphere_error = sphere_values
            .into_iter()
            .fold(0., |e, x| upper_add(e, upper_mul(x.error, x.error)));
        let sphere_error = sphere_error.sqrt().next_up();
        let usable_radius = Bound::exact(f64::from(ball.radius))
            .add(Bound::exact(f64::from(clearance)))
            .add(Bound::exact(sphere_error));
        let max_distance = usable_radius.mul(usable_radius).mul(squared);
        let other_gap = projection(along);
        let tangent_error = Bound::exact(error(along));
        let cull = |split: f32, left: bool| {
            let edge = squared.mul(Bound::exact(f64::from(split)));
            let direct = if left {
                other_gap.sub(edge)
            } else {
                edge.sub(other_gap)
            };
            let lateral = Bound::exact(direct.sub(tangent_error).lo.max(0.));
            let normal = Bound::exact(side_gap.lo.max(0.));
            let distance = lateral.mul(lateral).add(normal.mul(normal));
            max_distance.finite() && usable_radius.lo >= 0. && distance.lo > max_distance.hi
        };
        let along = cull_ball_tangent_slabs(
            box_frame,
            ball_frame,
            h,
            tangent,
            ball.radius,
            clearance,
            context,
            slab,
            work,
            cull,
        )?;
        let values = rotate_slab(Float::exact(h[axis] * sign.signum()), along);
        if values.iter().any(|v| !v.finite()) {
            return Ok(false);
        }
        for (i, value) in [axis, tangent].into_iter().zip(values) {
            let translation = box_frame.translation[i];
            let placed = value.add(Value::input(translation));
            if !placed.finite() {
                return Ok(false);
            }
            direct_box_error[i] = placed.error;
            if let Some(shift) = rounded_translation_band(value.actual, translation, placed.actual)
            {
                box_origin[i] = shift;
                box_error[i] = value.error;
            } else {
                box_error[i] = placed.error;
            }
        }
    }
    let mut gap = Bound::exact(0.);
    let mut error = 0.;
    for i in 0..3 {
        let t = ball_centers[i].sub(box_origin[i]);
        gap = gap.add(n[i].mul(t));
        error = upper_add(
            error,
            upper_mul(
                magnitude(n[i]),
                upper_add(box_error[i], ball_values[i].error),
            ),
        );
    }
    let margin = Bound::exact(f64::from(ball.radius))
        .add(Bound::exact(f64::from(clearance)))
        .mul(magnitude_n);
    let face_limit = squared.mul(Bound::exact(f64::from(cuboid.half_extents[axis])));
    let nominal = gap.sub(face_limit).sub(margin);
    let mut done = nominal.sub(Bound::exact(error)).lo > 0.;
    if !done && slab.is_none() {
        if let (Some(pivot), Some((tangent, orientation, diagonal, _, twice_w, _, _))) =
            (pivot, planar)
        {
            work.charge(1280)?;
            if let Some((projection, clock_error)) = shared_face_time(
                context,
                ball_frame,
                axis,
                tangent,
                pivot,
                sign.signum(),
                orientation,
                diagonal.actual,
                twice_w.actual,
                n,
            ) {
                let error = (0..3).fold(clock_error, |error, i| {
                    upper_add(
                        error,
                        upper_mul(
                            magnitude(n[i]),
                            upper_add(direct_box_error[i], ball_values[i].error),
                        ),
                    )
                });
                done = projection
                    .sub(face_limit)
                    .sub(margin)
                    .sub(Bound::exact(error))
                    .lo
                    > 0.;
            }
        }
    }
    Ok(done)
}

// The exact rotation and translation use one physical F32 delta. Keep
// that parameter shared while accumulating a certified error for each
// original rounded node. A constant diagonal/normalizer leaves one affine
// normal component, so projection is at most quadratic in the common dt.
#[allow(clippy::too_many_arguments)]
fn shared_face_time(
    context: Context<'_>,
    ball_frame: Frame,
    face: usize,
    tangent: usize,
    pivot: usize,
    sign: f32,
    orientation: f32,
    diagonal: Float,
    twice_w: Float,
    normal: [Bound; 3],
) -> Option<(Bound, f64)> {
    if !singleton(diagonal) || !singleton(twice_w) {
        return None;
    }
    let cube = if context.sa.as_cuboid().is_some() {
        context.a
    } else {
        context.b
    };
    let Curve::Integrated(k) = cube.curve else {
        return None;
    };
    if cube.local_center != rp::Vector::ZERO || cube.local_pose != rp::Pose::IDENTITY {
        return None;
    }
    let native = k.native;
    let start = native.motion.start;
    let omega = native.angular_velocity;
    let raw_start = start.rotation.to_array();
    if (0..3).any(|i| i != pivot && (raw_start[i] != 0. || omega[i] != 0.)) {
        return None;
    }
    let dt = Float::span(k.local_delta(context.start), k.local_delta(context.end));
    if dt.lo <= 0. || dt.hi >= native.integration_seconds {
        return None;
    }
    let f = |x| Value::input(Float::exact(x));
    let half_turn = f(omega[pivot]).mul(Value::input(dt).mul(f(0.5)));
    let raw_z = f(raw_start[pivot]).add(half_turn.mul(f(raw_start[3])));
    let raw_w = f(raw_start[3]).sub(half_turn.mul(f(raw_start[pivot])));
    let raw = std::array::from_fn(|i| {
        if i == pivot {
            raw_z.actual
        } else if i == 3 {
            raw_w.actual
        } else {
            Float::ZERO
        }
    });
    if raw.iter().any(|v| !v.finite()) {
        return None;
    }
    let min = rp::Rotation::from_array(raw.map(|v| {
        if v.lo <= 0. && v.hi >= 0. {
            0.
        } else {
            v.lo.abs().min(v.hi.abs())
        }
    }));
    let max = rp::Rotation::from_array(raw.map(|v| v.lo.abs().max(v.hi.abs())));
    let factor = min.length_recip();
    if !factor.is_finite() || factor <= 0. || factor.to_bits() != max.length_recip().to_bits() {
        return None;
    }
    let rotated = raw_z.mul(f(factor));
    let directed = Bound::exact(f64::from(sign) * f64::from(orientation) * f64::from(twice_w.lo));
    let k0 = Bound::exact(f64::from(raw_start[pivot]))
        .mul(Bound::exact(f64::from(factor)))
        .mul(directed);
    let k1 = Bound::exact(f64::from(omega[pivot]) * 0.5)
        .mul(Bound::exact(f64::from(raw_start[3])))
        .mul(Bound::exact(f64::from(factor)))
        .mul(directed);
    let center = (f64::from(dt.lo) + f64::from(dt.hi)) * 0.5;
    let u = Value::input(dt).ideal.sub(Bound::exact(center));
    let time = Bound::exact(center);
    let change = |i: usize| {
        let slope = Bound::exact(-f64::from(native.linear_velocity[i]));
        let origin = Value::input(ball_frame.translation[i])
            .ideal
            .sub(Bound::exact(f64::from(start.translation[i])))
            .add(slope.mul(time));
        let actual =
            f(start.translation[i]).add(f(native.linear_velocity[i]).mul(Value::input(dt)));
        (origin, slope, actual.error)
    };
    let (in_face, face_rate, face_error) = change(face);
    let (along, along_rate, translation_error) = change(tangent);
    let fixed = Bound::exact(f64::from(sign) * f64::from(diagonal.lo));
    let normal_at_center = k0.add(k1.mul(time));
    let base = fixed.mul(in_face).add(normal_at_center.mul(along));
    let slope = fixed
        .mul(face_rate)
        .add(normal_at_center.mul(along_rate))
        .add(k1.mul(along));
    let squared = k1.mul(along_rate);
    let gap = base.add(slope.mul(u)).add(squared.mul(u.mul(u)));
    let magnitude_along = magnitude(along.add(along_rate.mul(u)));
    let error = upper_add(
        upper_mul(
            magnitude(directed),
            upper_mul(rotated.error, magnitude_along),
        ),
        upper_add(
            upper_mul(magnitude(normal[face]), face_error),
            upper_mul(magnitude(normal[tangent]), translation_error),
        ),
    );
    (gap.finite() && error.is_finite()).then_some((gap, error))
}

// A nominated local tangent range only proposes a partition. Exclude
// a slab only if an original world coordinate proves its complete distance
// from the full stationary sphere, including the selected clearance.
#[allow(clippy::too_many_arguments)]
fn cull_ball_tangent_slabs(
    bx: Frame,
    ball: Frame,
    half: rp::Vector,
    axis: usize,
    radius: f32,
    clearance: f32,
    context: Context<'_>,
    slab: Option<CapsuleSlab>,
    work: &mut Work,
    radial: impl Fn(f32, bool) -> bool,
) -> Result<Float, TrajectoryError> {
    work.charge(2048)?;
    let (box_motion, ball_motion) = if context.sa.as_cuboid().is_some() {
        (context.a, context.b)
    } else {
        (context.b, context.a)
    };
    let target = if slab.is_some() {
        rp::Pose::from_translation(rp::Vector::from_array(
            ball.translation
                .map(|v| ((f64::from(v.lo) + f64::from(v.hi)) * 0.5) as f32),
        ))
    } else {
        ball_motion.pose(context.start)
    };
    let center = box_motion.pose(context.start).inv_mul(&target).translation[axis];
    let width = 2. * (radius + clearance);
    let limit = half[axis];
    if !center.is_finite() || !width.is_finite() || width <= 0. {
        return Ok(Float::span(-limit, limit));
    }
    let sphere: [Float; 3] = std::array::from_fn(|i| {
        let world = world_radius_range(ball.translation[i], radius);
        let local = target_value(ball, slab, i, Float::span(-radius, radius)).actual;
        Float::span(world.lo.min(local.lo), world.hi.max(local.hi))
    });
    let margin = Bound::exact(f64::from(clearance));
    let separated = |lo, hi| {
        let slab = bx.point_range(std::array::from_fn(|i| {
            if i == axis {
                Float::span(lo, hi)
            } else {
                Float::span(-half[i], half[i])
            }
        }));
        if slab.iter().chain(&sphere).any(|range| !range.finite()) {
            return false;
        }
        slab.into_iter().zip(sphere).any(|(l, r)| {
            let left = Bound::exact(f64::from(l.lo)).sub(Bound::exact(f64::from(r.hi)));
            let right = Bound::exact(f64::from(r.lo)).sub(Bound::exact(f64::from(l.hi)));
            left.sub(margin).lo > 0. || right.sub(margin).lo > 0.
        })
    };
    let mut near = Float::span(-limit, limit);
    let lo = (center - width).clamp(-limit, limit);
    let hi = (center + width).clamp(-limit, limit);
    if lo > -limit && separated(-limit, lo) {
        near.lo = lo;
    }
    if hi < limit && separated(hi, limit) {
        near.hi = hi;
    }
    let mut narrow_width = (radius + clearance) * 0.25;
    for _ in 0..4 {
        work.charge(128)?;
        let lo = (center - narrow_width).clamp(near.lo, near.hi);
        let hi = (center + narrow_width).clamp(near.lo, near.hi);
        let mut changed = false;
        if lo > near.lo && radial(lo, true) {
            near.lo = lo;
            changed = true;
        }
        if hi < near.hi && radial(hi, false) {
            near.hi = hi;
            changed = true;
        }
        if !changed {
            break;
        }
        narrow_width *= 0.25;
    }
    Ok(near)
}

// Sterbenz: subtracting two represented floats of the same sign whose
// magnitudes stay within a factor of two incurs no additional F32 error.
fn face_difference(a: Value, b: Value) -> Value {
    let a_mag = |x: Float| f64::from(x.lo.abs().max(x.hi.abs()));
    let min = |x: Float| f64::from(x.lo.abs().min(x.hi.abs()));
    let same_sign =
        (a.actual.lo > 0. && b.actual.lo > 0.) || (a.actual.hi < 0. && b.actual.hi < 0.);
    if same_sign && a_mag(a.actual) <= 2. * min(b.actual) && a_mag(b.actual) <= 2. * min(a.actual) {
        Value {
            actual: a.actual.sub(b.actual),
            ideal: a.ideal.sub(b.ideal),
            error: upper_add(a.error, b.error),
        }
    } else {
        a.sub(b)
    }
}

// If the entire input and translated result stay on one represented F32
// grid, round the translation on that grid. Both tie directions are kept.
fn rounded_translation_band(base: Float, offset: Float, after: Float) -> Option<Bound> {
    let binade = base.lo.to_bits() >> 23;
    let exponent = (binade & 255) as i32;
    if !(1..255).contains(&exponent)
        || [base.hi, after.lo, after.hi]
            .into_iter()
            .any(|v| v.to_bits() >> 23 != binade)
    {
        return None;
    }
    let origin = 2_f64.powi(exponent - 127);
    let (low, high) = if base.lo.is_sign_negative() {
        (-2. * origin, -origin)
    } else {
        (origin, 2. * origin)
    };
    let exact = Value::input(base).ideal.add(Value::input(offset).ideal);
    if exact.lo < low || exact.hi > high {
        return None;
    }
    let quantum = 2_f64.powi(exponent - 150);
    let lo = (f64::from(offset.lo) / quantum - 0.5).next_down().ceil() * quantum;
    let hi = (f64::from(offset.hi) / quantum + 0.5).next_up().floor() * quantum;
    (lo.is_finite() && hi.is_finite() && lo <= hi).then_some(Bound { lo, hi })
}

/// The exact-real action of the same COM quaternion on both local offsets
/// contributes only along the chosen face. Keep the two original F32 offset
/// transforms and additions as separate error bounds.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory::rounded::output) fn offset_separated(
    motion: ShapeMotion,
    cuboid: &rp::Cuboid,
    target: ShapeMotion,
    ball: &rp::Ball,
    direction: rp::Vector,
    context: Context<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(512)?;
    if !direction.is_finite()
        || !cuboid.half_extents.is_finite()
        || cuboid.half_extents.min_element() < 0.
        || !ball.radius.is_finite()
        || ball.radius < 0.
    {
        return Ok(false);
    }
    let Some(com) = frames(motion.curve, context.start, context.end, work)? else {
        return Ok(false);
    };
    let ball_frame = Frame::exact(target.pose(context.start));
    if ball_frame.rotation.exact != Some(rp::Rotation::IDENTITY) {
        return Ok(false);
    }
    let ball_hull = transform(ball_frame, [Value::local(0., ball.radius); 3]);
    if ball_hull.iter().any(|value| !value.finite()) {
        return Ok(false);
    }
    let mut direction_axis = 0;
    let mut sign = 0_f32;
    let first_box = motion.pose(context.start);
    for i in 0..3 {
        let mut unit = rp::Vector::ZERO;
        unit[i] = 1.;
        let dot = (first_box.rotation * unit).dot(direction);
        if dot.abs() > sign.abs() {
            direction_axis = i;
            sign = dot;
        }
    }
    if !sign.is_finite() || sign == 0. {
        return Ok(false);
    }
    let sign = sign.signum();
    let mut axis = rp::Vector::ZERO;
    axis[direction_axis] = sign;
    for &frame in &com.values[..com.len] {
        work.charge(2048)?;
        let rotation = Frame {
            translation: [Float::ZERO; 3],
            ..frame
        };
        let ideal = IdealTransform::new(rotation);
        let normal = ideal.point(axis);
        let norm = ideal
            .q
            .into_iter()
            .fold(Bound::exact(0.), |sum, q| sum.add(q.mul(q)));
        if norm.lo <= 0. || !norm.finite() {
            return Ok(false);
        }
        let mut actual = frame.translation;
        let mut errors = [0.; 3];
        for offset in [-motion.local_center, motion.local_pose.translation] {
            let values = transform(
                Frame {
                    translation: actual,
                    ..rotation
                },
                offset.to_array().map(|v| Value::input(Float::exact(v))),
            );
            if values.iter().any(|value| !value.finite()) {
                return Ok(false);
            }
            for (i, v) in values.into_iter().enumerate() {
                actual[i] = v.actual;
                errors[i] = upper_add(errors[i], v.error);
            }
        }
        let box_hull = transform(
            Frame {
                translation: actual,
                ..rotation
            },
            cuboid
                .half_extents
                .to_array()
                .map(|h| Value::input(Float::span(-h, h))),
        );
        if box_hull.iter().any(|value| !value.finite()) {
            return Ok(false);
        }
        let margin = Bound::exact(f64::from(ball.radius))
            .add(Bound::exact(f64::from(context.clearance)))
            .mul(norm);
        let offset = Bound::exact(f64::from(motion.local_pose.translation[direction_axis]))
            .sub(Bound::exact(f64::from(motion.local_center[direction_axis])))
            .mul(Bound::exact(f64::from(sign)));
        let face = norm
            .mul(norm)
            .mul(Bound::exact(f64::from(cuboid.half_extents[direction_axis])).add(offset));
        let mut gap = Bound::exact(0.);
        let mut error = 0.;
        for i in 0..3 {
            let delta = Value::input(ball_frame.translation[i])
                .ideal
                .sub(Value::input(frame.translation[i]).ideal);
            gap = gap.add(delta.mul(normal[i]));
            error = upper_add(
                error,
                upper_mul(
                    magnitude(normal[i]),
                    upper_add(errors[i], upper_add(box_hull[i].error, ball_hull[i].error)),
                ),
            );
        }
        if !gap.finite()
            || !error.is_finite()
            || !face.finite()
            || !margin.finite()
            || gap.sub(face).sub(margin).sub(Bound::exact(error)).lo <= 0.
        {
            return Ok(false);
        }
    }
    Ok(com.len > 0)
}

// For a fixed identity capsule, a core-coordinate interval plus the original
// sphere covers every leaf point. Enlarge the center interval for the local
// p+u rounding and for the alternate rounded world-core path.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory::rounded::output) fn rotating_box_capsule_face(
    frames: &Frames,
    cube: &rp::Cuboid,
    other: &Frames,
    capsule: &rp::Capsule,
    normal: rp::Vector,
    context: Context<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if frames.len == 0 {
        return Ok(false);
    }
    if translating_capsule::separated(context, frames, cube, capsule, work)? {
        return Ok(true);
    }
    let a = capsule.segment.a;
    let b = capsule.segment.b;
    let r = capsule.radius;
    if frames.len == 0
        || other.len != 1
        || !r.is_finite()
        || r <= 0.
        || !a.is_finite()
        || !b.is_finite()
    {
        return Ok(false);
    }
    let mut varying = (0..3).filter(|&i| a[i] != b[i]);
    let Some(axis) = varying.next() else {
        return Ok(false);
    };
    if varying.next().is_some() || (0..3).any(|i| i != axis && a[i] != 0.) {
        return Ok(false);
    }
    let frame = other.values[0];
    if frame.rotation.exact != Some(rp::Rotation::IDENTITY) || normal[axis] == 0. {
        return Ok(false);
    }
    work.charge(1024)?;
    let lo = a[axis].min(b[axis]);
    let hi = a[axis].max(b[axis]);
    let cut = if normal[axis] > 0. {
        lo + r / 32.
    } else {
        hi - r / 32.
    }
    .clamp(lo, hi);
    let sphere = rp::Ball::new(r);
    for (first, last) in [(lo, cut), (cut, hi)] {
        let mut centers = frame;
        let base = frame.translation[axis];
        let core = Float::span(first, last);
        centers.translation[axis] = base.add(core);
        let slab = CapsuleSlab {
            axis,
            translation: base,
            core,
        };
        if !rotating_round_face(
            frames,
            cube,
            centers,
            &sphere,
            normal,
            context.clearance,
            context,
            Some(slab),
            work,
        )? {
            return Ok(false);
        }
    }
    Ok(true)
}
