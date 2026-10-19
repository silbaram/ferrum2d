//! Bounded local steering. Peer footprints are read from World, never cached across actor moves.
use super::*;

#[derive(Clone, Copy)]
pub(crate) struct CombatCrowd<'a> {
    pub peers: &'a [Entity],
    pub padding: f32,
}
#[derive(Default)]
pub(crate) struct CombatNavigationStep {
    pub work: u64,
    pub motion_admitted: bool,
    pub steering_velocity: Option<Velocity>,
    pub neighbor_tests: u32,
    pub yielded: u32,
    pub steered: u32,
}
pub(super) enum CrowdMotion {
    Move(Transform2D, bool),
    Yield,
    Blocked,
    Deferred,
}

// Open rectangles admit touching endpoints/edges. Initial overlaps may only separate monotonically.
fn clear_segment(from: [f64; 2], to: [f64; 2], half: [f64; 2], allow_escape: bool) -> bool {
    let penetration = |p: [f64; 2]| (half[0] - p[0].abs()).min(half[1] - p[1].abs());
    if allow_escape && penetration(from) > 0. {
        return penetration(to) < penetration(from)
            && (0..2).any(|axis| {
                from[axis] * (to[axis] - from[axis]) >= 0.
                    && half[axis] - to[axis].abs() < penetration(from)
            });
    }
    // Segment/rectangle separating axes avoid division: very thin colliders must not collapse
    // into equal entry/exit times and be mistaken for a tangent.
    if (0..2).any(|axis| {
        from[axis].min(to[axis]) >= half[axis] || from[axis].max(to[axis]) <= -half[axis]
    }) {
        return true;
    }
    let dx = to[0] - from[0];
    let dy = to[1] - from[1];
    if dx == 0. && dy == 0. {
        return false;
    }
    let product = from[1] * to[0];
    let error = from[1].mul_add(to[0], -product);
    let determinant = from[0].mul_add(to[1], -product) - error;
    determinant.abs() >= half[0] * dy.abs() + half[1] * dx.abs()
}
impl CombatCrowd<'_> {
    pub(super) fn permits(
        &self,
        world: &World,
        actor: Entity,
        start: (Transform2D, HeightSpan),
        end: (Transform2D, HeightSpan),
        tests: &mut u32,
    ) -> bool {
        let (from, before) = start;
        let (to, after) = end;
        let Some(collider) = world.collider(actor) else {
            return false;
        };
        let Some(filter) = world.collision_filter(actor) else {
            return false;
        };
        let a = collider.center(from);
        let b = collider.center(to);
        for &peer in self.peers {
            if peer == actor {
                continue;
            }
            *tests += 1;
            if !supported(world, peer, true) {
                continue;
            }
            let Some(peer_filter) = world.collision_filter(peer) else {
                continue;
            };
            if !filter.can_collide_with(peer_filter) {
                continue;
            }
            let span = world.height_span(peer).unwrap();
            if span.floor != before.floor && span.floor != after.floor {
                continue;
            }
            if span.top() < before.elevation.min(after.elevation)
                || span.elevation > before.top().max(after.top())
            {
                continue;
            }
            let other = world.collider(peer).unwrap();
            let center = other.center(world.transform(peer).unwrap());
            let half = [
                f64::from(collider.half_width)
                    + f64::from(other.half_width)
                    + f64::from(self.padding),
                f64::from(collider.half_height)
                    + f64::from(other.half_height)
                    + f64::from(self.padding),
            ];
            if !clear_segment(
                [
                    f64::from(a.x) - f64::from(center.x),
                    f64::from(a.y) - f64::from(center.y),
                ],
                [
                    f64::from(b.x) - f64::from(center.x),
                    f64::from(b.y) - f64::from(center.y),
                ],
                half,
                before.overlaps(span),
            ) {
                return false;
            }
        }
        true
    }
}
impl SpatialNavigation {
    /// Clip before probing: the exact f32 segment we commit must pass native and peer sweeps.
    pub(super) fn clip_combat_stop(
        &self,
        from: Transform2D,
        target: Transform2D,
        current: Waypoint,
    ) -> (Transform2D, bool) {
        let Some(goal) = self.points.last().copied().filter(|g| {
            self.combat
                && self.precise_stop
                && self.radius > 0.
                && g.surface == current.surface
                && g.span.floor == current.span.floor
        }) else {
            return (target, false);
        };
        let radius = f64::from(self.radius);
        if distance(from, goal.at) <= radius {
            return (from, true);
        }
        if distance(target, goal.at) > radius {
            return (target, false);
        }
        let represented = |t: f64| {
            let point = Transform2D {
                x: (f64::from(from.x) + (f64::from(target.x) - f64::from(from.x)) * t) as f32,
                y: (f64::from(from.y) + (f64::from(target.y) - f64::from(from.y)) * t) as f32,
            };
            Transform2D {
                x: from.x + (point.x - from.x),
                y: from.y + (point.y - from.y),
            }
        };
        let mut best = represented(1.);
        if distance(best, goal.at) > radius {
            return (target, false);
        }
        let (mut outside, mut inside) = (0., 1.);
        // Fixed work, including cancellation in from + (target - from). Always retain an
        // actually representable inside point; a coarse f32 lattice may require the full step.
        for _ in 0..32 {
            let t = (outside + inside) * 0.5;
            let point = represented(t);
            if distance(point, goal.at) <= radius {
                best = point;
                inside = t;
            } else {
                outside = t;
            }
        }
        (best, true)
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn crowd_shortcut(
        &mut self,
        scene: &mut SpatialScene,
        world: &mut World,
        actor: Entity,
        from: Waypoint,
        to: Waypoint,
        crowd: CombatCrowd<'_>,
        used: &mut u64,
    ) -> bool {
        if self.crowd_candidates >= 8 {
            return false;
        }
        self.crowd_candidates += 1;
        let scan = self.target_count as u64;
        if used.saturating_add(scan) > self.frame_limit {
            return false;
        }
        *used += scan;
        let nearby = scene
            .movement_scratch
            .begin_spatial_segment(world, actor, from.at, to.at);
        let charge =
            work(scene, nearby, from.at, to.at).saturating_add(crowd.peers.len() as u64 * 8);
        if used.saturating_add(charge) > self.frame_limit {
            return false;
        }
        *used += charge;
        let collider = world.collider(actor).unwrap();
        if !scene.navigation_edge_crosses_supports(
            from.surface,
            to.surface,
            collider.center(from.at),
            collider.center(to.at),
        ) {
            return false;
        }
        let velocity = world.velocity(actor).unwrap();
        let original_span = world.height_span(actor).unwrap();
        let clear = PhysicsSystem::spatial_body_pose_is_clear(
            world,
            &scene.physics,
            actor,
            from.at,
            &mut scene.movement_scratch,
            None,
            CollisionMask::WALL,
        ) && scene.move_body_internal(
            world,
            actor,
            to.at.x - from.at.x,
            to.at.y - from.at.y,
            self.combat_step,
            self.combat_drop,
            None,
            false,
            true,
        );
        let end = world.transform(actor).unwrap();
        let span = world.height_span(actor).unwrap();
        let clear = clear
            && distance(end, to.at) <= 0.0001
            && span.floor == to.span.floor
            && (span.elevation - to.span.elevation).abs() <= 0.001
            && pose(scene, world, actor, end, span.floor.0)
                .is_some_and(|p| p.surface == to.surface)
            && PhysicsSystem::spatial_body_pose_is_clear(
                world,
                &scene.physics,
                actor,
                end,
                &mut scene.movement_scratch,
                None,
                CollisionMask::WALL,
            );
        let clear = clear
            && crowd.permits(
                world,
                actor,
                (from.at, original_span),
                (end, span),
                &mut self.crowd_step.neighbor_tests,
            );
        world.set_transform(actor, from.at);
        world.set_height_span(actor, original_span);
        world.set_velocity(actor, velocity);
        clear
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn crowd_motion(
        &mut self,
        scene: &mut SpatialScene,
        world: &mut World,
        actor: Entity,
        from: Transform2D,
        desired: Transform2D,
        remaining: f64,
        travel_budget: f64,
        crowd: CombatCrowd<'_>,
        counters: &mut PhysicsCounters,
        used: &mut u64,
    ) -> CrowdMotion {
        let span = world.height_span(actor).unwrap();
        let Some(current) = pose(scene, world, actor, from, span.floor.0) else {
            return CrowdMotion::Blocked;
        };
        let velocity = world.velocity(actor).unwrap();
        let dx = f64::from(desired.x) - f64::from(from.x);
        let dy = f64::from(desired.y) - f64::from(from.y);
        let diagonal = std::f64::consts::FRAC_1_SQRT_2;
        let length = dx.hypot(dy);
        let collider = world.collider(actor).unwrap();
        let horizon = remaining
            .min(
                f64::from(collider.half_width.max(collider.half_height)) * 4.
                    + f64::from(crowd.padding),
            )
            .max(length);
        // Prefer one passing side. Axis-aligned candidates can slide through the narrow gap
        // between two resting AABBs where every diagonal would introduce a new overlap.
        let side = if dy.abs() >= dx.abs() {
            (-dy.signum() * length, 0.)
        } else {
            (0., dx.signum() * length)
        };
        let active_detour = self.crowd_detour.filter(|(_, remaining)| *remaining > 0.);
        let mut candidates = [
            (dx, dy),
            ((dx - dy) * diagonal, (dx + dy) * diagonal),
            side,
            (-dy, dx),
            ((-dx - dy) * diagonal, (dx - dy) * diagonal),
            (-side.0, -side.1),
            ((dx + dy) * diagonal, (dy - dx) * diagonal),
            (-dx, -dy),
        ];
        if let Some((heading, _)) = active_detour {
            candidates.rotate_right(1);
            candidates[0] = (heading.0 * length, heading.1 * length);
        }
        let straight = usize::from(active_detour.is_some());
        for (index, (mx, my)) in candidates.into_iter().enumerate() {
            let target = if index == straight {
                desired
            } else {
                Transform2D {
                    x: from.x + mx as f32,
                    y: from.y + my as f32,
                }
            };
            if self.crowd_candidates >= 8 {
                return CrowdMotion::Deferred;
            }
            self.crowd_candidates += 1;
            if used.saturating_add(512) > self.frame_limit {
                return CrowdMotion::Deferred;
            }
            *used += 512;
            let (target, stop) = self.clip_combat_stop(from, target, current);
            if !motion_fits_credit(from, target, travel_budget) {
                continue;
            }
            if !target.x.is_finite() || !target.y.is_finite() {
                continue;
            }
            let scan = (self.target_count as u64).saturating_mul(2);
            if used.saturating_add(scan) > self.frame_limit {
                return CrowdMotion::Deferred;
            }
            *used += scan;
            let nearby = scene
                .movement_scratch
                .begin_spatial_segment(world, actor, from, target);
            let charge = work(scene, nearby, from, target)
                .saturating_mul(2)
                .saturating_add(crowd.peers.len() as u64 * 24);
            if used.saturating_add(charge) > self.frame_limit {
                return CrowdMotion::Deferred;
            }
            *used += charge;
            let clear = PhysicsSystem::spatial_body_pose_is_clear(
                world,
                &scene.physics,
                actor,
                from,
                &mut scene.movement_scratch,
                Some(counters),
                CollisionMask::WALL,
            );
            let moved = clear
                && scene.move_body_internal(
                    world,
                    actor,
                    target.x - from.x,
                    target.y - from.y,
                    self.combat_step,
                    self.combat_drop,
                    Some(counters),
                    false,
                    true,
                );
            let end = world.transform(actor).unwrap();
            let next = world.height_span(actor).unwrap();
            let clear = moved
                && distance(end, target) <= 0.0001
                && PhysicsSystem::spatial_body_pose_is_clear(
                    world,
                    &scene.physics,
                    actor,
                    end,
                    &mut scene.movement_scratch,
                    Some(counters),
                    CollisionMask::WALL,
                );
            let clear = clear
                && pose(scene, world, actor, end, next.floor.0)
                    .zip(pose(scene, world, actor, from, span.floor.0))
                    .is_some_and(|(support, initial)| {
                        (support.span.elevation - next.elevation).abs() <= 0.001
                            && scene.navigation_edge_crosses_supports(
                                initial.surface,
                                support.surface,
                                collider.center(from),
                                collider.center(end),
                            )
                    });
            let allowed = clear
                && crowd.permits(
                    world,
                    actor,
                    (from, span),
                    (end, next),
                    &mut self.crowd_step.neighbor_tests,
                );
            // Reject a short-lived detour that immediately leads back into a resting peer.
            // This is only a steering preference; the actual finite movement above is always swept.
            let future = Transform2D {
                x: from.x + (mx / length.max(f64::MIN_POSITIVE) * horizon) as f32,
                y: from.y + (my / length.max(f64::MIN_POSITIVE) * horizon) as f32,
            };
            let forecast = pose(scene, world, actor, future, next.floor.0)
                .zip(pose(scene, world, actor, end, next.floor.0))
                .filter(|(ahead, current)| {
                    ahead.surface == current.surface
                        && span.floor == next.floor
                        && (span.elevation - next.elevation).abs() <= 0.001
                        && (ahead.span.elevation - next.elevation).abs() <= 0.001
                });
            let allowed = allowed
                && (stop
                    || forecast.is_none_or(|(ahead, _)| {
                        crowd.permits(
                            world,
                            actor,
                            (from, span),
                            (future, ahead.span),
                            &mut self.crowd_step.neighbor_tests,
                        )
                    }));
            world.set_transform(actor, from);
            world.set_height_span(actor, span);
            world.set_velocity(actor, velocity);
            if allowed {
                if index != straight {
                    self.crowd_step.steered += 1;
                    if let Some((heading, remaining)) = active_detour.filter(|_| index == 0) {
                        self.crowd_detour =
                            (remaining > length).then_some((heading, remaining - length));
                    } else if length > 0. {
                        let collider = world.collider(actor).unwrap();
                        let credit = f64::from(collider.half_width.max(collider.half_height)) * 2.
                            + f64::from(crowd.padding);
                        self.crowd_detour = Some(((mx / length, my / length), credit));
                    }
                } else {
                    self.crowd_detour = None;
                }
                // The final commit owns its own candidate set, even after hypothetical sweeps.
                scene
                    .movement_scratch
                    .begin_spatial_segment(world, actor, from, target);
                let stop = stop
                    && self
                        .points
                        .last()
                        .is_some_and(|g| distance(end, g.at) <= f64::from(self.radius));
                return CrowdMotion::Move(target, stop);
            }
            if index == straight && !clear {
                return CrowdMotion::Blocked;
            }
        }
        self.crowd_step.yielded += 1;
        CrowdMotion::Yield
    }
}

#[cfg(test)]
mod tests {
    use super::clear_segment;
    #[test]
    fn stop_clip_chooses_an_inside_f32_point_and_preserves_motion_credit() {
        use super::*;
        let from = Transform2D {
            x: 16_777_218.,
            y: 0.,
        };
        let goal = Transform2D {
            x: 16_777_216.,
            y: 0.,
        };
        let span = HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap();
        let nav = SpatialNavigation {
            combat: true,
            precise_stop: true,
            radius: 1.25,
            points: vec![Waypoint {
                at: goal,
                span,
                surface: 0,
            }],
            ..SpatialNavigation::default()
        };
        let (clipped, arrived) = nav.clip_combat_stop(
            from,
            goal,
            Waypoint {
                at: from,
                span,
                surface: 0,
            },
        );
        assert!(arrived && distance(clipped, goal) <= 1.25);
        assert!(!motion_fits_credit(from, clipped, 1.));
        assert!(motion_fits_credit(from, clipped, 2.));
    }
    #[test]
    fn crowd_sweep_blocks_crossing_and_allows_touching_or_monotonic_escape() {
        assert!(!clear_segment([-8., 0.], [8., 0.], [4., 4.], true));
        assert!(!clear_segment(
            [-1., 0.],
            [1., 0.],
            [2. * f64::from(5e-21f32), 4.],
            true
        ));
        assert!(clear_segment([-8., 0.], [0., 8.], [4., 4.], true));
        assert!(!clear_segment([-8., 0.], [0., 7.9], [4., 4.], true));
        assert!(clear_segment([-8., 0.], [-4., 0.], [4., 4.], true));
        assert!(clear_segment([-8., 4.], [8., 4.], [4., 4.], true));
        assert!(clear_segment([0., 0.], [1., 0.], [4., 4.], true));
        assert!(!clear_segment([1., 0.], [0., 0.], [4., 4.], true));
        assert!(!clear_segment([-1., 0.], [2., 0.], [4., 4.], true));
        assert!(
            !clear_segment([1., 0.], [2., 0.], [4., 4.], false),
            "a newly intersected height/floor is not an existing overlap"
        );
    }
}
