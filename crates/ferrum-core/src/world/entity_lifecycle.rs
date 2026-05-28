use super::World;
use crate::entity::Entity;

impl World {
    pub fn spawn_entity(&mut self) -> Entity {
        if let Some(id) = self.free_list.pop() {
            let i = id as usize;
            self.alive[i] = true;
            return Entity {
                id,
                generation: self.generations[i],
            };
        }

        let id = self.generations.len() as u32;
        self.generations.push(0);
        self.alive.push(true);
        self.transforms.push(None);
        self.sprites.push(None);
        self.sprite_animations.push(None);
        self.velocities.push(None);
        self.rotations.push(None);
        self.angular_velocities.push(None);
        self.rigid_bodies.push(None);
        self.colliders.push(None);
        self.circle_colliders.push(None);
        self.oriented_box_colliders.push(None);
        self.capsule_colliders.push(None);
        self.edge_colliders.push(None);
        self.chain_colliders.push(None);
        self.convex_polygon_colliders.push(None);
        self.compound_colliders.push(Vec::new());
        self.collider_materials.push(None);
        self.collision_filters.push(None);
        self.bullet_lifetimes.push(None);
        self.healths.push(None);
        self.damages.push(None);
        self.score_rewards.push(None);
        Entity { id, generation: 0 }
    }

    pub fn despawn(&mut self, entity: Entity) {
        let i = entity.id as usize;
        if i < self.alive.len() && self.alive[i] && self.generations[i] == entity.generation {
            self.alive[i] = false;
            self.generations[i] += 1;
            self.transforms[i] = None;
            self.sprites[i] = None;
            self.sprite_animations[i] = None;
            self.velocities[i] = None;
            self.rotations[i] = None;
            self.angular_velocities[i] = None;
            self.rigid_bodies[i] = None;
            self.colliders[i] = None;
            self.circle_colliders[i] = None;
            self.oriented_box_colliders[i] = None;
            self.capsule_colliders[i] = None;
            self.edge_colliders[i] = None;
            self.chain_colliders[i] = None;
            self.convex_polygon_colliders[i] = None;
            self.compound_colliders[i].clear();
            self.collider_materials[i] = None;
            self.collision_filters[i] = None;
            self.bullet_lifetimes[i] = None;
            self.healths[i] = None;
            self.damages[i] = None;
            self.score_rewards[i] = None;
            if self.player == Some(entity) {
                self.player = None;
            }
            self.free_list.push(entity.id);
        }
    }

    pub fn alive_count(&self) -> usize {
        self.alive.iter().filter(|a| **a).count()
    }

    pub(super) fn valid_index(&self, entity: Entity) -> Option<usize> {
        let i = entity.id as usize;
        (i < self.alive.len() && self.alive[i] && self.generations[i] == entity.generation)
            .then_some(i)
    }
}
