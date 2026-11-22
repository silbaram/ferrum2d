//! The analytic swept capsule check matches dense brute-force sampling, and it
//! agrees with Parry's shape cast except where that cast misses a real crossing.
use super::super::character_geometry::{segment_distance, swept_segment_distance};
use rapier3d::parry::query::{cast_shapes, ShapeCastOptions};
use rapier3d::prelude as rp;

struct Rng(u64);
impl Rng {
    fn unit(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
    fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.unit()
    }
    fn vector(&mut self, r: f64) -> [f64; 3] {
        [self.range(-r, r), self.range(-r, r), self.range(-r, r)]
    }
}
fn add(a: [f64; 3], b: [f64; 3], s: f64) -> [f64; 3] {
    [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
}
fn point(pose: &rp::Pose, p: rp::Vector) -> [f64; 3] {
    (*pose * p).to_array().map(f64::from)
}
fn capsule_gap(a: &rp::Capsule, at: &rp::Pose, b: &rp::Capsule, bt: &rp::Pose) -> f64 {
    segment_distance(
        point(at, a.segment.a),
        point(at, a.segment.b),
        point(bt, b.segment.a),
        point(bt, b.segment.b),
    ) - f64::from(a.radius + b.radius)
}

#[test]
fn swept_segment_distance_matches_dense_sampling() {
    let mut rng = Rng(0xA11C_E5EE_D000_0001);
    for case in 0..4000 {
        let a0 = rng.vector(1.0);
        let a1 = if case % 5 == 0 {
            a0
        } else {
            add(a0, rng.vector(0.6), 1.0)
        };
        let sweep = if case % 7 == 0 {
            [0.0; 3]
        } else {
            rng.vector(1.5)
        };
        let b0 = rng.vector(1.0);
        let b1 = if case % 9 == 0 {
            b0
        } else {
            add(b0, rng.vector(0.6), 1.0)
        };
        let exact = swept_segment_distance(a0, a1, sweep, b0, b1);
        let mut sampled = f64::INFINITY;
        for k in 0..=400 {
            let tau = k as f64 / 400.0;
            sampled = sampled.min(segment_distance(
                add(a0, sweep, tau),
                add(a1, sweep, tau),
                b0,
                b1,
            ));
        }
        // Sampling only overestimates; its gap is bounded by the sweep step.
        let step = sweep.iter().map(|v| v * v).sum::<f64>().sqrt() / 400.0;
        assert!(exact <= sampled + 1e-12, "case {case}: {exact} > {sampled}");
        assert!(
            sampled - exact <= step + 1e-9,
            "case {case}: {exact} vs {sampled}"
        );
    }
}

#[test]
fn swept_capsule_decision_matches_sampling_and_only_fixes_cast_misses() {
    let mut rng = Rng(0xC0FF_EE00_1234_5678);
    let (mut hits, mut misses, mut cast_misses) = (0, 0, 0);
    for case in 0..20_000 {
        let origin = if case % 2 == 0 { 0.0 } else { 100.0 };
        let capsule = |rng: &mut Rng| {
            rp::Capsule::new_y(rng.range(0.0, 0.8) as f32, rng.range(0.05, 0.4) as f32)
        };
        let (a, b) = (capsule(&mut rng), capsule(&mut rng));
        let rotation = |rng: &mut Rng| {
            if rng.unit() < 0.6 {
                rp::Rotation::IDENTITY
            } else {
                let v = rng.vector(3.0);
                rp::Rotation::from_scaled_axis(rp::Vector::new(
                    v[0] as f32,
                    v[1] as f32,
                    v[2] as f32,
                ))
            }
        };
        let at = rp::Pose::from_parts(
            rp::Vector::new(
                (origin + rng.range(-1.0, 1.0)) as f32,
                rng.range(0.0, 1.0) as f32,
                rng.range(-1.0, 1.0) as f32,
            ),
            rotation(&mut rng),
        );
        let offset = rng.vector(1.6);
        let bt = rp::Pose::from_parts(
            at.translation
                + rp::Vector::new(offset[0] as f32, offset[1] as f32 * 0.3, offset[2] as f32),
            rotation(&mut rng),
        );
        let r = rng.vector(1.2);
        let relative = rp::Vector::new(r[0] as f32, r[1] as f32 * 0.2, r[2] as f32);
        let margin = [0.0_f32, 0.01, 0.1][case % 3];
        if capsule_gap(&a, &at, &b, &bt) <= f64::from(margin) + 1e-3 {
            continue; // The production path handles initial proximity first.
        }
        let distance = swept_segment_distance(
            point(&at, a.segment.a),
            point(&at, a.segment.b),
            relative.to_array().map(f64::from),
            point(&bt, b.segment.a),
            point(&bt, b.segment.b),
        ) - f64::from(a.radius)
            - f64::from(b.radius);
        // Ground truth: dense sampling of the actual capsule gap over the sweep.
        let mut sampled = f64::INFINITY;
        for k in 0..=2000 {
            let moved = rp::Pose::from_translation(relative * (k as f32 / 2000.0)) * at;
            sampled = sampled.min(capsule_gap(&a, &moved, &b, &bt));
        }
        let step = f64::from(relative.length()) / 2000.0;
        assert!(
            distance <= sampled + 1e-4 && sampled - distance <= step + 1e-4,
            "case {case}: analytic {distance} sampled {sampled}"
        );
        if (distance - f64::from(margin)).abs() < 1e-3 {
            continue; // Threshold ties may legitimately differ from GJK tolerance.
        }
        let analytic = distance <= f64::from(margin);
        let cast = cast_shapes(
            &at,
            relative,
            &a,
            &bt,
            rp::Vector::ZERO,
            &b,
            ShapeCastOptions {
                max_time_of_impact: 1.,
                target_distance: margin,
                stop_at_penetration: true,
                compute_impact_geometry_on_penetration: true,
            },
        )
        .unwrap()
        .is_some_and(|hit| hit.time_of_impact < 1.);
        if analytic != cast {
            // The only allowed disagreement: Parry misses a sampled crossing.
            assert!(
                analytic && sampled < f64::from(margin),
                "case {case}: cast-only hit, analytic {distance} sampled {sampled}"
            );
            cast_misses += 1;
        }
        if analytic {
            hits += 1;
        } else {
            misses += 1;
        }
    }
    assert!(hits > 1000 && misses > 1000, "hits {hits} misses {misses}");
    assert!(
        cast_misses * 100 < hits,
        "Parry cast misses {cast_misses} of {hits}"
    );
    eprintln!("swept capsule: hits {hits} misses {misses} parry cast misses {cast_misses}");
}
