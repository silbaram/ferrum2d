use crate::components::{AabbCollider, CollisionLayer, Sprite, Transform2D, Velocity};
use crate::entity::Entity;

pub const BULLET_LIFETIME: f32 = 1.8;

#[derive(Default)]
pub struct World {
    pub(crate) generations: Vec<u32>,
    pub alive: Vec<bool>,
    pub transforms: Vec<Option<Transform2D>>,
    pub sprites: Vec<Option<Sprite>>,
    pub velocities: Vec<Option<Velocity>>,
    pub colliders: Vec<Option<AabbCollider>>,
    pub bullet_lifetimes: Vec<Option<f32>>,
    pub player: Option<Entity>,
}

impl World {
    pub fn spawn_entity(&mut self) -> Entity {
        let id = self.generations.len() as u32;
        self.generations.push(0);
        self.alive.push(true);
        self.transforms.push(None);
        self.sprites.push(None);
        self.velocities.push(None);
        self.colliders.push(None);
        self.bullet_lifetimes.push(None);
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
        }
    }

    pub fn spawn_player(&mut self, x: f32, y: f32) -> Entity {
        let e = self.spawn_entity();
        let i = e.id as usize;
        self.transforms[i] = Some(Transform2D { x, y });
        self.sprites[i] = Some(Sprite {
            width: 36.0,
            height: 36.0,
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
            half_width: 18.0,
            half_height: 18.0,
            is_trigger: true,
            layer: CollisionLayer::Player,
        });
        self.player = Some(e);
        e
    }

    pub fn spawn_enemy(&mut self, x: f32, y: f32) -> Entity {
        let e = self.spawn_entity();
        let i = e.id as usize;
        self.transforms[i] = Some(Transform2D { x, y });
        self.sprites[i] = Some(Sprite {
            width: 24.0,
            height: 24.0,
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
            half_width: 12.0,
            half_height: 12.0,
            is_trigger: true,
            layer: CollisionLayer::Enemy,
        });
        e
    }

    pub fn spawn_bullet(&mut self, x: f32, y: f32, vx: f32, vy: f32) -> Entity {
        let e = self.spawn_entity();
        let i = e.id as usize;
        self.transforms[i] = Some(Transform2D { x, y });
        self.sprites[i] = Some(Sprite {
            width: 8.0,
            height: 8.0,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 1.0,
            g: 1.0,
            b: 0.2,
            a: 1.0,
        });
        self.velocities[i] = Some(Velocity { vx, vy });
        self.colliders[i] = Some(AabbCollider {
            half_width: 4.0,
            half_height: 4.0,
            is_trigger: true,
            layer: CollisionLayer::Bullet,
        });
        self.bullet_lifetimes[i] = Some(BULLET_LIFETIME);
        e
    }

    pub fn update(&mut self, delta: f32) {
        for i in 0..self.transforms.len() {
            if !self.alive[i] {
                continue;
            }
            if let (Some(t), Some(v)) = (self.transforms[i].as_mut(), self.velocities[i]) {
                t.x += v.vx * delta;
                t.y += v.vy * delta;
            }
        }
    }

    pub fn alive_count(&self) -> usize {
        self.alive.iter().filter(|a| **a).count()
    }
}
