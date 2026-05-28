use crate::components::{
    PhysicsMaterial, SpriteAnimation, SpriteFrame, Transform2D, MAX_CONVEX_POLYGON_VERTICES,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EntityTemplate {
    pub sprite_width: f32,
    pub sprite_height: f32,
    pub collider_half_width: f32,
    pub collider_half_height: f32,
    pub collider_offset_x: f32,
    pub collider_offset_y: f32,
    pub collider_enabled: bool,
    pub collider_is_trigger: bool,
    pub collider_material: Option<PhysicsMaterial>,
    pub collider_shape: EntityTemplateColliderShape,
    pub frame: SpriteFrame,
    pub animation: Option<SpriteAnimation>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EntityTemplateCollider {
    pub shape: EntityTemplateColliderShape,
    pub half_width: f32,
    pub half_height: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub material: Option<PhysicsMaterial>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EntityTemplateColliderShape {
    Aabb {
        half_width: f32,
        half_height: f32,
    },
    Circle {
        radius: f32,
    },
    OrientedBox {
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
    },
    Capsule {
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
    },
    Edge {
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
    },
    ConvexPolygon {
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: u32,
        rotation_radians: f32,
    },
}

impl EntityTemplateColliderShape {
    pub const fn aabb(half_width: f32, half_height: f32) -> Self {
        Self::Aabb {
            half_width,
            half_height,
        }
    }

    fn half_extents(self) -> (f32, f32) {
        match self {
            Self::Aabb {
                half_width,
                half_height,
            }
            | Self::OrientedBox {
                half_width,
                half_height,
                ..
            } => (half_width, half_height),
            Self::Circle { radius } => (radius, radius),
            Self::Capsule {
                start_x,
                start_y,
                end_x,
                end_y,
                radius,
            } => {
                let min_x = start_x.min(end_x) - radius;
                let max_x = start_x.max(end_x) + radius;
                let min_y = start_y.min(end_y) - radius;
                let max_y = start_y.max(end_y) + radius;
                ((max_x - min_x) * 0.5, (max_y - min_y) * 0.5)
            }
            Self::Edge {
                start_x,
                start_y,
                end_x,
                end_y,
            } => (
                (start_x.max(end_x) - start_x.min(end_x)) * 0.5,
                (start_y.max(end_y) - start_y.min(end_y)) * 0.5,
            ),
            Self::ConvexPolygon {
                vertices,
                vertex_count,
                ..
            } => {
                let count = (vertex_count as usize).min(MAX_CONVEX_POLYGON_VERTICES);
                if count == 0 {
                    return (0.0, 0.0);
                }
                let mut min_x = vertices[0].x;
                let mut max_x = vertices[0].x;
                let mut min_y = vertices[0].y;
                let mut max_y = vertices[0].y;
                for vertex in vertices.iter().take(count).skip(1) {
                    min_x = min_x.min(vertex.x);
                    max_x = max_x.max(vertex.x);
                    min_y = min_y.min(vertex.y);
                    max_y = max_y.max(vertex.y);
                }
                ((max_x - min_x) * 0.5, (max_y - min_y) * 0.5)
            }
        }
    }
}

impl EntityTemplateCollider {
    pub const fn from_template(template: EntityTemplate) -> Self {
        Self {
            shape: template.collider_shape,
            half_width: template.collider_half_width,
            half_height: template.collider_half_height,
            offset_x: template.collider_offset_x,
            offset_y: template.collider_offset_y,
            enabled: template.collider_enabled,
            is_trigger: template.collider_is_trigger,
            material: template.collider_material,
        }
    }

    pub const fn aabb(
        half_width: f32,
        half_height: f32,
        offset_x: f32,
        offset_y: f32,
        enabled: bool,
        is_trigger: bool,
        material: Option<PhysicsMaterial>,
    ) -> Self {
        Self {
            shape: EntityTemplateColliderShape::Aabb {
                half_width,
                half_height,
            },
            half_width,
            half_height,
            offset_x,
            offset_y,
            enabled,
            is_trigger,
            material,
        }
    }
}

impl EntityTemplate {
    pub const fn new(sprite_width: f32, sprite_height: f32) -> Self {
        Self {
            sprite_width,
            sprite_height,
            collider_half_width: sprite_width * 0.5,
            collider_half_height: sprite_height * 0.5,
            collider_offset_x: 0.0,
            collider_offset_y: 0.0,
            collider_enabled: true,
            collider_is_trigger: true,
            collider_material: None,
            collider_shape: EntityTemplateColliderShape::aabb(
                sprite_width * 0.5,
                sprite_height * 0.5,
            ),
            frame: SpriteFrame::FULL,
            animation: None,
        }
    }

    pub fn with_animation(mut self, frame_count: u32, fps: f32) -> Self {
        self.animation = SpriteAnimation::horizontal(frame_count, fps);
        self
    }

    pub fn with_sprite_animation(mut self, animation: Option<SpriteAnimation>) -> Self {
        self.animation = animation;
        self
    }

    pub fn with_collider(mut self, collider: EntityTemplateCollider) -> Self {
        self.collider_half_width = collider.half_width;
        self.collider_half_height = collider.half_height;
        self.collider_offset_x = collider.offset_x;
        self.collider_offset_y = collider.offset_y;
        self.collider_enabled = collider.enabled;
        self.collider_is_trigger = collider.is_trigger;
        self.collider_material = collider.material;
        self.collider_shape = collider.shape;
        let (half_width, half_height) = collider.shape.half_extents();
        self.collider_half_width = half_width;
        self.collider_half_height = half_height;
        self
    }

    pub fn with_frame(mut self, sprite_width: f32, sprite_height: f32, frame: SpriteFrame) -> Self {
        self.sprite_width = sprite_width;
        self.sprite_height = sprite_height;
        self.collider_half_width = sprite_width * 0.5;
        self.collider_half_height = sprite_height * 0.5;
        self.collider_shape =
            EntityTemplateColliderShape::aabb(self.collider_half_width, self.collider_half_height);
        self.frame = frame;
        self.animation = None;
        self
    }

    pub fn with_frame_animation(
        mut self,
        sprite_width: f32,
        sprite_height: f32,
        frame: SpriteFrame,
        animation: SpriteAnimation,
    ) -> Self {
        self.sprite_width = sprite_width;
        self.sprite_height = sprite_height;
        self.collider_half_width = sprite_width * 0.5;
        self.collider_half_height = sprite_height * 0.5;
        self.collider_shape =
            EntityTemplateColliderShape::aabb(self.collider_half_width, self.collider_half_height);
        self.frame = frame;
        self.animation = Some(animation);
        self
    }
}

pub const DEFAULT_PLAYER_TEMPLATE: EntityTemplate = EntityTemplate::new(36.0, 36.0);
pub const DEFAULT_ENEMY_TEMPLATE: EntityTemplate = EntityTemplate::new(24.0, 24.0);
pub const DEFAULT_BULLET_TEMPLATE: EntityTemplate = EntityTemplate::new(8.0, 8.0);

pub(super) fn initial_uv(template: EntityTemplate) -> (f32, f32, f32, f32) {
    template
        .animation
        .map(|animation| animation.uv())
        .unwrap_or_else(|| template.frame.uv())
}
