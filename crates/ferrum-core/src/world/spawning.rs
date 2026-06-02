use super::{
    templates::initial_uv, EntityTemplate, EntityTemplateCollider, EntityTemplateColliderShape,
    World, BULLET_LIFETIME, DEFAULT_BULLET_TEMPLATE, DEFAULT_ENEMY_TEMPLATE,
    DEFAULT_PLAYER_TEMPLATE,
};
use crate::components::gameplay::{
    GameplayFaction, ProjectileCollisionTarget, ProjectileTileImpact,
};
use crate::components::{
    AabbCollider, CapsuleCollider, CircleCollider, CollisionLayer, ConvexPolygonCollider,
    EdgeCollider, OrientedBoxCollider, Sprite, Transform2D, Velocity,
};
use crate::entity::Entity;

#[derive(Debug, Clone, Copy)]
pub(crate) struct BulletSpawnRequest {
    pub(crate) transform: Transform2D,
    pub(crate) velocity: Velocity,
    pub(crate) texture_id: u32,
    pub(crate) lifetime: f32,
    pub(crate) template: EntityTemplate,
    pub(crate) damage: f32,
    pub(crate) collision_target: ProjectileCollisionTarget,
    pub(crate) tile_impact: ProjectileTileImpact,
    pub(crate) source_faction: Option<GameplayFaction>,
}

impl World {
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
        let (u0, v0, u1, v1) = initial_uv(template);
        self.transforms[i] = Some(Transform2D { x, y });
        self.sprites[i] = Some(Sprite {
            texture_id,
            width: template.sprite_width,
            height: template.sprite_height,
            u0,
            v0,
            u1,
            v1,
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
        });
        self.sprite_animations[i] = template.animation;
        self.velocities[i] = Some(Velocity::default());
        let layer = CollisionLayer::Player;
        self.apply_template_collider(e, layer, template);
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
        let (u0, v0, u1, v1) = initial_uv(template);
        self.transforms[i] = Some(Transform2D { x, y });
        self.sprites[i] = Some(Sprite {
            texture_id,
            width: template.sprite_width,
            height: template.sprite_height,
            u0,
            v0,
            u1,
            v1,
            r: 0.9,
            g: 0.3,
            b: 0.3,
            a: 0.9,
        });
        self.sprite_animations[i] = template.animation;
        let layer = CollisionLayer::Enemy;
        self.apply_template_collider(e, layer, template);
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
        self.spawn_bullet_from_request(BulletSpawnRequest {
            transform,
            velocity,
            texture_id,
            lifetime,
            template,
            damage,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::Despawn,
            source_faction: None,
        })
    }

    pub(crate) fn spawn_bullet_from_request(&mut self, request: BulletSpawnRequest) -> Entity {
        let e = self.spawn_entity();
        let i = e.id as usize;
        let (u0, v0, u1, v1) = initial_uv(request.template);
        self.transforms[i] = Some(request.transform);
        self.sprites[i] = Some(Sprite {
            texture_id: request.texture_id,
            width: request.template.sprite_width,
            height: request.template.sprite_height,
            u0,
            v0,
            u1,
            v1,
            r: 1.0,
            g: 1.0,
            b: 0.2,
            a: 1.0,
        });
        self.sprite_animations[i] = request.template.animation;
        self.velocities[i] = Some(request.velocity);
        let layer = CollisionLayer::Bullet;
        self.apply_template_collider(e, layer, request.template);
        self.bullet_lifetimes[i] = Some(request.lifetime);
        self.projectile_collision_targets[i] = Some(request.collision_target);
        self.projectile_tile_impacts[i] = Some(request.tile_impact);
        self.gameplay_factions[i] = request.source_faction;
        self.damages[i] = Some(request.damage);
        e
    }

    pub(crate) fn apply_template_to_entity(
        &mut self,
        entity: Entity,
        texture_id: u32,
        template: EntityTemplate,
    ) {
        let i = entity.id as usize;
        if i >= self.alive.len() || !self.alive[i] || self.generations[i] != entity.generation {
            return;
        }

        let (u0, v0, u1, v1) = initial_uv(template);
        if let Some(sprite) = self.sprites[i].as_mut() {
            sprite.texture_id = texture_id;
            sprite.width = template.sprite_width;
            sprite.height = template.sprite_height;
            sprite.u0 = u0;
            sprite.v0 = v0;
            sprite.u1 = u1;
            sprite.v1 = v1;
        }
        if let Some(layer) = self.collider_layer_at(i) {
            self.apply_template_collider(entity, layer, template);
        }
        self.sprite_animations[i] = template.animation;
    }

    fn apply_template_collider(
        &mut self,
        entity: Entity,
        layer: CollisionLayer,
        template: EntityTemplate,
    ) {
        let collider = EntityTemplateCollider::from_template(template);
        match collider.shape {
            EntityTemplateColliderShape::Aabb {
                half_width,
                half_height,
            } => self.set_aabb_collider(
                entity,
                AabbCollider::new(half_width, half_height, collider.is_trigger, layer)
                    .with_offset(collider.offset_x, collider.offset_y)
                    .with_enabled(collider.enabled),
            ),
            EntityTemplateColliderShape::Circle { radius } => self.set_circle_collider(
                entity,
                CircleCollider::new(radius, collider.is_trigger, layer)
                    .with_offset(collider.offset_x, collider.offset_y)
                    .with_enabled(collider.enabled),
            ),
            EntityTemplateColliderShape::OrientedBox {
                half_width,
                half_height,
                rotation_radians,
            } => self.set_oriented_box_collider(
                entity,
                OrientedBoxCollider::new(
                    half_width,
                    half_height,
                    rotation_radians,
                    collider.is_trigger,
                    layer,
                )
                .with_offset(collider.offset_x, collider.offset_y)
                .with_enabled(collider.enabled),
            ),
            EntityTemplateColliderShape::Capsule {
                start_x,
                start_y,
                end_x,
                end_y,
                radius,
            } => self.set_capsule_collider(
                entity,
                CapsuleCollider::new(
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                    radius,
                    collider.is_trigger,
                    layer,
                )
                .with_offset(collider.offset_x, collider.offset_y)
                .with_enabled(collider.enabled),
            ),
            EntityTemplateColliderShape::Edge {
                start_x,
                start_y,
                end_x,
                end_y,
            } => self.set_edge_collider(
                entity,
                EdgeCollider::new(start_x, start_y, end_x, end_y, collider.is_trigger, layer)
                    .with_offset(collider.offset_x, collider.offset_y)
                    .with_enabled(collider.enabled),
            ),
            EntityTemplateColliderShape::ConvexPolygon {
                vertices,
                vertex_count,
                rotation_radians,
            } => self.set_convex_polygon_collider(
                entity,
                ConvexPolygonCollider::new(vertices, vertex_count, collider.is_trigger, layer)
                    .with_rotation(rotation_radians)
                    .with_offset(collider.offset_x, collider.offset_y)
                    .with_enabled(collider.enabled),
            ),
        }
        if let Some(index) = self.valid_index(entity) {
            self.collider_materials[index] = collider.material;
            if let Some(primary) = self.compound_colliders[index].first_mut() {
                primary.material = collider.material;
            }
        }
    }
}
