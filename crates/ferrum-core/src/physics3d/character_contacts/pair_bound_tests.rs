//! The character-pair pruning bound is conservative against the real queries:
//! whenever it prunes, the full evaluation reports no contact and no cast hit
//! before the bound. A violated case would change which hit `first_hit` picks.
use super::*;
use rapier3d::parry::query::{cast_shapes, ShapeCastOptions};

struct Rng(u64);
impl Rng {
    fn unit(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }
    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.unit()
    }
}

#[test]
fn capsule_pair_bound_never_prunes_a_contact_or_an_earlier_cast_hit() {
    let mut rng = Rng(0x5EED_CAFE_F00D_1234);
    let (mut pruned, mut checked) = (0, 0);
    for case in 0..60_000 {
        let origin = if case % 2 == 0 { 0.0 } else { 100.0 };
        let shape = |rng: &mut Rng| rp::Capsule::new_y(rng.range(0.0, 1.0), rng.range(0.05, 0.5));
        let (a, b) = (shape(&mut rng), shape(&mut rng));
        // Mostly upright crowd capsules, sometimes arbitrary rotations.
        let rotation = |rng: &mut Rng| {
            if rng.unit() < 0.7 {
                rp::Rotation::IDENTITY
            } else {
                rp::Rotation::from_scaled_axis(rp::Vector::new(
                    rng.range(-3.0, 3.0),
                    rng.range(-3.0, 3.0),
                    rng.range(-3.0, 3.0),
                ))
            }
        };
        let a_pose = rp::Pose::from_parts(
            rp::Vector::new(
                origin + rng.range(-1.0, 1.0),
                rng.range(0.0, 1.0),
                rng.range(-1.0, 1.0),
            ),
            rotation(&mut rng),
        );
        // Place the second capsule near the contact threshold most of the time.
        let direction = rp::Vector::new(
            rng.range(-1.0, 1.0),
            rng.range(-0.3, 0.3),
            rng.range(-1.0, 1.0),
        )
        .try_normalize()
        .unwrap_or(rp::Vector::X);
        let reach = a.radius + b.radius + rng.range(-0.02, 0.25);
        let b_pose =
            rp::Pose::from_parts(a_pose.translation + direction * reach, rotation(&mut rng));
        let skin = [0.0, 0.001, 0.01, 0.05][case % 4];
        let margin = skin * 1.01;
        let velocity = |rng: &mut Rng| {
            if rng.unit() < 0.1 {
                rp::Vector::ZERO
            } else {
                rp::Vector::new(
                    rng.range(-0.3, 0.3),
                    rng.range(-0.05, 0.05),
                    rng.range(-0.3, 0.3),
                )
            }
        };
        let (va, vb) = (velocity(&mut rng), velocity(&mut rng));
        let time = f64::from(rng.range(0.0, 0.95));
        let Some(lower) =
            capsule_pair_hit_lower_bound(&a, &a_pose, va, &b, &b_pose, vb, margin, time)
        else {
            continue;
        };
        pruned += 1;
        let ca = rp::ColliderBuilder::new(rp::SharedShape::new(a)).build();
        let cb = rp::ColliderBuilder::new(rp::SharedShape::new(b)).build();
        assert!(
            super::super::character_geometry::contact(&cb, &b_pose, &ca, &a_pose, margin).is_none(),
            "case {case}: pruned pair reports a contact"
        );
        let remaining = 1.0 - time;
        let hit = cast_shapes(
            &b_pose,
            vb * remaining as f32,
            &b,
            &a_pose,
            va * remaining as f32,
            &a,
            ShapeCastOptions {
                max_time_of_impact: 1.,
                target_distance: skin,
                stop_at_penetration: false,
                compute_impact_geometry_on_penetration: true,
            },
        )
        .unwrap();
        if let Some(hit) = hit {
            checked += 1;
            let t = time + remaining * f64::from(hit.time_of_impact);
            assert!(t >= lower, "case {case}: cast hit {t} before bound {lower}");
        }
    }
    // The sample must exercise both pruned misses and pruned later hits.
    assert!(
        pruned > 20_000 && checked > 1_000,
        "pruned {pruned}, later hits {checked}"
    );
}
