use super::World;
use crate::components::gameplay::{
    GameplayLifetime, ProjectileCollisionTarget, ProjectilePolicy, ProjectileTileImpact,
};
use crate::entity::Entity;

impl World {
    pub(crate) fn gameplay_lifetime(&self, entity: Entity) -> Option<f32> {
        self.gameplay_lifetime_at(self.valid_index(entity)?)
    }

    pub(crate) fn gameplay_lifetime_at(&self, index: usize) -> Option<f32> {
        self.bullet_lifetimes
            .get(index)
            .copied()
            .flatten()
            .or_else(|| {
                self.lifetimes
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|lifetime| lifetime.remaining_seconds)
            })
    }

    pub(crate) fn set_gameplay_lifetime_at(&mut self, index: usize, seconds: f32) -> bool {
        if index >= self.alive.len() {
            return false;
        }
        let lifetime = GameplayLifetime::new(seconds);
        self.lifetimes[index] = Some(lifetime);
        self.bullet_lifetimes[index] = Some(seconds);
        true
    }

    pub(crate) fn set_gameplay_lifetime(&mut self, entity: Entity, seconds: f32) -> bool {
        let Some(index) = self.valid_index(entity) else {
            return false;
        };
        self.set_gameplay_lifetime_at(index, seconds)
    }

    pub(crate) fn replace_gameplay_lifetime(
        &mut self,
        entity: Entity,
        seconds: Option<f32>,
    ) -> bool {
        let Some(index) = self.valid_index(entity) else {
            return false;
        };
        if let Some(seconds) = seconds {
            self.set_gameplay_lifetime_at(index, seconds)
        } else {
            self.clear_gameplay_lifetime_at(index)
        }
    }

    pub(crate) fn clear_gameplay_lifetime(&mut self, entity: Entity) -> bool {
        let Some(index) = self.valid_index(entity) else {
            return false;
        };
        self.clear_gameplay_lifetime_at(index)
    }

    pub(crate) fn clear_gameplay_lifetime_at(&mut self, index: usize) -> bool {
        if index >= self.alive.len() {
            return false;
        }
        self.lifetimes[index] = None;
        self.bullet_lifetimes[index] = None;
        true
    }

    pub(crate) fn tick_gameplay_lifetime_at(
        &mut self,
        index: usize,
        delta_seconds: f32,
    ) -> Option<f32> {
        let remaining_seconds = self.gameplay_lifetime_at(index)? - delta_seconds;
        self.set_gameplay_lifetime_at(index, remaining_seconds);
        Some(remaining_seconds)
    }

    pub(crate) fn set_projectile_policy_at(
        &mut self,
        index: usize,
        policy: ProjectilePolicy,
    ) -> bool {
        if index >= self.alive.len() {
            return false;
        }
        self.projectile_policies[index] = Some(policy);
        self.projectile_collision_targets[index] = Some(policy.collision_target);
        self.projectile_tile_impacts[index] = Some(policy.tile_impact);
        true
    }

    pub(crate) fn projectile_collision_target_at(&self, index: usize) -> ProjectileCollisionTarget {
        self.projectile_collision_targets
            .get(index)
            .copied()
            .flatten()
            .or_else(|| {
                self.projectile_policies
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|policy| policy.collision_target)
            })
            .unwrap_or(ProjectileCollisionTarget::Enemies)
    }

    #[cfg(test)]
    pub(crate) fn set_projectile_collision_target_at(
        &mut self,
        index: usize,
        collision_target: ProjectileCollisionTarget,
    ) -> bool {
        if index >= self.alive.len() {
            return false;
        }
        let tile_impact = self.projectile_tile_impact_at(index);
        self.set_projectile_policy_at(index, ProjectilePolicy::new(collision_target, tile_impact))
    }

    #[cfg(test)]
    pub(crate) fn clear_projectile_collision_target_at(&mut self, index: usize) -> bool {
        if index >= self.alive.len() {
            return false;
        }
        self.projectile_collision_targets[index] = None;
        true
    }

    pub(crate) fn projectile_tile_impact_at(&self, index: usize) -> ProjectileTileImpact {
        self.projectile_tile_impacts
            .get(index)
            .copied()
            .flatten()
            .or_else(|| {
                self.projectile_policies
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|policy| policy.tile_impact)
            })
            .unwrap_or(ProjectileTileImpact::Despawn)
    }

    pub(crate) fn set_projectile_tile_impact(
        &mut self,
        entity: Entity,
        tile_impact: ProjectileTileImpact,
    ) -> bool {
        let Some(index) = self.valid_index(entity) else {
            return false;
        };
        self.set_projectile_tile_impact_at(index, tile_impact)
    }

    pub(crate) fn set_projectile_tile_impact_at(
        &mut self,
        index: usize,
        tile_impact: ProjectileTileImpact,
    ) -> bool {
        if index >= self.alive.len() {
            return false;
        }
        let collision_target = self.projectile_collision_target_at(index);
        self.set_projectile_policy_at(index, ProjectilePolicy::new(collision_target, tile_impact))
    }
}
