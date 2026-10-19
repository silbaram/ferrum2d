//! Additive native combat codec 3. Persistence uses catalog IDs and serials, never GPU slots/handles.
use super::progress::{
    apply_actor_record, capture_actor_record, flag, integer, validate_actor_contract,
    validate_actor_record, Packet, ACTOR,
};
use super::spawn_prefabs::{SpawnPrefabs, SpawnedActor, MAX_LIVE};
use super::*;
use crate::components::SpriteAnimationKind;
use std::collections::BTreeSet;

// serial / prefab / common state / actor72 / playback6 / legacy4 / visual elevation / birth xy / collider mask
pub(super) const STRIDE: usize = 89;
const PLAYBACK: usize = 3 + ACTOR;
const LEGACY: usize = PLAYBACK + 6;
const ELEVATION: usize = LEGACY + 4;
const ORIGIN: usize = ELEVATION + 1;
const COLLIDERS: usize = ORIGIN + 2;

pub(super) fn validate_records(
    records: &[f64],
    shots: &[f64],
    shot_stride: usize,
    authored: usize,
    next_serial: Option<u32>,
) -> Option<usize> {
    if records.is_empty() {
        return Some(0);
    }
    let next = next_serial?;
    let mut previous = 0;
    let mut live = 0;
    let sources: BTreeSet<_> = shots
        .chunks_exact(shot_stride)
        .map(|r| r[0] as usize)
        .collect();
    for (index, record) in records.chunks_exact(STRIDE).enumerate() {
        let serial = integer(record[0], u32::MAX as usize)? as u32;
        let prefab = integer(record[1], u32::MAX as usize)?;
        let state = integer(record[2], 63)? as u32;
        if serial <= previous || serial > next || prefab == 0 {
            return None;
        }
        previous = serial;
        validate_actor_record(&record[3..PLAYBACK], state)?;
        if state == 0 {
            if record[3..].iter().any(|&v| v != 0.) || !sources.contains(&(authored + index)) {
                return None;
            }
            continue;
        }
        live += 1;
        if live > MAX_LIVE
            || record[4] != 1.
            || record[ORIGIN].abs() > 1_000_000.
            || record[ORIGIN + 1].abs() > 1_000_000.
        {
            return None;
        }
        let playback = &record[PLAYBACK..LEGACY];
        if !flag(playback[0])
            || playback[2] < 0.
            || playback[3..].iter().any(|&v| !flag(v))
            || (playback[0] == 0. && playback[1..].iter().any(|&v| v != 0.))
        {
            return None;
        }
        integer(playback[1], 65535)?;
        let legacy = &record[LEGACY..ELEVATION];
        if !flag(legacy[0])
            || !flag(legacy[1])
            || legacy[3] < 0.
            || (legacy[0] == 0. && legacy[1..].iter().any(|&v| v != 0.))
        {
            return None;
        }
        integer(legacy[2], u32::MAX as usize)?;
        integer(record[COLLIDERS], (1 << 16) - 1)?;
    }
    Some(live)
}

impl SpawnPrefabs {
    pub(super) fn capture_checkpoint(
        &self,
        world: &World,
        spatial: &SpatialScene,
        projectiles: &[(Entity, Entity, u32)],
    ) -> Option<(Vec<f64>, Vec<Entity>)> {
        let sources: BTreeSet<_> = projectiles
            .iter()
            .filter(|(shot, _, _)| world.is_current_entity(*shot))
            .map(|(_, source, _)| (source.id, source.generation))
            .collect();
        let mut values = Vec::with_capacity(self.actors.len() * STRIDE);
        let mut handles = Vec::with_capacity(self.actors.len());
        for actor in &self.actors {
            let live = world.is_current_entity(actor.entity);
            if !live && !sources.contains(&(actor.entity.id, actor.entity.generation)) {
                continue;
            }
            let prefab = self.definition(actor.prefab)?;
            let mut record = [0.; STRIDE];
            record[0] = actor.serial as f64;
            record[1] = actor.prefab as f64;
            if live {
                if !prefab
                    .prototype
                    .matches_instance(world, actor.entity, actor.origin)
                    || spatial.attachments.contains(actor.entity)
                    || spatial
                        .models
                        .bindings
                        .contains_key(&(actor.entity.id, actor.entity.generation))
                {
                    return None;
                }
                // Full common flags, with compound collider flags in their own bounded bit mask.
                record[2] = f64::from(common_state(world, actor.entity));
                record[3..PLAYBACK].copy_from_slice(&capture_actor_record(
                    world,
                    spatial,
                    actor.entity,
                )?);
                if let Some(playback) = &world.sprite_playbacks[actor.entity.id as usize] {
                    record[PLAYBACK..LEGACY].copy_from_slice(&[
                        1.,
                        playback.clips[playback.active].id as f64,
                        playback.elapsed,
                        f64::from(playback.paused),
                        f64::from(playback.flip_x),
                        f64::from(playback.flip_y),
                    ]);
                }
                if let Some(animation) = world.sprite_animations[actor.entity.id as usize] {
                    record[LEGACY..ELEVATION].copy_from_slice(&[
                        1.,
                        f64::from(animation.current_state == SpriteAnimationKind::Moving),
                        animation.current_frame as f64,
                        animation.elapsed_seconds as f64,
                    ]);
                }
                match (
                    prefab.billboard,
                    spatial
                        .runtime_billboards
                        .iter()
                        .find(|(e, _)| *e == actor.entity),
                ) {
                    (None, None) => {}
                    (Some(style), Some((_, actual)))
                        if style.material == actual.material
                            && style.units_per_pixel == actual.units_per_pixel
                            && style.cutoff == actual.cutoff =>
                    {
                        record[ELEVATION] = actual.elevation as f64
                    }
                    _ => return None,
                }
                record[ORIGIN] = actor.origin.x as f64;
                record[ORIGIN + 1] = actor.origin.y as f64;
                record[COLLIDERS] = world.actor_collider_enabled_mask(actor.entity) as f64;
            }
            values.extend(record);
            handles.push(actor.entity);
        }
        Some((values, handles))
    }

    /// A single cold scratch World validates definitions and saved state, without touching live entities.
    pub(super) fn validate_checkpoint(&self, packet: &Packet<'_>) -> Option<Vec<u32>> {
        if self.has_definitions() != packet.next_serial.is_some() {
            return None;
        }
        let mut scratch = World::default();
        let mut textures = Vec::new();
        let mut movement_count = 0;
        for record in packet.spawned.chunks_exact(STRIDE) {
            let prefab = self.definition(record[1] as u32)?;
            if record[2] == 0. {
                continue;
            }
            if prefab.prototype.movement.is_some() {
                movement_count += 1;
            }
            if movement_count > MAX_ACTORS {
                return None;
            }
            let e = scratch.spawn_actor_prototype(
                &prefab.prototype,
                birth(record),
                prefab.prototype.height_span,
                MAX_COMBAT_ENTITIES,
            )?;
            let actor = &record[3..PLAYBACK];
            validate_actor_contract(&scratch, e, actor)?;
            if actor[12] == 1. && (actor[13] as f32 <= 0. || actor[13] > scratch.health(e)? as f64)
                || actor[14] == 1.
                    && (actor[15] as f32 <= 0. || actor[15] > scratch.gameplay_lifetime(e)? as f64)
                || (actor[8] == 1.) != prefab.prototype.height_span.is_some()
                || (record[2] as u32 & 4 != 0) != scratch.rigid_body(e).is_some()
                || (record[2] as u32 & 16 != 0) != (scratch.compound_collider_count(e) == 1)
                || record[2] as u32 & 2 != 0 && !scratch.interaction(e).is_some_and(|i| i.once)
                || record[COLLIDERS] as u32 >= 1 << scratch.compound_collider_count(e)
                || (record[2] as u32 & 16 != 0
                    && (record[2] as u32 & 32 != 0) != (record[COLLIDERS] as u32 & 1 != 0))
            {
                return None;
            }
            validate_animation(&scratch, e, record)?;
            if let Some(style) = prefab.billboard {
                let elevation = actor[10] as f32 + record[ELEVATION] as f32;
                if !elevation.is_finite() {
                    return None;
                }
                if style.material.flags & 1 != 0 {
                    textures.push(scratch.sprite_at_index(e.id as usize)?.texture_id);
                }
            } else if record[ELEVATION] != 0. {
                return None;
            }
            scratch.despawn(e);
        }
        Some(textures)
    }

    pub(super) fn source_for_checkpoint(
        &self,
        packet: &Packet<'_>,
        index: usize,
    ) -> Option<Entity> {
        let record = packet.spawned.chunks_exact(STRIDE).nth(index)?;
        Some(self.definition(record[1] as u32)?.prototype.source)
    }

    /// Only called after the entire packet, allocator and common scene state were validated.
    pub(super) fn restore_checkpoint(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        packet: &Packet<'_>,
    ) -> Vec<Entity> {
        for actor in self.actors.drain(..) {
            world.despawn(actor.entity);
        }
        self.lineage.fill(None);
        self.next_serial = packet.next_serial.unwrap_or(0);
        let mut handles = Vec::with_capacity(packet.spawn_count());
        for record in packet.spawned.chunks_exact(STRIDE) {
            let serial = record[0] as u32;
            let prefab_id = record[1] as u32;
            let origin = birth(record);
            let prefab = self
                .definition(prefab_id)
                .expect("every checkpoint prefab was validated before commit");
            // Reserved non-world handles identify removed logical sources. They can never alias a live slot.
            let mut e = Entity {
                id: u32::MAX,
                generation: serial,
            };
            if record[2] != 0. {
                // Allocator order, capacity and all prototype definitions were checked before any commit.
                e = world.spawn_actor_prototype(&prefab.prototype, origin, prefab.prototype.height_span, MAX_COMBAT_ENTITIES).expect("checkpoint allocator preflight includes all spawned actors and projectiles");
                apply_actor_record(world, e, &record[3..PLAYBACK]);
                let state = record[2] as u32;
                if let Some(body) = world.rigid_bodies[e.id as usize].as_mut() {
                    body.enabled = state & 8 != 0;
                }
                if let Some(interaction) = world.interaction_mut_at_index(e.id as usize) {
                    interaction.consumed = state & 2 != 0;
                }
                world.apply_actor_collider_enabled_mask(e, record[COLLIDERS] as u32);
                apply_animation(world, e, record);
                if let Some(mut style) = prefab.billboard {
                    style.elevation = record[ELEVATION] as f32;
                    spatial.runtime_billboards.push((e, style));
                }
                self.lineage[e.id as usize] = Some((e.generation, prefab_id));
            }
            self.actors.push(SpawnedActor {
                entity: e,
                serial,
                prefab: prefab_id,
                origin,
            });
            handles.push(e);
        }
        handles
    }
}

fn common_state(world: &World, e: Entity) -> u32 {
    let body = world.rigid_body(e);
    let single = (world.compound_collider_count(e) == 1)
        .then(|| world.compound_collider_ref_at(e.id as usize, 0))
        .flatten();
    1 | (u32::from(world.interaction(e).is_some_and(|i| i.once && i.consumed)) << 1)
        | (u32::from(body.is_some()) << 2)
        | (u32::from(body.is_some_and(|b| b.enabled)) << 3)
        | (u32::from(single.is_some()) << 4)
        | (u32::from(single.is_some_and(|c| c.enabled())) << 5)
}
fn birth(record: &[f64]) -> Transform2D {
    Transform2D {
        x: record[ORIGIN] as f32,
        y: record[ORIGIN + 1] as f32,
    }
}

fn validate_animation(world: &World, e: Entity, record: &[f64]) -> Option<()> {
    let v = &record[PLAYBACK..LEGACY];
    match (&world.sprite_playbacks[e.id as usize], v[0]) {
        (None, 0.) => {}
        (Some(playback), 1.) => {
            let clip = playback.clips.iter().find(|clip| clip.id as f64 == v[1])?;
            let duration = clip.frames.len() as f64 / clip.fps as f64;
            if v[2] > duration || clip.looping && v[2] >= duration {
                return None;
            }
        }
        _ => return None,
    }
    let v = &record[LEGACY..ELEVATION];
    match (world.sprite_animations[e.id as usize], v[0]) {
        (None, 0.) => {}
        (Some(animation), 1.) => {
            let state = if v[1] == 0. {
                animation.idle
            } else {
                animation.moving
            };
            if v[2] >= state.frame_count as f64 || v[3] as f32 >= 1. / state.frames_per_second {
                return None;
            }
        }
        _ => return None,
    }
    Some(())
}
fn apply_animation(world: &mut World, e: Entity, record: &[f64]) {
    let index = e.id as usize;
    if let Some(animation) = &mut world.sprite_animations[index] {
        let v = &record[LEGACY..ELEVATION];
        animation.current_state = if v[1] == 0. {
            SpriteAnimationKind::Idle
        } else {
            SpriteAnimationKind::Moving
        };
        animation.current_frame = v[2] as u32;
        animation.elapsed_seconds = v[3] as f32;
        if let Some(sprite) = &mut world.sprites[index] {
            (sprite.u0, sprite.v0, sprite.u1, sprite.v1) = animation.uv();
        }
    }
    if let Some(playback) = &mut world.sprite_playbacks[index] {
        let v = &record[PLAYBACK..LEGACY];
        if let Some(active) = playback
            .clips
            .iter()
            .position(|clip| clip.id as f64 == v[1])
        {
            playback.active = active;
        }
        playback.elapsed = v[2];
        playback.paused = v[3] == 1.;
        playback.flip_x = v[4] == 1.;
        playback.flip_y = v[5] == 1.;
        if let Some(sprite) = &mut world.sprites[index] {
            playback.write_sprite(sprite);
        }
    }
}
