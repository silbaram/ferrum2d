//! P1a rigid-body experiment. Release runs also time the calls that advance physics.
use super::*;
use crate::collision_event::{COLLISION_EVENT_ENTER, COLLISION_EVENT_TRIGGER_ENTER};
use crate::components::{
    DistanceJoint, GearJoint, PrismaticJoint, RevoluteJoint, RopeJoint, SpringJoint, Transform2D,
    WeldJoint,
};
use crate::physics3d::p1b_tests::TraceHash;
use crate::physics3d::{
    BodyDesc, BodyId, BodyKind, ColliderDesc, ColliderId, OverlapSample, PhysicsWorld3d, Pose,
    Shape,
};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Debug;
use std::time::Instant;

const FRAMES: usize = 300;
const BRICK_HALF_EXTENTS: [f32; 2] = [26., 9.];

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
    if matches!(mode, Mode::Current) {
        world.force_rigid_motion_proof();
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
            self.errors,
            self.first_error,
            self.stalls,
            self.first_stall,
            self.first_crossing,
            self.overlap,
            self.initial_overlap,
            self.ccd_clamps,
            self.tail_speed,
            self.joint_error,
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

fn crosses_chain_downward(path: [Transform2D; 2], chain: &[[f32; 2]]) -> bool {
    let [before, after] = path;
    chain.windows(2).any(|segment| {
        let [[ax, ay], [bx, by]] = [segment[0], segment[1]];
        // The gallery chain is authored from left to right, with +y down.
        let side = |p: Transform2D| (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax);
        let start = side(before);
        let end = side(after);
        if start > 0. || end <= 0. {
            return false;
        }
        let x = before.x + (after.x - before.x) * (start / (start - end));
        (ax..=bx).contains(&x)
    })
}

fn gallery_chain(bodies: &[Body]) -> Vec<[f32; 2]> {
    let (position, vertices) = bodies
        .iter()
        .find_map(|body| match body.collider {
            Collider::Chain(vertices) => Some((body.position, vertices)),
            _ => None,
        })
        .expect("the collider gallery has an authored chain");
    vertices
        .chunks_exact(2)
        .map(|point| [point[0] + position[0], point[1] + position[1]])
        .collect()
}

type OverlapTick = (usize, bool, OverlapSample);

#[derive(Default)]
struct RigidOverlapTrace {
    by_pair: BTreeMap<[ColliderId; 2], Vec<OverlapTick>>,
    tail_full_ticks: usize,
}

impl RigidOverlapTrace {
    fn record(&mut self, world: &PhysicsWorld3d, frame: usize, full: bool) {
        self.tail_full_ticks += usize::from(frame >= FRAMES - 60 && full);
        world.p1a_visit_overlaps(|s| {
            self.by_pair
                .entry(s.bodies.map(|b| b.collider))
                .or_default()
                .push((frame, full, s));
        });
    }

    fn report(&self, name: &str, mode: Mode) {
        let rows = || self.by_pair.values().flatten();
        let tail = || rows().filter(|(tick, _, _)| *tick >= FRAMES - 60);
        let tail_full = || tail().filter(|(_, full, _)| *full);
        let tail_rest = tail_full()
            .filter(|(_, _, sample)| {
                sample.bodies.iter().all(|b| {
                    let speed = |v: [f32; 3]| v.into_iter().map(|x| x * x).sum::<f32>().sqrt();
                    speed(b.velocity) <= 0.01 && speed(b.angular) <= 0.01
                })
            })
            .map(|r| r.2.depth)
            .reduce(f32::max);
        let tail_full = tail_full().map(|r| r.2.depth).reduce(f32::max);
        let tail = tail().map(|r| r.2.depth).reduce(f32::max);
        let filtered = rows()
            .filter_map(|r| (!r.2.solver_allowed).then_some(r.2.depth))
            .reduce(f32::max);
        println!("P1A_OVERLAP scene={name} mode={mode:?} tail={tail:?} tail_full={tail_full:?} tail_rest={tail_rest:?} tail_full_ticks={} denied={filtered:?}", self.tail_full_ticks);
        let Some(&(tick, _, peak)) =
            rows().max_by(|a, b| a.2.depth.total_cmp(&b.2.depth).then_with(|| b.0.cmp(&a.0)))
        else {
            return;
        };
        let rows = &self.by_pair[&peak.bodies.map(|b| b.collider)];
        let at = rows.iter().position(|r| r.0 == tick).unwrap();
        let mut start = at;
        let mut end = at;
        while start > 0 && rows[start - 1].0 + 1 == rows[start].0 {
            start -= 1;
        }
        while end + 1 < rows.len() && rows[end].0 + 1 == rows[end + 1].0 {
            end += 1;
        }
        let run = &rows[start..=end];
        let full = run.iter().filter(|r| r.1).count();
        let deep_full = run.iter().filter(|r| r.1 && r.2.depth >= 1.).count();
        let first_solver = run
            .iter()
            .find_map(|r| r.2.solver_depth.map(|depth| (r.0, depth)));
        println!("P1A_PEAK scene={name} mode={mode:?} tick={tick} depth={} normal={:?} allowed={} solver_depth={:?} first_solver={first_solver:?} overlap_ticks={} full_ticks={full} depth_at_least_one_full_ticks={deep_full} from={} to={}", peak.depth, peak.normal, peak.solver_allowed, peak.solver_depth, run.len(), rows[start].0, rows[end].0);
        for body in peak.bodies {
            println!("P1A_PAIR scene={name} mode={mode:?} body={:?} collider={:?} kind={:?} shape={:?} position={:?} velocity={:?} angular={:?} ccd_active={} ccd_thickness={}", body.id, body.collider, body.kind, body.shape, body.position, body.velocity, body.angular, body.ccd_active, body.ccd_thickness);
        }
    }
}

#[test]
fn p1a_probes_detect_crossings_near_chain_vertices() {
    let chain = gallery_chain(&collider_gallery());
    for x in [145., 230., 250., 365.] {
        let path = [Transform2D { x, y: 310. }, Transform2D { x, y: 412. }];
        assert!(crosses_chain_downward(path, &chain), "missed x={x}");
    }
    assert!(!crosses_chain_downward(
        [
            Transform2D { x: 110., y: 377. },
            Transform2D { x: 130., y: 392. }
        ],
        &chain,
    ));
}

fn run_sandbox(name: &str, bodies: &[Body], gravity: f32, iterations: [u32; 2]) {
    let chain = (name == "collider-gallery").then(|| gallery_chain(bodies));
    for mode in MODES {
        let (mut e, entities) = sandbox_engine(bodies, gravity, iterations);
        let tracked: Vec<_> = bodies
            .iter()
            .zip(&entities)
            .filter_map(|(body, &entity)| body.dynamic.then_some(entity))
            .collect();
        configure_experiment(&mut e.unified_physics.as_mut().unwrap().physics, mode);
        let mut output = Measurements::new(physics(&e));
        let mut overlaps = RigidOverlapTrace::default();
        let mut before = Vec::with_capacity(tracked.len());
        for frame in 0..FRAMES {
            e.update(1. / 60.);
            if chain.is_some() {
                before.clear();
                before.extend(tracked.iter().map(|&id| e.world.transform(id).unwrap()));
            }
            let (_, elapsed) = step_sample(|| sandbox_step(&mut e, gravity, iterations));
            let error = e.take_unified_physics_error();
            overlaps.record(physics(&e), frame, error.is_none());
            let crossed = past_sandbox_floor(&e, &tracked)
                || chain.as_ref().is_some_and(|chain| {
                    tracked.iter().zip(&before).any(|(&id, &start)| {
                        crosses_chain_downward([start, e.world.transform(id).unwrap()], chain)
                    })
                });
            output.record(physics(&e), frame, error, crossed, elapsed);
        }
        output.report(physics(&e), name, mode);
        overlaps.report(name, mode);
    }
}

#[test]
#[ignore = "P2a compares first-contact geometry and release step costs"]
fn p2a_compare_soft_ccd_at_first_contact() {
    let materials = rigid_materials();
    let contacts = contacts_sensors();
    let gallery = collider_gallery();
    for (name, bodies, gravity, iterations) in [
        ("rigid-materials", materials.as_slice(), 860., [8, 6]),
        ("contacts-sensors", contacts.as_slice(), 820., [8, 7]),
        ("collider-gallery", gallery.as_slice(), 640., [8, 6]),
    ] {
        for fraction in [0., 0.5] {
            let mut expected = None;
            for repeat in 0..2 {
                let (mut e, entities) = sandbox_engine(bodies, gravity, iterations);
                let ids: Vec<_> = entities
                    .iter()
                    .map(|&id| e.unified_body_id(id).unwrap())
                    .collect();
                e.unified_physics
                    .as_mut()
                    .unwrap()
                    .physics
                    .p2a_set_soft_ccd_fraction(fraction);
                assert!(!physics(&e).p1a_uses_motion_proof());
                let tracked: Vec<_> = bodies
                    .iter()
                    .zip(&entities)
                    .filter_map(|(body, &id)| body.dynamic.then_some(id))
                    .collect();
                let chain = (name == "collider-gallery").then(|| gallery_chain(bodies));
                let mut starts = BTreeSet::new();
                let mut active = BTreeSet::new();
                let mut first = (0_f32, 0, None);
                let mut peak = 0_f32;
                let mut episodes = 0;
                let mut sum = 0.;
                let mut max = 0_f64;
                let mut hash = TraceHash::new();
                for tick in 0..FRAMES {
                    e.update(1. / 60.);
                    let previous: Vec<_> = tracked
                        .iter()
                        .map(|&id| e.world.transform(id).unwrap())
                        .collect();
                    let (_, elapsed) = step_sample(|| sandbox_step(&mut e, gravity, iterations));
                    assert_eq!(
                        e.take_unified_physics_error(),
                        None,
                        "{name} {fraction} tick {tick}"
                    );
                    assert!(!past_sandbox_floor(&e, &tracked));
                    if let Some(chain) = &chain {
                        for (&id, before) in tracked.iter().zip(previous) {
                            assert!(
                                !crosses_chain_downward(
                                    [before, e.world.transform(id).unwrap()],
                                    chain
                                ),
                                "{name} {fraction} tick {tick}"
                            );
                        }
                    }
                    physics(&e).p1a_visit_overlaps(|sample| {
                        if !sample.solver_allowed {
                            return;
                        }
                        let pair = sample.bodies.map(|b| b.collider);
                        active.insert(pair);
                        peak = peak.max(sample.depth);
                        if !starts.contains(&pair) {
                            episodes += 1;
                            if sample.depth > first.0 {
                                first = (sample.depth, tick, Some(sample.bodies));
                            }
                        }
                    });
                    std::mem::swap(&mut starts, &mut active);
                    active.clear();
                    for &body in &ids {
                        hash.body(physics(&e), body);
                    }
                    sum += elapsed;
                    max = max.max(elapsed);
                }
                let hash = hash.finish();
                if let Some(expected) = expected {
                    assert_eq!(hash, expected, "{name} soft={fraction}");
                } else {
                    expected = Some(hash);
                }
                let timing = (!cfg!(debug_assertions)).then_some((sum / FRAMES as f64, max));
                println!("P2A_SOFT scene={name} fraction={fraction} repeat={repeat} first_depth={:.7} first_tick={} episodes={episodes} peak={peak:.7} hash={hash:016x} timing_us={timing:?} first_pair={:?}", first.0,first.1, first.2);
            }
        }
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

fn crosses_box_interior([before, after]: [Transform2D; 2], body: &Body) -> bool {
    if body.trigger {
        return false;
    }
    let Collider::Box([half_width, half_height]) = body.collider else {
        unreachable!("the breakout obstacles are axis-aligned boxes");
    };
    let [x, y] = body.position;
    // Clip the center's segment to the open interior. Edge-only contact is not a crossing.
    let mut entry = 0_f32;
    let mut exit = 1_f32;
    for (from, to, min, max) in [
        (before.x, after.x, x - half_width, x + half_width),
        (before.y, after.y, y - half_height, y + half_height),
    ] {
        if from == to {
            if from <= min || from >= max {
                return false;
            }
            continue;
        }
        let a = (min - from) / (to - from);
        let b = (max - from) / (to - from);
        entry = entry.max(a.min(b));
        exit = exit.min(a.max(b));
        if entry >= exit {
            return false;
        }
    }
    true
}

#[test]
fn p1a_probes_detect_crossings_at_brick_edges() {
    let brick = Body::new(
        false,
        [404., 168.],
        Collider::Box(BRICK_HALF_EXTENTS),
        [0., 0., 1.],
    );
    let vertical_path = |x| {
        [187., 182., 177., 172., 167., 162., 157., 152., 147.]
            .windows(2)
            .any(|y| {
                crosses_box_interior(
                    [Transform2D { x, y: y[0] }, Transform2D { x, y: y[1] }],
                    &brick,
                )
            })
    };
    assert!(vertical_path(426.));
    assert!(!vertical_path(430.));
    assert!(crosses_box_interior(
        [
            Transform2D { x: 376., y: 174. },
            Transform2D { x: 432., y: 174. }
        ],
        &brick,
    ));
}

#[test]
fn breakout_gap_runs_300_ticks_without_errors_or_tunneling() {
    let (output, completed_ticks) = run_breakout_gap(Mode::Rapier);
    assert_eq!(output.first_error, None, "step errors: {:?}", output.errors);
    assert_eq!(
        completed_ticks, FRAMES,
        "the native world must advance on each tick"
    );
    assert_eq!(
        output.first_crossing, None,
        "the ball crossed a solid fixture"
    );
    assert!(
        output.ccd_clamps > 0,
        "the scene must exercise continuous collision detection"
    );
}

#[test]
#[ignore = "P1a measures 300 attempts per mode"]
fn p1a_compare_breakout_gap() {
    for mode in MODES {
        run_breakout_gap(mode);
    }
}

fn run_breakout_gap(mode: Mode) -> (Measurements, usize) {
    const GAP: [f32; 2] = [348., 168.];
    const SPEED: f32 = 300.;
    const PADDLE_REACH: f32 = 56. + 6.;
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
    let paddle_body = wall([320., 344.], [56., 6.]);
    let paddle = spawn_kind(&mut e, &paddle_body, 1);
    let mut bricks = Vec::new();
    for row in 0..5 {
        for column in 0..10 {
            let p = [68. + 56. * column as f32, 72. + 24. * row as f32];
            let body = wall(p, BRICK_HALF_EXTENTS);
            let brick = spawn(&mut e, &body);
            if p == GAP {
                assert!(e.despawn_physics_entity(brick.id, brick.generation));
            } else {
                bricks.push((brick, body));
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
    let mut completed_ticks = 0;
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
        if error.is_none() && e.unified_physics_frame_statistics().unwrap().fixed_steps == 1 {
            completed_ticks += 1;
        }
        let p = e.world.transform(ball).unwrap();
        let crossing = static_bodies
            .iter()
            .chain(std::iter::once(&paddle_body))
            .chain(bricks.iter().map(|(_, body)| body))
            .any(|body| crosses_box_interior([before, p], body));
        let [half_width, half_height] = BRICK_HALF_EXTENTS;
        gap_frames +=
            usize::from((p.x - GAP[0]).abs() < half_width && (p.y - GAP[1]).abs() < half_height);
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
    println!("P1A_BREAKOUT mode={mode:?} completed_ticks={completed_ticks} gap_frames={gap_frames} bricks_hit={hits}");
    output.report(physics(&e), "breakout-gap", mode);
    (output, completed_ticks)
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
fn p1a_probes_require_stack_support_when_boxes_are_still() {
    for (upper, expected) in [
        ([0., 1.5, 0.], true),
        ([2., 0.5, 0.], false),
        ([0., 1.7, 0.], false),
    ] {
        let mut w = spatial_world();
        let floor = create_stack_box(&mut w, BodyKind::Fixed, [0., -0.5, 0.], [10., 0.5, 10.]);
        let blocks = [
            create_stack_box(&mut w, BodyKind::Dynamic, [0., 0.5, 0.], [0.5; 3]),
            create_stack_box(&mut w, BodyKind::Dynamic, upper, [0.5; 3]),
        ];
        assert!(blocks.iter().all(|&id| {
            let state = w.body_state(id).unwrap();
            state.linear_velocity == [0.; 3] && state.angular_velocity == [0.; 3]
        }));
        assert_eq!(
            w.p1a_stack_is_supported(floor, &blocks),
            expected,
            "upper={upper:?}"
        );
    }
}

fn create_stack_box(
    w: &mut PhysicsWorld3d,
    kind: BodyKind,
    position: [f32; 3],
    half_extents: [f32; 3],
) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: Pose {
                position,
                ..Pose::default()
            },
            ccd: kind == BodyKind::Dynamic,
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box { half_extents }),
    )
    .unwrap()
}

#[test]
#[ignore = "P1a measures 300 attempts per mode"]
fn p1a_compare_box_stack() {
    for mode in MODES {
        let mut w = spatial_world();
        let floor = create_stack_box(&mut w, BodyKind::Fixed, [0., -0.5, 0.], [10., 0.5, 10.]);
        let blocks: Vec<_> = (0..8)
            .map(|level| {
                create_stack_box(
                    &mut w,
                    BodyKind::Dynamic,
                    [0., 0.55 + 1.03 * level as f32, 0.],
                    [0.5; 3],
                )
            })
            .collect();
        configure_experiment(&mut w, mode);
        let mut output = Measurements::new(&w);
        let mut tail_supported_frames = 0;
        let mut tail_angular_speed = 0_f32;
        let magnitude = |[x, y, z]: [f32; 3]| (x * x + y * y + z * z).sqrt();
        for frame in 0..FRAMES {
            let (result, elapsed) = step_sample(|| w.step_checked());
            let mut crossed = false;
            for &id in &blocks {
                let state = w.body_state(id).unwrap();
                let [x, y, z] = state.pose.position;
                crossed |= x.abs() < 10. && z.abs() < 10. && y < -1.;
                if frame >= FRAMES - 60 {
                    output.tail_speed = output.tail_speed.max(magnitude(state.linear_velocity));
                    tail_angular_speed = tail_angular_speed.max(magnitude(state.angular_velocity));
                }
            }
            if frame >= FRAMES - 60 && w.p1a_stack_is_supported(floor, &blocks) {
                tail_supported_frames += 1;
            }
            output.record(&w, frame, result.err(), crossed, elapsed);
        }
        let final_supported = w.p1a_stack_is_supported(floor, &blocks);
        println!(
            "P1A_STACK mode={mode:?} final_supported={final_supported} tail_supported_frames={tail_supported_frames} tail_angular_speed={tail_angular_speed:.7}"
        );
        output.report(&w, "box-stack", mode);
    }
}
