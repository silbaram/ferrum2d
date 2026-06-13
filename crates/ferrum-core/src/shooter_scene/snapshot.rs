use crate::audio_event::AudioEvent;
use crate::camera::Camera2D;
use crate::components::gameplay::{
    ActionAimSource, ActionBinding, ActionPattern, Cooldown, GameplayFaction,
    ProjectileCollisionTarget, ProjectileTileImpact, SpawnAnchor, SpawnPhase,
    SpawnPrefabProjectilePayload, GAMEPLAY_FACTION_MAX_ID,
    GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S, MAX_ACTION_BINDINGS_PER_ENTITY,
};
use crate::components::{CollisionLayer, Transform2D, Velocity};
use crate::game_state::GameState;
use crate::input::InputState;
use crate::world::{ProjectileSpawnRequest, World};

use super::config::SHOOTER_PREFAB_REGISTRY_SNAPSHOT_U32S;
use super::{finite_or_default, non_negative_or_default, positive_or_default, ShooterScene};
use super::{
    SHOOTER_DASH_ACTION_ID, SHOOTER_MELEE_ACTION_ID, SHOOTER_PRIMARY_FIRE_ACTION_ID,
    SHOOTER_SNAPSHOT_ENTITY_BULLET, SHOOTER_SNAPSHOT_ENTITY_ENEMY, SHOOTER_SNAPSHOT_ENTITY_FLOATS,
    SHOOTER_SNAPSHOT_ENTITY_PLAYER, SHOOTER_SNAPSHOT_ENTITY_U32S, SHOOTER_SNAPSHOT_HEADER_FLOATS,
    SHOOTER_SNAPSHOT_HEADER_U32S, SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET,
    SHOOTER_SNAPSHOT_VERSION,
};

const SNAPSHOT_ACTION_COOLDOWN_DURATION: usize = 7;
const SNAPSHOT_ACTION_COOLDOWN_REMAINING: usize = 8;
const SNAPSHOT_ACTION_PROJECTILE_SPEED: usize = 9;
const SNAPSHOT_ACTION_PROJECTILE_DAMAGE: usize = 10;
const SNAPSHOT_ACTION_PROJECTILE_LIFETIME: usize = 11;
const SNAPSHOT_ACTION_ID: usize = 2;
const SNAPSHOT_PROJECTILE_POLICY: usize = 1;
const SNAPSHOT_PROJECTILE_TILE_IMPACT_SHIFT: u32 = 8;
const SNAPSHOT_BULLET_FACTION_ID_PLUS_ONE: usize = 6;
const SNAPSHOT_BULLET_FACTION_DAMAGE_MASK: usize = 7;
const SNAPSHOT_DASH_COOLDOWN_DURATION: usize = 12;
const SNAPSHOT_DASH_COOLDOWN_REMAINING: usize = 13;
const SNAPSHOT_DASH_DISTANCE: usize = 14;
const SNAPSHOT_DASH_ACTION_ID: usize = 3;
const SNAPSHOT_MELEE_COOLDOWN_DURATION: usize = 15;
const SNAPSHOT_MELEE_COOLDOWN_REMAINING: usize = 16;
const SNAPSHOT_MELEE_RANGE: usize = 17;
const SNAPSHOT_MELEE_DAMAGE: usize = 18;
const SNAPSHOT_MELEE_ACTION_ID: usize = 4;
const SNAPSHOT_SPAWN_PREFAB_BINDINGS: usize = MAX_ACTION_BINDINGS_PER_ENTITY;
const SNAPSHOT_SPAWN_PREFAB_FLOAT_BASE: usize = 19;
const SNAPSHOT_SPAWN_PREFAB_FLOAT_STRIDE: usize = 7;
const SNAPSHOT_SPAWN_PREFAB_COOLDOWN_DURATION_FIELD: usize = 0;
const SNAPSHOT_SPAWN_PREFAB_COOLDOWN_REMAINING_FIELD: usize = 1;
const SNAPSHOT_SPAWN_PREFAB_OFFSET_X_FIELD: usize = 2;
const SNAPSHOT_SPAWN_PREFAB_OFFSET_Y_FIELD: usize = 3;
const SNAPSHOT_SPAWN_PREFAB_PROJECTILE_SPEED_FIELD: usize = 4;
const SNAPSHOT_SPAWN_PREFAB_PROJECTILE_DAMAGE_FIELD: usize = 5;
const SNAPSHOT_SPAWN_PREFAB_PROJECTILE_LIFETIME_FIELD: usize = 6;
const SNAPSHOT_SPAWN_PREFAB_U32_BASE: usize = 5;
const SNAPSHOT_SPAWN_PREFAB_U32_STRIDE: usize = 7;
const SNAPSHOT_SPAWN_PREFAB_ACTION_ID_FIELD: usize = 0;
const SNAPSHOT_SPAWN_PREFAB_ID_FIELD: usize = 1;
const SNAPSHOT_SPAWN_PREFAB_ANCHOR_FIELD: usize = 2;
const SNAPSHOT_SPAWN_PREFAB_PHASE_FIELD: usize = 3;
const SNAPSHOT_SPAWN_PREFAB_PROJECTILE_FLAG_FIELD: usize = 4;
const SNAPSHOT_SPAWN_PREFAB_PROJECTILE_AIM_FIELD: usize = 5;
const SNAPSHOT_SPAWN_PREFAB_PROJECTILE_POLICY_FIELD: usize = 6;
const SNAPSHOT_PREVIOUS_INPUT_MOUSE_X: usize = 6;
const SNAPSHOT_PREVIOUS_INPUT_MOUSE_Y: usize = 7;
const SNAPSHOT_PREVIOUS_INPUT_SPACE: usize = 6;
const SNAPSHOT_PREVIOUS_INPUT_ENTER: usize = 7;
const SNAPSHOT_PREVIOUS_INPUT_MOUSE_LEFT: usize = 8;
const SNAPSHOT_PREVIOUS_INPUT_W: usize = SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
    + crate::input::INPUT_ACTION_REGISTRY_SNAPSHOT_U32S;
const SNAPSHOT_PREVIOUS_INPUT_A: usize = SNAPSHOT_PREVIOUS_INPUT_W + 1;
const SNAPSHOT_PREVIOUS_INPUT_S: usize = SNAPSHOT_PREVIOUS_INPUT_W + 2;
const SNAPSHOT_PREVIOUS_INPUT_D: usize = SNAPSHOT_PREVIOUS_INPUT_W + 3;
const SNAPSHOT_PREFAB_REGISTRY_U32_OFFSET: usize = SNAPSHOT_PREVIOUS_INPUT_D + 1;
const SNAPSHOT_FACTION_RELATION_TABLE_U32_OFFSET: usize =
    SNAPSHOT_PREFAB_REGISTRY_U32_OFFSET + SHOOTER_PREFAB_REGISTRY_SNAPSHOT_U32S;

#[derive(Clone, Debug, PartialEq)]
pub struct ShooterSceneSnapshot {
    pub header_floats: [f32; SHOOTER_SNAPSHOT_HEADER_FLOATS],
    pub header_u32s: [u32; SHOOTER_SNAPSHOT_HEADER_U32S],
    pub entities: Vec<ShooterEntitySnapshot>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShooterEntitySnapshot {
    pub floats: [f32; SHOOTER_SNAPSHOT_ENTITY_FLOATS],
    pub u32s: [u32; SHOOTER_SNAPSHOT_ENTITY_U32S],
}

fn game_state_code(game_state: GameState) -> u32 {
    match game_state {
        GameState::Title => 0,
        GameState::Playing => 1,
        GameState::GameOver => 2,
    }
}

fn game_state_from_code(code: u32) -> Option<GameState> {
    match code {
        0 => Some(GameState::Title),
        1 => Some(GameState::Playing),
        2 => Some(GameState::GameOver),
        _ => None,
    }
}

fn shooter_snapshot_entity_kind(layer: Option<CollisionLayer>) -> Option<u32> {
    match layer? {
        CollisionLayer::Player => Some(SHOOTER_SNAPSHOT_ENTITY_PLAYER),
        CollisionLayer::Enemy => Some(SHOOTER_SNAPSHOT_ENTITY_ENEMY),
        CollisionLayer::Bullet => Some(SHOOTER_SNAPSHOT_ENTITY_BULLET),
        CollisionLayer::Wall | CollisionLayer::Pickup => None,
    }
}

fn valid_shooter_snapshot_entity(entity: ShooterEntitySnapshot) -> bool {
    matches!(
        entity.u32s[0],
        SHOOTER_SNAPSHOT_ENTITY_PLAYER
            | SHOOTER_SNAPSHOT_ENTITY_ENEMY
            | SHOOTER_SNAPSHOT_ENTITY_BULLET
    ) && entity.floats.iter().all(|value| value.is_finite())
        && valid_snapshot_projectile_policy(entity)
        && valid_snapshot_bullet_faction(entity)
        && valid_snapshot_primary_action_binding(entity)
        && valid_snapshot_dash_action_binding(entity)
        && valid_snapshot_melee_action_binding(entity)
        && valid_snapshot_spawn_prefab_action_binding(entity)
        && valid_snapshot_action_binding_ids(entity)
}

fn valid_snapshot_bullet_faction(entity: ShooterEntitySnapshot) -> bool {
    if entity.u32s[0] != SHOOTER_SNAPSHOT_ENTITY_BULLET {
        return true;
    }
    let faction_id_plus_one = entity.u32s[SNAPSHOT_BULLET_FACTION_ID_PLUS_ONE];
    let damage_mask = entity.u32s[SNAPSHOT_BULLET_FACTION_DAMAGE_MASK];
    if faction_id_plus_one == 0 {
        return damage_mask == 0;
    }
    let faction_id = faction_id_plus_one - 1;
    faction_id <= GAMEPLAY_FACTION_MAX_ID
}

fn pack_projectile_policy(
    collision_target: ProjectileCollisionTarget,
    tile_impact: ProjectileTileImpact,
) -> u32 {
    collision_target.code() | (tile_impact.code() << SNAPSHOT_PROJECTILE_TILE_IMPACT_SHIFT)
}

fn unpack_projectile_collision_target(policy: u32) -> Option<ProjectileCollisionTarget> {
    ProjectileCollisionTarget::from_code(policy & 0xff)
}

fn unpack_projectile_tile_impact(policy: u32) -> Option<ProjectileTileImpact> {
    ProjectileTileImpact::from_code(policy >> SNAPSHOT_PROJECTILE_TILE_IMPACT_SHIFT)
}

fn snapshot_bullet_gameplay_faction(snapshot: ShooterEntitySnapshot) -> Option<GameplayFaction> {
    let faction_id_plus_one = snapshot.u32s[SNAPSHOT_BULLET_FACTION_ID_PLUS_ONE];
    if faction_id_plus_one == 0 {
        return None;
    }
    GameplayFaction::new(
        faction_id_plus_one - 1,
        snapshot.u32s[SNAPSHOT_BULLET_FACTION_DAMAGE_MASK],
    )
}

fn valid_snapshot_projectile_policy(entity: ShooterEntitySnapshot) -> bool {
    let policy = entity.u32s[SNAPSHOT_PROJECTILE_POLICY];
    match entity.u32s[0] {
        SHOOTER_SNAPSHOT_ENTITY_BULLET => {
            unpack_projectile_collision_target(policy).is_some()
                && unpack_projectile_tile_impact(policy).is_some()
        }
        SHOOTER_SNAPSHOT_ENTITY_PLAYER => {
            if entity.u32s[SNAPSHOT_ACTION_ID] == 0 {
                return policy == 0;
            }
            unpack_projectile_tile_impact(policy).is_some()
        }
        SHOOTER_SNAPSHOT_ENTITY_ENEMY => true,
        _ => false,
    }
}

fn valid_snapshot_primary_action_binding(entity: ShooterEntitySnapshot) -> bool {
    let action_id = entity.u32s[SNAPSHOT_ACTION_ID];
    if action_id == 0 {
        return true;
    }
    entity.u32s[0] == SHOOTER_SNAPSHOT_ENTITY_PLAYER
        && action_id == SHOOTER_PRIMARY_FIRE_ACTION_ID
        && entity.floats[SNAPSHOT_ACTION_COOLDOWN_DURATION] >= 0.0
        && entity.floats[SNAPSHOT_ACTION_COOLDOWN_REMAINING] >= 0.0
        && entity.floats[SNAPSHOT_ACTION_PROJECTILE_SPEED] > 0.0
        && entity.floats[SNAPSHOT_ACTION_PROJECTILE_DAMAGE] > 0.0
        && entity.floats[SNAPSHOT_ACTION_PROJECTILE_LIFETIME] > 0.0
}

fn valid_snapshot_melee_action_binding(entity: ShooterEntitySnapshot) -> bool {
    let action_id = entity.u32s[SNAPSHOT_MELEE_ACTION_ID];
    if action_id == 0 {
        return true;
    }
    entity.u32s[0] == SHOOTER_SNAPSHOT_ENTITY_PLAYER
        && action_id == SHOOTER_MELEE_ACTION_ID
        && entity.floats[SNAPSHOT_MELEE_COOLDOWN_DURATION] >= 0.0
        && entity.floats[SNAPSHOT_MELEE_COOLDOWN_REMAINING] >= 0.0
        && entity.floats[SNAPSHOT_MELEE_RANGE] > 0.0
        && entity.floats[SNAPSHOT_MELEE_DAMAGE] > 0.0
}

fn valid_snapshot_dash_action_binding(entity: ShooterEntitySnapshot) -> bool {
    let action_id = entity.u32s[SNAPSHOT_DASH_ACTION_ID];
    if action_id == 0 {
        return true;
    }
    entity.u32s[0] == SHOOTER_SNAPSHOT_ENTITY_PLAYER
        && action_id == SHOOTER_DASH_ACTION_ID
        && entity.floats[SNAPSHOT_DASH_COOLDOWN_DURATION] >= 0.0
        && entity.floats[SNAPSHOT_DASH_COOLDOWN_REMAINING] >= 0.0
        && entity.floats[SNAPSHOT_DASH_DISTANCE] > 0.0
}

fn valid_snapshot_spawn_prefab_action_binding(entity: ShooterEntitySnapshot) -> bool {
    let mut seen_empty_slot = false;
    let mut previous_action_id = 0;
    (0..SNAPSHOT_SPAWN_PREFAB_BINDINGS).all(|slot| {
        let action_id =
            entity.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ACTION_ID_FIELD)];
        if action_id == 0 {
            seen_empty_slot = true;
            return true;
        }
        if seen_empty_slot || action_id <= previous_action_id {
            return false;
        }
        previous_action_id = action_id;
        entity.u32s[0] == SHOOTER_SNAPSHOT_ENTITY_PLAYER
            && entity.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ID_FIELD)] > 0
            && entity.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ANCHOR_FIELD)] == 0
            && entity.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PHASE_FIELD)] == 0
            && entity.floats
                [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_COOLDOWN_DURATION_FIELD)]
                >= 0.0
            && entity.floats
                [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_COOLDOWN_REMAINING_FIELD)]
                >= 0.0
            && entity.floats[spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_OFFSET_X_FIELD)]
                .is_finite()
            && entity.floats[spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_OFFSET_Y_FIELD)]
                .is_finite()
            && valid_snapshot_spawn_prefab_projectile_payload(entity, slot)
    })
}

fn valid_snapshot_spawn_prefab_projectile_payload(
    entity: ShooterEntitySnapshot,
    slot: usize,
) -> bool {
    let projectile_flag =
        entity.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_FLAG_FIELD)];
    let projectile_speed =
        entity.floats[spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_SPEED_FIELD)];
    let projectile_damage = entity.floats
        [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_DAMAGE_FIELD)];
    let projectile_lifetime = entity.floats
        [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_LIFETIME_FIELD)];
    let projectile_aim =
        entity.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_AIM_FIELD)];
    let projectile_policy =
        entity.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_POLICY_FIELD)];

    match projectile_flag {
        0 => {
            projectile_speed == 0.0
                && projectile_damage == 0.0
                && projectile_lifetime == 0.0
                && projectile_aim == 0
                && projectile_policy == 0
        }
        1 => {
            projectile_speed > 0.0
                && projectile_damage > 0.0
                && projectile_lifetime > 0.0
                && ActionAimSource::from_code(projectile_aim).is_some()
                && unpack_projectile_collision_target(projectile_policy).is_some()
                && unpack_projectile_tile_impact(projectile_policy).is_some()
        }
        _ => false,
    }
}

fn valid_snapshot_action_binding_ids(entity: ShooterEntitySnapshot) -> bool {
    let mut ids = [0; SNAPSHOT_SPAWN_PREFAB_BINDINGS + 3];
    ids[0] = entity.u32s[SNAPSHOT_ACTION_ID];
    ids[1] = entity.u32s[SNAPSHOT_DASH_ACTION_ID];
    ids[2] = entity.u32s[SNAPSHOT_MELEE_ACTION_ID];
    for slot in 0..SNAPSHOT_SPAWN_PREFAB_BINDINGS {
        ids[slot + 3] =
            entity.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ACTION_ID_FIELD)];
    }
    let mut count = 0;
    for (index, id) in ids.iter().copied().enumerate() {
        if id == 0 {
            continue;
        }
        count += 1;
        if count > MAX_ACTION_BINDINGS_PER_ENTITY {
            return false;
        }
        if ids[index + 1..].contains(&id) {
            return false;
        }
    }
    true
}

fn previous_input_from_snapshot(snapshot: &ShooterSceneSnapshot) -> InputState {
    InputState {
        w: (snapshot.header_u32s[SNAPSHOT_PREVIOUS_INPUT_W] != 0) as u8,
        a: (snapshot.header_u32s[SNAPSHOT_PREVIOUS_INPUT_A] != 0) as u8,
        s: (snapshot.header_u32s[SNAPSHOT_PREVIOUS_INPUT_S] != 0) as u8,
        d: (snapshot.header_u32s[SNAPSHOT_PREVIOUS_INPUT_D] != 0) as u8,
        space: (snapshot.header_u32s[SNAPSHOT_PREVIOUS_INPUT_SPACE] != 0) as u8,
        enter: (snapshot.header_u32s[SNAPSHOT_PREVIOUS_INPUT_ENTER] != 0) as u8,
        mouse_left: (snapshot.header_u32s[SNAPSHOT_PREVIOUS_INPUT_MOUSE_LEFT] != 0) as u8,
        mouse_x: finite_or_default(snapshot.header_floats[SNAPSHOT_PREVIOUS_INPUT_MOUSE_X], 0.0),
        mouse_y: finite_or_default(snapshot.header_floats[SNAPSHOT_PREVIOUS_INPUT_MOUSE_Y], 0.0),
    }
}

const fn spawn_prefab_float_index(slot: usize, field: usize) -> usize {
    SNAPSHOT_SPAWN_PREFAB_FLOAT_BASE + slot * SNAPSHOT_SPAWN_PREFAB_FLOAT_STRIDE + field
}

const fn spawn_prefab_u32_index(slot: usize, field: usize) -> usize {
    SNAPSHOT_SPAWN_PREFAB_U32_BASE + slot * SNAPSHOT_SPAWN_PREFAB_U32_STRIDE + field
}

impl ShooterScene {
    pub fn snapshot(&self, world: &World, camera: &Camera2D) -> ShooterSceneSnapshot {
        let mut entities = Vec::new();
        for &index in world.alive_indices() {
            let Some(kind) = shooter_snapshot_entity_kind(world.collider_layer_at(index)) else {
                continue;
            };
            let Some(transform) = world.transform_at_index(index) else {
                continue;
            };
            let velocity = world.velocity_at_index_or_default(index);
            let mut entity = ShooterEntitySnapshot {
                floats: [0.0; SHOOTER_SNAPSHOT_ENTITY_FLOATS],
                u32s: [0; SHOOTER_SNAPSHOT_ENTITY_U32S],
            };
            entity.floats[0] = transform.x;
            entity.floats[1] = transform.y;
            entity.floats[2] = velocity.vx;
            entity.floats[3] = velocity.vy;
            entity.floats[4] = world.health_at_index(index).unwrap_or(0.0);
            entity.floats[5] = world.damage_at_index(index).unwrap_or(0.0);
            entity.floats[6] = world.gameplay_lifetime_at(index).unwrap_or(0.0);
            entity.u32s[0] = kind;
            if kind == SHOOTER_SNAPSHOT_ENTITY_ENEMY {
                entity.u32s[1] = world.score_reward_at_index(index).unwrap_or(0);
            }
            if kind == SHOOTER_SNAPSHOT_ENTITY_BULLET {
                let collision_target = world.projectile_collision_target_at(index);
                let tile_impact = world.projectile_tile_impact_at(index);
                entity.u32s[SNAPSHOT_PROJECTILE_POLICY] =
                    pack_projectile_policy(collision_target, tile_impact);
                if let Some(faction) = world.gameplay_faction_at_index(index) {
                    entity.u32s[SNAPSHOT_BULLET_FACTION_ID_PLUS_ONE] = faction.faction_id + 1;
                    entity.u32s[SNAPSHOT_BULLET_FACTION_DAMAGE_MASK] = faction.damage_mask;
                }
            }

            if kind == SHOOTER_SNAPSHOT_ENTITY_PLAYER {
                let Some(player) = world.entity_at_index(index) else {
                    continue;
                };
                if let Some(binding) = world.action_binding(player, SHOOTER_PRIMARY_FIRE_ACTION_ID)
                {
                    if let ActionPattern::Projectile {
                        speed,
                        damage,
                        lifetime_seconds,
                        aim: ActionAimSource::Input,
                        collision_target: ProjectileCollisionTarget::Enemies,
                        tile_impact,
                    } = binding.pattern
                    {
                        entity.floats[SNAPSHOT_ACTION_COOLDOWN_DURATION] =
                            binding.cooldown.duration_seconds;
                        entity.floats[SNAPSHOT_ACTION_COOLDOWN_REMAINING] =
                            binding.cooldown.remaining_seconds;
                        entity.floats[SNAPSHOT_ACTION_PROJECTILE_SPEED] = speed;
                        entity.floats[SNAPSHOT_ACTION_PROJECTILE_DAMAGE] = damage;
                        entity.floats[SNAPSHOT_ACTION_PROJECTILE_LIFETIME] = lifetime_seconds;
                        entity.u32s[SNAPSHOT_ACTION_ID] = binding.action_id;
                        entity.u32s[SNAPSHOT_PROJECTILE_POLICY] =
                            pack_projectile_policy(ProjectileCollisionTarget::Enemies, tile_impact);
                    }
                }
                if let Some(binding) = world.action_binding(player, SHOOTER_DASH_ACTION_ID) {
                    if let ActionPattern::Dash {
                        distance,
                        aim: ActionAimSource::Input,
                    } = binding.pattern
                    {
                        entity.floats[SNAPSHOT_DASH_COOLDOWN_DURATION] =
                            binding.cooldown.duration_seconds;
                        entity.floats[SNAPSHOT_DASH_COOLDOWN_REMAINING] =
                            binding.cooldown.remaining_seconds;
                        entity.floats[SNAPSHOT_DASH_DISTANCE] = distance;
                        entity.u32s[SNAPSHOT_DASH_ACTION_ID] = binding.action_id;
                    }
                }
                if let Some(binding) = world.action_binding(player, SHOOTER_MELEE_ACTION_ID) {
                    if let ActionPattern::Melee {
                        range,
                        damage,
                        target: crate::components::gameplay::MeleeTarget::Enemies,
                    } = binding.pattern
                    {
                        entity.floats[SNAPSHOT_MELEE_COOLDOWN_DURATION] =
                            binding.cooldown.duration_seconds;
                        entity.floats[SNAPSHOT_MELEE_COOLDOWN_REMAINING] =
                            binding.cooldown.remaining_seconds;
                        entity.floats[SNAPSHOT_MELEE_RANGE] = range;
                        entity.floats[SNAPSHOT_MELEE_DAMAGE] = damage;
                        entity.u32s[SNAPSHOT_MELEE_ACTION_ID] = binding.action_id;
                    }
                }
                let mut spawn_prefab_bindings = [None; SNAPSHOT_SPAWN_PREFAB_BINDINGS];
                let mut spawn_prefab_binding_count = 0;
                if let Some(bindings) = world.action_bindings(player) {
                    for binding in bindings
                        .iter()
                        .filter(|binding| snapshot_supported_spawn_prefab_binding(self, *binding))
                    {
                        if spawn_prefab_binding_count >= SNAPSHOT_SPAWN_PREFAB_BINDINGS {
                            break;
                        }
                        spawn_prefab_bindings[spawn_prefab_binding_count] = Some(binding);
                        spawn_prefab_binding_count += 1;
                    }
                    spawn_prefab_bindings[..spawn_prefab_binding_count].sort_by_key(|binding| {
                        binding.map_or(u32::MAX, |binding| binding.action_id)
                    });
                    for (slot, binding) in spawn_prefab_bindings[..spawn_prefab_binding_count]
                        .iter()
                        .flatten()
                        .copied()
                        .enumerate()
                    {
                        write_snapshot_spawn_prefab_action_binding(&mut entity, slot, binding);
                    }
                }
            }
            entities.push(entity);
        }

        let mut header_u32s = [0; SHOOTER_SNAPSHOT_HEADER_U32S];
        header_u32s[0] = SHOOTER_SNAPSHOT_VERSION;
        header_u32s[1] = game_state_code(self.game_state);
        header_u32s[2] = self.score;
        header_u32s[3] = self.spawn_index;
        header_u32s[4] = self.active_wave_index as u32;
        header_u32s[5] = self.wave_spawned_count;
        header_u32s[SNAPSHOT_PREVIOUS_INPUT_SPACE] = self.previous_input.space as u32;
        header_u32s[SNAPSHOT_PREVIOUS_INPUT_ENTER] = self.previous_input.enter as u32;
        header_u32s[SNAPSHOT_PREVIOUS_INPUT_MOUSE_LEFT] = self.previous_input.mouse_left as u32;
        header_u32s[SNAPSHOT_PREVIOUS_INPUT_W] = self.previous_input.w as u32;
        header_u32s[SNAPSHOT_PREVIOUS_INPUT_A] = self.previous_input.a as u32;
        header_u32s[SNAPSHOT_PREVIOUS_INPUT_S] = self.previous_input.s as u32;
        header_u32s[SNAPSHOT_PREVIOUS_INPUT_D] = self.previous_input.d as u32;
        self.config.write_prefab_registry_snapshot(
            &mut header_u32s[SNAPSHOT_PREFAB_REGISTRY_U32_OFFSET
                ..SNAPSHOT_PREFAB_REGISTRY_U32_OFFSET + SHOOTER_PREFAB_REGISTRY_SNAPSHOT_U32S],
        );
        world.write_gameplay_faction_relations_snapshot(
            &mut header_u32s[SNAPSHOT_FACTION_RELATION_TABLE_U32_OFFSET
                ..SNAPSHOT_FACTION_RELATION_TABLE_U32_OFFSET
                    + GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S],
        );

        ShooterSceneSnapshot {
            header_floats: [
                self.fire_cooldown_seconds,
                self.enemy_spawn_timer,
                self.wave_elapsed_seconds,
                self.camera_elapsed_seconds,
                camera.x,
                camera.y,
                self.previous_input.mouse_x,
                self.previous_input.mouse_y,
            ],
            header_u32s,
            entities,
        }
    }

    pub fn restore_snapshot(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        audio_events: &mut Vec<AudioEvent>,
        snapshot: &ShooterSceneSnapshot,
    ) -> bool {
        if snapshot.header_u32s[0] != SHOOTER_SNAPSHOT_VERSION {
            return false;
        }
        if !self.config.prefab_registry_snapshot_matches(
            &snapshot.header_u32s[SNAPSHOT_PREFAB_REGISTRY_U32_OFFSET
                ..SNAPSHOT_PREFAB_REGISTRY_U32_OFFSET + SHOOTER_PREFAB_REGISTRY_SNAPSHOT_U32S],
        ) {
            return false;
        }
        let Some(faction_relations) =
            crate::components::gameplay::FactionRelationTable::from_snapshot(
                &snapshot.header_u32s[SNAPSHOT_FACTION_RELATION_TABLE_U32_OFFSET
                    ..SNAPSHOT_FACTION_RELATION_TABLE_U32_OFFSET
                        + GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S],
            )
        else {
            return false;
        };
        let Some(game_state) = game_state_from_code(snapshot.header_u32s[1]) else {
            return false;
        };
        if !snapshot.entities.iter().any(|entity| {
            entity.u32s[0] == SHOOTER_SNAPSHOT_ENTITY_PLAYER
                && entity.floats.iter().all(|value| value.is_finite())
        }) {
            return false;
        }
        if snapshot
            .entities
            .iter()
            .any(|entity| !valid_shooter_snapshot_entity(*entity))
        {
            return false;
        }
        if !snapshot_spawn_prefab_bindings_match_registry(self, &snapshot.entities) {
            return false;
        }

        self.score = snapshot.header_u32s[2];
        self.fire_cooldown_seconds = non_negative_or_default(snapshot.header_floats[0], 0.0);
        self.enemy_spawn_timer =
            non_negative_or_default(snapshot.header_floats[1], self.active_spawn_interval());
        self.previous_input = previous_input_from_snapshot(snapshot);
        self.previous_space = self.previous_input.space;
        self.previous_enter = self.previous_input.enter;
        self.previous_mouse_left = self.previous_input.mouse_left;
        self.game_state = game_state;
        self.spawn_index = snapshot.header_u32s[3];
        self.active_wave_index = if self.waves.is_empty() {
            0
        } else {
            (snapshot.header_u32s[4] as usize).min(self.waves.len() - 1)
        };
        self.wave_elapsed_seconds = non_negative_or_default(snapshot.header_floats[2], 0.0);
        self.wave_spawned_count = snapshot.header_u32s[5];
        self.camera_elapsed_seconds = non_negative_or_default(snapshot.header_floats[3], 0.0);
        self.navigation_targets.clear();
        self.collision_pairs.clear();
        self.authored_collision_contacts.clear();
        self.wave_action_triggers.clear();
        self.action_triggers.clear();
        self.action_trigger_commands.clear();
        self.pending_spawns.clear();
        self.spawn_commands.clear();
        self.pending_melee_attacks.clear();
        self.melee_attack_commands.clear();
        self.pending_despawn.clear();
        self.marked_for_despawn.clear();
        self.bounced_projectiles_this_frame.clear();
        audio_events.clear();

        *world = World::default();
        world.replace_gameplay_faction_relations(faction_relations);
        for entity in snapshot.entities.iter().copied() {
            self.restore_snapshot_entity(world, entity);
        }
        camera.x = finite_or_default(snapshot.header_floats[4], camera.x);
        camera.y = finite_or_default(snapshot.header_floats[5], camera.y);
        true
    }

    fn restore_snapshot_entity(&self, world: &mut World, snapshot: ShooterEntitySnapshot) {
        let transform = Transform2D {
            x: snapshot.floats[0],
            y: snapshot.floats[1],
        };
        let velocity = Velocity {
            vx: snapshot.floats[2],
            vy: snapshot.floats[3],
        };
        match snapshot.u32s[0] {
            SHOOTER_SNAPSHOT_ENTITY_PLAYER => {
                let entity = world.spawn_player_from_template(
                    transform.x,
                    transform.y,
                    self.texture_ids.player,
                    self.config.player_template,
                );
                world.set_velocity_at_index(entity.id as usize, velocity);
                if let Some(binding) = snapshot_primary_action_binding(snapshot) {
                    world.upsert_action_binding(entity, binding);
                }
                if let Some(binding) = snapshot_dash_action_binding(snapshot) {
                    world.upsert_action_binding(entity, binding);
                }
                if let Some(binding) = snapshot_melee_action_binding(snapshot) {
                    world.upsert_action_binding(entity, binding);
                }
                for slot in 0..SNAPSHOT_SPAWN_PREFAB_BINDINGS {
                    if let Some(binding) = snapshot_spawn_prefab_action_binding(snapshot, slot) {
                        world.upsert_action_binding(entity, binding);
                    }
                }
            }
            SHOOTER_SNAPSHOT_ENTITY_ENEMY => {
                let entity = world.spawn_enemy_from_template(
                    transform.x,
                    transform.y,
                    self.texture_ids.enemy,
                    self.config.enemy_template,
                    positive_or_default(snapshot.floats[4], self.config.enemy_health),
                    snapshot.u32s[1],
                );
                world.set_velocity_at_index(entity.id as usize, velocity);
            }
            SHOOTER_SNAPSHOT_ENTITY_BULLET => {
                let collision_target =
                    unpack_projectile_collision_target(snapshot.u32s[SNAPSHOT_PROJECTILE_POLICY])
                        .unwrap_or(ProjectileCollisionTarget::Enemies);
                let tile_impact =
                    unpack_projectile_tile_impact(snapshot.u32s[SNAPSHOT_PROJECTILE_POLICY])
                        .unwrap_or(ProjectileTileImpact::Despawn);
                world.spawn_projectile_from_request(ProjectileSpawnRequest {
                    transform,
                    velocity,
                    texture_id: self.texture_ids.bullet,
                    lifetime: positive_or_default(snapshot.floats[6], self.config.bullet_lifetime),
                    template: self.config.bullet_template,
                    damage: positive_or_default(snapshot.floats[5], self.config.bullet_damage),
                    collision_target,
                    tile_impact,
                    source_faction: snapshot_bullet_gameplay_faction(snapshot),
                });
            }
            _ => {}
        }
    }
}

fn snapshot_supported_spawn_prefab_binding(scene: &ShooterScene, binding: ActionBinding) -> bool {
    match binding.pattern {
        ActionPattern::SpawnPrefab {
            prefab_id,
            projectile,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: _,
            offset_y: _,
        } => scene
            .resolve_spawn_prefab_registration(prefab_id)
            .map(|registration| scene.resolve_spawn_prefab_components(registration).layer)
            .map(|layer| match layer {
                CollisionLayer::Enemy => projectile.is_none(),
                CollisionLayer::Bullet => projectile.is_some(),
                CollisionLayer::Player | CollisionLayer::Wall | CollisionLayer::Pickup => false,
            })
            .unwrap_or(false),
        _ => false,
    }
}

fn snapshot_spawn_prefab_bindings_match_registry(
    scene: &ShooterScene,
    entities: &[ShooterEntitySnapshot],
) -> bool {
    entities.iter().all(|entity| {
        (0..SNAPSHOT_SPAWN_PREFAB_BINDINGS).all(|slot| {
            snapshot_spawn_prefab_action_binding(*entity, slot)
                .map(|binding| snapshot_supported_spawn_prefab_binding(scene, binding))
                .unwrap_or(true)
        })
    })
}

fn write_snapshot_spawn_prefab_action_binding(
    snapshot: &mut ShooterEntitySnapshot,
    slot: usize,
    binding: ActionBinding,
) {
    if let ActionPattern::SpawnPrefab {
        prefab_id,
        projectile,
        anchor: SpawnAnchor::SelfEntity,
        phase: SpawnPhase::PrePhysics,
        offset_x,
        offset_y,
    } = binding.pattern
    {
        snapshot.floats
            [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_COOLDOWN_DURATION_FIELD)] =
            binding.cooldown.duration_seconds;
        snapshot.floats
            [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_COOLDOWN_REMAINING_FIELD)] =
            binding.cooldown.remaining_seconds;
        snapshot.floats[spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_OFFSET_X_FIELD)] =
            offset_x;
        snapshot.floats[spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_OFFSET_Y_FIELD)] =
            offset_y;
        snapshot.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ACTION_ID_FIELD)] =
            binding.action_id;
        snapshot.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ID_FIELD)] = prefab_id;
        snapshot.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ANCHOR_FIELD)] = 0;
        snapshot.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PHASE_FIELD)] = 0;
        if let Some(projectile) = projectile {
            snapshot.floats
                [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_SPEED_FIELD)] =
                projectile.speed;
            snapshot.floats
                [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_DAMAGE_FIELD)] =
                projectile.damage;
            snapshot.floats
                [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_LIFETIME_FIELD)] =
                projectile.lifetime_seconds;
            snapshot.u32s
                [spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_FLAG_FIELD)] = 1;
            snapshot.u32s
                [spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_AIM_FIELD)] =
                projectile.aim.code();
            snapshot.u32s
                [spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_POLICY_FIELD)] =
                pack_projectile_policy(projectile.collision_target, projectile.tile_impact);
        }
    }
}

fn snapshot_primary_action_binding(snapshot: ShooterEntitySnapshot) -> Option<ActionBinding> {
    if snapshot.u32s[SNAPSHOT_ACTION_ID] != SHOOTER_PRIMARY_FIRE_ACTION_ID {
        return None;
    }
    let tile_impact = unpack_projectile_tile_impact(snapshot.u32s[SNAPSHOT_PROJECTILE_POLICY])?;
    Some(ActionBinding {
        action_id: SHOOTER_PRIMARY_FIRE_ACTION_ID,
        pattern: ActionPattern::Projectile {
            speed: snapshot.floats[SNAPSHOT_ACTION_PROJECTILE_SPEED],
            damage: snapshot.floats[SNAPSHOT_ACTION_PROJECTILE_DAMAGE],
            lifetime_seconds: snapshot.floats[SNAPSHOT_ACTION_PROJECTILE_LIFETIME],
            aim: ActionAimSource::Input,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact,
        },
        cooldown: Cooldown {
            duration_seconds: snapshot.floats[SNAPSHOT_ACTION_COOLDOWN_DURATION],
            remaining_seconds: snapshot.floats[SNAPSHOT_ACTION_COOLDOWN_REMAINING],
        },
    })
}

fn snapshot_dash_action_binding(snapshot: ShooterEntitySnapshot) -> Option<ActionBinding> {
    (snapshot.u32s[SNAPSHOT_DASH_ACTION_ID] == SHOOTER_DASH_ACTION_ID).then_some(ActionBinding {
        action_id: SHOOTER_DASH_ACTION_ID,
        pattern: ActionPattern::Dash {
            distance: snapshot.floats[SNAPSHOT_DASH_DISTANCE],
            aim: ActionAimSource::Input,
        },
        cooldown: Cooldown {
            duration_seconds: snapshot.floats[SNAPSHOT_DASH_COOLDOWN_DURATION],
            remaining_seconds: snapshot.floats[SNAPSHOT_DASH_COOLDOWN_REMAINING],
        },
    })
}

fn snapshot_melee_action_binding(snapshot: ShooterEntitySnapshot) -> Option<ActionBinding> {
    (snapshot.u32s[SNAPSHOT_MELEE_ACTION_ID] == SHOOTER_MELEE_ACTION_ID).then_some(ActionBinding {
        action_id: SHOOTER_MELEE_ACTION_ID,
        pattern: ActionPattern::Melee {
            range: snapshot.floats[SNAPSHOT_MELEE_RANGE],
            damage: snapshot.floats[SNAPSHOT_MELEE_DAMAGE],
            target: crate::components::gameplay::MeleeTarget::Enemies,
        },
        cooldown: Cooldown {
            duration_seconds: snapshot.floats[SNAPSHOT_MELEE_COOLDOWN_DURATION],
            remaining_seconds: snapshot.floats[SNAPSHOT_MELEE_COOLDOWN_REMAINING],
        },
    })
}

fn snapshot_spawn_prefab_action_binding(
    snapshot: ShooterEntitySnapshot,
    slot: usize,
) -> Option<ActionBinding> {
    let action_id =
        snapshot.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ACTION_ID_FIELD)];
    if action_id == 0 {
        return None;
    }
    let projectile = snapshot_spawn_prefab_projectile_payload(snapshot, slot)?;
    Some(ActionBinding {
        action_id,
        pattern: ActionPattern::SpawnPrefab {
            prefab_id: snapshot.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ID_FIELD)],
            projectile,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: snapshot.floats
                [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_OFFSET_X_FIELD)],
            offset_y: snapshot.floats
                [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_OFFSET_Y_FIELD)],
        },
        cooldown: Cooldown {
            duration_seconds: snapshot.floats
                [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_COOLDOWN_DURATION_FIELD)],
            remaining_seconds: snapshot.floats
                [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_COOLDOWN_REMAINING_FIELD)],
        },
    })
}

fn snapshot_spawn_prefab_projectile_payload(
    snapshot: ShooterEntitySnapshot,
    slot: usize,
) -> Option<Option<SpawnPrefabProjectilePayload>> {
    match snapshot.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_FLAG_FIELD)] {
        0 => Some(None),
        1 => {
            let policy = snapshot.u32s
                [spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_POLICY_FIELD)];
            Some(Some(SpawnPrefabProjectilePayload {
                speed: snapshot.floats
                    [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_SPEED_FIELD)],
                damage: snapshot.floats
                    [spawn_prefab_float_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_DAMAGE_FIELD)],
                lifetime_seconds: snapshot.floats[spawn_prefab_float_index(
                    slot,
                    SNAPSHOT_SPAWN_PREFAB_PROJECTILE_LIFETIME_FIELD,
                )],
                aim: ActionAimSource::from_code(
                    snapshot.u32s
                        [spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_AIM_FIELD)],
                )?,
                collision_target: unpack_projectile_collision_target(policy)?,
                tile_impact: unpack_projectile_tile_impact(policy)?,
            }))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shooter_scene::ShooterPrefabKind;

    fn spawn_prefab_binding(prefab_id: u32) -> ActionBinding {
        ActionBinding {
            action_id: 9,
            pattern: ActionPattern::SpawnPrefab {
                prefab_id,
                projectile: None,
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 4.0,
                offset_y: -2.0,
            },
            cooldown: Cooldown {
                duration_seconds: 0.5,
                remaining_seconds: 0.25,
            },
        }
    }

    fn spawn_prefab_projectile_binding(prefab_id: u32) -> ActionBinding {
        ActionBinding {
            action_id: 10,
            pattern: ActionPattern::SpawnPrefab {
                prefab_id,
                projectile: Some(SpawnPrefabProjectilePayload {
                    speed: 480.0,
                    damage: 2.0,
                    lifetime_seconds: 1.25,
                    aim: ActionAimSource::TargetPlayer,
                    collision_target: ProjectileCollisionTarget::Player,
                    tile_impact: ProjectileTileImpact::Bounce,
                }),
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 4.0,
                offset_y: -2.0,
            },
            cooldown: Cooldown {
                duration_seconds: 0.5,
                remaining_seconds: 0.25,
            },
        }
    }

    fn snapshot_with_spawn_prefab_binding(binding: ActionBinding) -> ShooterEntitySnapshot {
        let mut snapshot = ShooterEntitySnapshot {
            floats: [0.0; SHOOTER_SNAPSHOT_ENTITY_FLOATS],
            u32s: [0; SHOOTER_SNAPSHOT_ENTITY_U32S],
        };
        write_snapshot_spawn_prefab_action_binding(&mut snapshot, 0, binding);
        snapshot
    }

    fn snapshot_with_spawn_prefab(prefab_id: u32) -> ShooterEntitySnapshot {
        snapshot_with_spawn_prefab_binding(spawn_prefab_binding(prefab_id))
    }

    #[test]
    fn snapshot_spawn_prefab_support_accepts_registered_enemy_alias() {
        let mut scene = ShooterScene::new();

        assert!(scene.register_spawn_prefab_kind(7, ShooterPrefabKind::Enemy));

        assert!(snapshot_supported_spawn_prefab_binding(
            &scene,
            spawn_prefab_binding(7)
        ));
        assert!(snapshot_spawn_prefab_bindings_match_registry(
            &scene,
            &[snapshot_with_spawn_prefab(7)]
        ));
    }

    #[test]
    fn snapshot_spawn_prefab_support_rejects_unregistered_or_non_enemy_alias() {
        let mut scene = ShooterScene::new();

        assert!(scene.register_spawn_prefab_kind(8, ShooterPrefabKind::Bullet));

        assert!(!snapshot_supported_spawn_prefab_binding(
            &scene,
            spawn_prefab_binding(7)
        ));
        assert!(!snapshot_supported_spawn_prefab_binding(
            &scene,
            spawn_prefab_binding(8)
        ));
        assert!(!snapshot_spawn_prefab_bindings_match_registry(
            &scene,
            &[snapshot_with_spawn_prefab(8)]
        ));
    }

    #[test]
    fn snapshot_spawn_prefab_support_accepts_registered_bullet_alias_with_projectile_payload() {
        let mut scene = ShooterScene::new();
        let binding = spawn_prefab_projectile_binding(8);
        let snapshot = snapshot_with_spawn_prefab_binding(binding);

        assert!(scene.register_spawn_prefab_kind(8, ShooterPrefabKind::Bullet));

        assert!(snapshot_supported_spawn_prefab_binding(&scene, binding));
        assert!(snapshot_spawn_prefab_bindings_match_registry(
            &scene,
            &[snapshot]
        ));
        assert_eq!(
            snapshot_spawn_prefab_action_binding(snapshot, 0),
            Some(binding)
        );
    }
}
