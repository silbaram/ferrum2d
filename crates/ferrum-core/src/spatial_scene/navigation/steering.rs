//! Per-step SeekTarget steering over native spatial route waypoints.
use super::*;
use crate::gameplay::{velocity_interpolate, velocity_toward};
impl SpatialNavigation {
    pub(crate) fn set_combat_steering(&mut self, value: Option<(Velocity, f32)>) {
        self.steering = value;
    }
    pub(super) fn seek_velocity(
        &self,
        from: Transform2D,
        point: Waypoint,
        delta: f32,
        on_goal_support: bool,
    ) -> Velocity {
        let Some((previous, rate)) = self.steering else {
            return Velocity::default();
        };
        let rate = if rate.is_finite() {
            rate.clamp(0., 1.)
        } else {
            0.
        };
        let speed = if on_goal_support {
            f64::from(self.speed).min(
                (distance(from, point.at) - f64::from(self.radius)).max(0.) / f64::from(delta)
                    * f64::from(rate),
            ) as f32
        } else {
            self.speed
        };
        let separation = distance(from, point.at);
        let desired = if separation > 0. && separation <= 0.0001 {
            // Generic Seek's epsilon is suitable for direct chasing, but an explicitly
            // zero spatial arrival radius must still approach the represented goal.
            Velocity {
                vx: ((f64::from(point.at.x) - f64::from(from.x)) / separation * f64::from(speed))
                    as f32,
                vy: ((f64::from(point.at.y) - f64::from(from.y)) / separation * f64::from(speed))
                    as f32,
            }
        } else {
            velocity_toward(from, point.at, speed)
        };
        velocity_interpolate(previous, desired, rate)
    }
    // A curved heading may enter and leave the stop circle in one step. Present an
    // actually representable inside point to the existing first-entry f32 clipper.
    pub(super) fn seek_stop_target(
        &self,
        from: Transform2D,
        target: Transform2D,
        current: Waypoint,
    ) -> Transform2D {
        let Some(goal) = self.points.last().filter(|g| {
            self.precise_stop
                && self.radius > 0.
                && g.surface == current.surface
                && g.span.floor == current.span.floor
        }) else {
            return target;
        };
        let dx = f64::from(target.x) - f64::from(from.x);
        let dy = f64::from(target.y) - f64::from(from.y);
        let length = dx * dx + dy * dy;
        if length == 0. {
            return target;
        }
        let t = (((f64::from(goal.at.x) - f64::from(from.x)) * dx
            + (f64::from(goal.at.y) - f64::from(from.y)) * dy)
            / length)
            .clamp(0., 1.);
        let closest = Transform2D {
            x: (f64::from(from.x) + dx * t) as f32,
            y: (f64::from(from.y) + dy * t) as f32,
        };
        if distance(closest, goal.at) <= f64::from(self.radius) {
            closest
        } else {
            target
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{AabbCollider, CollisionFilter, CollisionLayer, RigidBody};

    #[test]
    fn zero_steering_after_budget_defer_preserves_credit_without_candidate_trials() {
        let mut scene = SpatialScene::default();
        assert!(scene.configure_surfaces(
            &[-32., 0., 64., 32., 0., 0., 0., 1., 1., 1., 1.],
            &[1, 0, 16777215, 1],
        ));
        let mut world = World::default();
        let actor = world.spawn_entity();
        let from = Transform2D { x: 0., y: 16. };
        let span = HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap();
        world.set_transform(actor, from);
        world.set_velocity(actor, Velocity { vx: 64., vy: 0. });
        world.set_height_span(actor, span);
        world.set_rigid_body(actor, RigidBody::kinematic());
        world.set_aabb_collider(
            actor,
            AabbCollider::new(2., 2., true, CollisionLayer::Enemy),
        );
        world.set_collision_filter(actor, CollisionFilter::from_layer(CollisionLayer::Enemy));
        let mut route = SpatialNavigation {
            actor: Some(actor),
            status: SpatialMoveStatus::Moving,
            points: vec![Waypoint {
                at: Transform2D { x: -16., y: 16. },
                span,
                surface: 0,
            }],
            speed: 64.,
            cell_size: 8.,
            last: Some((from, span)),
            combat: true,
            precise_stop: true,
            combat_step: 8.,
            combat_drop: 40.,
            ..SpatialNavigation::default()
        };
        let targets = scene.movement_scratch.begin_spatial_query(&world, actor);
        scene.movement_scratch.end_spatial_query();
        let preparation = preparation_work(&scene, &world, targets);
        let mut counters = PhysicsCounters::default();
        let crowd = Some(CombatCrowd {
            peers: &[],
            padding: 0.,
        });
        route.set_combat_steering(Some((Velocity { vx: 64., vy: 0. }, 0.5)));
        let first = route.update_combat(
            &mut scene,
            &mut world,
            1. / 60.,
            &mut counters,
            preparation,
            preparation,
            crowd,
        );
        assert!(first.steering_velocity.is_none());
        let pending = route.pending;
        assert!(pending > 0.);
        let next = route.update_combat(
            &mut scene,
            &mut world,
            1. / 60.,
            &mut counters,
            FRAME_WORK,
            preparation,
            crowd,
        );
        assert_eq!(next.steering_velocity, Some(Velocity::default()));
        assert!(!next.motion_admitted);
        assert_eq!(next.yielded, 0);
        assert_eq!(route.pending, pending);
        assert!(route.status == SpatialMoveStatus::Moving);
        assert_eq!(world.transform(actor), Some(from));
    }
}
