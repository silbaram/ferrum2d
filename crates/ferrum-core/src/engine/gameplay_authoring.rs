use wasm_bindgen::prelude::*;

use super::{
    Engine, MAX_PARTICLE_PRESETS, PHYSICS_LAYER_BULLET, PHYSICS_LAYER_ENEMY, PHYSICS_LAYER_PICKUP,
    PHYSICS_LAYER_PLAYER, PHYSICS_LAYER_WALL,
};
use crate::components::gameplay::{
    ActionAimSource, ActionBinding, ActionBindingSet, ActionPattern, BehaviorStateEnterAction,
    BehaviorStateEnterActionPhase, BehaviorStateMachine, BehaviorStateTransition,
    CollisionReaction, CollisionReactionSet, CollisionReactionTrigger, CollisionTarget, Cooldown,
    FactionRelation, GameplayFaction, GameplayTags, GameplayTimerTrigger, Interaction, MeleeTarget,
    MovementPattern, MovementTarget, Pickup, ProjectileActionConfig, ProjectileCollisionTarget,
    ProjectileTileImpact, SpawnAnchor, SpawnPhase, SpawnPrefabProjectilePayload,
    GAMEPLAY_FACTION_MAX_ID, GAMEPLAY_PICKUP_ITEM_SCORE, GAMEPLAY_TAG_MAX_ID,
};
use crate::components::CollisionLayer;
use crate::entity::Entity;
use crate::gameplay_event::{
    GAMEPLAY_EVENT_COLLISION_DAMAGE, GAMEPLAY_EVENT_COLLISION_DESPAWN, GAMEPLAY_EVENT_INTERACTION,
    GAMEPLAY_EVENT_PICKUP_COLLECTED, GAMEPLAY_EVENT_TILE_IMPACT, GAMEPLAY_EVENT_TIMER,
    GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE, GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
    GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE, GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND,
};
use crate::shooter_scene::ShooterPrefabKind;

#[derive(Debug, Clone, Copy)]
pub(super) struct GameplayAuthoringSnapshot {
    entity: Entity,
    health: Option<f32>,
    damage: Option<f32>,
    lifetime: Option<f32>,
    score_reward: Option<u32>,
    faction: Option<GameplayFaction>,
    tags: Option<GameplayTags>,
    pickup: Option<Pickup>,
    interaction: Option<Interaction>,
    timer_trigger: Option<GameplayTimerTrigger>,
    movement: Option<MovementPattern>,
    actions: Option<ActionBindingSet>,
    collision_reactions: Option<CollisionReactionSet>,
}

impl GameplayAuthoringSnapshot {
    fn capture(engine: &Engine, entity: Entity) -> Self {
        Self {
            entity,
            health: engine.world.health(entity),
            damage: engine.world.damage(entity),
            lifetime: engine.world.gameplay_lifetime(entity),
            score_reward: engine.world.score_reward(entity),
            faction: engine.world.gameplay_faction(entity),
            tags: engine.world.gameplay_tags(entity),
            pickup: engine.world.pickup(entity),
            interaction: engine.world.interaction(entity),
            timer_trigger: engine.world.gameplay_timer_trigger(entity),
            movement: engine.world.movement_pattern(entity),
            actions: engine.world.action_bindings(entity),
            collision_reactions: engine.world.collision_reactions(entity),
        }
    }

    fn restore(self, engine: &mut Engine) {
        engine.world.replace_health(self.entity, self.health);
        engine.world.replace_damage(self.entity, self.damage);
        engine
            .world
            .replace_gameplay_lifetime(self.entity, self.lifetime);
        engine
            .world
            .replace_score_reward(self.entity, self.score_reward);
        engine
            .world
            .replace_gameplay_faction(self.entity, self.faction);
        engine.world.replace_gameplay_tags(self.entity, self.tags);
        engine.world.replace_pickup(self.entity, self.pickup);
        engine
            .world
            .replace_interaction(self.entity, self.interaction);
        engine
            .world
            .replace_gameplay_timer_trigger(self.entity, self.timer_trigger);
        engine
            .world
            .replace_movement_pattern(self.entity, self.movement);
        engine
            .world
            .replace_action_bindings(self.entity, self.actions);
        engine
            .world
            .replace_collision_reactions(self.entity, self.collision_reactions);
    }
}

#[wasm_bindgen]
impl Engine {
    pub fn gameplay_entity_exists(&self, entity_id: u32, entity_generation: u32) -> bool {
        self.entity_from_handle(entity_id, entity_generation)
            .is_some()
    }

    pub fn capture_gameplay_authoring_snapshot(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            self.gameplay_authoring_snapshot = None;
            return false;
        };
        self.gameplay_authoring_snapshot = Some(GameplayAuthoringSnapshot::capture(self, entity));
        true
    }

    pub fn restore_gameplay_authoring_snapshot(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
    ) -> bool {
        let Some(snapshot) = self.gameplay_authoring_snapshot else {
            return false;
        };
        if snapshot.entity.id != entity_id || snapshot.entity.generation != entity_generation {
            return false;
        }
        if self
            .entity_from_handle(entity_id, entity_generation)
            .is_none()
        {
            return false;
        }
        snapshot.restore(self);
        self.clear_physics_history();
        true
    }

    pub fn clear_gameplay_authoring_snapshot(&mut self) {
        self.gameplay_authoring_snapshot = None;
    }

    pub fn set_gameplay_health(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        current: f32,
    ) -> bool {
        if !Self::valid_non_negative(current) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_health(entity, current)
    }

    pub fn clear_gameplay_health(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_health(entity)
    }

    pub fn set_gameplay_damage(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        amount: f32,
    ) -> bool {
        if !Self::valid_positive(amount) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_damage(entity, amount)
    }

    pub fn clear_gameplay_damage(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_damage(entity)
    }

    pub fn set_gameplay_damage_reaction(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        amount: f32,
        target: u32,
    ) -> bool {
        if !Self::valid_positive(amount) {
            return false;
        }
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };

        if !self
            .world
            .add_collision_reaction(entity, CollisionReaction::Damage { target })
        {
            return false;
        }

        self.world.set_damage(entity, amount)
    }

    pub fn set_gameplay_lifetime(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        seconds: f32,
    ) -> bool {
        if !Self::valid_non_negative(seconds) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_gameplay_lifetime(entity, seconds)
    }

    pub fn clear_gameplay_lifetime(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_gameplay_lifetime(entity)
    }

    pub fn set_gameplay_projectile_tile_impact(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        tile_impact_code: u32,
    ) -> bool {
        let Some(tile_impact) = ProjectileTileImpact::from_code(tile_impact_code) else {
            return false;
        };
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_projectile_tile_impact(entity, tile_impact)
    }

    pub fn set_gameplay_score_reward(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        reward: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_score_reward(entity, reward)
    }

    pub fn clear_gameplay_score_reward(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_score_reward(entity)
    }

    pub fn set_gameplay_area_damage_reaction(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        amount: f32,
        radius: f32,
        target_layer_code: u32,
    ) -> bool {
        if !Self::valid_positive(amount) || !Self::valid_positive(radius) {
            return false;
        }
        let Some(target_layer) = Self::movement_query_layer_from_code(target_layer_code) else {
            return false;
        };
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };

        if !self.world.add_collision_reaction(
            entity,
            CollisionReaction::AreaDamage {
                radius,
                target_layer,
            },
        ) {
            return false;
        }

        self.world.set_damage(entity, amount)
    }

    pub fn set_gameplay_faction(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        faction_id: u32,
        damage_mask: u32,
    ) -> bool {
        if faction_id > GAMEPLAY_FACTION_MAX_ID {
            return false;
        }
        let Some(faction) = GameplayFaction::new(faction_id, damage_mask) else {
            return false;
        };
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_gameplay_faction(entity, faction);
        true
    }

    pub fn clear_gameplay_faction(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_gameplay_faction(entity);
        true
    }

    pub fn clear_gameplay_faction_relations(&mut self) {
        self.world.clear_gameplay_faction_relations();
    }

    pub fn set_gameplay_faction_default_relation(&mut self, relation_code: u32) -> bool {
        let Some(relation) = FactionRelation::from_code(relation_code) else {
            return false;
        };
        self.world.set_gameplay_faction_default_relation(relation);
        true
    }

    pub fn set_gameplay_faction_relation(
        &mut self,
        source_faction_id: u32,
        target_faction_id: u32,
        relation_code: u32,
    ) -> bool {
        let Some(relation) = FactionRelation::from_code(relation_code) else {
            return false;
        };
        self.world
            .set_gameplay_faction_relation(source_faction_id, target_faction_id, relation)
    }

    pub fn set_gameplay_tags(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        tag_mask: u32,
    ) -> bool {
        let Some(tags) = GameplayTags::new(tag_mask) else {
            return false;
        };
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_gameplay_tags(entity, tags);
        true
    }

    pub fn clear_gameplay_tags(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_gameplay_tags(entity);
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_gameplay_action_projectile(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        cooldown_seconds: f32,
        speed: f32,
        damage: f32,
        lifetime_seconds: f32,
    ) -> bool {
        self.set_gameplay_action_projectile_with_target(
            entity_id,
            entity_generation,
            action_id,
            cooldown_seconds,
            speed,
            damage,
            lifetime_seconds,
            0,
            0,
            0,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_gameplay_action_projectile_with_target(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        cooldown_seconds: f32,
        speed: f32,
        damage: f32,
        lifetime_seconds: f32,
        aim_code: u32,
        collision_target_code: u32,
        tile_impact_code: u32,
    ) -> bool {
        let Some(aim) = ActionAimSource::from_code(aim_code) else {
            return false;
        };
        let Some(collision_target) = ProjectileCollisionTarget::from_code(collision_target_code)
        else {
            return false;
        };
        let Some(tile_impact) = ProjectileTileImpact::from_code(tile_impact_code) else {
            return false;
        };
        if action_id == 0
            || !Self::valid_non_negative(cooldown_seconds)
            || !Self::valid_positive(speed)
            || !Self::valid_positive(damage)
            || !Self::valid_positive(lifetime_seconds)
        {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.upsert_action_binding(
            entity,
            ActionBinding::projectile_with_target(
                action_id,
                cooldown_seconds,
                ProjectileActionConfig {
                    speed,
                    damage,
                    lifetime_seconds,
                    aim,
                    collision_target,
                    tile_impact,
                },
            ),
        ) {
            return false;
        }
        true
    }

    pub fn set_gameplay_action_dash(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        cooldown_seconds: f32,
        distance: f32,
    ) -> bool {
        self.set_gameplay_action_dash_with_aim(
            entity_id,
            entity_generation,
            action_id,
            cooldown_seconds,
            distance,
            0,
        )
    }

    pub fn set_gameplay_action_dash_with_aim(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        cooldown_seconds: f32,
        distance: f32,
        aim_code: u32,
    ) -> bool {
        let Some(aim) = ActionAimSource::from_code(aim_code) else {
            return false;
        };
        if action_id == 0
            || !Self::valid_non_negative(cooldown_seconds)
            || !Self::valid_positive(distance)
        {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.upsert_action_binding(
            entity,
            ActionBinding::dash_with_aim(action_id, cooldown_seconds, distance, aim),
        ) {
            return false;
        }
        true
    }

    pub fn set_gameplay_action_melee(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        cooldown_seconds: f32,
        range: f32,
        damage: f32,
    ) -> bool {
        if action_id == 0
            || !Self::valid_non_negative(cooldown_seconds)
            || !Self::valid_positive(range)
            || !Self::valid_positive(damage)
        {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.upsert_action_binding(
            entity,
            ActionBinding::melee(action_id, cooldown_seconds, range, damage),
        ) {
            return false;
        }
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_gameplay_action_melee_with_target(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        cooldown_seconds: f32,
        range: f32,
        damage: f32,
        target_code: u32,
    ) -> bool {
        let Some(target) = MeleeTarget::from_code(target_code) else {
            return false;
        };
        if action_id == 0
            || !Self::valid_non_negative(cooldown_seconds)
            || !Self::valid_positive(range)
            || !Self::valid_positive(damage)
        {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.upsert_action_binding(
            entity,
            ActionBinding::melee_with_target(action_id, cooldown_seconds, range, damage, target),
        ) {
            return false;
        }
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_gameplay_action_spawn_prefab(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        cooldown_seconds: f32,
        prefab_id: u32,
        anchor_code: u32,
        phase_code: u32,
        offset_x: f32,
        offset_y: f32,
    ) -> bool {
        let Some(anchor) = SpawnAnchor::from_code(anchor_code) else {
            return false;
        };
        let Some(phase) = SpawnPhase::from_code(phase_code) else {
            return false;
        };
        if action_id == 0
            || prefab_id == 0
            || !self.scenes.shooter().supports_spawn_prefab_id(prefab_id)
            || !Self::valid_non_negative(cooldown_seconds)
            || !offset_x.is_finite()
            || !offset_y.is_finite()
        {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.upsert_action_binding(
            entity,
            ActionBinding::spawn_prefab(
                action_id,
                cooldown_seconds,
                prefab_id,
                anchor,
                phase,
                offset_x,
                offset_y,
            ),
        ) {
            return false;
        }
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_gameplay_action_spawn_projectile_prefab(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        cooldown_seconds: f32,
        prefab_id: u32,
        anchor_code: u32,
        phase_code: u32,
        offset_x: f32,
        offset_y: f32,
        speed: f32,
        damage: f32,
        lifetime_seconds: f32,
        aim_code: u32,
        collision_target_code: u32,
        tile_impact_code: u32,
    ) -> bool {
        let Some(anchor) = SpawnAnchor::from_code(anchor_code) else {
            return false;
        };
        let Some(phase) = SpawnPhase::from_code(phase_code) else {
            return false;
        };
        let Some(aim) = ActionAimSource::from_code(aim_code) else {
            return false;
        };
        let Some(collision_target) = ProjectileCollisionTarget::from_code(collision_target_code)
        else {
            return false;
        };
        let Some(tile_impact) = ProjectileTileImpact::from_code(tile_impact_code) else {
            return false;
        };
        if !self
            .scenes
            .shooter()
            .supports_projectile_prefab_id(prefab_id)
            || action_id == 0
            || prefab_id == 0
            || !Self::valid_non_negative(cooldown_seconds)
            || !Self::valid_positive(speed)
            || !Self::valid_positive(damage)
            || !Self::valid_positive(lifetime_seconds)
            || !offset_x.is_finite()
            || !offset_y.is_finite()
        {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.upsert_action_binding(
            entity,
            ActionBinding {
                action_id,
                pattern: ActionPattern::SpawnPrefab {
                    prefab_id,
                    projectile: Some(SpawnPrefabProjectilePayload {
                        speed,
                        damage,
                        lifetime_seconds,
                        aim,
                        collision_target,
                        tile_impact,
                    }),
                    anchor,
                    phase,
                    offset_x,
                    offset_y,
                },
                cooldown: Cooldown::ready(cooldown_seconds),
            },
        ) {
            return false;
        }
        true
    }

    pub fn register_gameplay_enemy_prefab(&mut self, prefab_id: u32) -> bool {
        if !self
            .scenes
            .shooter_mut()
            .register_spawn_prefab_kind(prefab_id, ShooterPrefabKind::Enemy)
        {
            return false;
        }
        true
    }

    pub fn register_gameplay_bullet_prefab(&mut self, prefab_id: u32) -> bool {
        if !self
            .scenes
            .shooter_mut()
            .register_spawn_prefab_kind(prefab_id, ShooterPrefabKind::Bullet)
        {
            return false;
        }
        true
    }

    pub fn clear_gameplay_actions(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_action_bindings(entity);
        true
    }

    pub fn set_gameplay_pickup(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        item_id: u32,
        count: u32,
        despawn_on_collect: bool,
    ) -> bool {
        if item_id != GAMEPLAY_PICKUP_ITEM_SCORE || count == 0 || !despawn_on_collect {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self
            .world
            .set_pickup(entity, Pickup::new(item_id, count, despawn_on_collect))
        {
            return false;
        }
        true
    }

    pub fn clear_gameplay_pickup(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_pickup(entity);
        true
    }

    pub fn set_gameplay_interaction(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        radius: f32,
        once: bool,
    ) -> bool {
        if action_id == 0 || !Self::valid_positive(radius) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self
            .world
            .set_interaction(entity, Interaction::new(action_id, radius, once))
        {
            return false;
        }
        true
    }

    pub fn clear_gameplay_interaction(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_interaction(entity);
        true
    }

    pub fn set_gameplay_timer_trigger(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        timer_id: u32,
        duration_seconds: f32,
    ) -> bool {
        if timer_id == 0 || !Self::valid_positive(duration_seconds) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.set_gameplay_timer_trigger(
            entity,
            GameplayTimerTrigger::new(timer_id, duration_seconds),
        ) {
            return false;
        }
        true
    }

    pub fn set_gameplay_timer_action_trigger(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        timer_id: u32,
        duration_seconds: f32,
        action_id: u32,
    ) -> bool {
        if timer_id == 0 || action_id == 0 || !Self::valid_positive(duration_seconds) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.set_gameplay_timer_trigger(
            entity,
            GameplayTimerTrigger::with_action(timer_id, duration_seconds, action_id),
        ) {
            return false;
        }
        true
    }

    pub fn clear_gameplay_timer_trigger(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_gameplay_timer_trigger(entity);
        true
    }

    pub fn set_gameplay_movement_static(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        self.set_gameplay_movement_pattern(entity_id, entity_generation, MovementPattern::Static)
    }

    pub fn set_gameplay_movement_topdown_input(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
    ) -> bool {
        if !Self::valid_positive(speed) {
            return false;
        }
        self.set_gameplay_movement_pattern(
            entity_id,
            entity_generation,
            MovementPattern::TopdownInput { speed },
        )
    }

    pub fn set_gameplay_movement_linear(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        vx: f32,
        vy: f32,
    ) -> bool {
        if !vx.is_finite() || !vy.is_finite() {
            return false;
        }
        self.set_gameplay_movement_pattern(
            entity_id,
            entity_generation,
            MovementPattern::Linear { vx, vy },
        )
    }

    pub fn set_gameplay_movement_to_point(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        x: f32,
        y: f32,
        speed: f32,
    ) -> bool {
        if !x.is_finite() || !y.is_finite() || !Self::valid_positive(speed) {
            return false;
        }
        self.set_gameplay_movement_pattern(
            entity_id,
            entity_generation,
            MovementPattern::MoveToPoint { x, y, speed },
        )
    }

    pub fn set_gameplay_movement_chase_player(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
    ) -> bool {
        self.set_gameplay_movement_chase_primary_actor(entity_id, entity_generation, speed)
    }

    pub fn set_gameplay_movement_chase_primary_actor(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
    ) -> bool {
        self.set_gameplay_movement_chase_target(
            entity_id,
            entity_generation,
            MovementTarget::PrimaryActor,
            speed,
        )
    }

    pub fn set_gameplay_movement_chase_nearest_player(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
    ) -> bool {
        self.set_gameplay_movement_chase_nearest_primary_actor(entity_id, entity_generation, speed)
    }

    pub fn set_gameplay_movement_chase_nearest_primary_actor(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
    ) -> bool {
        self.set_gameplay_movement_chase_target(
            entity_id,
            entity_generation,
            MovementTarget::NearestPrimaryActor,
            speed,
        )
    }

    pub fn set_gameplay_movement_chase_nearest_enemy(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
    ) -> bool {
        self.set_gameplay_movement_chase_target(
            entity_id,
            entity_generation,
            MovementTarget::NearestEnemy,
            speed,
        )
    }

    pub fn set_gameplay_movement_chase_nearest_layer(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        layer_code: u32,
        speed: f32,
    ) -> bool {
        let Some(layer) = Self::movement_query_layer_from_code(layer_code) else {
            return false;
        };
        self.set_gameplay_movement_chase_target(
            entity_id,
            entity_generation,
            MovementTarget::NearestLayer(layer),
            speed,
        )
    }

    pub fn set_gameplay_movement_chase_nearest_faction(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        faction_id: u32,
        speed: f32,
    ) -> bool {
        if faction_id > GAMEPLAY_FACTION_MAX_ID {
            return false;
        }
        self.set_gameplay_movement_chase_target(
            entity_id,
            entity_generation,
            MovementTarget::NearestFaction(faction_id),
            speed,
        )
    }

    pub fn set_gameplay_movement_chase_nearest_tag(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        tag_id: u32,
        speed: f32,
    ) -> bool {
        if tag_id > GAMEPLAY_TAG_MAX_ID {
            return false;
        }
        self.set_gameplay_movement_chase_target(
            entity_id,
            entity_generation,
            MovementTarget::NearestTag(tag_id),
            speed,
        )
    }

    pub fn set_gameplay_movement_chase_entity(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target_id: u32,
        target_generation: u32,
        speed: f32,
    ) -> bool {
        let Some(target) = self.entity_from_handle(target_id, target_generation) else {
            return false;
        };
        self.set_gameplay_movement_chase_target(
            entity_id,
            entity_generation,
            MovementTarget::Entity(target),
            speed,
        )
    }

    pub fn set_gameplay_movement_orbit_player(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
        radius: f32,
        radial_band: f32,
    ) -> bool {
        self.set_gameplay_movement_orbit_primary_actor(
            entity_id,
            entity_generation,
            speed,
            radius,
            radial_band,
        )
    }

    pub fn set_gameplay_movement_orbit_primary_actor(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
        radius: f32,
        radial_band: f32,
    ) -> bool {
        self.set_gameplay_movement_orbit_target(
            entity_id,
            entity_generation,
            MovementTarget::PrimaryActor,
            speed,
            radius,
            radial_band,
        )
    }

    pub fn set_gameplay_movement_seek_target_player(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
        turn_rate: f32,
    ) -> bool {
        self.set_gameplay_movement_seek_target_primary_actor(
            entity_id,
            entity_generation,
            speed,
            turn_rate,
        )
    }

    pub fn set_gameplay_movement_seek_target_primary_actor(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
        turn_rate: f32,
    ) -> bool {
        self.set_gameplay_movement_seek_target(
            entity_id,
            entity_generation,
            MovementTarget::PrimaryActor,
            speed,
            turn_rate,
        )
    }

    pub fn set_gameplay_movement_seek_target_nearest_player(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
        turn_rate: f32,
    ) -> bool {
        self.set_gameplay_movement_seek_target_nearest_primary_actor(
            entity_id,
            entity_generation,
            speed,
            turn_rate,
        )
    }

    pub fn set_gameplay_movement_seek_target_nearest_primary_actor(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
        turn_rate: f32,
    ) -> bool {
        self.set_gameplay_movement_seek_target(
            entity_id,
            entity_generation,
            MovementTarget::NearestPrimaryActor,
            speed,
            turn_rate,
        )
    }

    pub fn set_gameplay_movement_seek_target_nearest_enemy(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        speed: f32,
        turn_rate: f32,
    ) -> bool {
        self.set_gameplay_movement_seek_target(
            entity_id,
            entity_generation,
            MovementTarget::NearestEnemy,
            speed,
            turn_rate,
        )
    }

    pub fn set_gameplay_movement_seek_target_nearest_layer(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        layer_code: u32,
        speed: f32,
        turn_rate: f32,
    ) -> bool {
        let Some(layer) = Self::movement_query_layer_from_code(layer_code) else {
            return false;
        };
        self.set_gameplay_movement_seek_target(
            entity_id,
            entity_generation,
            MovementTarget::NearestLayer(layer),
            speed,
            turn_rate,
        )
    }

    pub fn set_gameplay_movement_seek_target_nearest_faction(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        faction_id: u32,
        speed: f32,
        turn_rate: f32,
    ) -> bool {
        if faction_id > GAMEPLAY_FACTION_MAX_ID {
            return false;
        }
        self.set_gameplay_movement_seek_target(
            entity_id,
            entity_generation,
            MovementTarget::NearestFaction(faction_id),
            speed,
            turn_rate,
        )
    }

    pub fn set_gameplay_movement_seek_target_nearest_tag(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        tag_id: u32,
        speed: f32,
        turn_rate: f32,
    ) -> bool {
        if tag_id > GAMEPLAY_TAG_MAX_ID {
            return false;
        }
        self.set_gameplay_movement_seek_target(
            entity_id,
            entity_generation,
            MovementTarget::NearestTag(tag_id),
            speed,
            turn_rate,
        )
    }

    pub fn set_gameplay_movement_seek_target_entity(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target_id: u32,
        target_generation: u32,
        speed: f32,
        turn_rate: f32,
    ) -> bool {
        let Some(target) = self.entity_from_handle(target_id, target_generation) else {
            return false;
        };
        self.set_gameplay_movement_seek_target(
            entity_id,
            entity_generation,
            MovementTarget::Entity(target),
            speed,
            turn_rate,
        )
    }

    pub fn set_gameplay_movement_accelerate(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        acceleration_x: f32,
        acceleration_y: f32,
        max_speed: f32,
    ) -> bool {
        if !acceleration_x.is_finite()
            || !acceleration_y.is_finite()
            || !Self::valid_positive(max_speed)
            || (acceleration_x == 0.0 && acceleration_y == 0.0)
        {
            return false;
        }
        self.set_gameplay_movement_pattern(
            entity_id,
            entity_generation,
            MovementPattern::Accelerate {
                acceleration_x,
                acceleration_y,
                max_speed,
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_gameplay_movement_orbit_entity(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target_id: u32,
        target_generation: u32,
        speed: f32,
        radius: f32,
        radial_band: f32,
    ) -> bool {
        let Some(target) = self.entity_from_handle(target_id, target_generation) else {
            return false;
        };
        self.set_gameplay_movement_orbit_target(
            entity_id,
            entity_generation,
            MovementTarget::Entity(target),
            speed,
            radius,
            radial_band,
        )
    }

    pub fn clear_gameplay_movement(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_movement_pattern(entity);
        true
    }

    pub fn clear_gameplay_collision_reactions(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_collision_reactions(entity);
        true
    }

    pub fn add_gameplay_collision_damage(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target: u32,
    ) -> bool {
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        self.add_gameplay_collision_reaction(
            entity_id,
            entity_generation,
            CollisionReaction::Damage { target },
        )
    }

    pub fn add_gameplay_collision_area_damage(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        radius: f32,
        target_layer_code: u32,
    ) -> bool {
        if !Self::valid_positive(radius) {
            return false;
        }
        let Some(target_layer) = Self::movement_query_layer_from_code(target_layer_code) else {
            return false;
        };
        self.add_gameplay_collision_reaction(
            entity_id,
            entity_generation,
            CollisionReaction::AreaDamage {
                radius,
                target_layer,
            },
        )
    }

    pub fn add_gameplay_collision_knockback(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target: u32,
        impulse: f32,
    ) -> bool {
        if !Self::valid_positive(impulse) {
            return false;
        }
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        self.add_gameplay_collision_reaction(
            entity_id,
            entity_generation,
            CollisionReaction::Knockback { target, impulse },
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_emit_effect(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        effect_id: u32,
        effect_type: u32,
        target: u32,
        cooldown_seconds: f32,
        trigger_code: u32,
    ) -> bool {
        self.add_gameplay_collision_emit_effect_with_payload(
            entity_id,
            entity_generation,
            effect_id,
            effect_type,
            target,
            cooldown_seconds,
            trigger_code,
            1.0,
            0.0,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_emit_effect_with_payload(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        effect_id: u32,
        effect_type: u32,
        target: u32,
        cooldown_seconds: f32,
        trigger_code: u32,
        intensity: f32,
        radius: f32,
    ) -> bool {
        if !Self::valid_non_negative(cooldown_seconds)
            || !valid_presentation_effect_type(effect_type)
            || !Self::valid_non_negative(intensity)
            || !Self::valid_non_negative(radius)
        {
            return false;
        }
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        let Some(trigger) = collision_reaction_trigger_from_code(trigger_code) else {
            return false;
        };
        self.add_gameplay_collision_reaction(
            entity_id,
            entity_generation,
            CollisionReaction::EmitEffect {
                effect_id,
                effect_type,
                target,
                intensity,
                radius,
                cooldown: Cooldown::ready(cooldown_seconds),
                trigger,
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_spawn_prefab(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        prefab_id: u32,
        target: u32,
        cooldown_seconds: f32,
        trigger_code: u32,
        offset_x: f32,
        offset_y: f32,
    ) -> bool {
        if action_id == 0
            || prefab_id == 0
            || !self.scenes.shooter().supports_spawn_prefab_id(prefab_id)
            || !Self::valid_non_negative(cooldown_seconds)
            || !offset_x.is_finite()
            || !offset_y.is_finite()
        {
            return false;
        }
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        let Some(trigger) = collision_reaction_trigger_from_code(trigger_code) else {
            return false;
        };
        self.add_gameplay_collision_reaction(
            entity_id,
            entity_generation,
            CollisionReaction::SpawnPrefab {
                action_id,
                prefab_id,
                target,
                cooldown: Cooldown::ready(cooldown_seconds),
                trigger,
                offset_x,
                offset_y,
            },
        )
    }

    pub fn add_gameplay_collision_despawn(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target: u32,
    ) -> bool {
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        self.add_gameplay_collision_reaction(
            entity_id,
            entity_generation,
            CollisionReaction::Despawn { target },
        )
    }

    pub fn add_gameplay_collision_pickup(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target: u32,
    ) -> bool {
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        self.add_gameplay_collision_reaction(
            entity_id,
            entity_generation,
            CollisionReaction::Pickup { target },
        )
    }

    pub fn add_gameplay_collision_sound(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        sound_id: u32,
        volume: f32,
        pitch: f32,
    ) -> bool {
        self.add_gameplay_collision_sound_with_cooldown(
            entity_id,
            entity_generation,
            sound_id,
            volume,
            pitch,
            0.0,
        )
    }

    pub fn add_gameplay_collision_sound_with_cooldown(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        sound_id: u32,
        volume: f32,
        pitch: f32,
        cooldown_seconds: f32,
    ) -> bool {
        self.add_gameplay_collision_sound_with_policy(
            entity_id,
            entity_generation,
            sound_id,
            volume,
            pitch,
            cooldown_seconds,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_sound_with_policy(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        sound_id: u32,
        volume: f32,
        pitch: f32,
        cooldown_seconds: f32,
        replace_default: bool,
    ) -> bool {
        self.add_gameplay_collision_sound_with_trigger(
            entity_id,
            entity_generation,
            sound_id,
            volume,
            pitch,
            cooldown_seconds,
            replace_default,
            0,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_sound_with_trigger(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        sound_id: u32,
        volume: f32,
        pitch: f32,
        cooldown_seconds: f32,
        replace_default: bool,
        trigger: u32,
    ) -> bool {
        if sound_id == 0
            || !Self::valid_non_negative(volume)
            || !Self::valid_positive(pitch)
            || !Self::valid_non_negative(cooldown_seconds)
        {
            return false;
        }
        let Some(trigger) = collision_reaction_trigger_from_code(trigger) else {
            return false;
        };
        self.add_gameplay_collision_reaction(
            entity_id,
            entity_generation,
            CollisionReaction::PlaySound {
                sound_id,
                volume,
                pitch,
                cooldown: Cooldown::ready(cooldown_seconds),
                replace_default,
                trigger,
            },
        )
    }

    pub fn add_gameplay_collision_camera_shake(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
    ) -> bool {
        self.add_gameplay_collision_camera_shake_with_cooldown(entity_id, entity_generation, 0.0)
    }

    pub fn add_gameplay_collision_camera_shake_with_cooldown(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        cooldown_seconds: f32,
    ) -> bool {
        self.add_gameplay_collision_camera_shake_with_trigger(
            entity_id,
            entity_generation,
            cooldown_seconds,
            0,
        )
    }

    pub fn add_gameplay_collision_camera_shake_with_trigger(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        cooldown_seconds: f32,
        trigger_code: u32,
    ) -> bool {
        if !Self::valid_non_negative(cooldown_seconds) {
            return false;
        }
        let Some(trigger) = collision_reaction_trigger_from_code(trigger_code) else {
            return false;
        };
        self.add_gameplay_collision_reaction(
            entity_id,
            entity_generation,
            CollisionReaction::CameraShake {
                cooldown: Cooldown::ready(cooldown_seconds),
                trigger,
            },
        )
    }

    pub fn add_gameplay_collision_particle(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        preset_id: u32,
        target: u32,
    ) -> bool {
        self.add_gameplay_collision_particle_with_cooldown(
            entity_id,
            entity_generation,
            preset_id,
            target,
            0.0,
        )
    }

    pub fn add_gameplay_collision_particle_with_cooldown(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        preset_id: u32,
        target: u32,
        cooldown_seconds: f32,
    ) -> bool {
        self.add_gameplay_collision_particle_with_policy(
            entity_id,
            entity_generation,
            preset_id,
            target,
            cooldown_seconds,
            false,
        )
    }

    pub fn add_gameplay_collision_particle_with_policy(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        preset_id: u32,
        target: u32,
        cooldown_seconds: f32,
        replace_default: bool,
    ) -> bool {
        self.add_gameplay_collision_particle_with_trigger(
            entity_id,
            entity_generation,
            preset_id,
            target,
            cooldown_seconds,
            replace_default,
            0,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_particle_with_trigger(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        preset_id: u32,
        target: u32,
        cooldown_seconds: f32,
        replace_default: bool,
        trigger: u32,
    ) -> bool {
        if preset_id as usize >= MAX_PARTICLE_PRESETS {
            return false;
        }
        if !Self::valid_non_negative(cooldown_seconds) {
            return false;
        }
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        let Some(trigger) = collision_reaction_trigger_from_code(trigger) else {
            return false;
        };
        self.add_gameplay_collision_reaction(
            entity_id,
            entity_generation,
            CollisionReaction::SpawnParticle {
                preset_id,
                target,
                cooldown: Cooldown::ready(cooldown_seconds),
                replace_default,
                trigger,
            },
        )
    }

    pub fn set_gameplay_behavior_state_machine(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        initial_state: u32,
    ) -> bool {
        if initial_state == 0 {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self
            .world
            .set_behavior_state_machine(entity, BehaviorStateMachine::new(initial_state))
        {
            return false;
        }
        true
    }

    pub fn add_gameplay_behavior_transition(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        from_state: u32,
        to_state: u32,
        action_id: u32,
    ) -> bool {
        self.add_gameplay_behavior_event_transition(
            entity_id,
            entity_generation,
            from_state,
            to_state,
            GAMEPLAY_EVENT_INTERACTION,
            action_id,
        )
    }

    pub fn add_gameplay_behavior_event_transition(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        from_state: u32,
        to_state: u32,
        event_kind: u32,
        token_id: u32,
    ) -> bool {
        if from_state == 0
            || to_state == 0
            || !valid_behavior_transition_event(event_kind, token_id)
        {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.add_behavior_state_transition(
            entity,
            BehaviorStateTransition::new_event(from_state, to_state, event_kind, token_id),
        ) {
            return false;
        }
        true
    }

    pub fn clear_gameplay_behavior_state_machine(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_behavior_state_machine(entity);
        true
    }

    pub fn gameplay_behavior_state(&self, entity_id: u32, entity_generation: u32) -> u32 {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return 0;
        };
        self.world
            .behavior_state_machine(entity)
            .map(|machine| machine.current_state())
            .unwrap_or(0)
    }

    pub fn add_gameplay_behavior_state_enter_action(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        state: u32,
        action_id: u32,
        phase: u32,
    ) -> bool {
        if state == 0 || action_id == 0 {
            return false;
        }
        let Some(phase) = BehaviorStateEnterActionPhase::from_code(phase) else {
            return false;
        };
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.add_behavior_state_enter_action(
            entity,
            BehaviorStateEnterAction::new(state, action_id, phase),
        ) {
            return false;
        }
        true
    }

    pub fn clear_gameplay_behavior_state_enter_actions(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_behavior_state_enter_actions(entity);
        true
    }
}

impl Engine {
    fn set_gameplay_movement_chase_target(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target: MovementTarget,
        speed: f32,
    ) -> bool {
        if !Self::valid_positive(speed) {
            return false;
        }
        self.set_gameplay_movement_pattern(
            entity_id,
            entity_generation,
            MovementPattern::Chase { target, speed },
        )
    }

    fn set_gameplay_movement_orbit_target(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target: MovementTarget,
        speed: f32,
        radius: f32,
        radial_band: f32,
    ) -> bool {
        if !Self::valid_positive(speed)
            || !Self::valid_positive(radius)
            || !Self::valid_non_negative(radial_band)
        {
            return false;
        }
        self.set_gameplay_movement_pattern(
            entity_id,
            entity_generation,
            MovementPattern::Orbit {
                target,
                speed,
                radius,
                radial_band,
            },
        )
    }

    fn set_gameplay_movement_seek_target(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target: MovementTarget,
        speed: f32,
        turn_rate: f32,
    ) -> bool {
        if !Self::valid_positive(speed) || !turn_rate.is_finite() || turn_rate < 0.0 {
            return false;
        }
        self.set_gameplay_movement_pattern(
            entity_id,
            entity_generation,
            MovementPattern::SeekTarget {
                target,
                speed,
                turn_rate,
            },
        )
    }

    const fn movement_query_layer_from_code(code: u32) -> Option<CollisionLayer> {
        match code {
            PHYSICS_LAYER_PLAYER => Some(CollisionLayer::Player),
            PHYSICS_LAYER_ENEMY => Some(CollisionLayer::Enemy),
            PHYSICS_LAYER_BULLET => Some(CollisionLayer::Bullet),
            PHYSICS_LAYER_WALL => Some(CollisionLayer::Wall),
            PHYSICS_LAYER_PICKUP => Some(CollisionLayer::Pickup),
            _ => None,
        }
    }

    fn set_gameplay_movement_pattern(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        movement: MovementPattern,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_movement_pattern(entity, movement);
        true
    }

    fn add_gameplay_collision_reaction(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        reaction: CollisionReaction,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if !self.world.add_collision_reaction(entity, reaction) {
            return false;
        }
        true
    }
}

fn collision_target_from_code(code: u32) -> Option<CollisionTarget> {
    match code {
        0 => Some(CollisionTarget::SelfEntity),
        1 => Some(CollisionTarget::OtherEntity),
        _ => None,
    }
}

fn collision_reaction_trigger_from_code(code: u32) -> Option<CollisionReactionTrigger> {
    match code {
        0 => Some(CollisionReactionTrigger::Contact),
        1 => Some(CollisionReactionTrigger::Enter),
        _ => None,
    }
}

const fn valid_presentation_effect_type(effect_type: u32) -> bool {
    matches!(
        effect_type,
        GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND
            | GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE
            | GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE
            | GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM
    )
}

fn valid_behavior_transition_event(event_kind: u32, token_id: u32) -> bool {
    match event_kind {
        GAMEPLAY_EVENT_INTERACTION => token_id != 0,
        GAMEPLAY_EVENT_COLLISION_DAMAGE | GAMEPLAY_EVENT_COLLISION_DESPAWN => token_id == 0,
        GAMEPLAY_EVENT_PICKUP_COLLECTED => token_id != 0,
        GAMEPLAY_EVENT_TILE_IMPACT => matches!(
            ProjectileTileImpact::from_code(token_id),
            Some(ProjectileTileImpact::Despawn | ProjectileTileImpact::Bounce)
        ),
        GAMEPLAY_EVENT_TIMER => token_id != 0,
        _ => false,
    }
}
