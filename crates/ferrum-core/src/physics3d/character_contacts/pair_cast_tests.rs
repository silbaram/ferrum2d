//! The contact-resolution pair cast (start gap above `skin * 1.01`,
//! `target_distance = skin`, no stop at penetration) does not tunnel: against
//! the exact swept capsule distance it never misses a real crossing, and a
//! late impact time overlaps only by GJK tolerance. The crowd avoidance cast
//! (zero margin, stop at penetration) did miss real crossings; see
//! character_crowd/swept_distance_tests.rs.
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
}
fn v3(v: rp::Vector) -> [f64; 3] {
    v.to_array().map(f64::from)
}
fn ends(c: &rp::Capsule, p: &rp::Pose) -> ([f64; 3], [f64; 3]) {
    (v3(*p * c.segment.a), v3(*p * c.segment.b))
}

#[test]
fn contact_resolution_pair_cast_never_tunnels() {
    // (start separation range, per-axis velocity range, seed)
    for (reach, sweep, seed) in [
        (0.15, 0.12, 0x1111_2222_3333_4444u64), // crowd-scale steps
        (0.5, 0.5, 0x5555_6666_7777_8888),
        (1.2, 1.5, 0x9999_AAAA_BBBB_CCCC), // a tick longer than the capsules
    ] {
        let mut rng = Rng(seed);
        let (mut hits, mut misses) = (0, 0);
        for case in 0..30_000 {
            let origin = [0.0, 100.0, -37.5][case % 3];
            let capsule = |rng: &mut Rng| {
                if rng.unit() < 0.5 {
                    rp::Capsule::new_y(0.5, 0.25)
                } else {
                    rp::Capsule::new_y(rng.range(0.0, 0.8) as f32, rng.range(0.05, 0.4) as f32)
                }
            };
            let (a, b) = (capsule(&mut rng), capsule(&mut rng));
            let rotation = |rng: &mut Rng| {
                if rng.unit() < 0.7 {
                    rp::Rotation::IDENTITY
                } else {
                    rp::Rotation::from_scaled_axis(rp::Vector::new(
                        rng.range(-3.0, 3.0) as f32,
                        rng.range(-3.0, 3.0) as f32,
                        rng.range(-3.0, 3.0) as f32,
                    ))
                }
            };
            let ap = rp::Pose::from_parts(
                rp::Vector::new(
                    (origin + rng.range(-1.0, 1.0)) as f32,
                    rng.range(0.0, 1.0) as f32,
                    rng.range(-1.0, 1.0) as f32,
                ),
                rotation(&mut rng),
            );
            let direction = rp::Vector::new(
                rng.range(-1.0, 1.0) as f32,
                rng.range(-0.3, 0.3) as f32,
                rng.range(-1.0, 1.0) as f32,
            )
            .try_normalize()
            .unwrap_or(rp::Vector::X);
            let distance = a.radius + b.radius + rng.range(0.0, reach) as f32;
            let bp =
                rp::Pose::from_parts(ap.translation + direction * distance, rotation(&mut rng));
            // Character skin widths are validated to [0.0001, 100].
            let skin = [0.01_f32, 0.0001, 0.001, 0.05][case % 4];
            let (a0, a1) = ends(&a, &ap);
            let (b0, b1) = ends(&b, &bp);
            let radii = f64::from(a.radius + b.radius);
            if segment_distance(a0, a1, b0, b1) - radii <= f64::from(skin) * 1.01 + 1e-5 {
                continue; // first_hit's contact check owns this start state.
            }
            let velocity = |rng: &mut Rng| {
                rp::Vector::new(
                    rng.range(-sweep, sweep) as f32,
                    rng.range(-0.1 * sweep, 0.1 * sweep) as f32,
                    rng.range(-sweep, sweep) as f32,
                )
            };
            let (va, vb) = (velocity(&mut rng), velocity(&mut rng));
            let relative = va - vb;
            let closest = swept_segment_distance(a0, a1, v3(relative), b0, b1) - radii;
            // Same argument order and options as MotionScene::cast_target.
            let cast = cast_shapes(
                &bp,
                vb,
                &b,
                &ap,
                va,
                &a,
                ShapeCastOptions {
                    max_time_of_impact: 1.,
                    target_distance: skin,
                    stop_at_penetration: false,
                    compute_impact_geometry_on_penetration: true,
                },
            )
            .unwrap();
            let skin = f64::from(skin);
            match cast {
                None => {
                    if closest < skin - 1e-4 {
                        // Only a tolerance-level near miss, never a crossing.
                        assert!(
                            closest > 0.0 && skin - closest < 2e-3,
                            "case {case}: missed crossing, closest {closest} skin {skin}"
                        );
                        misses += 1;
                    }
                }
                Some(hit) => {
                    hits += 1;
                    let t = hit.time_of_impact;
                    let before = swept_segment_distance(a0, a1, v3(relative * t), b0, b1) - radii;
                    assert!(
                        before > -0.01,
                        "case {case}: impact at {t} after overlap {before}"
                    );
                }
            }
        }
        assert!(hits > 2000, "hits {hits}");
        assert!(misses * 1000 < hits, "near misses {misses} of {hits}");
    }
}
