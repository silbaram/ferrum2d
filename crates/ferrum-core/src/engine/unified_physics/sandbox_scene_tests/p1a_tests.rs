//! P1a rigid-body experiment. Release runs also time the calls that advance physics.
use super::*;
use crate::collision_event::{COLLISION_EVENT_ENTER, COLLISION_EVENT_TRIGGER_ENTER};
use crate::components::{
    DistanceJoint, GearJoint, PrismaticJoint, RevoluteJoint, RopeJoint, SpringJoint, WeldJoint,
};
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, PhysicsWorld3d, Pose, Shape};
use std::collections::BTreeMap;
use std::fmt::Debug;
use std::time::Instant;

const FRAMES: usize = 300;

#[derive(Debug, Clone, Copy)]
enum Mode {
    Current,
    Rapier,
}
const MODES: [Mode; 2] = [Mode::Current, Mode::Rapier];

fn physics(e: &Engine) -> &PhysicsWorld3d {
    &e.unified_physics.as_ref().unwrap().physics
}

fn configure_experiment(world: &mut PhysicsWorld3d, mode: Mode) {
    if matches!(mode, Mode::Rapier) {
        world.enable_experimental_rigid_rapier_ccd();
        assert!(!world.p1a_uses_motion_proof());
    }
}

fn step_sample<T>(step: impl FnOnce() -> T) -> (T, f64) {
    let before = (!cfg!(debug_assertions)).then(Instant::now);
    let result = step();
    (
        result,
        before.map_or(0., |t| t.elapsed().as_secs_f64() * 1e6),
    )
}

#[derive(Default)]
struct Measurements {
    errors: BTreeMap<String, usize>,
    first_error: Option<usize>,
    first_stall: Option<usize>,
    stalls: usize,
    first_crossing: Option<usize>,
    overlap: f32,
    initial_overlap: f32,
    tail_speed: f32,
    joint_error: f32,
    ccd_clamps: u32,
    sum_us: f64,
    max_us: f64,
}

impl Measurements {
    fn new(world: &PhysicsWorld3d) -> Self {
        Self {
            initial_overlap: world.p1a_max_overlap(),
            ..Self::default()
        }
    }

    fn record(
        &mut self,
        world: &PhysicsWorld3d,
        frame: usize,
        error: Option<impl Debug>,
        crossed: bool,
        elapsed_us: f64,
    ) {
        if let Some(error) = error {
            *self.errors.entry(format!("{error:?}")).or_default() += 1;
            self.first_error.get_or_insert(frame);
            if world.actual_motion_completed_time() == 0. {
                self.first_stall.get_or_insert(frame);
                self.stalls += 1;
            }
        }
        if crossed {
            self.first_crossing.get_or_insert(frame);
        }
        self.overlap = self.overlap.max(world.p1a_max_overlap());
        self.ccd_clamps += world.step_statistics().ccd_clamps;
        self.sum_us += elapsed_us;
        self.max_us = self.max_us.max(elapsed_us);
    }

    fn report(&self, world: &PhysicsWorld3d, scene: &str, mode: Mode) {
        assert_eq!(world.p1a_uses_motion_proof(), matches!(mode, Mode::Current));
        let timing =
            (!cfg!(debug_assertions)).then_some((self.sum_us / FRAMES as f64, self.max_us));
        println!(
            "P1A scene={scene} mode={mode:?} frames={FRAMES} errors={:?} first_error={:?} stalls={} first_stall={:?} first_crossing={:?} overlap={:.7} initial_overlap={:.7} ccd_clamps={} tail_speed={:.7} joint_error={:.7} timing_us={timing:?} params={:?}",
            self.errors, self.first_error, self.stalls, self.first_stall, self.first_crossing,
            self.overlap, self.initial_overlap, self.ccd_clamps, self.tail_speed, self.joint_error,
            world.p1a_integration_settings()
        );
    }
}

// The fixed lower fence is 760 x 24, centered at (400, 454).
fn past_sandbox_floor(e: &Engine, tracked: &[Entity]) -> bool {
    tracked.iter().any(|&id| {
        let p = e.world.transform(id).unwrap();
        (20. ..=780.).contains(&p.x) && p.y > 466.
    })
}

fn gallery_chain_crossing(e: &Engine, tracked: &[Entity]) -> bool {
    // Check the authored polyline only inside its span. A center more than 40
    // units below the segment is a pass-through rather than small penetration.
    const CHAIN: [[f32; 2]; 6] = [
        [120., 380.],
        [230., 336.],
        [340., 362.],
        [440., 328.],
        [560., 358.],
        [680., 378.],
    ];
    tracked.iter().any(|&id| {
        let p = e.world.transform(id).unwrap();
        CHAIN.windows(2).any(|segment| {
            let [[a, ya], [b, yb]] = [segment[0], segment[1]];
            (a + 40. ..=b - 40.).contains(&p.x) && p.y > ya + (yb - ya) * (p.x - a) / (b - a) + 40.
        })
    })
}

fn run_sandbox(name: &str, bodies: &[Body], gravity: f32, iterations: [u32; 2]) {
    for mode in MODES {
        let (mut e, entities) = sandbox_engine(bodies, gravity, iterations);
        let tracked: Vec<_> = bodies
            .iter()
            .zip(&entities)
            .filter_map(|(body, &entity)| body.dynamic.then_some(entity))
            .collect();
        configure_experiment(&mut e.unified_physics.as_mut().unwrap().physics, mode);
        let mut output = Measurements::new(physics(&e));
        for frame in 0..FRAMES {
            e.update(1. / 60.);
            let (_, elapsed) = step_sample(|| sandbox_step(&mut e, gravity, iterations));
            let error = e.take_unified_physics_error();
            let crossed = past_sandbox_floor(&e, &tracked)
                || (name == "collider-gallery" && gallery_chain_crossing(&e, &tracked));
            output.record(physics(&e), frame, error, crossed, elapsed);
        }
        output.report(physics(&e), name, mode);
    }
}

#[test]
#[ignore = "P1a measures 300 attempts per mode"]
fn p1a_compare_rigid_materials() {
    run_sandbox("rigid-materials", &rigid_materials(), 860., [8, 6]);
}

#[test]
#[ignore = "P1a measures 300 attempts per mode"]
fn p1a_compare_contacts_sensors() {
    run_sandbox("contacts-sensors", &contacts_sensors(), 820., [8, 7]);
}

#[test]
#[ignore = "P1a measures 300 attempts per mode"]
fn p1a_compare_collider_gallery() {
    run_sandbox("collider-gallery", &collider_gallery(), 640., [8, 6]);
}

fn anchor(e: &mut Engine, x: f32, y: f32) -> Entity {
    assert!(e.spawn_physics_aabb_body(
        x,
        y,
        1.,
        1.,
        0,
        1.,
        true,
        PHYSICS_LAYER_WALL,
        0,
        0,
        false,
        false,
        true,
        false
    ));
    Entity {
        id: e.physics_entity_id(),
        generation: e.physics_entity_generation(),
    }
}

fn joints_lab() -> (Engine, Vec<Entity>) {
    // The authored order, world anchors and seven joints from joints-lab.physics.json.
    let rubber = [0.68, 0.42, 1.];
    let metal = [0.36, 0.06, 2.2];
    let bodies = [
        Body::new(
            false,
            [400., 454.],
            Collider::Box([380., 12.]),
            [0.82, 0., 1.],
        ),
        Body::new(true, [118., 112.], Collider::Circle(18.), rubber),
        Body::new(true, [198., 112.], Collider::Circle(18.), rubber),
        Body::new(true, [300., 105.], Collider::Box([16., 16.]), rubber),
        Body::new(true, [400., 105.], Collider::Box([16., 16.]), rubber),
        Body {
            rotation: 0.2,
            ..Body::new(
                true,
                [540., 128.],
                Collider::OrientedBox([37., 10.], 0.05),
                metal,
            )
        },
        Body::new(true, [168., 284.], Collider::Box([24., 12.]), metal),
        Body::new(true, [492., 286.], Collider::Circle(24.), metal),
        Body::new(true, [574., 286.], Collider::Circle(18.), metal),
        Body {
            rotation: 0.04,
            ..Body::new(true, [650., 200.], Collider::Box([32., 9.]), metal)
        },
        Body {
            rotation: -0.04,
            ..Body::new(true, [714., 200.], Collider::Box([32., 9.]), metal)
        },
    ];
    let (mut e, entities) = sandbox_engine(&bodies, 640., [8, 8]);
    let [_, distance_a, distance_b, spring_a, spring_b, hinge, slider, gear_a, gear_b, weld_a, weld_b] =
        <[Entity; 11]>::try_from(entities.as_slice()).unwrap();
    e.world.add_distance_joint(
        DistanceJoint::new(distance_a, distance_b, 80.)
            .with_stiffness(0.95)
            .with_damping(0.15),
    );
    e.world.add_rope_joint(
        RopeJoint::new(distance_b, spring_a, 120.)
            .with_stiffness(0.9)
            .with_damping(0.25),
    );
    e.world
        .add_spring_joint(SpringJoint::new(spring_a, spring_b, 94.).with_frequency(2., 0.7));
    let hinge_anchor = anchor(&mut e, 540., 128.);
    e.world
        .add_revolute_joint(RevoluteJoint::new(hinge_anchor, hinge).with_angle_limits(-0.85, 0.85));
    let slide_anchor = anchor(&mut e, 168., 284.);
    e.world.add_prismatic_joint(
        PrismaticJoint::new(slide_anchor, slider)
            .with_local_axis_a(1., 0.)
            .with_translation_limits(-90., 90.)
            .with_motor(28., 50.),
    );
    e.world
        .add_gear_joint(GearJoint::new(gear_a, gear_b, -4. / 3.));
    e.world.add_weld_joint(
        WeldJoint::new(weld_a, weld_b)
            .with_local_anchor_a(32., 0.)
            .with_local_anchor_b(-32., 0.)
            .with_reference_angle(-0.08),
    );
    (e, entities)
}

#[test]
#[ignore = "P1a measures 300 attempts per mode"]
fn p1a_compare_joints_lab() {
    for mode in MODES {
        let (mut e, bodies) = joints_lab();
        configure_experiment(&mut e.unified_physics.as_mut().unwrap().physics, mode);
        let mut output = Measurements::new(physics(&e));
        for frame in 0..FRAMES {
            e.update(1. / 60.);
            let (_, elapsed) = step_sample(|| sandbox_step(&mut e, 640., [8, 8]));
            let error = e.take_unified_physics_error();
            let crossed = past_sandbox_floor(&e, &bodies[1..]);
            if error.is_none() {
                assert_eq!(physics(&e).joint_count(), 7);
                let weld_anchor = |entity, offset| {
                    let p = e.world.transform(entity).unwrap();
                    let angle = e.world.rotation(entity).unwrap().radians;
                    let (s, c) = angle.sin_cos();
                    [p.x + c * offset, p.y + s * offset]
                };
                let a = weld_anchor(bodies[9], 32.);
                let b = weld_anchor(bodies[10], -32.);
                output.joint_error = output.joint_error.max((a[0] - b[0]).hypot(a[1] - b[1]));
            }
            output.record(physics(&e), frame, error, crossed, elapsed);
        }
        output.report(physics(&e), "joints-lab", mode);
    }
}

#[test]
#[ignore = "P1a measures 300 attempts per mode"]
fn p1a_compare_breakout_gap() {
    const GAP: [f32; 2] = [348., 168.];
    const SPEED: f32 = 300.;
    const PADDLE_REACH: f32 = 56. + 6.;
    for mode in MODES {
        let wall = |p, size| Body::new(false, p, Collider::Box(size), [0., 0., 1.]);
        let static_bodies = [
            wall([320., 24.], [304., 8.]),
            wall([24., 200.], [8., 184.]),
            wall([616., 200.], [8., 184.]),
            Body {
                trigger: true,
                ..wall([320., 380.], [288., 4.])
            },
        ];
        let (mut e, walls) = sandbox_engine(&static_bodies, 0., [6, 3]);
        e.set_collision_lifecycle_events_enabled(true);
        assert!(e.configure_auto_rigid_body_step(
            true, 0., 0., 6, 3, 0.8, 0.01, 1., 0.2, 120., false, true,
        ));
        let paddle = spawn_kind(&mut e, &wall([320., 344.], [56., 6.]), 1);
        let mut bricks = Vec::new();
        for row in 0..5 {
            for column in 0..10 {
                let p = [68. + 56. * column as f32, 72. + 24. * row as f32];
                let brick = spawn(&mut e, &wall(p, [26., 9.]));
                if p == GAP {
                    assert!(e.despawn_physics_entity(brick.id, brick.generation));
                } else {
                    bricks.push((brick, p));
                }
            }
        }
        let ball = spawn(
            &mut e,
            &Body {
                mass: Some(1.),
                gravity_scale: 0.,
                angular_damping: 4.,
                ..Body::new(true, [320., 331.], Collider::Circle(6.), [0., 1., 1.])
            },
        );
        assert!(e.set_physics_body_fixed_rotation(ball.id, ball.generation, true));
        let mut rigid = e.world.rigid_body(ball).unwrap();
        rigid.can_sleep = false;
        e.world.set_rigid_body(ball, rigid);
        configure_experiment(&mut e.unified_physics.as_mut().unwrap().physics, mode);
        assert!(e.resume_data_scene());
        assert!(e.auto_rigid_body_step_active());
        let dt = f64::from(e.fixed_timestep.config().step_seconds);
        let mut output = Measurements::new(physics(&e));
        let mut in_play = false;
        let mut gap_frames = 0;
        let mut hits = 0;
        for frame in 0..FRAMES {
            if frame % 100 == 0 {
                in_play = true;
                let start = 18_f32.to_radians();
                assert!(e.set_physics_body_position(ball.id, ball.generation, 320., 331.));
                assert!(e.set_physics_body_velocity(
                    ball.id,
                    ball.generation,
                    SPEED * start.sin(),
                    -SPEED * start.cos()
                ));
            }
            let before = e.world.transform(ball).unwrap();
            // The demo uses automatic stepping so native collision lifecycle events
            // are available before its brick removal and paddle response.
            let (_, elapsed) = step_sample(|| e.update(dt));
            let error = e.take_unified_physics_error();
            let p = e.world.transform(ball).unwrap();
            let crossing = !(10. ..=630.).contains(&p.x)
                || p.y < 10.
                || (before.y < 344. && p.y >= 344. && (p.x - 320.).abs() < 50.)
                || bricks.iter().any(|(_, [x, y])| {
                    (p.x - x).abs() < 20.
                        && ((before.y > *y && p.y <= *y) || (before.y < *y && p.y >= *y))
                });
            gap_frames += usize::from((p.x - GAP[0]).abs() < 26. && (p.y - GAP[1]).abs() < 9.);
            output.record(physics(&e), frame, error, crossing, elapsed);
            if !in_play {
                continue;
            }
            let mut paddle_hit = false;
            let mut miss = false;
            let mut popped = Vec::new();
            for event in &e.frame_buffers.collision_events {
                let a = Entity {
                    id: event.a_id,
                    generation: event.a_generation,
                };
                let b = Entity {
                    id: event.b_id,
                    generation: event.b_generation,
                };
                let other = if a == ball {
                    b
                } else if b == ball {
                    a
                } else {
                    continue;
                };
                if event.kind == COLLISION_EVENT_ENTER {
                    paddle_hit |= other == paddle;
                    if bricks.iter().any(|(brick, _)| *brick == other) {
                        popped.push(other);
                    }
                } else if event.kind == COLLISION_EVENT_TRIGGER_ENTER && other == walls[3] {
                    miss = true;
                }
            }
            for brick in popped {
                if let Some(index) = bricks.iter().position(|(id, _)| *id == brick) {
                    assert!(e.despawn_physics_entity(brick.id, brick.generation));
                    bricks.remove(index);
                    hits += 1;
                }
            }
            if miss {
                in_play = false;
                assert!(e.set_physics_body_position(ball.id, ball.generation, 320., 331.));
                assert!(e.set_physics_body_velocity(ball.id, ball.generation, 0., 0.));
            } else if paddle_hit {
                let angle = ((p.x - 320.) / PADDLE_REACH).clamp(-1., 1.) * 60_f32.to_radians();
                assert!(e.set_physics_body_velocity(
                    ball.id,
                    ball.generation,
                    SPEED * angle.sin(),
                    -SPEED * angle.cos()
                ));
            } else {
                let v = e.world.velocity(ball).unwrap();
                let length = v.vx.hypot(v.vy);
                let (mut vx, mut vy) = if length > 1. {
                    (v.vx / length * SPEED, v.vy / length * SPEED)
                } else {
                    (0., -SPEED)
                };
                if vy.abs() < 0.35 * SPEED {
                    vy = if vy > 0. { 0.35 * SPEED } else { -0.35 * SPEED };
                    vx = (SPEED * SPEED - vy * vy).sqrt().copysign(vx);
                }
                if (v.vx - vx).abs() > 0.5 || (v.vy - vy).abs() > 0.5 {
                    assert!(e.set_physics_body_velocity(ball.id, ball.generation, vx, vy));
                }
            }
        }
        assert!(
            gap_frames > 0 && hits > 0,
            "the ball must reach the brick gap"
        );
        println!("P1A_BREAKOUT mode={mode:?} gap_frames={gap_frames} bricks_hit={hits}");
        output.report(physics(&e), "breakout-gap", mode);
    }
}

fn spatial_world() -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space: Space::Spatial,
        ..WorldConfig::default()
    })
    .unwrap()
}

#[test]
#[ignore = "P1a measures 300 attempts per mode"]
fn p1a_compare_thin_mesh_fall() {
    for mode in MODES {
        let mut w = spatial_world();
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::TriangleMesh {
                vertices: vec![
                    [-10., 0., -10.],
                    [10., 0., -10.],
                    [10., 0., 10.],
                    [-10., 0., 10.],
                ],
                triangles: vec![[0, 2, 1], [0, 3, 2]],
            }),
        )
        .unwrap();
        let ball = w
            .create_body(
                BodyDesc {
                    pose: Pose {
                        position: [0., 2., 0.],
                        ..Pose::default()
                    },
                    linear_velocity: [0., -1000., 0.],
                    ccd: true,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            )
            .unwrap();
        configure_experiment(&mut w, mode);
        let mut output = Measurements::new(&w);
        for frame in 0..FRAMES {
            let (result, elapsed) = step_sample(|| w.step_checked());
            let state = w.body_state(ball).unwrap();
            output.record(
                &w,
                frame,
                result.err(),
                state.pose.position[1] < -0.5,
                elapsed,
            );
        }
        output.report(&w, "thin-mesh-fall", mode);
    }
}

#[test]
#[ignore = "P1a measures 300 attempts per mode"]
fn p1a_compare_box_stack() {
    for mode in MODES {
        let mut w = spatial_world();
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0., -0.5, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [10., 0.5, 10.],
            }),
        )
        .unwrap();
        let blocks: Vec<_> = (0..8)
            .map(|level| {
                w.create_body(
                    BodyDesc {
                        pose: Pose {
                            position: [0., 0.55 + 1.03 * level as f32, 0.],
                            ..Pose::default()
                        },
                        ccd: true,
                        ..BodyDesc::default()
                    },
                    ColliderDesc::new(Shape::Box {
                        half_extents: [0.5; 3],
                    }),
                )
                .unwrap()
            })
            .collect();
        configure_experiment(&mut w, mode);
        let mut output = Measurements::new(&w);
        for frame in 0..FRAMES {
            let (result, elapsed) = step_sample(|| w.step_checked());
            let mut crossed = false;
            for &id in &blocks {
                let state = w.body_state(id).unwrap();
                let [x, y, z] = state.pose.position;
                crossed |= x.abs() < 10. && z.abs() < 10. && y < -1.;
                if frame >= 240 {
                    let [vx, vy, vz] = state.linear_velocity;
                    output.tail_speed = output.tail_speed.max((vx * vx + vy * vy + vz * vz).sqrt());
                }
            }
            output.record(&w, frame, result.err(), crossed, elapsed);
        }
        output.report(&w, "box-stack", mode);
    }
}
