use super::{
    templates::initial_uv, EntityTemplate, EntityTemplateCollider, EntityTemplateColliderShape,
    World, BULLET_LIFETIME, DEFAULT_BULLET_TEMPLATE, DEFAULT_ENEMY_TEMPLATE,
    DEFAULT_PLAYER_TEMPLATE,
};
use crate::components::gameplay::{
    GameplayFaction, ProjectileCollisionTarget, ProjectilePolicy, ProjectileTileImpact,
};
use crate::components::{
    AabbCollider, CapsuleCollider, CircleCollider, CollisionLayer, ConvexPolygonCollider,
    EdgeCollider, OrientedBoxCollider, Sprite, Transform2D, Velocity, DEFAULT_SPRITE_RENDER_LAYER,
};
use crate::entity::Entity;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PrefabSpriteTint {
    pub(crate) r: f32,
    pub(crate) g: f32,
    pub(crate) b: f32,
    pub(crate) a: f32,
}

impl PrefabSpriteTint {
    pub(crate) const PLAYER: Self = Self {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    };
    pub(crate) const ENEMY: Self = Self {
        r: 0.9,
        g: 0.3,
        b: 0.3,
        a: 0.9,
    };
    pub(crate) const PROJECTILE: Self = Self {
        r: 1.0,
        g: 1.0,
        b: 0.2,
        a: 1.0,
    };
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PrefabEntitySpawnRequest {
    pub(crate) transform: Transform2D,
    pub(crate) velocity: Option<Velocity>,
    pub(crate) texture_id: u32,
    pub(crate) template: EntityTemplate,
    pub(crate) layer: CollisionLayer,
    pub(crate) sprite_rotation_radians: f32,
    pub(crate) render_layer: i32,
    pub(crate) sprite_tint: PrefabSpriteTint,
    pub(crate) lifetime_seconds: Option<f32>,
    pub(crate) projectile_policy: Option<ProjectilePolicy>,
    pub(crate) gameplay_faction: Option<GameplayFaction>,
    pub(crate) damage: Option<f32>,
    pub(crate) health: Option<f32>,
    pub(crate) score_reward: Option<u32>,
    pub(crate) primary_actor_marker: bool,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ProjectileSpawnRequest {
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
        self.apply_prefab_entity_spawn_request(
            e,
            PrefabEntitySpawnRequest {
                transform: Transform2D { x, y },
                velocity: Some(Velocity::default()),
                texture_id,
                template,
                layer: CollisionLayer::Player,
                sprite_rotation_radians: 0.0,
                render_layer: DEFAULT_SPRITE_RENDER_LAYER,
                sprite_tint: PrefabSpriteTint::PLAYER,
                lifetime_seconds: None,
                projectile_policy: None,
                gameplay_faction: None,
                damage: None,
                health: None,
                score_reward: None,
                primary_actor_marker: true,
            },
        );
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
        self.apply_prefab_entity_spawn_request(
            e,
            PrefabEntitySpawnRequest {
                transform: Transform2D { x, y },
                velocity: None,
                texture_id,
                template,
                layer: CollisionLayer::Enemy,
                sprite_rotation_radians: 0.0,
                render_layer: DEFAULT_SPRITE_RENDER_LAYER,
                sprite_tint: PrefabSpriteTint::ENEMY,
                lifetime_seconds: None,
                projectile_policy: None,
                gameplay_faction: None,
                damage: None,
                health: Some(health),
                score_reward: Some(score_reward),
                primary_actor_marker: false,
            },
        );
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
        self.spawn_projectile_from_request(ProjectileSpawnRequest {
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

    pub(crate) fn spawn_projectile_from_request(
        &mut self,
        request: ProjectileSpawnRequest,
    ) -> Entity {
        let e = self.spawn_entity();
        self.apply_prefab_entity_spawn_request(
            e,
            PrefabEntitySpawnRequest {
                transform: request.transform,
                velocity: Some(request.velocity),
                texture_id: request.texture_id,
                template: request.template,
                layer: CollisionLayer::Bullet,
                sprite_rotation_radians: 0.0,
                render_layer: DEFAULT_SPRITE_RENDER_LAYER,
                sprite_tint: PrefabSpriteTint::PROJECTILE,
                lifetime_seconds: Some(request.lifetime),
                projectile_policy: Some(ProjectilePolicy::new(
                    request.collision_target,
                    request.tile_impact,
                )),
                gameplay_faction: request.source_faction,
                damage: Some(request.damage),
                health: None,
                score_reward: None,
                primary_actor_marker: false,
            },
        );
        e
    }

    pub(crate) fn spawn_prefab_entity_from_request(
        &mut self,
        request: PrefabEntitySpawnRequest,
    ) -> Entity {
        let e = self.spawn_entity();
        self.apply_prefab_entity_spawn_request(e, request);
        e
    }

    fn apply_prefab_entity_spawn_request(
        &mut self,
        entity: Entity,
        request: PrefabEntitySpawnRequest,
    ) {
        let i = entity.id as usize;
        if i >= self.alive.len() || !self.alive[i] || self.generations[i] != entity.generation {
            return;
        }
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
            r: request.sprite_tint.r,
            g: request.sprite_tint.g,
            b: request.sprite_tint.b,
            a: request.sprite_tint.a,
            rotation_radians: request.sprite_rotation_radians,
            render_layer: request.render_layer,
        });
        self.sprite_animations[i] = request.template.animation;
        self.velocities[i] = request.velocity;
        self.apply_template_collider(entity, request.layer, request.template);
        if let Some(lifetime_seconds) = request.lifetime_seconds {
            self.set_gameplay_lifetime_at(i, lifetime_seconds);
        }
        if let Some(policy) = request.projectile_policy {
            self.set_projectile_policy_at(i, policy);
        }
        if let Some(faction) = request.gameplay_faction {
            self.set_gameplay_faction_at_index(i, faction);
        } else {
            self.clear_gameplay_faction_at_index(i);
        }
        self.damages[i] = request.damage;
        self.healths[i] = request.health;
        self.score_rewards[i] = request.score_reward;
        if request.primary_actor_marker {
            self.set_primary_actor_entity(entity);
        }
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
