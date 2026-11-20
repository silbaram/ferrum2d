//! Explicit compatibility fixtures. New default/native tests use Engine::new.
use super::Engine;

pub(crate) fn engine() -> Engine {
    let mut engine = Engine::new();
    assert!(engine.configure_legacy_physics_defaults());
    assert_eq!(engine.default_physics_policy_scene(), 0);
    assert!(!engine.physics_spec_backend_active());
    engine
}
