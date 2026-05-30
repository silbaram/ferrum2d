use super::super::queries::{
    tile_aabb_query_is_valid, tile_height_span_allows, tilemap_contact_hit_from_contact,
    tilemap_contact_manifold_hit_from_contact,
};
use super::super::{Tilemap, TilemapContactHit, TilemapContactManifoldHit};
use crate::collision::{AabbBounds, CollisionSystem};
use crate::components::{AabbCollider, HeightSpan, Transform2D};

impl Tilemap {
    pub fn aabb_obstacle_contacts(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
    ) -> Vec<TilemapContactHit> {
        let mut hits = Vec::new();
        self.aabb_obstacle_contacts_into(transform, collider, &mut hits);
        hits
    }

    pub fn aabb_obstacle_contacts_into(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
        hits: &mut Vec<TilemapContactHit>,
    ) {
        self.aabb_obstacle_contacts_with_height_span_into(transform, collider, None, hits);
    }

    pub fn aabb_obstacle_contacts_with_height_span_into(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<TilemapContactHit>,
    ) {
        hits.clear();
        if !tile_aabb_query_is_valid(transform, collider) {
            return;
        }
        let bounds = AabbBounds::from_transform(transform, collider);

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(bounds) else {
                continue;
            };

            self.visit_collision_rect_candidates(layer_index, range, |rect| {
                if !tile_height_span_allows(rect, query_height_span) {
                    return true;
                }
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(bounds) {
                    return true;
                }
                let static_collider = rect.aabb_collider(layer, collider.layer);
                let rect_center = rect.center(layer);
                let Some(contact) = CollisionSystem::aabb_contact(
                    transform,
                    collider,
                    rect_center,
                    static_collider,
                ) else {
                    return true;
                };
                hits.push(tilemap_contact_hit_from_contact(
                    transform,
                    collider,
                    rect_center,
                    static_collider,
                    layer_index,
                    rect.tile_index,
                    contact,
                ));
                true
            });
        }

        hits.sort_by(|a, b| {
            a.layer_index
                .cmp(&b.layer_index)
                .then_with(|| a.tile_index.cmp(&b.tile_index))
        });
    }

    pub fn aabb_obstacle_manifolds(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
    ) -> Vec<TilemapContactManifoldHit> {
        let mut hits = Vec::new();
        self.aabb_obstacle_manifolds_into(transform, collider, &mut hits);
        hits
    }

    pub fn aabb_obstacle_manifolds_into(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
        hits: &mut Vec<TilemapContactManifoldHit>,
    ) {
        self.aabb_obstacle_manifolds_with_height_span_into(transform, collider, None, hits);
    }

    pub fn aabb_obstacle_manifolds_with_height_span_into(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<TilemapContactManifoldHit>,
    ) {
        hits.clear();
        if !tile_aabb_query_is_valid(transform, collider) {
            return;
        }
        let bounds = AabbBounds::from_transform(transform, collider);

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(bounds) else {
                continue;
            };

            self.visit_collision_rect_candidates(layer_index, range, |rect| {
                if !tile_height_span_allows(rect, query_height_span) {
                    return true;
                }
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(bounds) {
                    return true;
                }
                let static_collider = rect.aabb_collider(layer, collider.layer);
                let rect_center = rect.center(layer);
                let Some(contact) = CollisionSystem::aabb_contact(
                    transform,
                    collider,
                    rect_center,
                    static_collider,
                ) else {
                    return true;
                };
                let Some(manifold) = tilemap_contact_manifold_hit_from_contact(
                    transform,
                    collider,
                    rect_center,
                    static_collider,
                    layer_index,
                    rect.tile_index,
                    contact,
                ) else {
                    return true;
                };
                hits.push(manifold);
                true
            });
        }

        hits.sort_by(|a, b| {
            a.layer_index
                .cmp(&b.layer_index)
                .then_with(|| a.tile_index.cmp(&b.tile_index))
        });
    }
}
