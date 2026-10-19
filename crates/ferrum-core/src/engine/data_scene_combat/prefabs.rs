//! Cold projectile catalog configuration. Names and asset resolution stay in TypeScript.
use super::*;
use std::collections::BTreeMap;

pub(super) const MAX_PREFABS: usize = 256;
const STRIDE: usize = 15;

#[derive(Debug, Clone, PartialEq)]
pub(super) struct ProjectilePrefab {
    pub(super) texture: u32,
    pub(super) values: [f32; STRIDE],
    pub(super) animation: Option<std::sync::Arc<[crate::world::sprite_playback::SpriteClip]>>,
    pub(super) align_velocity: bool,
}

impl ProjectilePrefab {
    pub(super) fn template(&self) -> EntityTemplate {
        let v = self.values;
        let mut template = EntityTemplate::new(v[0], v[1]).with_frame(
            v[0],
            v[1],
            SpriteFrame {
                u0: v[2],
                v0: v[3],
                u1: v[4],
                v1: v[5],
            },
        );
        template.collider_half_width = v[6];
        template.collider_half_height = v[7];
        template.collider_shape = crate::world::EntityTemplateColliderShape::aabb(v[6], v[7]);
        template
    }

    pub(super) fn tint(&self, world: &mut World, entity: Entity) {
        world.sprite_playbacks[entity.id as usize] = self.playback();
        if let Some(sprite) = world.sprite_mut_at_index(entity.id as usize) {
            [sprite.r, sprite.g, sprite.b, sprite.a] = [
                self.values[11],
                self.values[12],
                self.values[13],
                self.values[14],
            ];
        }
    }
}

#[derive(Debug, Default)]
pub(super) struct ProjectilePrefabConfig {
    pub(super) definitions: Vec<ProjectilePrefab>,
    bindings: BTreeMap<(u32, u32, u32), u32>,
}

impl ProjectilePrefabConfig {
    pub(super) fn decode(
        world: &World,
        metadata: &[u32],
        values: &[f32],
        bindings: &[u32],
    ) -> Option<Self> {
        if !metadata.len().is_multiple_of(2)
            || metadata.len() / 2 > MAX_PREFABS
            || values.len() != metadata.len() / 2 * STRIDE
            || !bindings.len().is_multiple_of(4)
            || bindings.len() / 4 > MAX_ACTORS * 16
        {
            return None;
        }
        let mut config = Self::default();
        for (index, (m, v)) in metadata
            .chunks_exact(2)
            .zip(values.chunks_exact(STRIDE))
            .enumerate()
        {
            if m[0] as usize != index + 1
                || m[1] > 0x00ff_ffff
                || v.iter().any(|n| !n.is_finite())
                || [0, 1, 6, 7, 8]
                    .into_iter()
                    .any(|i| v[i] <= 0. || v[i] > 10_000.)
                || v[2..6].iter().any(|n| !(0.0..=1.0).contains(n))
                || v[2] == v[4]
                || v[3] == v[5]
                || !(0.0..=1.0).contains(&v[9])
                || v[10].abs() > 1_000_000.
                || v[11..15].iter().any(|n| !(0.0..=1.0).contains(n))
            {
                return None;
            }
            config.definitions.push(ProjectilePrefab {
                texture: m[1],
                values: v.try_into().ok()?,
                animation: None,
                align_velocity: false,
            });
        }
        for binding in bindings.chunks_exact(4) {
            let entity = Entity {
                id: binding[0],
                generation: binding[1],
            };
            if entity.id as usize >= MAX_COMBAT_ENTITIES
                || !world.is_current_entity(entity)
                || binding[3] == 0
                || binding[3] as usize > config.definitions.len()
                || !world.action_bindings(entity)?.iter().any(|a| {
                    a.action_id == binding[2]
                        && matches!(a.pattern, ActionPattern::Projectile { .. })
                })
                || config
                    .bindings
                    .insert((entity.id, entity.generation, binding[2]), binding[3])
                    .is_some()
            {
                return None;
            }
        }
        Some(config)
    }

    pub(super) fn binding(&self, source: Entity, action_id: u32) -> u32 {
        self.bindings
            .get(&(source.id, source.generation, action_id))
            .copied()
            .unwrap_or(0)
    }

    pub(super) fn has_source(&self, source: Entity, prefab: u32) -> bool {
        self.bindings
            .range((source.id, source.generation, 0)..=(source.id, source.generation, u32::MAX))
            .any(|(_, &id)| id == prefab)
    }

    pub(super) fn get(&self, id: u32) -> Option<&ProjectilePrefab> {
        self.definitions.get(id.checked_sub(1)? as usize)
    }
}

#[wasm_bindgen]
impl Engine {
    /// Static projectile prefab catalog and checkpoint v2 support.
    pub fn data_scene_projectile_prefabs_version(&self) -> u32 {
        1
    }

    /// Atomically configure gameplay plus a numeric prefab catalog and source/action bindings.
    /// Metadata stride 2: id, texture. Value stride 15: size, UVs, collider, billboard, RGBA.
    /// Binding stride 4: entity id, generation, action id, prefab id. IDs are contiguous from 1.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_gameplay_v3(
        &mut self,
        has_actor: bool,
        id: u32,
        generation: u32,
        interaction_input_action: u32,
        combat_enabled: bool,
        metadata: &[u32],
        values: &[f32],
        bindings: &[u32],
    ) -> bool {
        if !combat_enabled {
            return false;
        }
        let Some(config) = ProjectilePrefabConfig::decode(&self.world, metadata, values, bindings)
        else {
            return false;
        };
        // A reconfiguration retires old runtime bullets; they cannot own new bindings.
        if bindings.chunks_exact(4).any(|b| {
            let entity = Entity {
                id: b[0],
                generation: b[1],
            };
            self.data_scene.gameplay.combat.owns_projectile(entity)
                || self.data_scene.gameplay.combat.owns_spawned_actor(entity)
        }) {
            return false;
        }
        if !self.configure_data_scene_gameplay_v2(
            has_actor,
            id,
            generation,
            interaction_input_action,
            combat_enabled,
        ) {
            return false;
        }
        self.data_scene.gameplay.combat.prefabs = config;
        true
    }
}
