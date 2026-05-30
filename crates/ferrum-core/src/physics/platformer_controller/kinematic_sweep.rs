use crate::collision::{CollisionSystem, SweptAabbContactHit};
use crate::components::{AabbCollider, CollisionMask, HeightSpan, Transform2D, Velocity};
use crate::entity::Entity;
use crate::tilemap::{Tilemap, TilemapSweepStats};
use crate::world::World;

use super::solid_filter::{
    is_one_way_platform_candidate, one_way_platform_contact_blocks, solid_filter_allows,
};
use crate::physics::{OneWayPlatformConfig, PhysicsCounters, KINEMATIC_EPSILON};

#[derive(Clone, Copy, Debug)]
pub(super) struct KinematicHit {
    pub(super) entity: Option<Entity>,
    pub(super) contact: SweptAabbContactHit,
}

#[derive(Clone, Copy)]
pub(super) struct KinematicSweep<'a> {
    pub(super) world: &'a World,
    pub(super) tilemap: Option<&'a Tilemap>,
    pub(super) entity: Entity,
    pub(super) position: Transform2D,
    pub(super) collider: AabbCollider,
    pub(super) remaining: Velocity,
    pub(super) solid_mask: CollisionMask,
    pub(super) one_way_platforms: OneWayPlatformConfig,
    pub(super) ignored_entity: Option<Entity>,
    pub(super) height_span: Option<HeightSpan>,
}

pub(super) fn earliest_solid_hit(
    sweep: KinematicSweep<'_>,
    mut counters: Option<&mut PhysicsCounters>,
) -> Option<KinematicHit> {
    let KinematicSweep {
        world,
        tilemap,
        entity,
        position,
        collider,
        remaining,
        solid_mask,
        one_way_platforms,
        ignored_entity,
        height_span,
    } = sweep;
    let moving_index = entity.id as usize;
    let mut best: Option<KinematicHit> = None;

    for &target_index in world.alive_indices() {
        if target_index == moving_index {
            continue;
        }
        if ignored_entity.is_some_and(|entity| {
            entity.id as usize == target_index
                && world.generations[target_index] == entity.generation
        }) {
            continue;
        }
        let Some(target_collider) = world.colliders[target_index] else {
            continue;
        };
        if !target_collider.enabled {
            continue;
        }
        if let Some(counters) = counters.as_deref_mut() {
            counters.solid_candidate_checks = counters.solid_candidate_checks.saturating_add(1);
        }
        if target_collider.is_trigger
            || !solid_filter_allows(world, moving_index, target_index, solid_mask)
        {
            continue;
        }
        if !height_span_allows_kinematic_target(world, target_index, height_span) {
            if let Some(counters) = counters.as_deref_mut() {
                counters.hd2d_filtered_entity_candidates =
                    counters.hd2d_filtered_entity_candidates.saturating_add(1);
            }
            continue;
        }
        let Some(target_transform) = world.transforms[target_index] else {
            continue;
        };
        let Some(contact) = CollisionSystem::swept_aabb_contact(
            position,
            remaining,
            collider,
            target_transform,
            Velocity::default(),
            target_collider,
            1.0,
        ) else {
            continue;
        };
        let is_one_way_platform =
            is_one_way_platform_candidate(world, target_index, one_way_platforms);
        if is_one_way_platform
            && !one_way_platform_contact_blocks(
                position,
                collider,
                remaining,
                target_transform,
                target_collider,
                contact,
            )
        {
            continue;
        }
        if contact.time <= KINEMATIC_EPSILON
            && CollisionSystem::aabb_contact(position, collider, target_transform, target_collider)
                .is_none()
            && !is_one_way_platform
        {
            continue;
        }
        let into_normal = remaining.vx * contact.normal_x + remaining.vy * contact.normal_y;
        if contact.time <= KINEMATIC_EPSILON && into_normal <= 0.0 {
            continue;
        }
        if best.is_none_or(|hit| contact.time < hit.contact.time) {
            best = Some(KinematicHit {
                entity: Some(Entity {
                    id: target_index as u32,
                    generation: world.generations[target_index],
                }),
                contact,
            });
        }
    }

    if let Some(tilemap) = tilemap {
        let mut stats = TilemapSweepStats::default();
        if let Some(hit) = tilemap.swept_aabb_contact_with_movement_height_span(
            position,
            collider,
            remaining,
            height_span,
            &mut stats,
        ) {
            if let Some(counters) = counters.as_deref_mut() {
                counters.tile_candidate_checks = counters
                    .tile_candidate_checks
                    .saturating_add(stats.candidate_tiles);
                counters.hd2d_filtered_tile_candidates = counters
                    .hd2d_filtered_tile_candidates
                    .saturating_add(stats.hd2d_filtered_tiles);
            }
            if best.is_none_or(|best_hit| hit.contact.time < best_hit.contact.time) {
                best = Some(KinematicHit {
                    entity: None,
                    contact: hit.contact,
                });
            }
        } else if let Some(counters) = counters {
            counters.tile_candidate_checks = counters
                .tile_candidate_checks
                .saturating_add(stats.candidate_tiles);
            counters.hd2d_filtered_tile_candidates = counters
                .hd2d_filtered_tile_candidates
                .saturating_add(stats.hd2d_filtered_tiles);
        }
    }

    best
}

fn height_span_allows_kinematic_target(
    world: &World,
    target_index: usize,
    moving_height_span: Option<crate::components::HeightSpan>,
) -> bool {
    match moving_height_span {
        Some(query_span) => world
            .height_span_at(target_index)
            .is_none_or(|target_span| query_span.overlaps(target_span)),
        None => true,
    }
}
