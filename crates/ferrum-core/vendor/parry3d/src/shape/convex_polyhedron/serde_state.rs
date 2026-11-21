// Ferrum2D modified source; see FERRUM-PATCHES.md.
use super::*;
const SEEN: u32 = 1 << 31;
fn range(first: u32, count: u32, length: usize) -> Result<core::ops::Range<usize>, &'static str> {
    let end = first
        .checked_add(count)
        .ok_or("convex incidence range overflow")? as usize;
    if end > length {
        return Err("convex incidence range out of bounds");
    }
    Ok(first as usize..end)
}
fn unit(v: Vector) -> bool {
    v.is_finite() && (v.length_squared() - 1.0).abs() <= 1.0e-3
}
impl<'de> serde::Deserialize<'de> for ConvexPolyhedron {
    fn deserialize<D: serde::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(rename = "ConvexPolyhedron")]
        struct State {
            points: Vec<Vector>,
            vertices: Vec<Vertex>,
            faces: Vec<Face>,
            edges: Vec<Edge>,
            faces_adj_to_vertex: Vec<u32>,
            edges_adj_to_vertex: Vec<u32>,
            edges_adj_to_face: Vec<u32>,
            vertices_adj_to_face: Vec<u32>,
        }
        let s = <State as serde::Deserialize>::deserialize(source)?;
        Self {
            points: s.points,
            vertices: s.vertices,
            faces: s.faces,
            edges: s.edges,
            faces_adj_to_vertex: s.faces_adj_to_vertex,
            edges_adj_to_vertex: s.edges_adj_to_vertex,
            edges_adj_to_face: s.edges_adj_to_face,
            vertices_adj_to_face: s.vertices_adj_to_face,
        }
        .validate_storage()
        .map_err(serde::de::Error::custom)
    }
}
impl ConvexPolyhedron {
    fn validate_storage(mut self) -> Result<Self, &'static str> {
        if self.points.is_empty()
            || self.faces.is_empty()
            || self.points.len() != self.vertices.len()
            || [self.points.len(), self.faces.len(), self.edges.len()]
                .iter()
                .any(|n| *n > 0x3fff_ffff)
            || self.points.iter().any(|p| !p.is_finite())
            || self.faces_adj_to_vertex.len() != self.edges_adj_to_vertex.len()
            || self.vertices_adj_to_face.len() != self.edges_adj_to_face.len()
            || self.vertices_adj_to_face.len() != self.faces_adj_to_vertex.len()
        {
            return Err("invalid convex storage dimensions");
        }
        for e in &self.edges {
            if e.vertices.iter().any(|v| *v as usize >= self.points.len()) || !unit(e.dir) {
                return Err("invalid convex edge vertices/direction");
            }
            if !e.deleted
                && (e.faces[0] == e.faces[1]
                    || e.faces.iter().any(|f| *f as usize >= self.faces.len()))
            {
                return Err("invalid convex live edge faces");
            }
        }
        let mut cursor = 0;
        for (vid, v) in self.vertices.iter().enumerate() {
            if v.first_adj_face_or_edge as usize != cursor {
                return Err("noncanonical convex vertex incidence range");
            }
            let r = range(
                v.first_adj_face_or_edge,
                v.num_adj_faces_or_edge,
                self.faces_adj_to_vertex.len(),
            )?;
            let fids = &self.faces_adj_to_vertex[r.clone()];
            if fids.windows(2).any(|w| w[0] >= w[1]) {
                return Err("duplicate or unordered convex vertex faces");
            }
            for (&fid, &eid) in fids.iter().zip(&self.edges_adj_to_vertex[r.clone()]) {
                let edge = self
                    .edges
                    .get(eid as usize)
                    .ok_or("invalid convex vertex edge")?;
                if fid as usize >= self.faces.len()
                    || edge.deleted
                    || !edge.vertices.contains(&(vid as u32))
                    || !edge.faces.contains(&fid)
                {
                    return Err("invalid convex vertex incidence");
                }
            }
            cursor = r.end;
        }
        if cursor != self.faces_adj_to_vertex.len() {
            return Err("unused convex vertex incidence storage");
        }
        cursor = 0;
        for (fid, f) in self.faces.iter().enumerate() {
            if f.first_vertex_or_edge as usize != cursor
                || f.num_vertices_or_edges < 3
                || !unit(f.normal)
            {
                return Err("invalid convex face range/normal");
            }
            let r = range(
                f.first_vertex_or_edge,
                f.num_vertices_or_edges,
                self.vertices_adj_to_face.len(),
            )?;
            for slot in r.clone() {
                let next = if slot + 1 == r.end { r.start } else { slot + 1 };
                let vid = self.vertices_adj_to_face[slot];
                let next_vid = self.vertices_adj_to_face[next];
                let vertex = self
                    .vertices
                    .get(vid as usize)
                    .ok_or("invalid convex face vertex")?;
                let eid = self.edges_adj_to_face[slot];
                let edge = self
                    .edges
                    .get_mut(eid as usize)
                    .ok_or("invalid convex face edge")?;
                if edge.deleted
                    || !edge.vertices.contains(&vid)
                    || !edge.vertices.contains(&next_vid)
                    || vid == next_vid
                {
                    return Err("convex face edge does not join its corners");
                }
                let side = if edge.faces[0] & !SEEN == fid as u32 {
                    0
                } else if edge.faces[1] & !SEEN == fid as u32 {
                    1
                } else {
                    return Err("convex face edge has wrong face");
                };
                if edge.faces[side] & SEEN != 0 {
                    return Err("duplicate convex face edge");
                }
                edge.faces[side] |= SEEN;
                let vr = range(
                    vertex.first_adj_face_or_edge,
                    vertex.num_adj_faces_or_edge,
                    self.faces_adj_to_vertex.len(),
                )?;
                let offset = self.faces_adj_to_vertex[vr.clone()]
                    .binary_search(&(fid as u32))
                    .map_err(|_| "missing convex reciprocal vertex face")?;
                if self.edges_adj_to_vertex[vr.start + offset] != eid {
                    return Err("convex reciprocal outgoing edge mismatch");
                }
            }
            cursor = r.end;
        }
        if cursor != self.vertices_adj_to_face.len() {
            return Err("unused convex face incidence storage");
        }
        for edge in &mut self.edges {
            if !edge.deleted {
                if edge.faces.iter().any(|f| *f & SEEN == 0) {
                    return Err("convex live edge missing face incidence");
                }
                edge.faces[0] &= !SEEN;
                edge.faces[1] &= !SEEN;
            }
        }
        Ok(self)
    }
}
