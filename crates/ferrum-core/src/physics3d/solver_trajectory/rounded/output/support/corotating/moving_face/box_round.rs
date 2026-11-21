use super::*;

fn tighten_singleton(mut value: Value) -> Value {
    if singleton(value.actual) && value.actual.finite() && value.ideal.finite() {
        let difference = Bound::exact(f64::from(value.actual.lo)).sub(value.ideal);
        value.error = value.error.min(magnitude(difference).next_up());
    }
    value
}

fn paired_add_rounding(translation: Float, local: Float, r: f32) -> Option<f64> {
    if !(r * 0.5).is_normal()
        || r <= 0.
        || r.to_bits() & 0x7f_ffff != 0
        || !translation.finite()
        || !local.finite()
    {
        return None;
    }

    let radius = f64::from(r);
    let translation = Bound {
        lo: f64::from(translation.lo),
        hi: f64::from(translation.hi),
    };
    let local = Bound {
        lo: f64::from(local.lo),
        hi: f64::from(local.hi),
    };
    if translation.lo < 2. * radius
        || translation.hi >= 4. * radius
        || local.lo <= -2. * radius
        || local.hi > 0.
    {
        return None;
    }
    let sum = translation.add(local);
    if sum.lo < radius || sum.hi >= 2. * radius {
        return None;
    }

    let spacing = f64::from(r.next_up()) - radius;
    // For u <= -r, u and T lie on the g grid, so T + u is exact in
    // [r, 2r) and producing u costs at most g/2. For u > -r, producing
    // u costs at most g/4 and the world addition costs at most g/2.
    Some(0.75 * spacing)
}

pub(super) fn transformed_box(
    q: [Value; 4],
    t: [Value; 3],
    v: [Value; 3],
    axis: usize,
    r: f32,
) -> [Value; 3] {
    // Preserve the original scalar Quat::mul_vec3 association.
    let q = q.map(tighten_singleton);
    let two = Value::input(Float::exact(2.));
    let b2 = tighten_singleton(q[0].mul(q[0]).add(q[1].mul(q[1])).add(q[2].mul(q[2])));
    let scale = tighten_singleton(q[3].mul(q[3]).sub(b2));
    let dot = v[0].mul(q[0]).add(v[1].mul(q[1])).add(v[2].mul(q[2]));
    let twice_dot = tighten_singleton(dot.mul(two));
    let twice_scalar = tighten_singleton(q[3].mul(two));
    let cross = [
        q[1].mul(v[2]).sub(v[1].mul(q[2])),
        q[2].mul(v[0]).sub(v[2].mul(q[0])),
        q[0].mul(v[1]).sub(v[0].mul(q[1])),
    ]
    .map(tighten_singleton);
    std::array::from_fn(|i| {
        let left = tighten_singleton(v[i].mul(scale).add(q[i].mul(twice_dot)));
        let right = tighten_singleton(cross[i].mul(twice_scalar));
        let local = left.add(right);
        let mut world = local.add(t[i]);
        if i == axis {
            if let Some(rounding) = paired_add_rounding(t[i].actual, local.actual, r) {
                let upstream = upper_add(upper_add(left.error, right.error), t[i].error);
                world.error = world.error.min(upper_add(upstream, rounding));
            }
        }
        tighten_singleton(world)
    })
}
