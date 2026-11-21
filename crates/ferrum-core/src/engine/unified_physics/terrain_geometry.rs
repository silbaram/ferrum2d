//! Authored terrain in simulation coordinates, independent of render tessellation.
use crate::components::CollisionMask;
use crate::physics3d::TerrainOneWay;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, PlanarCollisionSpan, Pose, Shape, Space};
use crate::spatial_scene::Surface;
use crate::tilemap::{Hd2dRampAxis, TerrainTile};

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct TerrainDesc {
    pub body: BodyDesc,
    pub collider: ColliderDesc,
    pub span: Option<PlanarCollisionSpan>,
    pub one_way: Option<TerrainOneWay>,
}

fn desc(position: [f32; 3], shape: Shape, movement: bool, projectile: bool) -> TerrainDesc {
    TerrainDesc {
        body: BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position,
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        collider: ColliderDesc {
            category: CollisionMask::WALL.bits,
            mask: (if movement {
                !CollisionMask::BULLET.bits
            } else {
                0
            }) | (if projectile {
                CollisionMask::BULLET.bits
            } else {
                0
            }),
            sensor: !movement,
            density: 0.0,
            ..ColliderDesc::new(shape)
        },
        span: None,
        one_way: None,
    }
}

pub(super) fn tile(t: TerrainTile, space: Space) -> TerrainDesc {
    let [x, y, w, h] = t.bounds;
    let movement = t.hd.is_none_or(|h| h.blocks_movement);
    let projectile = t.hd.is_none_or(|h| h.blocks_projectile);
    if space == Space::Spatial {
        // A plain tile is a finite wall, not an unbounded column. An explicit span
        // controls its bottom/top; absent height defaults to one tile-height.
        let base = t.span.map_or(0.0, |s| s.elevation);
        let walkable = t.hd.is_some_and(|d| !d.blocks_movement);
        let height = if walkable {
            0.0
        } else {
            t.span.map_or(h, |s| s.height)
        };
        let (heights, ramp_x) =
            t.hd.and_then(|d| d.ramp)
                .map_or(([base + height; 2], false), |r| {
                    (
                        [r.start_elevation, r.end_elevation],
                        r.axis == Hd2dRampAxis::X,
                    )
                });
        let mut d = volume(
            t.bounds,
            base.min(heights[0].min(heights[1])),
            heights,
            ramp_x,
        );
        // A walkable HD tile uses its authored elevation as the support surface.
        // The XY wall flag does not disable Y-up support in a spatial world.
        d.collider.sensor = false;
        d.collider.mask = (if movement || walkable {
            !CollisionMask::BULLET.bits
        } else {
            0
        }) | (if projectile {
            CollisionMask::BULLET.bits
        } else {
            0
        });
        let gradient = (heights[1] - heights[0]) / if ramp_x { w } else { h };
        let normal = if ramp_x {
            [-gradient, 1.0, 0.0]
        } else {
            [0.0, 1.0, gradient]
        };
        d.one_way = t.one_way.then(|| {
            plane(
                [-w * 0.5, heights[0] - d.body.pose.position[1], h * 0.5],
                normal,
            )
        });
        return d;
    }
    let depth = super::planar_geometry::extrusion_depth(w * 0.5, h * 0.5);
    let shape = if let Some(s) = t.slope {
        // Existing 2D slopes are authored line segments, not full tile boxes.
        Shape::TriangleMesh {
            vertices: vec![
                [(s.local_x0 - 0.5) * w, (s.local_y0 - 0.5) * h, -depth],
                [(s.local_x1 - 0.5) * w, (s.local_y1 - 0.5) * h, -depth],
                [(s.local_x1 - 0.5) * w, (s.local_y1 - 0.5) * h, depth],
                [(s.local_x0 - 0.5) * w, (s.local_y0 - 0.5) * h, depth],
            ],
            triangles: vec![[0, 1, 2], [0, 2, 3]],
        }
    } else {
        Shape::Box {
            half_extents: [w * 0.5, h * 0.5, depth],
        }
    };
    let mut d = desc([x + w * 0.5, y + h * 0.5, 0.0], shape, movement, projectile);
    d.span = t.span.map(|s| PlanarCollisionSpan {
        floor: s.floor.0,
        elevation: s.elevation,
        height: s.height,
    });
    d.one_way = t.one_way.then(|| {
        if let Some(s) = t.slope {
            let dx = (s.local_x1 - s.local_x0) * w;
            let dy = (s.local_y1 - s.local_y0) * h;
            plane(
                [(s.local_x0 - 0.5) * w, (s.local_y0 - 0.5) * h, 0.0],
                [dy * dx.signum(), -dx.abs(), 0.0],
            )
        } else {
            plane([0.0, -h * 0.5, 0.0], [0.0, -1.0, 0.0])
        }
    });
    d
}

pub(super) fn surface(s: Surface) -> TerrainDesc {
    // Walkable surfaces are physical supports. The legacy movement flag only
    // excludes them from XY wall tests; it must not turn the 3D floor into a sensor.
    volume(s.bounds, s.base, s.heights, s.ramp_x)
}

fn volume(bounds: [f32; 4], base: f32, heights: [f32; 2], ramp_x: bool) -> TerrainDesc {
    let [x, y, w, d] = bounds;
    let center_y = (base + heights[0].max(heights[1])) * 0.5;
    let position = [x + w * 0.5, center_y, -y - d * 0.5];
    let shape = if heights[0] == heights[1] && heights[0] > base {
        Shape::Box {
            half_extents: [w * 0.5, (heights[0] - base) * 0.5, d * 0.5],
        }
    } else {
        let h = if ramp_x {
            [heights[0], heights[1], heights[1], heights[0]]
        } else {
            [heights[0], heights[0], heights[1], heights[1]]
        };
        let corners = [
            [-w * 0.5, d * 0.5],
            [w * 0.5, d * 0.5],
            [w * 0.5, -d * 0.5],
            [-w * 0.5, -d * 0.5],
        ];
        let top: Vec<_> = (0..4)
            .map(|i| [corners[i][0], h[i] - center_y, corners[i][1]])
            .collect();
        if base == heights[0] && base == heights[1] {
            // Zero-thickness authored floors remain two-sided surfaces.
            Shape::TriangleMesh {
                vertices: top,
                triangles: vec![[0, 1, 2], [0, 2, 3]],
            }
        } else {
            // Wedge/bridge volume includes the authored underside, never a column
            // extending to elevation zero. Duplicate wedge vertices are accepted.
            Shape::ConvexHull {
                points: top
                    .into_iter()
                    .chain(corners.map(|p| [p[0], base - center_y, p[1]]))
                    .collect(),
            }
        }
    };
    desc(position, shape, true, true)
}

fn plane(point: [f32; 3], normal: [f32; 3]) -> TerrainOneWay {
    let length = normal[0].hypot(normal[1]).hypot(normal[2]);
    TerrainOneWay {
        point,
        normal: normal.map(|v| v / length),
    }
}
