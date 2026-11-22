//! The exact capsule/cuboid face contact agrees with dense sampling. Against
//! Parry's general contact query, the only disagreement is Parry's GJK
//! reporting a large-floor contact beyond the prediction distance: its lower
//! bound stays loose when a far box corner dominates a slightly tilted support
//! direction, and its stagnation exit returns the witnesses unchecked.
use super::super::character_geometry::{capsule_box_face_contact, target_normal};
use rapier3d::parry::query::contact;
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
    fn f(&mut self, lo: f64, hi: f64) -> f32 {
        self.range(lo, hi) as f32
    }
}

/// Distance from the capsule to the box by dense axis sampling, in f64 box space.
fn sampled_gap(half: rp::Vector, capsule: &rp::Capsule, relative: &rp::Pose) -> f64 {
    let local = |p: rp::Vector| (*relative * p).to_array().map(f64::from);
    let (a, b) = (local(capsule.segment.a), local(capsule.segment.b));
    let half = half.to_array().map(f64::from);
    let mut best = f64::INFINITY;
    for k in 0..=2000 {
        let s = k as f64 / 2000.0;
        let mut outside = 0.0;
        let mut inside = f64::INFINITY;
        for i in 0..3 {
            let c = a[i] + (b[i] - a[i]) * s;
            let excess = c.abs() - half[i];
            outside += excess.max(0.0).powi(2);
            inside = inside.min(-excess);
        }
        let distance = if outside > 0.0 {
            outside.sqrt()
        } else {
            -inside
        };
        best = best.min(distance);
    }
    best - f64::from(capsule.radius)
}

#[test]
fn capsule_box_face_contact_matches_sampling_and_parry() {
    let mut rng = Rng(0xF1_00_D5_EE_D0_00_00_02);
    let (mut exact, mut certain_miss, mut general, mut beyond) = (0, 0, 0, 0);
    let mut worst_floor_error = 0.0_f32;
    let mut unsnapped = 0;
    for case in 0..40_000 {
        let floor = case % 4 == 0;
        let half = match case % 4 {
            0 => rp::Vector::new(30.0, 0.5, 20.0), // crowd floor
            1 => rp::Vector::new(rng.f(0.3, 3.0), rng.f(0.01, 0.2), rng.f(0.3, 3.0)),
            _ => rp::Vector::new(rng.f(0.05, 2.0), rng.f(0.05, 2.0), rng.f(0.05, 2.0)),
        };
        let cuboid = rp::Cuboid::new(half);
        let capsule = if rng.unit() < 0.5 {
            rp::Capsule::new_y(0.5, 0.25)
        } else {
            rp::Capsule::new_y(rng.f(0.0, 0.8), rng.f(0.05, 0.4))
        };
        let rotation = |rng: &mut Rng, p: f64| {
            if rng.unit() < p {
                rp::Rotation::IDENTITY
            } else {
                rp::Rotation::from_scaled_axis(rp::Vector::new(
                    rng.f(-3.0, 3.0),
                    rng.f(-3.0, 3.0),
                    rng.f(-3.0, 3.0),
                ))
            }
        };
        let origin = [0.0, 100.0, -37.5][case % 3];
        let box_pose = rp::Pose::from_parts(
            rp::Vector::new(
                origin + rng.f(-2.0, 2.0),
                rng.f(-1.0, 1.0),
                rng.f(-2.0, 2.0),
            ),
            rotation(&mut rng, 0.7),
        );
        let prediction = [0.0101_f32, 0.00101, 0.0505][case % 3];
        // Place the capsule against a random face: often near the prediction
        // threshold, sometimes penetrating or outside the face footprint.
        let axis = if rng.unit() < 0.6 { 1 } else { (case / 4) % 3 };
        let sign = if rng.unit() < 0.8 { 1.0 } else { -1.0 };
        let local_rotation = rotation(&mut rng, 0.75);
        let reach = {
            let a = local_rotation * capsule.segment.a;
            let b = local_rotation * capsule.segment.b;
            a[axis].abs().max(b[axis].abs()) + capsule.radius
        };
        let offset = if rng.unit() < 0.5 {
            rng.f(0.0, 1.5 * f64::from(prediction))
        } else {
            rng.f(-0.03, 0.12)
        };
        let spread = if rng.unit() < 0.5 { 0.8 } else { 1.3 };
        let mut centre = rp::Vector::ZERO;
        for i in 0..3 {
            centre[i] = if i == axis {
                sign * (half[i] + reach + offset)
            } else {
                half[i] * rng.f(-spread, spread)
            };
        }
        let relative = rp::Pose::from_parts(centre, local_rotation);
        let capsule_pose = box_pose * relative;

        let fast =
            capsule_box_face_contact(&cuboid, &box_pose, &capsule, &capsule_pose, prediction);
        let parry = contact(&box_pose, &cuboid, &capsule_pose, &capsule, prediction).unwrap();
        let Some(fast) = fast else {
            general += 1;
            continue;
        };
        let truth = sampled_gap(half, &capsule, &box_pose.inv_mul(&capsule_pose));
        let scale = 1e-5 * (1.0 + f64::from(box_pose.translation.length()));
        let near_threshold = (truth - f64::from(prediction)).abs() <= scale;
        match fast {
            None => {
                certain_miss += 1;
                assert!(
                    truth > f64::from(prediction) - scale,
                    "case {case}: certain miss at {truth}"
                );
                if parry.is_some() && !near_threshold {
                    assert!(
                        floor,
                        "case {case}: beyond-prediction contact off the floor"
                    );
                    beyond += 1;
                }
            }
            Some(c) => {
                exact += 1;
                assert!(
                    (f64::from(c.dist) - truth).abs() <= scale && c.dist > 0.0,
                    "case {case}: dist {} truth {truth}",
                    c.dist
                );
                // Witnesses: the box point is on the face, the capsule point is `dist` away.
                let local = box_pose.inverse_transform_point(c.point1);
                assert!(
                    (local[axis].abs() - half[axis]).abs() <= 1e-4,
                    "case {case}"
                );
                assert!(
                    ((c.point2 - c.point1).length() - c.dist).abs() <= 1e-4,
                    "case {case}"
                );
                let Some(general) = parry else {
                    assert!(near_threshold, "case {case}: parry missed {c:?}");
                    continue;
                };
                // GJK reports upper-bound witnesses; only on the large floor
                // does its loose convergence leave millimetres.
                let error = general.dist - c.dist;
                assert!(
                    error >= -1e-4 && (floor || error <= 1e-3),
                    "case {case}: parry {general:?} exact {c:?}"
                );
                worst_floor_error = worst_floor_error.max(error);
                // Callers snap witnesses inside a face to that face's normal. A
                // thin box's snapping tolerance can leave GJK's noisy normal.
                let collider = rp::ColliderBuilder::new(rp::SharedShape::new(cuboid)).build();
                let snapped = target_normal(&collider, &box_pose, general.point1, general.normal1);
                if snapped != c.normal1 {
                    assert!(
                        !floor && snapped.dot(c.normal1) > 1.0 - 1e-5,
                        "case {case}: normals {snapped:?} {:?}",
                        c.normal1
                    );
                    unsnapped += 1;
                }
            }
        }
    }
    assert!(
        exact > 5000 && certain_miss > 3000 && general > 8000,
        "exact {exact} certain miss {certain_miss} general {general}"
    );
    assert!(beyond * 50 < certain_miss, "beyond-prediction {beyond}");
    eprintln!(
        "box face: exact {exact} miss {certain_miss} general {general}; parry beyond \
         prediction {beyond}, floor distance error {worst_floor_error}, unsnapped {unsnapped}"
    );
}
