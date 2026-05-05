use crate::entity::Entity;
use crate::world::World;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhysicsBounds {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
}

#[derive(Default)]
pub struct PhysicsSystem;

impl PhysicsSystem {
    pub fn integrate(world: &mut World, delta: f32) {
        for i in 0..world.transforms.len() {
            if !world.alive[i] {
                continue;
            }
            if let (Some(transform), Some(velocity)) =
                (world.transforms[i].as_mut(), world.velocities[i])
            {
                transform.x += velocity.vx * delta;
                transform.y += velocity.vy * delta;
            }
        }
    }

    pub fn clamp_entity_to_bounds(world: &mut World, entity: Entity, bounds: PhysicsBounds) {
        let i = entity.id as usize;
        if i >= world.alive.len() || !world.alive[i] || world.generations[i] != entity.generation {
            return;
        }
        let Some(collider) = world.colliders[i] else {
            return;
        };
        if let Some(transform) = world.transforms[i].as_mut() {
            transform.x = clamp_axis(
                transform.x,
                bounds.min_x + collider.half_width,
                bounds.max_x - collider.half_width,
            );
            transform.y = clamp_axis(
                transform.y,
                bounds.min_y + collider.half_height,
                bounds.max_y - collider.half_height,
            );
        }
    }
}

fn clamp_axis(value: f32, min: f32, max: f32) -> f32 {
    if min <= max {
        value.clamp(min, max)
    } else {
        (min + max) * 0.5
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{Transform2D, Velocity};

    #[test]
    fn integrate_applies_velocity_to_alive_entities() {
        let mut world = World::default();
        let moving = world.spawn_entity();
        let despawned = world.spawn_entity();
        world.transforms[moving.id as usize] = Some(Transform2D { x: 2.0, y: 4.0 });
        world.velocities[moving.id as usize] = Some(Velocity { vx: 10.0, vy: -6.0 });
        world.transforms[despawned.id as usize] = Some(Transform2D { x: 1.0, y: 1.0 });
        world.velocities[despawned.id as usize] = Some(Velocity {
            vx: 100.0,
            vy: 100.0,
        });
        world.despawn(despawned);

        PhysicsSystem::integrate(&mut world, 0.5);

        assert_eq!(
            world.transforms[moving.id as usize],
            Some(Transform2D { x: 7.0, y: 1.0 })
        );
        assert_eq!(world.transforms[despawned.id as usize], None);
    }

    #[test]
    fn clamp_entity_to_bounds_uses_collider_extents() {
        let mut world = World::default();
        let player = world.spawn_player(-20.0, 200.0, 0);

        PhysicsSystem::clamp_entity_to_bounds(
            &mut world,
            player,
            PhysicsBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 800.0,
                max_y: 480.0,
            },
        );

        let transform = world.transforms[player.id as usize].unwrap();
        assert_eq!(transform.x, 18.0);
        assert_eq!(transform.y, 200.0);
    }

    #[test]
    fn clamp_entity_to_small_bounds_uses_axis_center() {
        let mut world = World::default();
        let player = world.spawn_player(20.0, 30.0, 0);

        PhysicsSystem::clamp_entity_to_bounds(
            &mut world,
            player,
            PhysicsBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 10.0,
                max_y: 12.0,
            },
        );

        let transform = world.transforms[player.id as usize].unwrap();
        assert_eq!(transform.x, 5.0);
        assert_eq!(transform.y, 6.0);
    }
}
