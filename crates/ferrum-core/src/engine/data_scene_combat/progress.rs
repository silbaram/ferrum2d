//! Cold, versioned combat checkpoints. Texture slots and entity handles never enter persistence.
use super::*;
use crate::components::gameplay::{
    ActionBindingSet, CollisionReactionSet, GameplayFaction, GameplayTimerTrigger, MovementPattern,
};
use crate::components::*;
use std::collections::{BTreeMap, BTreeSet};

const HEADER: usize = 4;
pub(super) const ACTOR: usize = 72;
const PROJECTILE: usize = 25;
const CONTACT: usize = 2;

/// The immutable subset is remembered at opt-in, so unsupported runtime edits cannot be lost.
#[derive(PartialEq)]
pub(super) struct AuthoredDefinition {
    entity: Entity,
    damage: Option<f32>,
    faction: Option<GameplayFaction>,
    tags: Option<crate::components::gameplay::GameplayTags>,
    score_reward: Option<u32>,
    pickup: Option<crate::components::gameplay::Pickup>,
    interaction: Option<crate::components::gameplay::Interaction>,
    variable_triggers: Option<crate::gameplay_variables::GameplayVariableMutationTriggerSet>,
    movement: Option<MovementPattern>,
    timer: Option<GameplayTimerTrigger>,
    actions: Option<ActionBindingSet>,
    reactions: Option<CollisionReactionSet>,
    body: Option<RigidBody>,
    sprite: Option<Sprite>,
    filter: Option<CollisionFilter>,
    collider_material: Option<PhysicsMaterial>,
    aabb: Option<AabbCollider>,
    circle: Option<CircleCollider>,
    oriented_box: Option<OrientedBoxCollider>,
    capsule: Option<CapsuleCollider>,
    edge: Option<EdgeCollider>,
    chain: Option<ChainCollider>,
    polygon: Option<ConvexPolygonCollider>,
    compound: Vec<CompoundCollider>,
    health_present: bool,
    lifetime_present: bool,
}

fn reaction_cooldown(
    reaction: &CollisionReaction,
) -> Option<&crate::components::gameplay::Cooldown> {
    match reaction {
        CollisionReaction::PlaySound { cooldown, .. }
        | CollisionReaction::SpawnParticle { cooldown, .. }
        | CollisionReaction::EmitEffect { cooldown, .. }
        | CollisionReaction::CameraShake { cooldown, .. }
        | CollisionReaction::SpawnPrefab { cooldown, .. } => Some(cooldown),
        _ => None,
    }
}

fn reaction_cooldown_mut(
    reaction: &mut CollisionReaction,
) -> Option<&mut crate::components::gameplay::Cooldown> {
    match reaction {
        CollisionReaction::PlaySound { cooldown, .. }
        | CollisionReaction::SpawnParticle { cooldown, .. }
        | CollisionReaction::EmitEffect { cooldown, .. }
        | CollisionReaction::CameraShake { cooldown, .. }
        | CollisionReaction::SpawnPrefab { cooldown, .. } => Some(cooldown),
        _ => None,
    }
}

impl AuthoredDefinition {
    fn read(world: &World, entity: Entity) -> Self {
        let index = entity.id as usize;
        let actions = world.action_bindings(entity).map(|bindings| {
            let mut normalized = ActionBindingSet::default();
            for mut binding in bindings.iter() {
                binding.cooldown.remaining_seconds = 0.;
                normalized.upsert(binding);
            }
            normalized
        });
        let reactions = world.collision_reactions(entity).map(|mut reactions| {
            for reaction in reactions.iter_mut() {
                if let Some(cooldown) = reaction_cooldown_mut(reaction) {
                    cooldown.remaining_seconds = 0.;
                }
            }
            reactions
        });
        let timer = world.gameplay_timer_trigger(entity).map(|mut timer| {
            timer.remaining_seconds = 0.;
            timer.fired = false;
            timer
        });
        let body = world.rigid_body(entity).map(|mut body| {
            body.enabled = true; // Persisted by the existing progress flags.
            body
        });
        let sprite = world.sprite_at_index(index).map(|mut sprite| {
            // Atlas playback and facing flip are restored by existing animation progress.
            sprite.u0 = 0.;
            sprite.v0 = 0.;
            sprite.u1 = 0.;
            sprite.v1 = 0.;
            sprite
        });
        Self {
            entity,
            damage: world.damage(entity),
            faction: world.gameplay_faction(entity),
            // configure v2 binds the primary actor after retiring old runtime projectiles.
            // Its marker is scene ownership, rather than an authored gameplay tag edit.
            tags: world.gameplay_tags(entity).and_then(|tags| {
                tags.without_tag(crate::components::gameplay::GAMEPLAY_TAG_PRIMARY_ACTOR)
            }),
            score_reward: world.score_reward(entity),
            pickup: world.pickup(entity),
            interaction: world.interaction(entity).map(|mut interaction| {
                interaction.consumed = false;
                interaction
            }),
            variable_triggers: world.gameplay_variable_mutation_triggers(entity),
            movement: world.movement_pattern(entity),
            timer,
            actions,
            reactions,
            body,
            sprite,
            filter: world.collision_filter_at(index),
            collider_material: world.collider_materials[index],
            aabb: world.colliders[index].map(|mut c| {
                c.enabled = true;
                c
            }),
            circle: world.circle_colliders[index].map(|mut c| {
                c.enabled = true;
                c
            }),
            oriented_box: world.oriented_box_colliders[index].map(|mut c| {
                c.enabled = true;
                c
            }),
            capsule: world.capsule_colliders[index].map(|mut c| {
                c.enabled = true;
                c
            }),
            edge: world.edge_colliders[index].map(|mut c| {
                c.enabled = true;
                c
            }),
            chain: world.chain_colliders[index].map(|mut c| {
                c.enabled = true;
                c
            }),
            polygon: world.convex_polygon_colliders[index].map(|mut c| {
                c.enabled = true;
                c
            }),
            compound: world.compound_colliders[index]
                .iter()
                .copied()
                .map(|mut c| {
                    if world.compound_collider_count(entity) == 1 {
                        match &mut c.shape {
                            CompoundColliderShape::Aabb(s) => s.enabled = true,
                            CompoundColliderShape::Circle(s) => s.enabled = true,
                            CompoundColliderShape::OrientedBox(s) => s.enabled = true,
                            CompoundColliderShape::Capsule(s) => s.enabled = true,
                            CompoundColliderShape::Edge(s) => s.enabled = true,
                            CompoundColliderShape::Chain(s) => s.enabled = true,
                            CompoundColliderShape::ConvexPolygon(s) => s.enabled = true,
                        }
                    }
                    c
                })
                .collect(),
            health_present: world.health(entity).is_some(),
            lifetime_present: world.gameplay_lifetime(entity).is_some(),
        }
    }
}

pub(super) fn capture_definitions(world: &World) -> Vec<AuthoredDefinition> {
    world
        .alive_indices()
        .iter()
        .filter_map(|&index| world.entity_at_index(index))
        .map(|entity| AuthoredDefinition::read(world, entity))
        .collect()
}

pub(super) struct Packet<'a> {
    pub version: u32,
    pub spawned: &'a [f64],
    pub next_serial: Option<u32>,
    pub actors: &'a [f64],
    pub projectiles: &'a [f64],
    pub contacts: &'a [f64],
    pub projectile_stride: usize,
}

impl Packet<'_> {
    pub(super) fn shots(&self) -> std::slice::ChunksExact<'_, f64> {
        self.projectiles.chunks_exact(self.projectile_stride)
    }
    pub(super) fn spawn_count(&self) -> usize {
        self.spawned.len() / super::spawn_checkpoint::STRIDE
    }
    fn live_spawn_count(&self) -> usize {
        self.spawned
            .chunks_exact(super::spawn_checkpoint::STRIDE)
            .filter(|r| r[2] != 0.)
            .count()
    }
}

fn prefab_id(record: &[f64]) -> u32 {
    record.get(25).copied().unwrap_or(0.) as u32
}

pub(super) fn integer(value: f64, max: usize) -> Option<usize> {
    (value.is_finite() && value >= 0. && value <= max as f64 && value.fract() == 0.)
        .then_some(value as usize)
}
pub(super) fn flag(value: f64) -> bool {
    value == 0. || value == 1.
}
pub(super) fn finite(value: f64) -> bool {
    value.is_finite() && (value as f32).is_finite()
}
fn nonnegative(value: f64) -> bool {
    finite(value) && value >= 0.
}
pub(super) fn span(record: &[f64], offset: usize) -> Option<HeightSpan> {
    HeightSpan::new(
        PhysicsFloorId(integer(record[offset], u32::MAX as usize)? as u32),
        record[offset + 1] as f32,
        record[offset + 2] as f32,
    )
    .filter(|s| s.top().is_finite())
}

fn decode<'a>(states: &[u32], values: &'a [f64]) -> Option<Packet<'a>> {
    if values.len() < HEADER
        || ![1., 2., 3., 4.].contains(&values[0])
        || states.len() > MAX_COMBAT_ENTITIES
        || integer(values[1], MAX_COMBAT_ENTITIES)? != states.len()
    {
        return None;
    }
    let projectile_stride = if values[0] == 4. {
        super::projectile_visuals::SHOT
    } else if values[0] == 1. {
        PROJECTILE
    } else {
        PROJECTILE + 1
    };
    let projectiles = integer(values[2], MAX_PROJECTILES)?;
    let contacts = integer(values[3], MAX_PAIRS)?;
    let (header, spawn_count, next_serial) = if values[0] == 4. {
        if values.len() < 7 || !flag(values[6]) {
            return None;
        }
        let count = integer(values[4], super::spawn_prefabs::MAX_RECORDS)?;
        let serial = integer(values[5], u32::MAX as usize)? as u32;
        if values[6] == 0. && (count != 0 || serial != 0) {
            return None;
        }
        (7, count, (values[6] == 1.).then_some(serial))
    } else if values[0] == 3. {
        if values.len() < 6 {
            return None;
        }
        (
            6,
            integer(values[4], super::spawn_prefabs::MAX_RECORDS)?,
            Some(integer(values[5], u32::MAX as usize)? as u32),
        )
    } else {
        (HEADER, 0, None)
    };
    let actor_end = header + states.len().checked_mul(ACTOR)?;
    let spawn_end =
        actor_end.checked_add(spawn_count.checked_mul(super::spawn_checkpoint::STRIDE)?)?;
    let projectile_end = spawn_end.checked_add(projectiles.checked_mul(projectile_stride)?)?;
    if projectile_end.checked_add(contacts.checked_mul(CONTACT)?)? != values.len()
        || values.iter().any(|&v| !finite(v))
    {
        return None;
    }
    let actors = &values[header..actor_end];
    for (record, &state) in actors.chunks_exact(ACTOR).zip(states) {
        validate_actor_record(record, state)?;
    }
    let spawned = &values[actor_end..spawn_end];
    let shots = &values[spawn_end..projectile_end];
    let live_spawn_count = super::spawn_checkpoint::validate_records(
        spawned,
        shots,
        projectile_stride,
        states.len(),
        next_serial,
    )?;
    if states.iter().filter(|&&s| s != 0).count() + live_spawn_count + projectiles
        > MAX_COMBAT_ENTITIES
    {
        return None;
    }
    let actor_count = states.len() + spawn_count;
    for record in shots.chunks_exact(projectile_stride) {
        if projectile_stride == super::projectile_visuals::SHOT {
            let p = &record[super::projectile_visuals::PLAYBACK..];
            if !flag(p[0])
                || p[2] < 0.
                || p[3..].iter().any(|&v| !flag(v))
                || (p[0] == 0. && p[1..].iter().any(|&v| v != 0.))
            {
                return None;
            }
            integer(p[1], 65535)?;
        }
        let prefab = if projectile_stride > PROJECTILE {
            integer(record[25], super::prefabs::MAX_PREFABS)?
        } else {
            0
        };
        integer(record[0], actor_count.checked_sub(1)?)?;
        if record[1].abs() > 1_000_000.
            || record[2].abs() > 1_000_000.
            || record[8] as f32 <= 0.
            || !nonnegative(record[9])
            || !flag(record[10])
            || (prefab == 0 && (record[11] != 4. || record[12] != 4.))
            || [11, 12]
                .into_iter()
                .any(|i| record[i] as f32 <= 0. || record[i] > 10_000.)
            || record[17] as f32 <= 0.
            || record[18] as f32 <= 0.
            || record[19] as f32 <= 0.
            || record[19] > 10_000.
            || !(0.0..=1.0).contains(&record[20])
            || !flag(record[22])
        {
            return None;
        }
        let height = span(record, 5)?;
        if !(height.elevation + record[21] as f32).is_finite() {
            return None;
        }
        // Atlas animation flips are represented by reversed UV endpoints.
        if record[13..17].iter().any(|v| !(0.0..=1.0).contains(v))
            || record[13] as f32 == record[15] as f32
            || record[14] as f32 == record[16] as f32
        {
            return None;
        }
        let faction = integer(record[23], 31)?;
        integer(record[24], u32::MAX as usize)?;
        if record[22] == 0. && (faction != 0 || record[24] != 0.) {
            return None;
        }
    }
    let contact_values = &values[projectile_end..];
    let mut previous = None;
    for record in contact_values.chunks_exact(CONTACT) {
        let a = integer(record[0], actor_count.checked_sub(1)?)?;
        let b = integer(record[1], actor_count.checked_sub(1)?)?;
        let alive = |i: usize| {
            if i < states.len() {
                states[i] != 0
            } else {
                spawned[(i - states.len()) * super::spawn_checkpoint::STRIDE + 2] != 0.
            }
        };
        if a >= b || !alive(a) || !alive(b) || previous.is_some_and(|p| p >= (a, b)) {
            return None;
        }
        previous = Some((a, b));
    }
    Some(Packet {
        version: values[0] as u32,
        spawned,
        next_serial,
        actors,
        projectiles: shots,
        contacts: contact_values,
        projectile_stride,
    })
}

fn handles_map(handles: &[u32]) -> Option<BTreeMap<(u32, u32), usize>> {
    if !handles.len().is_multiple_of(2) || handles.len() / 2 > MAX_COMBAT_ENTITIES {
        return None;
    }
    let mut map = BTreeMap::new();
    let mut ids = BTreeSet::new();
    for (index, h) in handles.chunks_exact(2).enumerate() {
        if h[0] as usize >= MAX_COMBAT_ENTITIES || !ids.insert(h[0]) {
            return None;
        }
        map.insert((h[0], h[1]), index);
    }
    Some(map)
}
pub(super) fn entity(handles: &[u32], index: usize) -> Entity {
    Entity {
        id: handles[index * 2],
        generation: handles[index * 2 + 1],
    }
}

fn supported_authored(world: &World, e: Entity) -> bool {
    world.rigid_body(e).is_none_or(|body| {
        body.body_type != RigidBodyType::Dynamic
            && body.force == Velocity::default()
            && body.impulse == Velocity::default()
            && body.torque == 0.
            && body.angular_impulse == 0.
    }) && (world.height_span(e).is_none() || world.rigid_body(e).is_some())
        && world.behavior_state_machine(e).is_none()
        && world.behavior_state_enter_actions(e).is_none()
        && world.projectile_arc(e).is_none()
}

#[wasm_bindgen]
impl Engine {
    /// Additive semantic combat-checkpoint capability. Existing progress/render strides are unchanged.
    pub fn data_scene_combat_progress_version(&self) -> u32 {
        4
    }

    /// Cold numeric protocols v1/v2 retain their layouts; v3 adds spawned actor records.
    pub fn capture_data_scene_combat_progress(&self, epoch: u32, handles: &[u32]) -> Vec<f64> {
        self.capture_combat_checkpoint(epoch, handles)
            .unwrap_or_default()
    }

    /// Pure structural preflight, including removed authored sources, independent of the active scene.
    pub fn preflight_data_scene_combat_progress(&self, states: &[u32], values: &[f64]) -> bool {
        decode(states, values).is_some()
    }

    /// Preflights both common progress and combat before committing any gameplay state.
    #[allow(clippy::too_many_arguments)]
    pub fn restore_data_scene_progress_with_combat(
        &mut self,
        epoch: u32,
        handles: &[u32],
        states: &[u32],
        animations: &[f64],
        spatial: &[f64],
        environment: &[f32],
        rotations: &[f64],
        apply_environment: bool,
        combat: &[f64],
    ) -> bool {
        if !self.data_scene_combat_enabled()
            || epoch == 0
            || epoch != self.data_scene_epoch()
            || handles.len() != states.len() * 2
            || handles_map(handles).is_none()
            || !self.validate_data_scene_progress_base(handles, states)
        {
            return false;
        }
        let Some(packet) = decode(states, combat) else {
            return false;
        };
        let Some(textures) = self.validate_combat_checkpoint(
            handles,
            &packet,
            spatial,
            rotations,
            environment,
            apply_environment,
        ) else {
            return false;
        };
        // The common path validates every pose, hierarchy, animation, environment and rotation first.
        // On failure it rolls back temporary environment/rotation staging without despawning entities.
        let previous_runtime = std::mem::take(&mut self.spatial_scene.runtime_billboards);
        if !self.restore_data_scene_progress_with_spatial_motion_base(
            epoch,
            handles,
            states,
            animations,
            spatial,
            environment,
            rotations,
            apply_environment,
        ) {
            self.spatial_scene.runtime_billboards = previous_runtime;
            return false;
        }
        self.spatial_scene.runtime_billboards = previous_runtime;
        self.commit_combat_checkpoint(handles, packet, &textures);
        true
    }
}

impl Engine {
    fn capture_combat_checkpoint(&self, epoch: u32, handles: &[u32]) -> Option<Vec<f64>> {
        if !self.data_scene_combat_enabled() || epoch == 0 || epoch != self.data_scene_epoch() {
            return None;
        }
        let mut map = handles_map(handles)?;
        let combat = &self.data_scene.gameplay.combat;
        if combat.checkpoint_authored.len() != map.len()
            || self.world.distance_joint_count()
                + self.world.rope_joint_count()
                + self.world.spring_joint_count()
                + self.world.pulley_joint_count()
                + self.world.revolute_joint_count()
                + self.world.prismatic_joint_count()
                + self.world.weld_joint_count()
                + self.world.gear_joint_count()
                != 0
            || combat.projectiles.len() > MAX_PROJECTILES
        {
            return None;
        }
        for definition in &combat.checkpoint_authored {
            let e = definition.entity;
            if definition
                .body
                .is_some_and(|body| body.body_type == RigidBodyType::Dynamic)
            {
                return None;
            }
            if !map.contains_key(&(e.id, e.generation)) {
                return None;
            }
            if self.world.is_current_entity(e)
                && (!supported_authored(&self.world, e)
                    || *definition != AuthoredDefinition::read(&self.world, e))
            {
                return None;
            }
        }
        for &index in self.world.alive_indices() {
            let e = self.world.entity_at_index(index)?;
            if !map.contains_key(&(e.id, e.generation))
                && !combat.owns_projectile(e)
                && !combat.owns_spawned_actor(e)
            {
                return None;
            }
        }
        let states = self.capture_data_scene_progress(epoch, handles);
        let (spawn_records, spawned_handles) = combat.spawn_prefabs.capture_checkpoint(
            &self.world,
            &self.spatial_scene,
            &combat.projectiles,
        )?;
        let authored_count = map.len();
        for (index, e) in spawned_handles.iter().enumerate() {
            if map
                .insert((e.id, e.generation), authored_count + index)
                .is_some()
            {
                return None;
            }
        }
        let version = if combat.prefabs.has_visuals() {
            4.
        } else if combat.spawn_prefabs.has_definitions() {
            3.
        } else if combat.prefabs.definitions.is_empty() {
            1.
        } else {
            2.
        };
        let mut result = vec![version, authored_count as f64, 0., 0.];
        if version >= 3. {
            result.extend([
                spawned_handles.len() as f64,
                combat.spawn_prefabs.next_serial as f64,
            ]);
            if version == 4. {
                result.push(f64::from(combat.spawn_prefabs.has_definitions()));
            }
        }
        for h in handles.chunks_exact(2) {
            let e = Entity {
                id: h[0],
                generation: h[1],
            };
            let r = capture_actor_record(&self.world, &self.spatial_scene, e)?;
            result.extend(r);
        }
        result.extend(spawn_records);
        let mut count = 0;
        for &(shot, source, prefab_id) in &combat.projectiles {
            if !self.world.is_current_entity(shot) {
                continue;
            }
            let source_index = *map.get(&(source.id, source.generation))?;
            let at = self.world.transform(shot)?;
            let velocity = self.world.velocity(shot)?;
            let span = self.world.height_span(shot)?;
            let sprite = self.world.sprite_at_index(shot.id as usize)?;
            let collider = self.world.collider(shot)?;
            let prefab = combat.prefabs.get(prefab_id);
            if prefab_id != 0 && prefab.is_none() {
                return None;
            }
            let style = if self.spatial_scene.camera.is_some() {
                self.spatial_scene
                    .runtime_billboards
                    .iter()
                    .find(|(e, _)| *e == shot)?
                    .1
            } else {
                // No spatial style is consumed in 2D; its canonical defaults still persist.
                Billboard {
                    material: SpatialMaterial {
                        normal_texture: 16_777_215,
                        flags: 0,
                    },
                    units_per_pixel: prefab.map_or(collider.half_width / 2., |p| p.values[8]),
                    cutoff: prefab.map_or(0.01, |p| p.values[9]),
                    elevation: prefab.map_or(0., |p| p.values[10]),
                }
            };
            let target = self.world.projectile_collision_target_at(shot.id as usize);
            if !canonical_projectile(&self.world, shot, sprite, &style, target, prefab) {
                return None;
            }
            let faction = self.world.gameplay_faction(shot);
            result.extend([
                source_index as f64,
                at.x as f64,
                at.y as f64,
                velocity.vx as f64,
                velocity.vy as f64,
                span.floor.0 as f64,
                span.elevation as f64,
                span.height as f64,
                self.world.gameplay_lifetime(shot)? as f64,
                self.world.damage(shot)? as f64,
                f64::from(target == ProjectileCollisionTarget::Player),
                sprite.width as f64,
                sprite.height as f64,
                sprite.u0 as f64,
                sprite.v0 as f64,
                sprite.u1 as f64,
                sprite.v1 as f64,
                collider.half_width as f64,
                collider.half_height as f64,
                style.units_per_pixel as f64,
                style.cutoff as f64,
                style.elevation as f64,
                f64::from(faction.is_some()),
                faction.map_or(0., |f| f.faction_id as f64),
                faction.map_or(0., |f| f.damage_mask as f64),
            ]);
            if version >= 2. {
                result.push(prefab_id as f64);
            }
            if version == 4. {
                result.extend(super::projectile_visuals::playback_values(
                    self.world.sprite_playbacks[shot.id as usize].as_ref(),
                ));
            }
            count += 1;
        }
        result[2] = count as f64;
        let mut contacts = BTreeSet::new();
        for (a, b) in combat.contacts.checkpoint_contacts() {
            if self.world.is_current_entity(a) && self.world.is_current_entity(b) {
                let (Some(&a), Some(&b)) = (
                    map.get(&(a.id, a.generation)),
                    map.get(&(b.id, b.generation)),
                ) else {
                    continue;
                };
                contacts.insert((a.min(b), a.max(b)));
            }
        }
        if contacts.len() > MAX_PAIRS {
            return None;
        }
        result[3] = contacts.len() as f64;
        for (a, b) in contacts {
            result.extend([a as f64, b as f64]);
        }
        let packet = decode(&states, &result)?;
        combat.spawn_prefabs.validate_checkpoint(&packet)?;
        Some(result)
    }

    fn validate_combat_checkpoint(
        &mut self,
        handles: &[u32],
        packet: &Packet<'_>,
        spatial: &[f64],
        rotations: &[f64],
        environment: &[f32],
        apply_environment: bool,
    ) -> Option<Vec<u32>> {
        if self.world.distance_joint_count()
            + self.world.rope_joint_count()
            + self.world.spring_joint_count()
            + self.world.pulley_joint_count()
            + self.world.revolute_joint_count()
            + self.world.prismatic_joint_count()
            + self.world.weld_joint_count()
            + self.world.gear_joint_count()
            != 0
        {
            return None;
        }
        if spatial.len() != 13 + handles.len() / 2 * 8 || rotations.len() != handles.len() / 2 {
            return None;
        }
        if self.data_scene.gameplay.combat.prefabs.has_visuals() != (packet.version == 4) {
            return None;
        }
        // Full authored handles must be fresh even when their saved state is removed.
        let map = handles_map(handles)?;
        for &index in self.world.alive_indices() {
            let e = self.world.entity_at_index(index)?;
            if !map.contains_key(&(e.id, e.generation))
                && !self.data_scene.gameplay.combat.owns_projectile(e)
                && !self.data_scene.gameplay.combat.owns_spawned_actor(e)
            {
                return None;
            }
        }
        for (index, record) in packet.actors.chunks_exact(ACTOR).enumerate() {
            let e = entity(handles, index);
            if !supported_authored(&self.world, e) {
                return None;
            }
            if record[0] == 0. {
                continue;
            }
            if record[1] != f64::from(!self.spatial_scene.attachments.contains(e)) {
                return None;
            }
            if record[1] == 1. {
                let common = &spatial[13 + index * 8..13 + (index + 1) * 8];
                if common[0] == 1.
                    && (common[1] != record[2]
                        || common[2] != record[3]
                        || common[3] != record[8]
                        || common[4] != record[9]
                        || common[5] != record[10]
                        || common[6] != record[11])
                {
                    return None;
                }
                if self
                    .spatial_scene
                    .models
                    .bindings
                    .contains_key(&(e.id, e.generation))
                    && record[4] != rotations[index]
                {
                    return None;
                }
                if record[8] == 1. && self.world.rigid_body(e).is_none()
                    || record[8] == 0. && self.spatial_scene.actor.is_some_and(|a| a.0 == e)
                {
                    return None;
                }
            }
            validate_actor_contract(&self.world, e, record)?;
        }
        let removed: BTreeSet<_> = packet
            .actors
            .chunks_exact(ACTOR)
            .enumerate()
            .filter(|(_, r)| r[0] == 0.)
            .map(|(i, _)| {
                let e = entity(handles, i);
                (e.id, e.generation)
            })
            .collect();
        let overrides = packet
            .actors
            .chunks_exact(ACTOR)
            .enumerate()
            .filter(|(_, r)| r[1] == 1.)
            .map(|(i, r)| {
                let e = entity(handles, i);
                (
                    (e.id, e.generation),
                    crate::spatial_scene::AttachmentPose {
                        at: Transform2D {
                            x: r[2] as f32,
                            y: r[3] as f32,
                        },
                        span: if r[8] == 1. { span(r, 9) } else { None },
                        yaw: r[4] as f32,
                    },
                )
            })
            .collect();
        if !self.spatial_scene.attachments.preflight(
            &self.world,
            &self.spatial_scene.models,
            &overrides,
            &removed,
        ) {
            return None;
        }
        for (key, pose) in &overrides {
            if self
                .spatial_scene
                .models
                .bindings
                .get(key)
                .is_some_and(|m| {
                    m.pose_at_rotation(pose.at, pose.span.map_or(0., |s| s.elevation), pose.yaw)
                        .is_none()
                })
            {
                return None;
            }
        }
        let spawn_textures = self
            .data_scene
            .gameplay
            .combat
            .spawn_prefabs
            .validate_checkpoint(packet)?;
        let shadows = if apply_environment {
            crate::spatial_scene::SpatialEnvironment::new(environment)?.shadows()
        } else {
            self.spatial_scene.environment.shadows()
        };
        if !self.spatial_scene.shadow_budget_for_runtime(
            &self.world,
            &removed,
            shadows,
            spawn_textures.into_iter(),
        ) {
            return None;
        }
        let movement_count = packet
            .actors
            .chunks_exact(ACTOR)
            .enumerate()
            .filter(|(i, r)| {
                r[0] != 0.
                    && Some(entity(handles, *i)) != self.world.primary_actor_entity()
                    && self.world.movement_pattern(entity(handles, *i)).is_some()
            })
            .count()
            + packet
                .spawned
                .chunks_exact(super::spawn_checkpoint::STRIDE)
                .filter(|r| {
                    r[2] != 0.
                        && self
                            .data_scene
                            .gameplay
                            .combat
                            .spawn_prefabs
                            .definition(r[1] as u32)
                            .is_some_and(|p| p.prototype.movement.is_some())
                })
                .count();
        if movement_count > MAX_ACTORS {
            return None;
        }
        let navigation = &self.data_scene.gameplay.combat.navigation;
        let managed_count = packet
            .actors
            .chunks_exact(ACTOR)
            .enumerate()
            .filter(|(i, r)| {
                r[0] != 0.
                    && Some(entity(handles, *i)) != self.world.primary_actor_entity()
                    && self
                        .world
                        .movement_pattern(entity(handles, *i))
                        .is_some_and(|pattern| navigation.owns(pattern))
            })
            .count()
            + packet
                .spawned
                .chunks_exact(super::spawn_checkpoint::STRIDE)
                .filter(|r| {
                    r[2] != 0.
                        && self
                            .data_scene
                            .gameplay
                            .combat
                            .spawn_prefabs
                            .definition(r[1] as u32)
                            .is_some_and(|p| {
                                p.prototype
                                    .movement
                                    .is_some_and(|pattern| navigation.owns(pattern))
                            })
                })
                .count();
        if managed_count > navigation.actor_capacity() {
            return None;
        }
        let retiring: Vec<_> = packet
            .actors
            .chunks_exact(ACTOR)
            .enumerate()
            .filter(|(_, r)| r[0] == 0.)
            .map(|(index, _)| entity(handles, index))
            .chain(
                self.data_scene
                    .gameplay
                    .combat
                    .projectiles
                    .iter()
                    .map(|(e, _, _)| *e),
            )
            .collect();
        let retiring: Vec<_> = retiring
            .into_iter()
            .chain(
                self.data_scene
                    .gameplay
                    .combat
                    .spawn_prefabs
                    .actors
                    .iter()
                    .map(|a| a.entity),
            )
            .collect();
        if !self.world.can_spawn_checkpoint_entities(
            &retiring,
            packet.projectiles.len() / packet.projectile_stride + packet.live_spawn_count(),
            MAX_COMBAT_ENTITIES,
        ) {
            return None;
        }
        let alive_authored = packet
            .actors
            .chunks_exact(ACTOR)
            .filter(|r| r[0] == 1.)
            .count();
        if alive_authored
            + packet.live_spawn_count()
            + packet.projectiles.len() / packet.projectile_stride
            > MAX_COMBAT_ENTITIES
        {
            return None;
        }
        let mut textures = Vec::with_capacity(packet.projectiles.len() / packet.projectile_stride);
        for record in packet.shots() {
            // Obtain the new asset slot before common progress removes a dead source.
            let source_index = record[0] as usize;
            let source = if source_index < handles.len() / 2 {
                entity(handles, source_index)
            } else {
                self.data_scene
                    .gameplay
                    .combat
                    .spawn_prefabs
                    .source_for_checkpoint(packet, source_index - handles.len() / 2)?
            };
            let prefab_id = prefab_id(record);
            if prefab_id == 0
                && record
                    .get(super::projectile_visuals::PLAYBACK)
                    .is_some_and(|&v| v != 0.)
            {
                return None;
            }
            let texture = if prefab_id == 0 {
                self.world.sprite_at_index(source.id as usize)?.texture_id
            } else {
                let config = &self.data_scene.gameplay.combat.prefabs;
                let prefab = config.get(prefab_id)?;
                if !config.has_source(source, prefab_id) || !prefab_record_matches(record, prefab) {
                    return None;
                }
                prefab.texture
            };
            textures.push(texture);
        }
        Some(textures)
    }

    fn commit_combat_checkpoint(&mut self, handles: &[u32], packet: Packet<'_>, textures: &[u32]) {
        let combat = &mut self.data_scene.gameplay.combat;
        for (shot, _, _) in combat.projectiles.drain(..) {
            self.world.despawn(shot);
        }
        self.spatial_scene.runtime_billboards.clear();
        combat.queue.clear();
        combat.actions.clear();
        combat.pending.clear();
        combat.moved_velocities.clear();
        combat.navigation.reset();
        combat.pairs.clear();
        combat.area_hits.clear();
        combat.marked.fill(false);
        combat.stats = [0; 9];
        for (index, record) in packet.actors.chunks_exact(ACTOR).enumerate() {
            if record[0] == 0. {
                continue;
            }
            let e = entity(handles, index);
            apply_actor_record(&mut self.world, e, record);
        }
        let spawned_handles = combat.spawn_prefabs.restore_checkpoint(
            &mut self.world,
            &mut self.spatial_scene,
            &packet,
        );
        let checkpoint_entity = |index: usize| {
            if index < handles.len() / 2 {
                entity(handles, index)
            } else {
                spawned_handles[index - handles.len() / 2]
            }
        };
        for (record, &texture_id) in packet.shots().zip(textures) {
            let frame = SpriteFrame {
                u0: record[13] as f32,
                v0: record[14] as f32,
                u1: record[15] as f32,
                v1: record[16] as f32,
            };
            let mut template = EntityTemplate::new(record[11] as f32, record[12] as f32)
                .with_frame(record[11] as f32, record[12] as f32, frame);
            template.collider_half_width = record[17] as f32;
            template.collider_half_height = record[18] as f32;
            template.collider_shape = crate::world::EntityTemplateColliderShape::aabb(
                record[17] as f32,
                record[18] as f32,
            );
            let target = if record[10] == 0. {
                ProjectileCollisionTarget::Enemies
            } else {
                ProjectileCollisionTarget::Player
            };
            let faction = if record[22] == 1. {
                GameplayFaction::new(record[23] as u32, record[24] as u32)
            } else {
                None
            };
            let shot = spawn_projectile_entity(
                &mut self.world,
                ProjectileEntitySpawnData {
                    request: ProjectileSpawnRequest {
                        transform: Transform2D {
                            x: record[1] as f32,
                            y: record[2] as f32,
                        },
                        velocity: Velocity {
                            vx: record[3] as f32,
                            vy: record[4] as f32,
                        },
                        texture_id,
                        lifetime: record[8] as f32,
                        template,
                        damage: record[9] as f32,
                        collision_target: target,
                        tile_impact: ProjectileTileImpact::Despawn,
                        source_faction: faction,
                    },
                    arc: None,
                },
            )
            .spawned;
            let prefab_id = prefab_id(record);
            if let Some(prefab) = combat.prefabs.get(prefab_id) {
                prefab.tint(&mut self.world, shot);
                if let Some(playback) = prefab
                    .record_playback(record)
                    .expect("every projectile presentation was validated before commit")
                {
                    if let Some(sprite) = self.world.sprite_mut_at_index(shot.id as usize) {
                        playback.write_sprite(sprite);
                    }
                    self.world.sprite_playbacks[shot.id as usize] = Some(playback);
                }
            }
            if let Some(span) = span(record, 5) {
                self.world.set_height_span(shot, span);
            }
            self.world.add_collision_reaction(
                shot,
                CollisionReaction::Damage {
                    target: CollisionTarget::OtherEntity,
                },
            );
            self.world.add_collision_reaction(
                shot,
                CollisionReaction::Despawn {
                    target: CollisionTarget::SelfEntity,
                },
            );
            self.world.set_collision_filter(
                shot,
                CollisionFilter {
                    category: CollisionMask::BULLET,
                    mask: DataSceneCombat::projectile_mask(target),
                },
            );
            combat
                .projectiles
                .push((shot, checkpoint_entity(record[0] as usize), prefab_id));
            if self.spatial_scene.camera.is_some() {
                self.spatial_scene.runtime_billboards.push((
                    shot,
                    Billboard {
                        material: SpatialMaterial {
                            normal_texture: 16_777_215,
                            flags: 0,
                        },
                        units_per_pixel: record[19] as f32,
                        cutoff: record[20] as f32,
                        elevation: record[21] as f32,
                    },
                ));
            }
        }
        combat.stats[1] = combat.projectiles.len() as u32;
        let contacts: Vec<_> = packet
            .contacts
            .chunks_exact(CONTACT)
            .map(|r| {
                (
                    checkpoint_entity(r[0] as usize),
                    checkpoint_entity(r[1] as usize),
                )
            })
            .collect();
        combat.contacts.restore_checkpoint_contacts(&contacts);
        self.spatial_scene
            .attachments
            .synchronize(&mut self.world, &self.spatial_scene.models);
        self.particles = ParticleSystem::default();
        self.tweens.clear();
        self.input = crate::input::InputState::default();
        self.data_scene.gameplay.observe_input(self.input);
        self.clear_physics_history();
        self.world.clear_rigid_contact_impulses();
        self.world
            .clear_retired_gameplay_variable_mutation_triggers();
        self.physics_counters.clear();
        self.frame_buffers.clear_scene_output();
    }
}

fn canonical_projectile(
    world: &World,
    shot: Entity,
    sprite: Sprite,
    style: &Billboard,
    target: ProjectileCollisionTarget,
    prefab: Option<&super::prefabs::ProjectilePrefab>,
) -> bool {
    let reactions = world.collision_reactions(shot).unwrap_or_default();
    let expected = [
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
        CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        },
    ];
    let Some(collider) = world.collider(shot) else {
        return false;
    };
    let presentation_matches = if let Some(p) = prefab {
        let v = p.values;
        sprite.texture_id == p.texture
            && [
                sprite.width,
                sprite.height,
                collider.half_width,
                collider.half_height,
                style.units_per_pixel,
                style.cutoff,
            ] == [v[0], v[1], v[6], v[7], v[8], v[9]]
            && (p.animation.is_some() || [sprite.u0, sprite.v0, sprite.u1, sprite.v1] == v[2..6])
            && p.playback_matches(world, shot, sprite)
            && [sprite.r, sprite.g, sprite.b, sprite.a] == v[11..15]
    } else {
        sprite.width == 4.
            && sprite.height == 4.
            && sprite.r == 1.
            && sprite.g == 1.
            && sprite.b == 0.2
            && sprite.a == 1.
    };
    presentation_matches
        && sprite.rotation_radians == 0.
        && sprite.render_layer == DEFAULT_SPRITE_RENDER_LAYER
        && sprite.origin_x == 0.5
        && sprite.origin_y == 0.5
        && sprite.sort_order == 0.
        && !sprite.depth_sort
        && !sprite.project_ground
        && style.material.normal_texture == 16_777_215
        && style.material.flags == 0
        && collider.enabled
        && collider.is_trigger
        && collider.offset_x == 0.
        && collider.offset_y == 0.
        && world.compound_collider_count(shot) == 1
        && world.circle_colliders[shot.id as usize].is_none()
        && world.oriented_box_colliders[shot.id as usize].is_none()
        && world.capsule_colliders[shot.id as usize].is_none()
        && world.rigid_body(shot).is_none()
        && world.projectile_arc(shot).is_none()
        && world.edge_colliders[shot.id as usize].is_none()
        && world.chain_colliders[shot.id as usize].is_none()
        && world.convex_polygon_colliders[shot.id as usize].is_none()
        && (prefab.is_some_and(|p| p.animation.is_some())
            || world.sprite_playbacks[shot.id as usize].is_none())
        && world.sprite_animations[shot.id as usize].is_none()
        && world.behavior_state_machine(shot).is_none()
        && world.movement_pattern(shot).is_none()
        && world.action_bindings(shot).is_none()
        && world.gameplay_timer_trigger(shot).is_none()
        && world.health(shot).is_none()
        && world.projectile_tile_impact_at(shot.id as usize) == ProjectileTileImpact::Despawn
        && world.collision_filter_at(shot.id as usize)
            == Some(CollisionFilter {
                category: CollisionMask::BULLET,
                mask: DataSceneCombat::projectile_mask(target),
            })
        && reactions.checkpoint_unguarded()
        && reactions.checkpoint_reactions().eq(expected)
}

pub(super) fn prefab_record_matches(
    record: &[f64],
    prefab: &super::prefabs::ProjectilePrefab,
) -> bool {
    let Some(playback) = prefab.record_playback(record) else {
        return false;
    };
    let mut uv = [
        prefab.values[2],
        prefab.values[3],
        prefab.values[4],
        prefab.values[5],
    ];
    if let Some(playback) = playback {
        let frame = playback.clips[0].frames[playback.frame_index()];
        uv = [
            if playback.flip_x { frame.u1 } else { frame.u0 },
            if playback.flip_y { frame.v1 } else { frame.v0 },
            if playback.flip_x { frame.u0 } else { frame.u1 },
            if playback.flip_y { frame.v0 } else { frame.v1 },
        ];
    }
    [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
        .into_iter()
        .zip([
            prefab.values[0],
            prefab.values[1],
            uv[0],
            uv[1],
            uv[2],
            uv[3],
            prefab.values[6],
            prefab.values[7],
            prefab.values[8],
            prefab.values[9],
        ])
        .all(|(index, expected)| record[index] as f32 == expected)
}

pub(super) fn validate_actor_record(record: &[f64], state: u32) -> Option<()> {
    if state != 0 && (state & 1 == 0 || state & !63 != 0)
        || state & 8 != 0 && state & 4 == 0
        || state & 32 != 0 && state & 16 == 0
    {
        return None;
    }
    if state == 0 {
        if record.iter().any(|&v| v != 0.) {
            return None;
        }
        return Some(());
    }
    if record[0] != 1.
        || !flag(record[1])
        || !flag(record[8])
        || !flag(record[12])
        || !flag(record[14])
        || !flag(record[16])
        || !flag(record[19])
        || record[22..24] != [0., 0.]
    {
        return None;
    }
    if record[1] == 0. && record[2..12].iter().any(|&v| v != 0.) {
        return None;
    }
    if record[2].abs() > 1_000_000. || record[3].abs() > 1_000_000. {
        return None;
    }
    if record[8] == 0. {
        if record[9..12].iter().any(|&v| v != 0.) {
            return None;
        }
    } else {
        span(record, 9)?;
    }
    if !nonnegative(record[13])
        || (record[12] == 0. && record[13] != 0.)
        || !nonnegative(record[15])
        || (record[14] == 0. && record[15] != 0.)
    {
        return None;
    }
    integer(record[17], u32::MAX as usize)?;
    if !nonnegative(record[18])
        || record[16] == 0. && record[17..20].iter().any(|&v| v != 0.)
        || record[19] == 1. && record[18] != 0.
    {
        return None;
    }
    let actions = integer(record[20], 16)?;
    let reactions = integer(record[21], 16)?;
    let mut ids = BTreeSet::new();
    for (index, pair) in record[24..56].chunks_exact(2).enumerate() {
        if index < actions {
            let id = integer(pair[0], u32::MAX as usize)?;
            if id == 0 || !ids.insert(id) || !nonnegative(pair[1]) {
                return None;
            }
        } else if pair != [0., 0.] {
            return None;
        }
    }
    if record[56..].iter().any(|&v| !nonnegative(v))
        || record[56 + reactions..].iter().any(|&v| v != 0.)
    {
        return None;
    }
    Some(())
}

pub(super) fn capture_actor_record(
    world: &World,
    spatial: &SpatialScene,
    e: Entity,
) -> Option<[f64; ACTOR]> {
    let mut r = [0.; ACTOR];
    if world.is_current_entity(e) {
        r[0] = 1.;
        let at = world.transform(e)?;
        // Child transforms remain derived by the existing spatial hierarchy contract.
        if !spatial.attachments.contains(e) {
            r[1] = 1.;
            r[2] = at.x as f64;
            r[3] = at.y as f64;
            r[4] = world.rotation(e).unwrap_or_default().radians as f64;
            let velocity = world.velocity(e).unwrap_or_default();
            r[5] = velocity.vx as f64;
            r[6] = velocity.vy as f64;
            r[7] = world
                .angular_velocity(e)
                .unwrap_or_default()
                .radians_per_second as f64;
            if let Some(span) = world.height_span(e) {
                r[8] = 1.;
                r[9] = span.floor.0 as f64;
                r[10] = span.elevation as f64;
                r[11] = span.height as f64;
            }
        }
        if let Some(health) = world.health(e) {
            r[12] = 1.;
            r[13] = health as f64;
        }
        if let Some(lifetime) = world.gameplay_lifetime(e) {
            r[14] = 1.;
            r[15] = lifetime as f64;
        }
        if let Some(timer) = world.gameplay_timer_trigger(e) {
            r[16] = 1.;
            r[17] = timer.timer_id as f64;
            r[18] = timer.remaining_seconds as f64;
            r[19] = f64::from(timer.fired);
        }
        if let Some(actions) = world.action_bindings(e) {
            for (i, binding) in actions.iter().enumerate() {
                r[20] += 1.;
                r[24 + i * 2] = binding.action_id as f64;
                r[25 + i * 2] = binding.cooldown.remaining_seconds as f64;
            }
        }
        if let Some(reactions) = world.collision_reactions(e) {
            for (i, reaction) in reactions.checkpoint_reactions().enumerate() {
                r[21] += 1.;
                r[56 + i] = reaction_cooldown(&reaction).map_or(0., |c| c.remaining_seconds as f64);
            }
        }
    }
    Some(r)
}

pub(super) fn validate_actor_contract(world: &World, e: Entity, record: &[f64]) -> Option<()> {
    if (record[12] == 1.) != world.health(e).is_some()
        || (record[14] == 1.) != world.gameplay_lifetime(e).is_some()
    {
        return None;
    }
    match (record[16], world.gameplay_timer_trigger(e)) {
        (0., None) => {}
        (1., Some(timer))
            if record[17] == timer.timer_id as f64
                && record[18] <= timer.duration_seconds as f64 => {}
        _ => return None,
    }
    let bindings = world.action_bindings(e).unwrap_or_default();
    if bindings.iter().count() != record[20] as usize {
        return None;
    }
    for pair in record[24..24 + record[20] as usize * 2].chunks_exact(2) {
        let binding = bindings.get(pair[0] as u32)?;
        if pair[1] > binding.cooldown.duration_seconds as f64 {
            return None;
        }
    }
    let reactions = world.collision_reactions(e).unwrap_or_default();
    if reactions.checkpoint_reactions().count() != record[21] as usize {
        return None;
    }
    for (slot, reaction) in reactions.checkpoint_reactions().enumerate() {
        if record[56 + slot]
            > reaction_cooldown(&reaction).map_or(0., |c| c.duration_seconds as f64)
        {
            return None;
        }
    }
    Some(())
}

pub(super) fn apply_actor_record(world: &mut World, e: Entity, record: &[f64]) {
    if record[1] == 1. {
        world.set_transform(
            e,
            Transform2D {
                x: record[2] as f32,
                y: record[3] as f32,
            },
        );
        world.set_rotation(
            e,
            Rotation2D {
                radians: record[4] as f32,
            },
        );
        world.set_velocity(
            e,
            Velocity {
                vx: record[5] as f32,
                vy: record[6] as f32,
            },
        );
        world.set_angular_velocity(
            e,
            AngularVelocity {
                radians_per_second: record[7] as f32,
            },
        );
        if record[8] == 1. {
            if let Some(span) = span(record, 9) {
                world.set_height_span(e, span);
            }
        } else {
            world.clear_height_span(e);
        }
    }
    world.replace_health(e, (record[12] == 1.).then_some(record[13] as f32));
    world.replace_gameplay_lifetime(e, (record[14] == 1.).then_some(record[15] as f32));
    if let Some(timer) = world.gameplay_timer_trigger_mut_at_index(e.id as usize) {
        timer.remaining_seconds = record[18] as f32;
        timer.fired = record[19] == 1.;
    }
    for pair in record[24..24 + record[20] as usize * 2].chunks_exact(2) {
        if let Some(mut binding) = world.action_binding(e, pair[0] as u32) {
            binding.cooldown.remaining_seconds = pair[1] as f32;
            world.upsert_action_binding(e, binding);
        }
    }
    if let Some((_, reactions)) = world.collision_reactions_mut(e) {
        for (slot, reaction) in reactions.iter_mut().enumerate() {
            if let Some(cooldown) = reaction_cooldown_mut(reaction) {
                cooldown.remaining_seconds = record[56 + slot] as f32;
            }
        }
    }
}
