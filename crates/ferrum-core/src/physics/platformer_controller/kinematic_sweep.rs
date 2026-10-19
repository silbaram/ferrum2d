use crate::collision::{
    collider_shape, AabbBounds, ColliderShapeRef, CollisionScratch, CollisionSystem,
    KinematicSweepCandidateQuery, SweptAabbContactHit,
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
    spatial_query_actor: Option<Entity>,
    spatial_segment_targets: Vec<usize>,
    spatial_segment_active: bool,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct KinematicDebugHit {
    pub target: Option<Entity>,
    pub point: Transform2D,
    pub normal: Velocity,
    pub span: Option<HeightSpan>,
}
impl KinematicSweepScratch {
    /// Valid only for this synchronous request/frame: all non-actor bodies remain unchanged.
    pub(crate) fn begin_spatial_query(&mut self, world: &World, actor: Entity) -> usize {
        self.spatial_segment_active = false;
        let Some(collider) = world.collider(actor) else {
            self.spatial_query_actor = None;
            return 0;
        };
        let count = CollisionSystem::prepare_kinematic_sweep_targets(
            &mut self.collision,
            world,
            KinematicSweepCandidateQuery {
                moving_index: actor.id as usize,
                ignored_index: None,
                moving_start: Transform2D::default(),
                moving_collider: collider,
                remaining: Velocity::default(),
            },
        );
        self.spatial_query_actor = Some(actor);
        count
    }
    pub(crate) fn end_spatial_query(&mut self) {
        self.spatial_query_actor = None;
        self.spatial_segment_active = false;
    }
    /// Restrict nested sweeps to a conservative reach region for one synchronous segment.
    /// The caller charges the full prepared-target scan before using the smaller nested set.
    pub(crate) fn begin_spatial_segment(
        &mut self,
        world: &World,
        actor: Entity,
        from: Transform2D,
        to: Transform2D,
    ) -> usize {
        self.spatial_segment_active = false;
        let Some(mut collider) = world.collider(actor) else {
            return 0;
        };
        // Slide projections cannot travel farther than the requested displacement. Using
        // its L1 bound also covers rotated-wall slides and gateway rounding conservatively.
        let radius = (to.x - from.x).abs() + (to.y - from.y).abs();
        collider.half_width += radius;
        collider.half_height += radius;
        if !collider.half_width.is_finite() || !collider.half_height.is_finite() {
            return CollisionSystem::kinematic_sweep_target_count(&self.collision);
        }
        CollisionSystem::query_kinematic_sweep_candidate_indices_into(
            &self.collision,
            KinematicSweepCandidateQuery {
                moving_index: actor.id as usize,
                ignored_index: None,
                moving_start: from,
                moving_collider: collider,
                remaining: Velocity::default(),
            },
            &mut self.spatial_segment_targets,
        );
        self.spatial_segment_active = self.spatial_query_actor == Some(actor);
        self.spatial_segment_targets.len()
    }
    fn build_candidates(
        &mut self,
        world: &World,
        actor: Entity,
        query: KinematicSweepCandidateQuery,
    ) {
        if self.spatial_query_actor == Some(actor) {
            if self.spatial_segment_active {
                let end = Transform2D {
                    x: query.moving_start.x + query.remaining.vx,
                    y: query.moving_start.y + query.remaining.vy,
                };
                let bounds = AabbBounds::swept(query.moving_start, end, query.moving_collider);
                self.candidates.clear();
                for &index in &self.spatial_segment_targets {
                    if query.ignored_index == Some(index) {
                        continue;
                    }
                    if let Some(target) = CollisionSystem::kinematic_target_bounds(world, index) {
                        if target.overlaps(bounds) {
                            self.candidates.push(index);
                        }
                    }
                }
                return;
            }
            CollisionSystem::query_kinematic_sweep_candidate_indices_into(
                &self.collision,
                query,
                &mut self.candidates,
            );
        } else {
            CollisionSystem::build_kinematic_sweep_candidate_indices_into(
                &mut self.collision,
                world,
                query,
                &mut self.candidates,
            );
        }
    }
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

// Compare the same rounded edges used by the sweep's separation test. Computing
// half-extent sums minus center distance can report penetration at equal f32 edges
// after a sweep stops against a fractional model proxy. No clearance epsilon is used.
fn aabb_edges_penetrate(
    at: Transform2D,
    collider: AabbCollider,
    target_at: Transform2D,
    target: AabbCollider,
) -> bool {
    let a = AabbBounds::from_transform(at, collider);
    let b = AabbBounds::from_transform(target_at, target);
    a.min_x < b.max_x && a.max_x > b.min_x && a.min_y < b.max_y && a.max_y > b.min_y
}

/// Gateways must reject penetration even when an ordinary sweep permits moving out of an overlap.
pub(super) fn spatial_pose_overlaps_solid(
    world: &World,
    tilemap: &Tilemap,
    entity: Entity,
    at: Transform2D,
    scratch: &mut KinematicSweepScratch,
    mut counters: Option<&mut PhysicsCounters>,
    solid_mask: CollisionMask,
) -> bool {
    let Some(collider) = world.collider(entity) else {
        return true;
    };
    let moving_index = entity.id as usize;
    let height_span = world.height_span(entity);
    scratch.build_candidates(
        world,
        entity,
        KinematicSweepCandidateQuery {
            moving_index,
            ignored_index: None,
            moving_start: at,
            moving_collider: collider,
            remaining: Velocity::default(),
        },
    );
    for &index in &scratch.candidates {
        if world.colliders[index].is_none() {
            if let (Some(target), Some(target_at)) = (
                collider_shape(world, index),
                world.transform_at_index(index),
            ) {
                if let Some(c) = counters.as_deref_mut() {
                    c.solid_candidate_checks = c.solid_candidate_checks.saturating_add(1);
                }
                if !target.is_trigger()
                    && solid_filter_allows(world, moving_index, index, solid_mask)
                    && height_span_allows_kinematic_target(world, index, height_span)
                    && CollisionSystem::shapes_penetrate(
                        at,
                        ColliderShapeRef::Aabb(collider),
                        target_at,
                        target,
                    )
                {
                    return true;
                }
            }
            continue;
        }
        let Some(target) = world.colliders[index] else {
            continue;
        };
        if let Some(counters) = counters.as_deref_mut() {
            counters.solid_candidate_checks = counters.solid_candidate_checks.saturating_add(1);
        }
        if target.enabled
            && !target.is_trigger
            && solid_filter_allows(world, moving_index, index, solid_mask)
            && height_span_allows_kinematic_target(world, index, height_span)
            && world
                .transform_at_index(index)
                .is_some_and(|p| aabb_edges_penetrate(at, collider, p, target))
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

    scratch.build_candidates(
        world,
        entity,
        KinematicSweepCandidateQuery {
            moving_index,
            ignored_index,
            moving_start: position,
            moving_collider: collider,
            remaining,
        },
    );

    for target_index in scratch.candidates.iter().copied() {
        if world.colliders[target_index].is_none() {
            if let Some(c) = counters.as_deref_mut() {
                c.solid_candidate_checks = c.solid_candidate_checks.saturating_add(1);
            }
            let Some(target) = collider_shape(world, target_index) else {
                continue;
            };
            if target.is_trigger()
                || !solid_filter_allows(world, moving_index, target_index, solid_mask)
            {
                continue;
            }
            if !height_span_allows_kinematic_target(world, target_index, height_span) {
                if let Some(c) = counters.as_deref_mut() {
                    c.hd2d_filtered_entity_candidates =
                        c.hd2d_filtered_entity_candidates.saturating_add(1);
                }
                continue;
            }
            let Some(target_at) = world.transform_at_index(target_index) else {
                continue;
            };
            let Some(hit) = CollisionSystem::swept_shape_contact(
                position,
                remaining,
                ColliderShapeRef::Aabb(collider),
                target_at,
                Velocity::default(),
                target,
                1.,
            ) else {
                continue;
            };
            if hit.time <= KINEMATIC_EPSILON
                && remaining.vx * hit.normal_x + remaining.vy * hit.normal_y <= 0.
            {
                continue;
            }
            let contact = SweptAabbContactHit {
                time: hit.time,
                normal_x: hit.normal_x,
                normal_y: hit.normal_y,
            };
            if best.is_none_or(|b| contact.time < b.contact.time) {
                best = Some(KinematicHit {
                    entity: world.entity_at_index(target_index),
                    contact,
                });
            }
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
            && !aabb_edges_penetrate(position, collider, target_transform, target_collider)
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
