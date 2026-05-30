use crate::collision::CollisionSystem;
use crate::components::{CollisionMask, Velocity};
use crate::entity::Entity;
use crate::tilemap::Tilemap;
use crate::world::World;

use super::config::is_valid_probe_distance;
use super::solid_filter::{is_ground_normal, solid_filter_allows};
use crate::physics::{GroundProbeHit, KINEMATIC_EPSILON};

pub(super) fn ground_probe_internal(
    world: &World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    probe_distance: f32,
    solid_mask: CollisionMask,
) -> Option<GroundProbeHit> {
    if !is_valid_probe_distance(probe_distance) {
        return None;
    }
    let start = world.transform(entity)?;
    let collider = world.collider(entity)?;
    if !collider.enabled {
        return None;
    }
    let moving_index = entity.id as usize;
    let displacement = Velocity {
        vx: 0.0,
        vy: probe_distance,
    };
    let mut best = None;

    for &target_index in world.alive_indices() {
        if target_index == moving_index {
            continue;
        }
        let Some(target_collider) = world.colliders[target_index] else {
            continue;
        };
        if !target_collider.enabled
            || target_collider.is_trigger
            || !solid_filter_allows(world, moving_index, target_index, solid_mask)
        {
            continue;
        }
        let Some(target_transform) = world.transforms[target_index] else {
            continue;
        };
        let Some(contact) = CollisionSystem::swept_aabb_contact(
            start,
            displacement,
            collider,
            target_transform,
            Velocity::default(),
            target_collider,
            1.0,
        ) else {
            continue;
        };
        if !is_ground_normal(contact.normal_y) {
            continue;
        }
        let into_normal = displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
        if contact.time <= KINEMATIC_EPSILON && into_normal <= 0.0 {
            continue;
        }
        update_ground_probe_hit(
            &mut best,
            GroundProbeHit {
                entity: Some(Entity {
                    id: target_index as u32,
                    generation: world.generations[target_index],
                }),
                tile_layer_index: None,
                tile_index: None,
                distance: probe_distance * contact.time.clamp(0.0, 1.0),
                normal_x: contact.normal_x,
                normal_y: contact.normal_y,
            },
        );
    }

    if let Some(tilemap) = tilemap {
        if let Some(hit) = tilemap.ground_probe_contact(start, collider, probe_distance) {
            update_ground_probe_hit(
                &mut best,
                GroundProbeHit {
                    entity: None,
                    tile_layer_index: Some(hit.layer_index),
                    tile_index: Some(hit.tile_index),
                    distance: probe_distance * hit.contact.time.clamp(0.0, 1.0),
                    normal_x: hit.contact.normal_x,
                    normal_y: hit.contact.normal_y,
                },
            );
        }
    }

    best
}

fn update_ground_probe_hit(best: &mut Option<GroundProbeHit>, next: GroundProbeHit) {
    if best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| ground_probe_source_key(next).cmp(&ground_probe_source_key(current)))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

fn ground_probe_source_key(hit: GroundProbeHit) -> (u8, u32, u32, usize, usize) {
    if let Some(entity) = hit.entity {
        (0, entity.id, entity.generation, usize::MAX, usize::MAX)
    } else {
        (
            1,
            u32::MAX,
            u32::MAX,
            hit.tile_layer_index.unwrap_or(usize::MAX),
            hit.tile_index.unwrap_or(usize::MAX),
        )
    }
}
