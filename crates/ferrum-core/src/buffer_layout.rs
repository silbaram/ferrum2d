//! Rust/Wasm bulk buffer의 named field layout 계약입니다.

use wasm_bindgen::prelude::*;

use crate::render_command::{
    SPRITE_RENDER_COMMAND_A_FLOAT_OFFSET, SPRITE_RENDER_COMMAND_B_FLOAT_OFFSET,
    SPRITE_RENDER_COMMAND_EFFECT_FLAGS_FLOAT_OFFSET, SPRITE_RENDER_COMMAND_G_FLOAT_OFFSET,
    SPRITE_RENDER_COMMAND_HEIGHT_FLOAT_OFFSET, SPRITE_RENDER_COMMAND_ROTATION_RADIANS_FLOAT_OFFSET,
    SPRITE_RENDER_COMMAND_R_FLOAT_OFFSET, SPRITE_RENDER_COMMAND_TEXTURE_ID_FLOAT_OFFSET,
    SPRITE_RENDER_COMMAND_U0_FLOAT_OFFSET, SPRITE_RENDER_COMMAND_U1_FLOAT_OFFSET,
    SPRITE_RENDER_COMMAND_V0_FLOAT_OFFSET, SPRITE_RENDER_COMMAND_V1_FLOAT_OFFSET,
    SPRITE_RENDER_COMMAND_WIDTH_FLOAT_OFFSET, SPRITE_RENDER_COMMAND_X_FLOAT_OFFSET,
    SPRITE_RENDER_COMMAND_Y_FLOAT_OFFSET,
};
use crate::shooter_scene::snapshot::{
    SNAPSHOT_ACTION_COOLDOWN_DURATION, SNAPSHOT_ACTION_COOLDOWN_REMAINING, SNAPSHOT_ACTION_ID,
    SNAPSHOT_ACTION_PROJECTILE_DAMAGE, SNAPSHOT_ACTION_PROJECTILE_LIFETIME,
    SNAPSHOT_ACTION_PROJECTILE_SPEED, SNAPSHOT_DASH_ACTION_ID, SNAPSHOT_DASH_COOLDOWN_DURATION,
    SNAPSHOT_DASH_COOLDOWN_REMAINING, SNAPSHOT_DASH_DISTANCE, SNAPSHOT_ENTITY_DAMAGE,
    SNAPSHOT_ENTITY_HEALTH, SNAPSHOT_ENTITY_KIND, SNAPSHOT_ENTITY_LIFETIME_SECONDS,
    SNAPSHOT_ENTITY_SECONDARY, SNAPSHOT_ENTITY_VELOCITY_X, SNAPSHOT_ENTITY_VELOCITY_Y,
    SNAPSHOT_ENTITY_X, SNAPSHOT_ENTITY_Y, SNAPSHOT_HEADER_ACTIVE_WAVE_INDEX,
    SNAPSHOT_HEADER_CAMERA_ELAPSED_SECONDS, SNAPSHOT_HEADER_CAMERA_X, SNAPSHOT_HEADER_CAMERA_Y,
    SNAPSHOT_HEADER_ENEMY_SPAWN_TIMER, SNAPSHOT_HEADER_FIRE_COOLDOWN_SECONDS,
    SNAPSHOT_HEADER_GAME_STATE, SNAPSHOT_HEADER_SCORE, SNAPSHOT_HEADER_SPAWN_INDEX,
    SNAPSHOT_HEADER_VERSION, SNAPSHOT_HEADER_WAVE_ELAPSED_SECONDS,
    SNAPSHOT_HEADER_WAVE_SPAWNED_COUNT, SNAPSHOT_MELEE_ACTION_ID, SNAPSHOT_MELEE_COOLDOWN_DURATION,
    SNAPSHOT_MELEE_COOLDOWN_REMAINING, SNAPSHOT_MELEE_DAMAGE, SNAPSHOT_MELEE_RANGE,
    SNAPSHOT_PREVIOUS_INPUT_MOUSE_X, SNAPSHOT_PREVIOUS_INPUT_MOUSE_Y,
};

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Sprite render command에서 조회할 필드입니다.
pub enum SpriteRenderCommandField {
    X = 0,
    Y = 1,
    Width = 2,
    Height = 3,
    U0 = 4,
    V0 = 5,
    U1 = 6,
    V1 = 7,
    R = 8,
    G = 9,
    B = 10,
    A = 11,
    TextureId = 12,
    EffectFlags = 13,
    RotationRadians = 14,
}

#[wasm_bindgen]
/// 선택한 sprite render command 필드의 `f32` element offset을 반환합니다.
pub fn sprite_render_command_float_offset(field: SpriteRenderCommandField) -> usize {
    match field {
        SpriteRenderCommandField::X => SPRITE_RENDER_COMMAND_X_FLOAT_OFFSET,
        SpriteRenderCommandField::Y => SPRITE_RENDER_COMMAND_Y_FLOAT_OFFSET,
        SpriteRenderCommandField::Width => SPRITE_RENDER_COMMAND_WIDTH_FLOAT_OFFSET,
        SpriteRenderCommandField::Height => SPRITE_RENDER_COMMAND_HEIGHT_FLOAT_OFFSET,
        SpriteRenderCommandField::U0 => SPRITE_RENDER_COMMAND_U0_FLOAT_OFFSET,
        SpriteRenderCommandField::V0 => SPRITE_RENDER_COMMAND_V0_FLOAT_OFFSET,
        SpriteRenderCommandField::U1 => SPRITE_RENDER_COMMAND_U1_FLOAT_OFFSET,
        SpriteRenderCommandField::V1 => SPRITE_RENDER_COMMAND_V1_FLOAT_OFFSET,
        SpriteRenderCommandField::R => SPRITE_RENDER_COMMAND_R_FLOAT_OFFSET,
        SpriteRenderCommandField::G => SPRITE_RENDER_COMMAND_G_FLOAT_OFFSET,
        SpriteRenderCommandField::B => SPRITE_RENDER_COMMAND_B_FLOAT_OFFSET,
        SpriteRenderCommandField::A => SPRITE_RENDER_COMMAND_A_FLOAT_OFFSET,
        SpriteRenderCommandField::TextureId => SPRITE_RENDER_COMMAND_TEXTURE_ID_FLOAT_OFFSET,
        SpriteRenderCommandField::EffectFlags => SPRITE_RENDER_COMMAND_EFFECT_FLAGS_FLOAT_OFFSET,
        SpriteRenderCommandField::RotationRadians => {
            SPRITE_RENDER_COMMAND_ROTATION_RADIANS_FLOAT_OFFSET
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Built-in Shooter snapshot header의 float 필드입니다.
pub enum ShooterSnapshotHeaderFloatField {
    FireCooldownSeconds = 0,
    EnemySpawnTimer = 1,
    WaveElapsedSeconds = 2,
    CameraElapsedSeconds = 3,
    CameraX = 4,
    CameraY = 5,
    PreviousMouseX = 6,
    PreviousMouseY = 7,
}

#[wasm_bindgen]
/// 선택한 Shooter snapshot header float 필드의 element offset을 반환합니다.
pub fn shooter_snapshot_header_float_offset(field: ShooterSnapshotHeaderFloatField) -> usize {
    match field {
        ShooterSnapshotHeaderFloatField::FireCooldownSeconds => {
            SNAPSHOT_HEADER_FIRE_COOLDOWN_SECONDS
        }
        ShooterSnapshotHeaderFloatField::EnemySpawnTimer => SNAPSHOT_HEADER_ENEMY_SPAWN_TIMER,
        ShooterSnapshotHeaderFloatField::WaveElapsedSeconds => SNAPSHOT_HEADER_WAVE_ELAPSED_SECONDS,
        ShooterSnapshotHeaderFloatField::CameraElapsedSeconds => {
            SNAPSHOT_HEADER_CAMERA_ELAPSED_SECONDS
        }
        ShooterSnapshotHeaderFloatField::CameraX => SNAPSHOT_HEADER_CAMERA_X,
        ShooterSnapshotHeaderFloatField::CameraY => SNAPSHOT_HEADER_CAMERA_Y,
        ShooterSnapshotHeaderFloatField::PreviousMouseX => SNAPSHOT_PREVIOUS_INPUT_MOUSE_X,
        ShooterSnapshotHeaderFloatField::PreviousMouseY => SNAPSHOT_PREVIOUS_INPUT_MOUSE_Y,
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Built-in Shooter snapshot header의 u32 필드입니다.
pub enum ShooterSnapshotHeaderU32Field {
    Version = 0,
    GameState = 1,
    Score = 2,
    SpawnIndex = 3,
    ActiveWaveIndex = 4,
    WaveSpawnedCount = 5,
}

#[wasm_bindgen]
/// 선택한 Shooter snapshot header u32 필드의 element offset을 반환합니다.
pub fn shooter_snapshot_header_u32_offset(field: ShooterSnapshotHeaderU32Field) -> usize {
    match field {
        ShooterSnapshotHeaderU32Field::Version => SNAPSHOT_HEADER_VERSION,
        ShooterSnapshotHeaderU32Field::GameState => SNAPSHOT_HEADER_GAME_STATE,
        ShooterSnapshotHeaderU32Field::Score => SNAPSHOT_HEADER_SCORE,
        ShooterSnapshotHeaderU32Field::SpawnIndex => SNAPSHOT_HEADER_SPAWN_INDEX,
        ShooterSnapshotHeaderU32Field::ActiveWaveIndex => SNAPSHOT_HEADER_ACTIVE_WAVE_INDEX,
        ShooterSnapshotHeaderU32Field::WaveSpawnedCount => SNAPSHOT_HEADER_WAVE_SPAWNED_COUNT,
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Built-in Shooter snapshot entity의 float 필드입니다.
pub enum ShooterSnapshotEntityFloatField {
    X = 0,
    Y = 1,
    VelocityX = 2,
    VelocityY = 3,
    Health = 4,
    Damage = 5,
    LifetimeSeconds = 6,
    PrimaryActionCooldownDuration = 7,
    PrimaryActionCooldownRemaining = 8,
    PrimaryActionProjectileSpeed = 9,
    PrimaryActionProjectileDamage = 10,
    PrimaryActionProjectileLifetime = 11,
    DashCooldownDuration = 12,
    DashCooldownRemaining = 13,
    DashDistance = 14,
    MeleeCooldownDuration = 15,
    MeleeCooldownRemaining = 16,
    MeleeRange = 17,
    MeleeDamage = 18,
}

#[wasm_bindgen]
/// 선택한 Shooter snapshot entity float 필드의 element offset을 반환합니다.
pub fn shooter_snapshot_entity_float_offset(field: ShooterSnapshotEntityFloatField) -> usize {
    match field {
        ShooterSnapshotEntityFloatField::X => SNAPSHOT_ENTITY_X,
        ShooterSnapshotEntityFloatField::Y => SNAPSHOT_ENTITY_Y,
        ShooterSnapshotEntityFloatField::VelocityX => SNAPSHOT_ENTITY_VELOCITY_X,
        ShooterSnapshotEntityFloatField::VelocityY => SNAPSHOT_ENTITY_VELOCITY_Y,
        ShooterSnapshotEntityFloatField::Health => SNAPSHOT_ENTITY_HEALTH,
        ShooterSnapshotEntityFloatField::Damage => SNAPSHOT_ENTITY_DAMAGE,
        ShooterSnapshotEntityFloatField::LifetimeSeconds => SNAPSHOT_ENTITY_LIFETIME_SECONDS,
        ShooterSnapshotEntityFloatField::PrimaryActionCooldownDuration => {
            SNAPSHOT_ACTION_COOLDOWN_DURATION
        }
        ShooterSnapshotEntityFloatField::PrimaryActionCooldownRemaining => {
            SNAPSHOT_ACTION_COOLDOWN_REMAINING
        }
        ShooterSnapshotEntityFloatField::PrimaryActionProjectileSpeed => {
            SNAPSHOT_ACTION_PROJECTILE_SPEED
        }
        ShooterSnapshotEntityFloatField::PrimaryActionProjectileDamage => {
            SNAPSHOT_ACTION_PROJECTILE_DAMAGE
        }
        ShooterSnapshotEntityFloatField::PrimaryActionProjectileLifetime => {
            SNAPSHOT_ACTION_PROJECTILE_LIFETIME
        }
        ShooterSnapshotEntityFloatField::DashCooldownDuration => SNAPSHOT_DASH_COOLDOWN_DURATION,
        ShooterSnapshotEntityFloatField::DashCooldownRemaining => SNAPSHOT_DASH_COOLDOWN_REMAINING,
        ShooterSnapshotEntityFloatField::DashDistance => SNAPSHOT_DASH_DISTANCE,
        ShooterSnapshotEntityFloatField::MeleeCooldownDuration => SNAPSHOT_MELEE_COOLDOWN_DURATION,
        ShooterSnapshotEntityFloatField::MeleeCooldownRemaining => {
            SNAPSHOT_MELEE_COOLDOWN_REMAINING
        }
        ShooterSnapshotEntityFloatField::MeleeRange => SNAPSHOT_MELEE_RANGE,
        ShooterSnapshotEntityFloatField::MeleeDamage => SNAPSHOT_MELEE_DAMAGE,
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Built-in Shooter snapshot entity의 u32 필드입니다.
pub enum ShooterSnapshotEntityU32Field {
    Kind = 0,
    ScoreRewardOrProjectilePolicy = 1,
    PrimaryActionId = 2,
    DashActionId = 3,
    MeleeActionId = 4,
}

#[wasm_bindgen]
/// 선택한 Shooter snapshot entity u32 필드의 element offset을 반환합니다.
pub fn shooter_snapshot_entity_u32_offset(field: ShooterSnapshotEntityU32Field) -> usize {
    match field {
        ShooterSnapshotEntityU32Field::Kind => SNAPSHOT_ENTITY_KIND,
        ShooterSnapshotEntityU32Field::ScoreRewardOrProjectilePolicy => SNAPSHOT_ENTITY_SECONDARY,
        ShooterSnapshotEntityU32Field::PrimaryActionId => SNAPSHOT_ACTION_ID,
        ShooterSnapshotEntityU32Field::DashActionId => SNAPSHOT_DASH_ACTION_ID,
        ShooterSnapshotEntityU32Field::MeleeActionId => SNAPSHOT_MELEE_ACTION_ID,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sprite_render_command_layout_matches_public_abi() {
        let offsets = [
            sprite_render_command_float_offset(SpriteRenderCommandField::X),
            sprite_render_command_float_offset(SpriteRenderCommandField::Y),
            sprite_render_command_float_offset(SpriteRenderCommandField::Width),
            sprite_render_command_float_offset(SpriteRenderCommandField::Height),
            sprite_render_command_float_offset(SpriteRenderCommandField::U0),
            sprite_render_command_float_offset(SpriteRenderCommandField::V0),
            sprite_render_command_float_offset(SpriteRenderCommandField::U1),
            sprite_render_command_float_offset(SpriteRenderCommandField::V1),
            sprite_render_command_float_offset(SpriteRenderCommandField::R),
            sprite_render_command_float_offset(SpriteRenderCommandField::G),
            sprite_render_command_float_offset(SpriteRenderCommandField::B),
            sprite_render_command_float_offset(SpriteRenderCommandField::A),
            sprite_render_command_float_offset(SpriteRenderCommandField::TextureId),
            sprite_render_command_float_offset(SpriteRenderCommandField::EffectFlags),
            sprite_render_command_float_offset(SpriteRenderCommandField::RotationRadians),
        ];

        assert_eq!(offsets, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
        assert_eq!(crate::sprite_render_command_floats(), offsets.len());
    }

    #[test]
    fn shooter_snapshot_named_layout_matches_public_abi() {
        let header_float_offsets = [
            shooter_snapshot_header_float_offset(
                ShooterSnapshotHeaderFloatField::FireCooldownSeconds,
            ),
            shooter_snapshot_header_float_offset(ShooterSnapshotHeaderFloatField::EnemySpawnTimer),
            shooter_snapshot_header_float_offset(
                ShooterSnapshotHeaderFloatField::WaveElapsedSeconds,
            ),
            shooter_snapshot_header_float_offset(
                ShooterSnapshotHeaderFloatField::CameraElapsedSeconds,
            ),
            shooter_snapshot_header_float_offset(ShooterSnapshotHeaderFloatField::CameraX),
            shooter_snapshot_header_float_offset(ShooterSnapshotHeaderFloatField::CameraY),
            shooter_snapshot_header_float_offset(ShooterSnapshotHeaderFloatField::PreviousMouseX),
            shooter_snapshot_header_float_offset(ShooterSnapshotHeaderFloatField::PreviousMouseY),
        ];
        let header_u32_offsets = [
            shooter_snapshot_header_u32_offset(ShooterSnapshotHeaderU32Field::Version),
            shooter_snapshot_header_u32_offset(ShooterSnapshotHeaderU32Field::GameState),
            shooter_snapshot_header_u32_offset(ShooterSnapshotHeaderU32Field::Score),
            shooter_snapshot_header_u32_offset(ShooterSnapshotHeaderU32Field::SpawnIndex),
            shooter_snapshot_header_u32_offset(ShooterSnapshotHeaderU32Field::ActiveWaveIndex),
            shooter_snapshot_header_u32_offset(ShooterSnapshotHeaderU32Field::WaveSpawnedCount),
        ];
        let entity_float_offsets = [
            shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField::X),
            shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField::Y),
            shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField::VelocityX),
            shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField::VelocityY),
            shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField::Health),
            shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField::Damage),
            shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField::LifetimeSeconds),
            shooter_snapshot_entity_float_offset(
                ShooterSnapshotEntityFloatField::PrimaryActionCooldownDuration,
            ),
            shooter_snapshot_entity_float_offset(
                ShooterSnapshotEntityFloatField::PrimaryActionCooldownRemaining,
            ),
            shooter_snapshot_entity_float_offset(
                ShooterSnapshotEntityFloatField::PrimaryActionProjectileSpeed,
            ),
            shooter_snapshot_entity_float_offset(
                ShooterSnapshotEntityFloatField::PrimaryActionProjectileDamage,
            ),
            shooter_snapshot_entity_float_offset(
                ShooterSnapshotEntityFloatField::PrimaryActionProjectileLifetime,
            ),
            shooter_snapshot_entity_float_offset(
                ShooterSnapshotEntityFloatField::DashCooldownDuration,
            ),
            shooter_snapshot_entity_float_offset(
                ShooterSnapshotEntityFloatField::DashCooldownRemaining,
            ),
            shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField::DashDistance),
            shooter_snapshot_entity_float_offset(
                ShooterSnapshotEntityFloatField::MeleeCooldownDuration,
            ),
            shooter_snapshot_entity_float_offset(
                ShooterSnapshotEntityFloatField::MeleeCooldownRemaining,
            ),
            shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField::MeleeRange),
            shooter_snapshot_entity_float_offset(ShooterSnapshotEntityFloatField::MeleeDamage),
        ];
        let entity_u32_offsets = [
            shooter_snapshot_entity_u32_offset(ShooterSnapshotEntityU32Field::Kind),
            shooter_snapshot_entity_u32_offset(
                ShooterSnapshotEntityU32Field::ScoreRewardOrProjectilePolicy,
            ),
            shooter_snapshot_entity_u32_offset(ShooterSnapshotEntityU32Field::PrimaryActionId),
            shooter_snapshot_entity_u32_offset(ShooterSnapshotEntityU32Field::DashActionId),
            shooter_snapshot_entity_u32_offset(ShooterSnapshotEntityU32Field::MeleeActionId),
        ];

        assert_eq!(header_float_offsets, [0, 1, 2, 3, 4, 5, 6, 7]);
        assert_eq!(header_u32_offsets, [0, 1, 2, 3, 4, 5]);
        assert_eq!(
            entity_float_offsets,
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
        );
        assert_eq!(entity_u32_offsets, [0, 1, 2, 3, 4]);
        assert_eq!(crate::shooter_scene::SHOOTER_SNAPSHOT_HEADER_FLOATS, 8);
        assert_eq!(crate::shooter_scene::SHOOTER_SNAPSHOT_HEADER_U32S, 151);
        assert_eq!(crate::shooter_scene::SHOOTER_SNAPSHOT_ENTITY_FLOATS, 131);
        assert_eq!(crate::shooter_scene::SHOOTER_SNAPSHOT_ENTITY_U32S, 117);
    }
}
