//! Full separation along a box's rotation axis. The box and capsule use
//! their own integrated clocks and stored endpoints.
use super::*;

#[derive(Clone, Copy)]
struct Pair {
    box_kernel: Kernel,
    cap_kernel: Kernel,
    axis: usize,
    half: f32,
    core: f32,
    radius: f32,
}

fn pair(context: Context<'_>, normal: rp::Vector) -> Option<Pair> {
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = context;
    let (box_motion, cuboid, cap_motion, capsule, normal) =
        if let (Some(cuboid), Some(capsule)) = (sa.as_cuboid(), sb.as_capsule()) {
            (a, cuboid, b, capsule, normal)
        } else if let (Some(capsule), Some(cuboid)) = (sa.as_capsule(), sb.as_cuboid()) {
            (b, cuboid, a, capsule, -normal)
        } else {
            return None;
        };
    let (Curve::Integrated(box_kernel), Curve::Integrated(cap_kernel)) =
        (box_motion.curve, cap_motion.curve)
    else {
        return None;
    };
    let axis = (0..3).find(|&i| normal[i] > 0.)?;
    if !normal.is_finite()
        || (0..3).any(|i| i != axis && normal[i] != 0.)
        || !start.is_finite()
        || !end.is_finite()
        || start >= end
        || !clearance.is_finite()
        || clearance < 0.
        || [box_kernel, cap_kernel]
            .into_iter()
            .any(|k| start < k.domain.start || end > k.domain.end)
        || !local_identity(box_motion)
        || !local_identity(cap_motion)
        || box_kernel.native.angular_velocity[axis] == 0.
        || cap_kernel.native.angular_velocity != rp::Vector::ZERO
        || !qi(cap_kernel.native.motion.start.rotation)
        || !qi(cap_kernel.native.motion.end.rotation)
        || !cuboid.half_extents.is_finite()
        || cuboid.half_extents.min_element() <= 0.
        || !capsule.segment.a.is_finite()
        || !capsule.segment.b.is_finite()
        || !capsule.radius.is_finite()
        || capsule.radius <= 0.
    {
        return None;
    }

    Some(Pair {
        box_kernel,
        cap_kernel,
        axis,
        half: cuboid.half_extents[axis],
        core: capsule.segment.a[axis].min(capsule.segment.b[axis]),
        radius: capsule.radius,
    })
}

pub(super) fn prefix(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    let Some(Pair {
        box_kernel,
        cap_kernel,
        axis,
        half,
        core,
        radius,
    }) = pair(context, normal)
    else {
        return Ok(None);
    };
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = context;
    if start.is_sign_negative()
        || (0..3).any(|i| {
            i != axis
                && (box_kernel.native.angular_velocity[i] != 0.
                    || box_kernel.native.motion.start.rotation.to_array()[i] != 0.
                    || box_kernel.native.motion.end.rotation.to_array()[i] != 0.)
        })
    {
        return Ok(None);
    }
    let Some(center) = normal_cells::translation_range(cap_kernel, axis, start, end) else {
        return Ok(None);
    };
    if center.lo != center.hi {
        return Ok(None);
    }
    work.charge(768)?;
    for k in [box_kernel, cap_kernel] {
        Kernel::from_native(k.native, k.domain)?;
    }
    let prefix = normal_cells::independent_fixed_center_prefix(
        box_kernel, axis, half, center.lo, core, radius, clearance, start, end, work,
    )?;
    if let Some(until) = prefix {
        for (motion, shape) in [(a, sa), (b, sb)] {
            motion.bounds(shape, start, until, work)?;
        }
    }
    Ok(prefix)
}

pub(super) fn separated(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Some(Pair {
        box_kernel,
        cap_kernel,
        axis,
        half,
        core,
        radius,
    }) = pair(context, normal)
    else {
        return Ok(false);
    };
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = context;
    work.charge(768)?;
    for k in [box_kernel, cap_kernel] {
        Kernel::from_native(k.native, k.domain)?;
    }
    let Some(translation) = normal_cells::translation_range(box_kernel, axis, start, end) else {
        return Ok(false);
    };
    let Some(action) = normalized_action::action_bounds(box_kernel, axis, start, end, half, work)?
    else {
        return Ok(false);
    };
    let face = represented_upper(action);
    let mut signed_phases = None;
    let box_action = if normal_cells::positive_scale(box_kernel, axis, start, end) {
        face
    } else {
        let Some(phases) = frames(Curve::Integrated(box_kernel), start, end, work)? else {
            return Ok(false);
        };
        let mut lift = 0_f64;
        for frame in &phases.values[..phases.len] {
            work.charge(512)?;
            let q = frame.rotation.components;
            let axial = q[axis];
            let scalar = q[3];
            let scale = scalar.mul(scalar).sub(axial.mul(axial));
            if scale.lo < 0. {
                let Some(limit) = normalized_action::signed_face_lift(half, axial, scale) else {
                    return Ok(false);
                };
                lift = lift.max(limit);
            }
        }
        let Some(upper) = normalized_action::signed_face_ceiling(face, lift) else {
            return Ok(false);
        };
        signed_phases = Some(phases);
        upper
    };
    // With zero angular velocity and the stored identity rotations, these
    // are the original COM images at dt=0, interior dt, and dt=h.
    let Some(frames) = kernel(cap_kernel, start, end, work)? else {
        return Ok(false);
    };
    let center = frames.values[..frames.len]
        .iter()
        .map(|frame| frame.translation[axis].lo)
        .fold(f32::INFINITY, f32::min);
    let separates = |top| {
        capsule_clears(
            top + translation.hi,
            center,
            core,
            core - radius,
            radius,
            clearance,
        )
    };
    if !separates(box_action) {
        let Some(phases) = signed_phases else {
            return Ok(false);
        };
        let mut positions = 1_u32;
        for frame in &phases.values[..phases.len] {
            let q = frame.rotation.components;
            let axial = q[axis];
            let scalar = q[3];
            let scale = scalar.mul(scalar).sub(axial.mul(axial));
            if scale.lo < 0. {
                let Some(mask) = normalized_action::signed_face_mask(half, axial, scale, work)?
                else {
                    return Ok(false);
                };
                positions |= mask;
            }
        }
        // Check the independent maximum of every possible face-adjacent
        // point. This avoids adding the largest rounding lift to a face
        // output that cannot attain it.
        while positions != 0 {
            let index = positions.trailing_zeros();
            positions &= positions - 1;
            let upper = if index == 0 {
                face
            } else {
                let point = f32::from_bits(half.to_bits() - index);
                let Some([_, upper]) =
                    normal_action_range(box_kernel, axis, start, end, point, work)?
                else {
                    return Ok(false);
                };
                upper
            };
            if !separates(upper) {
                return Ok(false);
            }
        }
    }
    // Preserve the existing bounds validation for all unprojected components.
    for (motion, shape) in [(a, sa), (b, sb)] {
        motion.bounds(shape, start, end, work)?;
    }
    Ok(true)
}
