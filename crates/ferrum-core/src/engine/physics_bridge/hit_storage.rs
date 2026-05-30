use crate::collision::{
    AabbQueryHit, CircleQueryHit, CollisionContact, CollisionManifold, CollisionQueryShape,
    CollisionSystem, PointQueryHit, RaycastHit, ShapeQueryHit,
};
use crate::components::{CollisionMask, HeightSpan, Velocity};
use crate::entity::Entity;
use crate::tilemap::{TilemapContactHit, TilemapContactManifoldHit, TilemapShapeCastHit};

use super::super::Engine;
use super::{
    PhysicsBodyContactHit, PhysicsBodyManifoldHit, PhysicsQueryEntityHit, PhysicsRaycastBodyHit,
    PhysicsTileContactHit, PhysicsTileManifoldHit, PhysicsTileShapeCastHit,
};

impl Engine {
    pub(in crate::engine) fn store_physics_query_entities_from_point_scratch(&mut self) -> u32 {
        store_point_query_hits(
            &mut self.physics_query_hits,
            &self.physics_point_query_scratch,
        )
    }

    pub(in crate::engine) fn store_physics_query_entities_from_aabb_scratch(&mut self) -> u32 {
        store_aabb_query_hits(
            &mut self.physics_query_hits,
            &self.physics_aabb_query_scratch,
        )
    }

    pub(in crate::engine) fn store_physics_query_entities_from_circle_scratch(&mut self) -> u32 {
        store_circle_query_hits(
            &mut self.physics_query_hits,
            &self.physics_circle_query_scratch,
        )
    }

    pub(in crate::engine) fn store_physics_query_entities_from_shape_scratch(&mut self) -> u32 {
        store_shape_query_hits(
            &mut self.physics_query_hits,
            &self.physics_shape_query_scratch,
        )
    }

    pub(in crate::engine) fn store_physics_raycast_hits_from_scratch(&mut self) -> u32 {
        store_raycast_hits(
            &mut self.physics_raycast_hits,
            self.physics_raycast_scratch.iter().copied(),
        )
    }

    pub(in crate::engine) fn store_physics_shape_cast_hits(
        &mut self,
        shape: CollisionQueryShape,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        CollisionSystem::shape_cast_all_into(
            &self.world,
            shape,
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            CollisionMask::from_bits(query_mask_bits),
            &mut self.physics_shape_cast_scratch,
        );
        self.store_physics_shape_cast_hits_from_scratch()
    }

    pub(in crate::engine) fn store_physics_shape_cast_hits_with_height_span(
        &mut self,
        shape: CollisionQueryShape,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
        query_height_span: HeightSpan,
    ) -> u32 {
        CollisionSystem::shape_cast_all_with_height_span_into(
            &self.world,
            shape,
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            CollisionMask::from_bits(query_mask_bits),
            Some(query_height_span),
            &mut self.physics_shape_cast_scratch,
        );
        self.store_physics_shape_cast_hits_from_scratch()
    }

    pub(in crate::engine) fn store_physics_shape_cast_hits_from_scratch(&mut self) -> u32 {
        self.physics_raycast_hits.clear();
        self.physics_raycast_hits.extend(
            self.physics_shape_cast_scratch
                .iter()
                .copied()
                .map(PhysicsRaycastBodyHit::from_shape_cast_hit),
        );
        u32::try_from(self.physics_raycast_hits.len()).unwrap_or(u32::MAX)
    }

    pub(in crate::engine) fn store_physics_tile_shape_cast_hits_from_scratch(&mut self) -> u32 {
        store_tile_shape_cast_hits(
            &mut self.physics_tile_shape_cast_hits,
            self.physics_tile_shape_cast_scratch.iter().copied(),
        )
    }

    pub(in crate::engine) fn store_physics_tile_contact_hits_from_scratch(&mut self) -> u32 {
        store_tile_contact_hits(
            &mut self.physics_tile_contact_hits,
            self.physics_tile_contact_scratch.iter().copied(),
        )
    }

    pub(in crate::engine) fn store_physics_tile_manifold_hits_from_scratch(&mut self) -> u32 {
        store_tile_manifold_hits(
            &mut self.physics_tile_manifold_hits,
            self.physics_tile_manifold_scratch.iter().copied(),
        )
    }

    pub(in crate::engine) fn store_physics_body_contacts_from_scratch(&mut self) -> u32 {
        store_body_contacts(
            &mut self.physics_body_contact_hits,
            self.physics_body_contact_scratch.iter().copied(),
        )
    }

    pub(in crate::engine) fn store_physics_body_manifolds_from_scratch(&mut self) -> u32 {
        store_body_manifolds(
            &mut self.physics_body_manifold_hits,
            self.physics_body_manifold_scratch.iter().copied(),
        )
    }

    pub(in crate::engine) fn store_physics_shape_query_entities(
        &mut self,
        shape: CollisionQueryShape,
        query_mask_bits: u32,
    ) -> u32 {
        CollisionSystem::shape_query_into(
            &self.world,
            shape,
            CollisionMask::from_bits(query_mask_bits),
            &mut self.physics_shape_query_scratch,
        );
        self.store_physics_query_entities_from_shape_scratch()
    }

    pub(in crate::engine) fn store_physics_shape_query_entities_with_height_span(
        &mut self,
        shape: CollisionQueryShape,
        query_mask_bits: u32,
        query_height_span: HeightSpan,
    ) -> u32 {
        CollisionSystem::shape_query_with_height_span_into(
            &self.world,
            shape,
            CollisionMask::from_bits(query_mask_bits),
            Some(query_height_span),
            &mut self.physics_shape_query_scratch,
        );
        self.store_physics_query_entities_from_shape_scratch()
    }
}

fn store_query_entities<I>(target: &mut Vec<PhysicsQueryEntityHit>, entities: I) -> u32
where
    I: IntoIterator<Item = Entity>,
{
    target.clear();
    target.extend(entities.into_iter().map(PhysicsQueryEntityHit::from_entity));
    u32::try_from(target.len()).unwrap_or(u32::MAX)
}

fn store_point_query_hits(target: &mut Vec<PhysicsQueryEntityHit>, hits: &[PointQueryHit]) -> u32 {
    store_query_entities(target, hits.iter().map(|hit| hit.entity))
}

fn store_aabb_query_hits(target: &mut Vec<PhysicsQueryEntityHit>, hits: &[AabbQueryHit]) -> u32 {
    store_query_entities(target, hits.iter().map(|hit| hit.entity))
}

fn store_circle_query_hits(
    target: &mut Vec<PhysicsQueryEntityHit>,
    hits: &[CircleQueryHit],
) -> u32 {
    store_query_entities(target, hits.iter().map(|hit| hit.entity))
}

fn store_shape_query_hits(target: &mut Vec<PhysicsQueryEntityHit>, hits: &[ShapeQueryHit]) -> u32 {
    store_query_entities(target, hits.iter().map(|hit| hit.entity))
}

fn store_raycast_hits<I>(target: &mut Vec<PhysicsRaycastBodyHit>, hits: I) -> u32
where
    I: IntoIterator<Item = RaycastHit>,
{
    target.clear();
    target.extend(
        hits.into_iter()
            .map(PhysicsRaycastBodyHit::from_raycast_hit),
    );
    u32::try_from(target.len()).unwrap_or(u32::MAX)
}

fn store_tile_shape_cast_hits<I>(target: &mut Vec<PhysicsTileShapeCastHit>, hits: I) -> u32
where
    I: IntoIterator<Item = TilemapShapeCastHit>,
{
    target.clear();
    target.extend(
        hits.into_iter()
            .map(PhysicsTileShapeCastHit::from_tilemap_shape_cast_hit),
    );
    u32::try_from(target.len()).unwrap_or(u32::MAX)
}

fn store_tile_contact_hits<I>(target: &mut Vec<PhysicsTileContactHit>, hits: I) -> u32
where
    I: IntoIterator<Item = TilemapContactHit>,
{
    target.clear();
    target.extend(
        hits.into_iter()
            .map(PhysicsTileContactHit::from_tilemap_contact_hit),
    );
    u32::try_from(target.len()).unwrap_or(u32::MAX)
}

fn store_tile_manifold_hits<I>(target: &mut Vec<PhysicsTileManifoldHit>, hits: I) -> u32
where
    I: IntoIterator<Item = TilemapContactManifoldHit>,
{
    target.clear();
    target.extend(
        hits.into_iter()
            .map(PhysicsTileManifoldHit::from_tilemap_contact_manifold_hit),
    );
    u32::try_from(target.len()).unwrap_or(u32::MAX)
}

fn store_body_contacts<I>(target: &mut Vec<PhysicsBodyContactHit>, contacts: I) -> u32
where
    I: IntoIterator<Item = CollisionContact>,
{
    target.clear();
    target.extend(
        contacts
            .into_iter()
            .map(PhysicsBodyContactHit::from_collision_contact),
    );
    u32::try_from(target.len()).unwrap_or(u32::MAX)
}

fn store_body_manifolds<I>(target: &mut Vec<PhysicsBodyManifoldHit>, manifolds: I) -> u32
where
    I: IntoIterator<Item = CollisionManifold>,
{
    target.clear();
    target.extend(
        manifolds
            .into_iter()
            .map(PhysicsBodyManifoldHit::from_collision_manifold),
    );
    u32::try_from(target.len()).unwrap_or(u32::MAX)
}
