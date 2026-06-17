use crate::components::{CollisionMask, Velocity};
use crate::entity::Entity;
use crate::tilemap::Tilemap;
use crate::world::World;

use super::ground_probe::ground_probe_internal;
use super::kinematic_sweep::KinematicSweepScratch;
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

#[derive(Clone, Copy)]
pub(super) struct StepOffsetMoveSettings {
    pub(super) movement: KinematicMoveSettings,
    pub(super) step: StepOffsetSettings,
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
    settings: StepOffsetMoveSettings,
    scratch: &mut KinematicSweepScratch,
    mut counters: Option<&mut PhysicsCounters>,
) -> KinematicMoveResult {
    let normal = move_and_slide_internal(
        world,
        tilemap,
        entity,
        displacement,
        settings.movement,
        scratch,
        counters.as_deref_mut(),
    );
    if !settings.step.should_attempt(normal, displacement) {
        return normal;
    }
    if blocking_entity_exceeds_step_offset(
        world,
        entity,
        normal.last_hit,
        normal.start,
        settings.step.offset,
    ) {
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
            vy: -settings.step.offset,
        },
        settings.movement,
        scratch,
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
        settings.movement,
        scratch,
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
            vy: settings.step.offset + settings.step.ground_probe_distance,
        },
        settings.movement,
        scratch,
        counters,
    );
    if ground_probe_internal(
        world,
        tilemap,
        entity,
        settings.step.ground_probe_distance,
        settings.step.solid_mask,
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

fn blocking_entity_exceeds_step_offset(
    world: &World,
    moving_entity: Entity,
    blocking_entity: Option<Entity>,
    moving_start: crate::components::Transform2D,
    step_offset: f32,
) -> bool {
    let Some(blocking_entity) = blocking_entity else {
        return false;
    };
    let Some(moving_collider) = world.collider(moving_entity) else {
        return false;
    };
    let Some(blocking_transform) = world.transform(blocking_entity) else {
        return false;
    };
    let Some(blocking_collider) = world.collider(blocking_entity) else {
        return false;
    };

    let moving_bottom = moving_collider.center(moving_start).y + moving_collider.half_height;
    let blocking_top =
        blocking_collider.center(blocking_transform).y - blocking_collider.half_height;
    let required_step = moving_bottom - blocking_top;
    required_step > step_offset + KINEMATIC_EPSILON
}
