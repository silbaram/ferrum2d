use super::collision_masks::{CollisionFilter, CollisionLayer};
use super::limits::{MAX_CHAIN_COLLIDER_VERTICES, MAX_CONVEX_POLYGON_VERTICES};
use super::material::PhysicsMaterial;
use super::motion::Transform2D;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AabbCollider {
    pub half_width: f32,
    pub half_height: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl AabbCollider {
    pub const fn new(
        half_width: f32,
        half_height: f32,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            half_width,
            half_height,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x,
            y: transform.y + self.offset_y,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CircleCollider {
    pub radius: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl CircleCollider {
    pub const fn new(radius: f32, is_trigger: bool, layer: CollisionLayer) -> Self {
        Self {
            radius,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x,
            y: transform.y + self.offset_y,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OrientedBoxCollider {
    pub half_width: f32,
    pub half_height: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub rotation_radians: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl OrientedBoxCollider {
    pub const fn new(
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            half_width,
            half_height,
            offset_x: 0.0,
            offset_y: 0.0,
            rotation_radians,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn with_rotation(mut self, rotation_radians: f32) -> Self {
        self.rotation_radians = rotation_radians;
        self
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x,
            y: transform.y + self.offset_y,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CapsuleCollider {
    pub start_x: f32,
    pub start_y: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub radius: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl CapsuleCollider {
    pub const fn new(
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            start_x,
            start_y,
            end_x,
            end_y,
            radius,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn start(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + self.start_x,
            y: transform.y + self.offset_y + self.start_y,
        }
    }

    pub const fn end(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + self.end_x,
            y: transform.y + self.offset_y + self.end_y,
        }
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + (self.start_x + self.end_x) * 0.5,
            y: transform.y + self.offset_y + (self.start_y + self.end_y) * 0.5,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EdgeCollider {
    pub start_x: f32,
    pub start_y: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl EdgeCollider {
    pub const fn new(
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            start_x,
            start_y,
            end_x,
            end_y,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn start(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + self.start_x,
            y: transform.y + self.offset_y + self.start_y,
        }
    }

    pub const fn end(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + self.end_x,
            y: transform.y + self.offset_y + self.end_y,
        }
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + (self.start_x + self.end_x) * 0.5,
            y: transform.y + self.offset_y + (self.start_y + self.end_y) * 0.5,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChainCollider {
    pub vertices: [Transform2D; MAX_CHAIN_COLLIDER_VERTICES],
    pub vertex_count: u32,
    pub looped: bool,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl ChainCollider {
    pub const fn new(
        vertices: [Transform2D; MAX_CHAIN_COLLIDER_VERTICES],
        vertex_count: u32,
        looped: bool,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            vertices,
            vertex_count,
            looped,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub fn vertices(&self) -> &[Transform2D] {
        let vertex_count = (self.vertex_count as usize).min(MAX_CHAIN_COLLIDER_VERTICES);
        &self.vertices[..vertex_count]
    }

    pub fn segment_count(&self) -> usize {
        let vertex_count = self.vertices().len();
        if vertex_count < 2 {
            return 0;
        }
        let closing_segment = if self.looped
            && vertex_count > 2
            && self.vertices[vertex_count - 1] != self.vertices[0]
        {
            1
        } else {
            0
        };
        vertex_count - 1 + closing_segment
    }

    pub fn segment(&self, index: usize) -> Option<EdgeCollider> {
        let vertices = self.vertices();
        let segment_count = self.segment_count();
        if index >= segment_count {
            return None;
        }
        let start = vertices[index];
        let end = if index + 1 < vertices.len() {
            vertices[index + 1]
        } else {
            vertices[0]
        };
        Some(
            EdgeCollider::new(start.x, start.y, end.x, end.y, self.is_trigger, self.layer)
                .with_offset(self.offset_x, self.offset_y)
                .with_enabled(self.enabled),
        )
    }

    pub fn center(&self, transform: Transform2D) -> Transform2D {
        let vertices = self.vertices();
        if vertices.is_empty() {
            return Transform2D {
                x: transform.x + self.offset_x,
                y: transform.y + self.offset_y,
            };
        }
        let (sum_x, sum_y) = vertices
            .iter()
            .fold((0.0, 0.0), |(x, y), vertex| (x + vertex.x, y + vertex.y));
        let scale = 1.0 / vertices.len() as f32;
        Transform2D {
            x: transform.x + self.offset_x + sum_x * scale,
            y: transform.y + self.offset_y + sum_y * scale,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ConvexPolygonCollider {
    pub vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
    pub vertex_count: u32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub rotation_radians: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl ConvexPolygonCollider {
    pub const fn new(
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: u32,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            vertices,
            vertex_count,
            offset_x: 0.0,
            offset_y: 0.0,
            rotation_radians: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn with_rotation(mut self, rotation_radians: f32) -> Self {
        self.rotation_radians = rotation_radians;
        self
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x,
            y: transform.y + self.offset_y,
        }
    }
}

// ChainCollider intentionally keeps a fixed vertex buffer to avoid per-collider
// heap allocation and preserve Copy semantics for low-frequency authoring paths.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CompoundColliderShape {
    Aabb(AabbCollider),
    Circle(CircleCollider),
    OrientedBox(OrientedBoxCollider),
    Capsule(CapsuleCollider),
    Edge(EdgeCollider),
    Chain(ChainCollider),
    ConvexPolygon(ConvexPolygonCollider),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CompoundCollider {
    pub shape: CompoundColliderShape,
    pub material: Option<PhysicsMaterial>,
    pub filter: Option<CollisionFilter>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum CompoundColliderShapeRef<'a> {
    Aabb(&'a AabbCollider),
    Circle(&'a CircleCollider),
    OrientedBox(&'a OrientedBoxCollider),
    Capsule(&'a CapsuleCollider),
    Edge(&'a EdgeCollider),
    Chain(&'a ChainCollider),
    ConvexPolygon(&'a ConvexPolygonCollider),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct CompoundColliderRef<'a> {
    pub(crate) shape: CompoundColliderShapeRef<'a>,
    material: Option<PhysicsMaterial>,
    filter: Option<CollisionFilter>,
}

impl CompoundCollider {
    pub const fn new(shape: CompoundColliderShape) -> Self {
        Self {
            shape,
            material: None,
            filter: None,
        }
    }

    pub const fn with_material(mut self, material: PhysicsMaterial) -> Self {
        self.material = Some(material);
        self
    }

    pub const fn with_filter(mut self, filter: CollisionFilter) -> Self {
        self.filter = Some(filter);
        self
    }

    pub const fn layer(self) -> CollisionLayer {
        match self.shape {
            CompoundColliderShape::Aabb(collider) => collider.layer,
            CompoundColliderShape::Circle(collider) => collider.layer,
            CompoundColliderShape::OrientedBox(collider) => collider.layer,
            CompoundColliderShape::Capsule(collider) => collider.layer,
            CompoundColliderShape::Edge(collider) => collider.layer,
            CompoundColliderShape::Chain(collider) => collider.layer,
            CompoundColliderShape::ConvexPolygon(collider) => collider.layer,
        }
    }

    pub const fn enabled(self) -> bool {
        match self.shape {
            CompoundColliderShape::Aabb(collider) => collider.enabled,
            CompoundColliderShape::Circle(collider) => collider.enabled,
            CompoundColliderShape::OrientedBox(collider) => collider.enabled,
            CompoundColliderShape::Capsule(collider) => collider.enabled,
            CompoundColliderShape::Edge(collider) => collider.enabled,
            CompoundColliderShape::Chain(collider) => collider.enabled,
            CompoundColliderShape::ConvexPolygon(collider) => collider.enabled,
        }
    }

    pub const fn is_trigger(self) -> bool {
        match self.shape {
            CompoundColliderShape::Aabb(collider) => collider.is_trigger,
            CompoundColliderShape::Circle(collider) => collider.is_trigger,
            CompoundColliderShape::OrientedBox(collider) => collider.is_trigger,
            CompoundColliderShape::Capsule(collider) => collider.is_trigger,
            CompoundColliderShape::Edge(collider) => collider.is_trigger,
            CompoundColliderShape::Chain(collider) => collider.is_trigger,
            CompoundColliderShape::ConvexPolygon(collider) => collider.is_trigger,
        }
    }
}

impl<'a> CompoundColliderRef<'a> {
    pub(crate) const fn new(
        shape: CompoundColliderShapeRef<'a>,
        material: Option<PhysicsMaterial>,
        filter: Option<CollisionFilter>,
    ) -> Self {
        Self {
            shape,
            material,
            filter,
        }
    }

    pub(crate) fn from_collider(collider: &'a CompoundCollider) -> Self {
        Self {
            shape: CompoundColliderShapeRef::from_shape(&collider.shape),
            material: collider.material,
            filter: collider.filter,
        }
    }

    pub(crate) const fn material(self) -> Option<PhysicsMaterial> {
        self.material
    }

    pub(crate) const fn filter(self) -> Option<CollisionFilter> {
        self.filter
    }

    pub(crate) const fn layer(self) -> CollisionLayer {
        match self.shape {
            CompoundColliderShapeRef::Aabb(collider) => collider.layer,
            CompoundColliderShapeRef::Circle(collider) => collider.layer,
            CompoundColliderShapeRef::OrientedBox(collider) => collider.layer,
            CompoundColliderShapeRef::Capsule(collider) => collider.layer,
            CompoundColliderShapeRef::Edge(collider) => collider.layer,
            CompoundColliderShapeRef::Chain(collider) => collider.layer,
            CompoundColliderShapeRef::ConvexPolygon(collider) => collider.layer,
        }
    }

    pub(crate) const fn enabled(self) -> bool {
        match self.shape {
            CompoundColliderShapeRef::Aabb(collider) => collider.enabled,
            CompoundColliderShapeRef::Circle(collider) => collider.enabled,
            CompoundColliderShapeRef::OrientedBox(collider) => collider.enabled,
            CompoundColliderShapeRef::Capsule(collider) => collider.enabled,
            CompoundColliderShapeRef::Edge(collider) => collider.enabled,
            CompoundColliderShapeRef::Chain(collider) => collider.enabled,
            CompoundColliderShapeRef::ConvexPolygon(collider) => collider.enabled,
        }
    }

    pub(crate) const fn is_trigger(self) -> bool {
        match self.shape {
            CompoundColliderShapeRef::Aabb(collider) => collider.is_trigger,
            CompoundColliderShapeRef::Circle(collider) => collider.is_trigger,
            CompoundColliderShapeRef::OrientedBox(collider) => collider.is_trigger,
            CompoundColliderShapeRef::Capsule(collider) => collider.is_trigger,
            CompoundColliderShapeRef::Edge(collider) => collider.is_trigger,
            CompoundColliderShapeRef::Chain(collider) => collider.is_trigger,
            CompoundColliderShapeRef::ConvexPolygon(collider) => collider.is_trigger,
        }
    }

    pub(crate) const fn to_owned(self) -> CompoundCollider {
        CompoundCollider {
            shape: self.shape.to_owned(),
            material: self.material,
            filter: self.filter,
        }
    }
}

impl<'a> CompoundColliderShapeRef<'a> {
    pub(crate) const fn from_shape(shape: &'a CompoundColliderShape) -> Self {
        match shape {
            CompoundColliderShape::Aabb(collider) => Self::Aabb(collider),
            CompoundColliderShape::Circle(collider) => Self::Circle(collider),
            CompoundColliderShape::OrientedBox(collider) => Self::OrientedBox(collider),
            CompoundColliderShape::Capsule(collider) => Self::Capsule(collider),
            CompoundColliderShape::Edge(collider) => Self::Edge(collider),
            CompoundColliderShape::Chain(collider) => Self::Chain(collider),
            CompoundColliderShape::ConvexPolygon(collider) => Self::ConvexPolygon(collider),
        }
    }

    pub(crate) const fn to_owned(self) -> CompoundColliderShape {
        match self {
            Self::Aabb(collider) => CompoundColliderShape::Aabb(*collider),
            Self::Circle(collider) => CompoundColliderShape::Circle(*collider),
            Self::OrientedBox(collider) => CompoundColliderShape::OrientedBox(*collider),
            Self::Capsule(collider) => CompoundColliderShape::Capsule(*collider),
            Self::Edge(collider) => CompoundColliderShape::Edge(*collider),
            Self::Chain(collider) => CompoundColliderShape::Chain(*collider),
            Self::ConvexPolygon(collider) => CompoundColliderShape::ConvexPolygon(*collider),
        }
    }
}
