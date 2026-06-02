use super::{World, DEAD_ALIVE_POSITION};
use crate::entity::Entity;

impl World {
    pub fn spawn_entity(&mut self) -> Entity {
        if let Some(id) = self.free_list.pop() {
            let i = id as usize;
            self.alive[i] = true;
            self.track_alive_index(i);
            return Entity {
                id,
                generation: self.generations[i],
            };
        }

        let id = self.generations.len() as u32;
        self.generations.push(0);
        self.alive.push(true);
        self.alive_positions.push(DEAD_ALIVE_POSITION);
        self.track_alive_index(id as usize);
        self.transforms.push(None);
        self.sprites.push(None);
        self.sprite_animations.push(None);
        self.velocities.push(None);
        self.rotations.push(None);
        self.angular_velocities.push(None);
        self.height_spans.push(None);
        self.projectile_arcs.push(None);
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
        self.projectile_collision_targets.push(None);
        self.projectile_tile_impacts.push(None);
        self.healths.push(None);
        self.damages.push(None);
        self.score_rewards.push(None);
        self.gameplay_factions.push(None);
        self.action_bindings.push(None);
        self.pickups.push(None);
        self.interactions.push(None);
        self.movement_patterns.push(None);
        self.collision_reactions.push(None);
        self.behavior_state_machines.push(None);
        self.behavior_state_enter_actions.push(None);
        self.gameplay_timer_triggers.push(None);
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
            self.height_spans[i] = None;
            self.projectile_arcs[i] = None;
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
            self.projectile_collision_targets[i] = None;
            self.projectile_tile_impacts[i] = None;
            self.healths[i] = None;
            self.damages[i] = None;
            self.score_rewards[i] = None;
            self.gameplay_factions[i] = None;
            self.action_bindings[i] = None;
            self.pickups[i] = None;
            self.interactions[i] = None;
            self.movement_patterns[i] = None;
            self.collision_reactions[i] = None;
            self.behavior_state_machines[i] = None;
            self.behavior_state_enter_actions[i] = None;
            self.gameplay_timer_triggers[i] = None;
            self.untrack_alive_index(i);
            if self.player == Some(entity) {
                self.player = None;
            }
            self.free_list.push(entity.id);
        }
    }

    pub fn alive_count(&self) -> usize {
        self.alive_indices.len()
    }

    pub(crate) fn alive_indices(&self) -> &[usize] {
        &self.alive_indices
    }

    pub(super) fn valid_index(&self, entity: Entity) -> Option<usize> {
        let i = entity.id as usize;
        (i < self.alive.len() && self.alive[i] && self.generations[i] == entity.generation)
            .then_some(i)
    }

    pub(super) fn rebuild_alive_indices(&mut self) {
        self.alive_indices.clear();
        self.alive_positions
            .resize(self.alive.len(), DEAD_ALIVE_POSITION);
        self.alive_positions.fill(DEAD_ALIVE_POSITION);
        for index in 0..self.alive.len() {
            if self.alive[index] {
                self.track_alive_index(index);
            }
        }
    }

    fn track_alive_index(&mut self, index: usize) {
        debug_assert!(self.alive[index]);
        debug_assert_eq!(self.alive_positions[index], DEAD_ALIVE_POSITION);
        self.alive_positions[index] = self.alive_indices.len();
        self.alive_indices.push(index);
    }

    fn untrack_alive_index(&mut self, index: usize) {
        let position = self.alive_positions[index];
        debug_assert_ne!(position, DEAD_ALIVE_POSITION);
        let last_position = self.alive_indices.len() - 1;
        let moved_index = self.alive_indices[last_position];
        self.alive_indices.swap_remove(position);
        if position != last_position {
            self.alive_positions[moved_index] = position;
        }
        self.alive_positions[index] = DEAD_ALIVE_POSITION;
    }
}
