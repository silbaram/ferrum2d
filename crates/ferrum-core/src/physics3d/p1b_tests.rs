//! Product KCC regressions for platform support and character obstruction.
use super::{colliders::native_collider, world::native_id};
use super::{
    BodyDesc, BodyId, BodyKind, CharacterConfig, CharacterInput, ColliderDesc, KinematicPath,
    PhysicsError, PhysicsWorld3d, Pose, Shape, WorldConfig,
};
use rapier3d::prelude as rp;

impl PhysicsWorld3d {
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
fn p1b_kcc_preserves_walkable_ground_when_a_wall_pushes_the_rider() {
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
        position[0] < 0. && position[0] + 0.25 <= 0.49 - 0.25 + 0.005,
        "wall must push without passing through the grounded rider: {position:?}"
    );
    assert_eq!(
        world.character_state(rider).unwrap().ground.unwrap().body,
        floor
    );
}

#[test]
fn invalid_platform_path_preserves_the_previous_step_and_can_retry() {
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
    world.step_checked().unwrap();
    let state = world.character_state(rider).unwrap().clone();
    let stats = world.step_statistics();
    let invalid = KinematicPath {
        body: platform,
        sweep_sensors: false,
        knots: vec![(0.5, Pose::default())],
    };
    assert_eq!(
        world.step_with_kinematic_paths(&[invalid]),
        Err(PhysicsError::InvalidBody)
    );
    assert_eq!(world.character_state(rider).unwrap(), &state);
    assert_eq!(world.step_statistics(), stats);
    world.step_checked().unwrap();
    assert_eq!(
        world.character_state(rider).unwrap().ground.unwrap().body,
        platform
    );
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

#[test]
fn p2b_kcc_capsules_cannot_swap_places_in_one_tick() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
    .unwrap();
    let left = character(&mut world, [-1., 0., 0.]);
    let right = character(&mut world, [1., 0., 0.]);
    for (id, vx) in [(left, 20.), (right, -20.)] {
        world
            .set_character_input(
                id,
                CharacterInput {
                    velocity: [vx, 0., 0.],
                    ..CharacterInput::default()
                },
            )
            .unwrap();
    }
    world.step_checked().unwrap();
    let separation = world.body_state(right).unwrap().pose.position[0]
        - world.body_state(left).unwrap().pose.position[0];
    assert!(separation >= 0.5 - 1e-5, "separation={separation}");
    assert!(world.character_state(left).unwrap().blocked_by_character);
    assert!(world.character_state(right).unwrap().blocked_by_character);
}

#[test]
fn platform_and_rider_stop_together_at_a_wall() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let platform = body(
        &mut world,
        BodyKind::KinematicPosition,
        [0.; 3],
        Shape::Box {
            half_extents: [0.5, 0.2, 2.],
        },
    );
    body(
        &mut world,
        BodyKind::Fixed,
        [1.4, 1., 0.],
        Shape::Box {
            half_extents: [0.1, 2., 2.],
        },
    );
    let rider = character(&mut world, [0.28, 0.959, 0.]);
    for _ in 0..4 {
        world.step_checked().unwrap();
    }
    assert_eq!(
        world.character_state(rider).unwrap().ground.unwrap().body,
        platform
    );
    let path = KinematicPath {
        body: platform,
        sweep_sensors: false,
        knots: vec![(
            1.,
            Pose {
                position: [1.5, 0., 0.],
                ..Pose::default()
            },
        )],
    };
    let before_rider = world.body_state(rider).unwrap().pose;
    world.step_with_kinematic_paths(&[path]).unwrap();
    let platform_x = world.body_state(platform).unwrap().pose.position[0];
    let ground = world.character_state(rider).unwrap().grounded;
    let overlap = ((platform_x + 0.5).min(1.5) - (platform_x - 0.5).max(1.3)).max(0.);
    assert!(
        overlap <= 0.005 && ground,
        "overlap={overlap}, grounded={ground}"
    );
    assert_eq!(world.step_statistics().kinematic_path_stops, 1);
    assert_eq!(platform_x, 0.);
    assert_eq!(world.body_state(rider).unwrap().pose, before_rider);
    let state = world.character_state(rider).unwrap();
    assert_eq!(state.carried_by, None);
    assert_eq!(state.carry_translation, [0.; 3]);
}

fn check_platform_carry(rotates: bool) {
    let name = if rotates {
        "rotating-platform"
    } else {
        "moving-platform"
    };
    let mut hashes = Vec::new();
    for _ in 0..2 {
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
            world.step_with_kinematic_paths(&[path]).unwrap();
            let base = super::world::native_pose(world.body_state(platform).unwrap().pose);
            let at = rp::Vector::from(world.body_state(rider).unwrap().pose.position);
            let drift = base.inverse_transform_point(at) - start;
            slip = slip.max(drift.x.hypot(drift.z));
            let state = world.character_state(rider).unwrap();
            assert_eq!(state.ground.unwrap().body, platform, "{name}, tick {tick}");
            hash.body(&world, rider);
            hash.body(&world, platform);
        }
        let hash = hash.finish();
        hashes.push(hash);
        assert!(slip < 0.005, "{name}: slip={slip}");
    }
    assert_eq!(hashes[0], hashes[1], "{name}");
}

#[test]
fn rotating_platform_carries_the_rider_without_drift() {
    check_platform_carry(true);
}

#[test]
fn moving_platform_carries_the_rider_without_drift() {
    check_platform_carry(false);
}

#[test]
fn squeezed_character_moves_again_when_the_walls_open() {
    let mut hashes = Vec::new();
    for _ in 0..2 {
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
        for _ in 0..4 {
            world.step_checked().unwrap();
        }
        let mut hash = TraceHash::new();
        let mut recovered = None;
        let mut blocked_ticks = 0;
        let mut min_gap = f32::INFINITY;
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
            world.step_checked().unwrap();
            let at = world.body_state(actor).unwrap();
            if (10..120).contains(&tick) {
                blocked_ticks += usize::from(at.linear_velocity[0].abs() < 0.05);
                let left = world.body_state(left).unwrap().pose.position[0];
                let right = world.body_state(right).unwrap().pose.position[0];
                min_gap = min_gap.min(right - left - 0.5);
                assert!((left + 0.25..right - 0.25).contains(&at.pose.position[0]));
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
        assert!(blocked_ticks > 95, "{blocked_ticks}");
        // The narrowest opening in this fixture is 0.48 under the product KCC.
        assert!(min_gap >= 0.48 - 1e-5, "squeeze gap {min_gap}");
        assert!(
            recovered.is_some_and(|tick| tick <= 180),
            "release={recovered:?}"
        );
    }
    assert_eq!(hashes[0], hashes[1], "squeeze-release");
}
