use crate::entity::Entity;
use crate::physics::{KinematicMoveResult, KinematicMoveSettings, MovingPlatformCarryConfig};
use crate::tilemap::Tilemap;
use crate::world::World;

use super::ground_probe::ground_probe_internal;
use super::move_and_slide_internal;

pub(super) fn carry_moving_platform_internal(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    rider: Entity,
    config: MovingPlatformCarryConfig,
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

    Some(move_and_slide_internal(
        world,
        tilemap,
        rider,
        config.displacement,
        KinematicMoveSettings::new(
            config.solid_mask,
            config.one_way_platforms,
            config.max_iterations,
        )
        .ignoring_entity(config.platform),
        None,
    ))
}
