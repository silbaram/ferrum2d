use super::broadphase::current_proxy_bounds;
use super::*;

const CONTACT_DEBUG_COLOR: [f32; 4] = [1.0, 0.2, 0.1, 1.0];
const BROADPHASE_DEBUG_COLOR: [f32; 4] = [0.1, 0.75, 1.0, 0.55];
const COLLIDER_AWAKE_DEBUG_COLOR: [f32; 4] = [0.2, 0.85, 0.35, 0.9];
const COLLIDER_SLEEPING_DEBUG_COLOR: [f32; 4] = [0.45, 0.55, 0.65, 0.75];
const JOINT_DEBUG_COLOR: [f32; 4] = [0.95, 0.75, 0.15, 0.9];
const CCD_HIT_DEBUG_COLOR: [f32; 4] = [1.0, 0.45, 0.05, 1.0];
const CONTACT_POINT_MARKER_SIZE: f32 = 3.0;
const CCD_HIT_MARKER_SIZE: f32 = 4.0;
const CCD_HIT_NORMAL_LENGTH: f32 = 12.0;

impl CollisionSystem {
    pub fn build_contact_debug_lines(world: &World, normal_length: f32) -> Vec<PhysicsDebugLine> {
        let mut lines = Vec::new();
        Self::build_contact_debug_lines_into(world, normal_length, &mut lines);
        lines
    }

    pub fn build_broadphase_debug_lines(world: &World) -> Vec<PhysicsDebugLine> {
        let mut lines = Vec::new();
        Self::append_broadphase_debug_lines_into(world, &mut lines);
        lines
    }

    pub fn build_physics_debug_lines(world: &World, normal_length: f32) -> Vec<PhysicsDebugLine> {
        let mut lines = Vec::new();
        Self::build_physics_debug_lines_into(world, normal_length, &mut lines);
        lines
    }

    pub fn build_physics_debug_lines_with_flags(
        world: &World,
        normal_length: f32,
        flags: u32,
    ) -> Vec<PhysicsDebugLine> {
        let mut lines = Vec::new();
        Self::build_physics_debug_lines_with_flags_into(world, normal_length, flags, &mut lines);
        lines
    }

    pub(crate) fn build_contact_debug_lines_into(
        world: &World,
        normal_length: f32,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        lines.clear();
        if !is_valid_debug_line_length(normal_length) {
            return;
        }
        Self::append_contact_debug_lines_into(world, normal_length, lines);
    }

    pub(crate) fn build_physics_debug_lines_into(
        world: &World,
        normal_length: f32,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        Self::build_physics_debug_lines_with_flags_into(
            world,
            normal_length,
            PHYSICS_DEBUG_DEFAULT,
            lines,
        );
    }

    pub(crate) fn build_physics_debug_lines_with_flags_into(
        world: &World,
        normal_length: f32,
        flags: u32,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        lines.clear();
        if flags & PHYSICS_DEBUG_COLLIDERS != 0 {
            Self::append_collider_debug_lines_into(
                world,
                flags & PHYSICS_DEBUG_SLEEPING != 0,
                lines,
            );
        }
        if flags & PHYSICS_DEBUG_BROADPHASE != 0 {
            Self::append_broadphase_debug_lines_into(world, lines);
        }
        if flags & PHYSICS_DEBUG_JOINTS != 0 {
            Self::append_joint_debug_lines_into(world, lines);
        }
        if flags & PHYSICS_DEBUG_CCD != 0 {
            Self::append_ccd_debug_lines_into(world, lines);
        }
        if flags & PHYSICS_DEBUG_CONTACTS != 0 && is_valid_debug_line_length(normal_length) {
            Self::append_contact_debug_lines_into(world, normal_length, lines);
        }
    }

    pub(crate) fn append_contact_debug_lines_into(
        world: &World,
        normal_length: f32,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        for pair in Self::build_all_collider_pairs(world) {
            let Some(contact) = contact_from_collider_pair(world, pair) else {
                continue;
            };
            let Some(line) = contact_debug_line(world, contact, normal_length) else {
                continue;
            };
            lines.push(line);
            append_contact_point_debug_lines(contact, lines);
        }
    }

    pub(crate) fn append_collider_debug_lines_into(
        world: &World,
        show_sleeping_state: bool,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        for &index in world.alive_indices() {
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            for collider_index in 0..world.compound_collider_count_at(index) {
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    append_collider_outline_debug_lines(
                        transform,
                        shape,
                        collider_debug_color(world, index, show_sleeping_state),
                        lines,
                    );
                }
            }
        }
    }

    pub(crate) fn append_broadphase_debug_lines_into(
        world: &World,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        for bounds in current_proxy_bounds(world) {
            append_bounds_debug_lines(bounds, BROADPHASE_DEBUG_COLOR, lines);
        }
    }

    pub(crate) fn append_joint_debug_lines_into(world: &World, lines: &mut Vec<PhysicsDebugLine>) {
        for joint in world.distance_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.rope_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.spring_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.pulley_joints.iter().copied().flatten() {
            append_pulley_joint_debug_lines(world, joint, lines);
        }
        for joint in world.revolute_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.prismatic_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.weld_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.gear_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
    }

    pub(crate) fn append_ccd_debug_lines_into(world: &World, lines: &mut Vec<PhysicsDebugLine>) {
        for hit in world.rigid_body_ccd_debug_hits() {
            append_cross_debug_lines(
                hit.point_x,
                hit.point_y,
                CCD_HIT_MARKER_SIZE,
                CCD_HIT_DEBUG_COLOR,
                lines,
            );
            lines.push(debug_line(
                hit.point_x,
                hit.point_y,
                hit.point_x + hit.normal_x * CCD_HIT_NORMAL_LENGTH,
                hit.point_y + hit.normal_y * CCD_HIT_NORMAL_LENGTH,
                CCD_HIT_DEBUG_COLOR,
            ));
        }
    }
}

fn contact_debug_line(
    world: &World,
    contact: CollisionContact,
    normal_length: f32,
) -> Option<PhysicsDebugLine> {
    let at = world
        .transforms
        .get(contact.pair.a.id as usize)
        .copied()
        .flatten()?;
    let bt = world
        .transforms
        .get(contact.pair.b.id as usize)
        .copied()
        .flatten()?;
    let x0 = if contact.point_x.is_finite() {
        contact.point_x
    } else {
        (at.x + bt.x) * 0.5
    };
    let y0 = if contact.point_y.is_finite() {
        contact.point_y
    } else {
        (at.y + bt.y) * 0.5
    };
    Some(PhysicsDebugLine {
        x0,
        y0,
        x1: x0 + contact.normal_x * normal_length,
        y1: y0 + contact.normal_y * normal_length,
        r: CONTACT_DEBUG_COLOR[0],
        g: CONTACT_DEBUG_COLOR[1],
        b: CONTACT_DEBUG_COLOR[2],
        a: CONTACT_DEBUG_COLOR[3],
    })
}

fn append_contact_point_debug_lines(contact: CollisionContact, lines: &mut Vec<PhysicsDebugLine>) {
    append_cross_debug_lines(
        contact.point_x,
        contact.point_y,
        CONTACT_POINT_MARKER_SIZE,
        CONTACT_DEBUG_COLOR,
        lines,
    );
}

fn append_cross_debug_lines(
    x: f32,
    y: f32,
    marker_size: f32,
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    if !x.is_finite() || !y.is_finite() || !marker_size.is_finite() || marker_size <= 0.0 {
        return;
    }
    lines.push(debug_line(x - marker_size, y, x + marker_size, y, color));
    lines.push(debug_line(x, y - marker_size, x, y + marker_size, color));
}

fn append_collider_outline_debug_lines(
    transform: Transform2D,
    shape: ColliderShapeRef,
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    match shape {
        ColliderShapeRef::Aabb(collider) => append_bounds_debug_lines(
            AabbBounds::from_transform(transform, collider),
            color,
            lines,
        ),
        ColliderShapeRef::Circle(collider) => {
            append_circle_debug_lines(collider.center(transform), collider.radius, color, lines)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            if let Some(geometry) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) {
                append_polygon_debug_lines(&oriented_box_vertices(geometry), color, lines);
            }
        }
        ColliderShapeRef::Capsule(collider) => {
            let start = collider.start(transform);
            let end = collider.end(transform);
            lines.push(debug_line(start.x, start.y, end.x, end.y, color));
            append_circle_debug_lines(start, collider.radius, color, lines);
            append_circle_debug_lines(end, collider.radius, color, lines);
        }
        ColliderShapeRef::Edge(collider) => {
            let start = collider.start(transform);
            let end = collider.end(transform);
            lines.push(debug_line(start.x, start.y, end.x, end.y, color));
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            if let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            {
                append_polygon_debug_lines(&vertices[..vertex_count], color, lines);
            }
        }
    }
}

fn append_circle_debug_lines(
    center: Transform2D,
    radius: f32,
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    if !is_valid_radius(radius) {
        return;
    }
    const SEGMENTS: usize = 16;
    let mut previous = Transform2D {
        x: center.x + radius,
        y: center.y,
    };
    for segment in 1..=SEGMENTS {
        let angle = (segment as f32 / SEGMENTS as f32) * core::f32::consts::TAU;
        let next = Transform2D {
            x: center.x + angle.cos() * radius,
            y: center.y + angle.sin() * radius,
        };
        lines.push(debug_line(previous.x, previous.y, next.x, next.y, color));
        previous = next;
    }
}

fn append_polygon_debug_lines(
    vertices: &[Transform2D],
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    if vertices.len() < 2 {
        return;
    }
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        lines.push(debug_line(start.x, start.y, end.x, end.y, color));
    }
}

fn collider_debug_color(world: &World, index: usize, show_sleeping_state: bool) -> [f32; 4] {
    if show_sleeping_state
        && world
            .rigid_bodies
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|body| body.is_sleeping)
    {
        COLLIDER_SLEEPING_DEBUG_COLOR
    } else {
        COLLIDER_AWAKE_DEBUG_COLOR
    }
}

fn append_entity_link_debug_line(
    world: &World,
    entity_a: Entity,
    entity_b: Entity,
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    let Some(a) = world.transform(entity_a) else {
        return;
    };
    let Some(b) = world.transform(entity_b) else {
        return;
    };
    lines.push(debug_line(a.x, a.y, b.x, b.y, color));
}

fn append_pulley_joint_debug_lines(
    world: &World,
    joint: PulleyJoint,
    lines: &mut Vec<PhysicsDebugLine>,
) {
    let Some(anchor_a) = pulley_joint_world_anchor(
        world,
        joint.entity_a,
        joint.local_anchor_a_x,
        joint.local_anchor_a_y,
    ) else {
        return;
    };
    let Some(anchor_b) = pulley_joint_world_anchor(
        world,
        joint.entity_b,
        joint.local_anchor_b_x,
        joint.local_anchor_b_y,
    ) else {
        return;
    };
    let ground_anchor_a = Transform2D {
        x: finite_debug_number(joint.ground_anchor_a_x),
        y: finite_debug_number(joint.ground_anchor_a_y),
    };
    let ground_anchor_b = Transform2D {
        x: finite_debug_number(joint.ground_anchor_b_x),
        y: finite_debug_number(joint.ground_anchor_b_y),
    };
    lines.push(debug_line(
        ground_anchor_a.x,
        ground_anchor_a.y,
        anchor_a.x,
        anchor_a.y,
        JOINT_DEBUG_COLOR,
    ));
    lines.push(debug_line(
        ground_anchor_b.x,
        ground_anchor_b.y,
        anchor_b.x,
        anchor_b.y,
        JOINT_DEBUG_COLOR,
    ));
    lines.push(debug_line(
        ground_anchor_a.x,
        ground_anchor_a.y,
        ground_anchor_b.x,
        ground_anchor_b.y,
        JOINT_DEBUG_COLOR,
    ));
}

fn pulley_joint_world_anchor(
    world: &World,
    entity: Entity,
    local_anchor_x: f32,
    local_anchor_y: f32,
) -> Option<Transform2D> {
    let transform = world.transform(entity)?;
    let index = entity.id as usize;
    let rotation = world
        .rotations
        .get(index)
        .copied()
        .flatten()
        .map(|rotation| rotation.radians)
        .filter(|radians| radians.is_finite())
        .unwrap_or(0.0);
    let (sin, cos) = rotation.sin_cos();
    let x = finite_debug_number(local_anchor_x);
    let y = finite_debug_number(local_anchor_y);
    Some(Transform2D {
        x: transform.x + x * cos - y * sin,
        y: transform.y + x * sin + y * cos,
    })
}

fn finite_debug_number(value: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

fn append_bounds_debug_lines(
    bounds: AabbBounds,
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    lines.push(debug_line(
        bounds.min_x,
        bounds.min_y,
        bounds.max_x,
        bounds.min_y,
        color,
    ));
    lines.push(debug_line(
        bounds.max_x,
        bounds.min_y,
        bounds.max_x,
        bounds.max_y,
        color,
    ));
    lines.push(debug_line(
        bounds.max_x,
        bounds.max_y,
        bounds.min_x,
        bounds.max_y,
        color,
    ));
    lines.push(debug_line(
        bounds.min_x,
        bounds.max_y,
        bounds.min_x,
        bounds.min_y,
        color,
    ));
}

fn debug_line(x0: f32, y0: f32, x1: f32, y1: f32, color: [f32; 4]) -> PhysicsDebugLine {
    PhysicsDebugLine {
        x0,
        y0,
        x1,
        y1,
        r: color[0],
        g: color[1],
        b: color[2],
        a: color[3],
    }
}

fn is_valid_debug_line_length(length: f32) -> bool {
    length.is_finite() && length > 0.0
}
