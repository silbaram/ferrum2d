use super::*;
use crate::components::{
    ChainCollider, CompoundCollider, CompoundColliderShape, HeightSpan, PhysicsFloorId,
    MAX_CHAIN_COLLIDER_VERTICES,
};

const STEP: f32 = 1.0 / 60.0;

fn body(world: &mut World, x: f32, dynamic: bool, primary_y: f32) -> Entity {
    let entity =
        spawn_kinematic_body_with_size(world, x, 0.0, CollisionLayer::Wall, false, 0.2, 0.2);
    world.set_aabb_collider(entity, box_shape(0.0, primary_y));
    world.set_collision_filter(
        entity,
        CollisionFilter::new(CollisionMask::ALL, CollisionMask::ALL),
    );
    world.set_rigid_body(
        entity,
        (if dynamic {
            RigidBody::dynamic(1.0)
        } else {
            RigidBody::static_body()
        })
        .with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    if dynamic {
        world.set_velocity(entity, Velocity { vx: 600.0, vy: 0.0 });
    }
    entity
}

fn box_shape(x: f32, y: f32) -> AabbCollider {
    AabbCollider::new(0.2, 0.2, false, CollisionLayer::Wall).with_offset(x, y)
}

fn secondary(world: &mut World, entity: Entity, collider: AabbCollider) -> u32 {
    world
        .add_compound_collider(
            entity,
            CompoundCollider::new(CompoundColliderShape::Aabb(collider)),
        )
        .expect("valid compound collider")
}

fn step(world: &mut World) -> RigidBodyStepStats {
    PhysicsSystem::step_rigid_bodies_with_config(
        world,
        STEP,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            continuous: true,
            ..Default::default()
        },
    )
}

fn assert_stopped(world: &World, entity: Entity, expected_x: f32, stats: RigidBodyStepStats) {
    assert!(stats.ccd_hits > 0, "expected a CCD hit, got {stats:?}");
    let x = world.transform(entity).unwrap().x;
    assert!(
        (x - expected_x).abs() < 0.002,
        "expected x={expected_x}, got x={x}"
    );
    assert!(world.velocity(entity).unwrap().vx.abs() < 0.001);
}

#[test]
fn ccd_sweeps_secondary_moving_collider() {
    let mut world = World::default();
    let mover = body(&mut world, 0.0, true, 10.0);
    secondary(&mut world, mover, box_shape(0.0, 0.0));
    body(&mut world, 5.0, false, 0.0);
    let stats = step(&mut world);
    assert_stopped(&world, mover, 4.6, stats);
}

#[test]
fn ccd_sweeps_secondary_target_collider() {
    let mut world = World::default();
    let mover = body(&mut world, 0.0, true, 0.0);
    let wall = body(&mut world, 5.0, false, 10.0);
    secondary(&mut world, wall, box_shape(0.0, 0.0));
    let stats = step(&mut world);
    assert_stopped(&world, mover, 4.6, stats);
}

#[test]
fn ccd_respects_secondary_filters_when_primary_filters_reject() {
    let mut world = World::default();
    let mover = body(&mut world, 0.0, true, 10.0);
    let wall = body(&mut world, 5.0, false, 10.0);
    for entity in [mover, wall] {
        world.set_collision_filter(
            entity,
            CollisionFilter::new(CollisionMask::NONE, CollisionMask::NONE),
        );
        assert_eq!(
            world.add_compound_collider(
                entity,
                CompoundCollider::new(CompoundColliderShape::Aabb(box_shape(0.0, 0.0)))
                    .with_filter(CollisionFilter::new(CollisionMask::ALL, CollisionMask::ALL))
            ),
            Some(1)
        );
    }
    let stats = step(&mut world);
    assert_stopped(&world, mover, 4.6, stats);
}

#[test]
fn ccd_solid_secondary_survives_disabled_or_trigger_primary() {
    for moving_primary in [true, false] {
        for trigger in [true, false] {
            let mut world = World::default();
            let mover = body(&mut world, 0.0, true, 0.0);
            let wall = body(&mut world, 5.0, false, 0.0);
            let compound = if moving_primary { mover } else { wall };
            let mut primary = box_shape(0.0, 0.0);
            primary.is_trigger = trigger;
            primary.enabled = trigger;
            world.set_aabb_collider(compound, primary);
            secondary(&mut world, compound, box_shape(0.0, 0.0));
            let stats = step(&mut world);
            assert_stopped(&world, mover, 4.6, stats);
        }
    }
}

#[test]
fn ccd_ignores_disabled_trigger_and_filtered_secondary_targets() {
    for excluded in 0..3 {
        let mut world = World::default();
        let mover = body(&mut world, 0.0, true, 0.0);
        let ghost = body(&mut world, 3.0, false, 10.0);
        let mut shape = box_shape(0.0, 0.0);
        shape.enabled = excluded != 0;
        shape.is_trigger = excluded == 1;
        let collider = CompoundCollider::new(CompoundColliderShape::Aabb(shape)).with_filter(
            CollisionFilter::new(
                CollisionMask::ALL,
                if excluded == 2 {
                    CollisionMask::NONE
                } else {
                    CollisionMask::ALL
                },
            ),
        );
        assert_eq!(world.add_compound_collider(ghost, collider), Some(1));
        body(&mut world, 7.0, false, 0.0);
        let stats = step(&mut world);
        assert_stopped(&world, mover, 6.6, stats);
        assert_ne!(
            world.rigid_body_ccd_debug_hit_at(0).unwrap().target_entity,
            ghost
        );
    }
}

#[test]
fn ccd_ignores_disabled_trigger_and_filtered_secondary_moving_colliders() {
    for excluded in 0..3 {
        let mut world = World::default();
        let mover = body(&mut world, 0.0, true, 0.0);
        let mut shape = box_shape(2.0, 0.0);
        shape.enabled = excluded != 0;
        shape.is_trigger = excluded == 1;
        let collider = CompoundCollider::new(CompoundColliderShape::Aabb(shape)).with_filter(
            CollisionFilter::new(
                CollisionMask::ALL,
                if excluded == 2 {
                    CollisionMask::NONE
                } else {
                    CollisionMask::ALL
                },
            ),
        );
        assert_eq!(world.add_compound_collider(mover, collider), Some(1));
        body(&mut world, 7.0, false, 0.0);
        let stats = step(&mut world);
        assert_stopped(&world, mover, 6.6, stats);
    }
}

#[test]
fn ccd_selects_earliest_moving_and_target_colliders() {
    for moving_secondary in [true, false] {
        let mut world = World::default();
        let mover = body(&mut world, 0.0, true, 0.0);
        let wall = body(&mut world, 7.0, false, 0.0);
        if moving_secondary {
            secondary(&mut world, mover, box_shape(2.0, 0.0));
        } else {
            secondary(&mut world, wall, box_shape(-2.0, 0.0));
        }
        let stats = step(&mut world);
        assert_stopped(&world, mover, 4.6, stats);
    }
}

#[test]
fn ccd_uses_secondary_collider_restitution() {
    for moving_material in [true, false] {
        let mut world = World::default();
        let mover = body(
            &mut world,
            0.0,
            true,
            if moving_material { 10.0 } else { 0.0 },
        );
        let wall = body(
            &mut world,
            5.0,
            false,
            if moving_material { 0.0 } else { 10.0 },
        );
        let compound = if moving_material { mover } else { wall };
        let index = secondary(&mut world, compound, box_shape(0.0, 0.0));
        assert!(world.set_compound_collider_material(
            compound,
            index,
            PhysicsMaterial::new(1.0, 0.0)
        ));
        let stats = step(&mut world);
        assert!(stats.ccd_hits > 0);
        let vx = world.velocity(mover).unwrap().vx;
        assert!(
            (vx + 600.0).abs() < 0.001,
            "secondary restitution should bounce, got {vx}"
        );
    }
}

#[test]
fn ccd_selects_later_chain_segment() {
    let mut world = World::default();
    let mover = body(&mut world, 0.0, true, 0.0);
    let wall = body(&mut world, 5.0, false, 10.0);
    let mut vertices = [Transform2D::default(); MAX_CHAIN_COLLIDER_VERTICES];
    vertices[..3].copy_from_slice(&[
        Transform2D { x: 0.0, y: 5.0 },
        Transform2D { x: 0.0, y: 3.0 },
        Transform2D { x: 0.0, y: -3.0 },
    ]);
    world.set_chain_collider(
        wall,
        ChainCollider::new(vertices, 3, false, false, CollisionLayer::Wall),
    );
    let stats = step(&mut world);
    assert_stopped(&world, mover, 4.8, stats);
}

#[test]
fn ccd_sweeps_later_moving_chain_segment() {
    let mut world = World::default();
    let mover = body(&mut world, 0.0, true, 0.0);
    body(&mut world, 5.0, false, 0.0);
    let mut vertices = [Transform2D::default(); MAX_CHAIN_COLLIDER_VERTICES];
    vertices[..3].copy_from_slice(&[
        Transform2D { x: 0.0, y: 5.0 },
        Transform2D { x: 0.0, y: 3.0 },
        Transform2D { x: 0.0, y: -3.0 },
    ]);
    world.set_chain_collider(
        mover,
        ChainCollider::new(vertices, 3, false, false, CollisionLayer::Wall),
    );
    let stats = step(&mut world);
    assert_stopped(&world, mover, 4.8, stats);
}

#[test]
fn ccd_secondary_contact_wakes_dynamic_target() {
    let mut world = World::default();
    let mover = body(&mut world, 0.0, true, 0.0);
    let target = body(&mut world, 5.0, true, 10.0);
    secondary(&mut world, target, box_shape(0.0, 0.0));
    world.set_velocity(target, Velocity::default());
    let mut sleeping = world.rigid_body(target).unwrap();
    sleeping.is_sleeping = true;
    sleeping.sleep_timer_seconds = 0.5;
    world.set_rigid_body(target, sleeping);
    let stats = step(&mut world);
    assert_eq!(stats.bodies_woken, 1);
    assert!(!world.rigid_body(target).unwrap().is_sleeping);
    for entity in [mover, target] {
        assert!((world.velocity(entity).unwrap().vx - 300.0).abs() < 0.001);
    }
    assert!(world.transform(mover).unwrap().x <= world.transform(target).unwrap().x - 0.399);
}

#[test]
fn ccd_secondary_colliders_obey_height_filter() {
    let mut world = World::default();
    let mover = body(&mut world, 0.0, true, 10.0);
    secondary(&mut world, mover, box_shape(0.0, 0.0));
    let wall = body(&mut world, 5.0, false, 10.0);
    secondary(&mut world, wall, box_shape(0.0, 0.0));
    assert!(world.set_height_span(mover, HeightSpan::new(PhysicsFloorId(0), 0.0, 1.0).unwrap()));
    assert!(world.set_height_span(wall, HeightSpan::new(PhysicsFloorId(1), 0.0, 1.0).unwrap()));
    let stats = step(&mut world);
    assert_eq!(stats.ccd_hits, 0);
    assert!((world.transform(mover).unwrap().x - 10.0).abs() < 0.001);
}

#[test]
fn ccd_equal_time_colliders_choose_stable_material() {
    let mut world = World::default();
    let mover = body(&mut world, 0.0, true, 0.0);
    let wall = body(&mut world, 5.0, false, 10.0);
    secondary(&mut world, wall, box_shape(0.0, 0.0));
    let later = secondary(&mut world, wall, box_shape(0.0, 0.0));
    assert!(world.set_compound_collider_material(wall, later, PhysicsMaterial::new(1.0, 0.0)));
    let stats = step(&mut world);
    assert_stopped(&world, mover, 4.6, stats);
}

#[test]
fn primary_trigger_does_not_disable_solid_secondary_in_discrete_solver() {
    for solid_secondary in [true, false] {
        let mut world = World::default();
        let mover = body(&mut world, 4.8, true, 0.0);
        let mut sensor = box_shape(0.0, 0.0);
        sensor.is_trigger = true;
        world.set_aabb_collider(mover, sensor);
        world.set_velocity(mover, Velocity::default());
        if solid_secondary {
            secondary(&mut world, mover, box_shape(0.0, 0.0));
        }
        body(&mut world, 5.0, false, 0.0);
        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            STEP,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                continuous: false,
                ..Default::default()
            },
        );
        if solid_secondary {
            assert!(stats.position_corrections > 0);
            assert!(world.transform(mover).unwrap().x < 4.75);
        } else {
            assert_eq!(stats.position_corrections, 0);
            assert_eq!(world.transform(mover).unwrap().x, 4.8);
        }
    }
}
