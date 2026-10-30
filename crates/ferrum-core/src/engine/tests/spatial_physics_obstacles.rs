use super::{data_scene_visuals::sprite, *};
use crate::components::{
    CapsuleCollider, ChainCollider, CircleCollider, CompoundCollider, CompoundColliderShape,
    ConvexPolygonCollider, EdgeCollider, HeightSpan, PhysicsFloorId, MAX_CHAIN_COLLIDER_VERTICES,
    MAX_CONVEX_POLYGON_VERTICES,
};
use crate::physics::{KinematicSweepScratch, PhysicsCounters, PhysicsSystem};

fn setup() -> (Engine, Entity) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = sprite(&mut engine, 71, 16.0, 16.0, 0);
    engine.world.set_aabb_collider(
        actor,
        AabbCollider::new(2.0, 2.0, false, CollisionLayer::Player),
    );
    assert!(engine.configure_data_scene_body(actor.id, actor.generation, 1, true, 0, 0.0, 8.0));
    assert!(engine.configure_spatial_terrain(
        &[0., 0., 128., 64., 0., 0., 0., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    (engine, actor)
}

fn obstacle(engine: &mut Engine, shape: CompoundColliderShape, secondary: bool) -> Entity {
    obstacle_with_filter(
        engine,
        shape,
        secondary,
        CollisionFilter::new(CollisionMask::WALL, CollisionMask::ALL),
    )
}

fn obstacle_with_filter(
    engine: &mut Engine,
    shape: CompoundColliderShape,
    secondary: bool,
    filter: CollisionFilter,
) -> Entity {
    let entity = engine.world.spawn_entity();
    engine
        .world
        .set_transform(entity, Transform2D { x: 48.0, y: 16.0 });
    engine
        .world
        .set_rigid_body(entity, RigidBody::static_body());
    if secondary {
        engine.world.set_aabb_collider(
            entity,
            AabbCollider::new(2.0, 2.0, false, CollisionLayer::Wall).with_offset(0.0, 24.0),
        );
        engine.world.set_collision_filter(
            entity,
            CollisionFilter::new(CollisionMask::NONE, CollisionMask::NONE),
        );
    }
    assert!(engine
        .world
        .add_compound_collider(entity, CompoundCollider::new(shape).with_filter(filter))
        .is_some());
    assert!(engine.world.set_height_span(
        entity,
        HeightSpan::new(PhysicsFloorId(0), 0.0, 16.0).unwrap()
    ));
    entity
}

fn shapes() -> Vec<(CompoundColliderShape, f32)> {
    let mut vertices = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
    vertices[..4].copy_from_slice(&[
        Transform2D { x: -6.0, y: -6.0 },
        Transform2D { x: 6.0, y: -6.0 },
        Transform2D { x: 6.0, y: 6.0 },
        Transform2D { x: -6.0, y: 6.0 },
    ]);
    let mut chain = [Transform2D::default(); MAX_CHAIN_COLLIDER_VERTICES];
    chain[..3].copy_from_slice(&[
        Transform2D { x: 0.0, y: 18.0 },
        Transform2D { x: 0.0, y: 12.0 },
        Transform2D { x: 0.0, y: -6.0 },
    ]);
    vec![
        (
            CompoundColliderShape::Aabb(AabbCollider::new(6.0, 6.0, false, CollisionLayer::Wall)),
            40.0,
        ),
        (
            CompoundColliderShape::Circle(CircleCollider::new(6.0, false, CollisionLayer::Wall)),
            40.0,
        ),
        (
            CompoundColliderShape::Capsule(CapsuleCollider::new(
                0.0,
                -3.0,
                0.0,
                3.0,
                3.0,
                false,
                CollisionLayer::Wall,
            )),
            43.0,
        ),
        (
            CompoundColliderShape::ConvexPolygon(ConvexPolygonCollider::new(
                vertices,
                4,
                false,
                CollisionLayer::Wall,
            )),
            40.0,
        ),
        (
            CompoundColliderShape::Edge(EdgeCollider::new(
                0.0,
                -6.0,
                0.0,
                6.0,
                false,
                CollisionLayer::Wall,
            )),
            46.0,
        ),
        (
            CompoundColliderShape::Chain(ChainCollider::new(
                chain,
                3,
                false,
                false,
                CollisionLayer::Wall,
            )),
            46.0,
        ),
    ]
}

#[test]
fn spatial_actor_sweeps_all_supported_obstacle_shapes() {
    for (shape, expected_x) in shapes() {
        for cached in [false, true] {
            let (mut engine, actor) = setup();
            obstacle(&mut engine, shape, false);
            if cached {
                let mut scratch = KinematicSweepScratch::default();
                scratch.begin_spatial_query(&engine.world, actor);
                scratch.begin_spatial_segment(
                    &engine.world,
                    actor,
                    Transform2D { x: 16.0, y: 16.0 },
                    Transform2D { x: 80.0, y: 16.0 },
                );
                PhysicsSystem::move_navigation_actor_with_scratch(
                    &mut engine.world,
                    actor,
                    Velocity { vx: 64.0, vy: 0.0 },
                    CollisionMask::ALL,
                    &mut scratch,
                    &mut PhysicsCounters::default(),
                );
            } else {
                assert!(engine.move_spatial_body(actor.id, actor.generation, 64.0, 0.0, 4.0, 4.0));
            }
            let x = engine.world.transform(actor).unwrap().x;
            assert!(
                (x - expected_x).abs() < 0.01,
                "cached={cached}, shape={shape:?}, expected {expected_x}, got {x}"
            );
            assert_eq!(
                engine.world.height_span(actor).unwrap().floor,
                PhysicsFloorId(0)
            );
        }
    }
}

#[test]
fn spatial_actor_sweeps_secondary_shapes_with_their_own_filters() {
    for (shape, expected_x) in shapes() {
        let (mut engine, actor) = setup();
        obstacle(&mut engine, shape, true);
        assert!(engine.move_spatial_body(actor.id, actor.generation, 64.0, 0.0, 4.0, 4.0));
        let x = engine.world.transform(actor).unwrap().x;
        assert!(
            (x - expected_x).abs() < 0.01,
            "shape={shape:?}, expected {expected_x}, got {x}"
        );
    }
}

#[test]
fn spatial_obstacles_respect_sensors_disable_masks_floors_and_heights() {
    for excluded in 0..5 {
        let (mut engine, actor) = setup();
        let mut circle = CircleCollider::new(6.0, excluded == 0, CollisionLayer::Wall);
        circle.enabled = excluded != 1;
        let wall = obstacle_with_filter(
            &mut engine,
            CompoundColliderShape::Circle(circle),
            true,
            CollisionFilter::new(
                CollisionMask::WALL,
                if excluded == 2 {
                    CollisionMask::NONE
                } else {
                    CollisionMask::ALL
                },
            ),
        );
        match excluded {
            3 => {
                assert!(engine
                    .world
                    .set_height_span(wall, HeightSpan::new(PhysicsFloorId(1), 0.0, 16.0).unwrap()));
            }
            4 => {
                assert!(engine.world.set_height_span(
                    wall,
                    HeightSpan::new(PhysicsFloorId(0), 32.0, 16.0).unwrap()
                ));
            }
            _ => {}
        }
        assert!(engine.move_spatial_body(actor.id, actor.generation, 64.0, 0.0, 4.0, 4.0));
        assert_eq!(
            engine.world.transform(actor).unwrap().x,
            80.0,
            "excluded={excluded}"
        );
    }
}

#[test]
fn spatial_cached_queries_charge_each_compound_chain_segment() {
    let (mut engine, actor) = setup();
    let (shape, _) = shapes().pop().unwrap();
    let wall = obstacle(&mut engine, shape, true);
    assert!(engine
        .world
        .add_compound_collider(
            wall,
            CompoundCollider::new(CompoundColliderShape::Circle(
                CircleCollider::new(1.0, false, CollisionLayer::Wall).with_enabled(false)
            ))
        )
        .is_some());
    let mut scratch = KinematicSweepScratch::default();
    let count = scratch.begin_spatial_query(&engine.world, actor);
    assert_eq!(
        count, 3,
        "one primary plus two chain segments must be budgeted"
    );
    assert_eq!(
        scratch.preparation_visits(),
        7,
        "disabled collider visits still consume preparation work"
    );
    let count = scratch.begin_spatial_segment(
        &engine.world,
        actor,
        Transform2D { x: 16.0, y: 16.0 },
        Transform2D { x: 80.0, y: 16.0 },
    );
    assert_eq!(count, 3);
}
