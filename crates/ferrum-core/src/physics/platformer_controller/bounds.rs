use crate::collision::{collider_bounds, collider_shape};
use crate::entity::Entity;
use crate::physics::{PhysicsBounds, PhysicsSystem};
use crate::world::World;

impl PhysicsSystem {
    pub fn clamp_entity_to_bounds(world: &mut World, entity: Entity, bounds: PhysicsBounds) {
        let i = entity.id as usize;
        if !world.is_current_entity(entity) {
            return;
        }
        let Some(shape) = collider_shape(world, i) else {
            return;
        };
        if let Some(transform) = world.transform_mut_at_index(i) {
            let collider_bounds = collider_bounds(*transform, shape);
            let mut dx = 0.0;
            let mut dy = 0.0;
            if collider_bounds.max_x - collider_bounds.min_x > bounds.max_x - bounds.min_x {
                dx = (bounds.min_x + bounds.max_x - collider_bounds.min_x - collider_bounds.max_x)
                    * 0.5;
            } else if collider_bounds.min_x < bounds.min_x {
                dx = bounds.min_x - collider_bounds.min_x;
            } else if collider_bounds.max_x > bounds.max_x {
                dx = bounds.max_x - collider_bounds.max_x;
            }
            if collider_bounds.max_y - collider_bounds.min_y > bounds.max_y - bounds.min_y {
                dy = (bounds.min_y + bounds.max_y - collider_bounds.min_y - collider_bounds.max_y)
                    * 0.5;
            } else if collider_bounds.min_y < bounds.min_y {
                dy = bounds.min_y - collider_bounds.min_y;
            } else if collider_bounds.max_y > bounds.max_y {
                dy = bounds.max_y - collider_bounds.max_y;
            }
            transform.x += dx;
            transform.y += dy;
        }
    }
}
