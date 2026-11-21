use super::*;
use crate::physics3d::{
    world::native_id, BodyDesc, BodyKind, CharacterConfig, ColliderDesc, PhysicsWorld3d, Pose,
    Shape, WorldConfig,
};
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
fn trajectory(world: &PhysicsWorld3d, id: BodyId, role: Role) -> ColliderTrajectory {
    let parent = native_id(id);
    let body = &world.backend.bodies[parent];
    let collider = body.colliders()[0];
    let c = &world.backend.colliders[collider];
    ColliderTrajectory {
        parent: Some(parent),
        collider,
        role,
        sensor: false,
        motion: crate::physics3d::solver_trajectory::ShapeMotion {
            curve: Curve::Constant {
                pose: *body.position(),
                start_time: 0.,
                end_time: 1.,
            },
            local_center: body.local_center_of_mass(),
            local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
        },
        bounds: c.shape().compute_aabb(c.position()),
    }
}
struct Fixture {
    world: PhysicsWorld3d,
    scratch: BackendMotionScratch,
    rider: BodyId,
    support: BodyId,
    actor: ColliderTrajectory,
    carrier: ColliderTrajectory,
    ceiling: ColliderTrajectory,
}
impl Fixture {
    fn new() -> Self {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            ..Default::default()
        })
        .unwrap();
        let support = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [0., -0.1, 0.],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [3., 0.1, 3.],
                }),
            )
            .unwrap();
        let rider = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [0., 0.51, 0.],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.25,
                    radius: 0.25,
                }),
            )
            .unwrap();
        world
            .enable_character(
                rider,
                CharacterConfig {
                    push_mass: 0.,
                    ..Default::default()
                },
            )
            .unwrap();
        let lid = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position: [0., 1.1, 0.],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [3., 0.1, 3.],
                }),
            )
            .unwrap();
        let actor = trajectory(&world, rider, Role::Character(rider));
        let carrier = trajectory(&world, support, Role::Prescribed);
        let ceiling = trajectory(&world, lid, Role::Fixed);
        Self {
            world,
            scratch: BackendMotionScratch::default(),
            rider,
            support,
            actor,
            carrier,
            ceiling,
        }
    }
    fn sample(
        &self,
        other: ColliderTrajectory,
        normal_from_other: rp::Vector,
    ) -> actual_scene::ContactSample {
        actual_scene::ContactSample {
            a: self.actor,
            b: other,
            contact: rapier3d::parry::query::Contact {
                point1: rp::Vector::new(1., 1., 0.),
                point2: rp::Vector::new(1., 1., 0.),
                normal1: -normal_from_other,
                normal2: normal_from_other,
                dist: 0.,
                subshape1: 0,
                subshape2: 0,
            },
        }
    }
    fn run(
        &self,
        carried: rp::Vector,
        delta: rp::Vector,
        w: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        self.scratch.independent_carry_opponent(
            native_id(self.rider),
            native_id(self.support),
            carried,
            delta,
            0.5,
            0.75,
            1.,
            &self.world.backend.bodies,
            w,
        )
    }
}
fn reversed(s: actual_scene::ContactSample) -> actual_scene::ContactSample {
    actual_scene::ContactSample {
        a: s.b,
        b: s.a,
        contact: rapier3d::parry::query::Contact {
            point1: s.contact.point2,
            point2: s.contact.point1,
            normal1: s.contact.normal2,
            normal2: s.contact.normal1,
            ..s.contact
        },
    }
}
#[test]
fn recorded_self_support_rate_correction_never_establishes_an_independent_blocker() {
    let mut f = Fixture::new();
    let sample = f.sample(f.carrier, rp::Vector::Y);
    let carried = rp::Vector::new(0., -2.3076172, 0.);
    let delta = rp::Vector::new(0., 14944.587, 0.);
    assert!(
        delta.dot(carried) < -1e-7,
        "the original opposed-rate gate really fires"
    );
    for sample in [sample, reversed(sample), f.sample(f.actor, rp::Vector::Y)] {
        f.scratch.contacts.clear();
        f.scratch.contacts.push(sample);
        assert!(!f.run(carried, delta, &mut work()).unwrap());
    }
}
#[test]
fn fixed_moving_rotating_and_changed_native_opponents_keep_the_actual_row_rate_basis() {
    let mut f = Fixture::new();
    let contact = f.sample(f.ceiling, -rp::Vector::Y);
    for sample in [contact, reversed(contact)] {
        f.scratch.contacts.clear();
        f.scratch.contacts.push(sample);
        assert!(f.run(rp::Vector::Y, -rp::Vector::Y, &mut work()).unwrap());
    }
    for kind in [BodyKind::KinematicVelocity, BodyKind::Dynamic] {
        let id = f
            .world
            .create_body(
                BodyDesc {
                    kind,
                    can_sleep: false,
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [1.; 3],
                }),
            )
            .unwrap();
        let k = Kernel::from_velocity_seconds(
            native_id(id),
            Domain::new(0., 1.).unwrap(),
            1.,
            rp::Pose::IDENTITY,
            rp::Vector::ZERO,
            if kind == BodyKind::Dynamic {
                rp::Vector::ZERO
            } else {
                rp::Vector::Z * 2.
            },
        )
        .unwrap();
        let mut other = trajectory(
            &f.world,
            id,
            if kind == BodyKind::Dynamic {
                Role::Dynamic
            } else {
                Role::Prescribed
            },
        );
        other.motion.curve = Curve::Integrated(k);
        f.scratch.entries.clear();
        f.scratch.participants.clear();
        f.scratch
            .entries
            .push(super::super::momentum_tests::entry(native_id(id), k));
        let physical = if kind == BodyKind::Dynamic {
            physical_momentum::State::new(rp::Vector::Y * 3., rp::Vector::ZERO).unwrap()
        } else {
            physical_momentum::State::from_curve(Curve::Integrated(k), 0.75).unwrap()
        };
        f.scratch.participants.push(Participant {
            body: id,
            pose: k.position_at_time(0.75),
            linear_velocity: physical.linear,
            angular_velocity: physical.angular,
            mass: MassPolicy::Native,
        });
        f.scratch.contacts.clear();
        f.scratch.contacts.push(f.sample(other, -rp::Vector::Y));
        let actual = f
            .scratch
            .geometric_surface_rate(
                &other,
                0.5,
                0.75,
                1.,
                rp::Vector::new(1., 1., 0.),
                &f.world.backend.bodies,
                &mut work(),
            )
            .unwrap();
        if kind == BodyKind::Dynamic {
            assert_eq!(
                actual,
                rp::Vector::Y * 3.,
                "post-solve physical response is re-evaluated through the Native continuation"
            );
            assert!(
                !f.run(rp::Vector::Y * 1.5, -rp::Vector::Y, &mut work())
                    .unwrap(),
                "opponent is already moving away faster"
            );
        } else {
            assert!(
                actual.y < 1.5 && k.native.angular_velocity.z > 1.5,
                "original normalized-Euler point derivative differs from raw omega"
            );
            assert!(f
                .run(rp::Vector::Y * 1.5, -rp::Vector::Y, &mut work())
                .unwrap());
            let pose = k.position_at_time(0.5);
            let entry = &mut f.scratch.entries[0];
            entry.curve = Curve::Constant {
                pose,
                start_time: 0.5,
                end_time: 1.,
            };
            entry.value.linear_velocity = rp::Vector::ZERO;
            entry.value.angular_velocity = rp::Vector::ZERO;
            entry.stopped_at = Some(0.5);
            f.scratch.participants[0].linear_velocity = rp::Vector::ZERO;
            f.scratch.participants[0].angular_velocity = rp::Vector::ZERO;
            assert!(
                f.run(rp::Vector::Y, -rp::Vector::Y, &mut work()).unwrap(),
                "planned-stopped surface remains a genuine blocker"
            );
        }
    }
}
#[test]
fn final_peer_geometry_not_raw_momentum_decides_relative_closing() {
    let mut f = Fixture::new();
    let peer = f
        .world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    f.world
        .enable_character(peer, CharacterConfig::default())
        .unwrap();
    let other = trajectory(&f.world, peer, Role::Character(peer));
    f.scratch.contacts.push(f.sample(other, -rp::Vector::Y));
    f.scratch.character_values.push((peer, rp::Vector::ZERO));
    assert!(f.run(rp::Vector::Y, -rp::Vector::Y, &mut work()).unwrap());
    f.scratch.character_values[0].1 = rp::Vector::Y * 3.;
    assert!(!f.run(rp::Vector::Y, -rp::Vector::Y, &mut work()).unwrap());
    f.scratch.character_values.clear();
    assert!(matches!(
        f.run(rp::Vector::Y, -rp::Vector::Y, &mut work()),
        Err(TrajectoryError::InvalidReference)
    ));
}
#[test]
fn only_visible_revalidated_active_solids_can_supply_the_missing_opponent() {
    let mut f = Fixture::new();
    f.scratch.contacts.push(f.sample(f.ceiling, -rp::Vector::Y));
    f.scratch
        .remember_active_contacts(
            0.5,
            0.75,
            &f.world.backend.bodies,
            &f.world.backend.colliders,
            &f.world.characters,
            &mut work(),
            usize::MAX,
        )
        .unwrap();
    assert_eq!(
        f.scratch.active_contacts.len(),
        1,
        "use the original full-shape admission producer"
    );
    f.scratch.contacts.clear();
    assert!(!f.run(rp::Vector::Y, -rp::Vector::Y, &mut work()).unwrap());
    f.scratch.active_contacts[0].visible = true;
    assert!(f.run(rp::Vector::Y, -rp::Vector::Y, &mut work()).unwrap());
    f.scratch.active_contacts[0].sample.b.sensor = true;
    assert!(!f.run(rp::Vector::Y, -rp::Vector::Y, &mut work()).unwrap());
    f.scratch.active_contacts.clear();
    f.scratch.contacts.push(f.sample(f.ceiling, rp::Vector::Y));
    assert!(
        !f.run(rp::Vector::Y, -rp::Vector::Y, &mut work()).unwrap(),
        "outgoing carry is not opposed"
    );
}
#[test]
fn actual_visit_exact_quota_and_nonfinite_failure_preserve_all_world_and_input_bytes() {
    let mut f = Fixture::new();
    f.scratch.contacts.push(f.sample(f.ceiling, -rp::Vector::Y));
    let before = f.world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let curves = postcard::to_allocvec(&(f.actor.motion, f.ceiling.motion)).unwrap();
    let mut measured = work();
    assert!(f.run(rp::Vector::Y, -rp::Vector::Y, &mut measured).unwrap());
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(f.run(rp::Vector::Y, -rp::Vector::Y, &mut exact).unwrap());
    assert_eq!(exact.used, measured.used);
    assert!(matches!(
        f.run(
            rp::Vector::Y,
            -rp::Vector::Y,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    ));
    f.scratch.contacts[0].contact.normal1.x = f32::NAN;
    assert!(matches!(
        f.run(rp::Vector::Y, -rp::Vector::Y, &mut work()),
        Err(TrajectoryError::NonFinite)
    ));
    assert_eq!(f.world.capture_snapshot().unwrap().encoded_bytes(), before);
    assert_eq!(
        postcard::to_allocvec(&(f.actor.motion, f.ceiling.motion)).unwrap(),
        curves
    );
    assert!(f.scratch.entries.iter().all(|e| e.stopped_at.is_none()));
}
