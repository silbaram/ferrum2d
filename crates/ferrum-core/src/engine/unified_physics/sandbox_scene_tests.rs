//! Physics-sandbox Physics Spec scenes, applied in the SDK's authoring order.
//! Each scene uses the exact `examples/physics-sandbox/public/demos` values,
//! the default rigid native policy, a paused empty Data Scene and one manual
//! `stepRigidBodies(stepSeconds)` per frame, as the sandbox page does.
use super::*;
use crate::engine::{PHYSICS_LAYER_PLAYER, PHYSICS_LAYER_WALL};

mod p1a_tests;

#[derive(Clone, Copy)]
enum Collider<'a> {
    Box([f32; 2]),
    OrientedBox([f32; 2], f32),
    Circle(f32),
    Capsule([f32; 4], f32),
    Polygon(&'a [f32]),
    Chain(&'a [f32]),
}

struct Body<'a> {
    dynamic: bool,
    position: [f32; 2],
    collider: Collider<'a>,
    /// Friction, restitution, density.
    material: [f32; 3],
    /// Category and mask bits of the spec layer.
    layer: [u32; 2],
    trigger: bool,
    velocity: [f32; 2],
    rotation: f32,
    mass: Option<f32>,
    inertia: Option<f32>,
    gravity_scale: f32,
    angular_damping: f32,
    /// Compound circles: radius, local x offset and their own material.
    circles: &'a [(f32, f32, [f32; 3])],
}

impl<'a> Body<'a> {
    fn new(dynamic: bool, position: [f32; 2], collider: Collider<'a>, material: [f32; 3]) -> Self {
        Self {
            dynamic,
            position,
            collider,
            material,
            layer: if dynamic { [2, 3] } else { [1, 2] },
            trigger: false,
            velocity: [0.; 2],
            rotation: 0.,
            mass: None,
            inertia: None,
            gravity_scale: 1.,
            angular_damping: 0.,
            circles: &[],
        }
    }
}

fn spawn(e: &mut Engine, body: &Body) -> Entity {
    spawn_kind(e, body, if body.dynamic { 2 } else { 0 })
}

fn spawn_kind(e: &mut Engine, body: &Body, kind: u32) -> Entity {
    let layer = if body.dynamic {
        PHYSICS_LAYER_PLAYER
    } else {
        PHYSICS_LAYER_WALL
    };
    let (mass, density) = body.mass.map_or((body.material[2], true), |m| (m, false));
    let [x, y] = body.position;
    let [category, mask] = body.layer;
    let spawned = match body.collider {
        Collider::Box([w, h]) => e.spawn_physics_aabb_body(
            x,
            y,
            w,
            h,
            kind,
            mass,
            density,
            layer,
            category,
            mask,
            body.trigger,
            true,
            true,
            true,
        ),
        Collider::OrientedBox([w, h], r) => e.spawn_physics_oriented_box_body(
            x,
            y,
            w,
            h,
            r,
            kind,
            mass,
            density,
            layer,
            category,
            mask,
            body.trigger,
            true,
            true,
            true,
        ),
        Collider::Circle(r) => e.spawn_physics_circle_body(
            x,
            y,
            r,
            kind,
            mass,
            density,
            layer,
            category,
            mask,
            body.trigger,
            true,
            true,
            true,
        ),
        Collider::Capsule([ax, ay, bx, by], r) => e.spawn_physics_capsule_body(
            x, y, ax, ay, bx, by, r, kind, mass, density, layer, category, mask, false, true, true,
            true,
        ),
        Collider::Polygon(v) => e.spawn_physics_convex_polygon_body(
            x,
            y,
            v.to_vec(),
            0.,
            kind,
            mass,
            density,
            layer,
            category,
            mask,
            body.trigger,
            true,
            true,
            true,
        ),
        Collider::Chain(v) => e.spawn_physics_chain_body(
            x,
            y,
            v.to_vec(),
            false,
            kind,
            mass,
            density,
            layer,
            category,
            mask,
            body.trigger,
            true,
            true,
            true,
        ),
    };
    assert!(spawned);
    let h = Entity {
        id: e.physics_entity_id(),
        generation: e.physics_entity_generation(),
    };
    let [friction, restitution, density] = body.material;
    assert!(e.set_physics_collider_offset(h.id, h.generation, 0., 0.));
    assert!(e.set_physics_body_tuning(
        h.id,
        h.generation,
        body.gravity_scale,
        0.,
        body.angular_damping
    ));
    assert!(e.set_physics_body_material(
        h.id,
        h.generation,
        restitution,
        friction,
        0.,
        0.,
        density,
        1.,
        1.,
        1.,
        1.
    ));
    if !body.circles.is_empty() {
        // The primary collider names the body material again in the spec.
        assert!(e.set_physics_collider_material(
            h.id,
            h.generation,
            restitution,
            friction,
            0.,
            0.,
            density,
            1.,
            1.,
            1.,
            1.
        ));
    }
    e.set_physics_body_velocity(h.id, h.generation, body.velocity[0], body.velocity[1]);
    e.set_physics_body_rotation(h.id, h.generation, body.rotation);
    e.set_physics_body_angular_velocity(h.id, h.generation, 0.);
    if let Some(inertia) = body.inertia {
        assert!(e.set_physics_body_mass_properties(
            h.id,
            h.generation,
            body.mass.unwrap_or(density),
            inertia
        ));
    }
    for (index, &(radius, x, [friction, restitution, density])) in body.circles.iter().enumerate() {
        assert!(e.add_physics_circle_collider(
            h.id,
            h.generation,
            radius,
            x,
            0.,
            PHYSICS_LAYER_PLAYER,
            category,
            mask,
            false,
            true
        ));
        assert!(e.set_physics_compound_collider_material(
            h.id,
            h.generation,
            index as u32 + 1,
            restitution,
            friction,
            0.,
            0.,
            density,
            1.,
            1.,
            1.,
            1.
        ));
    }
    h
}

fn sandbox_engine(bodies: &[Body], gravity: f32, iterations: [u32; 2]) -> (Engine, Vec<Entity>) {
    let mut e = Engine::new();
    e.configure_unified_physics_defaults(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0., 700., 0.],
        step_seconds: 1. / 60.,
        length_unit: 1.,
        solver: crate::physics3d::SolverSettings {
            velocity_iterations: 8,
            position_iterations: 8,
            continuous: true,
            restitution_velocity_threshold: 1.,
        },
        ..Default::default()
    })
    .unwrap();
    e.use_data_scene();
    assert!(e.pause_data_scene());
    let entities = bodies.iter().map(|body| spawn(&mut e, body)).collect();
    e.configure_physics_spec_planar(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0., gravity, 0.],
        step_seconds: 1. / 60.,
        length_unit: 1.,
        solver: crate::physics3d::SolverSettings {
            velocity_iterations: iterations[0],
            position_iterations: iterations[1],
            continuous: true,
            restitution_velocity_threshold: 1.,
        },
        ..Default::default()
    })
    .unwrap();
    (e, entities)
}

fn sandbox_step(e: &mut Engine, gravity: f32, iterations: [u32; 2]) {
    e.step_rigid_bodies_with_config(
        1. / 60.,
        0.,
        gravity,
        iterations[0],
        iterations[1],
        0.8,
        0.01,
        1.,
        0.2,
        120.,
        false,
        true,
    );
}

fn assert_sandbox_advances(bodies: &[Body], gravity: f32, iterations: [u32; 2]) {
    let (mut engine, entities) = sandbox_engine(bodies, gravity, iterations);
    let dynamic: Vec<_> = bodies
        .iter()
        .zip(entities)
        .filter_map(|(body, entity)| body.dynamic.then_some(entity))
        .collect();
    for tick in 0..300 {
        engine.update(1. / 60.);
        sandbox_step(&mut engine, gravity, iterations);
        assert_eq!(engine.take_unified_physics_error(), None, "tick {tick}");
        assert!(
            !p1a_tests::past_sandbox_floor(&engine, &dynamic),
            "tick {tick}"
        );
    }
}

// The old proof path stopped when a metal slider reached a sleeping block.
#[test]
fn sandbox_rigid_materials_runs_without_stopping_the_world() {
    assert_sandbox_advances(&rigid_materials(), 860., [8, 6]);
}

fn rigid_materials() -> [Body<'static>; 8] {
    let platform = [0.92, 0., 1.];
    let wood = [0.96, 0.08, 0.8];
    let metal = [0., 0.02, 3.];
    let slider = |y, material, mass| Body {
        velocity: [180., 0.],
        mass: Some(mass),
        inertia: Some(50000.),
        angular_damping: 4.,
        ..Body::new(true, [130., y], Collider::Box([21., 15.]), material)
    };
    [
        Body::new(false, [400., 454.], Collider::Box([380., 12.]), platform),
        Body::new(false, [400., 266.], Collider::Box([340., 9.]), platform),
        Body::new(false, [400., 330.], Collider::Box([340., 9.]), platform),
        Body::new(false, [610., 216.], Collider::Box([85., 9.]), platform),
        slider(242., wood, 1.1),
        Body {
            velocity: [0., 300.],
            ..Body::new(true, [610., 92.], Collider::Circle(22.), [0.72, 0.92, 1.])
        },
        slider(306., metal, 2.6),
        Body {
            mass: Some(1.),
            gravity_scale: 0.,
            ..Body::new(true, [520., 306.], Collider::Box([23., 15.]), wood)
        },
    ]
}

// The old proof path stopped at a near-contact after the spinning box left the sensor.
#[test]
fn sandbox_contacts_sensors_runs_without_stopping_the_world() {
    assert_sandbox_advances(&contacts_sensors(), 820., [8, 7]);
}

fn contacts_sensors() -> [Body<'static>; 6] {
    let platform = [0.82, 0., 1.];
    let dynamic = [2, 7];
    [
        Body::new(false, [400., 454.], Collider::Box([380., 12.]), platform),
        Body {
            layer: [4, 2],
            trigger: true,
            ..Body::new(false, [400., 284.], Collider::Circle(82.), [0.1, 0., 0.1])
        },
        Body::new(
            false,
            [250., 340.],
            Collider::OrientedBox([95., 9.], 0.16),
            platform,
        ),
        Body::new(
            false,
            [548., 340.],
            Collider::OrientedBox([95., 9.], -0.16),
            platform,
        ),
        Body {
            layer: dynamic,
            velocity: [80., 0.],
            ..Body::new(
                true,
                [300., 84.],
                Collider::Box([20., 20.]),
                [0.58, 0.12, 0.9],
            )
        },
        Body {
            layer: dynamic,
            velocity: [-80., 0.],
            ..Body::new(true, [505., 80.], Collider::Circle(22.), [0.75, 0.45, 1.])
        },
    ]
}

// The old proof path stopped after the rotated box first hit the chain terrain.
#[test]
fn sandbox_collider_gallery_runs_without_stopping_the_world() {
    p1a_tests::assert_gallery_advances_without_crossing_the_chain();
}

fn collider_gallery() -> [Body<'static>; 8] {
    const RUBBER: [f32; 3] = [0.72, 0.5, 1.];
    let wood = [0.55, 0.18, 0.9];
    let metal = [0.32, 0.06, 2.4];
    let platform = [0.8, 0., 1.];
    const CHAIN: [f32; 12] = [
        -280., 10., -170., -34., -60., -8., 40., -42., 160., -12., 280., 8.,
    ];
    const POLYGON: [f32; 10] = [-24., -18., 20., -22., 32., 8., 0., 30., -28., 12.];
    [
        Body::new(false, [400., 454.], Collider::Box([380., 12.]), platform),
        Body::new(false, [400., 370.], Collider::Chain(&CHAIN), platform),
        Body::new(true, [145., 110.], Collider::Box([23., 18.]), wood),
        Body::new(true, [250., 100.], Collider::Circle(22.), RUBBER),
        Body::new(
            true,
            [365., 100.],
            Collider::Capsule([-24., 0., 24., 0.], 12.),
            RUBBER,
        ),
        Body {
            rotation: 0.24,
            ..Body::new(
                true,
                [482., 110.],
                Collider::OrientedBox([29., 14.], 0.42),
                metal,
            )
        },
        Body::new(true, [602., 98.], Collider::Polygon(&POLYGON), wood),
        Body {
            mass: Some(2.),
            circles: &[(13., -34., RUBBER), (13., 34., RUBBER)],
            ..Body::new(true, [690., 100.], Collider::Box([22., 13.]), metal)
        },
    ]
}
