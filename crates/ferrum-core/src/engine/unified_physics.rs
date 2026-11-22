//! Unified Engine integration, with the numeric Web boundary in `web_bridge`.
use super::{scenes::SceneMode, Engine};
use crate::components::{
    AngularVelocity, HeightSpan, PhysicsFloorId, Rotation2D, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::physics3d::{
    BodyDesc, BodyId, BodyState, CharacterConfig, CharacterInput, CharacterState, ColliderDesc,
    PhysicsError, PhysicsWorld3d, Pose, Space, WorldConfig,
};
use std::collections::BTreeMap;
use std::fmt;
mod bindings;
mod checkpoint;
mod joint_stream;
pub(in crate::engine) use joint_stream::JointBuffers;
mod collision_events;
mod collision_stream;
pub(in crate::engine) use collision_stream::CollisionBuffers;
mod contact_impulses;
mod contact_queries;
mod observations;
pub(in crate::engine) use observations::ObservationBuffers;
mod combat_actions;
mod combat_movement;
mod combat_navigation;
pub(in crate::engine) use combat_navigation::{
    NativeCombatNavigation, NativeNavigationConfig, NativeRouteArcLocation,
};
mod authoring;
#[cfg(test)]
mod authoring_tests;
mod dash;
mod debug;
#[cfg(test)]
mod debug_tests;
mod default_policy;
#[cfg(test)]
mod default_policy_tests;
mod execution;
pub(in crate::engine) mod file_admission;
mod gameplay;
#[cfg(test)]
mod model_pose_tests;
mod model_poses;
pub(super) mod variable_clock;
#[cfg(test)]
mod variable_clock_tests;
pub(in crate::engine) use combat_actions::NativeMeleeHit;
#[cfg(test)]
mod arcade_native_tests;
mod automatic_planar;
#[cfg(test)]
mod automatic_planar_tests;
#[cfg(test)]
mod controller_extension_tests;
mod controller_settings;
mod file_ordered;
#[cfg(test)]
mod file_runtime_order;
mod prefab_controllers;
pub(in crate::engine) use prefab_controllers::ActorPhysicsPrototype;
mod hd2d_controller;
#[cfg(test)]
mod hd2d_controller_tests;
mod physics_spec;
mod planar;
mod planar_navigation;
#[cfg(test)]
mod prefab_controller_tests;
pub(in crate::engine) use planar_navigation::PlanarNavigationContext;
mod planar_geometry;
mod planar_joints;
mod projectiles;
mod spatial_actor;
pub(in crate::engine) use projectiles::ProjectileHit;
pub(in crate::engine) use spatial_actor::navigation::Point;
mod breakout;
#[cfg(test)]
mod breakout_tests;
mod built_in;
mod file_builtin_admission;
mod platformer;
mod platformer_controller;
#[cfg(test)]
mod platformer_tests;
mod queries;
mod query_geometry;
mod shape_queries;
mod shooter;
#[cfg(test)]
mod shooter_tests;
mod statistics;
mod terrain;
mod terrain_events;
mod terrain_geometry;
#[cfg(test)]
mod terrain_integration_tests;
mod terrain_motion;
mod terrain_queries;
pub(super) mod web_bridge;
pub use collision_events::{UnifiedCollisionEventDiagnostics, UnifiedCollisionPair};
pub use contact_impulses::UnifiedContactImpulse;
pub use contact_queries::UnifiedContactManifold;
pub use queries::UnifiedRayHit;
pub use statistics::{UnifiedCcdClamp, UnifiedPhysicsFrameStatistics};
pub use terrain::{UnifiedTerrainRayHit, UnifiedTerrainSource};

/// A rejected native Engine physics operation. Rejection never selects the legacy solver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum UnifiedPhysicsError {
    /// Configure a unified world before issuing body commands.
    NotConfigured,
    /// Native integration requires a Data Scene or a supported planar built-in scene.
    WrongScene,
    /// Existing 2D rigid components need migration before enabling this world.
    LegacyBodiesPresent,
    /// A native-owned entity cannot also be driven by a legacy rigid component.
    BodyOwnershipConflict,
    /// Remove existing bindings before changing world configuration.
    BodiesStillBound,
    /// The entity has been removed or is not bound to the unified world.
    StaleEntity,
    /// Physics requires the Engine's fixed clock with the configured timestep.
    ClockMismatch,
    /// The world-space render offset is non-finite or out of range.
    InvalidVisualOffset,
    /// The legacy snapshot format cannot capture/restore unified backend state.
    LegacySnapshotUnsupported,
    /// XY-only queries require a planar world; spatial queries must specify XYZ.
    SpatialQueryRequires3d,
    /// The native physics world rejected an operation.
    Physics(PhysicsError),
}

impl fmt::Display for UnifiedPhysicsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Physics(error) => error.fmt(f),
            other => write!(f, "unified Engine physics operation rejected: {other:?}"),
        }
    }
}
impl std::error::Error for UnifiedPhysicsError {}
impl From<PhysicsError> for UnifiedPhysicsError {
    fn from(value: PhysicsError) -> Self {
        Self::Physics(value)
    }
}

/// Keep a zero-progress rejection available to the caller without publishing
/// it into the checkpoint of the last committed simulation state.
#[derive(Default, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
struct PendingPhysicsError {
    saved: Option<UnifiedPhysicsError>,
    #[serde(skip)]
    rejected_attempt: Option<UnifiedPhysicsError>,
    /// First clock/prepare/commit failure of the current checked frame. Query
    /// and gameplay diagnostics stay soft; a skipped physics step does not.
    #[serde(skip)]
    frame_step_failure: Option<UnifiedPhysicsError>,
}

impl PendingPhysicsError {
    fn record(&mut self, error: UnifiedPhysicsError) {
        self.saved = Some(error);
        self.rejected_attempt = None;
    }

    /// Records a failure that skipped or rejected the native physics step.
    fn record_step(&mut self, error: UnifiedPhysicsError) {
        self.record(error);
        self.frame_step_failure.get_or_insert(error);
    }

    fn get(&self) -> Option<UnifiedPhysicsError> {
        self.rejected_attempt.or(self.saved)
    }

    fn take(&mut self) -> Option<UnifiedPhysicsError> {
        let latest = self.get();
        *self = Self::default();
        latest
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Binding {
    body: BodyId,
    #[serde(with = "crate::checkpoint_codec::array")]
    render_offset: [f32; 3],
    legacy: Option<planar::LegacyBinding>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct UnifiedPhysicsRuntime {
    previous_auto_config: crate::physics::RigidBodyStepConfig,
    previous_auto_enabled: bool,
    #[serde(with = "crate::physics3d::snapshot::checkpoint_state")]
    physics: PhysicsWorld3d,
    // Built-in Shooter retains overlap-based gameplay and projectile impact policy.
    shooter_gameplay: bool,
    breakout: Option<breakout::BreakoutBodies>,
    platformer: Option<platformer::PlatformerBodies>,
    #[serde(deserialize_with = "file_ordered::map")]
    bindings: BTreeMap<(u32, u32), Binding>,
    #[serde(deserialize_with = "file_ordered::map")]
    entities_by_body: BTreeMap<BodyId, Entity>,
    lifecycle: collision_events::Lifecycle,
    pub(in crate::engine) contacts: contact_impulses::ContactReports,
    #[serde(with = "crate::checkpoint_codec::vector")]
    gameplay_collision_pairs: Vec<crate::collision::CollisionPair>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    native_ray_hits: Vec<crate::physics3d::RayHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    native_point_hits: Vec<crate::physics3d::ColliderRef>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    native_sweep_hits: Vec<crate::physics3d::SweepHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    native_nearest_hits: Vec<crate::physics3d::PointHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    native_contact_manifolds: Vec<crate::physics3d::ContactManifold>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    retired: Vec<(u32, u32)>,
    last_error: PendingPhysicsError,
    /// A Data-scene tick whose pre-physics gameplay ran before a zero-progress
    /// rejection; `Some(true)` when it consumed the frame's latched presses.
    /// The retry resumes at physics instead of repeating that gameplay.
    #[serde(skip)]
    suspended_tick: Option<bool>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pending_planar: Vec<planar::PendingBody>,
    #[serde(deserialize_with = "file_ordered::map")]
    legacy_joints: BTreeMap<planar_joints::Key, planar_joints::JointBinding>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pending_joints: Vec<planar_joints::PendingJoint>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    retired_joints: Vec<planar_joints::Key>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    native_joint_events: Vec<crate::physics3d::JointEvent>,
    joint_stream: joint_stream::JointStream,
    statistics: statistics::Statistics,
    #[serde(deserialize_with = "file_ordered::map")]
    projectiles: BTreeMap<(u32, u32), projectiles::Projectile>,
    terrain: terrain::Terrain,
    platform_motion: terrain_motion::PlatformMotion,
    pub(in crate::engine) actor_navigation: spatial_actor::ActorNavigation,
    controlled_spatial_actor: Option<Entity>,
    dash: dash::DashState,
    automatic_planar: automatic_planar::AutomaticPlanarMotion,
}

impl Engine {
    pub(super) fn new_unified_runtime(
        &self,
        config: WorldConfig,
    ) -> Result<UnifiedPhysicsRuntime, UnifiedPhysicsError> {
        let physics = PhysicsWorld3d::new(config.clone())?;
        let (previous_auto_config, previous_auto_enabled) = self
            .unified_physics
            .as_ref()
            .map(|r| (r.previous_auto_config, r.previous_auto_enabled))
            .unwrap_or((
                self.auto_rigid_body_step_config,
                self.auto_rigid_body_step_enabled,
            ));
        Ok(UnifiedPhysicsRuntime {
            previous_auto_config,
            previous_auto_enabled,
            physics,
            shooter_gameplay: self.is_built_in_shooter(),
            platformer: self
                .is_built_in_platformer()
                .then(|| platformer::PlatformerBodies::from_scene(self.scenes.platformer())),
            breakout: self
                .is_built_in_breakout()
                .then(|| breakout::BreakoutBodies::from_scene(self.scenes.breakout())),
            actor_navigation: Default::default(),
            controlled_spatial_actor: None,
            dash: Default::default(),
            automatic_planar: Default::default(),
            bindings: BTreeMap::new(),
            entities_by_body: BTreeMap::new(),
            lifecycle: collision_events::Lifecycle::new(
                config.max_events,
                self.collision_lifecycle_events_enabled,
            ),
            gameplay_collision_pairs: Vec::new(),
            contacts: contact_impulses::ContactReports::default(),
            native_ray_hits: Vec::new(),
            native_point_hits: Vec::new(),
            native_sweep_hits: Vec::new(),
            native_nearest_hits: Vec::new(),
            native_contact_manifolds: Vec::new(),
            retired: Vec::new(),
            last_error: PendingPhysicsError::default(),
            suspended_tick: None,
            pending_planar: Vec::new(),
            legacy_joints: BTreeMap::new(),
            pending_joints: Vec::new(),
            retired_joints: Vec::new(),
            native_joint_events: Vec::new(),
            joint_stream: joint_stream::JointStream::new(config.max_events),
            statistics: statistics::Statistics::default(),
            projectiles: BTreeMap::new(),
            terrain: terrain::Terrain::default(),
            platform_motion: terrain_motion::PlatformMotion::default(),
        })
    }

    /// Configures one native backend and shared fixed clock for a Data Scene or planar Shooter/Breakout/Platformer.
    ///
    /// Planar worlds import existing 2D rigid components and fixtures. Spatial worlds
    /// require explicit spatial bodies until spatial authoring migration is connected.
    /// The numeric Web bridge delegates setup here; spatial authoring remains incomplete.
    pub fn configure_unified_physics(
        &mut self,
        config: WorldConfig,
    ) -> Result<(), UnifiedPhysicsError> {
        if !self.supports_unified_scene(config.space) {
            return Err(UnifiedPhysicsError::WrongScene);
        }
        if self.scene_mode == SceneMode::Data
            && !self
                .data_scene
                .gameplay
                .combat
                .accepts_native_world(config.space)
        {
            return Err(PhysicsError::UnsupportedShape.into());
        }
        if self.is_built_in_platformer() {
            platformer::PlatformerBodies::from_scene(self.scenes.platformer())
                .validate_components(&self.world)?;
        }
        if self.is_built_in_breakout() {
            breakout::BreakoutBodies::from_scene(self.scenes.breakout())
                .validate_components(&self.world)?;
        }
        if self.physics_restore_transaction.is_some() {
            return Err(UnifiedPhysicsError::LegacySnapshotUnsupported);
        }
        if let Some(runtime) = &mut self.unified_physics {
            runtime.retire_deleted_entities(&self.world);
        }
        if self
            .unified_physics
            .as_ref()
            .is_some_and(|r| !r.bindings.is_empty())
        {
            return Err(UnifiedPhysicsError::BodiesStillBound);
        }
        // Explicit native world settings own gravity/solver controls. Keep authored
        // contact response controls, which WorldConfig does not duplicate.
        let mut step_config = self.auto_rigid_body_step_config;
        execution::copy_native_settings(&mut step_config, config.gravity, config.solver);
        let mut runtime = self.new_unified_runtime(config.clone())?;
        runtime.prepare_terrain(&self.tilemap, &self.spatial_scene)?;
        runtime.prepare_planar(&self.world, step_config)?;
        runtime.prepare_planar_joints(&self.world)?;
        runtime.retire_terrain()?;
        runtime.commit_planar(&mut self.world, false)?;
        runtime.commit_terrain()?;
        runtime.commit_planar_joints()?;
        // Replace only after the entire authored batch validates.
        self.unified_physics = None;
        self.apply_fixed_timestep_config(true, config.step_seconds, 0.25, 8);
        self.auto_rigid_body_step_config = step_config;
        self.auto_rigid_body_step_enabled = true;
        self.unified_physics = Some(runtime);
        Ok(())
    }

    /// Creates a native body and a render/gameplay entity atomically after input validation.
    ///
    /// Spatial poses project as `(x, elevation, -y)`; planar poses use `(x, y)`.
    /// `render_offset` is a world-space visual anchor offset, for example feet below
    /// a capsule center. Full 3D orientation remains in native state; billboards
    /// retain their authored screen rotation.
    pub fn create_unified_body(
        &mut self,
        desc: BodyDesc,
        collider: ColliderDesc,
        render_offset: [f32; 3],
    ) -> Result<Entity, UnifiedPhysicsError> {
        self.validate_unified_body_binding(render_offset)?;
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        runtime.retire_deleted_entities(&self.world);
        let body = runtime.physics.create_body(desc, collider)?;
        let entity = self.world.spawn_entity();
        let key = (entity.id, entity.generation);
        runtime.bindings.insert(
            key,
            Binding {
                body,
                render_offset,
                legacy: None,
            },
        );
        runtime.entities_by_body.insert(body, entity);
        self.world.unified_physics_entities.insert(key);
        runtime.write_entity(&mut self.world, entity)?;
        Ok(entity)
    }

    /// Removes the native body, connected joints and its render/gameplay entity.
    pub fn remove_unified_body(&mut self, entity: Entity) -> Result<(), UnifiedPhysicsError> {
        let body = self.unified_body_id(entity)?;
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        runtime.physics.remove_body(body)?;
        runtime.joint_stream.capture(
            &mut runtime.physics,
            &runtime.entities_by_body,
            &mut runtime.native_joint_events,
        );
        runtime.lifecycle.capture(
            &mut runtime.physics,
            &runtime.entities_by_body,
            &runtime.terrain.by_collider,
        );
        runtime.bindings.remove(&(entity.id, entity.generation));
        runtime
            .automatic_planar
            .settings
            .remove(&(entity.id, entity.generation));
        runtime.projectiles.remove(&(entity.id, entity.generation));
        runtime.entities_by_body.remove(&body);
        self.world.despawn(entity);
        Ok(())
    }

    /// Reads simulation pose/velocity, independently of render projection or interpolation.
    pub fn unified_body_state(&self, entity: Entity) -> Result<BodyState, UnifiedPhysicsError> {
        let body = self.unified_body_id(entity)?;
        Ok(self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .physics
            .body_state(body)?)
    }

    /// Distinguishes an unbound entity from an invalid native binding, which must
    /// never fall back to an unrelated projected/render transform.
    pub(in crate::engine) fn unified_gameplay_position(
        &self,
        entity: Entity,
    ) -> Option<Option<[f32; 3]>> {
        let runtime = self.unified_physics.as_ref()?;
        let binding = runtime.bindings.get(&(entity.id, entity.generation))?;
        Some(
            runtime
                .physics
                .body_state(binding.body)
                .ok()
                .map(|s| s.pose.position),
        )
    }

    /// Teleports a body and immediately updates its render projection.
    pub fn set_unified_body_pose(
        &mut self,
        entity: Entity,
        pose: Pose,
    ) -> Result<(), UnifiedPhysicsError> {
        let body = self.unified_body_id(entity)?;
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        runtime.physics.set_pose(body, pose)?;
        runtime.write_entity(&mut self.world, entity)
    }

    /// Sets native linear/angular velocity; controller-owned bodies reject direct velocity edits.
    /// Kinematic commands stop at capsule squeeze constraints; a new command resumes motion.
    pub fn set_unified_body_velocity(
        &mut self,
        entity: Entity,
        linear: [f32; 3],
        angular: [f32; 3],
    ) -> Result<(), UnifiedPhysicsError> {
        let body = self.unified_body_id(entity)?;
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        runtime.physics.set_velocity(body, linear, angular)?;
        runtime.write_entity(&mut self.world, entity)
    }

    /// Applies one impulse to a dynamic body.
    pub fn apply_unified_body_impulse(
        &mut self,
        entity: Entity,
        impulse: [f32; 3],
    ) -> Result<(), UnifiedPhysicsError> {
        let body = self.unified_body_id(entity)?;
        self.unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .physics
            .apply_impulse(body, impulse)?;
        self.unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .write_entity(&mut self.world, entity)
    }

    /// Enables the Rust capsule controller on a bound position-kinematic body.
    pub fn enable_unified_character(
        &mut self,
        entity: Entity,
        config: CharacterConfig,
    ) -> Result<(), UnifiedPhysicsError> {
        let body = self.unified_body_id(entity)?;
        self.unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .physics
            .enable_character(body, config)?;
        Ok(())
    }

    /// Sets input consumed by the next accepted Engine physics interval.
    pub fn set_unified_character_input(
        &mut self,
        entity: Entity,
        input: CharacterInput,
    ) -> Result<(), UnifiedPhysicsError> {
        let body = self.unified_body_id(entity)?;
        self.unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .physics
            .set_character_input(body, input)?;
        Ok(())
    }

    /// Reads the last completed physics interval's controller result.
    pub fn unified_character_state(
        &self,
        entity: Entity,
    ) -> Result<&CharacterState, UnifiedPhysicsError> {
        let body = self.unified_body_id(entity)?;
        Ok(self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .physics
            .character_state(body)?)
    }

    /// Last clock, configuration or step rejection, retained until explicitly taken.
    pub fn unified_physics_error(&self) -> Option<UnifiedPhysicsError> {
        self.unified_physics
            .as_ref()
            .and_then(|r| r.last_error.get())
    }

    /// Consumes the pending native diagnostic without changing simulation state.
    pub fn take_unified_physics_error(&mut self) -> Option<UnifiedPhysicsError> {
        self.unified_physics
            .as_mut()
            .and_then(|r| r.last_error.take())
    }

    fn unified_body_id(&self, entity: Entity) -> Result<BodyId, UnifiedPhysicsError> {
        let runtime = self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        if !self.world.is_current_entity(entity) {
            return Err(UnifiedPhysicsError::StaleEntity);
        }
        runtime
            .bindings
            .get(&(entity.id, entity.generation))
            .map(|b| b.body)
            .ok_or(UnifiedPhysicsError::StaleEntity)
    }

    pub(super) fn step_unified_physics(&mut self, dt: f32) -> bool {
        self.step_unified_with_config(dt, self.auto_rigid_body_step_config, true)
            .is_some()
    }

    // None: no native world; Some(false): rejected, never a fallback request.
    fn step_unified_with_config(
        &mut self,
        dt: f32,
        config: crate::physics::RigidBodyStepConfig,
        gameplay: bool,
    ) -> Option<bool> {
        self.unified_physics.as_ref()?;
        Some(
            self.with_unified_interval(dt, |engine| {
                engine.step_unified_with_config_interval(dt, config, gameplay)
            })
            .unwrap_or(false),
        )
    }

    fn step_unified_with_config_interval(
        &mut self,
        dt: f32,
        config: crate::physics::RigidBodyStepConfig,
        gameplay: bool,
    ) -> bool {
        let shooter = self.is_built_in_shooter();
        let supported = self
            .unified_physics
            .as_ref()
            .is_some_and(|r| self.supports_unified_scene(r.physics.config().space));
        let Some(runtime) = self.unified_physics.as_mut() else {
            return false;
        };
        let error = if !supported {
            Some(UnifiedPhysicsError::WrongScene)
        } else if !dt.is_finite() || (dt - runtime.physics.config().step_seconds).abs() > 1.0e-7 {
            Some(UnifiedPhysicsError::ClockMismatch)
        } else {
            None
        };
        if let Some(error) = error {
            runtime.last_error.record_step(error);
            return false; // Never fall back to another rigid solver in this world.
        }
        let config = config.sanitized();
        let gravity = execution::gravity(&runtime.physics, config);
        let solver = execution::solver_settings(config);
        if let Err(error) = runtime.physics.validate_runtime_settings(gravity, solver) {
            runtime.last_error.record_step(error.into());
            return false;
        }
        runtime.retire_deleted_entities(&self.world);
        runtime.retire_planar_components(&mut self.world);
        if let Err(error) = runtime
            .prepare_terrain(&self.tilemap, &self.spatial_scene)
            .and_then(|()| runtime.prepare_platform_motion(&self.spatial_scene))
            .and_then(|()| runtime.prepare_planar(&self.world, config))
            .and_then(|()| runtime.prepare_planar_joints(&self.world))
            .and_then(|()| {
                runtime
                    .physics
                    .set_runtime_settings(gravity, solver)
                    .map_err(Into::into)
            })
            .and_then(|()| runtime.retire_terrain())
            .and_then(|()| runtime.commit_planar(&mut self.world, false))
            .and_then(|()| runtime.commit_terrain())
            .and_then(|()| runtime.commit_planar_joints())
        {
            runtime.last_error.record_step(error);
            return false;
        }
        if gameplay && self.scene_mode == SceneMode::Data {
            self.data_scene.gameplay.combat.prepare_native_navigation(
                runtime,
                &self.world,
                &self.spatial_scene,
            );
        }
        let mut succeeded = true;
        let authored_breaks = runtime.break_planar_joint_errors(&mut self.world);
        runtime.joint_stream.capture(
            &mut runtime.physics,
            &runtime.entities_by_body,
            &mut runtime.native_joint_events,
        );
        let capture_state = runtime.physics.step_motion_capture_state();
        runtime.begin_projectile_step();
        let motion = runtime
            .begin_automatic_planar_motion(
                &mut self.world,
                &self.tilemap,
                &self.spatial_scene,
                &mut self.physics_counters,
                shooter,
            )
            .and_then(|()| runtime.apply_planar_inputs(&self.world))
            .and_then(|()| runtime.step_native_platforms(&mut self.spatial_scene, &self.tilemap));
        // Inputs no tick consumed (failed admission) are restaged on retry.
        runtime.physics.discard_staged_tick_inputs();
        let restored = runtime.finish_automatic_planar_motion(&mut self.world, motion.is_ok());
        // Keep prior removals observable if no native time was accepted. Once
        // time advances, free all legacy slots before collecting solver breaks.
        let advanced = runtime.physics.actual_motion_completed_seconds() > 0.;
        if motion.is_ok() || advanced {
            runtime.native_joint_events.clear();
            runtime.joint_stream.take_legacy_dropped();
        }
        if let Err(error) = motion.and(restored) {
            // A failed suffix may follow complete CCD slices. Synchronize only
            // those actual native poses; no lifecycle/impact/gameplay success
            // or nominal-step statistics are emitted for the failed interval.
            if advanced {
                let _ = runtime.finish_planar(&mut self.world);
                for &(id, generation) in runtime.bindings.keys() {
                    let _ = runtime.write_entity(&mut self.world, Entity { id, generation });
                }
                runtime.finish_spatial_actor(&self.spatial_scene, &mut self.world);
            }
            if !advanced && runtime.actual_motion_result().is_err() {
                runtime.restore_projectile_starts();
                runtime
                    .physics
                    .restore_step_motion_capture_state(capture_state);
                runtime.last_error.rejected_attempt = Some(error);
            } else {
                runtime.last_error.record_step(error);
            }
            return false;
        }
        self.world.physics_diagnostics.begin_step();
        runtime.finish_projectile_step(&self.world);
        runtime.finish_contact_reports(&mut self.world);
        runtime.lifecycle.finish_step(
            &mut runtime.physics,
            &runtime.entities_by_body,
            &runtime.terrain.by_collider,
        );
        if let Err(error) = runtime.finish_planar(&mut self.world) {
            runtime.last_error.record_step(error);
            succeeded = false;
        }
        for &(id, generation) in runtime.bindings.keys() {
            if let Err(error) = runtime.write_entity(&mut self.world, Entity { id, generation }) {
                runtime.last_error.record_step(error);
                succeeded = false;
            }
        }
        runtime.finish_spatial_actor(&self.spatial_scene, &mut self.world);
        if gameplay && self.scene_mode == SceneMode::Data {
            self.data_scene
                .gameplay
                .combat
                .finish_native_navigation(runtime, &self.spatial_scene);
        }
        runtime.finish_planar_joints(&mut self.world);
        let authored_breaks =
            authored_breaks.saturating_add(runtime.break_planar_joint_errors(&mut self.world));
        let stats = runtime.finish_statistics(&mut self.world, authored_breaks);
        self.record_native_terrain_contacts();
        self.process_physics_impact_feedback(dt);
        self.record_rigid_body_step_stats(stats);
        succeeded
    }

    pub(super) fn discard_unified_physics(&mut self) {
        // Keep a native sentinel until the new scene installs its fresh default
        // world. Rejected cold admission must never select the legacy solver.
        if self.default_unified_physics.is_some() {
            return;
        }
        if let Some(runtime) = self.unified_physics.take() {
            self.auto_rigid_body_step_config = runtime.previous_auto_config;
            self.auto_rigid_body_step_enabled = runtime.previous_auto_enabled;
            for (id, generation) in runtime.bindings.into_keys() {
                self.world.despawn(Entity { id, generation });
            }
        }
    }

    pub(super) fn reject_unified_legacy_snapshot(&mut self) -> bool {
        if let Some(runtime) = &mut self.unified_physics {
            runtime
                .last_error
                .record(UnifiedPhysicsError::LegacySnapshotUnsupported);
            true
        } else {
            false
        }
    }
}

impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn begin_actual_motion_attempt(&mut self) {
        self.physics.clear_actual_motion_outcome();
    }

    pub(in crate::engine) fn begin_checked_frame(&mut self) {
        self.last_error.frame_step_failure = None;
    }

    pub(in crate::engine) fn frame_step_failure(&self) -> Option<UnifiedPhysicsError> {
        self.last_error.frame_step_failure
    }

    pub(in crate::engine) fn take_suspended_tick(&mut self) -> Option<bool> {
        self.suspended_tick.take()
    }

    pub(in crate::engine) fn suspend_tick(&mut self, presses_delivered: bool) {
        self.suspended_tick = Some(presses_delivered);
    }

    pub(in crate::engine) fn actual_motion_result(&self) -> Result<(), PhysicsError> {
        self.physics.actual_motion_result()
    }

    pub(in crate::engine) fn actual_motion_completed_seconds(&self) -> f32 {
        self.physics.actual_motion_completed_seconds()
    }
    pub(in crate::engine) fn imports_planar_components(&self) -> bool {
        self.physics.config().space == Space::PlanarXy
    }

    fn retire_deleted_entities(&mut self, world: &crate::world::World) {
        // An accepted prefab can be despawned before its first component import.
        // Those controller settings have no binding yet and still need retirement.
        self.automatic_planar
            .settings
            .retain(|&(id, generation), _| world.is_current_entity(Entity { id, generation }));
        self.retired.clear();
        for &(id, generation) in self.bindings.keys() {
            if !world.is_current_entity(Entity { id, generation }) {
                self.retired.push((id, generation));
            }
        }
        for key in self.retired.drain(..) {
            self.projectiles.remove(&key);
            self.automatic_planar.settings.remove(&key);
            if let Some(binding) = self.bindings.remove(&key) {
                let _ = self.physics.remove_body(binding.body);
                self.joint_stream.capture(
                    &mut self.physics,
                    &self.entities_by_body,
                    &mut self.native_joint_events,
                );
                self.lifecycle.capture(
                    &mut self.physics,
                    &self.entities_by_body,
                    &self.terrain.by_collider,
                );
                self.entities_by_body.remove(&binding.body);
            }
        }
    }

    fn write_entity(
        &self,
        world: &mut crate::world::World,
        entity: Entity,
    ) -> Result<(), UnifiedPhysicsError> {
        let binding = self
            .bindings
            .get(&(entity.id, entity.generation))
            .ok_or(UnifiedPhysicsError::StaleEntity)?;
        let state = self.physics.body_state(binding.body)?;
        let p: [f32; 3] =
            std::array::from_fn(|i| state.pose.position[i] + binding.render_offset[i]);
        match self.physics.config().space {
            Space::PlanarXy => {
                world.set_transform(entity, Transform2D { x: p[0], y: p[1] });
                world.set_velocity(
                    entity,
                    Velocity {
                        vx: state.linear_velocity[0],
                        vy: state.linear_velocity[1],
                    },
                );
                world.set_rotation(
                    entity,
                    Rotation2D {
                        radians: self.physics.planar_rotation(binding.body)? as f32,
                    },
                );
                world.set_angular_velocity(
                    entity,
                    AngularVelocity {
                        radians_per_second: state.angular_velocity[2],
                    },
                );
            }
            Space::Spatial => {
                world.set_transform(entity, Transform2D { x: p[0], y: -p[2] });
                world.set_velocity(
                    entity,
                    Velocity {
                        vx: state.linear_velocity[0],
                        vy: -state.linear_velocity[2],
                    },
                );
                let mut span = world.height_span(entity).unwrap_or(HeightSpan {
                    floor: PhysicsFloorId::DEFAULT,
                    elevation: 0.0,
                    height: 0.0,
                });
                span.elevation = p[1];
                world.set_height_span(entity, span);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod planar_navigation_tests;

#[cfg(test)]
mod planar_tests;

#[cfg(test)]
mod planar_joint_tests;

#[cfg(test)]
mod planar_spring_tests;

#[cfg(test)]
mod planar_frame_tests;

#[cfg(test)]
mod planar_contact_policy_tests;

#[cfg(test)]
mod planar_contact_correction_tests;

#[cfg(test)]
mod solver_settings_tests;

#[cfg(test)]
mod query_tests;

#[cfg(test)]
mod shape_query_tests;

#[cfg(test)]
mod collision_event_tests;

#[cfg(test)]
mod contact_query_tests;

#[cfg(test)]
mod contact_impulse_tests;

#[cfg(test)]
mod statistics_tests;

#[cfg(test)]
mod gameplay_tests;

#[cfg(test)]
mod projectile_tests;

#[cfg(test)]
mod terrain_tests;

#[cfg(test)]
mod platform_tests;

#[cfg(test)]
mod platform_blocking_tests;

#[cfg(test)]
mod combat_action_tests;

#[cfg(test)]
mod dash_tests;

#[cfg(test)]
mod file_candidate_observation_fixture;
mod file_observation_admission;
#[cfg(test)]
mod file_observation_admission_tests;
mod file_payload_admission;
#[cfg(test)]
mod file_payload_tests;

mod file_roster;
