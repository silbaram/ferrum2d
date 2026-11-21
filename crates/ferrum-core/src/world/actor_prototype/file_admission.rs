//! Owned captured actor payloads. Source/target handles are historical tokens;
//! no current World, component replacement, spawn or renderer is involved.
use super::*;
use crate::components::gameplay::file_payload;
use crate::components::SpriteNineSlice;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
impl ActorPrototype {
    pub(crate) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            source: _,
            origin: _,
            sprite: _,
            normal_material: _,
            lighting_material: _,
            surface_material: _,
            light_masks: _,
            nine_slice: _,
            animation: _,
            playback: _,
            shadow: _,
            velocity: _,
            rotation: _,
            angular_velocity: _,
            height_span: _,
            body: _,
            aabb: _,
            circle: _,
            oriented_box: _,
            capsule: _,
            edge: _,
            chain: _,
            polygon: _,
            compound: _,
            material: _,
            filter: _,
            lifetime: _,
            health: _,
            damage: _,
            reward: _,
            faction: _,
            tags: _,
            actions: _,
            pickup: _,
            interaction: _,
            movement: _,
            reactions: _,
            timer: _,
            variable_triggers: _,
        } = self;
        b.work(39)?;
        require(
            finite(&[self.origin.x, self.origin.y]),
            "actor_prototype",
            "origin",
            0,
            Problem::Number,
        )?;
        if let Some(v) = self.sprite {
            b.work(32)?;
            require(
                finite(&[
                    v.width,
                    v.height,
                    v.u0,
                    v.v0,
                    v.u1,
                    v.v1,
                    v.r,
                    v.g,
                    v.b,
                    v.a,
                    v.rotation_radians,
                    v.origin_x,
                    v.origin_y,
                    v.sort_order,
                ]),
                "actor_prototype",
                "sprite",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.normal_material {
            b.work(8)?;
            require(
                v.flags == 0 && v.normal_texture <= crate::render_command::SPRITE_NORMAL_NONE,
                "actor_prototype",
                "normal_material",
                0,
                Problem::Layout,
            )?;
        }
        if let Some(v) = self.lighting_material {
            b.work(16)?;
            require(
                v.mode <= 2
                    && v.alpha_cutoff.is_finite()
                    && (0.0..=1.).contains(&v.alpha_cutoff)
                    && (v.mode == 2 || v.alpha_cutoff == 0.),
                "actor_prototype",
                "lighting",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.light_masks {
            b.work(8)?;
            require(
                v.light_mask <= 255 && v.shadow_mask <= 255,
                "actor_prototype",
                "light_masks",
                0,
                Problem::Range,
            )?;
        }
        if let Some(v) = self.surface_material {
            b.work(32)?;
            require(
                v.flags <= 1
                    && v.reserved == 0
                    && [v.emission_texture, v.specular_texture, v.roughness_texture]
                        .iter()
                        .all(|id| *id <= crate::render_command::SPRITE_SURFACE_TEXTURE_NONE)
                    && v.emission
                        .iter()
                        .all(|v| v.is_finite() && (0.0..=64.).contains(v))
                    && v.specular.is_finite()
                    && (0.0..=1.).contains(&v.specular)
                    && v.roughness.is_finite()
                    && (0.0..=1.).contains(&v.roughness)
                    && (v.flags != 0 || v == Default::default()),
                "actor_prototype",
                "surface_material",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.nine_slice {
            b.work(32)?;
            let record = [
                v.source_width,
                v.source_height,
                v.left,
                v.right,
                v.top,
                v.bottom,
                v.border_scale,
                if v.flip_x { 1. } else { 0. },
                if v.flip_y { 1. } else { 0. },
            ];
            require(
                SpriteNineSlice::from_record(&record) == Some(v),
                "actor_prototype",
                "nine_slice",
                0,
                Problem::Layout,
            )?;
        }
        if let Some(v) = self.animation {
            b.work(512)?;
            require(
                World::file_animation_payload_valid(&v),
                "actor_prototype",
                "animation",
                0,
                Problem::Layout,
            )?;
        }
        if let Some(v) = &self.playback {
            b.work(16)?;
            require(
                !v.clips.is_empty() && v.clips.len() <= 64,
                "actor_prototype",
                "clips",
                0,
                Problem::Length,
            )?;
            b.product(v.clips.len(), 128)?;
            b.product(v.clips.len(), v.clips.len())?;
            let mut total = 0usize;
            for (i, c) in v.clips.iter().enumerate() {
                let lengths = c.saved_payload_lengths();
                let nested = lengths
                    .into_iter()
                    .try_fold(0usize, |a, n| a.checked_add(n))
                    .ok_or(Error::WorkLimit)?;
                b.product(nested, 8)?;
                total = total.checked_add(lengths[0]).ok_or(Error::WorkLimit)?;
                require(
                    total <= sprite_playback::MAX_CLIP_TOTAL_FRAMES
                        && c.admit_saved_payload().is_ok()
                        && !v.clips[..i].iter().any(|p| p.id == c.id),
                    "actor_prototype",
                    "clip_payload",
                    i,
                    Problem::Layout,
                )?;
            }
            require(
                v.active < v.clips.len() && v.elapsed.is_finite() && v.elapsed >= 0.,
                "actor_prototype",
                "playback",
                0,
                Problem::Range,
            )?;
            let c = &v.clips[v.active];
            let duration = c.duration_seconds();
            require(
                duration.is_finite()
                    && duration > 0.
                    && if c.looping {
                        v.elapsed < duration
                    } else {
                        v.elapsed <= duration
                    },
                "actor_prototype",
                "playback_time",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.shadow {
            b.work(128)?;
            require(
                v.saved_payload_valid(),
                "actor_prototype",
                "shadow",
                0,
                Problem::Layout,
            )?;
        }
        if let Some(v) = self.velocity {
            b.work(8)?;
            require(
                finite(&[v.vx, v.vy]),
                "actor_prototype",
                "velocity",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.rotation {
            b.work(4)?;
            require(
                v.radians.is_finite(),
                "actor_prototype",
                "rotation",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.angular_velocity {
            b.work(4)?;
            require(
                v.radians_per_second.is_finite(),
                "actor_prototype",
                "angular_velocity",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.height_span {
            b.work(16)?;
            require(
                HeightSpan::new(v.floor, v.elevation, v.height) == Some(v),
                "actor_prototype",
                "height_span",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.body {
            b.work(64)?;
            require(
                World::file_rigid_body_payload_valid(&v)
                    && v.body_type != crate::components::RigidBodyType::Dynamic
                    && v.force == Velocity::default()
                    && v.impulse == Velocity::default()
                    && v.torque == 0.
                    && v.angular_impulse == 0.,
                "actor_prototype",
                "body",
                0,
                Problem::Number,
            )?;
        }
        b.work(7 * 160)?;
        if let Some(v) = self.aabb {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::Aabb(v)),
                "actor_prototype",
                "aabb",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.circle {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::Circle(v)),
                "actor_prototype",
                "circle",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.oriented_box {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::OrientedBox(v)),
                "actor_prototype",
                "oriented_box",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.capsule {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::Capsule(v)),
                "actor_prototype",
                "capsule",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.edge {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::Edge(v)),
                "actor_prototype",
                "edge",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.chain {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::Chain(v)),
                "actor_prototype",
                "chain",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.polygon {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::ConvexPolygon(v)),
                "actor_prototype",
                "polygon",
                0,
                Problem::Number,
            )?;
        }
        b.vector(&self.compound)?;
        require(
            self.compound.len() <= MAX_ACTOR_PROTOTYPE_COLLIDERS,
            "actor_prototype",
            "compound_count",
            0,
            Problem::Length,
        )?;
        b.product(self.compound.len(), 256)?;
        for (i, c) in self.compound.iter().enumerate() {
            require(
                World::file_shape_payload_valid(&c.shape)
                    && c.material
                        .as_ref()
                        .is_none_or(World::file_material_payload_valid),
                "actor_prototype",
                "compound",
                i,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.material {
            b.work(32)?;
            require(
                World::file_material_payload_valid(&v),
                "actor_prototype",
                "material",
                0,
                Problem::Number,
            )?;
        }
        for (field, value) in [
            ("health", self.health),
            ("damage", self.damage),
            ("lifetime", self.lifetime.map(|v| v.remaining_seconds)),
        ] {
            if let Some(v) = value {
                b.work(2)?;
                require(v.is_finite(), "actor_prototype", field, 0, Problem::Number)?;
            }
        }
        if let Some(v) = self.faction {
            b.work(4)?;
            require(
                v.faction_id <= crate::components::gameplay::GAMEPLAY_FACTION_MAX_ID,
                "actor_prototype",
                "faction",
                0,
                Problem::Range,
            )?;
        }
        if let Some(v) = self.tags {
            b.work(4)?;
            require(
                v.mask != 0 && !v.contains(GAMEPLAY_TAG_PRIMARY_ACTOR),
                "actor_prototype",
                "tags",
                0,
                Problem::Range,
            )?;
        }
        if let Some(v) = self.interaction {
            b.work(16)?;
            require(
                v.radius.is_finite() && v.guard.saved_payload_valid(),
                "actor_prototype",
                "interaction",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.timer {
            b.work(32)?;
            require(
                v.duration_seconds.is_finite()
                    && v.remaining_seconds.is_finite()
                    && v.guard.saved_payload_valid(),
                "actor_prototype",
                "timer",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.movement {
            b.work(32)?;
            require(
                file_payload::movement(v),
                "actor_prototype",
                "movement",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = &self.actions {
            b.work(1024)?;
            require(
                v.admit_saved_layout().is_ok(),
                "actor_prototype",
                "actions_layout",
                0,
                Problem::Layout,
            )?;
            for (i, v) in v.saved_bindings().enumerate() {
                require(
                    file_payload::cooldown(v.cooldown) && file_payload::action(v.pattern),
                    "actor_prototype",
                    "actions",
                    i,
                    Problem::Number,
                )?;
            }
        }
        if let Some(v) = &self.reactions {
            b.work(2048)?;
            require(
                v.admit_saved_layout().is_ok(),
                "actor_prototype",
                "reactions_layout",
                0,
                Problem::Layout,
            )?;
            for (i, v) in v.checkpoint_reactions().enumerate() {
                require(
                    file_payload::reaction(v),
                    "actor_prototype",
                    "reactions",
                    i,
                    Problem::Number,
                )?;
            }
        }
        if let Some(v) = &self.variable_triggers {
            b.work(1024)?;
            require(
                v.admit_saved_layout().is_ok(),
                "actor_prototype",
                "variable_triggers",
                0,
                Problem::Layout,
            )?;
        }
        Ok(())
    }
}

impl ActorPrototype {
    pub(crate) fn file_collision_work(&self, b: &mut Budget) -> Result<u64, Error> {
        b.work(16)?;
        b.product(self.compound.len(), 8)?;
        if !self.compound.is_empty() {
            let mut n = 0u64;
            for c in &self.compound {
                let segments = match &c.shape {
                    CompoundColliderShape::Chain(c) => c.segment_count() as u64,
                    _ => 1,
                };
                n = n.checked_add(segments).ok_or(Error::WorkLimit)?;
            }
            Ok(n)
        } else if self.aabb.is_some()
            || self.circle.is_some()
            || self.oriented_box.is_some()
            || self.capsule.is_some()
            || self.edge.is_some()
        {
            Ok(1)
        } else if let Some(c) = self.chain {
            Ok(c.segment_count() as u64)
        } else {
            Ok(u64::from(self.polygon.is_some()))
        }
    }
}

#[cfg(test)]
mod tests {
    impl super::ActorPrototype {
        pub(crate) fn corrupt_file_prototype_fixture(&mut self) {
            self.sprite.as_mut().unwrap().width = f32::NAN;
        }
    }

    use super::*;
    use crate::components::CollisionLayer;
    use crate::gameplay::file_admission::Limits;
    fn limits() -> Limits {
        Limits {
            max_work: 1_000_000,
            max_scratch_bytes: 1_000_000,
        }
    }
    #[test]
    fn file_gameplay_descriptor_actor_actual_capture_stale_source_and_private_bad_numeric() {
        let mut w = World::default();
        let e = w.spawn_entity();
        w.set_transform(e, Transform2D { x: -0., y: 2. });
        w.set_aabb_collider(e, AabbCollider::new(-1., 2., true, CollisionLayer::Enemy));
        let p = w.actor_prototype(e).unwrap();
        w.despawn(e);
        let old = crate::checkpoint_codec::encode(&p).unwrap();
        let mut b = Budget::new(limits());
        p.validate_file(&mut b).unwrap();
        assert_eq!(p.file_collision_work(&mut b).unwrap(), 1);
        assert_eq!(crate::checkpoint_codec::encode(&p).unwrap(), old);
        let mut d: ActorPrototype = crate::checkpoint_codec::decode(&old).unwrap();
        d.origin.x = f32::NAN;
        let bad = crate::checkpoint_codec::encode(&d).unwrap();
        let r: ActorPrototype = crate::checkpoint_codec::decode(&bad).unwrap();
        assert!(matches!(
            r.validate_file(&mut Budget::new(limits())),
            Err(Error::Invalid { .. })
        ));
        assert_eq!(crate::checkpoint_codec::encode(&r).unwrap(), bad);
    }
}
