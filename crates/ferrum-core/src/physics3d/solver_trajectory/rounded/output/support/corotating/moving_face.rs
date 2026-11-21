//! Separation along the moving negative X face of an integrated cuboid.
//! The bound covers the original normalized rotation and both capsule
//! radius graphs. An inconclusive bound falls back to the ordinary cast.
use super::*;
use rapier3d::parry::shape::{Capsule, Cuboid};
mod box_round;

struct MovingPair {
    cuboid: Kernel,
    capsule: Kernel,
    shared_x: Option<SharedTranslation>,
}

struct SharedTranslation {
    anchor: f32,
    offset: f32,
    velocity: f32,
}

fn q_identity(q: rp::Rotation) -> bool {
    q.to_array().map(f32::to_bits) == rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
}

fn stored_translation(k: Kernel) -> bool {
    let native = k.native;
    let end = native.motion.start.translation + native.linear_velocity * native.integration_seconds;
    end.is_finite()
        && end.to_array().map(f32::to_bits)
            == native.motion.end.translation.to_array().map(f32::to_bits)
}

fn operands(context: Context<'_>) -> Option<(MovingPair, &Cuboid, &Capsule)> {
    let (cuboid, box_shape, capsule, cap_shape) = if let (Some(cuboid), Some(capsule)) =
        (context.sa.as_cuboid(), context.sb.as_capsule())
    {
        (context.a, cuboid, context.b, capsule)
    } else if let (Some(capsule), Some(cuboid)) = (context.sa.as_capsule(), context.sb.as_cuboid())
    {
        (context.b, cuboid, context.a, capsule)
    } else {
        return None;
    };
    let Curve::Integrated(b) = cuboid.curve else {
        return None;
    };
    let (a, shared_x) = match capsule.curve {
        Curve::Integrated(a)
            if a.native.linear_velocity.x < 0.
                && a.native.linear_velocity.x > b.native.linear_velocity.x =>
        {
            (a, None)
        }
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        } if q_identity(rotation)
            && shares_x_translation(carrier, b, anchor, offset, linear_velocity) =>
        {
            (
                carrier,
                Some(SharedTranslation {
                    anchor: anchor.x,
                    offset: offset.x,
                    velocity: linear_velocity.x,
                }),
            )
        }
        _ => return None,
    };
    let r = cap_shape.radius;
    if !identity(cuboid)
        || !identity(capsule)
        || !q_identity(a.native.motion.start.rotation)
        || !q_identity(a.native.motion.end.rotation)
        || a.native.angular_velocity.to_array().map(f32::to_bits) != [0; 3]
        || b.native.angular_velocity == rp::Vector::ZERO
        || b.native.linear_velocity.x >= 0.
        || a.domain.start.to_bits() != b.domain.start.to_bits()
        || a.domain.end.to_bits() != b.domain.end.to_bits()
        || a.native.integration_seconds.to_bits() != b.native.integration_seconds.to_bits()
        || !r.is_normal()
        || r <= 0.
        || r.to_bits() & 0x7f_ffff != 0
        || !box_shape.half_extents.is_finite()
        || box_shape.half_extents.min_element() <= 0.
        || box_shape.half_extents.x.to_bits() != r.to_bits()
        || ![cap_shape.segment.a, cap_shape.segment.b]
            .into_iter()
            .all(|p| p.is_finite() && p.x == 0. && p.z == 0.)
        // Exact F64 subtraction within the original logical clock.
        || b.domain.start <= 0.
        || b.domain.end > b.domain.start * 2.
        || context.start < b.domain.start
        || context.end > b.domain.end
    {
        return None;
    }
    Some((
        MovingPair {
            cuboid: b,
            capsule: a,
            shared_x,
        },
        box_shape,
        cap_shape,
    ))
}

fn shares_x_translation(
    capsule: Kernel,
    cuboid: Kernel,
    anchor: rp::Vector,
    offset: rp::Vector,
    relative: rp::Vector,
) -> bool {
    let a = capsule.native;
    let b = cuboid.native;
    let origin = b.motion.start.translation.x;
    a.motion.start.translation.x.to_bits() == origin.to_bits()
        && a.linear_velocity.x.to_bits() == b.linear_velocity.x.to_bits()
        && a.motion.end.translation.x.to_bits() == b.motion.end.translation.x.to_bits()
        && anchor.x.to_bits() == (-origin).to_bits()
        && anchor.y == 0.
        && anchor.z == 0.
        && offset.y == 0.
        && offset.z == 0.
        && relative.y == 0.
        && relative.z == 0.
        && offset.x.is_finite()
        && relative.x.is_finite()
}

fn polynomial_rotation(q: [f32; 4], omega: rp::Vector, rate: Bound) -> [Polynomial; 4] {
    let [x, y, z, w] = q.map(|v| Bound::exact(f64::from(v)));
    let [a, b, c] = omega
        .to_array()
        .map(|v| rate.mul(Bound::exact(f64::from(v) * 0.5)));
    [
        Polynomial::affine(q[0], a.mul(w).add(b.mul(z)).sub(c.mul(y))),
        Polynomial::affine(q[1], b.mul(w).add(c.mul(x)).sub(a.mul(z))),
        Polynomial::affine(q[2], c.mul(w).add(a.mul(y)).sub(b.mul(x))),
        Polynomial::affine(
            q[3],
            Bound::exact(0.).sub(a.mul(x)).sub(b.mul(y)).sub(c.mul(z)),
        ),
    ]
}

fn moving_negative_x(q: [Polynomial; 4]) -> Option<([Polynomial; 3], Polynomial)> {
    let [x, y, z, w] = q;
    let xx = x.mul(x)?;
    let yy = y.mul(y)?;
    let zz = z.mul(z)?;
    let ww = w.mul(w)?;
    let norm = xx.add(yy).add(zz).add(ww);
    let negative_twice = Bound::exact(-2.);
    Some((
        [
            yy.add(zz).sub(xx).sub(ww),
            x.mul(y)?.add(z.mul(w)?).scale(negative_twice),
            x.mul(z)?.sub(y.mul(w)?).scale(negative_twice),
        ],
        norm,
    ))
}

fn finite_support(error: f64, distance: Bound) -> bool {
    error.is_finite() && distance.finite() && distance.sub(Bound::exact(error)).lo > 0.
}

fn box_slab(half: rp::Vector, bounds: (f32, f32)) -> [Value; 3] {
    [
        Value::input(Float::span(bounds.0, bounds.1)),
        Value::input(Float::span(-half.y, half.y)),
        Value::input(Float::span(-half.z, half.z)),
    ]
}

fn integrated_translation(start: rp::Vector, velocity: rp::Vector, dt: Value) -> [Value; 3] {
    std::array::from_fn(|i| {
        Value::input(Float::exact(start[i])).add(Value::input(Float::exact(velocity[i])).mul(dt))
    })
}

#[allow(clippy::too_many_arguments)]
fn phase_clear(
    pair: &MovingPair,
    x: Bound,
    physical: Value,
    rate: Bound,
    rotation: RotationProof,
    box_shape: &Cuboid,
    cap_shape: &Capsule,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(4096)?;
    let Some((normal, norm)) = moving_negative_x(rotation.q) else {
        return Ok(false);
    };
    let s = norm.range(x);
    let n = normal.map(|p| p.range(x));
    if !s.finite() || s.lo <= 0. || n.iter().any(|v| !v.finite()) || n[0].hi >= 0. {
        return Ok(false);
    }

    let start_a = pair.capsule.native.motion.start.translation;
    let start_b = pair.cuboid.native.motion.start.translation;
    let va = pair.capsule.native.linear_velocity;
    let vb = pair.cuboid.native.linear_velocity;
    let t = integrated_translation(start_b, vb, physical);
    let mut c = integrated_translation(start_a, va, physical);
    let mut center: [Polynomial; 3] = std::array::from_fn(|i| {
        Polynomial::affine(
            start_a[i],
            Bound::exact(f64::from(va[i]))
                .sub(Bound::exact(f64::from(vb[i])))
                .mul(rate),
        )
        .sub(Polynomial::constant(start_b[i]))
    });
    let mut box_com_errors = t.map(|v| v.error);
    if let Some(shared) = &pair.shared_x {
        let logical = Float::span(x.lo as f32, x.hi as f32);
        let relative_term = Value::input(Float::exact(shared.velocity)).mul(Value {
            actual: logical,
            ideal: x,
            error: half_ulp(logical),
        });
        // Cancel the identical represented product/add for X only.
        // The capsule's subsequent additions still have rounding errors.
        c[0] = sum(
            Value::input(t[0].actual),
            Value::input(Float::exact(shared.anchor)),
        )
        .add(Value::input(Float::exact(shared.offset)))
        .add(relative_term);
        center[0] = Polynomial::affine(shared.offset, Bound::exact(f64::from(shared.velocity)))
            .add(Polynomial::constant(shared.anchor));
        box_com_errors[0] = 0.;
    }
    if c.iter().chain(&t).any(|v| !v.finite()) {
        return Ok(false);
    }
    let box_com_error = projected_error(n, box_com_errors);
    let box_world = t.map(|v| Value::input(v.actual));
    let scale_error = rotation
        .factor
        .mul(rotation.factor)
        .mul(s)
        .sub(Bound::exact(1.))
        .hi
        .max(0.);

    let r = f64::from(cap_shape.radius);
    let requested = Bound::exact(f64::from(clearance));
    let half = box_shape.half_extents;
    let split = -0.5 * half.x;
    let anchored_slabs = [(-half.x, split), (split, half.x)];
    let integrated_slabs = [(-half.x, half.x)];
    let slabs: &[_] = if pair.shared_x.is_some() {
        &anchored_slabs
    } else {
        &integrated_slabs
    };
    for &slab in slabs {
        work.charge(4096)?;
        let extent = f64::from(-slab.0);
        let box_points = box_round::transformed_box(
            rotation.actual_q,
            box_world,
            box_slab(half, slab),
            0,
            cap_shape.radius,
        );
        if box_points.iter().any(|v| !v.finite()) {
            return Ok(false);
        }
        let full_box_error = upper_add(
            box_com_error,
            upper_add(
                projected_error(n, box_points.map(|v| v.error)),
                upper_mul(upper_mul(extent, s.hi), scale_error),
            ),
        );
        let margin = Bound::exact(extent).add(requested);
        for point in [cap_shape.segment.a, cap_shape.segment.b] {
            work.charge(2048)?;
            let mut distance = Polynomial::zero();
            for i in 0..3 {
                let Some(projected) = normal[i].mul(center[i].add(Polynomial::constant(point[i])))
                else {
                    return Ok(false);
                };
                distance = distance.add(projected);
            }
            let core =
                std::array::from_fn::<_, 3, _>(|i| sum(c[i], Value::input(Float::exact(point[i]))));
            let local = std::array::from_fn::<_, 3, _>(|i| {
                sum(c[i], Value::local(point[i], cap_shape.radius))
            });
            let pole = sum(c[0], Value::input(Float::exact(cap_shape.radius)));
            if !pole.finite() || core.iter().chain(&local).any(|v| !v.finite()) {
                return Ok(false);
            }

            let world = distance
                .sub(norm.scale(margin.add(Bound::exact(r))))
                .range(x);
            if !finite_support(
                upper_add(full_box_error, projected_error(n, core.map(|v| v.error))),
                world,
            ) {
                return Ok(false);
            }

            let mut local_clear = false;
            // The segment varies in Y. The sphere's extremal pole toward
            // the Box is independently at +X. Convex weights combine two
            // complete lower bounds; no samples stand in for a sphere.
            for weight in [0.875, 0.9375, 0.96875, 0.984375, 255. / 256., 0.] {
                work.charge(768)?;
                let mut residual = n;
                residual[0] = residual[0].mul(Bound::exact(1. - weight));
                let norm2 = residual.into_iter().fold(0., |sum, v| {
                    upper_add(sum, upper_mul(magnitude(v), magnitude(v)))
                });
                let residual_radius = upper_mul(r, norm2.sqrt().next_up());
                let pole_error = upper_mul(upper_mul(magnitude(n[0]), weight), pole.error);
                let added = upper_add(
                    residual_radius,
                    upper_add(
                        pole_error,
                        projected_error(residual, local.map(|v| v.error)),
                    ),
                );
                let bound = distance
                    .sub(norm.scale(margin))
                    .add(normal[0].scale(Bound::exact(r).mul(Bound::exact(weight))))
                    .range(x);
                if finite_support(upper_add(full_box_error, added), bound) {
                    local_clear = true;
                    break;
                }
            }
            if !local_clear {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

pub(super) fn separated(context: Context<'_>, work: &mut Work) -> Result<bool, TrajectoryError> {
    let Some((pair, box_shape, cap_shape)) = operands(context) else {
        return Ok(false);
    };
    work.charge(1024)?;
    if !context.clearance.is_finite() || context.clearance < 0. || context.end < context.start {
        return Ok(false);
    }
    let b = pair.cuboid;
    Kernel::from_native(b.native, b.domain)?;
    Kernel::from_native(pair.capsule.native, pair.capsule.domain)?;
    if !stored_translation(b) || !stored_translation(pair.capsule) {
        return Ok(false);
    }
    let h = f64::from(b.native.integration_seconds);
    let reciprocal = b.domain.duration().recip();
    let rate = Bound {
        lo: reciprocal.next_down(),
        hi: reciprocal.next_up(),
    }
    .mul(Bound::exact(h));
    let x = Bound {
        lo: context.start - b.domain.start,
        hi: context.end - b.domain.start,
    };
    let dt = Float::span(b.local_delta(context.start), b.local_delta(context.end));
    if !rate.finite() || rate.lo <= 0. || !x.finite() || !dt.finite() {
        return Ok(false);
    }
    let map_error = upper_mul(h, 2_f64.powi(-51));
    let evaluate =
        |range: Bound, dt: Float, endpoint, work: &mut Work| -> Result<bool, TrajectoryError> {
            if range.lo > range.hi {
                return Ok(true);
            }
            work.charge(4096)?;
            let value = Value {
                actual: dt,
                ideal: range.mul(rate),
                error: upper_add(map_error, half_ulp(dt)),
            };
            let rotation = if let Some(q) = endpoint {
                constant_rotation(q)
            } else {
                let q0 = b.native.motion.start.rotation.to_array();
                let omega = b.native.angular_velocity;
                let half = value.mul(Value::input(Float::exact(0.5)));
                let axis = omega
                    .to_array()
                    .map(|v| Value::input(Float::exact(v)).mul(half));
                rotation_proof(
                    quat_product(
                        [axis[0], axis[1], axis[2], Value::input(Float::exact(1.))],
                        q0.map(|v| Value::input(Float::exact(v))),
                    ),
                    polynomial_rotation(q0, omega, rate),
                )
            };
            let Some(rotation) = rotation else {
                return Ok(false);
            };
            phase_clear(
                &pair,
                range,
                value,
                rate,
                rotation,
                box_shape,
                cap_shape,
                context.clearance,
                work,
            )
        };

    if dt.lo <= 0. {
        let upper = (upper_add(map_error, half_ulp(Float::ZERO)) / rate.lo).next_up();
        if !evaluate(
            Bound {
                hi: x.hi.min(upper),
                ..x
            },
            Float::ZERO,
            Some(b.native.motion.start.rotation),
            work,
        )? {
            return Ok(false);
        }
    }
    let inside = Float {
        lo: dt.lo.max(f32::from_bits(1)),
        hi: dt.hi.min(b.native.integration_seconds.next_down()),
    };
    if inside.lo <= inside.hi && !evaluate(x, inside, None, work)? {
        return Ok(false);
    }
    if dt.hi >= b.native.integration_seconds {
        let last = Float::exact(b.native.integration_seconds);
        let lower = ((h - upper_add(map_error, half_ulp(last))).next_down() / rate.hi).next_down();
        if !evaluate(
            Bound {
                lo: x.lo.max(lower),
                ..x
            },
            last,
            Some(b.native.motion.end.rotation),
            work,
        )? {
            return Ok(false);
        }
    }
    Ok(true)
}
