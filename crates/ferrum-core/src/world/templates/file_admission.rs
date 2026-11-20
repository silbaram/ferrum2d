use super::*;
impl EntityTemplate {
    /// All shapes/animation sequences are fixed arrays; no untrusted Vec scan.
    /// Callers charge this conservative fixed scan before calling the predicate.
    pub(crate) const fn file_payload_work_bound() -> usize {
        4096
    }
    pub(crate) fn file_payload_valid(&self) -> bool {
        let Self {
            sprite_width: _,
            sprite_height: _,
            collider_half_width: _,
            collider_half_height: _,
            collider_offset_x: _,
            collider_offset_y: _,
            collider_enabled: _,
            collider_is_trigger: _,
            collider_material: _,
            collider_shape: _,
            frame: _,
            animation: _,
        } = self;
        let finite = |v: &[f32]| v.iter().all(|x| x.is_finite());
        finite(&[
            self.sprite_width,
            self.sprite_height,
            self.collider_half_width,
            self.collider_half_height,
            self.collider_offset_x,
            self.collider_offset_y,
            self.frame.u0,
            self.frame.v0,
            self.frame.u1,
            self.frame.v1,
        ]) && self
            .collider_material
            .as_ref()
            .is_none_or(super::super::World::file_material_payload_valid)
            && self
                .animation
                .as_ref()
                .is_none_or(super::super::World::file_animation_payload_valid)
            && match &self.collider_shape {
                EntityTemplateColliderShape::Aabb {
                    half_width,
                    half_height,
                } => finite(&[*half_width, *half_height]),
                EntityTemplateColliderShape::Circle { radius } => radius.is_finite(),
                EntityTemplateColliderShape::OrientedBox {
                    half_width,
                    half_height,
                    rotation_radians,
                } => finite(&[*half_width, *half_height, *rotation_radians]),
                EntityTemplateColliderShape::Capsule {
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                    radius,
                } => finite(&[*start_x, *start_y, *end_x, *end_y, *radius]),
                EntityTemplateColliderShape::Edge {
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                } => finite(&[*start_x, *start_y, *end_x, *end_y]),
                EntityTemplateColliderShape::ConvexPolygon {
                    vertices,
                    vertex_count,
                    rotation_radians,
                } => {
                    *vertex_count as usize <= vertices.len()
                        && rotation_radians.is_finite()
                        && vertices.iter().all(|p| finite(&[p.x, p.y]))
                }
            }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_gameplay_shared_template_actual_fixed_payload_and_unused_vertex_reject() {
        let mut t = EntityTemplate::new(-0., -2.);
        assert!(t.file_payload_valid());
        let old = crate::checkpoint_codec::encode(&t).unwrap();
        let d: EntityTemplate = crate::checkpoint_codec::decode(&old).unwrap();
        assert!(d.file_payload_valid());
        assert_eq!(crate::checkpoint_codec::encode(&d).unwrap(), old);
        let mut vertices = [Transform2D { x: 0., y: 0. }; MAX_CONVEX_POLYGON_VERTICES];
        vertices[MAX_CONVEX_POLYGON_VERTICES - 1].y = f32::NAN;
        t.collider_shape = EntityTemplateColliderShape::ConvexPolygon {
            vertices,
            vertex_count: 0,
            rotation_radians: 0.,
        };
        let bad = crate::checkpoint_codec::encode(&t).unwrap();
        let d: EntityTemplate = crate::checkpoint_codec::decode(&bad).unwrap();
        assert!(!d.file_payload_valid());
        assert_eq!(crate::checkpoint_codec::encode(&d).unwrap(), bad);
    }
    #[test]
    fn file_gameplay_shared_template_material_policy_is_exact_world_predicate() {
        let mut t = EntityTemplate::new(3., 4.);
        let mut m = PhysicsMaterial {
            friction: -3.,
            ..Default::default()
        };
        assert!(super::super::super::World::file_material_payload_valid(&m));
        t.collider_material = Some(m);
        assert!(t.file_payload_valid());
        m.density = f32::NAN;
        t.collider_material = Some(m);
        assert!(!t.file_payload_valid());
    }
}
