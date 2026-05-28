use crate::components::{CollisionMask, Velocity};
use crate::entity::Entity;
use crate::tilemap::Tilemap;
use crate::world::World;

use super::ground_probe::ground_probe_internal;
use super::move_and_slide_internal;
use crate::physics::{
    KinematicMoveResult, KinematicMoveSettings, PhysicsCounters, KINEMATIC_EPSILON,
};

#[derive(Clone, Copy)]
pub(super) struct StepOffsetSettings {
    pub(super) enabled: bool,
    pub(super) offset: f32,
    pub(super) ground_probe_distance: f32,
    pub(super) solid_mask: CollisionMask,
}

impl StepOffsetSettings {
    pub(super) const fn disabled() -> Self {
        Self {
            enabled: false,
            offset: 0.0,
            ground_probe_distance: 0.0,
            solid_mask: CollisionMask::NONE,
        }
    }

    fn should_attempt(self, movement: KinematicMoveResult, displacement: Velocity) -> bool {
        self.enabled
            && self.offset > 0.0
            && movement.blocked_x
            && displacement.vx.abs() > KINEMATIC_EPSILON
            && displacement.vy >= -KINEMATIC_EPSILON
    }
}

pub(super) fn move_with_optional_step_offset(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    displacement: Velocity,
    settings: KinematicMoveSettings,
    step: StepOffsetSettings,
    mut counters: Option<&mut PhysicsCounters>,
) -> KinematicMoveResult {
    let normal = move_and_slide_internal(
        world,
        tilemap,
        entity,
        displacement,
        settings,
        counters.as_deref_mut(),
    );
    if !step.should_attempt(normal, displacement) {
        return normal;
    }

    let normal_end = normal.end;
    world.set_transform(entity, normal.start);

    let step_up = move_and_slide_internal(
        world,
        tilemap,
        entity,
        Velocity {
            vx: 0.0,
            vy: -step.offset,
        },
        settings,
        counters.as_deref_mut(),
    );
    if step_up.blocked_y {
        world.set_transform(entity, normal_end);
        return normal;
    }

    let step_across = move_and_slide_internal(
        world,
        tilemap,
        entity,
        Velocity {
            vx: displacement.vx,
            vy: 0.0,
        },
        settings,
        counters.as_deref_mut(),
    );
    if step_across.blocked_x {
        world.set_transform(entity, normal_end);
        return normal;
    }

    let step_down = move_and_slide_internal(
        world,
        tilemap,
        entity,
        Velocity {
            vx: 0.0,
            vy: step.offset + step.ground_probe_distance,
        },
        settings,
        counters,
    );
    if ground_probe_internal(
        world,
        tilemap,
        entity,
        step.ground_probe_distance,
        step.solid_mask,
    )
    .is_none()
    {
        world.set_transform(entity, normal_end);
        return normal;
    }

    let end = world.transform(entity).unwrap_or(step_down.end);
    KinematicMoveResult {
        start: normal.start,
        end,
        requested: displacement,
        remaining: Velocity::default(),
        hit_count: step_up
            .hit_count
            .saturating_add(step_across.hit_count)
            .saturating_add(step_down.hit_count),
        blocked_x: false,
        blocked_y: step_down.blocked_y,
        last_hit: step_down
            .last_hit
            .or(step_across.last_hit)
            .or(step_up.last_hit),
    }
}
