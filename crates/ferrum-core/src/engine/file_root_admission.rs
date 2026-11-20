//! Partial, cold admission of Engine root execution settings and references.
//!
//! Preconditions: the actual native PhysicsWorld, World storage, variable slab
//! and World payload have their own admission passes. This pass neither proves
//! complete Engine admission nor admits any of its subsystem caches/outputs.
//! Read-only: no reconstruction, sanitization, reset, query, simulation or commit.

use super::{Engine, SceneMode, MAX_PARTICLE_PRESETS};
use crate::entity::Entity;
use crate::input::InputState;
use crate::physics3d::Space;
use crate::world::World;

#[derive(Clone, Copy, Debug)]
pub(in crate::engine) struct Limits {
    /// Logical records, not scalar instructions, solver work, CPU time or RSS.
    pub max_work: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(in crate::engine) struct Usage {
    pub work: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::engine) enum Reference {
    LastDataEntity,
    CameraFollow,
    PlatformerPlayer,
    PlatformerPlatform,
    BreakoutPaddle,
    BreakoutBall,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::engine) enum Error {
    WorkLimit,
    Elapsed,
    Hd2dResult,
    Input { previous: bool },
    InputAction { index: usize },
    Camera,
    CameraConfiguration,
    ClockConfiguration,
    ClockAccumulator,
    LastFixedUpdate,
    NativeClock,
    DefaultPhysics,
    AutoStepScalars,
    GroundSun,
    ParticlePresetReference,
    SceneModeReference,
    EntityHistory(Reference),
}

struct Budget {
    max: usize,
    usage: Usage,
}

impl Budget {
    fn charge(&mut self, work: usize) -> Result<(), Error> {
        let next = self.usage.work.checked_add(work).ok_or(Error::WorkLimit)?;
        if next > self.max {
            return Err(Error::WorkLimit);
        }
        self.usage.work = next;
        Ok(())
    }
}

/// This result describes root settings only. The detached caller must retain all
/// other admission obligations and must not expose/step/query/publish the Engine.
#[allow(dead_code)] // Staged separately from public import/session publication.
pub(in crate::engine) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut budget = Budget {
        max: limits.max_work,
        usage: Usage::default(),
    };
    budget.charge(1)?;
    // Legacy update adds signed delta verbatim. Negative finite elapsed is legal.
    // Rejecting nonfinite values here is a file policy, not a claim that every
    // legacy public setter already prevents them.
    if !engine.elapsed_seconds.is_finite() {
        return Err(Error::Elapsed);
    }
    if !engine.hd2d_kinematic_elevation_delta.is_finite()
        || engine.hd2d_kinematic_flags & !0xff != 0
    {
        return Err(Error::Hd2dResult);
    }
    // Debug-line flags accept all u32 bits. Revisions, cached hit counts and
    // booleans have no additional range restrictions; do not erase their history.

    budget.charge(2)?;
    validate_input(engine.input, false)?;
    validate_input(engine.previous_input_sample, true)?;
    // The latch consists only of serde-checked bools. It records missed presses,
    // so its bits need not equal current or previous sampled input.
    let actions = engine.input_actions.file_binding_action_ids();
    budget.charge(actions.len())?; // Exact fixed owner array, before any iteration.
    for (index, action) in actions.enumerate() {
        if action == Some(0) {
            return Err(Error::InputAction { index });
        }
    }

    budget.charge(2)?;
    validate_clock(engine)?;
    if engine.unified_physics.is_some() {
        budget.charge(1)?;
        if engine.fixed_timestep.config().step_seconds
            != engine.unified_physics_clock_step_seconds()
        {
            return Err(Error::NativeClock);
        }
        // Native default installation can retain a previous legacy frame/step
        // budget. Do not impose configure_unified_physics_clock's newer caps here.
    }
    if let Some(default) = &engine.default_unified_physics {
        budget.charge(1)?;
        if default.space != Space::PlanarXy
            || default.validate_file_configuration().is_err()
            || engine.unified_physics.is_none()
        {
            return Err(Error::DefaultPhysics);
        }
        // Explicit scene worlds/settings may override the saved next-scene policy.
    }

    budget.charge(1)?;
    let auto = engine.auto_rigid_body_step_config;
    if ![
        auto.gravity.vx,
        auto.gravity.vy,
        auto.position_correction_percent,
        auto.position_correction_slop,
        auto.restitution_velocity_threshold,
        auto.contact_baumgarte_bias_factor,
        auto.max_contact_baumgarte_bias_velocity,
    ]
    .iter()
    .all(|value| value.is_finite())
    {
        return Err(Error::AutoStepScalars);
    }
    // Producers store raw settings; consumers sanitize them. Finite negative or
    // large coefficients and 0/u32::MAX iterations must remain byte-for-byte.

    budget.charge(2)?;
    let camera = engine.camera;
    if ![
        camera.x,
        camera.y,
        camera.viewport_width,
        camera.viewport_height,
    ]
    .iter()
    .all(|value| value.is_finite())
        || camera.viewport_width <= 0.0
        || camera.viewport_height <= 0.0
        || !(0.01..=1.0).contains(&camera.ground_y_scale)
    {
        return Err(Error::Camera);
    }
    let (follow, bounds, smooth) = engine.data_scene.camera.file_configuration();
    if !smooth.is_finite()
        || smooth < 0.0
        || bounds.is_some_and(|[min_x, min_y, max_x, max_y]| {
            ![min_x, min_y, max_x, max_y]
                .iter()
                .all(|value| value.is_finite())
                || min_x > max_x
                || min_y > max_y
        })
    {
        return Err(Error::CameraConfiguration);
    }
    // Free camera, interpolation and dirty/pending follow targets need not have
    // the same center or bounds as a newly reconstructed current scene.

    budget.charge(1)?;
    let sun = engine.ground_sun;
    if ![sun.projection.direction_x, sun.projection.direction_y]
        .iter()
        .all(|value| value.is_finite() && value.abs() <= 2.0)
        || (sun.projection.direction_x == 0.0 && sun.projection.direction_y == 0.0)
        || !(0.01..=100.0).contains(&sun.projection.length_scale)
        || !(0.0..=1.0).contains(&sun.opacity)
        || sun.max_casters > 10000
    {
        return Err(Error::GroundSun);
    }
    // Conservative finite envelope, not a proof of exact direction unit norm.
    // Ground-shadow generated geometry and renderer history belong to their owner.

    budget.charge(1)?;
    if engine.particle_presets.len() > MAX_PARTICLE_PRESETS
        || engine
            .shooter_hit_particle_preset
            .is_some_and(|id| id as usize >= MAX_PARTICLE_PRESETS)
    {
        return Err(Error::ParticlePresetReference);
    }
    // A selected preset may intentionally be absent/not registered yet. No
    // elements/capacity in the dynamic preset vector are scanned by this pass.
    if engine.scene_mode == SceneMode::BuiltIn && engine.data_scene_entity.is_some() {
        return Err(Error::SceneModeReference);
    }
    let references = [
        (Reference::LastDataEntity, engine.data_scene_entity),
        (Reference::CameraFollow, follow),
        (
            Reference::PlatformerPlayer,
            engine.scenes.platformer().player_entity(),
        ),
        (
            Reference::PlatformerPlatform,
            engine.scenes.platformer().moving_platform_entity(),
        ),
        (
            Reference::BreakoutPaddle,
            engine.scenes.breakout().paddle_entity(),
        ),
        (
            Reference::BreakoutBall,
            engine.scenes.breakout().ball_entity(),
        ),
    ];
    budget.charge(references.len())?;
    for (field, reference) in references {
        if let Some(entity) = reference {
            validate_entity_history(&engine.world, entity)
                .map_err(|()| Error::EntityHistory(field))?;
        }
    }
    // World raw primary-actor marker validity belongs to World payload admission.
    // Last spawned Data entity, scene-owned handles and primary actor are distinct.
    Ok(budget.usage)
}

fn validate_input(input: InputState, previous: bool) -> Result<(), Error> {
    if [
        input.w,
        input.a,
        input.s,
        input.d,
        input.space,
        input.enter,
        input.mouse_left,
    ]
    .iter()
    .any(|value| *value > 1)
        || !input.mouse_x.is_finite()
        || !input.mouse_y.is_finite()
    {
        return Err(Error::Input { previous });
    }
    Ok(())
}

fn validate_clock(engine: &Engine) -> Result<(), Error> {
    let clock = engine.fixed_timestep.config();
    if !clock.step_seconds.is_finite()
        || clock.step_seconds <= 0.0
        || !clock.max_frame_seconds.is_finite()
        || clock.max_frame_seconds <= 0.0
        || clock.max_steps_per_update == 0
    {
        return Err(Error::ClockConfiguration);
    }
    // advance() may consume a tick up to epsilon early. A conservative one-ulp
    // allowance covers the rounded addition in that readiness predicate; the
    // near-step subtraction itself is exact by Sterbenz's lemma. No clamping.
    let epsilon = 0.0001f32.min(clock.step_seconds * 0.01);
    let allowance = epsilon + clock.step_seconds * f32::EPSILON;
    let accumulated = engine.fixed_timestep.accumulated_seconds();
    if !accumulated.is_finite() || accumulated < -allowance || accumulated > clock.step_seconds {
        return Err(Error::ClockAccumulator);
    }
    let last = engine.last_fixed_update;
    if !(0.0..=1.0).contains(&last.alpha)
        || !last.consumed_seconds.is_finite()
        || last.consumed_seconds < 0.0
        || !last.dropped_seconds.is_finite()
        || last.dropped_seconds < 0.0
        || (last.steps == 0) != (last.consumed_seconds == 0.0)
    {
        return Err(Error::LastFixedUpdate);
    }
    // This is cached output: no equality to the current clock, paused state or
    // interpolation flags is required, and dropped/consumed need not sum to dt.
    Ok(())
}

fn validate_entity_history(world: &World, entity: Entity) -> Result<(), ()> {
    let generation = world.generation_at_index(entity.id as usize).ok_or(())?;
    if entity.generation > generation
        || (!world.is_current_entity(entity)
            && entity.generation == generation
            && generation != u32::MAX)
    {
        return Err(());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
