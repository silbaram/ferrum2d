use crate::components::{
    AabbCollider, AngularVelocity, CapsuleCollider, CircleCollider, CollisionFilter,
    CollisionLayer, ConvexPolygonCollider, DistanceJoint, DistanceJointId, GearJoint, GearJointId,
    OrientedBoxCollider, PhysicsMaterial, PrismaticJoint, PrismaticJointId, RevoluteJoint,
    RevoluteJointId, RigidBody, RigidBodyType, RigidContactImpulse, RopeJoint, RopeJointId,
    Rotation2D, SpringJoint, SpringJointId, Sprite, SpriteAnimation, SpriteFrame, Transform2D,
    Velocity, MAX_CONVEX_POLYGON_VERTICES,
};
use crate::entity::Entity;
use crate::physics::PhysicsSystem;

pub const BULLET_LIFETIME: f32 = 1.8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EntityTemplate {
    pub sprite_width: f32,
    pub sprite_height: f32,
    pub collider_half_width: f32,
    pub collider_half_height: f32,
    pub collider_offset_x: f32,
    pub collider_offset_y: f32,
    pub collider_enabled: bool,
    pub collider_is_trigger: bool,
    pub collider_material: Option<PhysicsMaterial>,
    pub collider_shape: EntityTemplateColliderShape,
    pub frame: SpriteFrame,
    pub animation: Option<SpriteAnimation>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EntityTemplateCollider {
    pub shape: EntityTemplateColliderShape,
    pub half_width: f32,
    pub half_height: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub material: Option<PhysicsMaterial>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EntityTemplateColliderShape {
    Aabb {
        half_width: f32,
        half_height: f32,
    },
    Circle {
        radius: f32,
    },
    OrientedBox {
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
    },
    Capsule {
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
    },
    ConvexPolygon {
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: u32,
        rotation_radians: f32,
    },
}

impl EntityTemplateColliderShape {
    pub const fn aabb(half_width: f32, half_height: f32) -> Self {
        Self::Aabb {
            half_width,
            half_height,
        }
    }

    fn half_extents(self) -> (f32, f32) {
        match self {
            Self::Aabb {
                half_width,
                half_height,
            }
            | Self::OrientedBox {
                half_width,
                half_height,
                ..
            } => (half_width, half_height),
            Self::Circle { radius } => (radius, radius),
            Self::Capsule {
                start_x,
                start_y,
                end_x,
                end_y,
                radius,
            } => {
                let min_x = start_x.min(end_x) - radius;
                let max_x = start_x.max(end_x) + radius;
                let min_y = start_y.min(end_y) - radius;
                let max_y = start_y.max(end_y) + radius;
                ((max_x - min_x) * 0.5, (max_y - min_y) * 0.5)
            }
            Self::ConvexPolygon {
                vertices,
                vertex_count,
                ..
            } => {
                let count = (vertex_count as usize).min(MAX_CONVEX_POLYGON_VERTICES);
                if count == 0 {
                    return (0.0, 0.0);
                }
                let mut min_x = vertices[0].x;
                let mut max_x = vertices[0].x;
                let mut min_y = vertices[0].y;
                let mut max_y = vertices[0].y;
                for vertex in vertices.iter().take(count).skip(1) {
                    min_x = min_x.min(vertex.x);
                    max_x = max_x.max(vertex.x);
                    min_y = min_y.min(vertex.y);
                    max_y = max_y.max(vertex.y);
                }
                ((max_x - min_x) * 0.5, (max_y - min_y) * 0.5)
            }
        }
    }
}

impl EntityTemplateCollider {
    pub const fn from_template(template: EntityTemplate) -> Self {
        Self {
            shape: template.collider_shape,
            half_width: template.collider_half_width,
            half_height: template.collider_half_height,
            offset_x: template.collider_offset_x,
            offset_y: template.collider_offset_y,
            enabled: template.collider_enabled,
            is_trigger: template.collider_is_trigger,
            material: template.collider_material,
        }
    }

    pub const fn aabb(
        half_width: f32,
        half_height: f32,
        offset_x: f32,
        offset_y: f32,
        enabled: bool,
        is_trigger: bool,
        material: Option<PhysicsMaterial>,
    ) -> Self {
        Self {
            shape: EntityTemplateColliderShape::Aabb {
                half_width,
                half_height,
            },
            half_width,
            half_height,
            offset_x,
            offset_y,
            enabled,
            is_trigger,
            material,
        }
    }
}

impl EntityTemplate {
    pub const fn new(sprite_width: f32, sprite_height: f32) -> Self {
        Self {
            sprite_width,
            sprite_height,
            collider_half_width: sprite_width * 0.5,
            collider_half_height: sprite_height * 0.5,
            collider_offset_x: 0.0,
            collider_offset_y: 0.0,
            collider_enabled: true,
            collider_is_trigger: true,
            collider_material: None,
            collider_shape: EntityTemplateColliderShape::aabb(
                sprite_width * 0.5,
                sprite_height * 0.5,
            ),
            frame: SpriteFrame::FULL,
            animation: None,
        }
    }

    pub fn with_animation(mut self, frame_count: u32, fps: f32) -> Self {
        self.animation = SpriteAnimation::horizontal(frame_count, fps);
        self
    }

    pub fn with_sprite_animation(mut self, animation: Option<SpriteAnimation>) -> Self {
        self.animation = animation;
        self
    }

    pub fn with_collider(mut self, collider: EntityTemplateCollider) -> Self {
        self.collider_half_width = collider.half_width;
        self.collider_half_height = collider.half_height;
        self.collider_offset_x = collider.offset_x;
        self.collider_offset_y = collider.offset_y;
        self.collider_enabled = collider.enabled;
        self.collider_is_trigger = collider.is_trigger;
        self.collider_material = collider.material;
        self.collider_shape = collider.shape;
        let (half_width, half_height) = collider.shape.half_extents();
        self.collider_half_width = half_width;
        self.collider_half_height = half_height;
        self
    }

    pub fn with_frame(mut self, sprite_width: f32, sprite_height: f32, frame: SpriteFrame) -> Self {
        self.sprite_width = sprite_width;
        self.sprite_height = sprite_height;
        self.collider_half_width = sprite_width * 0.5;
        self.collider_half_height = sprite_height * 0.5;
        self.collider_shape =
            EntityTemplateColliderShape::aabb(self.collider_half_width, self.collider_half_height);
        self.frame = frame;
        self.animation = None;
        self
    }

    pub fn with_frame_animation(
        mut self,
        sprite_width: f32,
        sprite_height: f32,
        frame: SpriteFrame,
        animation: SpriteAnimation,
    ) -> Self {
        self.sprite_width = sprite_width;
        self.sprite_height = sprite_height;
        self.collider_half_width = sprite_width * 0.5;
        self.collider_half_height = sprite_height * 0.5;
        self.collider_shape =
            EntityTemplateColliderShape::aabb(self.collider_half_width, self.collider_half_height);
        self.frame = frame;
        self.animation = Some(animation);
        self
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
    pub(crate) sprite_animations: Vec<Option<SpriteAnimation>>,
    pub(crate) velocities: Vec<Option<Velocity>>,
    pub(crate) rotations: Vec<Option<Rotation2D>>,
    pub(crate) angular_velocities: Vec<Option<AngularVelocity>>,
    pub(crate) rigid_bodies: Vec<Option<RigidBody>>,
    pub(crate) rigid_contact_impulses: Vec<RigidContactImpulse>,
    pub(crate) distance_joints: Vec<Option<DistanceJoint>>,
    pub(crate) distance_joint_generations: Vec<u32>,
    distance_joint_free_list: Vec<u32>,
    pub(crate) rope_joints: Vec<Option<RopeJoint>>,
    pub(crate) rope_joint_generations: Vec<u32>,
    rope_joint_free_list: Vec<u32>,
    pub(crate) spring_joints: Vec<Option<SpringJoint>>,
    pub(crate) spring_joint_generations: Vec<u32>,
    spring_joint_free_list: Vec<u32>,
    pub(crate) revolute_joints: Vec<Option<RevoluteJoint>>,
    pub(crate) revolute_joint_generations: Vec<u32>,
    revolute_joint_free_list: Vec<u32>,
    pub(crate) prismatic_joints: Vec<Option<PrismaticJoint>>,
    pub(crate) prismatic_joint_generations: Vec<u32>,
    prismatic_joint_free_list: Vec<u32>,
    pub(crate) gear_joints: Vec<Option<GearJoint>>,
    pub(crate) gear_joint_generations: Vec<u32>,
    gear_joint_free_list: Vec<u32>,
    pub(crate) colliders: Vec<Option<AabbCollider>>,
    pub(crate) circle_colliders: Vec<Option<CircleCollider>>,
    pub(crate) oriented_box_colliders: Vec<Option<OrientedBoxCollider>>,
    pub(crate) capsule_colliders: Vec<Option<CapsuleCollider>>,
    pub(crate) convex_polygon_colliders: Vec<Option<ConvexPolygonCollider>>,
    pub(crate) collider_materials: Vec<Option<PhysicsMaterial>>,
    pub(crate) collision_filters: Vec<Option<CollisionFilter>>,
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
        self.sprite_animations.push(None);
        self.velocities.push(None);
        self.rotations.push(None);
        self.angular_velocities.push(None);
        self.rigid_bodies.push(None);
        self.colliders.push(None);
        self.circle_colliders.push(None);
        self.oriented_box_colliders.push(None);
        self.capsule_colliders.push(None);
        self.convex_polygon_colliders.push(None);
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
            self.convex_polygon_colliders[i] = None;
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
        let e = self.spawn_entity();
        let i = e.id as usize;
        let (u0, v0, u1, v1) = initial_uv(template);
        self.transforms[i] = Some(transform);
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
            b: 0.2,
            a: 1.0,
        });
        self.sprite_animations[i] = template.animation;
        self.velocities[i] = Some(velocity);
        let layer = CollisionLayer::Bullet;
        self.apply_template_collider(e, layer, template);
        self.bullet_lifetimes[i] = Some(lifetime);
        self.damages[i] = Some(damage);
        e
    }

    pub fn update(&mut self, delta: f32) {
        PhysicsSystem::integrate(self, delta);
        self.update_sprite_animations(delta);
    }

    pub fn alive_count(&self) -> usize {
        self.alive.iter().filter(|a| **a).count()
    }

    pub fn transform(&self, entity: Entity) -> Option<Transform2D> {
        let i = self.valid_index(entity)?;
        self.transforms[i]
    }

    pub fn set_transform(&mut self, entity: Entity, transform: Transform2D) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.transforms[i] = Some(transform);
    }

    pub fn velocity(&self, entity: Entity) -> Option<Velocity> {
        let i = self.valid_index(entity)?;
        self.velocities[i]
    }

    pub fn set_velocity(&mut self, entity: Entity, velocity: Velocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.velocities[i] = Some(velocity);
    }

    pub fn rotation(&self, entity: Entity) -> Option<Rotation2D> {
        let i = self.valid_index(entity)?;
        self.rotations[i]
    }

    pub fn set_rotation(&mut self, entity: Entity, rotation: Rotation2D) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.rotations[i] = Some(rotation);
    }

    pub fn angular_velocity(&self, entity: Entity) -> Option<AngularVelocity> {
        let i = self.valid_index(entity)?;
        self.angular_velocities[i]
    }

    pub fn set_angular_velocity(&mut self, entity: Entity, angular_velocity: AngularVelocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.angular_velocities[i] = Some(angular_velocity);
    }

    pub fn rigid_body(&self, entity: Entity) -> Option<RigidBody> {
        let i = self.valid_index(entity)?;
        self.rigid_bodies[i]
    }

    pub fn set_rigid_body(&mut self, entity: Entity, body: RigidBody) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.rigid_bodies[i] = Some(body);
        if self.velocities[i].is_none() {
            self.velocities[i] = Some(Velocity::default());
        }
        if self.rotations[i].is_none() {
            self.rotations[i] = Some(Rotation2D::default());
        }
        if self.angular_velocities[i].is_none() {
            self.angular_velocities[i] = Some(AngularVelocity::default());
        }
    }

    pub fn clear_rigid_body(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.rigid_bodies[i] = None;
    }

    pub fn rigid_contact_impulse_count(&self) -> usize {
        self.rigid_contact_impulses.len()
    }

    pub fn rigid_contact_impulse_at(&self, index: usize) -> Option<RigidContactImpulse> {
        self.rigid_contact_impulses.get(index).copied()
    }

    pub fn rigid_contact_impulses(&self) -> impl Iterator<Item = RigidContactImpulse> + '_ {
        self.rigid_contact_impulses.iter().copied()
    }

    pub fn apply_force(&mut self, entity: Entity, force: Velocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        let Some(body) = self.rigid_bodies[i].as_mut() else {
            return;
        };
        if !body.enabled {
            return;
        }
        let mut applied = false;
        if force.vx.is_finite() {
            body.force.vx += force.vx;
            applied = applied || force.vx != 0.0;
        }
        if force.vy.is_finite() {
            body.force.vy += force.vy;
            applied = applied || force.vy != 0.0;
        }
        if applied {
            wake_rigid_body(body);
        }
    }

    pub fn apply_impulse(&mut self, entity: Entity, impulse: Velocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        let Some(body) = self.rigid_bodies[i].as_mut() else {
            return;
        };
        if !body.enabled {
            return;
        }
        let mut applied = false;
        if impulse.vx.is_finite() {
            body.impulse.vx += impulse.vx;
            applied = applied || impulse.vx != 0.0;
        }
        if impulse.vy.is_finite() {
            body.impulse.vy += impulse.vy;
            applied = applied || impulse.vy != 0.0;
        }
        if applied {
            wake_rigid_body(body);
        }
    }

    pub fn apply_torque(&mut self, entity: Entity, torque: f32) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        let Some(body) = self.rigid_bodies[i].as_mut() else {
            return;
        };
        if !body.enabled {
            return;
        }
        if body.body_type != RigidBodyType::Dynamic {
            return;
        }
        if torque.is_finite() {
            body.torque += torque;
            if torque != 0.0 {
                wake_rigid_body(body);
            }
        }
    }

    pub fn apply_angular_impulse(&mut self, entity: Entity, angular_impulse: f32) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        let Some(body) = self.rigid_bodies[i].as_mut() else {
            return;
        };
        if !body.enabled {
            return;
        }
        if body.body_type != RigidBodyType::Dynamic {
            return;
        }
        if angular_impulse.is_finite() {
            body.angular_impulse += angular_impulse;
            if angular_impulse != 0.0 {
                wake_rigid_body(body);
            }
        }
    }

    pub fn add_distance_joint(&mut self, joint: DistanceJoint) -> DistanceJointId {
        if let Some(index) = self.distance_joint_free_list.pop() {
            let index = index as usize;
            self.distance_joints[index] = Some(joint);
            return DistanceJointId {
                index: index as u32,
                generation: self.distance_joint_generations[index],
            };
        }

        let index = self.distance_joints.len();
        self.distance_joints.push(Some(joint));
        self.distance_joint_generations.push(0);
        DistanceJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn distance_joint(&self, id: DistanceJointId) -> Option<DistanceJoint> {
        let index = self.valid_distance_joint_index(id)?;
        self.distance_joints[index]
    }

    pub fn set_distance_joint(&mut self, id: DistanceJointId, joint: DistanceJoint) {
        let Some(index) = self.valid_distance_joint_index(id) else {
            return;
        };
        self.distance_joints[index] = Some(joint);
    }

    pub fn clear_distance_joint(&mut self, id: DistanceJointId) -> Option<DistanceJoint> {
        let index = self.valid_distance_joint_index(id)?;
        let joint = self.distance_joints[index].take();
        self.distance_joint_generations[index] =
            self.distance_joint_generations[index].wrapping_add(1);
        self.distance_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_distance_joints(&mut self) {
        for (index, joint) in self.distance_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.distance_joint_generations[index] =
                    self.distance_joint_generations[index].wrapping_add(1);
                self.distance_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn distance_joint_count(&self) -> usize {
        self.distance_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_rope_joint(&mut self, joint: RopeJoint) -> RopeJointId {
        if let Some(index) = self.rope_joint_free_list.pop() {
            let index = index as usize;
            self.rope_joints[index] = Some(joint);
            return RopeJointId {
                index: index as u32,
                generation: self.rope_joint_generations[index],
            };
        }

        let index = self.rope_joints.len();
        self.rope_joints.push(Some(joint));
        self.rope_joint_generations.push(0);
        RopeJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn rope_joint(&self, id: RopeJointId) -> Option<RopeJoint> {
        let index = self.valid_rope_joint_index(id)?;
        self.rope_joints[index]
    }

    pub fn set_rope_joint(&mut self, id: RopeJointId, joint: RopeJoint) {
        let Some(index) = self.valid_rope_joint_index(id) else {
            return;
        };
        self.rope_joints[index] = Some(joint);
    }

    pub fn clear_rope_joint(&mut self, id: RopeJointId) -> Option<RopeJoint> {
        let index = self.valid_rope_joint_index(id)?;
        let joint = self.rope_joints[index].take();
        self.rope_joint_generations[index] = self.rope_joint_generations[index].wrapping_add(1);
        self.rope_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_rope_joints(&mut self) {
        for (index, joint) in self.rope_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.rope_joint_generations[index] =
                    self.rope_joint_generations[index].wrapping_add(1);
                self.rope_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn rope_joint_count(&self) -> usize {
        self.rope_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_spring_joint(&mut self, joint: SpringJoint) -> SpringJointId {
        if let Some(index) = self.spring_joint_free_list.pop() {
            let index = index as usize;
            self.spring_joints[index] = Some(joint);
            return SpringJointId {
                index: index as u32,
                generation: self.spring_joint_generations[index],
            };
        }

        let index = self.spring_joints.len();
        self.spring_joints.push(Some(joint));
        self.spring_joint_generations.push(0);
        SpringJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn spring_joint(&self, id: SpringJointId) -> Option<SpringJoint> {
        let index = self.valid_spring_joint_index(id)?;
        self.spring_joints[index]
    }

    pub fn set_spring_joint(&mut self, id: SpringJointId, joint: SpringJoint) {
        let Some(index) = self.valid_spring_joint_index(id) else {
            return;
        };
        self.spring_joints[index] = Some(joint);
    }

    pub fn clear_spring_joint(&mut self, id: SpringJointId) -> Option<SpringJoint> {
        let index = self.valid_spring_joint_index(id)?;
        let joint = self.spring_joints[index].take();
        self.spring_joint_generations[index] = self.spring_joint_generations[index].wrapping_add(1);
        self.spring_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_spring_joints(&mut self) {
        for (index, joint) in self.spring_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.spring_joint_generations[index] =
                    self.spring_joint_generations[index].wrapping_add(1);
                self.spring_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn spring_joint_count(&self) -> usize {
        self.spring_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_revolute_joint(&mut self, joint: RevoluteJoint) -> RevoluteJointId {
        if let Some(index) = self.revolute_joint_free_list.pop() {
            let index = index as usize;
            self.revolute_joints[index] = Some(joint);
            return RevoluteJointId {
                index: index as u32,
                generation: self.revolute_joint_generations[index],
            };
        }

        let index = self.revolute_joints.len();
        self.revolute_joints.push(Some(joint));
        self.revolute_joint_generations.push(0);
        RevoluteJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn revolute_joint(&self, id: RevoluteJointId) -> Option<RevoluteJoint> {
        let index = self.valid_revolute_joint_index(id)?;
        self.revolute_joints[index]
    }

    pub fn set_revolute_joint(&mut self, id: RevoluteJointId, joint: RevoluteJoint) {
        let Some(index) = self.valid_revolute_joint_index(id) else {
            return;
        };
        self.revolute_joints[index] = Some(joint);
    }

    pub fn clear_revolute_joint(&mut self, id: RevoluteJointId) -> Option<RevoluteJoint> {
        let index = self.valid_revolute_joint_index(id)?;
        let joint = self.revolute_joints[index].take();
        self.revolute_joint_generations[index] =
            self.revolute_joint_generations[index].wrapping_add(1);
        self.revolute_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_revolute_joints(&mut self) {
        for (index, joint) in self.revolute_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.revolute_joint_generations[index] =
                    self.revolute_joint_generations[index].wrapping_add(1);
                self.revolute_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn revolute_joint_count(&self) -> usize {
        self.revolute_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_prismatic_joint(&mut self, joint: PrismaticJoint) -> PrismaticJointId {
        if let Some(index) = self.prismatic_joint_free_list.pop() {
            let index = index as usize;
            self.prismatic_joints[index] = Some(joint);
            return PrismaticJointId {
                index: index as u32,
                generation: self.prismatic_joint_generations[index],
            };
        }

        let index = self.prismatic_joints.len();
        self.prismatic_joints.push(Some(joint));
        self.prismatic_joint_generations.push(0);
        PrismaticJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn prismatic_joint(&self, id: PrismaticJointId) -> Option<PrismaticJoint> {
        let index = self.valid_prismatic_joint_index(id)?;
        self.prismatic_joints[index]
    }

    pub fn set_prismatic_joint(&mut self, id: PrismaticJointId, joint: PrismaticJoint) {
        let Some(index) = self.valid_prismatic_joint_index(id) else {
            return;
        };
        self.prismatic_joints[index] = Some(joint);
    }

    pub fn clear_prismatic_joint(&mut self, id: PrismaticJointId) -> Option<PrismaticJoint> {
        let index = self.valid_prismatic_joint_index(id)?;
        let joint = self.prismatic_joints[index].take();
        self.prismatic_joint_generations[index] =
            self.prismatic_joint_generations[index].wrapping_add(1);
        self.prismatic_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_prismatic_joints(&mut self) {
        for (index, joint) in self.prismatic_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.prismatic_joint_generations[index] =
                    self.prismatic_joint_generations[index].wrapping_add(1);
                self.prismatic_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn prismatic_joint_count(&self) -> usize {
        self.prismatic_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_gear_joint(&mut self, joint: GearJoint) -> GearJointId {
        if let Some(index) = self.gear_joint_free_list.pop() {
            let index = index as usize;
            self.gear_joints[index] = Some(joint);
            return GearJointId {
                index: index as u32,
                generation: self.gear_joint_generations[index],
            };
        }

        let index = self.gear_joints.len();
        self.gear_joints.push(Some(joint));
        self.gear_joint_generations.push(0);
        GearJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn gear_joint(&self, id: GearJointId) -> Option<GearJoint> {
        let index = self.valid_gear_joint_index(id)?;
        self.gear_joints[index]
    }

    pub fn set_gear_joint(&mut self, id: GearJointId, joint: GearJoint) {
        let Some(index) = self.valid_gear_joint_index(id) else {
            return;
        };
        self.gear_joints[index] = Some(joint);
    }

    pub fn clear_gear_joint(&mut self, id: GearJointId) -> Option<GearJoint> {
        let index = self.valid_gear_joint_index(id)?;
        let joint = self.gear_joints[index].take();
        self.gear_joint_generations[index] = self.gear_joint_generations[index].wrapping_add(1);
        self.gear_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_gear_joints(&mut self) {
        for (index, joint) in self.gear_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.gear_joint_generations[index] =
                    self.gear_joint_generations[index].wrapping_add(1);
                self.gear_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn gear_joint_count(&self) -> usize {
        self.gear_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn collider(&self, entity: Entity) -> Option<AabbCollider> {
        let i = self.valid_index(entity)?;
        self.colliders[i]
    }

    pub fn set_aabb_collider(&mut self, entity: Entity, collider: AabbCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = Some(collider);
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = None;
        self.convex_polygon_colliders[i] = None;
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
    }

    pub fn circle_collider(&self, entity: Entity) -> Option<CircleCollider> {
        let i = self.valid_index(entity)?;
        self.circle_colliders[i]
    }

    pub fn set_circle_collider(&mut self, entity: Entity, collider: CircleCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = Some(collider);
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = None;
        self.convex_polygon_colliders[i] = None;
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
    }

    pub fn oriented_box_collider(&self, entity: Entity) -> Option<OrientedBoxCollider> {
        let i = self.valid_index(entity)?;
        self.oriented_box_colliders[i]
    }

    pub fn set_oriented_box_collider(&mut self, entity: Entity, collider: OrientedBoxCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = Some(collider);
        self.capsule_colliders[i] = None;
        self.convex_polygon_colliders[i] = None;
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
    }

    pub fn capsule_collider(&self, entity: Entity) -> Option<CapsuleCollider> {
        let i = self.valid_index(entity)?;
        self.capsule_colliders[i]
    }

    pub fn set_capsule_collider(&mut self, entity: Entity, collider: CapsuleCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = Some(collider);
        self.convex_polygon_colliders[i] = None;
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
    }

    pub fn convex_polygon_collider(&self, entity: Entity) -> Option<ConvexPolygonCollider> {
        let i = self.valid_index(entity)?;
        self.convex_polygon_colliders[i]
    }

    pub fn set_convex_polygon_collider(&mut self, entity: Entity, collider: ConvexPolygonCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = None;
        self.convex_polygon_colliders[i] = Some(collider);
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
    }

    pub fn clear_collider(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = None;
        self.convex_polygon_colliders[i] = None;
        self.collider_materials[i] = None;
        self.collision_filters[i] = None;
    }

    pub fn set_collider_material(&mut self, entity: Entity, material: PhysicsMaterial) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        if self.colliders[i].is_none()
            && self.circle_colliders[i].is_none()
            && self.oriented_box_colliders[i].is_none()
            && self.capsule_colliders[i].is_none()
            && self.convex_polygon_colliders[i].is_none()
        {
            return;
        }
        self.collider_materials[i] = Some(material);
    }

    pub fn clear_collider_material(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.collider_materials[i] = None;
    }

    pub fn collider_material(&self, entity: Entity) -> Option<PhysicsMaterial> {
        let i = self.valid_index(entity)?;
        self.collider_material_at(i)
    }

    pub(crate) fn collider_material_at(&self, index: usize) -> Option<PhysicsMaterial> {
        if self.colliders.get(index).copied().flatten().is_none()
            && self
                .circle_colliders
                .get(index)
                .copied()
                .flatten()
                .is_none()
            && self
                .oriented_box_colliders
                .get(index)
                .copied()
                .flatten()
                .is_none()
            && self
                .capsule_colliders
                .get(index)
                .copied()
                .flatten()
                .is_none()
            && self
                .convex_polygon_colliders
                .get(index)
                .copied()
                .flatten()
                .is_none()
        {
            return None;
        }
        self.collider_materials.get(index).copied().flatten()
    }

    pub fn set_collision_filter(&mut self, entity: Entity, filter: CollisionFilter) {
        let i = entity.id as usize;
        if i >= self.alive.len()
            || !self.alive[i]
            || self.generations[i] != entity.generation
            || (self.colliders[i].is_none()
                && self.circle_colliders[i].is_none()
                && self.oriented_box_colliders[i].is_none()
                && self.capsule_colliders[i].is_none()
                && self.convex_polygon_colliders[i].is_none())
        {
            return;
        }
        self.collision_filters[i] = Some(filter);
    }

    pub fn collision_filter(&self, entity: Entity) -> Option<CollisionFilter> {
        let i = entity.id as usize;
        if i >= self.alive.len() || !self.alive[i] || self.generations[i] != entity.generation {
            return None;
        }
        self.collision_filter_at(i)
    }

    pub(crate) fn collider_layer_at(&self, index: usize) -> Option<CollisionLayer> {
        if index >= self.alive.len() || !self.alive[index] {
            return None;
        }
        self.colliders
            .get(index)
            .copied()
            .flatten()
            .map(|collider| collider.layer)
            .or_else(|| {
                self.circle_colliders
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|collider| collider.layer)
            })
            .or_else(|| {
                self.oriented_box_colliders
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|collider| collider.layer)
            })
            .or_else(|| {
                self.capsule_colliders
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|collider| collider.layer)
            })
            .or_else(|| {
                self.convex_polygon_colliders
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|collider| collider.layer)
            })
    }

    pub(crate) fn collision_filter_at(&self, index: usize) -> Option<CollisionFilter> {
        let layer = self.collider_layer_at(index)?;
        self.collision_filters
            .get(index)
            .copied()
            .flatten()
            .or_else(|| Some(CollisionFilter::from_layer(layer)))
    }

    fn valid_index(&self, entity: Entity) -> Option<usize> {
        let i = entity.id as usize;
        (i < self.alive.len() && self.alive[i] && self.generations[i] == entity.generation)
            .then_some(i)
    }

    fn valid_distance_joint_index(&self, id: DistanceJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.distance_joints.len()
            && self.distance_joint_generations[index] == id.generation
            && self.distance_joints[index].is_some())
        .then_some(index)
    }

    fn valid_rope_joint_index(&self, id: RopeJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.rope_joints.len()
            && self.rope_joint_generations[index] == id.generation
            && self.rope_joints[index].is_some())
        .then_some(index)
    }

    fn valid_spring_joint_index(&self, id: SpringJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.spring_joints.len()
            && self.spring_joint_generations[index] == id.generation
            && self.spring_joints[index].is_some())
        .then_some(index)
    }

    fn valid_revolute_joint_index(&self, id: RevoluteJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.revolute_joints.len()
            && self.revolute_joint_generations[index] == id.generation
            && self.revolute_joints[index].is_some())
        .then_some(index)
    }

    fn valid_prismatic_joint_index(&self, id: PrismaticJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.prismatic_joints.len()
            && self.prismatic_joint_generations[index] == id.generation
            && self.prismatic_joints[index].is_some())
        .then_some(index)
    }

    fn valid_gear_joint_index(&self, id: GearJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.gear_joints.len()
            && self.gear_joint_generations[index] == id.generation
            && self.gear_joints[index].is_some())
        .then_some(index)
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
        }
    }

    fn update_sprite_animations(&mut self, delta: f32) {
        for i in 0..self.alive.len() {
            if !self.alive[i] {
                continue;
            }

            let Some(animation) = self.sprite_animations[i].as_mut() else {
                continue;
            };
            let Some(sprite) = self.sprites[i].as_mut() else {
                continue;
            };

            let is_moving = self.velocities[i].is_some_and(|velocity| {
                velocity.vx * velocity.vx + velocity.vy * velocity.vy > 0.01
            });
            animation.advance(delta, is_moving);
            let (u0, v0, u1, v1) = animation.uv();
            sprite.u0 = u0;
            sprite.v0 = v0;
            sprite.u1 = u1;
            sprite.v1 = v1;
        }
    }
}

fn initial_uv(template: EntityTemplate) -> (f32, f32, f32, f32) {
    template
        .animation
        .map(|animation| animation.uv())
        .unwrap_or_else(|| template.frame.uv())
}

fn wake_rigid_body(body: &mut RigidBody) {
    if body.enabled && body.body_type == RigidBodyType::Dynamic {
        body.is_sleeping = false;
        body.sleep_timer_seconds = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{
        AngularVelocity, CircleCollider, CollisionFilter, CollisionMask, RigidBodyType, Rotation2D,
        SpriteAnimation, SpriteAnimationState, MAX_CONVEX_POLYGON_VERTICES,
    };

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
        let material =
            PhysicsMaterial::new(0.2, 0.8).with_surface_velocity(Velocity { vx: 2.0, vy: 0.0 });
        let template = EntityTemplate::new(48.0, 30.0).with_collider(EntityTemplateCollider::aabb(
            10.0,
            12.0,
            3.0,
            -2.0,
            false,
            false,
            Some(material),
        ));

        let enemy = world.spawn_enemy_from_template(10.0, 20.0, 7, template, 3.0, 2);

        assert_eq!(world.sprites[enemy.id as usize].unwrap().width, 48.0);
        assert_eq!(world.sprites[enemy.id as usize].unwrap().height, 30.0);
        let collider = world.colliders[enemy.id as usize].unwrap();
        assert_eq!(collider.half_width, 10.0);
        assert_eq!(collider.half_height, 12.0);
        assert_eq!(collider.offset_x, 3.0);
        assert_eq!(collider.offset_y, -2.0);
        assert!(!collider.enabled);
        assert!(!collider.is_trigger);
        assert_eq!(world.collider_material(enemy), Some(material));
        assert_eq!(world.healths[enemy.id as usize], Some(3.0));
        assert_eq!(world.score_rewards[enemy.id as usize], Some(2));
    }

    #[test]
    fn spawn_from_template_applies_non_aabb_collider_shape() {
        let mut world = World::default();
        let material = PhysicsMaterial::new(0.1, 0.6);
        let template = EntityTemplate::new(32.0, 28.0).with_collider(EntityTemplateCollider {
            shape: EntityTemplateColliderShape::Capsule {
                start_x: -6.0,
                start_y: 0.0,
                end_x: 6.0,
                end_y: 0.0,
                radius: 4.0,
            },
            half_width: 0.0,
            half_height: 0.0,
            offset_x: 1.0,
            offset_y: -1.0,
            enabled: true,
            is_trigger: false,
            material: Some(material),
        });

        let enemy = world.spawn_enemy_from_template(10.0, 20.0, 7, template, 3.0, 2);
        let index = enemy.id as usize;

        assert!(world.colliders[index].is_none());
        let collider = world.capsule_colliders[index].unwrap();
        assert_eq!(collider.start_x, -6.0);
        assert_eq!(collider.end_x, 6.0);
        assert_eq!(collider.radius, 4.0);
        assert_eq!(collider.offset_x, 1.0);
        assert_eq!(collider.offset_y, -1.0);
        assert!(!collider.is_trigger);
        assert_eq!(collider.layer, CollisionLayer::Enemy);
        assert_eq!(world.collider_layer_at(index), Some(CollisionLayer::Enemy));
        assert_eq!(world.collider_material(enemy), Some(material));
    }

    #[test]
    fn collision_filter_defaults_to_spawn_layer_and_can_be_overridden() {
        let mut world = World::default();
        let enemy = world.spawn_enemy(10.0, 20.0, 7);

        assert_eq!(
            world.collision_filter(enemy),
            Some(CollisionFilter::from_layer(CollisionLayer::Enemy))
        );

        let filter = CollisionFilter::new(CollisionMask::ENEMY, CollisionMask::PLAYER);
        world.set_collision_filter(enemy, filter);

        assert_eq!(world.collision_filter(enemy), Some(filter));
    }

    #[test]
    fn collider_material_is_collider_scoped_and_can_be_cleared() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        let material =
            PhysicsMaterial::new(0.25, 0.75).with_surface_velocity(Velocity { vx: 3.0, vy: 0.0 });

        world.set_collider_material(entity, material);

        assert_eq!(world.collider_material(entity), None);

        world.set_aabb_collider(
            entity,
            AabbCollider::new(2.0, 3.0, false, CollisionLayer::Wall),
        );
        world.set_collider_material(entity, material);

        assert_eq!(world.collider_material(entity), Some(material));

        world.clear_collider_material(entity);
        assert_eq!(world.collider_material(entity), None);

        world.set_collider_material(entity, material);
        world.clear_collider(entity);

        assert_eq!(world.collider_material(entity), None);
    }

    #[test]
    fn generic_component_setters_update_entity_components() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        let transform = Transform2D { x: 4.0, y: 8.0 };
        let velocity = Velocity { vx: 2.0, vy: 3.0 };
        let rotation = Rotation2D { radians: 1.5 };
        let angular_velocity = AngularVelocity {
            radians_per_second: 2.0,
        };
        let collider = AabbCollider {
            half_width: 6.0,
            half_height: 7.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Enemy,
        };

        world.set_transform(entity, transform);
        world.set_velocity(entity, velocity);
        world.set_rotation(entity, rotation);
        world.set_angular_velocity(entity, angular_velocity);
        world.set_aabb_collider(entity, collider);
        world.set_rigid_body(entity, RigidBody::dynamic(2.0));

        assert_eq!(world.transform(entity), Some(transform));
        assert_eq!(world.velocity(entity), Some(velocity));
        assert_eq!(world.rotation(entity), Some(rotation));
        assert_eq!(world.angular_velocity(entity), Some(angular_velocity));
        assert_eq!(world.collider(entity), Some(collider));
        assert_eq!(
            world.rigid_body(entity).map(|body| body.body_type),
            Some(RigidBodyType::Dynamic)
        );
        assert_eq!(
            world.rigid_body(entity).map(|body| body.enabled),
            Some(true)
        );
        assert_eq!(
            world.collision_filter(entity),
            Some(CollisionFilter::from_layer(CollisionLayer::Enemy))
        );
    }

    #[test]
    fn rigid_body_force_and_impulse_accumulate_on_component() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        world.set_rigid_body(entity, RigidBody::dynamic(4.0));

        world.apply_force(entity, Velocity { vx: 8.0, vy: -2.0 });
        world.apply_impulse(entity, Velocity { vx: 4.0, vy: 1.0 });

        let body = world.rigid_body(entity).unwrap();
        assert_eq!(body.force, Velocity { vx: 8.0, vy: -2.0 });
        assert_eq!(body.impulse, Velocity { vx: 4.0, vy: 1.0 });
    }

    #[test]
    fn disabled_rigid_body_ignores_force_and_impulse_accumulation() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        world.set_rigid_body(entity, RigidBody::dynamic(4.0).with_enabled(false));

        world.apply_force(entity, Velocity { vx: 8.0, vy: -2.0 });
        world.apply_impulse(entity, Velocity { vx: 4.0, vy: 1.0 });

        let body = world.rigid_body(entity).unwrap();
        assert!(!body.enabled);
        assert_eq!(body.force, Velocity::default());
        assert_eq!(body.impulse, Velocity::default());
    }

    #[test]
    fn rigid_body_torque_and_angular_impulse_accumulate_on_component() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        world.set_rigid_body(entity, RigidBody::dynamic(4.0));

        world.apply_torque(entity, 8.0);
        world.apply_angular_impulse(entity, 2.0);
        world.apply_torque(entity, f32::NAN);
        world.apply_angular_impulse(entity, f32::INFINITY);

        let body = world.rigid_body(entity).unwrap();
        assert_eq!(body.torque, 8.0);
        assert_eq!(body.angular_impulse, 2.0);
    }

    #[test]
    fn disabled_rigid_body_ignores_torque_and_angular_impulse_accumulation() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        world.set_rigid_body(entity, RigidBody::dynamic(4.0).with_enabled(false));

        world.apply_torque(entity, 8.0);
        world.apply_angular_impulse(entity, 2.0);

        let body = world.rigid_body(entity).unwrap();
        assert!(!body.enabled);
        assert_eq!(body.torque, 0.0);
        assert_eq!(body.angular_impulse, 0.0);
    }

    #[test]
    fn distance_joint_handles_add_update_clear_and_reuse_storage() {
        let mut world = World::default();
        let a = world.spawn_entity();
        let b = world.spawn_entity();
        let first =
            world.add_distance_joint(DistanceJoint::new(a, b, 12.0).with_break_distance(3.0));

        assert_eq!(world.distance_joint_count(), 1);
        assert_eq!(
            world.distance_joint(first).map(|joint| joint.rest_length),
            Some(12.0)
        );
        assert_eq!(
            world
                .distance_joint(first)
                .map(|joint| joint.break_distance),
            Some(3.0)
        );

        world.set_distance_joint(
            first,
            DistanceJoint::new(a, b, 6.0)
                .with_break_distance(2.0)
                .without_break_distance()
                .with_damping(0.5),
        );

        assert_eq!(
            world.distance_joint(first).map(|joint| joint.rest_length),
            Some(6.0)
        );
        assert_eq!(
            world
                .distance_joint(first)
                .map(|joint| joint.break_distance),
            Some(f32::INFINITY)
        );
        assert_eq!(
            world.distance_joint(first).map(|joint| joint.damping),
            Some(0.5)
        );

        assert!(world.clear_distance_joint(first).is_some());
        assert_eq!(world.distance_joint(first), None);
        assert_eq!(world.distance_joint_count(), 0);

        let second = world.add_distance_joint(DistanceJoint::new(a, b, 4.0));

        assert_eq!(second.index, first.index);
        assert_ne!(second.generation, first.generation);
        assert_eq!(
            world.distance_joint(second).map(|joint| joint.rest_length),
            Some(4.0)
        );
    }

    #[test]
    fn rope_joint_handles_add_update_clear_and_reuse_storage() {
        let mut world = World::default();
        let a = world.spawn_entity();
        let b = world.spawn_entity();
        let first = world.add_rope_joint(RopeJoint::new(a, b, 12.0).with_break_distance(3.0));

        assert_eq!(world.rope_joint_count(), 1);
        assert_eq!(
            world.rope_joint(first).map(|joint| joint.max_length),
            Some(12.0)
        );
        assert_eq!(
            world.rope_joint(first).map(|joint| joint.break_distance),
            Some(3.0)
        );

        world.set_rope_joint(
            first,
            RopeJoint::new(a, b, 6.0)
                .with_break_distance(2.0)
                .without_break_distance()
                .with_damping(0.5),
        );

        assert_eq!(
            world.rope_joint(first).map(|joint| joint.max_length),
            Some(6.0)
        );
        assert_eq!(
            world.rope_joint(first).map(|joint| joint.break_distance),
            Some(f32::INFINITY)
        );
        assert_eq!(
            world.rope_joint(first).map(|joint| joint.damping),
            Some(0.5)
        );

        assert!(world.clear_rope_joint(first).is_some());
        assert_eq!(world.rope_joint(first), None);
        assert_eq!(world.rope_joint_count(), 0);

        let second = world.add_rope_joint(RopeJoint::new(a, b, 4.0));

        assert_eq!(second.index, first.index);
        assert_ne!(second.generation, first.generation);
        assert_eq!(
            world.rope_joint(second).map(|joint| joint.max_length),
            Some(4.0)
        );
    }

    #[test]
    fn spring_joint_handles_add_update_clear_and_reuse_storage() {
        let mut world = World::default();
        let a = world.spawn_entity();
        let b = world.spawn_entity();
        let first = world.add_spring_joint(SpringJoint::new(a, b, 12.0).with_break_distance(3.0));

        assert_eq!(world.spring_joint_count(), 1);
        assert_eq!(
            world.spring_joint(first).map(|joint| joint.rest_length),
            Some(12.0)
        );
        assert_eq!(
            world.spring_joint(first).map(|joint| joint.break_distance),
            Some(3.0)
        );

        world.set_spring_joint(
            first,
            SpringJoint::new(a, b, 6.0)
                .with_break_distance(2.0)
                .without_break_distance()
                .with_damping(0.5),
        );

        assert_eq!(
            world.spring_joint(first).map(|joint| joint.rest_length),
            Some(6.0)
        );
        assert_eq!(
            world.spring_joint(first).map(|joint| joint.break_distance),
            Some(f32::INFINITY)
        );
        assert_eq!(
            world.spring_joint(first).map(|joint| joint.damping),
            Some(0.5)
        );

        assert!(world.clear_spring_joint(first).is_some());
        assert_eq!(world.spring_joint(first), None);
        assert_eq!(world.spring_joint_count(), 0);

        let second = world.add_spring_joint(SpringJoint::new(a, b, 4.0));

        assert_eq!(second.index, first.index);
        assert_ne!(second.generation, first.generation);
        assert_eq!(
            world.spring_joint(second).map(|joint| joint.rest_length),
            Some(4.0)
        );
    }

    #[test]
    fn revolute_joint_handles_add_update_clear_and_reuse_storage() {
        let mut world = World::default();
        let a = world.spawn_entity();
        let b = world.spawn_entity();
        let first = world.add_revolute_joint(
            RevoluteJoint::new(a, b)
                .with_local_anchor_a(1.0, 2.0)
                .with_local_anchor_b(3.0, 4.0)
                .with_break_distance(9.0)
                .with_angle_limits(-0.5, 0.75)
                .with_motor(2.0, 8.0),
        );

        assert_eq!(world.revolute_joint_count(), 1);
        assert_eq!(
            world.revolute_joint(first).map(|joint| (
                joint.local_anchor_a_x,
                joint.local_anchor_a_y,
                joint.local_anchor_b_x,
                joint.local_anchor_b_y,
            )),
            Some((1.0, 2.0, 3.0, 4.0))
        );
        assert_eq!(
            world
                .revolute_joint(first)
                .map(|joint| joint.break_distance),
            Some(9.0)
        );
        assert_eq!(
            world.revolute_joint(first).map(|joint| (
                joint.limit_enabled,
                joint.lower_angle,
                joint.upper_angle,
            )),
            Some((true, -0.5, 0.75))
        );
        assert_eq!(
            world.revolute_joint(first).map(|joint| (
                joint.motor_enabled,
                joint.motor_speed,
                joint.max_motor_torque,
            )),
            Some((true, 2.0, 8.0))
        );

        world.set_revolute_joint(
            first,
            RevoluteJoint::new(a, b)
                .with_local_anchor_a(6.0, 7.0)
                .with_break_distance(4.0)
                .without_break_distance()
                .with_angle_limits(-1.0, 1.0)
                .with_angle_limit_enabled(false)
                .with_motor(-3.0, 5.0)
                .with_motor_enabled(false)
                .with_damping(0.5),
        );

        assert_eq!(
            world
                .revolute_joint(first)
                .map(|joint| (joint.local_anchor_a_x, joint.local_anchor_a_y)),
            Some((6.0, 7.0))
        );
        assert_eq!(
            world.revolute_joint(first).map(|joint| joint.damping),
            Some(0.5)
        );
        assert_eq!(
            world
                .revolute_joint(first)
                .map(|joint| joint.break_distance),
            Some(f32::INFINITY)
        );
        assert_eq!(
            world.revolute_joint(first).map(|joint| (
                joint.limit_enabled,
                joint.lower_angle,
                joint.upper_angle,
            )),
            Some((false, -1.0, 1.0))
        );
        assert_eq!(
            world.revolute_joint(first).map(|joint| (
                joint.motor_enabled,
                joint.motor_speed,
                joint.max_motor_torque,
            )),
            Some((false, -3.0, 5.0))
        );

        assert!(world.clear_revolute_joint(first).is_some());
        assert_eq!(world.revolute_joint(first), None);
        assert_eq!(world.revolute_joint_count(), 0);

        let second = world.add_revolute_joint(RevoluteJoint::new(a, b));

        assert_eq!(second.index, first.index);
        assert_ne!(second.generation, first.generation);
        assert_eq!(
            world.revolute_joint(second).map(|joint| joint.entity_b),
            Some(b)
        );
    }

    #[test]
    fn prismatic_joint_handles_add_update_clear_and_reuse_storage() {
        let mut world = World::default();
        let a = world.spawn_entity();
        let b = world.spawn_entity();
        let first = world.add_prismatic_joint(
            PrismaticJoint::new(a, b)
                .with_local_anchor_a(1.0, 2.0)
                .with_local_anchor_b(3.0, 4.0)
                .with_local_axis_a(0.0, 1.0)
                .with_break_distance(9.0)
                .with_reference_angle(0.25)
                .with_translation_limits(-2.0, 8.0)
                .with_motor(3.0, 20.0),
        );

        assert_eq!(world.prismatic_joint_count(), 1);
        assert_eq!(
            world.prismatic_joint(first).map(|joint| (
                joint.local_anchor_a_x,
                joint.local_anchor_a_y,
                joint.local_anchor_b_x,
                joint.local_anchor_b_y,
            )),
            Some((1.0, 2.0, 3.0, 4.0))
        );
        assert_eq!(
            world.prismatic_joint(first).map(|joint| (
                joint.local_axis_a_x,
                joint.local_axis_a_y,
                joint.reference_angle,
            )),
            Some((0.0, 1.0, 0.25))
        );
        assert_eq!(
            world
                .prismatic_joint(first)
                .map(|joint| joint.break_distance),
            Some(9.0)
        );
        assert_eq!(
            world.prismatic_joint(first).map(|joint| (
                joint.limit_enabled,
                joint.lower_translation,
                joint.upper_translation,
            )),
            Some((true, -2.0, 8.0))
        );
        assert_eq!(
            world.prismatic_joint(first).map(|joint| (
                joint.motor_enabled,
                joint.motor_speed,
                joint.max_motor_force,
            )),
            Some((true, 3.0, 20.0))
        );

        world.set_prismatic_joint(
            first,
            PrismaticJoint::new(a, b)
                .with_local_axis_a(1.0, 0.0)
                .with_break_distance(4.0)
                .without_break_distance()
                .with_damping(0.5)
                .with_angular_damping(0.25)
                .with_translation_limits(-4.0, 4.0)
                .with_translation_limit_enabled(false)
                .with_motor(-2.0, 10.0)
                .with_motor_enabled(false),
        );

        assert_eq!(
            world
                .prismatic_joint(first)
                .map(|joint| (joint.local_axis_a_x, joint.local_axis_a_y)),
            Some((1.0, 0.0))
        );
        assert_eq!(
            world.prismatic_joint(first).map(|joint| joint.damping),
            Some(0.5)
        );
        assert_eq!(
            world
                .prismatic_joint(first)
                .map(|joint| joint.break_distance),
            Some(f32::INFINITY)
        );
        assert_eq!(
            world
                .prismatic_joint(first)
                .map(|joint| joint.angular_damping),
            Some(0.25)
        );
        assert_eq!(
            world.prismatic_joint(first).map(|joint| (
                joint.limit_enabled,
                joint.lower_translation,
                joint.upper_translation
            )),
            Some((false, -4.0, 4.0))
        );
        assert_eq!(
            world.prismatic_joint(first).map(|joint| (
                joint.motor_enabled,
                joint.motor_speed,
                joint.max_motor_force
            )),
            Some((false, -2.0, 10.0))
        );

        assert!(world.clear_prismatic_joint(first).is_some());
        assert_eq!(world.prismatic_joint(first), None);
        assert_eq!(world.prismatic_joint_count(), 0);

        let second = world.add_prismatic_joint(PrismaticJoint::new(a, b));

        assert_eq!(second.index, first.index);
        assert_ne!(second.generation, first.generation);
        assert_eq!(
            world.prismatic_joint(second).map(|joint| joint.entity_b),
            Some(b)
        );
    }

    #[test]
    fn gear_joint_handles_add_update_clear_and_reuse_storage() {
        let mut world = World::default();
        let a = world.spawn_entity();
        let b = world.spawn_entity();
        let first = world.add_gear_joint(
            GearJoint::new(a, b, 2.0)
                .with_reference_angle(0.5)
                .with_break_angle(0.75),
        );

        assert_eq!(world.gear_joint_count(), 1);
        assert_eq!(
            world.gear_joint(first).map(|joint| (
                joint.ratio,
                joint.reference_angle,
                joint.break_angle
            )),
            Some((2.0, 0.5, 0.75))
        );

        world.set_gear_joint(
            first,
            GearJoint::new(a, b, -3.0)
                .with_reference_angle(-0.25)
                .with_break_angle(0.5)
                .without_break_angle()
                .with_stiffness(0.25)
                .with_damping(0.75)
                .with_enabled(false),
        );

        assert_eq!(
            world.gear_joint(first).map(|joint| (
                joint.ratio,
                joint.reference_angle,
                joint.break_angle,
                joint.stiffness,
                joint.damping,
                joint.enabled,
            )),
            Some((-3.0, -0.25, f32::INFINITY, 0.25, 0.75, false))
        );

        assert!(world.clear_gear_joint(first).is_some());
        assert_eq!(world.gear_joint(first), None);
        assert_eq!(world.gear_joint_count(), 0);

        let second = world.add_gear_joint(GearJoint::new(a, b, 1.0));

        assert_eq!(second.index, first.index);
        assert_ne!(second.generation, first.generation);
        assert_eq!(
            world.gear_joint(second).map(|joint| joint.entity_b),
            Some(b)
        );
    }

    #[test]
    fn circle_collider_setter_replaces_aabb_and_defaults_filter() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        let aabb = AabbCollider {
            half_width: 6.0,
            half_height: 7.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Enemy,
        };
        let circle = CircleCollider {
            radius: 5.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: true,
            layer: CollisionLayer::Player,
        };

        world.set_aabb_collider(entity, aabb);
        world.clear_collider(entity);
        world.set_circle_collider(entity, circle);

        assert_eq!(world.collider(entity), None);
        assert_eq!(world.circle_collider(entity), Some(circle));
        assert_eq!(
            world.collision_filter(entity),
            Some(CollisionFilter::from_layer(CollisionLayer::Player))
        );
    }

    #[test]
    fn capsule_collider_setter_replaces_other_colliders_and_defaults_filter() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        let aabb = AabbCollider::new(6.0, 7.0, false, CollisionLayer::Enemy);
        let circle = CircleCollider::new(5.0, true, CollisionLayer::Player);
        let capsule = CapsuleCollider::new(-4.0, 0.0, 4.0, 0.0, 2.0, true, CollisionLayer::Enemy);

        world.set_aabb_collider(entity, aabb);
        world.set_circle_collider(entity, circle);
        world.clear_collider(entity);
        world.set_capsule_collider(entity, capsule);

        assert_eq!(world.collider(entity), None);
        assert_eq!(world.circle_collider(entity), None);
        assert_eq!(world.capsule_collider(entity), Some(capsule));
        assert_eq!(
            world.collision_filter(entity),
            Some(CollisionFilter::from_layer(CollisionLayer::Enemy))
        );
    }

    #[test]
    fn oriented_box_collider_setter_replaces_other_colliders_and_defaults_filter() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        let aabb = AabbCollider::new(6.0, 7.0, false, CollisionLayer::Enemy);
        let circle = CircleCollider::new(5.0, true, CollisionLayer::Player);
        let capsule = CapsuleCollider::new(-4.0, 0.0, 4.0, 0.0, 2.0, true, CollisionLayer::Enemy);
        let oriented_box = OrientedBoxCollider::new(
            6.0,
            2.0,
            core::f32::consts::FRAC_PI_4,
            false,
            CollisionLayer::Wall,
        );

        world.set_aabb_collider(entity, aabb);
        world.set_circle_collider(entity, circle);
        world.set_capsule_collider(entity, capsule);
        world.clear_collider(entity);
        world.set_oriented_box_collider(entity, oriented_box);

        assert_eq!(world.collider(entity), None);
        assert_eq!(world.circle_collider(entity), None);
        assert_eq!(world.capsule_collider(entity), None);
        assert_eq!(world.oriented_box_collider(entity), Some(oriented_box));
        assert_eq!(
            world.collision_filter(entity),
            Some(CollisionFilter::from_layer(CollisionLayer::Wall))
        );
    }

    #[test]
    fn convex_polygon_collider_setter_replaces_other_colliders_and_defaults_filter() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        let aabb = AabbCollider::new(6.0, 7.0, false, CollisionLayer::Enemy);
        let circle = CircleCollider::new(5.0, true, CollisionLayer::Player);
        let capsule = CapsuleCollider::new(-4.0, 0.0, 4.0, 0.0, 2.0, true, CollisionLayer::Enemy);
        let oriented_box = OrientedBoxCollider::new(
            6.0,
            2.0,
            core::f32::consts::FRAC_PI_4,
            false,
            CollisionLayer::Wall,
        );
        let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
        vertices[0] = Transform2D { x: -1.0, y: -1.0 };
        vertices[1] = Transform2D { x: 1.0, y: -1.0 };
        vertices[2] = Transform2D { x: 1.0, y: 1.0 };
        vertices[3] = Transform2D { x: -1.0, y: 1.0 };
        let polygon = ConvexPolygonCollider::new(vertices, 4, true, CollisionLayer::Enemy);

        world.set_aabb_collider(entity, aabb);
        world.set_circle_collider(entity, circle);
        world.set_capsule_collider(entity, capsule);
        world.set_oriented_box_collider(entity, oriented_box);
        world.clear_collider(entity);
        world.set_convex_polygon_collider(entity, polygon);

        assert_eq!(world.collider(entity), None);
        assert_eq!(world.circle_collider(entity), None);
        assert_eq!(world.capsule_collider(entity), None);
        assert_eq!(world.oriented_box_collider(entity), None);
        assert_eq!(world.convex_polygon_collider(entity), Some(polygon));
        assert_eq!(
            world.collision_filter(entity),
            Some(CollisionFilter::from_layer(CollisionLayer::Enemy))
        );
    }

    #[test]
    fn sprite_animation_advances_horizontal_uv_frames() {
        let mut world = World::default();
        let template = EntityTemplate::new(32.0, 32.0).with_animation(4, 8.0);
        let entity = world.spawn_enemy_from_template(10.0, 20.0, 7, template, 1.0, 1);

        assert_eq!(world.sprites[entity.id as usize].unwrap().u0, 0.0);
        assert_eq!(world.sprites[entity.id as usize].unwrap().u1, 0.25);

        world.update(0.125);

        assert_eq!(world.sprites[entity.id as usize].unwrap().u0, 0.25);
        assert_eq!(world.sprites[entity.id as usize].unwrap().u1, 0.5);
    }

    #[test]
    fn sprite_animation_switches_rows_for_moving_state() {
        let mut world = World::default();
        let animation = SpriteAnimation::new(
            4,
            2,
            SpriteAnimationState {
                row: 0,
                frame_count: 1,
                frames_per_second: 1.0,
            },
            SpriteAnimationState {
                row: 1,
                frame_count: 4,
                frames_per_second: 8.0,
            },
        );
        let template = EntityTemplate::new(32.0, 32.0).with_sprite_animation(animation);
        let entity = world.spawn_bullet_from_template(
            Transform2D { x: 10.0, y: 20.0 },
            Velocity { vx: 5.0, vy: 0.0 },
            7,
            1.0,
            template,
            1.0,
        );

        world.update(0.125);

        let sprite = world.sprites[entity.id as usize].unwrap();
        assert_eq!(sprite.u0, 0.25);
        assert_eq!(sprite.u1, 0.5);
        assert_eq!(sprite.v0, 0.5);
        assert_eq!(sprite.v1, 1.0);
    }

    #[test]
    fn sprite_animation_advances_atlas_frame_sequence() {
        let mut world = World::default();
        let idle = [
            SpriteFrame::from_values(0.0, 0.0, 0.25, 0.5).unwrap(),
            SpriteFrame::from_values(0.25, 0.0, 0.5, 0.5).unwrap(),
        ];
        let moving = [
            SpriteFrame::from_values(0.0, 0.5, 0.25, 1.0).unwrap(),
            SpriteFrame::from_values(0.25, 0.5, 0.5, 1.0).unwrap(),
        ];
        let animation = SpriteAnimation::atlas(&idle, 4.0, &moving, 8.0).unwrap();
        let template =
            EntityTemplate::new(32.0, 32.0).with_frame_animation(32.0, 32.0, idle[0], animation);
        let entity = world.spawn_bullet_from_template(
            Transform2D { x: 10.0, y: 20.0 },
            Velocity { vx: 5.0, vy: 0.0 },
            7,
            1.0,
            template,
            1.0,
        );

        world.update(0.125);

        let sprite = world.sprites[entity.id as usize].unwrap();
        assert_eq!(sprite.u0, 0.25);
        assert_eq!(sprite.u1, 0.5);
        assert_eq!(sprite.v0, 0.5);
        assert_eq!(sprite.v1, 1.0);
    }
}
