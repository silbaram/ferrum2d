use crate::components::{AabbCollider, CollisionLayer, Sprite, Transform2D, Velocity};
use crate::entity::Entity;
use crate::physics::PhysicsSystem;

pub const BULLET_LIFETIME: f32 = 1.8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EntityTemplate {
    pub sprite_width: f32,
    pub sprite_height: f32,
    pub collider_half_width: f32,
    pub collider_half_height: f32,
}

impl EntityTemplate {
    pub const fn new(sprite_width: f32, sprite_height: f32) -> Self {
        Self {
            sprite_width,
            sprite_height,
            collider_half_width: sprite_width * 0.5,
            collider_half_height: sprite_height * 0.5,
        }
    }
}

pub const DEFAULT_PLAYER_TEMPLATE: EntityTemplate = EntityTemplate::new(36.0, 36.0);
pub const DEFAULT_ENEMY_TEMPLATE: EntityTemplate = EntityTemplate::new(24.0, 24.0);
pub const DEFAULT_BULLET_TEMPLATE: EntityTemplate = EntityTemplate::new(8.0, 8.0);

#[derive(Default)]
pub struct World {
    pub(crate) generations: Vec<u32>,
    free_list: Vec<u32>,
    pub(crate) alive: Vec<bool>,
    pub(crate) transforms: Vec<Option<Transform2D>>,
    pub(crate) sprites: Vec<Option<Sprite>>,
    pub(crate) velocities: Vec<Option<Velocity>>,
    pub(crate) colliders: Vec<Option<AabbCollider>>,
    pub(crate) bullet_lifetimes: Vec<Option<f32>>,
    pub(crate) healths: Vec<Option<f32>>,
    pub(crate) damages: Vec<Option<f32>>,
    pub(crate) score_rewards: Vec<Option<u32>>,
    pub(crate) player: Option<Entity>,
}

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
        self.velocities.push(None);
        self.colliders.push(None);
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
            self.velocities[i] = None;
            self.colliders[i] = None;
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

    pub fn spawn_player(&mut self, x: f32, y: f32, texture_id: u32) -> Entity {
        self.spawn_player_from_template(x, y, texture_id, DEFAULT_PLAYER_TEMPLATE)
    }

    pub fn spawn_player_from_template(
        &mut self,
        x: f32,
        y: f32,
        texture_id: u32,
        template: EntityTemplate,
    ) -> Entity {
        let e = self.spawn_entity();
        let i = e.id as usize;
        self.transforms[i] = Some(Transform2D { x, y });
        self.sprites[i] = Some(Sprite {
            texture_id,
            width: template.sprite_width,
            height: template.sprite_height,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
        });
        self.velocities[i] = Some(Velocity::default());
        self.colliders[i] = Some(AabbCollider {
            half_width: template.collider_half_width,
            half_height: template.collider_half_height,
            is_trigger: true,
            layer: CollisionLayer::Player,
        });
        self.player = Some(e);
        e
    }

    pub fn spawn_enemy(&mut self, x: f32, y: f32, texture_id: u32) -> Entity {
        self.spawn_enemy_from_template(x, y, texture_id, DEFAULT_ENEMY_TEMPLATE, 1.0, 1)
    }

    pub fn spawn_enemy_from_template(
        &mut self,
        x: f32,
        y: f32,
        texture_id: u32,
        template: EntityTemplate,
        health: f32,
        score_reward: u32,
    ) -> Entity {
        let e = self.spawn_entity();
        let i = e.id as usize;
        self.transforms[i] = Some(Transform2D { x, y });
        self.sprites[i] = Some(Sprite {
            texture_id,
            width: template.sprite_width,
            height: template.sprite_height,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 0.9,
            g: 0.3,
            b: 0.3,
            a: 0.9,
        });
        self.colliders[i] = Some(AabbCollider {
            half_width: template.collider_half_width,
            half_height: template.collider_half_height,
            is_trigger: true,
            layer: CollisionLayer::Enemy,
        });
        self.healths[i] = Some(health);
        self.score_rewards[i] = Some(score_reward);
        e
    }

    pub fn spawn_bullet(&mut self, x: f32, y: f32, vx: f32, vy: f32, texture_id: u32) -> Entity {
        self.spawn_bullet_with_lifetime(x, y, vx, vy, texture_id, BULLET_LIFETIME)
    }

    pub fn spawn_bullet_with_lifetime(
        &mut self,
        x: f32,
        y: f32,
        vx: f32,
        vy: f32,
        texture_id: u32,
        lifetime: f32,
    ) -> Entity {
        self.spawn_bullet_from_template(
            Transform2D { x, y },
            Velocity { vx, vy },
            texture_id,
            lifetime,
            DEFAULT_BULLET_TEMPLATE,
            1.0,
        )
    }

    pub fn spawn_bullet_from_template(
        &mut self,
        transform: Transform2D,
        velocity: Velocity,
        texture_id: u32,
        lifetime: f32,
        template: EntityTemplate,
        damage: f32,
    ) -> Entity {
        let e = self.spawn_entity();
        let i = e.id as usize;
        self.transforms[i] = Some(transform);
        self.sprites[i] = Some(Sprite {
            texture_id,
            width: template.sprite_width,
            height: template.sprite_height,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 1.0,
            g: 1.0,
            b: 0.2,
            a: 1.0,
        });
        self.velocities[i] = Some(velocity);
        self.colliders[i] = Some(AabbCollider {
            half_width: template.collider_half_width,
            half_height: template.collider_half_height,
            is_trigger: true,
            layer: CollisionLayer::Bullet,
        });
        self.bullet_lifetimes[i] = Some(lifetime);
        self.damages[i] = Some(damage);
        e
    }

    pub fn update(&mut self, delta: f32) {
        PhysicsSystem::integrate(self, delta);
    }

    pub fn alive_count(&self) -> usize {
        self.alive.iter().filter(|a| **a).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_ids_increment_and_generation_changes_on_despawn() {
        let mut world = World::default();
        let first = world.spawn_entity();
        let second = world.spawn_entity();

        assert_eq!(first.id, 0);
        assert_eq!(first.generation, 0);
        assert_eq!(second.id, 1);
        assert_eq!(second.generation, 0);

        world.despawn(first);

        assert!(!world.alive[first.id as usize]);
        assert_eq!(world.generations[first.id as usize], 1);
    }

    #[test]
    fn despawned_entity_slots_are_reused_with_new_generation() {
        let mut world = World::default();
        let first = world.spawn_entity();
        world.despawn(first);

        let reused = world.spawn_entity();

        assert_eq!(reused.id, first.id);
        assert_eq!(reused.generation, first.generation + 1);
        assert!(world.alive[reused.id as usize]);
    }

    #[test]
    fn transform_update_applies_velocity() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        let index = entity.id as usize;
        world.transforms[index] = Some(Transform2D { x: 2.0, y: 4.0 });
        world.velocities[index] = Some(Velocity { vx: 10.0, vy: -6.0 });

        world.update(0.5);

        assert_eq!(
            world.transforms[index],
            Some(Transform2D { x: 7.0, y: 1.0 })
        );
    }

    #[test]
    fn spawn_from_template_applies_sprite_and_collider_sizes() {
        let mut world = World::default();
        let template = EntityTemplate::new(48.0, 30.0);

        let enemy = world.spawn_enemy_from_template(10.0, 20.0, 7, template, 3.0, 2);

        assert_eq!(world.sprites[enemy.id as usize].unwrap().width, 48.0);
        assert_eq!(world.sprites[enemy.id as usize].unwrap().height, 30.0);
        assert_eq!(world.colliders[enemy.id as usize].unwrap().half_width, 24.0);
        assert_eq!(
            world.colliders[enemy.id as usize].unwrap().half_height,
            15.0
        );
        assert_eq!(world.healths[enemy.id as usize], Some(3.0));
        assert_eq!(world.score_rewards[enemy.id as usize], Some(2));
    }
}
