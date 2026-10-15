use crate::collision::{
    CollisionScratch, CollisionSystem, KinematicSweepCandidateQuery, SweptAabbContactHit,
};
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

#[derive(Default)]
pub(crate) struct KinematicSweepScratch {
    collision: CollisionScratch,
    candidates: Vec<usize>,
    spatial_tile_contacts: Vec<crate::tilemap::TilemapContactHit>,
    pub(crate) debug_hits: Vec<KinematicDebugHit>,
    pub(crate) debug_truncated: bool,
    capture_debug_hits: bool,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct KinematicDebugHit {
    pub target: Option<Entity>,
    pub point: Transform2D,
    pub normal: Velocity,
    pub span: Option<HeightSpan>,
}
impl KinematicSweepScratch {
    pub fn begin_debug_capture(&mut self, enabled: bool) {
        self.capture_debug_hits = enabled;
        self.debug_hits.clear();
        self.debug_truncated = false;
        if enabled && self.debug_hits.capacity() < 128 {
            self.debug_hits.reserve(128);
        }
    }
    pub fn set_debug_capture(&mut self, enabled: bool) {
        self.capture_debug_hits = enabled;
    }
    pub(super) fn record_debug_hit(
        &mut self,
        hit: KinematicHit,
        position: Transform2D,
        collider: AabbCollider,
        span: Option<HeightSpan>,
    ) {
        if !self.capture_debug_hits {
            return;
        }
        if self.debug_hits.len() == 128 {
            self.debug_truncated = true;
            return;
        }
        let center = collider.center(position);
        self.debug_hits.push(KinematicDebugHit {
            target: hit.entity,
            point: Transform2D {
                x: center.x + hit.contact.normal_x * collider.half_width,
                y: center.y + hit.contact.normal_y * collider.half_height,
            },
            normal: Velocity {
                vx: hit.contact.normal_x,
                vy: hit.contact.normal_y,
            },
            span,
        });
    }
}

/// Gateways must reject penetration even when an ordinary sweep permits moving out of an overlap.
pub(super) fn spatial_pose_overlaps_solid(
    world: &World,
    tilemap: &Tilemap,
    entity: Entity,
    at: Transform2D,
    scratch: &mut KinematicSweepScratch,
    mut counters: Option<&mut PhysicsCounters>,
) -> bool {
    let Some(collider) = world.collider(entity) else {
        return true;
    };
    let moving_index = entity.id as usize;
    let height_span = world.height_span(entity);
    CollisionSystem::build_kinematic_sweep_candidate_indices_into(
        &mut scratch.collision,
        world,
        KinematicSweepCandidateQuery {
            moving_index,
            ignored_index: None,
            moving_start: at,
            moving_collider: collider,
            remaining: Velocity::default(),
        },
        &mut scratch.candidates,
    );
    for &index in &scratch.candidates {
        let Some(target) = world.colliders[index] else {
            continue;
        };
        if let Some(counters) = counters.as_deref_mut() {
            counters.solid_candidate_checks = counters.solid_candidate_checks.saturating_add(1);
        }
        if target.enabled
            && !target.is_trigger
            && solid_filter_allows(world, moving_index, index, CollisionMask::ALL)
            && height_span_allows_kinematic_target(world, index, height_span)
            && world
                .transform_at_index(index)
                .is_some_and(|p| CollisionSystem::aabb_contact(at, collider, p, target).is_some())
        {
            return true;
        }
    }
    tilemap.aabb_obstacle_contacts_with_height_span_into(
        at,
        collider,
        height_span,
        &mut scratch.spatial_tile_contacts,
    );
    !scratch.spatial_tile_contacts.is_empty()
}

pub(super) fn earliest_solid_hit(
    sweep: KinematicSweep<'_>,
    scratch: &mut KinematicSweepScratch,
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
    let ignored_index = ignored_entity
        .filter(|entity| world.generation_at_index(entity.id as usize) == Some(entity.generation))
        .map(|entity| entity.id as usize);
    let mut best: Option<KinematicHit> = None;

    CollisionSystem::build_kinematic_sweep_candidate_indices_into(
        &mut scratch.collision,
        world,
        KinematicSweepCandidateQuery {
            moving_index,
            ignored_index,
            moving_start: position,
            moving_collider: collider,
            remaining,
        },
        &mut scratch.candidates,
    );

    for target_index in scratch.candidates.iter().copied() {
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
        let Some(target_transform) = world.transform_at_index(target_index) else {
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
            // The slab sweep also reports time zero for touching boxes moving
            // apart or tangentially. Only discard those contacts, not a small
            // positive TOI or motion into a touching face (including retries).
            let a = collider.center(position);
            let b = target_collider.center(target_transform);
            if (a.x + collider.half_width <= b.x - target_collider.half_width
                && remaining.vx <= 0.0)
                || (a.x - collider.half_width >= b.x + target_collider.half_width
                    && remaining.vx >= 0.0)
                || (a.y + collider.half_height <= b.y - target_collider.half_height
                    && remaining.vy <= 0.0)
                || (a.y - collider.half_height >= b.y + target_collider.half_height
                    && remaining.vy >= 0.0)
            {
                continue;
            }
        }
        let into_normal = remaining.vx * contact.normal_x + remaining.vy * contact.normal_y;
        if contact.time <= KINEMATIC_EPSILON && into_normal <= 0.0 {
            continue;
        }
        if best.is_none_or(|hit| contact.time < hit.contact.time) {
            best = Some(KinematicHit {
                entity: world.entity_at_index(target_index),
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
