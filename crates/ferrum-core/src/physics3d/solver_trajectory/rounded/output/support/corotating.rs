//! A moving box-face sufficient condition. The axis is a real algebraic
//! construction, not a sampled contact normal or a new Native trajectory.
//! Only a shared pure-axis clock is admitted; every other input falls through.
use super::*;
mod fixed_rider;
mod moving_face;
pub(super) use fixed_rider::center_lower_bound;

pub(in crate::physics3d::solver_trajectory::rounded) fn moving_face_separated(
    context: Context<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    moving_face::separated(context, work)
}

#[derive(Clone, Copy)]
struct Polynomial([Bound; 4]);
impl Polynomial {
    fn finite(self) -> bool {
        self.0.iter().all(|v| v.finite())
    }
    fn zero() -> Self {
        Self([Bound::exact(0.); 4])
    }
    fn constant(x: f32) -> Self {
        let mut p = Self::zero();
        p.0[0] = Bound::exact(f64::from(x));
        p
    }
    fn affine(value: f32, rate: Bound) -> Self {
        let mut p = Self::constant(value);
        p.0[1] = rate;
        p
    }
    fn add(self, b: Self) -> Self {
        if !self.finite() || !b.finite() {
            return Self::constant(f32::NAN);
        }
        Self(std::array::from_fn(|i| self.0[i].add(b.0[i])))
    }
    fn sub(self, b: Self) -> Self {
        if !self.finite() || !b.finite() {
            return Self::constant(f32::NAN);
        }
        Self(std::array::from_fn(|i| self.0[i].sub(b.0[i])))
    }
    fn scale(self, b: Bound) -> Self {
        if !self.finite() || !b.finite() {
            return Self::constant(f32::NAN);
        }
        Self(self.0.map(|a| a.mul(b)))
    }
    fn mul(self, b: Self) -> Option<Self> {
        if !self.finite() || !b.finite() {
            return None;
        }
        let mut out = Self::zero();
        for i in 0..4 {
            for j in 0..4 {
                let v = self.0[i].mul(b.0[j]);
                if !v.finite() {
                    return None;
                }
                if i + j < 4 {
                    out.0[i + j] = out.0[i + j].add(v);
                } else if !v.is_exact(0.) {
                    return None; // never truncate a higher degree
                }
            }
        }
        Some(out)
    }
    fn at(self, x: Bound) -> Bound {
        if !self.finite() || !x.finite() {
            return Bound::exact(f64::NAN);
        }
        let mut result = self.0[3];
        for i in [2, 1, 0] {
            let product = result.mul(x);
            if !product.finite() {
                return Bound::exact(f64::NAN);
            }
            result = product.add(self.0[i]);
            if !result.finite() {
                return Bound::exact(f64::NAN);
            }
        }
        result
    }
    fn range(self, x: Bound) -> Bound {
        if !self.finite() || !x.finite() {
            return Bound::exact(f64::NAN);
        }
        // The cubic's Bernstein hull over the entire interval. This keeps
        // common-time cancellation; endpoint evaluation alone is not a proof.
        let a = Bound::exact(x.lo);
        let width = Bound::exact(x.hi).sub(a);
        let a2 = a.mul(a);
        let d0 = self.at(a);
        let d1 = self.0[1]
            .add(self.0[2].mul(a).mul(Bound::exact(2.)))
            .add(self.0[3].mul(a2).mul(Bound::exact(3.)))
            .mul(width);
        let d2 = self.0[2]
            .add(self.0[3].mul(a).mul(Bound::exact(3.)))
            .mul(width.mul(width));
        let d3 = self.0[3].mul(width.mul(width).mul(width));
        let third = Bound {
            lo: (1_f64 / 3.).next_down(),
            hi: (1_f64 / 3.).next_up(),
        };
        let values = [
            d0,
            d0.add(d1.mul(third)),
            d0.add(d1.mul(third).mul(Bound::exact(2.)))
                .add(d2.mul(third)),
            d0.add(d1).add(d2).add(d3),
        ];
        if values.iter().any(|v| !v.finite()) {
            return Bound::exact(f64::NAN);
        }
        Bound {
            lo: values
                .into_iter()
                .map(|v| v.lo)
                .fold(f64::INFINITY, f64::min),
            hi: values
                .into_iter()
                .map(|v| v.hi)
                .fold(f64::NEG_INFINITY, f64::max),
        }
    }
}

fn same_kernel(a: Kernel, b: Kernel) -> bool {
    a.domain.start.to_bits() == b.domain.start.to_bits()
        && a.domain.end.to_bits() == b.domain.end.to_bits()
        && a.native.motion.body == b.native.motion.body
        && a.native.motion.start_time.to_bits() == b.native.motion.start_time.to_bits()
        && a.native.motion.end_time.to_bits() == b.native.motion.end_time.to_bits()
        && a.native.integration_seconds.to_bits() == b.native.integration_seconds.to_bits()
        && a.native
            .motion
            .start
            .translation
            .to_array()
            .map(f32::to_bits)
            == b.native
                .motion
                .start
                .translation
                .to_array()
                .map(f32::to_bits)
        && a.native.motion.end.translation.to_array().map(f32::to_bits)
            == b.native.motion.end.translation.to_array().map(f32::to_bits)
        && a.native.motion.start.rotation.to_array().map(f32::to_bits)
            == b.native.motion.start.rotation.to_array().map(f32::to_bits)
        && a.native.motion.end.rotation.to_array().map(f32::to_bits)
            == b.native.motion.end.rotation.to_array().map(f32::to_bits)
        && a.native.linear_velocity.to_array().map(f32::to_bits)
            == b.native.linear_velocity.to_array().map(f32::to_bits)
        && a.native.angular_velocity.to_array().map(f32::to_bits)
            == b.native.angular_velocity.to_array().map(f32::to_bits)
}
fn identity(m: ShapeMotion) -> bool {
    m.local_center == rp::Vector::ZERO
        && m.local_pose.translation == rp::Vector::ZERO
        && m.local_pose.rotation.to_array().map(f32::to_bits)
            == rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
}
fn quat_product(a: [Value; 4], b: [Value; 4]) -> [Value; 4] {
    [
        a[3].mul(b[0])
            .add(a[0].mul(b[3]))
            .add(a[1].mul(b[2]))
            .sub(a[2].mul(b[1])),
        a[3].mul(b[1])
            .sub(a[0].mul(b[2]))
            .add(a[1].mul(b[3]))
            .add(a[2].mul(b[0])),
        a[3].mul(b[2])
            .add(a[0].mul(b[1]))
            .sub(a[1].mul(b[0]))
            .add(a[2].mul(b[3])),
        a[3].mul(b[3])
            .sub(a[0].mul(b[0]))
            .sub(a[1].mul(b[1]))
            .sub(a[2].mul(b[2])),
    ]
}
fn transformed(q: [Value; 4], t: [Value; 3], v: [Value; 3]) -> [Value; 3] {
    // Original scalar Quat::mul_vec3 graph; the q error here also encloses
    // raw integration and the original reciprocal normalization's RN shell.
    let two = Value::input(Float::exact(2.));
    let b2 = q[0].mul(q[0]).add(q[1].mul(q[1])).add(q[2].mul(q[2]));
    let scale = q[3].mul(q[3]).sub(b2);
    let dot = v[0].mul(q[0]).add(v[1].mul(q[1])).add(v[2].mul(q[2]));
    let cross = [
        q[1].mul(v[2]).sub(v[1].mul(q[2])),
        q[2].mul(v[0]).sub(v[2].mul(q[0])),
        q[0].mul(v[1]).sub(v[0].mul(q[1])),
    ];
    std::array::from_fn(|i| {
        v[i].mul(scale)
            .add(q[i].mul(dot.mul(two)))
            .add(cross[i].mul(q[3].mul(two)))
            .add(t[i])
    })
}
fn factor(raw: [Float; 4]) -> Option<Float> {
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
    if min.length_squared() <= 0. || !max.length_squared().is_finite() {
        return None;
    }
    // Exactly the two original native functions, not a replacement sqrt.
    let lo = max.length_recip();
    let hi = min.length_recip();
    (lo.is_finite() && hi.is_finite() && lo > 0. && lo <= hi).then_some(Float::span(lo, hi))
}

fn raw_rotation(
    input: Value,
    omega: rp::Vector,
    axis: usize,
    q0: [f32; 4],
) -> ([Value; 4], [Polynomial; 4]) {
    let half = input.mul(Value::input(Float::exact(0.5)));
    let hang = omega
        .to_array()
        .map(|v| Value::input(Float::exact(v)).mul(half));
    let raw = quat_product(
        [hang[0], hang[1], hang[2], Value::input(Float::exact(1.))],
        q0.map(|v| Value::input(Float::exact(v))),
    );
    let mut poly = [Polynomial::zero(); 4];
    let slope = Bound::exact(f64::from(omega[axis])).mul(Bound::exact(0.5));
    poly[axis] = Polynomial::affine(q0[axis], slope.mul(Bound::exact(f64::from(q0[3]))));
    poly[3] = Polynomial::affine(q0[3], slope.mul(Bound::exact(-f64::from(q0[axis]))));
    (raw, poly)
}

struct RotationProof {
    q: [Polynomial; 4],
    actual_q: [Value; 4],
    factor: Bound,
    normalized_scale: Option<Bound>,
}
fn singleton_quaternion(parts: [Float; 4]) -> Option<rp::Rotation> {
    parts
        .iter()
        .all(|v| v.finite() && singleton(*v))
        .then(|| rp::Rotation::from_array(parts.map(|v| v.lo)))
}
fn constant_rotation(q: rp::Rotation) -> Option<RotationProof> {
    if !q.is_finite() {
        return None;
    }
    let parts = q.to_array();
    Some(RotationProof {
        q: parts.map(Polynomial::constant),
        actual_q: parts.map(|v| Value::input(Float::exact(v))),
        factor: Bound::exact(1.),
        normalized_scale: None,
    })
}

fn normalized_scale(raw: [Value; 4], factor: Float) -> Option<Bound> {
    let [x, y, z, w] = raw.map(|v| v.mul(v));
    let norm = x.add(y).add(z).add(w);
    if !norm.finite() || norm.actual.lo <= 0. {
        return None;
    }
    let sqrt_f32 = Float::span(norm.actual.lo.sqrt(), norm.actual.hi.sqrt());
    let minimum = f64::from(norm.actual.lo).sqrt().next_down();
    let denominator = (minimum * f64::from(sqrt_f32.lo)).next_down();
    if denominator <= 0. || !sqrt_f32.finite() {
        return None;
    }
    let reciprocal_error = upper_add(
        (half_ulp(sqrt_f32) / denominator).next_up(),
        half_ulp(factor),
    );
    let ideal_inverse = (1. / minimum).next_up();
    // The original rounded squared norm times its real inverse squared is
    // one at every time. Propagate the sqrt/reciprocal and raw graph errors
    // before dropping their common time, to retain the same-scale cancellation.
    let factor_error = upper_mul(
        f64::from(norm.actual.hi),
        upper_mul(
            reciprocal_error,
            upper_add(2. * ideal_inverse, reciprocal_error),
        ),
    );
    let scale = f64::from(factor.hi);
    let error = upper_add(factor_error, upper_mul(norm.error, upper_mul(scale, scale)));
    error.is_finite().then_some(Bound {
        lo: (1. - error).next_down(),
        hi: (1. + error).next_up(),
    })
}

fn rotation_proof(raw: [Value; 4], polynomial: [Polynomial; 4]) -> Option<RotationProof> {
    // The caller has prepaid the old fixed 4096-unit interior setup. These
    // are complete Float images of every original scalar node, not endpoint
    // poses or time samples. A singleton raw image permits the exact same
    // scalar normalization as Native, replacing two range normalizations.
    if let Some(q) = singleton_quaternion(raw.map(|v| v.actual)) {
        let norm2 = q.length_squared();
        if !norm2.is_finite() || norm2 <= 0. {
            return None;
        }
        return constant_rotation(q.normalize());
    }
    let factor = factor(raw.map(|v| v.actual))?;
    let q = raw.map(|v| v.mul(Value::input(factor)));
    // Even a non-singleton raw range can round to one normalized quaternion.
    // Read that proved output directly; never normalize it a second time.
    if let Some(q) = singleton_quaternion(q.map(|v| v.actual)) {
        return constant_rotation(q);
    }
    Some(RotationProof {
        q: polynomial,
        actual_q: q,
        factor: Bound {
            lo: f64::from(factor.lo),
            hi: f64::from(factor.hi),
        },
        normalized_scale: normalized_scale(raw, factor),
    })
}

fn sum(a: Value, b: Value) -> Value {
    let mut out = a.add(b);
    // Every actual operand is represented F32. Sterbenz applies to the
    // entire opposite-sign Cartesian range, including gradual underflow.
    let opposite =
        (a.actual.lo >= 0. && b.actual.hi <= 0.) || (a.actual.hi <= 0. && b.actual.lo >= 0.);
    let abs = |v: Float| {
        [
            f64::from(v.lo.abs().min(v.hi.abs())),
            f64::from(v.lo.abs().max(v.hi.abs())),
        ]
    };
    let x = abs(a.actual);
    let y = abs(b.actual);
    if a.finite()
        && b.finite()
        && out.actual.finite()
        && opposite
        && x[1] <= 2. * y[0]
        && y[1] <= 2. * x[0]
    {
        out.error = upper_add(a.error, b.error);
    }
    out
}
fn projected_error(normal: [Bound; 3], error: [f64; 3]) -> f64 {
    let mut out = 0.;
    for i in 0..3 {
        out = upper_add(out, upper_mul(magnitude(normal[i]), error[i]));
    }
    out
}

fn box_input(half: rp::Vector, slab: Option<(usize, bool)>) -> [Value; 3] {
    std::array::from_fn(|i| {
        let (lo, hi) = match slab {
            Some((axis, true)) if axis == i => (0., half[i]),
            Some((axis, false)) if axis == i => (-half[i], 0.),
            _ => (-half[i], half[i]),
        };
        Value::input(Float::span(lo, hi))
    })
}

struct Phase {
    x: Bound,
    q: [Polynomial; 4],
    actual_q: [Value; 4],
    translation: Translation,
    factor: Bound,
    normalized_scale: Option<Bound>,
}

#[allow(clippy::too_many_arguments)]
fn phase_clear(
    phase: Phase,
    axis: usize,
    anchor: rp::Vector,
    offset: rp::Vector,
    relative: rp::Vector,
    spin_drift: Option<Float>,
    cuboid: &rapier3d::parry::shape::Cuboid,
    capsule: &rapier3d::parry::shape::Capsule,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    // Fixed three hull coordinates, two endpoints, six face candidates and
    // cubic controls. Every polynomial/point/error visit is admitted first.
    work.charge(8192)?;
    let _box_proxy = ToiProxy::from_shape(cuboid).ok_or(TrajectoryError::UnsupportedShape)?;
    let x32 = Float::span(phase.x.lo as f32, phase.x.hi as f32);
    let logical = Value {
        actual: x32,
        ideal: phase.x,
        error: half_ulp(x32),
    };
    let translation = phase.translation.map(Value::input);
    let anchored = if anchor == rp::Vector::ZERO {
        translation
    } else {
        work.charge(1024)?;
        transformed(
            phase.actual_q,
            translation,
            anchor
                .to_array()
                .map(|value| Value::input(Float::exact(value))),
        )
    };
    let com: [Value; 3] = std::array::from_fn(|i| {
        anchored[i]
            .add(Value::input(Float::exact(offset[i])))
            .add(logical.mul(Value::input(Float::exact(relative[i]))))
    });
    // Rounding a coordinate of the real closed box stays in its represented
    // [-h,h] endpoints. Absorb this initial rounding into another box point;
    // only the subsequent original rotation/add errors remain. This argument
    // is box-specific and does not discard a local-ball rounding shell.
    let input = box_input(cuboid.half_extents, None);
    let box_output = transformed(phase.actual_q, translation, input);
    if box_output.iter().any(|v| !v.finite()) {
        return Ok(false);
    }
    let box_error = box_output.map(|v| v.error);
    let points = [capsule.segment.a, capsule.segment.b];
    if let Some(drift) = spin_drift {
        // Keep the discarded component finite in both original radius
        // paths. Its logical clock can differ from the shared physical one.
        work.charge(256)?;
        let center = anchored[axis]
            .actual
            .add(Float::exact(offset[axis]))
            .add(drift);
        let core = Float::span(points[0][axis], points[1][axis]);
        let radius = Float::span(-capsule.radius, capsule.radius);
        if !center.add(core.add(radius)).finite() || !center.add(core).add(radius).finite() {
            return Ok(false);
        }
    }
    let segment = (0..3).find(|&i| points[0][i] != points[1][i]).unwrap_or(0);
    if (0..3).any(|i| i != segment && points[0][i] != points[1][i]) {
        return Ok(false);
    }
    if points[1][segment] != -points[0][segment]
        || !(points[1][segment] * 2.).is_finite()
        || (0..3).any(|i| i != segment && points[0][i] != 0.)
    {
        return Ok(false);
    }
    let q = phase.q;
    let Some(zz) = q[axis].mul(q[axis]) else {
        return Ok(false);
    };
    let Some(ww) = q[3].mul(q[3]) else {
        return Ok(false);
    };
    let Some(zw) = q[axis].mul(q[3]) else {
        return Ok(false);
    };
    let norm = zz.add(ww);
    let s = norm.range(phase.x);
    if !s.finite() || s.lo <= 0. {
        return Ok(false);
    }
    let diagonal = ww.sub(zz);
    let twice = zw.scale(Bound::exact(2.));
    let a = (axis + 1) % 3;
    let b = (axis + 2) % 3;
    // R(q_actual) = R(f * raw_ideal) plus the error ledger above.
    // The normalized box term is f^2*s^2*h, not s^2*h. Keep its
    // independently enclosed reciprocal factor; never assume unit q.
    let scale_band = phase.factor.mul(phase.factor).mul(s);
    let normalized_scale = phase.normalized_scale.unwrap_or(scale_band);
    let excess = scale_band.sub(Bound::exact(1.)).hi.max(0.);
    if !excess.is_finite() {
        return Ok(false);
    }
    for face in 0..3 {
        if face == axis && spin_drift.is_some() {
            continue;
        }
        for sign in [-1., 1.] {
            work.charge(2048)?;
            let mut n = [Polynomial::zero(); 3];
            if face == axis {
                n[axis] = norm;
            } else if face == a {
                n[a] = diagonal;
                n[b] = twice;
            } else {
                n[a] = twice.scale(Bound::exact(-1.));
                n[b] = diagonal;
            }
            n = n.map(|v| v.scale(Bound::exact(sign)));
            let normal = n.map(|v| v.range(phase.x));
            if normal.iter().any(|v| !v.finite()) {
                return Ok(false);
            }
            let positive = if normal[segment].lo >= 0. {
                true
            } else if normal[segment].hi <= 0. {
                false
            } else {
                continue;
            };
            // qI makes every local inflate and final add monotone in the
            // one segment coordinate. For every ball u, this endpoint
            // dominates the whole segment; this is not a pose sample.
            let point = if (points[0][segment] <= points[1][segment]) == positive {
                points[0]
            } else {
                points[1]
            };
            let local = std::array::from_fn::<_, 3, _>(|i| {
                sum(com[i], Value::local(point[i], capsule.radius))
            });
            let core = std::array::from_fn::<_, 3, _>(|i| {
                sum(com[i], Value::input(Float::exact(point[i])))
            });
            if local.iter().chain(&core).any(|v| !v.finite()) {
                return Ok(false);
            }
            let mut distance = Polynomial::zero();
            for i in 0..3 {
                let position = Polynomial::affine(offset[i], Bound::exact(f64::from(relative[i])))
                    .add(Polynomial::constant(point[i]));
                let Some(value) = n[i].mul(position) else {
                    return Ok(false);
                };
                distance = distance.add(value);
            }
            let check = |extent: f32,
                         box_error: [f64; 3],
                         work: &mut Work|
             -> Result<bool, TrajectoryError> {
                let box_round = projected_error(normal, box_error);
                let (effective_extent, common) = if anchor == rp::Vector::ZERO {
                    let scale_error = upper_mul(upper_mul(f64::from(extent), s.hi), excess);
                    (
                        Bound::exact(f64::from(extent)),
                        upper_add(scale_error, box_round),
                    )
                } else {
                    // The same real rotation acts on both the anchor and the
                    // face. Its projected difference contains only their
                    // signed face coordinates, scaled by the same norm.
                    let local = Bound::exact(f64::from(extent))
                        .sub(Bound::exact(sign * f64::from(anchor[face])));
                    (Bound::exact(normalized_scale.mul(local).hi), box_round)
                };
                if !common.is_finite() {
                    return Ok(false);
                }
                let base_radius = effective_extent.add(Bound::exact(f64::from(clearance)));
                // Independent real world-radius path, with its original core
                // endpoint/add rounding. Never approximate it by RN(core +/- r).
                let world_error = upper_add(common, projected_error(normal, core.map(|v| v.error)));
                let sphere_gap = distance
                    .sub(norm.scale(base_radius.add(Bound::exact(f64::from(capsule.radius)))))
                    .range(phase.x);
                let world = sphere_gap.sub(Bound::exact(world_error));
                if !world.finite() || world.lo < 0. {
                    return Ok(false);
                }
                // The pure-spin face normal has length |q|² at each time.
                // Use that same correlated radius term with the local path's
                // own rounding error before trying the additional pole bounds.
                work.charge(768)?;
                let local_error =
                    upper_add(common, projected_error(normal, local.map(|v| v.error)));
                let local_sphere = sphere_gap.sub(Bound::exact(local_error));
                if local_sphere.finite() && local_sphere.lo >= 0. {
                    return Ok(true);
                }
                let pole = if positive {
                    point[segment] - capsule.radius
                } else {
                    point[segment] + capsule.radius
                };
                let pole_output = sum(com[segment], Value::input(Float::exact(pole)));
                if !pole_output.finite() {
                    return Ok(false);
                }
                // Convex combinations of two independently valid lower bounds:
                // (1) Euclidean ball + original RN error, (2) the actual monotone
                // pole coordinate. Fixed dual weights are not time/pose samples.
                for weight in [0.5, 0.75, 0.875, 0.9375, 0.96875, 0.984375, 1.] {
                    work.charge(768)?;
                    let mut residual = normal;
                    residual[segment] = residual[segment].mul(Bound::exact(1. - weight));
                    let mut norm2 = 0.;
                    for v in residual {
                        norm2 = upper_add(norm2, upper_mul(magnitude(v), magnitude(v)));
                    }
                    let radius = upper_mul(
                        f64::from(capsule.radius),
                        if norm2 == 0. {
                            0.
                        } else {
                            norm2.sqrt().next_up()
                        },
                    );
                    let local_error = upper_add(
                        projected_error(residual, local.map(|v| v.error)),
                        upper_mul(
                            upper_mul(magnitude(normal[segment]), weight),
                            pole_output.error,
                        ),
                    );
                    let error = upper_add(common, upper_add(radius, local_error));
                    if !error.is_finite() {
                        return Ok(false);
                    }
                    let pole_delta = Bound::exact(f64::from(pole))
                        .sub(Bound::exact(f64::from(point[segment])))
                        .mul(Bound::exact(weight));
                    let local_gap = distance
                        .sub(norm.scale(base_radius))
                        .add(n[segment].scale(pole_delta))
                        .range(phase.x)
                        .sub(Bound::exact(error));
                    if local_gap.finite() && local_gap.lo >= 0. {
                        return Ok(true);
                    }
                }
                Ok(false)
            };
            // Keep the old, inexpensive whole-box error proof first.
            if check(cuboid.half_extents[face], box_error, work)? {
                return Ok(true);
            }
            // RN of a real coordinate stays in each represented closed
            // half-box. The two halves cover the whole original box, so no
            // endpoint/face sample can stand in for the unvisited interior.
            let mut all = true;
            for slab_positive in [false, true] {
                work.charge(4096)?; // this actual slab's original scalar hull
                let output = transformed(
                    phase.actual_q,
                    translation,
                    box_input(cuboid.half_extents, Some((face, slab_positive))),
                );
                if output.iter().any(|v| !v.finite()) {
                    all = false;
                    break;
                }
                // In direction sign*R(raw)e_face, the near half's signed
                // coordinate support is h and the far half's is exactly 0.
                // Positive reciprocal f^2 and norm s^2 preserve that order.
                let extent = if slab_positive == (sign > 0.) {
                    cuboid.half_extents[face]
                } else {
                    0.
                };
                work.charge(2048)?; // actual plane/world-radius visit
                if !check(extent, output.map(|v| v.error), work)? {
                    all = false;
                    break;
                }
            }
            if all {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

pub(in crate::physics3d::solver_trajectory::rounded) fn separated(
    context: Context<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(256)?;
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = context;
    if !start.is_finite() || !end.is_finite() || start > end {
        return Err(TrajectoryError::InvalidTime);
    }
    if !clearance.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if clearance < 0. {
        return Ok(false);
    }
    let (box_motion, box_shape, cap_motion, cap_shape) =
        if let (Some(x), Some(y)) = (sa.as_cuboid(), sb.as_capsule()) {
            (a, x, b, y)
        } else if let (Some(x), Some(y)) = (sb.as_cuboid(), sa.as_capsule()) {
            (b, x, a, y)
        } else {
            return Ok(false);
        };
    let (
        Curve::Integrated(k),
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity: relative,
            rotation,
        },
    ) = (box_motion.curve, cap_motion.curve)
    else {
        return Ok(false);
    };
    let physical_only = anchor != rp::Vector::ZERO;
    if !same_kernel(k, carrier)
        || !identity(box_motion)
        || !identity(cap_motion)
        || (!physical_only
            && k.domain.duration().to_bits() != f64::from(k.native.integration_seconds).to_bits())
        || start < k.domain.start
        || end > k.domain.end
        || rotation.to_array().map(f32::to_bits)
            != rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
    {
        return Ok(false);
    }
    Kernel::from_native(k.native, k.domain)?;
    if !anchor.is_finite()
        || !offset.is_finite()
        || !relative.is_finite()
        || !box_shape.half_extents.is_finite()
        || box_shape.half_extents.min_element() <= 0.
        || !cap_shape.radius.is_finite()
        || cap_shape.radius < 0.
        || !cap_shape.segment.a.is_finite()
        || !cap_shape.segment.b.is_finite()
    {
        return Ok(false);
    }
    let omega = k.native.angular_velocity;
    let q0 = k.native.motion.start.rotation.to_array();
    let qe = k.native.motion.end.rotation.to_array();
    let Some(axis) = (0..3).find(|&i| omega[i] != 0. || q0[i] != 0. || qe[i] != 0.) else {
        return Ok(false);
    };
    if (0..3).any(|i| i != axis && (omega[i] != 0. || q0[i] != 0. || qe[i] != 0.)) {
        return Ok(false);
    }
    // A relative rate along the sole spin axis cannot change either of the
    // perpendicular face projections. Leave that component in the source
    // curve and use its actual independent clock for finite-range admission.
    let (relative, spin_drift) = if physical_only && relative != rp::Vector::ZERO {
        if (0..3).any(|i| i != axis && relative[i] != 0.) {
            return Ok(false);
        }
        let logical_h = k.domain.duration() as f32;
        if !logical_h.is_finite() {
            return Ok(false);
        }
        let drift = Float::span(0., logical_h).mul(Float::exact(relative[axis]));
        if !drift.finite() {
            return Ok(false);
        }
        (rp::Vector::ZERO, Some(drift))
    } else {
        (relative, None)
    };
    let h = f64::from(k.native.integration_seconds);
    let dt = Float::span(k.local_delta(start), k.local_delta(end));
    // A local anchor has no independent logical-dt term in the projection.
    // Its polynomial variable can therefore be the actual physical input.
    let x = if physical_only {
        Bound {
            lo: f64::from(dt.lo),
            hi: f64::from(dt.hi),
        }
    } else {
        Bound {
            lo: (start - k.domain.start).clamp(0., h),
            hi: (end - k.domain.start).clamp(0., h),
        }
    };
    if !x.finite() || !dt.finite() {
        return Ok(false);
    }
    // RN64(x/h), clamp, RN64(u*h): absolute error <= h*2^-53
    // plus half the F64 spacing at h. All h are positive finite F32,
    // so these bounds have no F64 underflow/overflow.
    let mapping = upper_add(upper_mul(h, 2_f64.powi(-53)), (h.next_up() - h) * 0.5);
    if dt.lo <= 0. {
        work.charge(256)?;
        let hi = x.hi.min(upper_add(mapping, half_ulp(Float::ZERO)));
        let stored = Phase {
            x: Bound { lo: x.lo, hi },
            q: q0.map(Polynomial::constant),
            actual_q: q0.map(|v| Value::input(Float::exact(v))),
            translation: exact_vector(k.native.motion.start.translation),
            factor: Bound::exact(1.),
            normalized_scale: None,
        };
        if stored.x.lo <= stored.x.hi
            && !phase_clear(
                stored, axis, anchor, offset, relative, spin_drift, box_shape, cap_shape,
                clearance, work,
            )?
        {
            // With no relative term, every dt==0 branch is the same actual
            // static full geometry, not a sampled constant approximation.
            if spin_drift.is_some()
                || relative != rp::Vector::ZERO
                || clearance <= 0.
                || initial_support::initial_support_allowances(
                    a,
                    sa,
                    b,
                    sb,
                    rp::Vector::Y,
                    k.domain.start,
                    work,
                )?
                .geometry
                    < clearance
            {
                return Ok(false);
            }
        }
    }
    let interior = Float {
        lo: dt.lo.max(f32::from_bits(1)),
        hi: dt.hi.min(k.native.integration_seconds.next_down()),
    };
    if interior.lo <= interior.hi {
        work.charge(4096)?;
        let input = Value {
            actual: interior,
            ideal: x,
            error: if physical_only {
                0.
            } else {
                upper_add(mapping, half_ulp(interior))
            },
        };
        let (raw, polynomial) = raw_rotation(input, omega, axis, q0);
        let Some(rotation) = rotation_proof(raw, polynomial) else {
            return Ok(false);
        };
        let phase = Phase {
            x,
            q: rotation.q,
            actual_q: rotation.actual_q,
            translation: add(
                exact_vector(k.native.motion.start.translation),
                mul(k.native.linear_velocity, interior),
            ),
            factor: rotation.factor,
            normalized_scale: rotation.normalized_scale,
        };
        if !phase_clear(
            phase, axis, anchor, offset, relative, spin_drift, box_shape, cap_shape, clearance,
            work,
        )? {
            return Ok(false);
        }
    }
    if dt.hi >= k.native.integration_seconds {
        work.charge(256)?;
        let lo = x.lo.max(
            (h - upper_add(
                mapping,
                half_ulp(Float::exact(k.native.integration_seconds)),
            ))
            .next_down(),
        );
        let stored = Phase {
            x: Bound { lo, hi: x.hi },
            q: qe.map(Polynomial::constant),
            actual_q: qe.map(|v| Value::input(Float::exact(v))),
            translation: exact_vector(k.native.motion.end.translation),
            factor: Bound::exact(1.),
            normalized_scale: None,
        };
        if stored.x.lo <= stored.x.hi
            && !phase_clear(
                stored, axis, anchor, offset, relative, spin_drift, box_shape, cap_shape,
                clearance, work,
            )?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(in crate::physics3d::solver_trajectory::rounded) fn projected_prefix(
    context: Context<'_>,
    work: &mut Work,
) -> Result<crate::physics3d::solver_trajectory::IntervalCertificate, TrajectoryError> {
    use crate::physics3d::solver_trajectory::IntervalCertificate::Unproven;
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = context;
    let (cube, cap, half, capsule, flipped) =
        if let (Some(cube), Some(cap)) = (sa.as_cuboid(), sb.as_capsule()) {
            (a, b, cube.half_extents, cap, false)
        } else if let (Some(cap), Some(cube)) = (sa.as_capsule(), sb.as_cuboid()) {
            (b, a, cube.half_extents, cap, true)
        } else {
            return Ok(Unproven);
        };
    let Curve::Integrated(k) = cube.curve else {
        return Ok(Unproven);
    };
    let omega = k.native.angular_velocity;
    if !identity(cube)
        || !identity(cap)
        || omega.x != 0.
        || omega.y != 0.
        || omega.z <= 0.
        || k.native.linear_velocity != rp::Vector::ZERO
        || ![k.native.motion.start, k.native.motion.end]
            .into_iter()
            .all(|pose| {
                let q = pose.rotation;
                pose.translation == rp::Vector::ZERO
                    && q.x == 0.
                    && q.y == 0.
                    && q.z > 0.
                    && q.z < q.w
                    && q.w >= 0.5
                    && q.w <= 1.
            })
        || !(omega.z * (k.native.integration_seconds * 0.5)).is_finite()
    {
        return Ok(Unproven);
    }
    let z = match cap.curve {
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        } if anchor == rp::Vector::ZERO
            && linear_velocity == rp::Vector::ZERO
            && rotation == rp::Rotation::IDENTITY
            && carrier.native.angular_velocity == rp::Vector::ZERO
            && carrier.native.motion.start.rotation == rp::Rotation::IDENTITY
            && carrier.native.motion.end.rotation == rp::Rotation::IDENTITY
            && carrier.native.linear_velocity.x != 0.
            && carrier.native.linear_velocity.y != 0.
            && offset.is_finite() =>
        {
            let n = carrier.native;
            (f64::from(n.motion.start.translation.z.abs())
                + f64::from((n.linear_velocity.z * n.integration_seconds).abs()))
            .max(f64::from(n.motion.end.translation.z.abs()))
                + f64::from(offset.z.abs())
        }
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        } => {
            if !same_kernel(k, carrier)
                || anchor == rp::Vector::ZERO
                || rotation != rp::Rotation::IDENTITY
                || !anchor.is_finite()
                || !offset.is_finite()
                || !linear_velocity.is_finite()
                || linear_velocity.x != 0.
                || linear_velocity.y != 0.
            {
                return Ok(Unproven);
            }
            let logical_h = k.domain.duration() as f32;
            f64::from(anchor.z.abs()) * 4.
                + f64::from(offset.z.abs())
                + f64::from((linear_velocity.z * logical_h).abs())
        }
        Curve::Integrated(k)
            if k.native.angular_velocity == rp::Vector::ZERO
                && k.native.motion.start.rotation == rp::Rotation::IDENTITY
                && k.native.motion.end.rotation == rp::Rotation::IDENTITY =>
        {
            let n = k.native;
            (f64::from(n.motion.start.translation.z.abs())
                + f64::from((n.linear_velocity.z * n.integration_seconds).abs()))
            .max(f64::from(n.motion.end.translation.z.abs()))
        }
        _ => return Ok(Unproven),
    };
    let z = z
        + f64::from(capsule.radius.abs())
        + f64::from(capsule.segment.a.z.abs().max(capsule.segment.b.z.abs()));
    if !z.is_finite() || z >= f64::from(f32::MAX) * 0.5 {
        return Ok(Unproven);
    }
    crate::physics3d::solver_trajectory::rounded::common_timeline::projected_capsule_prefix(
        cube, half, cap, capsule, start, end, clearance, flipped, work,
    )
}

#[cfg(test)]
mod tests;
