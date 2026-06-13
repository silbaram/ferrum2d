use super::World;
use crate::components::{HeightSpan, PhysicsFloorId, ProjectileArc};
use crate::entity::Entity;

impl World {
    pub fn height_span(&self, entity: Entity) -> Option<HeightSpan> {
        let i = self.valid_index(entity)?;
        self.height_spans[i]
    }

    pub fn set_height_span(&mut self, entity: Entity, span: HeightSpan) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.height_spans[i] = Some(span);
        true
    }

    pub fn set_height_span_parts(
        &mut self,
        entity: Entity,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> bool {
        let Some(span) = HeightSpan::new(PhysicsFloorId(floor_id), elevation, height) else {
            return false;
        };
        self.set_height_span(entity, span)
    }

    pub fn clear_height_span(&mut self, entity: Entity) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.height_spans[i] = None;
        true
    }

    pub fn projectile_arc(&self, entity: Entity) -> Option<ProjectileArc> {
        let i = self.valid_index(entity)?;
        self.projectile_arcs[i]
    }

    pub fn set_projectile_arc(&mut self, entity: Entity, arc: ProjectileArc) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.projectile_arcs[i] = Some(arc);
        self.height_spans[i] = arc.height_span();
        true
    }

    pub fn clear_projectile_arc(&mut self, entity: Entity) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.projectile_arcs[i] = None;
        self.height_spans[i] = None;
        true
    }

    pub(crate) fn update_projectile_arc_at(
        &mut self,
        index: usize,
        delta_seconds: f32,
    ) -> Option<HeightSpan> {
        if !self.is_alive_index(index) {
            return None;
        }
        let arc = self.projectile_arcs.get_mut(index)?.as_mut()?;
        let height_span = arc.update(delta_seconds);
        self.height_spans[index] = height_span;
        height_span
    }

    pub(crate) fn height_span_at(&self, index: usize) -> Option<HeightSpan> {
        if !self.alive.get(index).copied().unwrap_or(false) {
            return None;
        }
        self.height_spans.get(index).copied().flatten()
    }

    pub(crate) fn height_spans_allow_at(&self, a_index: usize, b_index: usize) -> bool {
        match (self.height_span_at(a_index), self.height_span_at(b_index)) {
            (Some(a), Some(b)) => a.overlaps(b),
            _ => true,
        }
    }
}
