//! Bounded, exact-consumption shape codec for setup-only Web authoring.
use crate::physics3d::{Pose, Shape, ShapePart};

pub(super) fn decode(metadata: &[u32], values: &[f32]) -> Result<Shape, String> {
    if metadata.len() > 393_219 || values.len() > 196_608 {
        return Err("Unified physics shape payload exceeds its capacity".into());
    }
    let mut reader = Reader { metadata, values };
    let shape = reader.shape(false)?;
    if !reader.metadata.is_empty() || !reader.values.is_empty() {
        return Err("Trailing unified physics shape payload".into());
    }
    Ok(shape)
}

struct Reader<'a> {
    metadata: &'a [u32],
    values: &'a [f32],
}
impl Reader<'_> {
    fn ints(&mut self, n: usize) -> Result<&[u32], String> {
        let (head, tail) = self
            .metadata
            .split_at_checked(n)
            .ok_or("Truncated unified physics shape metadata")?;
        self.metadata = tail;
        Ok(head)
    }
    fn floats(&mut self, n: usize) -> Result<&[f32], String> {
        let (head, tail) = self
            .values
            .split_at_checked(n)
            .ok_or("Truncated unified physics shape values")?;
        self.values = tail;
        Ok(head)
    }
    fn array<const N: usize>(&mut self) -> Result<[f32; N], String> {
        self.floats(N)?
            .try_into()
            .map_err(|_| "Invalid shape array".into())
    }
    fn count(&mut self, min: usize, max: usize) -> Result<usize, String> {
        let n = self.ints(1)?[0] as usize;
        if !(min..=max).contains(&n) {
            return Err("Invalid unified physics shape count".into());
        }
        Ok(n)
    }
    fn shape(&mut self, convex_only: bool) -> Result<Shape, String> {
        let code = self.ints(1)?[0];
        if convex_only && code > 3 {
            return Err("Compound parts must be convex primitives or hulls".into());
        }
        Ok(match code {
            0 => Shape::Box {
                half_extents: self.array()?,
            },
            1 => Shape::Sphere {
                radius: self.array::<1>()?[0],
            },
            2 => {
                let [half_height, radius] = self.array()?;
                Shape::Capsule {
                    half_height,
                    radius,
                }
            }
            3 => {
                let n = self.count(4, 256)?;
                Shape::ConvexHull {
                    points: self
                        .floats(n * 3)?
                        .chunks_exact(3)
                        .map(|p| [p[0], p[1], p[2]])
                        .collect(),
                }
            }
            4 => {
                let vertices = self.count(3, 65536)?;
                let triangles = self.count(1, 131072)?;
                let vertices = self
                    .floats(vertices * 3)?
                    .chunks_exact(3)
                    .map(|p| [p[0], p[1], p[2]])
                    .collect();
                let triangles = self
                    .ints(triangles * 3)?
                    .chunks_exact(3)
                    .map(|p| [p[0], p[1], p[2]])
                    .collect();
                Shape::TriangleMesh {
                    vertices,
                    triangles,
                }
            }
            5 => {
                let rows = self.count(2, 32768)?;
                let columns = self.count(2, 32768)?;
                let n = rows
                    .checked_mul(columns)
                    .filter(|n| *n <= 65536)
                    .ok_or("Invalid heightfield sample count")?;
                let size = self.array()?;
                Shape::Heightfield {
                    rows,
                    columns,
                    size,
                    heights: self.floats(n)?.to_vec(),
                }
            }
            6 => {
                let n = self.count(1, 64)?;
                let mut parts = Vec::with_capacity(n);
                for _ in 0..n {
                    let pose = Pose {
                        position: self.array()?,
                        rotation: self.array()?,
                    };
                    parts.push(ShapePart {
                        pose,
                        shape: self.shape(true)?,
                    });
                }
                Shape::Compound { parts }
            }
            _ => return Err("Unknown unified physics shape code".into()),
        })
    }
}
