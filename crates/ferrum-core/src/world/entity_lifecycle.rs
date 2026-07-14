use super::{component_storage::WorldComponentStorage, World, DEAD_ALIVE_POSITION};
use crate::entity::Entity;

impl World {
    pub fn spawn_entity(&mut self) -> Entity {
        if let Some(id) = self.free_list.pop() {
            let i = id as usize;
            self.alive[i] = true;
            self.track_alive_index(i);
            let entity = Entity {
                id,
                generation: self.generations[i],
            };
            self.reset_joint_incident_count(entity);
            return entity;
        }

        let id = self.generations.len() as u32;
        self.generations.push(0);
        self.alive.push(true);
        self.alive_positions.push(DEAD_ALIVE_POSITION);
        self.track_alive_index(id as usize);
        WorldComponentStorage::push_empty_entity(self);
        let entity = Entity { id, generation: 0 };
        self.reset_joint_incident_count(entity);
        entity
    }

    pub fn despawn(&mut self, entity: Entity) {
        let i = entity.id as usize;
        if i < self.alive.len() && self.alive[i] && self.generations[i] == entity.generation {
            if self.has_incident_joints(entity) {
                self.clear_joints_for_entity(entity);
            }
            self.alive[i] = false;
            self.generations[i] += 1;
            WorldComponentStorage::clear_entity(self, i);
            self.untrack_alive_index(i);
            self.clear_primary_actor_entity(entity);
            self.free_list.push(entity.id);
        }
    }

    pub fn alive_count(&self) -> usize {
        self.alive_indices.len()
    }

    pub(crate) fn entity_capacity(&self) -> usize {
        self.alive.len()
    }

    pub(crate) fn alive_indices(&self) -> &[usize] {
        &self.alive_indices
    }

    pub(crate) fn is_alive_index(&self, index: usize) -> bool {
        self.alive.get(index).copied().unwrap_or(false)
    }

    pub(crate) fn generation_at_index(&self, index: usize) -> Option<u32> {
        self.generations.get(index).copied()
    }

    pub(crate) fn entity_at_index(&self, index: usize) -> Option<Entity> {
        if !self.is_alive_index(index) {
            return None;
        }
        Some(Entity {
            id: u32::try_from(index).ok()?,
            generation: self.generation_at_index(index)?,
        })
    }

    pub(crate) fn is_current_entity(&self, entity: Entity) -> bool {
        self.valid_index(entity).is_some()
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
