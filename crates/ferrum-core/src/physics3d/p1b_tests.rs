//! Rust-only platform and capsule experiment, with shared per-tick observations.
use super::{colliders::native_collider, world::native_id};
use super::{
    BodyDesc, BodyId, BodyKind, CharacterConfig, CharacterInput, ColliderDesc, KinematicPath,
    PhysicsError, PhysicsWorld3d, Pose, Shape, WorldConfig,
};
use rapier3d::prelude as rp;
use std::collections::BTreeMap;
use std::time::Instant;

#[derive(Clone, Copy, Debug)]
pub(crate) enum Mode {
    Current,
    Kcc,
}

pub(crate) const MODES: [Mode; 2] = [Mode::Current, Mode::Kcc];

impl Mode {
    pub(crate) fn configure(self, world: &mut PhysicsWorld3d) {
        if matches!(self, Self::Kcc) {
            world.enable_experimental_character_kcc();
        }
        assert_eq!(
            world.backend_motion_enabled(),
            matches!(self, Self::Current)
        );
    }
}

#[derive(Clone, Copy)]
pub(crate) struct TickSample {
    error: Option<PhysicsError>,
    completed: f64,
    overlap: f32,
    time_us: Option<f64>,
}

impl PhysicsWorld3d {
    pub(crate) fn observe_p1b_ticks(&mut self) {
        self.character_motion.p1b_ticks = Some(Vec::new());
    }

    pub(crate) fn take_p1b_ticks(&mut self) -> Vec<TickSample> {
        self.character_motion.p1b_ticks.take().unwrap()
    }

    pub(crate) fn p1b_step_observed(
        &mut self,
        paths: &[KinematicPath],
    ) -> Result<(), PhysicsError> {
        if self.character_motion.p1b_ticks.is_none() {
            return self.step_with_kinematic_paths(paths);
        }
        // Path validation can return before the physics clock is reset for this attempt.
        self.character_motion.p1b_tick_started = false;
        let start = (!cfg!(debug_assertions)).then(Instant::now);
        let result = self.step_with_kinematic_paths(paths);
        let time_us = start.map(|t| t.elapsed().as_secs_f64() * 1e6);
        let sample = TickSample {
            error: result.err(),
            completed: if self.character_motion.p1b_tick_started {
                self.actual_motion_completed_time()
            } else {
                0.
            },
            overlap: self.p1b_character_overlap(),
            time_us,
        };
        self.character_motion
            .p1b_ticks
            .as_mut()
            .unwrap()
            .push(sample);
        result
    }

    fn p1b_character_overlap(&self) -> f32 {
        let mut max_overlap = 0_f32;
        let capsules: Vec<_> = self
            .characters
            .iter()
            .filter_map(|(&id, runtime)| {
                let body = &self.backend.bodies[native_id(id)];
                let collider = &self.backend.colliders[native_collider(runtime.collider)];
                let capsule = collider.shape().as_capsule().unwrap();
                let pose = collider.position();
                // The P1b scenes use upright capsules with a shared world-Y axis.
                if !body.is_enabled() || !collider.is_enabled() {
                    return None;
                }
                let a = *pose * capsule.segment.a;
                let b = *pose * capsule.segment.b;
                assert!((a.x - b.x).abs() <= 1.0e-5 && (a.z - b.z).abs() <= 1.0e-5);
                Some((
                    collider,
                    (a + b) * 0.5,
                    (a.y - b.y).abs() * 0.5,
                    capsule.radius,
                ))
            })
            .collect();
        for (index, &(a, p, l, r)) in capsules.iter().enumerate() {
            for &(b, q, m, s) in &capsules[..index] {
                if !a.collision_groups().test(b.collision_groups())
                    || !self.contact_policies.pair_allows(a.parent(), b.parent())
                {
                    continue;
                }
                let delta = p - q;
                let y = (delta.y.abs() - l - m).max(0.);
                let distance = rp::Vector::new(delta.x, y, delta.z).length();
                max_overlap = max_overlap.max(r + s - distance);
            }
        }
        max_overlap
    }
}

pub(crate) struct TraceHash(u64);

impl TraceHash {
    pub(crate) fn new() -> Self {
        Self(0xcbf29ce484222325)
    }

    pub(crate) fn bytes(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ u64::from(b)).wrapping_mul(0x100000001b3);
        }
    }

    pub(crate) fn values(&mut self, values: impl IntoIterator<Item = f32>) {
        for value in values {
            self.bytes(&value.to_bits().to_le_bytes());
        }
    }

    pub(crate) fn body(&mut self, world: &PhysicsWorld3d, id: BodyId) {
        let state = world.body_state(id).unwrap();
        self.values(state.pose.position);
        self.values(state.pose.rotation);
        self.values(state.linear_velocity);
        self.values(state.angular_velocity);
        self.bytes(&[u8::from(state.sleeping)]);
        if let Ok(state) = world.character_state(id) {
            self.bytes(&[
                u8::from(state.grounded),
                u8::from(state.blocked_by_character),
            ]);
            self.values([state.vertical_speed]);
        }
    }

    pub(crate) fn finish(self) -> u64 {
        self.0
    }
}

pub(crate) fn report(scene: &str, mode: Mode, samples: &[TickSample], hash: u64) {
    let mut errors = BTreeMap::new();
    for error in samples.iter().filter_map(|s| s.error) {
        *errors.entry(format!("{error:?}")).or_insert(0) += 1;
    }
    let first_error = samples.iter().position(|s| s.error.is_some());
    let stalls = samples.iter().filter(|s| s.completed == 0.).count();
    let first_stall = samples.iter().position(|s| s.completed == 0.);
    let overlap = samples.iter().map(|s| s.overlap).fold(0., f32::max);
    let times = samples.iter().filter_map(|s| s.time_us);
    let timing = times
        .clone()
        .reduce(f64::max)
        .map(|max| (times.sum::<f64>() / samples.len() as f64, max));
    println!("P1B scene={scene} mode={mode:?} ticks={} errors={errors:?} first_error={first_error:?} stalls={stalls} first_stall={first_stall:?} overlap={overlap:.7} hash={hash:016x} timing_us={timing:?}", samples.len());
}

fn body(world: &mut PhysicsWorld3d, kind: BodyKind, position: [f32; 3], shape: Shape) -> BodyId {
    world
        .create_body(
            BodyDesc {
                kind,
                pose: Pose {
                    position,
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(shape),
        )
        .unwrap()
}

fn character(world: &mut PhysicsWorld3d, position: [f32; 3]) -> BodyId {
    let id = body(
        world,
        BodyKind::KinematicPosition,
        position,
        Shape::Capsule {
            half_height: 0.5,
            radius: 0.25,
        },
    );
    world
        .enable_character(id, CharacterConfig::default())
        .unwrap();
    id
}

#[test]
fn p1b_kcc_keeps_support_when_the_platform_descends_and_reverses() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let platform = body(
        &mut world,
        BodyKind::KinematicPosition,
        [0.; 3],
        Shape::Box {
            half_extents: [2.5, 0.2, 2.5],
        },
    );
    let rider = character(&mut world, [0., 0.959, 0.]);
    Mode::Kcc.configure(&mut world);
    for _ in 0..4 {
        world.step_checked().unwrap();
    }
    let initial_y = world.body_state(rider).unwrap().pose.position[1];
    let mut previous_y = 0.;
    for y in [-0.05, -0.1, -0.15, -0.1, -0.05, 0.] {
        let path = KinematicPath {
            body: platform,
            sweep_sensors: false,
            knots: vec![(
                1.,
                Pose {
                    position: [0., y, 0.],
                    ..Pose::default()
                },
            )],
        };
        world.step_with_kinematic_paths(&[path]).unwrap();
        let at = world.body_state(rider).unwrap().pose.position[1];
        let state = world.character_state(rider).unwrap();
        assert_eq!(state.ground.unwrap().body, platform, "support at y={y}");
        assert_eq!(state.carried_by, Some(platform));
        assert!((state.carry_translation[1] - (y - previous_y)).abs() < 1.0e-5);
        assert!(
            (at - y - initial_y).abs() < 1.0e-5,
            "rider at {at}, platform at {y}"
        );
        previous_y = y;
    }
}

#[test]
fn p1b_kcc_finds_walkable_ground_past_an_overlapping_wall() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let floor = body(
        &mut world,
        BodyKind::Fixed,
        [0., -0.1, 0.],
        Shape::Box {
            half_extents: [4., 0.1, 4.],
        },
    );
    let wall = body(
        &mut world,
        BodyKind::KinematicPosition,
        [0.52, 1., 0.],
        Shape::Box {
            half_extents: [0.25, 2., 2.],
        },
    );
    let rider = character(&mut world, [0., 0.759, 0.]);
    Mode::Kcc.configure(&mut world);
    for _ in 0..4 {
        world.step_checked().unwrap();
    }
    assert_eq!(
        world.character_state(rider).unwrap().ground.unwrap().body,
        floor
    );
    world
        .set_kinematic_target(
            wall,
            Pose {
                position: [0.49, 1., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    world.step_checked().unwrap();
    let position = world.body_state(rider).unwrap().pose.position;
    assert!(
        position[0] + 0.25 > 0.49 - 0.25,
        "wall must overlap the rider"
    );
    assert_eq!(
        world.character_state(rider).unwrap().ground.unwrap().body,
        floor
    );
}

#[test]
fn p1b_observer_records_zero_time_for_an_invalid_path() {
    for mode in MODES {
        let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
        let platform = body(
            &mut world,
            BodyKind::KinematicPosition,
            [0.; 3],
            Shape::Box {
                half_extents: [2.5, 0.2, 2.5],
            },
        );
        character(&mut world, [0., 0.959, 0.]);
        mode.configure(&mut world);
        world.observe_p1b_ticks();
        world.p1b_step_observed(&[]).unwrap();
        let invalid = KinematicPath {
            body: platform,
            sweep_sensors: false,
            knots: vec![(0.5, Pose::default())],
        };
        assert_eq!(
            world.p1b_step_observed(&[invalid]),
            Err(PhysicsError::InvalidBody)
        );
        world.p1b_step_observed(&[]).unwrap();
        let samples = world.take_p1b_ticks();
        let dt = f64::from(world.config().step_seconds);
        assert_eq!(samples[0].completed, dt);
        assert_eq!(samples[1].error, Some(PhysicsError::InvalidBody));
        assert_eq!(samples[1].completed, 0.);
        assert_eq!(samples[2].completed, dt);
    }
}

#[test]
fn p1b_kcc_resolves_peer_contacts_and_keeps_the_ordinary_step() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    body(
        &mut world,
        BodyKind::Fixed,
        [0., -0.1, 0.],
        Shape::Box {
            half_extents: [4., 0.1, 4.],
        },
    );
    let left = character(&mut world, [-0.26, 0.759, 0.]);
    let right = character(&mut world, [0.26, 0.759, 0.]);
    Mode::Kcc.configure(&mut world);
    for (id, vx) in [(left, 1.), (right, -1.)] {
        world
            .set_character_input(
                id,
                CharacterInput {
                    velocity: [vx, 0., 0.],
                    jump_speed: 0.,
                },
            )
            .unwrap();
    }
    let mut touched = false;
    for _ in 0..12 {
        world.step_checked().unwrap();
        assert_eq!(world.step_statistics().backend_steps, 1);
        assert_eq!(
            world.actual_motion_completed_time(),
            f64::from(world.config().step_seconds)
        );
        touched |= world.character_state(left).unwrap().blocked_by_character;
        assert!(world.p1b_character_overlap() < 1.0e-4);
    }
    assert!(touched);
    for (id, vx) in [(left, -1.), (right, 1.)] {
        world
            .set_character_input(
                id,
                CharacterInput {
                    velocity: [vx, 0., 0.],
                    jump_speed: 0.,
                },
            )
            .unwrap();
    }
    world.step_checked().unwrap();
    assert!(!world.character_state(left).unwrap().blocked_by_character);
    assert!(
        world.body_state(right).unwrap().pose.position[0]
            - world.body_state(left).unwrap().pose.position[0]
            > 0.51
    );
}

fn compare_platform(rotates: bool) {
    let name = if rotates {
        "rotating-platform"
    } else {
        "moving-platform"
    };
    for mode in MODES {
        let mut hashes = Vec::new();
        for repeat in 0..2 {
            let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
            let platform = body(
                &mut world,
                BodyKind::KinematicPosition,
                [0.; 3],
                Shape::Box {
                    half_extents: [2.5, 0.2, 2.5],
                },
            );
            let rider = character(&mut world, [1.2, 0.959, 0.4]);
            mode.configure(&mut world);
            for _ in 0..4 {
                world.step_checked().unwrap();
            }
            assert_eq!(
                world.character_state(rider).unwrap().ground.unwrap().body,
                platform
            );
            let start = rp::Vector::from(world.body_state(rider).unwrap().pose.position);
            let mut hash = TraceHash::new();
            let mut slip = 0_f32;
            let mut loss = 0;
            let mut first_loss = None;
            world.observe_p1b_ticks();
            for tick in 0_usize..300 {
                let phase = (tick + 1) as f32 * 0.015;
                let target = if rotates {
                    let (sin, cos) = (phase * 0.5).sin_cos();
                    Pose {
                        rotation: [0., sin, 0., cos],
                        ..Pose::default()
                    }
                } else {
                    Pose {
                        position: [phase.sin() * 2.5, 0., 0.],
                        ..Pose::default()
                    }
                };
                let path = KinematicPath {
                    body: platform,
                    sweep_sensors: false,
                    knots: vec![(1., target)],
                };
                let _ = world.p1b_step_observed(&[path]);
                let base = super::world::native_pose(world.body_state(platform).unwrap().pose);
                let at = rp::Vector::from(world.body_state(rider).unwrap().pose.position);
                let drift = base.inverse_transform_point(at) - start;
                slip = slip.max(drift.x.hypot(drift.z));
                if world
                    .character_state(rider)
                    .unwrap()
                    .ground
                    .is_none_or(|ground| ground.body != platform)
                {
                    loss += 1;
                    first_loss.get_or_insert(tick);
                }
                hash.body(&world, rider);
                hash.body(&world, platform);
            }
            let hash = hash.finish();
            hashes.push(hash);
            if repeat == 0 {
                println!("P1B_PLATFORM scene={name} mode={mode:?} ground_loss={loss} first_loss={first_loss:?} slip={slip:.7}");
                report(name, mode, &world.take_p1b_ticks(), hash);
            }
        }
        assert_eq!(hashes[0], hashes[1], "{name} {mode:?}");
    }
}

#[test]
#[ignore = "P1b compares two 300-tick replays in both modes"]
fn p1b_compare_rotating_platform() {
    compare_platform(true);
}

#[test]
#[ignore = "P1b compares two 300-tick replays in both modes"]
fn p1b_compare_moving_platform() {
    compare_platform(false);
}

#[test]
#[ignore = "P1b compares two 300-tick replays in both modes"]
fn p1b_compare_squeeze_release() {
    for mode in MODES {
        let mut hashes = Vec::new();
        for repeat in 0..2 {
            let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
            body(
                &mut world,
                BodyKind::Fixed,
                [0., -0.1, 0.],
                Shape::Box {
                    half_extents: [8., 0.1, 8.],
                },
            );
            let wall = || Shape::Box {
                half_extents: [0.25, 2., 2.],
            };
            let left = body(
                &mut world,
                BodyKind::KinematicPosition,
                [-0.54, 1., 0.],
                wall(),
            );
            let right = body(
                &mut world,
                BodyKind::KinematicPosition,
                [0.54, 1., 0.],
                wall(),
            );
            let actor = character(&mut world, [0., 0.759, 0.]);
            mode.configure(&mut world);
            for _ in 0..4 {
                world.step_checked().unwrap();
            }
            let mut hash = TraceHash::new();
            let mut recovered = None;
            let mut blocked_ticks = 0;
            let mut min_gap = f32::INFINITY;
            world.observe_p1b_ticks();
            world
                .set_character_input(
                    actor,
                    CharacterInput {
                        velocity: [1.2, 0., 0.],
                        jump_speed: 0.,
                    },
                )
                .unwrap();
            for tick in 0_usize..300 {
                let closing = (tick as f32 / 10.).min(1.);
                let opening = (tick.saturating_sub(120) as f32 / 25.).min(1.);
                let x = 0.54 - 0.05 * closing;
                for (id, x) in [(left, -x), (right, x + 3. * opening)] {
                    world
                        .set_kinematic_target(
                            id,
                            Pose {
                                position: [x, 1., 0.],
                                ..Pose::default()
                            },
                        )
                        .unwrap();
                }
                let _ = world.p1b_step_observed(&[]);
                let at = world.body_state(actor).unwrap();
                if (10..120).contains(&tick) {
                    blocked_ticks += usize::from(at.linear_velocity[0].abs() < 0.05);
                    let left = world.body_state(left).unwrap().pose.position[0];
                    let right = world.body_state(right).unwrap().pose.position[0];
                    min_gap = min_gap.min(right - left - 0.5);
                }
                if tick >= 120 && at.pose.position[0] > 1. {
                    recovered.get_or_insert(tick);
                }
                for id in [actor, left, right] {
                    hash.body(&world, id);
                }
            }
            let hash = hash.finish();
            hashes.push(hash);
            if repeat == 0 {
                println!("P1B_SQUEEZE mode={mode:?} release=120 recovered={recovered:?} blocked_ticks={blocked_ticks} min_gap={min_gap:.7}");
                report("squeeze-release", mode, &world.take_p1b_ticks(), hash);
            }
        }
        assert_eq!(hashes[0], hashes[1], "squeeze-release {mode:?}");
    }
}
