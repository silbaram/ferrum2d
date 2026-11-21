//! Project only after proving the actual F32 coordinate graph is unchanged
//! on the complete portion of the box that can reach the stationary sphere.
use super::*;

fn invisible(base: Float, extra: Float) -> bool {
    if !base.finite() || !extra.finite() {
        return false;
    }
    if exact_value(extra, 0.) {
        return true;
    }
    super::super::super::minimum_half_cell(base)
        .is_some_and(|half| f64::from(extra.lo.abs().max(extra.hi.abs())) < half)
}

fn outside(frame: Frame, local: Translation, sphere: Translation, clearance: f32) -> bool {
    let world = frame.point_range(local);
    world.into_iter().zip(sphere).any(|(a, b)| {
        if !a.finite() || !b.finite() {
            return false;
        }
        let gap = Bound::exact(f64::from(b.lo))
            .sub(Bound::exact(f64::from(a.hi)))
            .lo
            .max(
                Bound::exact(f64::from(a.lo))
                    .sub(Bound::exact(f64::from(b.hi)))
                    .lo,
            );
        gap > f64::from(clearance)
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn reduce(
    frame: Frame,
    ball: Frame,
    half: rp::Vector,
    radius: f32,
    clearance: f32,
    face: usize,
    sign: f32,
    context: Context<'_>,
    work: &mut Work,
) -> Result<Option<(Frame, usize)>, TrajectoryError> {
    let mut q = frame.rotation.components;
    if q[..3].iter().filter(|&&x| !exact_value(x, 0.)).count() < 2 {
        return Ok(None);
    }
    work.charge(2048)?;
    let size = |i: usize| q[i].lo.abs().max(q[i].hi.abs());
    let pivot = (0..3)
        .max_by(|&a, &b| size(a).total_cmp(&size(b)))
        .unwrap_or(0);
    if pivot == face {
        return Ok(None);
    }
    let tangent = 3 - pivot - face;
    let sphere = std::array::from_fn(|i| {
        let world = world_radius_range(ball.translation[i], radius);
        let local = target_value(ball, None, i, Float::span(-radius, radius)).actual;
        Float::span(world.lo.min(local.lo), world.hi.max(local.hi))
    });
    let (cube, target) = if context.sa.as_cuboid().is_some() {
        (context.a, context.b)
    } else {
        (context.b, context.a)
    };
    let nominal = cube
        .pose(context.start)
        .inv_mul(&target.pose(context.start))
        .translation;
    let mut region = half.to_array().map(|h| Float::span(-h, h));
    let width = 2. * (radius + clearance);
    for (axis, cut) in [
        (
            tangent,
            (nominal[tangent] - width).clamp(-half[tangent], half[tangent]),
        ),
        (
            tangent,
            (nominal[tangent] + width).clamp(-half[tangent], half[tangent]),
        ),
        (face, sign * half[face] * 0.5),
    ] {
        if !cut.is_finite() || cut <= region[axis].lo || cut >= region[axis].hi {
            continue;
        }
        let mut removed = region;
        if (axis == face && sign > 0.) || (axis == tangent && cut < nominal[axis]) {
            removed[axis].hi = cut;
            if outside(frame, removed, sphere, clearance) {
                region[axis].lo = cut;
            }
        } else {
            removed[axis].lo = cut;
            if outside(frame, removed, sphere, clearance) {
                region[axis].hi = cut;
            }
        }
    }
    if !same_projected_coordinates(q, region, face, tangent, pivot) {
        return Ok(None);
    }
    q[face] = Float::ZERO;
    q[tangent] = Float::ZERO;
    Ok(Some((
        Frame {
            rotation: Quaternion {
                components: q,
                exact: None,
            },
            ..frame
        },
        pivot,
    )))
}

fn same_projected_coordinates(
    q: [Float; 4],
    region: Translation,
    face: usize,
    tangent: usize,
    pivot: usize,
) -> bool {
    let square = q[pivot].mul(q[pivot]);
    let small = q[face].mul(q[face]).add(q[tangent].mul(q[tangent]));
    if !invisible(square, small) {
        return false;
    }
    let scale = q[3].mul(q[3]).sub(square);
    let dot = region[0]
        .mul(q[0])
        .add(region[1].mul(q[1]))
        .add(region[2].mul(q[2]));
    let twice_dot = dot.mul(Float::exact(2.));
    // For each retained coordinate, the corrections to its direct and
    // cross products fall strictly inside the native rounding cell.
    for (i, j) in [(face, tangent), (tangent, face)] {
        if !invisible(region[i].mul(scale), q[i].mul(twice_dot))
            || !invisible(q[pivot].mul(region[j]), q[j].mul(region[pivot]))
        {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projected_face_preserves_native_coordinates_only_inside_proven_cells() {
        let q = [-1.2e-15, -2.5e-16, -0.0113, 0.999936];
        let cloud = [
            Float::span(1.94, 2.),
            Float::span(0.0125, 0.025),
            Float::span(-0.1, 0.1),
        ];
        assert!(same_projected_coordinates(
            q.map(Float::exact),
            cloud,
            1,
            0,
            2
        ));
        let original = rp::Rotation::from_array(q);
        let projected = rp::Rotation::from_xyzw(0., 0., q[2], q[3]);
        for x in [1.94, 1.99, 2.] {
            for y in [0.0125, 0.02, 0.025] {
                for z in [-0.1, 0., 0.1] {
                    let point = rp::Vector::new(x, y, z);
                    let native = original * point;
                    let reduced = projected * point;
                    assert_eq!(
                        [native.x.to_bits(), native.y.to_bits()],
                        [reduced.x.to_bits(), reduced.y.to_bits()]
                    );
                }
            }
        }
        let tilted = [0.001, q[1], q[2], q[3]];
        assert!(!same_projected_coordinates(
            tilted.map(Float::exact),
            cloud,
            1,
            0,
            2
        ));
        let nonplanar = rp::Rotation::from_array(tilted) * rp::Vector::new(1.99, 0.025, 0.1);
        assert_ne!(
            nonplanar.y,
            (projected * rp::Vector::new(1.99, 0.025, 0.1)).y
        );
    }
}
