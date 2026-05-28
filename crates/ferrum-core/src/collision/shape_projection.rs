use super::*;

pub(super) fn convex_polygons_overlap(a: &[Transform2D], b: &[Transform2D]) -> bool {
    !convex_polygon_has_separating_axis(a, b) && !convex_polygon_has_separating_axis(b, a)
}

fn convex_polygon_has_separating_axis(axis_source: &[Transform2D], other: &[Transform2D]) -> bool {
    for index in 0..axis_source.len() {
        let start = axis_source[index];
        let end = axis_source[(index + 1) % axis_source.len()];
        let edge_x = end.x - start.x;
        let edge_y = end.y - start.y;
        let axis_length = (edge_x * edge_x + edge_y * edge_y).sqrt();
        if axis_length <= RAY_EPSILON {
            continue;
        }
        let axis_x = -edge_y / axis_length;
        let axis_y = edge_x / axis_length;
        let (source_min, source_max) = project_vertices(axis_source, axis_x, axis_y);
        let (other_min, other_max) = project_vertices(other, axis_x, axis_y);
        if source_max < other_min - RAY_EPSILON || other_max < source_min - RAY_EPSILON {
            return true;
        }
    }
    false
}

pub(super) fn project_vertices(vertices: &[Transform2D], axis_x: f32, axis_y: f32) -> (f32, f32) {
    let mut min = vertices[0].x * axis_x + vertices[0].y * axis_y;
    let mut max = min;
    for vertex in &vertices[1..] {
        let projection = vertex.x * axis_x + vertex.y * axis_y;
        min = min.min(projection);
        max = max.max(projection);
    }
    (min, max)
}

pub(super) fn oriented_box_vertices(oriented_box: OrientedBoxGeometry) -> [Transform2D; 4] {
    [
        oriented_box_world_point(
            oriented_box,
            Transform2D {
                x: -oriented_box.half_width,
                y: -oriented_box.half_height,
            },
        ),
        oriented_box_world_point(
            oriented_box,
            Transform2D {
                x: oriented_box.half_width,
                y: -oriented_box.half_height,
            },
        ),
        oriented_box_world_point(
            oriented_box,
            Transform2D {
                x: oriented_box.half_width,
                y: oriented_box.half_height,
            },
        ),
        oriented_box_world_point(
            oriented_box,
            Transform2D {
                x: -oriented_box.half_width,
                y: oriented_box.half_height,
            },
        ),
    ]
}

pub(super) fn oriented_box_projection_radius(
    oriented_box: OrientedBoxGeometry,
    axis_x: f32,
    axis_y: f32,
) -> f32 {
    oriented_box.half_width
        * (oriented_box.axis_x_x * axis_x + oriented_box.axis_x_y * axis_y).abs()
        + oriented_box.half_height
            * (oriented_box.axis_y_x * axis_x + oriented_box.axis_y_y * axis_y).abs()
}
