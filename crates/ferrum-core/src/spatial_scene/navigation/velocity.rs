//! Budgeted terrain-following velocity motion for scene-owned acceleration patterns.
use super::*;

pub(crate) struct CombatVelocityRequest<'a> {
    pub actor: Entity,
    pub velocity: Velocity,
    pub delta: f32,
    pub step: f32,
    pub drop: f32,
    pub available: u64,
    pub preparation_bound: u64,
    pub crowd: Option<CombatCrowd<'a>>,
}
impl SpatialNavigation {
    pub(crate) fn move_combat_velocity(
        &mut self,
        scene: &mut SpatialScene,
        world: &mut World,
        counters: &mut PhysicsCounters,
        r: CombatVelocityRequest<'_>,
    ) -> CombatNavigationStep {
        let mut result = CombatNavigationStep::default();
        let setup = (scene.surfaces.len() as u64 + 1) * 32;
        if !supported(world, r.actor, true)
            || ![r.velocity.vx, r.velocity.vy, r.delta]
                .iter()
                .all(|v| v.is_finite())
            || r.delta <= 0.
            || r.preparation_bound.saturating_add(setup) > r.available
        {
            return result;
        }
        let from = world
            .transform(r.actor)
            .expect("supported actor has a transform");
        let span = world
            .height_span(r.actor)
            .expect("supported actor has a height span");
        let target = Transform2D {
            x: from.x + r.velocity.vx * r.delta,
            y: from.y + r.velocity.vy * r.delta,
        };
        if !target.x.is_finite() || !target.y.is_finite() {
            return result;
        }
        self.finish(SpatialMoveStatus::Blocked);
        let targets = scene.movement_scratch.begin_spatial_query(world, r.actor);
        let mut used = preparation_work(world, targets) + setup;
        let scan = targets as u64;
        if used.saturating_add(scan) > r.available {
            scene.movement_scratch.end_spatial_query();
            result.work = used;
            return result;
        }
        used += scan;
        let nearby = scene
            .movement_scratch
            .begin_spatial_segment(world, r.actor, from, target);
        let charge = work(scene, nearby, from, target)
            .saturating_mul(2)
            .saturating_add(r.crowd.map_or(0, |c| c.peers.len() as u64 * 24));
        if used.saturating_add(charge) > r.available {
            scene.movement_scratch.end_spatial_query();
            result.work = used;
            return result;
        }
        used += charge;
        result.motion_admitted = true;
        let velocity = world.velocity(r.actor).unwrap_or_default();
        let trial = PhysicsSystem::spatial_body_pose_is_clear(
            world,
            &scene.physics,
            r.actor,
            from,
            &mut scene.movement_scratch,
            None,
            CollisionMask::WALL,
        ) && scene.move_body_internal(
            world,
            r.actor,
            target.x - from.x,
            target.y - from.y,
            r.step,
            r.drop,
            None,
            false,
            true,
        );
        let end = world.transform(r.actor).unwrap_or(from);
        let after = world.height_span(r.actor).unwrap_or(span);
        let clear = trial
            && PhysicsSystem::spatial_body_pose_is_clear(
                world,
                &scene.physics,
                r.actor,
                end,
                &mut scene.movement_scratch,
                None,
                CollisionMask::WALL,
            );
        let permitted = clear
            && r.crowd.is_none_or(|c| {
                c.permits(
                    world,
                    r.actor,
                    (from, span),
                    (end, after),
                    &mut result.neighbor_tests,
                )
            });
        world.set_transform(r.actor, from);
        world.set_height_span(r.actor, span);
        world.set_velocity(r.actor, velocity);
        if permitted {
            let committed = scene.move_body_internal(
                world,
                r.actor,
                target.x - from.x,
                target.y - from.y,
                r.step,
                r.drop,
                Some(counters),
                true,
                true,
            );
            let actual = world.transform(r.actor).unwrap_or(from);
            let actual_span = world.height_span(r.actor).unwrap_or(span);
            let safe = committed
                && PhysicsSystem::spatial_body_pose_is_clear(
                    world,
                    &scene.physics,
                    r.actor,
                    actual,
                    &mut scene.movement_scratch,
                    Some(counters),
                    CollisionMask::WALL,
                )
                && r.crowd.is_none_or(|c| {
                    c.permits(
                        world,
                        r.actor,
                        (from, span),
                        (actual, actual_span),
                        &mut result.neighbor_tests,
                    )
                });
            if safe {
                self.status = if actual == from {
                    SpatialMoveStatus::Blocked
                } else {
                    SpatialMoveStatus::Moving
                };
            } else {
                world.set_transform(r.actor, from);
                world.set_height_span(r.actor, span);
                world.set_velocity(r.actor, velocity);
            }
        } else if clear {
            result.yielded = 1;
        }
        scene.movement_scratch.end_spatial_query();
        result.work = used;
        result
    }
}
