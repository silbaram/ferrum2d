//! Cold actor definitions. Immutable atlas data is shared; each spawn owns its mutable state.
use super::*;
use crate::components::gameplay::GAMEPLAY_TAG_PRIMARY_ACTOR;
use crate::components::CompoundColliderShape;

pub(crate) const MAX_ACTOR_PROTOTYPE_COLLIDERS: usize = 16;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ActorPrototype {
    pub source: Entity,
    origin: Transform2D,
    sprite: Option<Sprite>,
    normal_material: Option<crate::render_command::SpriteNormalMaterial>,
    animation: Option<SpriteAnimation>,
    playback: Option<sprite_playback::SpritePlayback>,
    shadow: Option<ground_shadow::GroundShadowCaster>,
    velocity: Option<Velocity>,
    rotation: Option<Rotation2D>,
    angular_velocity: Option<AngularVelocity>,
    pub height_span: Option<HeightSpan>,
    body: Option<RigidBody>,
    aabb: Option<AabbCollider>,
    circle: Option<CircleCollider>,
    oriented_box: Option<OrientedBoxCollider>,
    capsule: Option<CapsuleCollider>,
    edge: Option<EdgeCollider>,
    chain: Option<ChainCollider>,
    polygon: Option<ConvexPolygonCollider>,
    compound: Vec<CompoundCollider>,
    material: Option<PhysicsMaterial>,
    filter: Option<CollisionFilter>,
    lifetime: Option<GameplayLifetime>,
    health: Option<f32>,
    damage: Option<f32>,
    reward: Option<u32>,
    faction: Option<GameplayFaction>,
    tags: Option<GameplayTags>,
    actions: Option<ActionBindingSet>,
    pickup: Option<Pickup>,
    interaction: Option<Interaction>,
    pub movement: Option<MovementPattern>,
    reactions: Option<CollisionReactionSet>,
    timer: Option<GameplayTimerTrigger>,
    variable_triggers: Option<GameplayVariableMutationTriggerSet>,
}

impl World {
    /// Capture only standalone, non-projectile actors supported by combat checkpoints.
    /// No whole-world snapshot or entity handle is copied into the new entity's ownership.
    pub(crate) fn actor_prototype(&self, entity: Entity) -> Option<ActorPrototype> {
        let i = self.valid_index(entity)?;
        if self.transforms[i].is_none()
            || self.has_incident_joints(entity)
            || self.compound_collider_count_at(i) > MAX_ACTOR_PROTOTYPE_COLLIDERS
            || self.rigid_bodies[i].is_some_and(|body| {
                body.body_type == crate::components::RigidBodyType::Dynamic
                    || body.force != Velocity::default()
                    || body.impulse != Velocity::default()
                    || body.torque != 0.
                    || body.angular_impulse != 0.
            })
            || self.behavior_state_machines[i].is_some()
            || self.behavior_state_enter_actions[i].is_some()
            || self.projectile_arcs[i].is_some()
            || self.projectile_policies[i].is_some()
            || self.projectile_collision_targets[i].is_some()
            || self.projectile_tile_impacts[i].is_some()
        {
            return None;
        }
        Some(ActorPrototype {
            source: entity,
            origin: self.transforms[i]?,
            sprite: self.sprites[i],
            normal_material: self.sprite_normal_materials[i],
            animation: self.sprite_animations[i],
            playback: self.sprite_playbacks[i].clone(),
            shadow: self.ground_shadows[i].map(|shadow| {
                ground_shadow::GroundShadowCaster::new(
                    shadow.shape,
                    shadow.width,
                    shadow.height,
                    shadow.opacity,
                    shadow.layer,
                )
            }),
            velocity: self.velocities[i],
            rotation: self.rotations[i],
            angular_velocity: self.angular_velocities[i],
            height_span: self.height_spans[i],
            body: self.rigid_bodies[i],
            aabb: self.colliders[i],
            circle: self.circle_colliders[i],
            oriented_box: self.oriented_box_colliders[i],
            capsule: self.capsule_colliders[i],
            edge: self.edge_colliders[i],
            chain: self.chain_colliders[i],
            polygon: self.convex_polygon_colliders[i],
            compound: self.compound_colliders[i].clone(),
            material: self.collider_materials[i],
            filter: self.collision_filters[i],
            lifetime: self.gameplay_lifetime(entity).map(GameplayLifetime::new),
            health: self.healths[i],
            damage: self.damages[i],
            reward: self.score_rewards[i],
            faction: self.gameplay_factions[i],
            tags: self.gameplay_tags[i]
                .and_then(|tags| tags.without_tag(GAMEPLAY_TAG_PRIMARY_ACTOR)),
            actions: self.action_bindings[i],
            pickup: self.pickups[i],
            interaction: self.interactions[i],
            movement: self.movement_patterns[i],
            reactions: self.collision_reactions[i],
            timer: self.gameplay_timer_triggers[i],
            variable_triggers: self.gameplay_variable_mutation_triggers[i].clone(),
        })
    }

    /// Admission precedes allocation; a stale source is safe because its definition is owned.
    pub(crate) fn spawn_actor_prototype(
        &mut self,
        prototype: &ActorPrototype,
        at: Transform2D,
        height_span: Option<HeightSpan>,
        limit: usize,
    ) -> Option<Entity> {
        if !at.x.is_finite() || !at.y.is_finite() || !self.can_spawn_below(limit) {
            return None;
        }
        let entity = self.spawn_entity();
        let i = entity.id as usize;
        self.transforms[i] = Some(at);
        self.sprites[i] = prototype.sprite;
        self.sprite_normal_materials[i] = prototype.normal_material;
        self.sprite_animations[i] = prototype.animation;
        self.sprite_playbacks[i] = prototype.playback.clone();
        self.ground_shadows[i] = prototype.shadow;
        self.velocities[i] = prototype.velocity;
        self.rotations[i] = prototype.rotation;
        self.angular_velocities[i] = prototype.angular_velocity;
        self.height_spans[i] = height_span;
        self.rigid_bodies[i] = prototype.body;
        self.colliders[i] = prototype.aabb;
        self.circle_colliders[i] = prototype.circle;
        self.oriented_box_colliders[i] = prototype.oriented_box;
        self.capsule_colliders[i] = prototype.capsule;
        self.edge_colliders[i] = prototype.edge;
        self.chain_colliders[i] = prototype.chain;
        self.convex_polygon_colliders[i] = prototype.polygon;
        self.compound_colliders[i].clone_from(&prototype.compound);
        self.collider_materials[i] = prototype.material;
        self.collision_filters[i] = prototype.filter;
        self.lifetimes[i] = prototype.lifetime;
        self.bullet_lifetimes[i] = prototype
            .lifetime
            .map(|lifetime| lifetime.remaining_seconds);
        self.healths[i] = prototype.health;
        self.damages[i] = prototype.damage;
        self.score_rewards[i] = prototype.reward;
        // Use index-maintaining setters rather than copying faction/tag storage directly.
        if let Some(faction) = prototype.faction {
            self.set_gameplay_faction_at_index(i, faction);
        }
        if let Some(tags) = prototype.tags {
            self.set_gameplay_tags_at_index(i, tags);
        }
        self.action_bindings[i] = prototype.actions;
        self.pickups[i] = prototype.pickup;
        self.interactions[i] = prototype.interaction;
        self.movement_patterns[i] = prototype.movement_for(entity, at);
        self.collision_reactions[i] = prototype.reactions;
        self.gameplay_timer_triggers[i] = prototype.timer;
        self.gameplay_variable_mutation_triggers[i] = prototype.variable_triggers.clone();
        Some(entity)
    }
}

impl ActorPrototype {
    fn movement_for(&self, entity: Entity, at: Transform2D) -> Option<MovementPattern> {
        self.movement.map(|mut pattern| {
            let target = match &mut pattern {
                MovementPattern::Chase { target, .. }
                | MovementPattern::SeekTarget { target, .. }
                | MovementPattern::Orbit { target, .. } => Some(target),
                _ => None,
            };
            if let Some(target) = target {
                if *target == crate::components::gameplay::MovementTarget::Entity(self.source) {
                    *target = crate::components::gameplay::MovementTarget::Entity(entity);
                }
            }
            if let MovementPattern::Oscillate {
                origin_x, origin_y, ..
            } = &mut pattern
            {
                *origin_x += at.x - self.origin.x;
                *origin_y += at.y - self.origin.y;
            }
            pattern
        })
    }

    /// Save guards compare the cold definition, while the codec stores all mutable state.
    pub(crate) fn matches_instance(
        &self,
        world: &World,
        entity: Entity,
        origin: Transform2D,
    ) -> bool {
        let Some(mut actual) = world.actor_prototype(entity) else {
            return false;
        };
        let mut expected = self.clone();
        expected.source = actual.source;
        expected.origin = actual.origin;
        expected.movement = self.movement_for(entity, origin);
        actual.normalize();
        expected.normalize();
        actual == expected
    }

    fn normalize(&mut self) {
        self.velocity = None;
        self.rotation = None;
        self.angular_velocity = None;
        self.height_span = None;
        self.health = self.health.map(|_| 1.);
        self.lifetime = self.lifetime.map(|_| GameplayLifetime {
            remaining_seconds: 1.,
        });
        if let Some(body) = &mut self.body {
            body.enabled = true;
        }
        if let Some(interaction) = &mut self.interaction {
            interaction.consumed = false;
        }
        if let Some(timer) = &mut self.timer {
            timer.remaining_seconds = 0.;
            timer.fired = false;
        }
        if let Some(actions) = self.actions.take() {
            let mut normalized = ActionBindingSet::default();
            for mut action in actions.iter() {
                action.cooldown.remaining_seconds = 0.;
                normalized.upsert(action);
            }
            self.actions = Some(normalized);
        }
        if let Some(reactions) = &mut self.reactions {
            for reaction in reactions.iter_mut() {
                let cooldown = match reaction {
                    crate::components::gameplay::CollisionReaction::PlaySound {
                        cooldown, ..
                    }
                    | crate::components::gameplay::CollisionReaction::SpawnParticle {
                        cooldown,
                        ..
                    }
                    | crate::components::gameplay::CollisionReaction::EmitEffect {
                        cooldown, ..
                    }
                    | crate::components::gameplay::CollisionReaction::CameraShake {
                        cooldown,
                        ..
                    }
                    | crate::components::gameplay::CollisionReaction::SpawnPrefab {
                        cooldown,
                        ..
                    } => Some(cooldown),
                    _ => None,
                };
                if let Some(cooldown) = cooldown {
                    cooldown.remaining_seconds = 0.;
                }
            }
        }
        if let Some(playback) = &mut self.playback {
            playback.active = 0;
            playback.elapsed = 0.;
            playback.paused = false;
            playback.flip_x = false;
            playback.flip_y = false;
        }
        if let Some(animation) = &mut self.animation {
            animation.current_state = crate::components::SpriteAnimationKind::Idle;
            animation.current_frame = 0;
            animation.elapsed_seconds = 0.;
        }
        if self.playback.is_some() || self.animation.is_some() {
            if let Some(sprite) = &mut self.sprite {
                sprite.u0 = 0.;
                sprite.v0 = 0.;
                sprite.u1 = 0.;
                sprite.v1 = 0.;
            }
        }
        if let Some(c) = &mut self.aabb {
            c.enabled = true;
        }
        if let Some(c) = &mut self.circle {
            c.enabled = true;
        }
        if let Some(c) = &mut self.oriented_box {
            c.enabled = true;
        }
        if let Some(c) = &mut self.capsule {
            c.enabled = true;
        }
        if let Some(c) = &mut self.edge {
            c.enabled = true;
        }
        if let Some(c) = &mut self.chain {
            c.enabled = true;
        }
        if let Some(c) = &mut self.polygon {
            c.enabled = true;
        }
        for collider in &mut self.compound {
            match &mut collider.shape {
                CompoundColliderShape::Aabb(c) => c.enabled = true,
                CompoundColliderShape::Circle(c) => c.enabled = true,
                CompoundColliderShape::OrientedBox(c) => c.enabled = true,
                CompoundColliderShape::Capsule(c) => c.enabled = true,
                CompoundColliderShape::Edge(c) => c.enabled = true,
                CompoundColliderShape::Chain(c) => c.enabled = true,
                CompoundColliderShape::ConvexPolygon(c) => c.enabled = true,
            }
        }
    }
}

impl World {
    /// Reserve the retirement queue once during catalog setup, before actors can spawn.
    pub(crate) fn reserve_actor_prototype_spawns(&mut self, limit: usize) {
        let queue = &mut self.retired_gameplay_variable_mutation_triggers;
        if queue.capacity() < limit {
            queue.reserve_exact(limit - queue.len());
        }
    }

    /// A rejected provisional actor was never published and cannot own despawn-trigger events.
    pub(crate) fn discard_actor_prototype(&mut self, entity: Entity) {
        if let Some(index) = self.valid_index(entity) {
            self.gameplay_variable_mutation_triggers[index] = None;
        }
        self.despawn(entity);
    }

    pub(crate) fn actor_collider_enabled_mask(&self, entity: Entity) -> u32 {
        (0..self.compound_collider_count(entity)).fold(0, |mask, slot| {
            mask | (u32::from(
                self.compound_collider_ref_at(entity.id as usize, slot)
                    .is_some_and(|c| c.enabled()),
            ) << slot)
        })
    }

    /// Restore every collider, including a disabled non-primary compound shape.
    pub(crate) fn apply_actor_collider_enabled_mask(&mut self, entity: Entity, mask: u32) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        let first = mask & 1 != 0;
        if let Some(c) = &mut self.colliders[i] {
            c.enabled = first;
        }
        if let Some(c) = &mut self.circle_colliders[i] {
            c.enabled = first;
        }
        if let Some(c) = &mut self.oriented_box_colliders[i] {
            c.enabled = first;
        }
        if let Some(c) = &mut self.capsule_colliders[i] {
            c.enabled = first;
        }
        if let Some(c) = &mut self.edge_colliders[i] {
            c.enabled = first;
        }
        if let Some(c) = &mut self.chain_colliders[i] {
            c.enabled = first;
        }
        if let Some(c) = &mut self.convex_polygon_colliders[i] {
            c.enabled = first;
        }
        for (slot, collider) in self.compound_colliders[i].iter_mut().enumerate() {
            let enabled = mask & (1 << slot) != 0;
            match &mut collider.shape {
                CompoundColliderShape::Aabb(c) => c.enabled = enabled,
                CompoundColliderShape::Circle(c) => c.enabled = enabled,
                CompoundColliderShape::OrientedBox(c) => c.enabled = enabled,
                CompoundColliderShape::Capsule(c) => c.enabled = enabled,
                CompoundColliderShape::Edge(c) => c.enabled = enabled,
                CompoundColliderShape::Chain(c) => c.enabled = enabled,
                CompoundColliderShape::ConvexPolygon(c) => c.enabled = enabled,
            }
        }
    }
}
