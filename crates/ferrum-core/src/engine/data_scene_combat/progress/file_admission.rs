use super::*;
use crate::engine::file_gameplay_authoring_admission::Error as SnapshotError;
use crate::engine::gameplay_authoring::file_admission::BorrowedGameplayPayload;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
impl AuthoredDefinition {
    pub(in crate::engine::data_scene_combat) fn file_entity_key(&self) -> (u32, u32) {
        (self.entity.id, self.entity.generation)
    }
    pub(in crate::engine::data_scene_combat) fn validate_file(
        &self,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            entity: _,
            damage: _,
            faction: _,
            tags: _,
            score_reward: _,
            pickup: _,
            interaction: _,
            variable_triggers: _,
            movement: _,
            timer: _,
            actions: _,
            reactions: _,
            body: _,
            sprite: _,
            filter: _,
            collider_material: _,
            aabb: _,
            circle: _,
            oriented_box: _,
            capsule: _,
            edge: _,
            chain: _,
            polygon: _,
            compound: _,
            health_present: _,
            lifetime_present: _,
        } = self;
        b.work(26)?;
        let gameplay = BorrowedGameplayPayload {
            entity: self.entity,
            health: None,
            damage: self.damage,
            lifetime: None,
            score_reward: self.score_reward,
            faction: self.faction,
            tags: self.tags,
            pickup: self.pickup,
            interaction: self.interaction,
            timer_trigger: self.timer,
            movement: self.movement,
            actions: self.actions.as_ref(),
            collision_reactions: self.reactions.as_ref(),
            variable_mutation_triggers: self.variable_triggers.as_ref(),
        };
        gameplay
            .validate_with_charge(|n| {
                b.work(usize::try_from(n).map_err(|_| SnapshotError::WorkLimit)?)
                    .map_err(|_| SnapshotError::WorkLimit)
            })
            .map_err(|e| match e {
                SnapshotError::WorkLimit => Error::WorkLimit,
                SnapshotError::Invalid { field, index } => Error::Invalid {
                    owner: "authored_definition",
                    field,
                    index,
                    problem: Problem::Layout,
                },
            })?;
        if let Some(v) = self.body {
            b.work(64)?;
            require(
                World::file_rigid_body_payload_valid(&v),
                "authored_definition",
                "body",
                0,
                Problem::Number,
            )?;
        }
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
                "authored_definition",
                "sprite",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.collider_material {
            b.work(32)?;
            require(
                World::file_material_payload_valid(&v),
                "authored_definition",
                "material",
                0,
                Problem::Number,
            )?;
        }
        b.work(7 * 160)?;
        if let Some(v) = self.aabb {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::Aabb(v)),
                "authored_definition",
                "aabb",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.circle {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::Circle(v)),
                "authored_definition",
                "circle",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.oriented_box {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::OrientedBox(v)),
                "authored_definition",
                "oriented_box",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.capsule {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::Capsule(v)),
                "authored_definition",
                "capsule",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.edge {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::Edge(v)),
                "authored_definition",
                "edge",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.chain {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::Chain(v)),
                "authored_definition",
                "chain",
                0,
                Problem::Number,
            )?;
        }
        if let Some(v) = self.polygon {
            require(
                World::file_shape_payload_valid(&CompoundColliderShape::ConvexPolygon(v)),
                "authored_definition",
                "polygon",
                0,
                Problem::Number,
            )?;
        }
        b.vector(&self.compound)?;
        b.product(self.compound.len(), 256)?;
        for (i, v) in self.compound.iter().enumerate() {
            require(
                World::file_shape_payload_valid(&v.shape)
                    && v.material
                        .as_ref()
                        .is_none_or(World::file_material_payload_valid),
                "authored_definition",
                "compound",
                i,
                Problem::Number,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    impl AuthoredDefinition {
        pub(in crate::engine) fn corrupt_file_fixture(&mut self, case: u32) {
            match case {
                16 => self.sprite.as_mut().unwrap().width = f32::NAN,
                17 => self.damage = Some(f32::NAN),
                _ => unreachable!(),
            }
        }
    }
}
