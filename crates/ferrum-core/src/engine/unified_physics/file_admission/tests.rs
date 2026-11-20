use super::*;
use crate::components as c;
use crate::engine::persistence;
use crate::physics3d::{BodyDesc, ColliderDesc, JointDesc, JointKind, Pose, Shape, WorldConfig};

fn limits() -> Limits {
    Limits {
        max_work: 1_000_000,
        max_scratch_bytes: 1_000_000,
    }
}
fn engine(space: Space) -> Engine {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine
        .configure_unified_physics(WorldConfig {
            space,
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
    engine
}
fn explicit(engine: &mut Engine, x: f32) -> Entity {
    engine
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [x, 2.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.3 }),
            [0.0; 3],
        )
        .unwrap()
}
fn component(engine: &mut Engine, x: f32) -> Entity {
    let entity = engine.world.spawn_entity();
    engine
        .world
        .set_transform(entity, c::Transform2D { x, y: 2.0 });
    engine
        .world
        .set_rigid_body(entity, c::RigidBody::dynamic(1.0));
    engine.world.set_circle_collider(
        entity,
        c::CircleCollider::new(0.3, false, c::CollisionLayer::Player),
    );
    entity
}
fn check(engine: &Engine) -> Usage {
    // Exercise the native prerequisite independently. No native data is repaired.
    if let Some(runtime) = &engine.unified_physics {
        runtime.physics.capture_snapshot().unwrap();
    }
    let before = persistence::encode(engine).unwrap();
    let usage = validate_after_native_admission(engine, limits()).unwrap();
    assert_eq!(persistence::encode(engine).unwrap(), before);
    let restored = persistence::decode(&before).unwrap();
    assert_eq!(
        validate_after_native_admission(&restored, limits()).unwrap(),
        usage
    );
    assert_eq!(persistence::encode(&restored).unwrap(), before);
    usage
}
fn continuation(engine: &mut Engine) {
    check(engine);
    let mut restored = persistence::decode(&persistence::encode(engine).unwrap()).unwrap();
    for _ in 0..6 {
        let dt = engine.fixed_timestep.config().step_seconds;
        engine.step_rigid_bodies(dt);
        restored.step_rigid_bodies(dt);
        check(engine);
        check(&restored);
        assert_eq!(
            persistence::encode(engine).unwrap(),
            persistence::encode(&restored).unwrap()
        );
    }
}
fn reject(engine: &Engine, expected: Error) {
    // Native admission still passes. Only Engine ownership/index state is malformed.
    engine
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .capture_snapshot()
        .unwrap();
    let before = persistence::encode(engine).unwrap();
    assert_eq!(
        validate_after_native_admission(engine, limits()),
        Err(expected)
    );
    assert_eq!(persistence::encode(engine).unwrap(), before);
    let decoded = persistence::decode(&before).unwrap();
    assert_eq!(
        validate_after_native_admission(&decoded, limits()),
        Err(expected)
    );
    assert_eq!(persistence::encode(&decoded).unwrap(), before);
    // Malformed decoded candidates only reach this guard, never step/query/commit.
}

#[test]
fn file_bindings_builtin_and_explicit_native_ownership_replays_without_repair() {
    let mut builtin = Engine::new();
    check(&builtin);
    builtin.use_breakout_scene();
    check(&builtin);
    builtin.use_platformer_scene();
    check(&builtin);
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space);
        check(&e);
        let a = explicit(&mut e, 0.0);
        let b = explicit(&mut e, 2.0);
        let runtime = e.unified_physics.as_mut().unwrap();
        let body_a = runtime.bindings[&(a.id, a.generation)].body;
        let body_b = runtime.bindings[&(b.id, b.generation)].body;
        runtime
            .physics
            .add_collider(body_a, ColliderDesc::new(Shape::Sphere { radius: 0.1 }))
            .unwrap();
        runtime
            .physics
            .create_joint(JointDesc::new(
                body_a,
                body_b,
                JointKind::Distance { length: 2.0 },
            ))
            .unwrap();
        continuation(&mut e);
        let collider = e
            .unified_physics
            .as_ref()
            .unwrap()
            .physics
            .collider_ids(body_a)
            .unwrap()
            .next()
            .unwrap();
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .update_collider(
                collider,
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.2; 3],
                }),
            )
            .unwrap();
        check(&e);
        continuation(&mut e);
        e.world.despawn(a);
        let reused = e.world.spawn_entity();
        assert_eq!(reused.id, a.id);
        assert_ne!(reused.generation, a.generation);
        // The old body/binding still exists until synchronization. Its marker is gone.
        check(&e);
        continuation(&mut e);
        e.remove_unified_body(b).unwrap();
        check(&e);
        continuation(&mut e);
    }
}

#[test]
fn file_bindings_component_dirty_type_fixture_import_and_retirement_keep_history() {
    let mut e = engine(Space::PlanarXy);
    let a = component(&mut e, 0.0);
    component(&mut e, 2.0);
    check(&e); // Unimported component entities need no native marker/binding yet.
    continuation(&mut e);
    e.world.set_rigid_body(a, c::RigidBody::kinematic());
    e.world.set_circle_collider(
        a,
        c::CircleCollider::new(0.8, true, c::CollisionLayer::Wall),
    );
    e.world.set_transform(a, c::Transform2D { x: 5.0, y: 2.0 });
    check(&e); // Cached source/type is old; current authoring is deliberately dirty.
    continuation(&mut e);
    e.world.clear_rigid_body(a);
    e.world.clear_collider(a);
    check(&e);
    continuation(&mut e);
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .bindings
        .contains_key(&(a.id, a.generation)));
}

#[test]
fn file_bindings_partial_import_plans_and_dirty_terrain_are_not_current_native_state() {
    let mut e = engine(Space::PlanarXy);
    component(&mut e, 0.0);
    let bad = component(&mut e, 2.0);
    e.world.set_transform(
        bad,
        c::Transform2D {
            x: f32::NAN,
            y: 2.0,
        },
    );
    {
        let runtime = e.unified_physics.as_mut().unwrap();
        assert!(runtime
            .prepare_planar(&e.world, e.auto_rigid_body_step_config)
            .is_err());
        assert!(!runtime.pending_planar.is_empty());
    }
    check(&e); // A failed prepare leaves a valid prefix; no synchronization here.
    e.world
        .set_transform(bad, c::Transform2D { x: 2.0, y: 2.0 });
    continuation(&mut e);
    e.tilemap
        .set_layer(0, 1, 1, 2.0, 2.0, 20.0, 0.0, true, vec![1]);
    check(&e);
    continuation(&mut e);
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .terrain
        .registered
        .is_empty());
    assert!(e.tilemap.set_tile(0, 0, 0, 0));
    check(&e); // Registered terrain is intentionally old until the next sync.
    {
        let runtime = e.unified_physics.as_mut().unwrap();
        runtime
            .prepare_terrain(&e.tilemap, &e.spatial_scene)
            .unwrap();
    }
    check(&e);
    continuation(&mut e);
}

#[test]
fn file_bindings_joint_source_edit_clear_reuse_and_endpoint_removal_are_deferred() {
    let mut e = engine(Space::PlanarXy);
    let a = explicit(&mut e, 0.0);
    let b = component(&mut e, 2.0);
    let joint = e.world.add_distance_joint(c::DistanceJoint::new(a, b, 2.0));
    check(&e);
    continuation(&mut e);
    e.world
        .set_distance_joint(joint, c::DistanceJoint::new(a, b, 3.0));
    check(&e);
    continuation(&mut e);
    e.world.clear_distance_joint(joint).unwrap();
    let reused = e.world.add_distance_joint(c::DistanceJoint::new(a, b, 2.0));
    assert_eq!(joint.index, reused.index);
    assert_ne!(joint.generation, reused.generation);
    check(&e);
    continuation(&mut e);
    e.unbind_unified_body(a).unwrap();
    assert!(!e.unified_physics.as_ref().unwrap().legacy_joints.is_empty());
    check(&e);
    // A still-authored joint with an unbound explicit visual is invalid gameplay
    // input; clear it before testing successful producer continuation.
    e.world.clear_distance_joint(reused).unwrap();
    continuation(&mut e);
}

#[test]
fn file_bindings_cross_owner_generation_inverse_marker_and_coverage_reject_read_only() {
    for case in 0..8 {
        let mut e = engine(Space::PlanarXy);
        let a = explicit(&mut e, 0.0);
        let b = explicit(&mut e, 2.0);
        let runtime = e.unified_physics.as_mut().unwrap();
        let body_a = runtime.bindings[&(a.id, a.generation)].body;
        let expected = match case {
            0 => {
                runtime.entities_by_body.insert(body_a, b);
                Error::BodyInverse
            }
            1 => {
                runtime
                    .bindings
                    .get_mut(&(a.id, a.generation))
                    .unwrap()
                    .body
                    .generation += 1;
                Error::BodyBinding
            }
            2 => {
                e.world
                    .unified_physics_entities
                    .remove(&(a.id, a.generation));
                Error::Marker
            }
            3 => {
                let key = (a.id, a.generation);
                let binding = runtime.bindings.remove(&key).unwrap();
                runtime.bindings.insert((a.id, a.generation + 1), binding);
                Error::EntityHistory
            }
            4 => {
                runtime
                    .physics
                    .create_body(
                        BodyDesc::default(),
                        ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
                    )
                    .unwrap();
                Error::BodyCoverage
            }
            5 => {
                runtime
                    .bindings
                    .get_mut(&(a.id, a.generation))
                    .unwrap()
                    .render_offset[0] = f32::NAN;
                Error::RenderOffset
            }
            6 => {
                runtime
                    .bindings
                    .get_mut(&(a.id, a.generation))
                    .unwrap()
                    .body = runtime.bindings[&(b.id, b.generation)].body;
                Error::BodyInverse
            }
            _ => {
                e.world
                    .unified_physics_entities
                    .insert((a.id, a.generation + 1));
                Error::Marker
            }
        };
        reject(&e, expected);
    }
}

#[test]
fn file_bindings_cross_owner_fixture_terrain_and_joint_source_reject_read_only() {
    let mut e = engine(Space::PlanarXy);
    let a = component(&mut e, 0.0);
    let b = component(&mut e, 2.0);
    e.world.add_distance_joint(c::DistanceJoint::new(a, b, 2.0));
    assert!(e
        .world
        .add_compound_collider(
            a,
            c::CompoundCollider::new(c::CompoundColliderShape::Circle(c::CircleCollider::new(
                0.1,
                true,
                c::CollisionLayer::Player
            )))
        )
        .is_some());
    e.tilemap
        .set_layer(0, 1, 1, 2.0, 2.0, 20.0, 0.0, true, vec![1]);
    continuation(&mut e);
    let bytes = persistence::encode(&e).unwrap();
    for case in 0..9 {
        let mut bad = persistence::decode(&bytes).unwrap();
        let runtime = bad.unified_physics.as_mut().unwrap();
        let body_b = runtime.bindings[&(b.id, b.generation)].body;
        let fixture_b = runtime
            .physics
            .collider_ids(body_b)
            .unwrap()
            .next()
            .unwrap();
        let expected = match case {
            0 => {
                runtime
                    .bindings
                    .get_mut(&(a.id, a.generation))
                    .unwrap()
                    .legacy
                    .as_mut()
                    .unwrap()
                    .file_test_replace_fixture(0, fixture_b);
                Error::ColliderOwner
            }
            1 => {
                runtime
                    .terrain
                    .registered
                    .values_mut()
                    .next()
                    .unwrap()
                    .file_test_set_collider(fixture_b);
                Error::TerrainIndex
            }
            2 => {
                runtime.terrain.by_collider.clear();
                Error::ColliderOwner
            }
            3 => {
                runtime
                    .legacy_joints
                    .values_mut()
                    .next()
                    .unwrap()
                    .file_test_set_source_entity(0, b);
                Error::JointOwner
            }
            4 => {
                runtime
                    .legacy_joints
                    .values_mut()
                    .next()
                    .unwrap()
                    .native
                    .generation += 1;
                Error::JointCache
            }
            5 => {
                runtime
                    .bindings
                    .get_mut(&(a.id, a.generation))
                    .unwrap()
                    .legacy
                    .as_mut()
                    .unwrap()
                    .file_test_drop_source();
                Error::FixtureCache
            }
            6 => {
                let cache = runtime
                    .bindings
                    .get_mut(&(a.id, a.generation))
                    .unwrap()
                    .legacy
                    .as_mut()
                    .unwrap();
                let id = cache.file_fixtures().1[0];
                cache.file_test_replace_fixture(1, id);
                Error::FixtureCache
            }
            7 => {
                let (_, registered) = runtime.terrain.registered.pop_first().unwrap();
                runtime
                    .terrain
                    .registered
                    .insert(UnifiedTerrainSource::Tile { layer: 0, tile: 1 }, registered);
                Error::TerrainIndex
            }
            _ => {
                let (mut key, binding) = runtime.legacy_joints.pop_first().unwrap();
                key.2 = key.2.wrapping_add(1);
                runtime.legacy_joints.insert(key, binding);
                Error::JointSource
            }
        };
        reject(&bad, expected);
    }
}

#[test]
fn file_bindings_exact_work_scratch_and_precharge_fail_without_source_changes() {
    let mut e = engine(Space::PlanarXy);
    component(&mut e, 0.0);
    component(&mut e, 2.0);
    continuation(&mut e);
    let usage = check(&e);
    let exact = Limits {
        max_work: usage.work,
        max_scratch_bytes: usage.scratch_bytes,
    };
    let before = persistence::encode(&e).unwrap();
    assert_eq!(validate_after_native_admission(&e, exact), Ok(usage));
    assert_eq!(
        validate_after_native_admission(
            &e,
            Limits {
                max_work: exact.max_work - 1,
                ..exact
            }
        ),
        Err(Error::WorkLimit)
    );
    assert_eq!(
        validate_after_native_admission(
            &e,
            Limits {
                max_scratch_bytes: exact.max_scratch_bytes - 1,
                ..exact
            }
        ),
        Err(Error::ScratchLimit)
    );
    assert_eq!(
        validate_after_native_admission(
            &e,
            Limits {
                max_work: 0,
                max_scratch_bytes: 0
            }
        ),
        Err(Error::WorkLimit)
    );
    assert_eq!(persistence::encode(&e).unwrap(), before);
}

#[test]
fn file_bindings_generated_projectile_map_cannot_borrow_another_entity_body() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space);
        let source = explicit(&mut e, 0.0);
        let shot = e.world.spawn_entity();
        e.world
            .set_transform(shot, c::Transform2D { x: 100.0, y: 2.0 });
        e.world.set_aabb_collider(
            shot,
            c::AabbCollider::new(0.1, 0.1, true, c::CollisionLayer::Bullet),
        );
        e.world.set_height_span(
            shot,
            c::HeightSpan {
                floor: c::PhysicsFloorId::DEFAULT,
                elevation: 2.0,
                height: 0.2,
            },
        );
        e.unified_physics
            .as_mut()
            .unwrap()
            .admit_projectile(&mut e.world, shot, source)
            .unwrap();
        check(&e);
        continuation(&mut e);
        let runtime = e.unified_physics.as_mut().unwrap();
        let projectile = runtime
            .projectiles
            .remove(&(shot.id, shot.generation))
            .unwrap();
        runtime
            .projectiles
            .insert((source.id, source.generation), projectile);
        reject(&e, Error::ProjectileOwner);
    }
    let mut e = engine(Space::PlanarXy);
    let id = e.world.spawn_entity();
    e.unified_physics = None;
    assert!(validate_after_native_admission(&e, limits()).is_ok());
    e.world
        .unified_physics_entities
        .insert((id.id, id.generation));
    let before = persistence::encode(&e).unwrap();
    assert_eq!(
        validate_after_native_admission(&e, limits()),
        Err(Error::Marker)
    );
    assert_eq!(persistence::encode(&e).unwrap(), before);
}

#[test]
fn file_bindings_surface_reorder_dirty_terrain_preserves_stable_ownership() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space);
        let a = [0.0, 0.0, 2.0, 2.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
        let b = [3.0, 0.0, 2.0, 2.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
        assert!(e
            .spatial_scene
            .configure_surfaces(&[a, b].concat(), &[4, 4, 0, 1, 9, 9, 0, 1]));
        check(&e);
        continuation(&mut e);
        assert!(!e
            .unified_physics
            .as_ref()
            .unwrap()
            .terrain
            .registered
            .is_empty());
        assert!(e
            .spatial_scene
            .configure_surfaces(&[b, a].concat(), &[9, 9, 0, 1, 4, 4, 0, 1]));
        check(&e);
        continuation(&mut e);
        assert!(e.spatial_scene.configure_surfaces(&b, &[9, 9, 0, 1]));
        check(&e);
        continuation(&mut e);
    }
}
