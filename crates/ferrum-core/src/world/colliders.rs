use super::World;
use crate::components::{
    AabbCollider, CapsuleCollider, ChainCollider, CircleCollider, CollisionFilter, CollisionLayer,
    CompoundCollider, CompoundColliderRef, CompoundColliderShape, CompoundColliderShapeRef,
    ConvexPolygonCollider, EdgeCollider, OrientedBoxCollider, PhysicsMaterial,
};
use crate::entity::Entity;

impl World {
    pub fn collider(&self, entity: Entity) -> Option<AabbCollider> {
        let i = self.valid_index(entity)?;
        self.colliders[i]
    }

    pub fn set_aabb_collider(&mut self, entity: Entity, collider: AabbCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = Some(collider);
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = None;
        self.edge_colliders[i] = None;
        self.chain_colliders[i] = None;
        self.convex_polygon_colliders[i] = None;
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
        self.set_primary_compound_collider_at(i, CompoundColliderShape::Aabb(collider));
    }

    pub fn circle_collider(&self, entity: Entity) -> Option<CircleCollider> {
        let i = self.valid_index(entity)?;
        self.circle_colliders[i]
    }

    pub fn set_circle_collider(&mut self, entity: Entity, collider: CircleCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = Some(collider);
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = None;
        self.edge_colliders[i] = None;
        self.chain_colliders[i] = None;
        self.convex_polygon_colliders[i] = None;
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
        self.set_primary_compound_collider_at(i, CompoundColliderShape::Circle(collider));
    }

    pub fn oriented_box_collider(&self, entity: Entity) -> Option<OrientedBoxCollider> {
        let i = self.valid_index(entity)?;
        self.oriented_box_colliders[i]
    }

    pub fn set_oriented_box_collider(&mut self, entity: Entity, collider: OrientedBoxCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = Some(collider);
        self.capsule_colliders[i] = None;
        self.edge_colliders[i] = None;
        self.chain_colliders[i] = None;
        self.convex_polygon_colliders[i] = None;
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
        self.set_primary_compound_collider_at(i, CompoundColliderShape::OrientedBox(collider));
    }

    pub fn capsule_collider(&self, entity: Entity) -> Option<CapsuleCollider> {
        let i = self.valid_index(entity)?;
        self.capsule_colliders[i]
    }

    pub fn set_capsule_collider(&mut self, entity: Entity, collider: CapsuleCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = Some(collider);
        self.edge_colliders[i] = None;
        self.chain_colliders[i] = None;
        self.convex_polygon_colliders[i] = None;
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
        self.set_primary_compound_collider_at(i, CompoundColliderShape::Capsule(collider));
    }

    pub fn edge_collider(&self, entity: Entity) -> Option<EdgeCollider> {
        let i = self.valid_index(entity)?;
        self.edge_colliders[i]
    }

    pub fn set_edge_collider(&mut self, entity: Entity, collider: EdgeCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = None;
        self.edge_colliders[i] = Some(collider);
        self.chain_colliders[i] = None;
        self.convex_polygon_colliders[i] = None;
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
        self.set_primary_compound_collider_at(i, CompoundColliderShape::Edge(collider));
    }

    pub fn convex_polygon_collider(&self, entity: Entity) -> Option<ConvexPolygonCollider> {
        self.convex_polygon_collider_ref(entity).copied()
    }

    pub fn convex_polygon_collider_ref(&self, entity: Entity) -> Option<&ConvexPolygonCollider> {
        let i = self.valid_index(entity)?;
        self.convex_polygon_colliders[i].as_ref()
    }

    pub fn chain_collider(&self, entity: Entity) -> Option<ChainCollider> {
        self.chain_collider_ref(entity).copied()
    }

    pub fn chain_collider_ref(&self, entity: Entity) -> Option<&ChainCollider> {
        let i = self.valid_index(entity)?;
        self.chain_colliders[i].as_ref()
    }

    pub fn set_chain_collider(&mut self, entity: Entity, collider: ChainCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = None;
        self.edge_colliders[i] = None;
        self.chain_colliders[i] = Some(collider);
        self.convex_polygon_colliders[i] = None;
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
        self.set_primary_compound_collider_at(i, CompoundColliderShape::Chain(collider));
    }

    pub fn set_convex_polygon_collider(&mut self, entity: Entity, collider: ConvexPolygonCollider) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = None;
        self.edge_colliders[i] = None;
        self.chain_colliders[i] = None;
        self.convex_polygon_colliders[i] = Some(collider);
        if self.collision_filters[i].is_none() {
            self.collision_filters[i] = Some(CollisionFilter::from_layer(collider.layer));
        }
        self.set_primary_compound_collider_at(i, CompoundColliderShape::ConvexPolygon(collider));
    }

    pub fn clear_collider(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.colliders[i] = None;
        self.circle_colliders[i] = None;
        self.oriented_box_colliders[i] = None;
        self.capsule_colliders[i] = None;
        self.edge_colliders[i] = None;
        self.chain_colliders[i] = None;
        self.convex_polygon_colliders[i] = None;
        self.compound_colliders[i].clear();
        self.collider_materials[i] = None;
        self.collision_filters[i] = None;
    }

    pub fn set_collider_material(&mut self, entity: Entity, material: PhysicsMaterial) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        if self.colliders[i].is_none()
            && self.circle_colliders[i].is_none()
            && self.oriented_box_colliders[i].is_none()
            && self.capsule_colliders[i].is_none()
            && self.edge_colliders[i].is_none()
            && self.chain_colliders[i].is_none()
            && self.convex_polygon_colliders[i].is_none()
        {
            return;
        }
        self.collider_materials[i] = Some(material);
        for collider in &mut self.compound_colliders[i] {
            collider.material = Some(material);
        }
    }

    pub fn clear_collider_material(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.collider_materials[i] = None;
        for collider in &mut self.compound_colliders[i] {
            collider.material = None;
        }
    }

    pub fn collider_material(&self, entity: Entity) -> Option<PhysicsMaterial> {
        let i = self.valid_index(entity)?;
        self.collider_material_at(i)
    }

    pub(crate) fn collider_material_at(&self, index: usize) -> Option<PhysicsMaterial> {
        if self.colliders.get(index).copied().flatten().is_none()
            && self
                .circle_colliders
                .get(index)
                .copied()
                .flatten()
                .is_none()
            && self
                .oriented_box_colliders
                .get(index)
                .copied()
                .flatten()
                .is_none()
            && self
                .capsule_colliders
                .get(index)
                .copied()
                .flatten()
                .is_none()
            && self.edge_colliders.get(index).copied().flatten().is_none()
            && self.chain_colliders.get(index).copied().flatten().is_none()
            && self
                .convex_polygon_colliders
                .get(index)
                .copied()
                .flatten()
                .is_none()
        {
            return None;
        }
        self.collider_materials.get(index).copied().flatten()
    }

    pub fn add_compound_collider(
        &mut self,
        entity: Entity,
        collider: CompoundCollider,
    ) -> Option<u32> {
        let i = self.valid_index(entity)?;
        if self.compound_colliders[i].is_empty() {
            if let Some(primary) = self.primary_compound_collider_at(i) {
                self.compound_colliders[i].push(primary);
            }
        }
        if self.compound_colliders[i].is_empty() {
            self.sync_primary_collider_slots(i, collider.shape);
        }
        self.compound_colliders[i].push(collider);
        Some((self.compound_colliders[i].len() - 1) as u32)
    }

    pub fn set_compound_collider_material(
        &mut self,
        entity: Entity,
        collider_index: u32,
        material: PhysicsMaterial,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        let collider_index = collider_index as usize;
        if collider_index >= self.compound_collider_count_at(i) {
            return false;
        }
        if collider_index == 0 {
            self.collider_materials[i] = Some(material);
        }
        if self.compound_colliders[i].is_empty() {
            if let Some(primary) = self.primary_compound_collider_at(i) {
                self.compound_colliders[i].push(primary);
            }
        }
        let Some(collider) = self.compound_colliders[i].get_mut(collider_index) else {
            return false;
        };
        collider.material = Some(material);
        true
    }

    pub fn compound_collider_count(&self, entity: Entity) -> usize {
        self.valid_index(entity)
            .map(|index| self.compound_collider_count_at(index))
            .unwrap_or(0)
    }

    pub(crate) fn compound_collider_count_at(&self, index: usize) -> usize {
        if index >= self.alive.len() || !self.alive[index] {
            return 0;
        }
        let stored_count = self
            .compound_colliders
            .get(index)
            .map(|colliders| colliders.len())
            .unwrap_or(0);
        if stored_count > 0 {
            stored_count
        } else if self.primary_compound_collider_ref_at(index).is_some() {
            1
        } else {
            0
        }
    }

    pub(crate) fn compound_collider_ref_at(
        &self,
        index: usize,
        collider_index: usize,
    ) -> Option<CompoundColliderRef<'_>> {
        if index >= self.alive.len() || !self.alive[index] {
            return None;
        }
        if let Some(colliders) = self.compound_colliders.get(index) {
            if let Some(collider) = colliders.get(collider_index) {
                return Some(CompoundColliderRef::from_collider(collider));
            }
            if !colliders.is_empty() {
                return None;
            }
        }
        (collider_index == 0)
            .then(|| self.primary_compound_collider_ref_at(index))
            .flatten()
    }

    pub(crate) fn compound_collision_filter_at(
        &self,
        index: usize,
        collider_index: usize,
    ) -> Option<CollisionFilter> {
        let collider = self.compound_collider_ref_at(index, collider_index)?;
        collider
            .filter()
            .or_else(|| self.collision_filters.get(index).copied().flatten())
            .or_else(|| Some(CollisionFilter::from_layer(collider.layer())))
    }

    fn set_primary_compound_collider_at(&mut self, index: usize, shape: CompoundColliderShape) {
        let mut collider = CompoundCollider::new(shape);
        collider.material = self.collider_materials[index];
        collider.filter = self.collision_filters[index];
        if self.compound_colliders[index].is_empty() {
            self.compound_colliders[index].push(collider);
        } else {
            self.compound_colliders[index][0] = collider;
        }
    }

    fn primary_compound_collider_at(&self, index: usize) -> Option<CompoundCollider> {
        self.primary_compound_collider_ref_at(index)
            .map(CompoundColliderRef::to_owned)
    }

    fn primary_compound_collider_ref_at(&self, index: usize) -> Option<CompoundColliderRef<'_>> {
        let material = self.collider_materials.get(index).copied().flatten();
        let filter = self.collision_filters.get(index).copied().flatten();
        if let Some(collider) = self.colliders.get(index).and_then(Option::as_ref) {
            return Some(CompoundColliderRef::new(
                CompoundColliderShapeRef::Aabb(collider),
                material,
                filter,
            ));
        }
        if let Some(collider) = self.circle_colliders.get(index).and_then(Option::as_ref) {
            return Some(CompoundColliderRef::new(
                CompoundColliderShapeRef::Circle(collider),
                material,
                filter,
            ));
        }
        if let Some(collider) = self
            .oriented_box_colliders
            .get(index)
            .and_then(Option::as_ref)
        {
            return Some(CompoundColliderRef::new(
                CompoundColliderShapeRef::OrientedBox(collider),
                material,
                filter,
            ));
        }
        if let Some(collider) = self.capsule_colliders.get(index).and_then(Option::as_ref) {
            return Some(CompoundColliderRef::new(
                CompoundColliderShapeRef::Capsule(collider),
                material,
                filter,
            ));
        }
        if let Some(collider) = self.edge_colliders.get(index).and_then(Option::as_ref) {
            return Some(CompoundColliderRef::new(
                CompoundColliderShapeRef::Edge(collider),
                material,
                filter,
            ));
        }
        if let Some(collider) = self.chain_colliders.get(index).and_then(Option::as_ref) {
            return Some(CompoundColliderRef::new(
                CompoundColliderShapeRef::Chain(collider),
                material,
                filter,
            ));
        }
        if let Some(collider) = self
            .convex_polygon_colliders
            .get(index)
            .and_then(Option::as_ref)
        {
            return Some(CompoundColliderRef::new(
                CompoundColliderShapeRef::ConvexPolygon(collider),
                material,
                filter,
            ));
        }
        None
    }

    fn sync_primary_collider_slots(&mut self, index: usize, shape: CompoundColliderShape) {
        self.colliders[index] = None;
        self.circle_colliders[index] = None;
        self.oriented_box_colliders[index] = None;
        self.capsule_colliders[index] = None;
        self.edge_colliders[index] = None;
        self.chain_colliders[index] = None;
        self.convex_polygon_colliders[index] = None;
        match shape {
            CompoundColliderShape::Aabb(collider) => self.colliders[index] = Some(collider),
            CompoundColliderShape::Circle(collider) => {
                self.circle_colliders[index] = Some(collider)
            }
            CompoundColliderShape::OrientedBox(collider) => {
                self.oriented_box_colliders[index] = Some(collider);
            }
            CompoundColliderShape::Capsule(collider) => {
                self.capsule_colliders[index] = Some(collider);
            }
            CompoundColliderShape::Edge(collider) => self.edge_colliders[index] = Some(collider),
            CompoundColliderShape::Chain(collider) => self.chain_colliders[index] = Some(collider),
            CompoundColliderShape::ConvexPolygon(collider) => {
                self.convex_polygon_colliders[index] = Some(collider);
            }
        }
        if self.collision_filters[index].is_none() {
            self.collision_filters[index] = Some(CollisionFilter::from_layer(match shape {
                CompoundColliderShape::Aabb(collider) => collider.layer,
                CompoundColliderShape::Circle(collider) => collider.layer,
                CompoundColliderShape::OrientedBox(collider) => collider.layer,
                CompoundColliderShape::Capsule(collider) => collider.layer,
                CompoundColliderShape::Edge(collider) => collider.layer,
                CompoundColliderShape::Chain(collider) => collider.layer,
                CompoundColliderShape::ConvexPolygon(collider) => collider.layer,
            }));
        }
    }

    pub fn set_collision_filter(&mut self, entity: Entity, filter: CollisionFilter) {
        let i = entity.id as usize;
        if i >= self.alive.len()
            || !self.alive[i]
            || self.generations[i] != entity.generation
            || (self.colliders[i].is_none()
                && self.circle_colliders[i].is_none()
                && self.oriented_box_colliders[i].is_none()
                && self.capsule_colliders[i].is_none()
                && self.edge_colliders[i].is_none()
                && self.chain_colliders[i].is_none()
                && self.convex_polygon_colliders[i].is_none())
        {
            return;
        }
        self.collision_filters[i] = Some(filter);
        for collider in &mut self.compound_colliders[i] {
            collider.filter = Some(filter);
        }
    }

    pub fn collision_filter(&self, entity: Entity) -> Option<CollisionFilter> {
        let i = entity.id as usize;
        if i >= self.alive.len() || !self.alive[i] || self.generations[i] != entity.generation {
            return None;
        }
        self.collision_filter_at(i)
    }

    pub(crate) fn collider_layer_at(&self, index: usize) -> Option<CollisionLayer> {
        if index >= self.alive.len() || !self.alive[index] {
            return None;
        }
        self.colliders
            .get(index)
            .copied()
            .flatten()
            .map(|collider| collider.layer)
            .or_else(|| {
                self.circle_colliders
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|collider| collider.layer)
            })
            .or_else(|| {
                self.oriented_box_colliders
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|collider| collider.layer)
            })
            .or_else(|| {
                self.capsule_colliders
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|collider| collider.layer)
            })
            .or_else(|| {
                self.edge_colliders
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|collider| collider.layer)
            })
            .or_else(|| {
                self.chain_colliders
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|collider| collider.layer)
            })
            .or_else(|| {
                self.convex_polygon_colliders
                    .get(index)
                    .copied()
                    .flatten()
                    .map(|collider| collider.layer)
            })
    }

    pub(crate) fn collision_filter_at(&self, index: usize) -> Option<CollisionFilter> {
        let layer = self.collider_layer_at(index)?;
        self.collision_filters
            .get(index)
            .copied()
            .flatten()
            .or_else(|| Some(CollisionFilter::from_layer(layer)))
    }
}
