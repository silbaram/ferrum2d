//! Engine default-selection policy regressions.
use super::*;
use crate::components::{
    AabbCollider, ChainCollider, CircleCollider, CollisionLayer, MAX_CHAIN_COLLIDER_VERTICES,
};
use crate::input::InputState;

fn config() -> WorldConfig {
    WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        length_unit: 100.,
        step_seconds: 0.01,
        ..Default::default()
    }
}
fn configured() -> Engine {
    let mut e = Engine::new();
    e.configure_unified_physics_defaults(config()).unwrap();
    e
}
fn actor(e: &mut Engine) -> Entity {
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 10., y: 10. });
    e.world
        .set_circle_collider(a, CircleCollider::new(0.25, false, CollisionLayer::Enemy));
    e.world.set_velocity(a, Velocity { vx: 2., vy: 0. });
    a
}
fn import_all(e: &mut Engine) -> u32 {
    e.query_aabb_bodies(600., 320., 1200., 1000., u32::MAX)
}
fn native(e: &Engine) -> &UnifiedPhysicsRuntime {
    e.unified_physics.as_ref().unwrap()
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 0.002, "{a} != {b}");
}

#[test]
fn default_policy_explicit_legacy_variable_and_scene_local_native_contract_stay_unchanged() {
    let mut e = Engine::new();
    assert!(e.configure_legacy_physics_defaults());
    assert_eq!(e.default_physics_policy_scene(), 0);
    assert!(!e.physics_spec_backend_active());
    assert!(!e.fixed_timestep_enabled);
    assert!(!e.auto_rigid_body_step_enabled);
    e.use_data_scene();
    let a = actor(&mut e);
    e.update(0.25);
    near(e.world.transform(a).unwrap().x, 10.5);
    assert!(!e.fixed_timestep_enabled);
    e.configure_unified_physics(config()).unwrap();
    assert_eq!(e.default_physics_policy_scene(), 0);
    e.use_breakout_scene();
    assert!(!e.physics_spec_backend_active());
}

#[test]
fn default_policy_cross_scene_native_profiles_cold_queries_and_stale_generations() {
    let mut e = configured();
    assert_eq!(e.default_physics_policy_scene(), 1);
    assert!(native(&e).shooter_gameplay);
    let shooter = e.world.primary_actor_entity().unwrap();
    assert!(e.unified_body_state(shooter).is_ok());
    e.use_breakout_scene();
    assert_eq!(e.default_physics_policy_scene(), 2);
    assert!(!native(&e).shooter_gameplay);
    assert!(native(&e).breakout.is_some());
    assert!(native(&e).platformer.is_none());
    assert!(native(&e).bindings.is_empty());
    assert_eq!(import_all(&mut e), 55);
    let paddle = e.scenes.breakout().paddle_entity().unwrap();
    assert!(e.unified_body_state(paddle).is_ok());
    assert!(!e.world.is_current_entity(shooter));
    assert!(e.unified_body_state(shooter).is_err());
    e.use_platformer_scene();
    assert_eq!(e.default_physics_policy_scene(), 3);
    assert!(native(&e).breakout.is_none());
    assert!(native(&e).platformer.is_some());
    assert!(native(&e).bindings.is_empty());
    assert_eq!(import_all(&mut e), 8);
    let player = e.scenes.platformer().player_entity().unwrap();
    assert_eq!(
        e.unified_body_state(player).unwrap().pose.position,
        [96., 500., 0.]
    );
    assert!(e.unified_body_state(paddle).is_err());
    e.use_data_scene();
    assert_eq!(e.default_physics_policy_scene(), 4);
    assert!(native(&e).breakout.is_none());
    assert!(native(&e).platformer.is_none());
    assert_eq!(import_all(&mut e), 0);
    assert!(e.unified_body_state(player).is_err());
    let a = actor(&mut e);
    e.update(0.01);
    assert_eq!(e.unified_physics_error(), None);
    near(e.world.transform(a).unwrap().x, 10.02);
    assert_eq!(
        e.unified_body_state(a).unwrap().pose.position[0],
        e.world.transform(a).unwrap().x
    );
    e.activate_built_in_shooter_scene();
    e.reset_to_title();
    assert_eq!(e.default_physics_policy_scene(), 1);
    assert!(native(&e).shooter_gameplay);
    import_all(&mut e);
    let next = e.world.primary_actor_entity().unwrap();
    assert_ne!(next, shooter);
    assert!(e.unified_body_state(next).is_ok());
    assert!(e.unified_body_state(a).is_err());
}

#[test]
fn default_policy_manual_auto_switch_survives_scene_changes_and_native_step_once() {
    let mut e = configured();
    e.set_auto_rigid_body_step_enabled(false);
    e.use_data_scene();
    assert!(!e.auto_rigid_body_step_enabled);
    let a = actor(&mut e);
    import_all(&mut e);
    e.update(0.01);
    near(e.world.transform(a).unwrap().x, 10.);
    e.step_rigid_bodies(0.01);
    near(e.world.transform(a).unwrap().x, 10.02);
    for scene in [2, 3, 4] {
        match scene {
            2 => e.use_breakout_scene(),
            3 => e.use_platformer_scene(),
            _ => e.use_data_scene(),
        }
        assert_eq!(e.default_physics_policy_scene(), scene);
        assert!(e.physics_spec_backend_active());
        assert!(!e.auto_rigid_body_step_enabled);
    }
}

#[test]
fn default_policy_same_data_scene_and_reset_keep_explicit_world_and_manual_ownership() {
    let mut e = configured();
    e.use_data_scene();
    let custom = WorldConfig {
        step_seconds: 0.02,
        gravity: [0., 4., 0.],
        ..config()
    };
    e.configure_unified_physics(custom.clone()).unwrap();
    e.set_auto_rigid_body_step_enabled(false);
    e.use_data_scene();
    assert_eq!(*native(&e).physics.config(), custom);
    assert!(!e.auto_rigid_body_step_enabled);
    let a = actor(&mut e);
    import_all(&mut e);
    let previous_id = e.unified_body_id(a).unwrap();
    e.reset_game();
    assert_eq!(*native(&e).physics.config(), custom);
    assert!(!e.auto_rigid_body_step_enabled);
    assert!(e.unified_body_state(a).is_err());
    let next = actor(&mut e);
    import_all(&mut e);
    let next_id = e.unified_body_id(next).unwrap();
    // Removal retires the old native generation instead of constructing an
    // empty arena whose first body could alias the original native identity.
    assert_eq!(next_id.slot, previous_id.slot);
    assert!(next_id.generation > previous_id.generation);
}

#[test]
fn default_policy_same_platformer_reset_keeps_world_settings_and_refreshes_owners() {
    let mut e = configured();
    e.use_platformer_scene();
    let custom = WorldConfig {
        step_seconds: 0.02,
        ..config()
    };
    e.configure_unified_physics(custom.clone()).unwrap();
    e.set_auto_rigid_body_step_enabled(false);
    let old = e.scenes.platformer().player_entity().unwrap();
    e.use_platformer_scene();
    assert_eq!(*native(&e).physics.config(), custom);
    assert!(!e.auto_rigid_body_step_enabled);
    assert_eq!(import_all(&mut e), 8);
    let player = e.scenes.platformer().player_entity().unwrap();
    assert_ne!(old, player);
    assert!(e.unified_body_state(old).is_err());
    assert!(e.unified_body_state(player).is_ok());
    e.reset_game();
    let reset = e.scenes.platformer().player_entity().unwrap();
    assert_eq!(import_all(&mut e), 8);
    assert!(e.unified_body_state(reset).is_ok());
    assert_eq!(*native(&e).physics.config(), custom);
    assert!(!e.auto_rigid_body_step_enabled);
}

#[test]
fn default_policy_invalid_or_spatial_setup_preserves_prior_runtime_and_selection() {
    let mut e = Engine::new();
    let before = crate::engine::persistence::encode(&e).unwrap();
    for invalid in [
        WorldConfig {
            space: Space::Spatial,
            ..config()
        },
        WorldConfig {
            step_seconds: f32::NAN,
            ..config()
        },
        WorldConfig {
            max_bodies: 0,
            ..config()
        },
    ] {
        assert!(e.configure_unified_physics_defaults(invalid).is_err());
        assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
        assert_eq!(e.default_physics_policy_scene(), 1);
    }
    e.configure_unified_physics_defaults(config()).unwrap();
    let before = crate::engine::persistence::encode(&e).unwrap();
    assert_eq!(
        e.configure_unified_physics_defaults(WorldConfig::default()),
        Err(PhysicsError::InvalidConfig.into())
    );
    assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
}

#[test]
fn default_policy_failed_current_authoring_admission_does_not_enable_selection() {
    let mut e = Engine::new();
    assert!(e.configure_legacy_physics_defaults());
    e.use_data_scene();
    let a = actor(&mut e);
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(f32::NAN, 1., false, CollisionLayer::Enemy),
    );
    let before = crate::engine::persistence::encode(&e).unwrap();
    assert!(e.configure_unified_physics_defaults(config()).is_err());
    assert_eq!(e.default_physics_policy_scene(), 0);
    assert!(!e.physics_spec_backend_active());
    assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
}

#[test]
fn default_policy_cold_invalid_fixture_rejects_without_legacy_motion() {
    let mut e = configured();
    e.use_data_scene();
    let a = actor(&mut e);
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(f32::NAN, 1., false, CollisionLayer::Enemy),
    );
    let before = e.world.transform(a);
    e.update(0.01);
    assert!(e.physics_spec_backend_active());
    assert!(e.unified_physics_error().is_some());
    assert_eq!(e.world.transform(a), before);
    assert!(e.unified_body_id(a).is_err());
}

#[test]
fn default_policy_cold_unsupported_platformer_source_never_falls_back_to_legacy() {
    let mut e = configured();
    e.use_platformer_scene();
    e.input.enter = 1;
    e.update(0.01);
    e.input = InputState {
        d: 1,
        ..Default::default()
    };
    let p = e.scenes.platformer().player_entity().unwrap();
    let platform = e.scenes.platformer().moving_platform_entity().unwrap();
    let before = (e.world.transform(p), e.world.transform(platform));
    let mut vertices = [Transform2D::default(); MAX_CHAIN_COLLIDER_VERTICES];
    vertices[..3].copy_from_slice(&[
        Transform2D { x: -14., y: 0. },
        Transform2D { x: 0., y: 0. },
        Transform2D { x: 14., y: 0. },
    ]);
    e.world.set_chain_collider(
        p,
        ChainCollider::new(vertices, 3, false, false, CollisionLayer::Player),
    );
    e.update(0.01);
    assert_eq!(
        e.unified_physics_error(),
        Some(PhysicsError::UnsupportedShape.into())
    );
    assert!(e.physics_spec_backend_active());
    assert_eq!((e.world.transform(p), e.world.transform(platform)), before);
    assert_eq!(e.score(), 0);
}

#[test]
fn default_policy_cross_scene_restores_default_step_preserving_caps_and_interpolation() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.configure_fixed_timestep(true, 0.01, 0.08, 3);
    e.configure_physics_render_interpolation(true);
    e.configure_unified_physics_defaults(config()).unwrap();
    assert_eq!(e.fixed_timestep.config().max_frame_seconds, 0.08);
    assert_eq!(e.fixed_timestep.config().max_steps_per_update, 3);
    assert!(e.render_interpolation_enabled);
    e.use_data_scene();
    e.configure_unified_physics(WorldConfig {
        step_seconds: 0.02,
        ..config()
    })
    .unwrap();
    e.configure_fixed_timestep(true, 0.02, 0.08, 3);
    e.configure_physics_render_interpolation(true);
    e.set_auto_rigid_body_step_enabled(false);
    e.use_platformer_scene();
    assert_eq!(*native(&e).physics.config(), config());
    let clock = e.fixed_timestep.config();
    assert_eq!(clock.step_seconds, 0.01);
    assert_eq!(clock.max_frame_seconds, 0.08);
    assert_eq!(clock.max_steps_per_update, 3);
    assert!(e.render_interpolation_enabled);
    assert!(!e.auto_rigid_body_step_enabled);
    e.use_breakout_scene();
    assert_eq!(e.fixed_timestep.config(), clock);
    assert!(e.render_interpolation_enabled);
    assert!(!e.auto_rigid_body_step_enabled);
}

#[test]
fn default_policy_checkpoint_restores_defaults_for_deterministic_future_scene_changes() {
    let mut e = configured();
    e.use_data_scene();
    e.set_auto_rigid_body_step_enabled(false);
    let checkpoint = e.runtime_checkpoint().unwrap();
    e.configure_unified_physics_defaults(WorldConfig {
        step_seconds: 0.02,
        ..config()
    })
    .unwrap();
    e.use_platformer_scene();
    assert_eq!(native(&e).physics.config().step_seconds, 0.02);
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    assert_eq!(e.default_physics_policy_scene(), 4);
    assert_eq!(e.default_unified_physics, Some(config()));
    assert!(!e.auto_rigid_body_step_enabled);
    e.use_platformer_scene();
    assert_eq!(import_all(&mut e), 8);
    let p = e.scenes.platformer().player_entity().unwrap();
    let expected = (
        p,
        e.unified_body_state(p).unwrap(),
        native(&e).physics.config().clone(),
    );
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    e.use_platformer_scene();
    assert_eq!(import_all(&mut e), 8);
    let p = e.scenes.platformer().player_entity().unwrap();
    assert_eq!(
        (
            p,
            e.unified_body_state(p).unwrap(),
            native(&e).physics.config().clone()
        ),
        expected
    );
    assert!(!e.auto_rigid_body_step_enabled);
    crate::engine::persistence::assert_encoding_roundtrip(&e);
}

#[test]
fn default_policy_numeric_bridge_uses_existing_layout_and_checks_before_mutation() {
    let mut e = Engine::new();
    assert_eq!(e.default_physics_policy_version(), 1);
    let before = crate::engine::persistence::encode(&e).unwrap();
    assert!(e.configure_default_physics_world(&[], &[]).is_err());
    assert!(e
        .configure_default_physics_world(
            &[1, 1, 1, 0, 8192, 16384, 4096, 128, 16384],
            &[0., 0., 0., 0.01, 100., 1.]
        )
        .is_err());
    assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
    e.configure_default_physics_world(
        &[0, 1, 1, 0, 8192, 16384, 4096, 128, 16384],
        &[0., 0., 0., 0.01, 100., 1.],
    )
    .unwrap();
    assert_eq!(e.default_physics_policy_scene(), 1);
    assert_eq!(native(&e).physics.config().solver.velocity_iterations, 1);
    assert!(!native(&e).physics.config().solver.continuous);
}

#[test]
fn default_policy_new_and_default_are_native_variable_automatic_without_eager_body_import() {
    for mut e in [Engine::new(), Engine::default()] {
        assert_eq!(e.default_physics_policy_scene(), 1);
        assert!(e.physics_spec_backend_active());
        assert!(!e.fixed_timestep_enabled);
        assert!(!e.default_physics_policy_fixed_timestep());
        assert!(e.auto_rigid_body_step_enabled);
        let expected = super::default_policy::initial_world_config();
        assert_eq!(native(&e).physics.config(), &expected);
        assert_eq!(e.default_unified_physics, Some(expected));
        assert!(native(&e).bindings.is_empty());
        assert_eq!(native(&e).physics.body_count(), 0);
        assert_eq!(import_all(&mut e), 1);
        let player = e.world.primary_actor_entity().unwrap();
        assert!(e.unified_body_state(player).is_ok());
    }
}

#[test]
fn default_policy_omitted_configuration_runs_all_actual_scene_transitions_natively_with_variable_time(
) {
    let mut e = Engine::new();
    let initial = native(&e).physics.config().clone();
    for scene in [4, 2, 3, 1, 3, 4, 2, 1] {
        match scene {
            1 => {
                e.set_texture_ids(1, 2, 3);
                e.reset_to_title();
            }
            2 => e.use_breakout_scene(),
            3 => e.use_platformer_scene(),
            _ => e.use_data_scene(),
        }
        assert_eq!(e.default_physics_policy_scene(), scene);
        assert!(e.physics_spec_backend_active());
        assert!(e.auto_rigid_body_step_enabled);
        assert!(!e.fixed_timestep_enabled);
        assert_eq!(native(&e).physics.config(), &initial);
        if scene == 4 {
            let a = actor(&mut e);
            e.update(0.023);
            near(e.world.transform(a).unwrap().x, 10.046);
            assert_eq!(
                e.unified_body_state(a).unwrap().pose.position[0],
                e.world.transform(a).unwrap().x
            );
        } else {
            e.input.enter = 1;
            e.update(0.007);
            e.input = InputState::default();
            e.update(0.023);
            assert!(!native(&e).bindings.is_empty());
        }
        assert_eq!(e.unified_physics_error(), None);
    }
}

#[test]
fn default_policy_explicit_legacy_selection_preserves_constructor_entities_and_rejects_used_native_state(
) {
    let mut fresh = Engine::new();
    let actor = fresh.world.primary_actor_entity().unwrap();
    fresh
        .world
        .set_transform(actor, Transform2D { x: 12., y: 34. });
    assert!(fresh.configure_legacy_physics_defaults());
    assert!(fresh.configure_legacy_physics_defaults());
    assert!(!fresh.physics_spec_backend_active());
    assert_eq!(fresh.default_physics_policy_scene(), 0);
    assert!(!fresh.auto_rigid_body_step_enabled);
    assert_eq!(
        fresh.world.transform(actor),
        Some(Transform2D { x: 12., y: 34. })
    );
    for mutation in 0..7 {
        let mut used = Engine::new();
        match mutation {
            0 => {
                import_all(&mut used);
            }
            1 => used.update(0.01),
            2 => used.use_data_scene(),
            3 => {
                used.world.spawn_entity();
            }
            4 => {
                assert!(used.configure_unified_physics_clock(true, 1. / 60., 0.25, 8));
            }
            5 => {
                used.set_auto_rigid_body_step_enabled(false);
            }
            _ => used.configure_auto_rigid_body_step(
                true, 0., 0., 1, 1, 0.5, 0.01, 1., 0.2, 120., false, false,
            ),
        }
        let before = crate::engine::persistence::encode(&used).unwrap();
        assert!(!used.configure_legacy_physics_defaults());
        assert_eq!(crate::engine::persistence::encode(&used).unwrap(), before);
        assert!(used.physics_spec_backend_active());
    }
}

#[test]
fn default_policy_bare_decode_does_not_allocate_or_reapply_new_engine_native_policy() {
    let bare = Engine::new_checkpoint_candidate();
    assert!(bare.unified_physics.is_none());
    assert!(bare.default_unified_physics.is_none());
    assert!(!bare.auto_rigid_body_step_enabled);
    for legacy in [false, true] {
        let mut source = Engine::new();
        if legacy {
            assert!(source.configure_legacy_physics_defaults());
        }
        source.use_data_scene();
        let a = actor(&mut source);
        source.update(0.023);
        let bytes = crate::engine::persistence::encode(&source).unwrap();
        let restored = crate::engine::persistence::decode(&bytes).unwrap();
        assert_eq!(
            crate::engine::persistence::encode(&restored).unwrap(),
            bytes
        );
        assert_eq!(
            restored.default_unified_physics,
            source.default_unified_physics
        );
        assert_eq!(
            restored.fixed_timestep_enabled,
            source.fixed_timestep_enabled
        );
        assert_eq!(restored.world.transform(a), source.world.transform(a));
    }
}

#[test]
fn default_policy_shooter_authored_world_settings_keep_native_solver_manual_owner_and_next_scene_policy(
) {
    let mut e = Engine::new();
    e.set_auto_rigid_body_step_enabled(false);
    let original = e.default_unified_physics.clone();
    let authored = WorldConfig {
        gravity: [4., 25., 0.],
        step_seconds: 0.02,
        solver: crate::physics3d::SolverSettings {
            velocity_iterations: 3,
            position_iterations: 2,
            ..initial_solver()
        },
        ..super::default_policy::initial_world_config()
    };
    e.configure_physics_spec_planar(authored.clone()).unwrap();
    assert_eq!(native(&e).physics.config(), &authored);
    assert!(!e.auto_rigid_body_step_enabled);
    assert_eq!(e.default_unified_physics, original);
    e.use_breakout_scene();
    assert_eq!(native(&e).physics.config(), original.as_ref().unwrap());
    assert!(!e.fixed_timestep_enabled);
    assert!(!e.auto_rigid_body_step_enabled);
}
fn initial_solver() -> crate::physics3d::SolverSettings {
    super::default_policy::initial_world_config().solver
}
