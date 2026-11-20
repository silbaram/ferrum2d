//! Speculative Platformer movement uses native geometry with shared jump state.
use super::*;
use crate::physics::{
    finish_platformer_velocity, prepare_platformer_velocity, sanitized_platformer_step,
    GroundProbeHit, KinematicMoveResult, PhysicsCounters, PlatformerControllerConfig,
    PlatformerControllerInput, PlatformerControllerResult, PlatformerControllerState,
    PlatformerVelocityStep, KINEMATIC_EPSILON,
};

pub(super) struct PlatformerGeometry<'a> {
    pub runtime: &'a mut UnifiedPhysicsRuntime,
    pub body: BodyId,
    pub origin: Transform2D,
    pub active: bool,
    pub counters: &'a mut PhysicsCounters,
}

impl PlatformerGeometry<'_> {
    fn offset(&self, at: Transform2D) -> [f32; 3] {
        [at.x - self.origin.x, at.y - self.origin.y, 0.]
    }

    pub(super) fn probe(
        &mut self,
        at: Transform2D,
        distance: f32,
        config: PlatformerControllerConfig,
    ) -> Result<Option<GroundProbeHit>, UnifiedPhysicsError> {
        if !self.active {
            return Ok(None);
        }
        let (hit, candidates) = self.runtime.physics.probe_planar_platformer_ground(
            self.body,
            self.offset(at),
            distance,
            config.solid_mask.bits,
            config.one_way_platforms.platform_mask.bits,
            None,
        )?;
        self.counters.solid_candidate_checks = self
            .counters
            .solid_candidate_checks
            .saturating_add(candidates);
        Ok(hit.map(|hit| {
            let (layer, tile) = match self.runtime.terrain.source(hit.target.collider) {
                Some(UnifiedTerrainSource::Tile { layer, tile }) => {
                    (Some(layer as usize), Some(tile as usize))
                }
                _ => (None, None),
            };
            GroundProbeHit {
                entity: self.runtime.entities_by_body.get(&hit.target.body).copied(),
                tile_layer_index: layer,
                tile_index: tile,
                distance: distance * hit.fraction,
                normal_x: -hit.normal[0],
                normal_y: -hit.normal[1],
            }
        }))
    }

    pub(super) fn slide(
        &mut self,
        start: Transform2D,
        displacement: Velocity,
        config: PlatformerControllerConfig,
        ignored: Option<BodyId>,
    ) -> Result<KinematicMoveResult, UnifiedPhysicsError> {
        self.counters.kinematic_moves = self.counters.kinematic_moves.saturating_add(1);
        let mut end = start;
        let mut remaining = displacement;
        let mut hit_count = 0u32;
        let mut blocked_x = false;
        let mut blocked_y = false;
        let mut last_hit = None;
        if !self.active || config.max_iterations == 0 {
            end.x += remaining.vx;
            end.y += remaining.vy;
            remaining = Velocity::default();
        } else {
            for _ in 0..config.max_iterations.min(8) {
                if remaining.vx * remaining.vx + remaining.vy * remaining.vy
                    <= KINEMATIC_EPSILON * KINEMATIC_EPSILON
                {
                    remaining = Velocity::default();
                    break;
                }
                let (hit, candidates) = self.runtime.physics.sweep_planar_platformer(
                    self.body,
                    self.offset(end),
                    [remaining.vx, remaining.vy, 0.],
                    config.solid_mask.bits,
                    config.one_way_platforms.platform_mask.bits,
                    ignored,
                )?;
                self.counters.solid_candidate_checks = self
                    .counters
                    .solid_candidate_checks
                    .saturating_add(candidates);
                let fraction = hit.as_ref().map_or(1., |h| h.fraction);
                end.x += remaining.vx * fraction;
                end.y += remaining.vy * fraction;
                let Some(hit) = hit else {
                    remaining = Velocity::default();
                    break;
                };
                hit_count = hit_count.saturating_add(1);
                self.counters.kinematic_hits = self.counters.kinematic_hits.saturating_add(1);
                if self
                    .runtime
                    .terrain
                    .by_collider
                    .contains_key(&hit.target.collider)
                {
                    self.counters.kinematic_tile_hits =
                        self.counters.kinematic_tile_hits.saturating_add(1);
                } else {
                    self.counters.kinematic_entity_hits =
                        self.counters.kinematic_entity_hits.saturating_add(1);
                }
                blocked_x |= hit.normal[0].abs() > 1e-5;
                blocked_y |= hit.normal[1].abs() > 1e-5;
                last_hit = self.runtime.entities_by_body.get(&hit.target.body).copied();
                remaining.vx *= 1. - fraction;
                remaining.vy *= 1. - fraction;
                let into = remaining.vx * hit.normal[0] + remaining.vy * hit.normal[1];
                if into < 0. {
                    remaining.vx -= hit.normal[0] * into;
                    remaining.vy -= hit.normal[1] * into;
                }
            }
        }
        Ok(KinematicMoveResult {
            start,
            end,
            requested: displacement,
            remaining,
            hit_count,
            blocked_x,
            blocked_y,
            last_hit,
        })
    }

    fn step_move(
        &mut self,
        start: Transform2D,
        displacement: Velocity,
        config: PlatformerControllerConfig,
        enabled: bool,
    ) -> Result<KinematicMoveResult, UnifiedPhysicsError> {
        let normal = self.slide(start, displacement, config, None)?;
        if !enabled
            || config.step_offset <= 0.
            || !normal.blocked_x
            || displacement.vx.abs() <= KINEMATIC_EPSILON
            || displacement.vy < -KINEMATIC_EPSILON
        {
            return Ok(normal);
        }
        if let Some(entity) = normal.last_hit {
            if let Some(binding) = self.runtime.bindings.get(&(entity.id, entity.generation)) {
                let source = self
                    .runtime
                    .physics
                    .planar_platformer_bounds(self.body, self.offset(start))?;
                let target = self
                    .runtime
                    .physics
                    .planar_platformer_bounds(binding.body, [0.; 3])?;
                if source[3] - target[1] > config.step_offset + KINEMATIC_EPSILON {
                    return Ok(normal);
                }
            }
        }
        let up = self.slide(
            start,
            Velocity {
                vx: 0.,
                vy: -config.step_offset,
            },
            config,
            None,
        )?;
        if up.blocked_y {
            return Ok(normal);
        }
        let across = self.slide(
            up.end,
            Velocity {
                vx: displacement.vx,
                vy: 0.,
            },
            config,
            None,
        )?;
        if across.blocked_x {
            return Ok(normal);
        }
        let down = self.slide(
            across.end,
            Velocity {
                vx: 0.,
                vy: config.step_offset + config.ground_probe_distance,
            },
            config,
            None,
        )?;
        if self
            .probe(down.end, config.ground_probe_distance, config)?
            .is_none()
        {
            return Ok(normal);
        }
        Ok(KinematicMoveResult {
            start,
            end: down.end,
            requested: displacement,
            remaining: Velocity::default(),
            hit_count: up
                .hit_count
                .saturating_add(across.hit_count)
                .saturating_add(down.hit_count),
            blocked_x: false,
            blocked_y: down.blocked_y,
            last_hit: down.last_hit.or(across.last_hit).or(up.last_hit),
        })
    }

    pub(super) fn controller(
        &mut self,
        start: Transform2D,
        velocity: Velocity,
        input: PlatformerControllerInput,
        config: PlatformerControllerConfig,
        dt: f32,
        state: &mut PlatformerControllerState,
    ) -> Result<PlatformerControllerResult, UnifiedPhysicsError> {
        let (config, dt) = sanitized_platformer_step(config, dt);
        let ground_before = self.probe(start, config.ground_probe_distance, config)?;
        let mut state = Some(state);
        let step: PlatformerVelocityStep = prepare_platformer_velocity(
            velocity,
            input,
            config,
            dt,
            ground_before.is_some(),
            &mut state,
        );
        let movement = self.step_move(
            start,
            Velocity {
                vx: step.velocity.vx * dt,
                vy: step.velocity.vy * dt,
            },
            config,
            !step.jumped && ground_before.is_some(),
        )?;
        let ground_after = self.probe(movement.end, config.ground_probe_distance, config)?;
        let step = finish_platformer_velocity(
            step,
            movement.blocked_y,
            ground_after.is_some(),
            config,
            &mut state,
        );
        Ok(PlatformerControllerResult {
            movement,
            velocity: step.velocity,
            ground_before,
            ground_after,
            jumped: step.jumped,
            grounded: ground_after.is_some() && !step.jumped,
        })
    }
}
