//! Existing planar Physics Spec components use the same native rigid backend.
use super::*;

impl Engine {
    pub(in crate::engine) fn prepare_physics_spec_body_view(
        &mut self,
        handles: &[u32],
    ) -> Result<(), UnifiedPhysicsError> {
        let Some(runtime) = &mut self.unified_physics else {
            return Ok(());
        };
        if handles.is_empty() {
            return Ok(());
        }
        for h in handles.chunks_exact(2) {
            if !self.world.is_current_entity(Entity {
                id: h[0],
                generation: h[1],
            }) {
                return Err(UnifiedPhysicsError::StaleEntity);
            }
            if runtime
                .bindings
                .get(&(h[0], h[1]))
                .is_some_and(|b| b.legacy.is_none())
            {
                return Err(UnifiedPhysicsError::BodyOwnershipConflict);
            }
        }
        runtime.prepare_query(
            &mut self.world,
            self.auto_rigid_body_step_config,
            &self.tilemap,
            &self.spatial_scene,
        )?;
        for h in handles.chunks_exact(2) {
            if !runtime
                .bindings
                .get(&(h[0], h[1]))
                .is_some_and(|b| b.legacy.is_some())
            {
                return Err(UnifiedPhysicsError::BodyOwnershipConflict);
            }
        }
        Ok(())
    }
    pub(super) fn configure_physics_spec_planar(
        &mut self,
        config: WorldConfig,
    ) -> Result<(), UnifiedPhysicsError> {
        if self.scene_mode != SceneMode::Data && !self.is_built_in_shooter() {
            return Err(UnifiedPhysicsError::WrongScene);
        }
        if self.physics_restore_transaction.is_some() {
            return Err(UnifiedPhysicsError::LegacySnapshotUnsupported);
        }
        if config.space != Space::PlanarXy {
            return Err(PhysicsError::InvalidConfig.into());
        }
        if let Some(runtime) = self
            .unified_physics
            .as_mut()
            .filter(|r| *r.physics.config() == config)
        {
            // Applying another authored group to the same world must not replace
            // its clock, solver history or existing generational body identities.
            runtime.retire_deleted_entities(&self.world);
            runtime.retire_planar_components(&mut self.world);
            runtime.prepare_terrain(&self.tilemap, &self.spatial_scene)?;
            runtime.prepare_planar(&self.world, self.auto_rigid_body_step_config)?;
            runtime.prepare_planar_joints(&self.world)?;
            runtime.retire_terrain()?;
            runtime.commit_planar(&mut self.world, false)?;
            runtime.commit_terrain()?;
            runtime.commit_planar_joints()?;
            return Ok(());
        }
        // Spec application is setup, not a request to enable automatic stepping.
        // Manual/runtime scene profiles retain ownership of that switch.
        let auto_enabled = self.auto_rigid_body_step_enabled;
        let clock = self.fixed_timestep.config();
        self.configure_unified_physics(config)?;
        self.apply_fixed_timestep_config(
            true,
            self.fixed_timestep.config().step_seconds,
            clock.max_frame_seconds,
            clock.max_steps_per_update,
        );
        self.auto_rigid_body_step_enabled = auto_enabled;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{CircleCollider, CollisionLayer, RigidBody};

    fn config() -> WorldConfig {
        WorldConfig {
            space: Space::PlanarXy,
            gravity: [0.; 3],
            step_seconds: 0.01,
            ..Default::default()
        }
    }
    fn body(e: &mut Engine, x: f32) -> Entity {
        let id = e.world.spawn_entity();
        e.world.set_transform(id, Transform2D { x, y: 0. });
        e.world
            .set_rigid_body(id, RigidBody::dynamic_circle(1., 0.5));
        e.world
            .set_circle_collider(id, CircleCollider::new(0.5, false, CollisionLayer::Enemy));
        id
    }
    #[test]
    fn physics_spec_native_auto_toggle_preserves_solver_and_admits_same_config_additions() {
        let mut e = Engine::new();
        e.activate_data_scene();
        let a = body(&mut e, 0.);
        e.configure_physics_spec_planar(config()).unwrap();
        let before = e.unified_physics.as_ref().unwrap().physics.config().clone();
        let settings = e.auto_rigid_body_step_config;
        let identity = e.unified_physics.as_ref().unwrap().bindings[&(a.id, a.generation)].body;
        for enabled in [false, true, false] {
            e.set_auto_rigid_body_step_enabled(enabled);
            assert_eq!(e.auto_rigid_body_step_enabled, enabled);
            assert_eq!(e.auto_rigid_body_step_config, settings);
            assert_eq!(
                e.unified_physics.as_ref().unwrap().physics.config(),
                &before
            );
        }
        let b = body(&mut e, 5.);
        e.configure_physics_spec_planar(config()).unwrap();
        let runtime = e.unified_physics.as_ref().unwrap();
        assert_eq!(runtime.bindings[&(a.id, a.generation)].body, identity);
        assert!(runtime.bindings.contains_key(&(b.id, b.generation)));
        assert!(!e.auto_rigid_body_step_enabled);
    }
    #[test]
    fn physics_spec_native_readonly_2d_rows_preserve_layout_and_pending_input_without_allowing_json_restore(
    ) {
        let mut e = crate::engine::legacy_test_fixture::engine();
        e.activate_data_scene();
        let a = body(&mut e, 2.);
        let handles = vec![a.id, a.generation];
        assert!(e.capture_physics_body_snapshot_bulk(handles.clone()));
        let floats = e.physics_body_snapshot_floats.clone();
        let words = e.physics_body_snapshot_u32s.clone();
        e.configure_physics_spec_planar(config()).unwrap();
        assert!(e.query_physics_body_states_bulk(handles.clone()));
        assert_eq!(e.physics_body_snapshot_floats, floats);
        assert_eq!(e.physics_body_snapshot_u32s, words);
        e.world.rigid_bodies[a.id as usize]
            .as_mut()
            .unwrap()
            .impulse = Velocity { vx: 3., vy: 0. };
        assert!(e.query_physics_body_states_bulk(handles.clone()));
        assert_eq!(e.world.rigid_bodies[a.id as usize].unwrap().impulse.vx, 3.);
        assert!(!e.capture_physics_body_snapshot_bulk(handles));
        assert!(e.physics_body_snapshot_floats.is_empty());
    }
    #[test]
    fn physics_spec_native_readonly_2d_rows_reject_explicit_native_and_stale_identities() {
        let mut e = Engine::new();
        e.activate_data_scene();
        let a = body(&mut e, 2.);
        e.configure_physics_spec_planar(config()).unwrap();
        assert!(e.query_physics_body_states_bulk(vec![a.id, a.generation]));
        let explicit = e
            .create_unified_body(
                BodyDesc::default(),
                ColliderDesc::new(crate::physics3d::Shape::Sphere { radius: 1. }),
                [0.; 3],
            )
            .unwrap();
        assert!(!e.query_physics_body_states_bulk(vec![explicit.id, explicit.generation]));
        assert!(e.physics_body_snapshot_floats.is_empty());
        assert!(!e.query_physics_body_states_bulk(vec![a.id, a.generation, u32::MAX, 0]));
        assert!(e.unified_body_state(explicit).is_ok());
    }
    #[test]
    fn physics_spec_native_setup_imports_components_without_consuming_impulse_or_enabling_auto() {
        let mut e = Engine::new();
        e.activate_data_scene();
        e.auto_rigid_body_step_enabled = false;
        let a = body(&mut e, 0.);
        e.world.rigid_bodies[a.id as usize]
            .as_mut()
            .unwrap()
            .impulse = Velocity { vx: 2., vy: 0. };
        e.configure_physics_spec_planar(config()).unwrap();
        assert!(!e.auto_rigid_body_step_enabled);
        assert_eq!(e.unified_body_state(a).unwrap().pose.position, [0.; 3]);
        assert_eq!(e.world.rigid_bodies[a.id as usize].unwrap().impulse.vx, 2.);
        assert!(e.step_unified_manually(0.01, None));
        assert!(e.unified_body_state(a).unwrap().linear_velocity[0] > 1.9);
        assert_eq!(
            e.world.rigid_bodies[a.id as usize].unwrap().impulse,
            Velocity::default()
        );
    }
    #[test]
    fn physics_spec_native_identical_setup_imports_additions_preserving_clock_identity_and_pose() {
        let mut e = Engine::new();
        e.activate_data_scene();
        let a = body(&mut e, 0.);
        e.configure_physics_spec_planar(config()).unwrap();
        e.update(0.015);
        let before = e.unified_body_state(a).unwrap();
        let id = e.unified_body_id(a).unwrap();
        let clock = e.fixed_timestep;
        let b = body(&mut e, 3.);
        e.configure_physics_spec_planar(config()).unwrap();
        assert_eq!(e.unified_body_id(a).unwrap(), id);
        assert_eq!(e.unified_body_state(a).unwrap(), before);
        assert!(e.unified_body_id(b).is_ok());
        assert_eq!(e.fixed_timestep, clock);
    }
    #[test]
    fn physics_spec_native_setup_preserves_enabled_auto_and_engine_clock_limits() {
        let mut e = crate::engine::legacy_test_fixture::engine();
        e.activate_data_scene();
        e.auto_rigid_body_step_enabled = true;
        e.configure_fixed_timestep(true, 0.02, 0.08, 3);
        e.configure_physics_spec_planar(config()).unwrap();
        assert!(e.auto_rigid_body_step_enabled);
        let clock = e.fixed_timestep.config();
        assert_eq!(clock.step_seconds, 0.01);
        assert_eq!(clock.max_frame_seconds, 0.08);
        assert_eq!(clock.max_steps_per_update, 3);
    }
    #[test]
    fn physics_spec_native_reconfiguration_with_bound_bodies_rejects_without_replacing_state() {
        let mut e = Engine::new();
        e.activate_data_scene();
        body(&mut e, 0.);
        e.configure_physics_spec_planar(config()).unwrap();
        let before = e.unified_physics.as_ref().unwrap().checkpoint_bytes();
        let mut changed = config();
        changed.gravity = [0., 10., 0.];
        assert_eq!(
            e.configure_physics_spec_planar(changed),
            Err(UnifiedPhysicsError::BodiesStillBound)
        );
        assert_eq!(
            e.unified_physics.as_ref().unwrap().checkpoint_bytes(),
            before
        );
    }
    #[test]
    fn physics_spec_native_bridge_rejects_wrong_scene_spatial_and_invalid_payload_without_fallback()
    {
        let mut e = crate::engine::legacy_test_fixture::engine();
        e.use_breakout_scene();
        assert_eq!(e.physics_spec_backend_version(), 1);
        assert!(!e.physics_spec_backend_active());
        assert!(e
            .configure_physics_spec_world(
                &[0, 1, 1, 1, 10, 20, 10, 2, 10],
                &[0., 0., 0., 0.01, 1., 1.]
            )
            .is_err());
        assert!(e.unified_physics.is_none());
        e.activate_data_scene();
        assert!(e
            .configure_physics_spec_world(
                &[1, 1, 1, 1, 10, 20, 10, 2, 10],
                &[0., 0., 0., 0.01, 1., 1.]
            )
            .is_err());
        assert!(e.configure_physics_spec_world(&[], &[]).is_err());
        assert!(e.unified_physics.is_none());
        e.configure_physics_spec_planar(config()).unwrap();
        assert!(e.physics_spec_backend_active());
        e.use_data_scene();
        assert!(e.physics_spec_backend_active());
        e.use_breakout_scene();
        assert!(!e.physics_spec_backend_active());
    }
}
