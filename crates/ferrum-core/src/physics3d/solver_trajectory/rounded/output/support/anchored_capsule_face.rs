//! A stationary carrier leaves an affine capsule translation in observer time.
//! Compare it to a rotating box's actual face while both bodies advance.
use super::*;
mod fixed_plane;

fn exact(x: f32) -> Bound {
    Bound::exact(f64::from(x))
}

pub(in crate::physics3d::solver_trajectory) fn separated(
    cache: &AxisCache<'_>,
    direction: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let context = cache.context;
    let (box_motion, cube, actor, cap, direction) =
        if let (Some(cube), Some(cap)) = (context.sa.as_cuboid(), context.sb.as_capsule()) {
            (context.a, cube, context.b, cap, direction)
        } else if let (Some(cap), Some(cube)) = (context.sa.as_capsule(), context.sb.as_cuboid()) {
            (context.b, cube, context.a, cap, -direction)
        } else {
            return Ok(false);
        };
    let (
        Curve::Integrated(k),
        Curve::Anchored {
            carrier,
            linear_velocity,
            rotation,
            anchor,
            offset,
        },
    ) = (box_motion.curve, actor.curve)
    else {
        return Ok(false);
    };
    if rotation != rp::Rotation::IDENTITY
        || k.native.angular_velocity == rp::Vector::ZERO
        || [actor, box_motion]
            .into_iter()
            .any(|m| m.local_pose != rp::Pose::IDENTITY || m.local_center != rp::Vector::ZERO)
        || context.clearance <= 0.
        || context.start < carrier.domain.start
        || context.end > carrier.domain.end
        || cap.radius <= 0.
        || !direction.is_finite()
        || !cap.radius.is_finite()
        || !cube.half_extents.is_finite()
        || cube.half_extents.min_element() < 0.
    {
        return Ok(false);
    }
    work.charge(256)?;
    let Some(fixed) =
        crate::physics3d::solver_trajectory::constant_pose(Curve::Integrated(carrier))
    else {
        return Ok(false);
    };
    let source = fixed.translation + fixed.rotation * anchor + offset;
    let origin = k.native.motion.start.translation;
    let rate = k.native.linear_velocity;
    let h = k.native.integration_seconds;
    if !source.is_finite()
        || !linear_velocity.is_finite()
        || origin + rate * h != k.native.motion.end.translation
    {
        return Ok(false);
    }
    if context.start < context.end {
        work.charge(96)?;
        let deltas = [context.start, context.end].map(|time| k.local_delta(time));
        let centers = [context.start, context.end].map(|time| {
            let dt = (time - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
            (source + linear_velocity * dt).to_array().map(f32::to_bits)
        });
        // The stationary carrier's relative displacement is componentwise
        // monotone. For a singleton capsule center and at most two adjacent
        // Native dt inputs, the endpoint poses cover the entire pair image.
        if centers[0] == centers[1]
            && deltas[0].is_finite()
            && deltas[0] >= 0.
            && deltas[1].is_finite()
            && deltas[1] >= deltas[0]
            && deltas[1].to_bits() - deltas[0].to_bits() <= 1
        {
            for time in [context.start, context.end] {
                let cache = AxisCache::new(
                    context.a,
                    context.sa,
                    context.b,
                    context.sb,
                    time,
                    time,
                    context.clearance,
                );
                let axis = if context.sa.as_cuboid().is_some() {
                    direction
                } else {
                    -direction
                };
                if !separated(&cache, axis, work)? {
                    return Ok(false);
                }
                if deltas[0] == deltas[1] {
                    break;
                }
            }
            return Ok(true);
        }
    }
    let Some(box_frames) = frames(box_motion.curve, context.start, context.end, work)? else {
        return Ok(false);
    };
    let mut frame = union(&box_frames);
    frame = frame.shape(box_motion);
    work.charge(4096)?;
    let axis = box_motion.pose(context.start).rotation.inverse() * direction;
    let index = axis.abs().max_position();
    let mut unit = rp::Vector::ZERO;
    unit[index] = axis[index].signum();
    let local = Frame {
        translation: [Float::ZERO; 3],
        ..frame
    };
    let ideal = IdealTransform::new(local);
    let n = ideal.point(unit);
    let scale = ideal
        .q
        .into_iter()
        .fold(Bound::exact(0.), |s, q| s.add(q.mul(q)));
    if !scale.finite() || scale.lo <= 0. || n.iter().any(|v| !v.finite()) {
        return Ok(false);
    }
    let box_hull = transform(
        frame,
        cube.half_extents
            .to_array()
            .map(|h| Value::input(Float::span(-h, h))),
    );
    let physical = Float::span(k.local_delta(context.start), k.local_delta(context.end));
    let relative =
        |at: Time| (at - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
    let logical = Float::span(relative(context.start), relative(context.end));
    let v = |x| Value::input(Float::exact(x));
    let pos = |p: f32, u: f32, dt: Float| v(p).add(v(u).mul(Value::input(dt)));
    let cap_position: [Value; 3] =
        std::array::from_fn(|i| pos(source[i], linear_velocity[i], logical));
    let points = [cap.segment.a, cap.segment.b];
    let core = local_hull(&points, 0.);
    let full = local_hull(&points, cap.radius);
    let span = Bound::exact(context.end).sub(Bound::exact(context.start));
    let time = Bound {
        lo: 0.,
        hi: span.hi,
    };
    let duration = k.domain.duration();
    let ratio = f64::from(h) / duration;
    let ratio = Bound {
        lo: ratio.next_down(),
        hi: ratio.next_up(),
    };
    let clock = Bound::exact(context.start)
        .sub(Bound::exact(k.domain.start))
        .mul(ratio);
    let drift = Bound::exact(context.start).sub(Bound::exact(carrier.domain.start));
    // Delta subtraction, scaled native division/product and conversion to F32.
    // The error also encloses clamping to the rounded complete domain duration.
    let native_error = upper_add(8. * f64::EPSILON * f64::from(h), half_ulp(physical));
    let drift_error = upper_add(
        4. * f64::EPSILON * carrier.domain.duration(),
        half_ulp(logical),
    );
    let mut delta = [Bound::exact(0.); 3];
    let mut errors = [0.; 3];
    for i in 0..3 {
        let cap_translation = cap_position[i];
        let cap_core = core[i].add(Value::input(cap_translation.actual));
        let cap_local = full[i].add(Value::input(cap_translation.actual));
        let cap_world = cap_core.add(Value::local(0., cap.radius));
        let body = pos(origin[i], rate[i], physical);
        if [cap_local, cap_world, body, box_hull[i], cap_translation]
            .into_iter()
            .any(|x| !x.finite())
        {
            return Ok(false);
        }
        let base = exact(source[i])
            .sub(exact(origin[i]))
            .add(exact(linear_velocity[i]).mul(drift))
            .sub(exact(rate[i]).mul(clock));
        let slope = exact(linear_velocity[i]).sub(exact(rate[i]).mul(ratio));
        let affine = base.add(slope.mul(time));
        let clock_loss = upper_add(
            upper_mul(f64::from(linear_velocity[i]).abs(), drift_error),
            upper_mul(f64::from(rate[i]).abs(), native_error),
        );
        let loss = upper_add(clock_loss, upper_add(body.error, cap_translation.error));
        let affine = affine.add(Bound {
            lo: -loss,
            hi: loss,
        });
        let observed = Value::input(cap_translation.actual)
            .ideal
            .sub(Value::input(body.actual).ideal);
        delta[i] = Bound {
            lo: affine.lo.max(observed.lo),
            hi: affine.hi.min(observed.hi),
        };
        if !delta[i].finite() || delta[i].lo > delta[i].hi {
            return Ok(false);
        }
        errors[i] = upper_add(box_hull[i].error, cap_local.error.max(cap_world.error));
    }
    // For the unnormalized quaternion map R and local axis e,
    // dot(R e, R p) = |q|^4 dot(e, p). Its full cuboid support along
    // this moving normal therefore needs only the corresponding extent.
    let face = scale.mul(scale).mul(exact(cube.half_extents[index]));
    let margin = scale.mul(exact(cap.radius).add(exact(context.clearance)));
    let projected = |errors: [f64; 3]| {
        (0..3).fold(0., |s, i| {
            upper_add(s, upper_mul(errors[i], magnitude(n[i])))
        })
    };
    let nominal = points
        .into_iter()
        .map(|p| {
            (0..3)
                .fold(Bound::exact(0.), |s, i| {
                    s.add(delta[i].add(exact(p[i])).mul(n[i]))
                })
                .sub(face)
                .sub(margin)
                .lo
        })
        .fold(f64::INFINITY, f64::min);
    if nominal.is_finite() && nominal > projected(errors) {
        return Ok(true);
    }
    fixed_plane::separated(
        &ideal,
        direction,
        delta,
        cube.half_extents,
        points,
        cap.radius,
        context.clearance,
        errors,
        work,
    )
}
