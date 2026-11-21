use crate::components::Velocity;
use crate::entity::Entity;
use crate::physics::{
    KinematicMoveSettings, PhysicsCounters, PlatformerControllerConfig, PlatformerControllerInput,
    PlatformerControllerResult, PlatformerControllerState, SlopeSegment, KINEMATIC_EPSILON,
};
use crate::tilemap::Tilemap;
use crate::world::World;

use super::ground_probe::ground_probe_internal;
use super::kinematic_sweep::KinematicSweepScratch;
use super::slope_ground::{
    merge_slope_ground_hit, move_with_optional_slope_snap, slope_ground_hit, SlopeSnapDirection,
    SlopeSnapMoveSettings, SlopeSnapSettings,
};
use super::state_step::{
    finish_platformer_velocity, prepare_platformer_velocity, sanitized_platformer_step,
};
use super::step_offset::{
    move_with_optional_step_offset, StepOffsetMoveSettings, StepOffsetSettings,
};

#[derive(Default)]
pub(super) struct PlatformerControllerRuntime<'a> {
    state: Option<&'a mut PlatformerControllerState>,
    counters: Option<&'a mut PhysicsCounters>,
    slopes: &'a [SlopeSegment],
}

impl<'a> PlatformerControllerRuntime<'a> {
    pub(super) fn new(
        state: Option<&'a mut PlatformerControllerState>,
        counters: Option<&'a mut PhysicsCounters>,
    ) -> Self {
        Self::new_with_slopes(state, counters, &[])
    }

    pub(super) fn new_with_slopes(
        state: Option<&'a mut PlatformerControllerState>,
        counters: Option<&'a mut PhysicsCounters>,
        slopes: &'a [SlopeSegment],
    ) -> Self {
        Self {
            state,
            counters,
            slopes,
        }
    }
}

pub(super) fn move_platformer_controller_internal(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    input: PlatformerControllerInput,
    config: PlatformerControllerConfig,
    delta_seconds: f32,
    runtime: PlatformerControllerRuntime<'_>,
) -> PlatformerControllerResult {
    let PlatformerControllerRuntime {
        mut state,
        mut counters,
        slopes,
    } = runtime;
    let (config, delta_seconds) = sanitized_platformer_step(config, delta_seconds);
    let ground_before_probe = ground_probe_internal(
        world,
        tilemap,
        entity,
        config.ground_probe_distance,
        config.solid_mask,
    );
    let slope_before = slope_ground_hit(
        world,
        tilemap,
        entity,
        slopes,
        config.slope,
        true,
        config.slope.allow_downhill_snap,
    );
    let ground_before = merge_slope_ground_hit(ground_before_probe, slope_before);
    let step = prepare_platformer_velocity(
        world.velocity(entity).unwrap_or_default(),
        input,
        config,
        delta_seconds,
        ground_before.is_some(),
        &mut state,
    );
    let velocity = step.velocity;
    let jumped = step.jumped;

    let movement_settings = KinematicMoveSettings::new(
        config.solid_mask,
        config.one_way_platforms,
        config.max_iterations,
    );
    let mut movement_scratch = KinematicSweepScratch::default();
    let mut movement = move_with_optional_step_offset(
        world,
        tilemap,
        entity,
        Velocity {
            vx: velocity.vx * delta_seconds,
            vy: velocity.vy * delta_seconds,
        },
        StepOffsetMoveSettings {
            movement: movement_settings,
            step: if !jumped && ground_before.is_some() {
                StepOffsetSettings {
                    enabled: true,
                    offset: config.step_offset,
                    ground_probe_distance: config.ground_probe_distance,
                    solid_mask: config.solid_mask,
                }
            } else {
                StepOffsetSettings::disabled()
            },
        },
        &mut movement_scratch,
        counters.as_deref_mut(),
    );
    if !jumped {
        let allow_upward_snap = ground_before.is_some();
        let allow_downward_snap = config.slope.allow_downhill_snap
            && (ground_before.is_some() || velocity.vy >= -KINEMATIC_EPSILON);
        movement = move_with_optional_slope_snap(
            world,
            tilemap,
            entity,
            movement,
            SlopeSnapMoveSettings {
                movement: movement_settings,
                slope_snap: SlopeSnapSettings {
                    slopes,
                    slope: config.slope,
                    direction: SlopeSnapDirection {
                        allow_upward: allow_upward_snap,
                        allow_downward: allow_downward_snap,
                    },
                },
            },
            &mut movement_scratch,
            counters,
        );
    }
    let ground_after_probe = ground_probe_internal(
        world,
        tilemap,
        entity,
        config.ground_probe_distance,
        config.solid_mask,
    );
    let slope_after = slope_ground_hit(
        world,
        tilemap,
        entity,
        slopes,
        config.slope,
        true,
        config.slope.allow_downhill_snap,
    );
    let ground_after = merge_slope_ground_hit(ground_after_probe, slope_after);
    let step = finish_platformer_velocity(
        step,
        movement.blocked_y,
        ground_after.is_some(),
        config,
        &mut state,
    );
    let velocity = step.velocity;
    let jumped = step.jumped;
    world.set_velocity(entity, velocity);

    PlatformerControllerResult {
        movement,
        velocity,
        ground_before,
        ground_after,
        jumped,
        grounded: ground_after.is_some() && !jumped,
    }
}
