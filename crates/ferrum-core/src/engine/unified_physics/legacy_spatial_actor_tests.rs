//! Physics-omitted HD-2D documents that use the heightSpan/AABB actor path.
//! The SDK activates such a Data Scene through `use_legacy_data_scene`. Only an
//! actual switch from a built-in scene under the untouched engine-owned defaults
//! is accepted, so the new scene never receives a native world. Explicit,
//! reconfigured or Data Scene worlds stay native and are never dropped.
use super::*;
use crate::engine::physics_abi::{
    PHYSICS_COLLIDER_TYPE_AABB, PHYSICS_LAYER_ENEMY, PHYSICS_LAYER_PLAYER, PHYSICS_LAYER_WALL,
};

/// `createEngine()` without options stores the same planar defaults through
/// the creation-policy bridge and then selects the native variable clock.
fn sdk_default_engine() -> Engine {
    let mut e = Engine::new();
    e.configure_unified_physics_defaults(default_policy::initial_world_config())
        .unwrap();
    assert!(e.configure_unified_physics_clock(false, 1. / 60., 0.25, 8));
    e
}

fn spawn(e: &mut Engine, x: f32, y: f32, layer: u32, half: [f32; 2]) -> Entity {
    assert!(e.spawn_data_scene_entity(
        x,
        y,
        0.,
        0,
        1,
        24.,
        32.,
        0.,
        0.,
        0.25,
        1.,
        0,
        0.,
        layer,
        PHYSICS_COLLIDER_TYPE_AABB,
        0.,
        0.,
        true,
        false,
        half[0],
        half[1],
        0.,
        0.,
        0.,
        0.,
        0.,
        0.,
        vec![],
    ));
    Entity {
        id: e.data_scene_entity_id(),
        generation: e.data_scene_entity_generation(),
    }
}

/// `components.body: { type: "kinematic", heightSpan }` with a solid AABB.
fn kinematic(e: &mut Engine, x: f32, y: f32, layer: u32) -> Entity {
    let entity = spawn(e, x, y, layer, [4., 4.]);
    assert!(e.configure_data_scene_body(entity.id, entity.generation, 1, true, 0, 0., 24.));
    entity
}

const CAMERA: [f32; 12] = [
    0., 240., 420., 320., 0., 16., 0., 250., 0.1, 2000., 800., 480.,
];
const BILLBOARD: [f32; 3] = [1., 0.5, 0.];

/// `examples/starter-runtime/public/features/hd2d-movement.json`: ground,
/// ramp and bridge, the ramp-bridge connection and the WASD actor.
fn hd2d_movement(e: &mut Engine) -> (Entity, bool) {
    let actor = kinematic(e, 0., -64., PHYSICS_LAYER_PLAYER);
    assert!(e.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    let configured = e.configure_spatial_scene_connected(
        &CAMERA,
        &[
            -64., -96., 128., 64., 0., 0., 0., 0.18, 0.32, 0.3, 1., //
            -64., -32., 128., 64., 0., 0., 48., 0.35, 0.42, 0.48, 1., //
            -64., 32., 128., 64., 40., 48., 48., 0.62, 0.44, 0.22, 1.,
        ],
        &[1, 0, 16777215, 1, 2, 0, 16777215, 5, 3, 1, 16777215, 9],
        &[actor.id, actor.generation],
        &BILLBOARD,
        &[actor.id, actor.generation],
        &[72., 12., 52.],
        &[2, 3],
    );
    (actor, configured)
}

/// `ai-combat.json`: primary/spatial actor, a Chase enemy, a static wall and
/// `gameplay.combatNavigation`. Gameplay is configured before the spatial scene.
fn ai_combat(e: &mut Engine) -> (Entity, Entity, bool, bool) {
    let actor = kinematic(e, 88., 0., PHYSICS_LAYER_PLAYER);
    let enemy = kinematic(e, -88., 0., PHYSICS_LAYER_ENEMY);
    assert!(e.set_gameplay_movement_chase_primary_actor(enemy.id, enemy.generation, 64.));
    let wall = spawn(e, 0., 0., PHYSICS_LAYER_WALL, [12., 30.]);
    assert!(e.configure_data_scene_body(wall.id, wall.generation, 0, true, 0, 0., 40.));
    let gameplay = e.configure_data_scene_gameplay_v4(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 8., 0.5, 0., 4.],
    );
    let spatial = e.configure_spatial_scene(
        &CAMERA,
        &[
            -160., -100., 320., 200., 0., 0., 0., 0.16, 0.25, 0.28, 1., //
            -12., -30., 24., 60., 0., 40., 40., 0.4, 0.43, 0.48, 1.,
        ],
        &[1, 0, 16777215, 1, 2, 1, 16777215, 0],
        &[actor.id, actor.generation, enemy.id, enemy.generation],
        &[BILLBOARD, BILLBOARD].concat(),
        &[actor.id, actor.generation],
        &[72., 8., 8.],
    );
    (actor, enemy, gameplay, spatial)
}

fn walk_right(e: &mut Engine, actor: Entity) {
    let start = e.world.transform(actor).unwrap().x;
    e.set_input(false, false, false, true, false, false, false, 0., 0.);
    for _ in 0..10 {
        e.update(1. / 60.);
    }
    e.set_input(false, false, false, false, false, false, false, 0., 0.);
    assert!(e.world.transform(actor).unwrap().x > start + 5.);
    assert!(e.physics_counters.kinematic_moves > 0);
}

/// A rejected activation leaves the complete Engine state byte-identical, and
/// the read-only admission query reports the same rejection beforehand.
fn rejected(e: &mut Engine) {
    let before = crate::engine::persistence::encode(e).unwrap();
    assert!(!e.can_use_legacy_data_scene());
    assert_eq!(crate::engine::persistence::encode(e).unwrap(), before);
    assert!(!e.use_legacy_data_scene());
    assert_eq!(crate::engine::persistence::encode(e).unwrap(), before);
    assert!(e.physics_spec_backend_active());
}

fn assert_legacy(e: &Engine) {
    assert!(!e.physics_spec_backend_active());
    assert_eq!(e.default_physics_policy_scene(), 0);
    assert!(e.unified_physics.is_none());
    assert!(e.default_unified_physics.is_none());
}

#[test]
fn hd2d_movement_document_runs_the_legacy_actor_on_a_fresh_default_engine() {
    for mut e in [Engine::new(), sdk_default_engine()] {
        let shooter = e.world.primary_actor_entity().unwrap();
        // The SDK path has already imported the Shooter title actor; the switch
        // discards that built-in world exactly as `use_data_scene` would.
        assert!(e.use_legacy_data_scene());
        assert_eq!(e.scene_mode, SceneMode::Data);
        assert!(!e.world.is_current_entity(shooter));
        assert_legacy(&e);
        assert!(!e.fixed_timestep_enabled);
        // Same automatic-step values as the explicit legacy creation choice.
        assert!(!e.auto_rigid_body_step_enabled);
        assert_eq!(
            e.auto_rigid_body_step_config,
            crate::physics::RigidBodyStepConfig::default()
        );
        let (actor, configured) = hd2d_movement(&mut e);
        assert!(configured);
        assert!(e.spatial_scene.actor.is_some_and(|a| a.0 == actor));
        walk_right(&mut e, actor);
        assert_legacy(&e);
        // Re-applying on the legacy Engine (a lab reset) is a plain activation.
        assert!(e.use_legacy_data_scene());
        assert!(!e.world.is_current_entity(actor));
        let (actor, configured) = hd2d_movement(&mut e);
        assert!(configured);
        walk_right(&mut e, actor);
    }
}

#[test]
fn ai_combat_document_configures_legacy_combat_navigation_on_a_fresh_default_engine() {
    for mut e in [Engine::new(), sdk_default_engine()] {
        assert!(e.use_legacy_data_scene());
        let (actor, enemy, gameplay, spatial) = ai_combat(&mut e);
        assert!(gameplay);
        assert!(spatial);
        assert_eq!(e.data_scene_combat_navigation_stats()[1], 1);
        let start = e.world.transform(enemy).unwrap();
        for _ in 0..30 {
            e.update(1. / 60.);
        }
        assert_ne!(e.world.transform(enemy).unwrap(), start);
        walk_right(&mut e, actor);
        assert_legacy(&e);
    }
}

#[test]
fn plain_activation_keeps_the_default_planar_world_and_rejects_both_documents() {
    // Root cause: the default world is planar, so neither the native spatial
    // character nor native combat navigation can accept these sources.
    let mut e = Engine::new();
    e.use_data_scene();
    let (actor, configured) = hd2d_movement(&mut e);
    assert!(!configured);
    assert!(e.world.is_current_entity(actor));
    assert!(e.physics_spec_backend_active());
    let mut e = sdk_default_engine();
    e.use_data_scene();
    let (_, _, gameplay, _) = ai_combat(&mut e);
    assert!(!gameplay);
    assert!(e.physics_spec_backend_active());
    // 2D Data Scenes keep importing legacy components into the default world.
    let mut e = sdk_default_engine();
    e.use_data_scene();
    let mover = kinematic(&mut e, 0., 0., PHYSICS_LAYER_PLAYER);
    e.world.set_velocity(mover, Velocity { vx: 60., vy: 0. });
    e.update(1. / 60.);
    assert!(e.unified_body_state(mover).is_ok());
    assert!(e.world.transform(mover).unwrap().x > 0.);
}

#[test]
fn explicit_native_spatial_and_scene_local_worlds_are_not_demoted() {
    let spatial = WorldConfig {
        space: Space::Spatial,
        gravity: [0., -10., 0.],
        ..Default::default()
    };
    let mut e = sdk_default_engine();
    e.use_data_scene();
    e.configure_unified_physics(spatial.clone()).unwrap();
    rejected(&mut e);
    assert_eq!(
        e.unified_physics.as_ref().unwrap().physics.config(),
        &spatial
    );
    assert_eq!(e.default_physics_policy_scene(), 4);

    // A scene-local built-in world with exactly the default settings owns a fixed clock.
    let mut e = Engine::new();
    e.configure_unified_physics(default_policy::initial_world_config())
        .unwrap();
    rejected(&mut e);

    // Explicit creation policies with other world or clock settings.
    let mut e = Engine::new();
    e.configure_unified_physics_defaults(WorldConfig {
        gravity: [0., 700., 0.],
        ..default_policy::initial_world_config()
    })
    .unwrap();
    assert!(e.configure_unified_physics_clock(false, 1. / 60., 0.25, 8));
    rejected(&mut e);
    let mut e = Engine::new();
    e.configure_unified_physics_defaults(default_policy::initial_world_config())
        .unwrap();
    assert!(e.fixed_timestep_enabled);
    rejected(&mut e);

    // A legacy Engine never drops a scene-local native Data Scene world either.
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_data_scene();
    e.configure_unified_physics(spatial).unwrap();
    rejected(&mut e);
}

#[test]
fn data_scene_worlds_and_user_settings_are_never_dropped() {
    // The active Data Scene owns its default world, even before anything is
    // spawned, and after a previous scene's bodies were imported and retired.
    let mut e = sdk_default_engine();
    e.use_data_scene();
    rejected(&mut e);
    let actor = kinematic(&mut e, 0., -64., PHYSICS_LAYER_PLAYER);
    e.update(1. / 60.);
    let body = e.unified_body_state(actor).unwrap();
    rejected(&mut e);
    assert_eq!(e.unified_body_state(actor).unwrap(), body);
    e.use_data_scene();
    rejected(&mut e);
    assert_eq!(e.default_physics_policy_scene(), 4);

    // User settings that the native world or its automatic step owns.
    let mut e = sdk_default_engine();
    e.set_auto_rigid_body_step_enabled(false);
    rejected(&mut e);
    let mut e = sdk_default_engine();
    e.configure_auto_rigid_body_step(true, 0., 0., 1, 1, 0.5, 0.01, 1., 0.2, 120., false, false);
    rejected(&mut e);
    let mut e = sdk_default_engine();
    assert!(e.configure_unified_physics_clock(true, 1. / 60., 0.25, 8));
    rejected(&mut e);
    let mut e = sdk_default_engine();
    assert!(e.configure_unified_physics_clock(false, 1. / 60., 0.1, 8));
    rejected(&mut e);
}

#[test]
fn legacy_activation_keeps_valid_checkpoints_and_applies_to_later_scenes() {
    let mut e = sdk_default_engine();
    let before = e.runtime_checkpoint().unwrap();
    assert!(e.use_legacy_data_scene());
    let (actor, configured) = hd2d_movement(&mut e);
    assert!(configured);
    let legacy = e.runtime_checkpoint().unwrap();
    walk_right(&mut e, actor);
    let moved = e.world.transform(actor).unwrap();
    e.restore_runtime_checkpoint_native(&legacy).unwrap();
    assert_legacy(&e);
    assert_ne!(e.world.transform(actor).unwrap(), moved);
    // Rolling back an apply restores the native default policy and world.
    e.restore_runtime_checkpoint_native(&before).unwrap();
    assert!(e.physics_spec_backend_active());
    assert_eq!(e.default_physics_policy_scene(), 1);
    // Like the explicit legacy creation choice, later scenes stay legacy.
    assert!(e.use_legacy_data_scene());
    e.use_breakout_scene();
    assert_legacy(&e);
    e.use_data_scene();
    assert_legacy(&e);
}

#[test]
fn legacy_admission_query_matches_the_activation_and_changes_nothing() {
    // Accepted cases: a fresh SDK default Engine (the JSON restore target), a
    // fresh raw Engine, and legacy Engines in a built-in or Data Scene. Build
    // one Engine at a time: an array of Engines overflows the WASI test stack.
    let legacy_data = || {
        let mut e = crate::engine::legacy_test_fixture::engine();
        e.use_data_scene();
        e
    };
    let engines: [fn() -> Engine; 4] = [
        sdk_default_engine,
        Engine::new,
        crate::engine::legacy_test_fixture::engine,
        legacy_data,
    ];
    for make in engines {
        let mut e = make();
        let before = crate::engine::persistence::encode(&e).unwrap();
        assert!(e.can_use_legacy_data_scene());
        assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
        assert!(e.use_legacy_data_scene());
        assert_legacy(&e);
        // The resulting legacy Data Scene admits a reapply, as in a lab reset.
        assert!(e.can_use_legacy_data_scene());
    }

    // An open physics restore transaction rejects; closing it admits again.
    let mut e = sdk_default_engine();
    e.physics_restore_transaction = Some(e.world.transaction_snapshot());
    rejected(&mut e);
    e.physics_restore_transaction = None;
    assert!(e.can_use_legacy_data_scene());
    assert!(e.use_legacy_data_scene());
    assert_legacy(&e);

    // A native Data Scene and a changed native default stay rejected.
    e = sdk_default_engine();
    e.use_data_scene();
    rejected(&mut e);
    e = sdk_default_engine();
    e.set_auto_rigid_body_step_enabled(false);
    rejected(&mut e);
    e.set_auto_rigid_body_step_enabled(true);
    // Restoring the engine-owned value admits the switch again.
    assert!(e.can_use_legacy_data_scene());
}
