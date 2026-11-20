//! A complete RN32 residue proof for one existing cardinal separating axis.
//! Each rounded node must stay in one normal binade; a whole-cell exact
//! Sterbenz node can carry the same shift across its output binades. Only
//! after proving even shifts or complete no-half-tie conditions do we enumerate
//! finite residues. Representatives are not trajectory/time samples.
use super::{output::Context, Bound, Curve, ShapeMotion, Time, TrajectoryError, Work};
use crate::physics3d::solver_trajectory::Kernel;
use rapier3d::prelude as rp;

// An optional proof's fixed loop bound; larger periods use the original proof
// paths. This is neither a shape limit nor a new query/work allowance.
const MAX_RESIDUES: u32 = 256;
const HEADER_WORK: u64 = 512;
const VECTOR_WORK: u64 = 256;
const RELATIVE_WORK: u64 = 256;
const NODE_WORK: u64 = 64;
const RESIDUE_WORK: u64 = 128;

#[derive(Clone, Copy)]
struct Range {
    lo: f32,
    hi: f32,
    exponent: i32,
}
impl Range {
    fn new(a: f32, b: f32) -> Option<Self> {
        if !a.is_finite() || !b.is_finite() {
            return None;
        }
        let (lo, hi) = (a.min(b), a.max(b));
        let low = lo.to_bits();
        let high = hi.to_bits();
        // Exclude zero/subnormals, sign crossings, and binade changes. The
        // ordinary full-support/chronological paths retain all those inputs.
        let exponent = (low >> 23) & 255;
        if exponent == 0 || exponent == 255 || low >> 23 != high >> 23 {
            return None;
        }
        Some(Self {
            lo,
            hi,
            exponent: exponent as i32 - 127,
        })
    }
    fn ulp_exponent(self) -> i32 {
        self.exponent - 23
    }
    fn qualify_add(self, constant: f32, work: &mut Work) -> Result<Node, TrajectoryError> {
        work.charge(NODE_WORK)?;
        if !constant.is_finite() {
            return Ok(Node::Unavailable);
        }
        // Two represented F32 operands with exponent distance <=24 have at
        // most 49 significant binary places in their sum; widening and this
        // F64 addition are exact, including cancellation. Zero is exact too.
        if constant != 0. {
            let b = constant.to_bits() & 0x7fff_ffff;
            let exponent = if b >> 23 == 0 {
                -149 + b.ilog2() as i32
            } else {
                (b >> 23) as i32 - 127
            };
            if (self.exponent - exponent).abs() > 24 {
                return Ok(Node::Unavailable);
            }
        }
        let exact = [
            f64::from(self.lo) + f64::from(constant),
            f64::from(self.hi) + f64::from(constant),
        ];
        let result = match node_range(self.lo + constant, self.hi + constant) {
            Node::Stable(v) => v,
            unavailable => return Ok(unavailable),
        };
        let base = 2_f64.powi(result.exponent);
        if exact.iter().any(|x| !(base..2. * base).contains(&x.abs())) {
            return Ok(Node::Split);
        }
        // Monotone RN32 and the exact pre-round extrema prove that every
        // intermediate value uses this one grid, not just the two endpoints.
        Ok(Node::Stable(result))
    }
    fn qualify_product(self, constant: f32, work: &mut Work) -> Result<Node, TrajectoryError> {
        work.charge(NODE_WORK)?;
        let result = match node_range(self.lo + constant, self.hi + constant) {
            Node::Stable(v) => v,
            unavailable => return Ok(unavailable),
        };
        // A tiny relative product need not fit the exact F64 sum condition
        // used by the original nodes. Enclose its real pre-round addition
        // with the existing outward Bound arithmetic instead. Neither the
        // exponent-distance rule nor any original RN operation is relaxed.
        let pre = Bound {
            lo: f64::from(self.lo),
            hi: f64::from(self.hi),
        }
        .add(Bound::exact(f64::from(constant)));
        let base = 2_f64.powi(result.exponent);
        let in_binade = if result.lo.is_sign_negative() {
            pre.lo > -2. * base && pre.hi <= -base
        } else {
            pre.lo >= base && pre.hi < 2. * base
        };
        Ok(if !pre.finite() {
            Node::Unavailable
        } else if in_binade {
            Node::Stable(result)
        } else {
            Node::Split
        })
    }
    #[cfg(test)]
    fn add(self, constant: f32, work: &mut Work) -> Result<Option<Self>, TrajectoryError> {
        Ok(match self.qualify_add(constant, work)? {
            Node::Stable(v) => Some(v),
            _ => None,
        })
    }
    #[cfg(test)]
    fn add_product(self, constant: f32, work: &mut Work) -> Result<Option<Self>, TrajectoryError> {
        Ok(match self.qualify_product(constant, work)? {
            Node::Stable(v) => Some(v),
            _ => None,
        })
    }
}

enum Node {
    Stable(Range),
    Split,
    Unavailable,
}
fn node_range(lo: f32, hi: f32) -> Node {
    if let Some(v) = Range::new(lo, hi) {
        return Node::Stable(v);
    }
    if !lo.is_finite() || !hi.is_finite() {
        return Node::Unavailable;
    }
    // A whole wide subnormal-only range has no implemented period proof.
    // Do not blindly subdivide a fixed unsupported grid condition.
    if (lo.to_bits() & 0x7f80_0000) == 0 && (hi.to_bits() & 0x7f80_0000) == 0 {
        return Node::Unavailable;
    }
    Node::Split
}

pub(super) fn same_kernel(a: Kernel, b: Kernel) -> bool {
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
pub(super) fn identity_rotation(q: rp::Rotation) -> bool {
    q.to_array().map(f32::to_bits) == rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
}
pub(super) fn identity_frame(m: ShapeMotion) -> bool {
    m.local_center == rp::Vector::ZERO
        && m.local_pose.translation == rp::Vector::ZERO
        && identity_rotation(m.local_pose.rotation)
}
fn ordered(x: f32) -> u32 {
    let bits = x.to_bits();
    if bits & 0x8000_0000 == 0 {
        bits ^ 0x8000_0000
    } else {
        !bits
    }
}
fn from_ordered(x: u32) -> f32 {
    f32::from_bits(if x & 0x8000_0000 == 0 {
        !x
    } else {
        x ^ 0x8000_0000
    })
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Certificate {
    pub(super) separated: bool,
    pub(super) probe: Option<Time>,
}
impl Certificate {
    fn unknown() -> Self {
        Self {
            separated: false,
            probe: None,
        }
    }
    fn clear() -> Self {
        Self {
            separated: true,
            probe: None,
        }
    }
}
pub(super) fn separated(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    // Plain bool consumers cannot use a positive cue: do not price/search one.
    Ok(certificate_impl(context, normal, work, false)?.separated)
}
pub(super) fn certificate(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<Certificate, TrajectoryError> {
    certificate_impl(context, normal, work, true)
}

#[derive(Clone, Copy)]
struct Cell {
    low: u32,
    high: u32,
    depth: u8,
}
#[derive(Clone, Copy)]
struct Plane {
    anchor: f32,
    offset: f32,
    product: f32,
    point: f32,
    radius: f32,
    half: f32,
    clearance: f32,
}
impl Plane {
    fn actor(self, t: f32) -> f32 {
        let base = (t + self.anchor) + self.offset;
        if self.product != 0. {
            base + self.product
        } else {
            base
        }
    }
    fn clear_at(self, t: f32, top: f32) -> Option<bool> {
        let actor = self.actor(t);
        let core = actor + self.point;
        let local = actor + (self.point - self.radius);
        let top = Bound::exact(f64::from(top));
        let world = Bound::exact(f64::from(core))
            .sub(Bound::exact(f64::from(self.radius)))
            .sub(top);
        let local = Bound::exact(f64::from(local)).sub(top);
        (world.finite() && local.finite())
            .then_some(world.lo > f64::from(self.clearance) && local.lo > f64::from(self.clearance))
    }
}
#[derive(Clone, Copy)]
enum Attempt {
    Clear,
    Split,
    Unavailable,
    Candidate(u32),
}
#[derive(Clone, Copy)]
struct RoundedAdd {
    input: Range,
    constant: f32,
    output: Range,
}
fn quantum_exponent(x: f32) -> Option<i32> {
    let bits = x.to_bits() & 0x7fff_ffff;
    let e = bits >> 23;
    if bits == 0 || e == 255 {
        return None;
    }
    let significand = if e == 0 {
        bits
    } else {
        (bits & 0x7f_ffff) | 0x80_0000
    };
    Some((if e == 0 { -149 } else { e as i32 - 150 }) + significand.trailing_zeros() as i32)
}
fn no_half_tie(node: RoundedAdd) -> bool {
    no_half_tie_grid(
        node.input.ulp_exponent(),
        node.constant,
        node.output.ulp_exponent(),
    )
}
fn no_half_tie_grid(input: i32, constant_value: f32, output: i32) -> bool {
    if !constant_value.is_finite() {
        return false;
    }
    let constant = quantum_exponent(constant_value);
    // Every represented input is a multiple of its binade grid. If the
    // exact sum is on the output grid, it is never a half-way case.
    if input >= output && (constant_value == 0. || constant.is_some_and(|q| q >= output)) {
        return true;
    }
    // A tie would require x+c on the output half-grid. Both x and that
    // half-grid are multiples of 2^min(input,output-1). A constant with a
    // strictly finer last set bit cannot satisfy that congruence, anywhere
    // in the already qualified complete pre/post binade ranges.
    constant.is_some_and(|q| q < input.min(output - 1))
}
fn cell_proof(cell: Cell, p: Plane, work: &mut Work) -> Result<Attempt, TrajectoryError> {
    let Some(count) = cell
        .high
        .checked_sub(cell.low)
        .and_then(|n| n.checked_add(1))
    else {
        return Ok(Attempt::Unavailable);
    };
    let representatives = if count <= MAX_RESIDUES {
        count
    } else {
        macro_rules! stable {
            ($node:expr) => {
                match $node {
                    Node::Stable(v) => v,
                    Node::Split => return Ok(Attempt::Split),
                    Node::Unavailable => return Ok(Attempt::Unavailable),
                }
            };
        }
        let t = stable!(node_range(from_ordered(cell.low), from_ordered(cell.high)));
        let inner = stable!(t.qualify_add(p.anchor, work)?);
        let base = stable!(inner.qualify_add(p.offset, work)?);
        let actor = if p.product != 0. {
            stable!(base.qualify_product(p.product, work)?)
        } else {
            base
        };
        let top = stable!(t.qualify_add(p.half, work)?);
        let core = stable!(actor.qualify_add(p.point, work)?);
        let local = stable!(actor.qualify_add(p.point - p.radius, work)?);
        let max_ulp = [t, inner, base, actor, top, core, local]
            .into_iter()
            .map(Range::ulp_exponent)
            .max()
            .unwrap_or(t.ulp_exponent());
        let shift = max_ulp + 1 - t.ulp_exponent();
        let Some(mut period) = u32::try_from(shift).ok().and_then(|s| 1_u32.checked_shl(s)) else {
            return Ok(Attempt::Unavailable);
        };
        if period > MAX_RESIDUES {
            if period != 2 * MAX_RESIDUES {
                return Ok(Attempt::Unavailable);
            }
            // The old even-shift proof/price always wins first. Only this
            // previously unavailable case admits an odd-shift alternative.
            work.charge(64 + std::mem::size_of::<[RoundedAdd; 6]>() as u64)?;
            let nodes = [
                RoundedAdd {
                    input: t,
                    constant: p.anchor,
                    output: inner,
                },
                RoundedAdd {
                    input: inner,
                    constant: p.offset,
                    output: base,
                },
                RoundedAdd {
                    input: base,
                    constant: p.product,
                    output: actor,
                },
                RoundedAdd {
                    input: t,
                    constant: p.half,
                    output: top,
                },
                RoundedAdd {
                    input: actor,
                    constant: p.point,
                    output: core,
                },
                RoundedAdd {
                    input: actor,
                    constant: p.point - p.radius,
                    output: local,
                },
            ];
            for (index, node) in nodes.into_iter().enumerate() {
                if index == 2 && p.product == 0. {
                    continue;
                }
                work.charge(32)?;
                // Smaller grids shift by an even count as before. Inspect
                // every actual coarsest rounded node, never assume uniqueness.
                if node.output.ulp_exponent() == max_ulp && !no_half_tie(node) {
                    return Ok(Attempt::Unavailable);
                }
            }
            period /= 2;
        }
        // Each rounded node uses a qualified grid. Either shifts are even,
        // or each odd-shift node has no exact tie at any admitted input. RN
        // then commutes with the common shift over all residue classes.
        period
    };
    for residue in 0..representatives {
        work.charge(RESIDUE_WORK)?;
        let key = cell.low + residue;
        let t = from_ordered(key);
        match p.clear_at(t, t + p.half) {
            Some(true) => {}
            Some(false) => return Ok(Attempt::Candidate(key)),
            None => return Ok(Attempt::Unavailable),
        }
    }
    Ok(Attempt::Clear)
}
#[derive(Clone, Copy)]
enum Input {
    Translation,
    Displacement { origin: f32 },
}
impl Input {
    fn translation(self, value: f32) -> f32 {
        match self {
            Self::Translation => value,
            Self::Displacement { origin } => origin + value,
        }
    }
    fn at(self, k: Kernel, axis: usize, sign: f32, time: Time) -> f32 {
        match self {
            Self::Translation => k.position_at_time(time).translation[axis] * sign,
            Self::Displacement { .. } => {
                (k.native.linear_velocity[axis] * k.local_delta(time)) * sign
            }
        }
    }
}
fn outward_add(lo: f32, hi: f32, constant: f32, work: &mut Work) -> Result<Node, TrajectoryError> {
    work.charge(NODE_WORK)?;
    let result = match node_range(lo + constant, hi + constant) {
        Node::Stable(v) => v,
        unknown => return Ok(unknown),
    };
    let pre = Bound {
        lo: f64::from(lo),
        hi: f64::from(hi),
    }
    .add(Bound::exact(f64::from(constant)));
    let base = 2_f64.powi(result.exponent);
    let inside = if result.lo.is_sign_negative() {
        pre.lo > -2. * base && pre.hi <= -base
    } else {
        pre.lo >= base && pre.hi < 2. * base
    };
    Ok(if !pre.finite() {
        Node::Unavailable
    } else if inside {
        Node::Stable(result)
    } else {
        Node::Split
    })
}
fn sterbenz(origin: f32, lo: f32, hi: f32) -> bool {
    // Represented opposite operands. F64 widening and power-of-two scaling
    // are exact over all finite F32 magnitudes, including subnormals.
    if origin == 0. {
        return true;
    }
    if !origin.is_finite()
        || !lo.is_finite()
        || !hi.is_finite()
        || (origin > 0. && hi >= 0.)
        || (origin < 0. && lo <= 0.)
    {
        return false;
    }
    let a = f64::from(origin).abs();
    f64::from(lo).abs().min(f64::from(hi).abs()) >= a * 0.5
        && f64::from(lo).abs().max(f64::from(hi).abs()) <= a * 2.
}
fn displacement_cell_proof(
    cell: Cell,
    p: Plane,
    origin: f32,
    work: &mut Work,
) -> Result<Attempt, TrajectoryError> {
    let Some(count) = cell
        .high
        .checked_sub(cell.low)
        .and_then(|n| n.checked_add(1))
    else {
        return Ok(Attempt::Unavailable);
    };
    work.charge(NODE_WORK)?; // original RN(T0+P) image / exactness admission
    let (low_p, high_p) = (from_ordered(cell.low), from_ordered(cell.high));
    let (low_t, high_t) = (origin + low_p, origin + high_p);
    if !low_t.is_finite() || !high_t.is_finite() {
        return Ok(Attempt::Unavailable);
    }
    if low_t.to_bits() == high_t.to_bits() {
        // Monotone original RN addition has a complete singleton output.
        // This includes unreachable tiny P and stored-dt0 cells, not samples.
        work.charge(RESIDUE_WORK)?;
        return Ok(match p.clear_at(low_t, low_t + p.half) {
            Some(true) => Attempt::Clear,
            Some(false) => Attempt::Candidate(cell.low),
            None => Attempt::Unavailable,
        });
    }
    let representatives = if count <= MAX_RESIDUES {
        count
    } else {
        macro_rules! stable {
            ($node:expr) => {
                match $node {
                    Node::Stable(v) => v,
                    Node::Split => return Ok(Attempt::Split),
                    Node::Unavailable => return Ok(Attempt::Unavailable),
                }
            };
        }
        let primary = stable!(node_range(low_p, high_p));
        // Only a whole-cell Sterbenz proof may bypass T's output grid. The
        // actual forward T0+P remains RN32 in every evaluated residue.
        let rounded_t = if sterbenz(origin, low_p, high_p) {
            None
        } else {
            Some(stable!(outward_add(low_p, high_p, origin, work)?))
        };
        let inner = stable!(outward_add(low_t, high_t, p.anchor, work)?);
        let base = stable!(inner.qualify_add(p.offset, work)?);
        let actor = if p.product != 0. {
            stable!(base.qualify_product(p.product, work)?)
        } else {
            base
        };
        let top = stable!(outward_add(low_t, high_t, p.half, work)?);
        let core = stable!(actor.qualify_add(p.point, work)?);
        let local = stable!(actor.qualify_add(p.point - p.radius, work)?);
        let mut max_ulp = [primary, inner, base, actor, top, core, local]
            .into_iter()
            .map(Range::ulp_exponent)
            .max()
            .unwrap_or(primary.ulp_exponent());
        if let Some(t) = rounded_t {
            max_ulp = max_ulp.max(t.ulp_exponent());
        }
        let shift = max_ulp + 1 - primary.ulp_exponent();
        let Some(mut period) = u32::try_from(shift).ok().and_then(|s| 1_u32.checked_shl(s)) else {
            return Ok(Attempt::Unavailable);
        };
        if period > MAX_RESIDUES {
            if period != 2 * MAX_RESIDUES {
                return Ok(Attempt::Unavailable);
            }
            work.charge(64 + std::mem::size_of::<[(i32, f32, i32); 7]>() as u64)?;
            // An exact affine T0+P belongs to the common zero-lattice of
            // origin and P even if its output spans many float binades.
            let t_grid = rounded_t.map_or_else(
                || {
                    quantum_exponent(origin)
                        .unwrap_or(primary.ulp_exponent())
                        .min(primary.ulp_exponent())
                },
                Range::ulp_exponent,
            );
            let nodes = [
                (
                    primary.ulp_exponent(),
                    origin,
                    rounded_t.unwrap_or(primary).ulp_exponent(),
                ),
                (t_grid, p.anchor, inner.ulp_exponent()),
                (inner.ulp_exponent(), p.offset, base.ulp_exponent()),
                (base.ulp_exponent(), p.product, actor.ulp_exponent()),
                (t_grid, p.half, top.ulp_exponent()),
                (actor.ulp_exponent(), p.point, core.ulp_exponent()),
                (
                    actor.ulp_exponent(),
                    p.point - p.radius,
                    local.ulp_exponent(),
                ),
            ];
            for (index, (input_grid, constant, output_grid)) in nodes.into_iter().enumerate() {
                if (index == 0 && rounded_t.is_none()) || (index == 3 && p.product == 0.) {
                    continue;
                }
                work.charge(32)?;
                if output_grid == max_ulp && !no_half_tie_grid(input_grid, constant, output_grid) {
                    return Ok(Attempt::Unavailable);
                }
            }
            period /= 2;
        }
        period
    };
    for residue in 0..representatives {
        work.charge(RESIDUE_WORK)?;
        let key = cell.low + residue;
        let t = origin + from_ordered(key);
        match p.clear_at(t, t + p.half) {
            Some(true) => {}
            Some(false) => return Ok(Attempt::Candidate(key)),
            None => return Ok(Attempt::Unavailable),
        }
    }
    Ok(Attempt::Clear)
}
fn input_cell_proof(
    cell: Cell,
    p: Plane,
    input: Input,
    work: &mut Work,
) -> Result<Attempt, TrajectoryError> {
    match input {
        Input::Translation => cell_proof(cell, p, work),
        Input::Displacement { origin } => {
            let proof = displacement_cell_proof(cell, p, origin, work)?;
            if !matches!(proof, Attempt::Unavailable) {
                return Ok(proof);
            }
            work.charge(64)?; // actual whole monotone endpoint-image mapping
            let lo = origin + from_ordered(cell.low);
            let hi = origin + from_ordered(cell.high);
            if !lo.is_finite() || !hi.is_finite() {
                return Ok(Attempt::Unavailable);
            }
            let image = Cell {
                low: ordered(lo).min(ordered(hi)),
                high: ordered(lo).max(ordered(hi)),
                depth: 0,
            };
            // P -> T only: this original T union cannot call P again. A T
            // counter is not a P key/probe, nor a reason to split fixed P
            // qualification failures. Accept only the complete clear result.
            Ok(
                if matches!(
                    prove_union(image, p, Input::Translation, work)?,
                    Attempt::Clear
                ) {
                    Attempt::Clear
                } else {
                    Attempt::Unavailable
                },
            )
        }
    }
}

fn independent_clear(
    cell: Cell,
    p: Plane,
    input: Input,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(64)?;
    // Complete monotone endpoint range: capsule's least oriented COM versus
    // the box's greatest support. This can close a cell across a binade,
    // without inferring correlated cancellation or sampling an interior.
    Ok(p.clear_at(
        input.translation(from_ordered(cell.low)),
        input.translation(from_ordered(cell.high)) + p.half,
    )
    .unwrap_or(false))
}

// A represented common T plus an outward real constant/error ledger. Actual
// extrema retain every original RN add; only their shared real T coefficient
// cancels in the final plane gap. No ideal reconstruction replaces that graph.
#[derive(Clone, Copy)]
struct Affine {
    actual: [f32; 2],
    constant: Bound,
    error: f64,
}
impl Affine {
    fn input(cell: Cell) -> Self {
        Self {
            actual: [from_ordered(cell.low), from_ordered(cell.high)],
            constant: Bound::exact(0.),
            error: 0.,
        }
    }
    fn add(self, value: f32, work: &mut Work) -> Result<Option<Self>, TrajectoryError> {
        work.charge(NODE_WORK)?;
        if !value.is_finite() || self.actual.iter().any(|v| !v.is_finite()) {
            return Ok(None);
        }
        let actual = self.actual.map(|v| v + value);
        if value == 0. {
            // Numeric support ignores the sign of zero. The original RN
            // endpoints are still carried into the next node's qualification.
            return Ok(Some(Self { actual, ..self }));
        }
        let Some(output) = Range::new(actual[0], actual[1]) else {
            return Ok(None);
        };
        let pre = Bound {
            lo: f64::from(self.actual[0]),
            hi: f64::from(self.actual[1]),
        }
        .add(Bound::exact(f64::from(value)));
        let base = 2_f64.powi(output.exponent);
        let in_binade = if output.lo.is_sign_negative() {
            pre.lo > -2. * base && pre.hi <= -base
        } else {
            pre.lo >= base && pre.hi < 2. * base
        };
        if !pre.finite() || !in_binade {
            return Ok(None);
        }
        // Every represented input is on its complete binade's grid (or the
        // finer-known singleton grid). An exact sum on the output grid is
        // representable throughout the proved pre-round binade, so its error
        // is zero. Otherwise RN has the uniform output half-ULP bound.
        let input_grid = if self.actual[0].to_bits() == self.actual[1].to_bits() {
            quantum_exponent(self.actual[0])
        } else {
            Range::new(self.actual[0], self.actual[1]).map(Range::ulp_exponent)
        };
        let aligned = input_grid.is_some_and(|q| q >= output.ulp_exponent())
            && quantum_exponent(value).is_some_and(|q| q >= output.ulp_exponent());
        let rounding = if aligned {
            0.
        } else {
            2_f64.powi(output.ulp_exponent() - 1)
        };
        let constant = self.constant.add(Bound::exact(f64::from(value)));
        let error = Bound::exact(self.error).add(Bound::exact(rounding)).hi;
        Ok((constant.finite() && error.is_finite()).then_some(Self {
            actual,
            constant,
            error,
        }))
    }
    fn gap_lower(self, other: Self, radius: f32) -> Option<f64> {
        let error = Bound::exact(self.error).add(Bound::exact(other.error));
        let gap = self
            .constant
            .sub(other.constant)
            .sub(Bound::exact(f64::from(radius)))
            .sub(error);
        gap.finite().then_some(gap.lo)
    }
}
fn affine_lower(
    cell: Cell,
    p: Plane,
    work: &mut Work,
) -> Result<Option<[f64; 2]>, TrajectoryError> {
    // Fixed local ledgers only: no heap, time visits, Native observations, or
    // inverse. Actual node visits are charged separately before arithmetic.
    work.charge(128 + std::mem::size_of::<[Affine; 4]>() as u64)?;
    macro_rules! node {
        ($operation:expr) => {
            match $operation? {
                Some(v) => v,
                None => return Ok(None),
            }
        };
    }
    let input = Affine::input(cell);
    let inner = node!(input.add(p.anchor, work));
    let mut actor = node!(inner.add(p.offset, work));
    if p.product != 0. {
        actor = node!(actor.add(p.product, work));
    }
    let top = node!(input.add(p.half, work));
    let core = node!(actor.add(p.point, work));
    // Preserve the original local RN(point-radius) constant independently of
    // the real world-radius subtraction; neither can stand in for the other.
    let local = node!(actor.add(p.point - p.radius, work));
    Ok(
        match (core.gap_lower(top, p.radius), local.gap_lower(top, 0.)) {
            (Some(world), Some(local)) => Some([world, local]),
            _ => None,
        },
    )
}
fn push_children(cell: Cell, stack: &mut [Cell; 33], len: &mut usize) -> bool {
    if cell.low >= cell.high || cell.depth >= 32 || *len + 2 > stack.len() {
        return false;
    }
    let mid = cell.low + (cell.high - cell.low) / 2;
    stack[*len] = Cell {
        low: mid + 1,
        high: cell.high,
        depth: cell.depth + 1,
    };
    stack[*len + 1] = Cell {
        low: cell.low,
        high: mid,
        depth: cell.depth + 1,
    };
    *len += 2;
    true
}
fn ordered_time(x: Time) -> u64 {
    let bits = x.to_bits();
    if bits & (1_u64 << 63) == 0 {
        bits ^ (1_u64 << 63)
    } else {
        !bits
    }
}
fn from_ordered_time(x: u64) -> Time {
    Time::from_bits(if x & (1_u64 << 63) == 0 {
        !x
    } else {
        x ^ (1_u64 << 63)
    })
}
#[allow(clippy::too_many_arguments)]
fn time_probe(
    k: Kernel,
    input: Input,
    axis: usize,
    sign: f32,
    start: Time,
    end: Time,
    first: f32,
    last: f32,
    key: u32,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    work.charge(64)?;
    let target = from_ordered(key);
    if target == 0. || start >= end || !target.is_finite() {
        return Ok(None);
    }
    // This is only a nomination. The lower support product is counterfactual;
    // the caller must query its actual original full world point at this time.
    let at = |time| input.at(k, axis, sign, time);
    if first.to_bits() == target.to_bits() {
        let time = start.next_up();
        if time >= end {
            return Ok(None);
        }
        work.charge(128)?;
        return Ok((at(time).to_bits() == target.to_bits()).then_some(time));
    }
    let increasing = first < last;
    if first == last || target < first.min(last) || target > first.max(last) {
        return Ok(None);
    }
    let (mut lo, mut hi) = (ordered_time(start), ordered_time(end));
    if lo >= hi {
        return Ok(None);
    }
    let mut upper_value = last;
    for _ in 0..64 {
        if hi - lo <= 1 {
            break;
        }
        let mid = lo + (hi - lo) / 2;
        work.charge(128)?;
        let value = at(from_ordered_time(mid));
        if !value.is_finite() {
            return Ok(None);
        }
        if if increasing {
            value >= target
        } else {
            value <= target
        } {
            hi = mid;
            upper_value = value;
        } else {
            lo = mid;
        }
    }
    let time = from_ordered_time(hi);
    Ok(
        (hi - lo <= 1 && time > start && time < end && upper_value.to_bits() == target.to_bits())
            .then_some(time),
    )
}

fn certificate_impl(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
    want_probe: bool,
) -> Result<Certificate, TrajectoryError> {
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = context;
    let (box_motion, box_shape, cap_motion, cap_shape, n) =
        if let (Some(x), Some(y)) = (sa.as_cuboid(), sb.as_capsule()) {
            (a, x, b, y, normal)
        } else if let (Some(x), Some(y)) = (sb.as_cuboid(), sa.as_capsule()) {
            (b, x, a, y, -normal)
        } else {
            return Ok(Certificate::unknown());
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
        return Ok(Certificate::unknown());
    };
    work.charge(HEADER_WORK)?;
    if !start.is_finite() || !end.is_finite() || start > end {
        return Err(TrajectoryError::InvalidTime);
    }
    if !clearance.is_finite() || !n.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let Some(axis) = (0..3).find(|&i| n[i] == 1. || n[i] == -1.) else {
        return Ok(Certificate::unknown());
    };
    if (0..3).any(|i| i != axis && n[i] != 0.)
        || clearance < 0.
        || !same_kernel(k, carrier)
        || !identity_frame(box_motion)
        || !identity_frame(cap_motion)
        || !identity_rotation(rotation)
        || !identity_rotation(k.native.motion.start.rotation)
        || !identity_rotation(k.native.motion.end.rotation)
        || k.native.angular_velocity != rp::Vector::ZERO
        || !relative.is_finite()
        || !anchor.is_finite()
        || !offset.is_finite()
        || !box_shape.half_extents.is_finite()
        || box_shape.half_extents.min_element() <= 0.
        || !cap_shape.segment.a.is_finite()
        || !cap_shape.segment.b.is_finite()
        || !cap_shape.radius.is_finite()
        || cap_shape.radius < 0.
        || start < k.domain.start
        || end > k.domain.end
    {
        return Ok(Certificate::unknown());
    }
    Kernel::from_native(k.native, k.domain)?;
    // Anchored still evaluates ZERO * (logical_dt as F32). Do not silently
    // replace its original 0*Inf/NaN branch with the scalar zero identity.
    let logical_end = (end - k.domain.start).clamp(0., k.domain.duration()) as f32;
    if !logical_end.is_finite() {
        return Ok(Certificate::unknown());
    }
    let has_relative = relative != rp::Vector::ZERO;
    let products = if has_relative {
        work.charge(RELATIVE_WORK)?;
        let logical_start = (start - k.domain.start).clamp(0., k.domain.duration()) as f32;
        let values = [relative * logical_start, relative * logical_end];
        if values.iter().any(|p| !p.is_finite()) {
            return Ok(Certificate::unknown());
        }
        // Original logical elapsed, F32 cast, and fixed-rate RN multiply are
        // monotone. These actual endpoint products enclose every time's
        // product, independently of the Native h/Domain translation mapping.
        values
    } else {
        [rp::Vector::ZERO; 2]
    };
    let expected_end =
        k.native.motion.start.translation + k.native.linear_velocity * k.native.integration_seconds;
    if expected_end.to_array().map(f32::to_bits)
        != k.native.motion.end.translation.to_array().map(f32::to_bits)
    {
        return Ok(Certificate::unknown());
    }
    let first_pose = k.position_at_time(start);
    let last_pose = k.position_at_time(end);
    // A cardinal projection cannot hide a nonfinite original point in a
    // different coordinate. Check both full radius representations over the
    // whole common monotone translation range, not only the separating axis.
    work.charge(VECTOR_WORK)?;
    for i in 0..3 {
        let point_min = cap_shape.segment.a[i].min(cap_shape.segment.b[i]);
        let point_max = cap_shape.segment.a[i].max(cap_shape.segment.b[i]);
        let local_min = point_min - cap_shape.radius;
        let local_max = point_max + cap_shape.radius;
        if !local_min.is_finite() || !local_max.is_finite() {
            return Ok(Certificate::unknown());
        }
        for t in [first_pose.translation[i], last_pose.translation[i]] {
            let base_com = (t + anchor[i]) + offset[i];
            if !base_com.is_finite()
                || !(t - box_shape.half_extents[i]).is_finite()
                || !(t + box_shape.half_extents[i]).is_finite()
            {
                return Ok(Certificate::unknown());
            }
            // Independent T/product extrema are conservative even when the
            // actual carrier and relative term move in opposite directions.
            for product in products.iter().take(if has_relative { 2 } else { 1 }) {
                let com = if has_relative {
                    base_com + product[i]
                } else {
                    base_com
                };
                if !com.is_finite()
                    || !(com + local_min).is_finite()
                    || !(com + local_max).is_finite()
                {
                    return Ok(Certificate::unknown());
                }
                let world_min = Bound::exact(f64::from(com + point_min))
                    .sub(Bound::exact(f64::from(cap_shape.radius)));
                let world_max = Bound::exact(f64::from(com + point_max))
                    .add(Bound::exact(f64::from(cap_shape.radius)));
                if !world_min.finite()
                    || !world_max.finite()
                    || world_min.lo < -f64::from(f32::MAX)
                    || world_max.hi > f64::from(f32::MAX)
                {
                    return Ok(Certificate::unknown());
                }
            }
        }
    }
    let sign = n[axis];
    // Zero angular velocity plus exact qI preserves the original scalar
    // rotation on every stored/interior branch. Native dt mapping is monotone;
    // correct stored endpoint translations make these actual extrema valid.
    let first = first_pose.translation[axis] * sign;
    let last = last_pose.translation[axis] * sign;
    if !first.is_finite() || !last.is_finite() {
        return Ok(Certificate::unknown());
    }
    let cell = Cell {
        low: ordered(first).min(ordered(last)),
        high: ordered(first).max(ordered(last)),
        depth: 0,
    };
    let plane = Plane {
        anchor: anchor[axis] * sign,
        offset: offset[axis] * sign,
        product: (products[0][axis] * sign).min(products[1][axis] * sign),
        point: (cap_shape.segment.a[axis] * sign).min(cap_shape.segment.b[axis] * sign),
        radius: cap_shape.radius,
        half: box_shape.half_extents[axis],
        clearance,
    };
    let t_result = prove_union(cell, plane, Input::Translation, work)?;
    if matches!(t_result, Attempt::Clear) {
        return Ok(Certificate::clear());
    }
    if let Attempt::Candidate(key) = t_result {
        if want_probe {
            if let Some(probe) = time_probe(
                k,
                Input::Translation,
                axis,
                sign,
                start,
                end,
                first,
                last,
                key,
                work,
            )? {
                return Ok(Certificate {
                    separated: false,
                    probe: Some(probe),
                });
            }
        }
        // This lower counter occurs at an already observed actual endpoint.
        // The same P graph contains it, so cannot prove this full lower clear.
        if key == ordered(first) || key == ordered(last) {
            return Ok(Certificate::unknown());
        }
    }
    work.charge(256)?; // actual Native displacement image / source metadata
    let input = Input::Displacement {
        origin: k.native.motion.start.translation[axis] * sign,
    };
    let first_p = input.at(k, axis, sign, start);
    let last_p = input.at(k, axis, sign, end);
    if !first_p.is_finite() || !last_p.is_finite() {
        return Ok(Certificate::unknown());
    }
    let p_cell = Cell {
        low: ordered(first_p).min(ordered(last_p)),
        high: ordered(first_p).max(ordered(last_p)),
        depth: 0,
    };
    match prove_union(p_cell, plane, input, work)? {
        Attempt::Clear => Ok(Certificate::clear()),
        Attempt::Candidate(key) if want_probe => Ok(Certificate {
            separated: false,
            probe: time_probe(k, input, axis, sign, start, end, first_p, last_p, key, work)?,
        }),
        Attempt::Unavailable => Ok(
            if affine_lower(cell, plane, work)?
                .is_some_and(|lower| lower.into_iter().all(|v| v > f64::from(clearance)))
            {
                Certificate::clear()
            } else {
                Certificate::unknown()
            },
        ),
        _ => Ok(Certificate::unknown()),
    }
}
fn prove_union(
    cell: Cell,
    plane: Plane,
    input: Input,
    work: &mut Work,
) -> Result<Attempt, TrajectoryError> {
    // Preserve every old successful result/price before the optional cell union.
    match input_cell_proof(cell, plane, input, work)? {
        Attempt::Clear => return Ok(Attempt::Clear),
        Attempt::Candidate(key) => return Ok(Attempt::Candidate(key)),
        Attempt::Unavailable => {
            return if independent_clear(cell, plane, input, work)? {
                Ok(Attempt::Clear)
            } else {
                Ok(Attempt::Unavailable)
            };
        }
        Attempt::Split => {}
    }
    if independent_clear(cell, plane, input, work)? {
        return Ok(Attempt::Clear);
    }
    // DFS over finite ordered-u32 input keys. Every split halves a nonempty
    // range, so depth<=32 and pending right siblings require <=33 slots.
    work.charge(128 + std::mem::size_of::<[Cell; 33]>() as u64)?;
    let mut stack = [cell; 33];
    let mut len = 0;
    if !push_children(cell, &mut stack, &mut len) {
        return Ok(Attempt::Unavailable);
    }
    while len != 0 {
        len -= 1;
        let cell = stack[len];
        work.charge(64)?; // actual cell metadata/proof visit, before work
        match input_cell_proof(cell, plane, input, work)? {
            Attempt::Clear => {}
            Attempt::Candidate(key) => return Ok(Attempt::Candidate(key)),
            Attempt::Unavailable => {
                if !independent_clear(cell, plane, input, work)? {
                    return Ok(Attempt::Unavailable);
                }
            }
            Attempt::Split => {
                if !independent_clear(cell, plane, input, work)?
                    && !push_children(cell, &mut stack, &mut len)
                {
                    return Ok(Attempt::Unavailable);
                }
            }
        }
    }
    Ok(Attempt::Clear)
}

#[cfg(test)]
mod tests;
