use crate::components::Velocity;
use crate::entity::Entity;
use crate::physics::{
    KinematicMoveResult, KinematicMoveSettings, MovingPlatformCarryConfig,
    MovingPlatformRotationCarryConfig,
};
use crate::tilemap::Tilemap;
use crate::world::World;

use super::super::math::finite_velocity;
use super::ground_probe::ground_probe_internal;
use super::kinematic_sweep::KinematicSweepScratch;
use super::move_and_slide_internal;

pub(super) fn carry_moving_platform_internal(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    rider: Entity,
    config: MovingPlatformCarryConfig,
    rotation_carry: Option<MovingPlatformRotationCarryConfig>,
) -> Option<KinematicMoveResult> {
    let ground = ground_probe_internal(
        world,
        tilemap,
        rider,
        config.probe_distance,
        config.solid_mask,
    )?;
    if ground.entity != Some(config.platform) {
        return None;
    }
    let mut scratch = KinematicSweepScratch::default();
    let displacement = moving_platform_carry_displacement(world, rider, config, rotation_carry);

    Some(move_and_slide_internal(
        world,
        tilemap,
        rider,
        displacement,
        KinematicMoveSettings::new(
            config.solid_mask,
            config.one_way_platforms,
            config.max_iterations,
        )
        .ignoring_entity(config.platform),
        &mut scratch,
        None,
    ))
}

fn moving_platform_carry_displacement(
    world: &World,
    rider: Entity,
    config: MovingPlatformCarryConfig,
    rotation_carry: Option<MovingPlatformRotationCarryConfig>,
) -> Velocity {
    let mut displacement = finite_velocity(config.displacement);
    let Some(rotation_carry) = rotation_carry else {
        return displacement;
    };
    if !rotation_carry.delta_radians.is_finite() {
        return displacement;
    }
    if !rotation_carry.origin.x.is_finite() || !rotation_carry.origin.y.is_finite() {
        return displacement;
    }

    let Some(rider_transform) = world.transform(rider) else {
        return displacement;
    };
    if !rider_transform.x.is_finite() || !rider_transform.y.is_finite() {
        return displacement;
    }

    let radius_x = rider_transform.x - rotation_carry.origin.x;
    let radius_y = rider_transform.y - rotation_carry.origin.y;
    let (sin, cos) = rotation_carry.delta_radians.sin_cos();
    let rotated_x = radius_x * cos - radius_y * sin;
    let rotated_y = radius_x * sin + radius_y * cos;
    let rotation_displacement = finite_velocity(Velocity {
        vx: rotated_x - radius_x,
        vy: rotated_y - radius_y,
    });
    displacement.vx += rotation_displacement.vx;
    displacement.vy += rotation_displacement.vy;
    finite_velocity(displacement)
}
