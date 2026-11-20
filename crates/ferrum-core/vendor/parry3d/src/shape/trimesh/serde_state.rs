// Ferrum2D modified source; see FERRUM-PATCHES.md.
use super::*;
impl<'de> serde::Deserialize<'de> for TriMesh {
    fn deserialize<D: serde::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(rename = "TriMesh")]
        struct State {
            bvh: Bvh,
            vertices: Vec<Vector>,
            indices: Vec<[u32; 3]>,
            #[cfg(feature = "dim3")]
            pseudo_normals: Option<TriMeshPseudoNormals>,
            topology: Option<TriMeshTopology>,
            connected_components: Option<TriMeshConnectedComponents>,
            flags: TriMeshFlags,
        }
        let s = <State as serde::Deserialize>::deserialize(source)?;
        let result = Self {
            bvh: s.bvh,
            vertices: s.vertices,
            indices: s.indices,
            #[cfg(feature = "dim3")]
            pseudo_normals: s.pseudo_normals,
            topology: s.topology,
            connected_components: s.connected_components,
            flags: s.flags,
        };
        result
            .validate_storage()
            .map_err(serde::de::Error::custom)?;
        Ok(result)
    }
}
impl TriMesh {
    fn validate_storage(&self) -> Result<(), &'static str> {
        let (nv, nf) = (self.vertices.len(), self.indices.len());
        if nv > u32::MAX as usize
            || self.vertices.iter().any(|v| !v.is_finite())
            || self.indices.iter().flatten().any(|i| *i as usize >= nv)
            || self.flags.bits() & !TriMeshFlags::all().bits() != 0
        {
            return Err("invalid triangle mesh vertex/index/flags");
        }
        self.bvh.validate_geometry(nf, |i| {
            let ids = self.indices.get(i as usize).ok_or("missing triangle")?;
            Ok(Aabb::from_points(
                ids.iter().map(|id| self.vertices[*id as usize]),
            ))
        })?;
        #[cfg(feature = "dim3")]
        {
            let needed = self
                .flags
                .intersects(TriMeshFlags::ORIENTED | TriMeshFlags::FIX_INTERNAL_EDGES);
            if needed && self.pseudo_normals.is_none() {
                return Err("missing triangle pseudo normals");
            }
            if let Some(p) = &self.pseudo_normals {
                if p.vertices_pseudo_normal.len() != nv
                    || p.edges_pseudo_normal.len() != nf
                    || p.vertices_pseudo_normal
                        .iter()
                        .chain(p.edges_pseudo_normal.iter().flatten())
                        .any(|v| !v.is_finite())
                {
                    return Err("invalid triangle pseudo normal storage");
                }
            }
        }
        if self.flags.contains(TriMeshFlags::HALF_EDGE_TOPOLOGY) && self.topology.is_none() {
            return Err("missing triangle topology");
        }
        if let Some(t) = &self.topology {
            if t.vertices.len() != nv
                || t.faces.len() != nf
                || nf.checked_mul(3) != Some(t.half_edges.len())
            {
                return Err("invalid triangle topology dimensions");
            }
            for (fid, (face, ids)) in t.faces.iter().zip(&self.indices).enumerate() {
                let mut current = face.half_edge;
                let mut seen = [u32::MAX; 3];
                for (corner, expected) in ids.iter().enumerate() {
                    if seen[..corner].contains(&current) {
                        return Err("repeated triangle half edge");
                    }
                    seen[corner] = current;
                    let h = t
                        .half_edges
                        .get(current as usize)
                        .ok_or("invalid triangle half edge")?;
                    if h.face as usize != fid || h.vertex != *expected {
                        return Err("triangle topology differs from index buffer");
                    }
                    if t.vertices[h.vertex as usize].half_edge == u32::MAX {
                        return Err("used topology vertex has no edge");
                    }
                    if h.twin != u32::MAX {
                        let twin = t
                            .half_edges
                            .get(h.twin as usize)
                            .ok_or("invalid triangle twin")?;
                        let next = t
                            .half_edges
                            .get(h.next as usize)
                            .ok_or("invalid triangle next edge")?;
                        let twin_next = t
                            .half_edges
                            .get(twin.next as usize)
                            .ok_or("invalid twin next edge")?;
                        if twin.twin != current
                            || twin.face == h.face
                            || twin.vertex != next.vertex
                            || twin_next.vertex != h.vertex
                        {
                            return Err("invalid triangle twin relation");
                        }
                    }
                    current = h.next;
                }
                if current != face.half_edge {
                    return Err("triangle edge cycle is not length three");
                }
            }
            for (vid, v) in t.vertices.iter().enumerate() {
                if v.half_edge != u32::MAX
                    && !t
                        .half_edges
                        .get(v.half_edge as usize)
                        .is_some_and(|h| h.vertex as usize == vid)
                {
                    return Err("invalid topology vertex edge");
                }
            }
        }
        #[cfg(feature = "std")]
        if self.flags.contains(TriMeshFlags::CONNECTED_COMPONENTS)
            && self.connected_components.is_none()
        {
            return Err("missing connected components");
        }
        if let Some(c) = &self.connected_components {
            if c.face_colors.len() != nf
                || c.grouped_faces.len() != nf
                || c.ranges.first() != Some(&0)
                || c.ranges.last() != Some(&nf)
                || c.ranges.windows(2).any(|w| w[0] >= w[1])
            {
                return Err("invalid connected component storage");
            }
            let groups = c.ranges.len() - 1;
            if c.face_colors.iter().any(|g| *g as usize >= groups) {
                return Err("invalid connected component color");
            }
            // The producer appends faces in ascending ID order within each
            // component. Ordering plus the color relation proves a permutation
            // without allocating a visited table or changing saved order.
            for (group, w) in c.ranges.windows(2).enumerate() {
                let faces = c
                    .grouped_faces
                    .get(w[0]..w[1])
                    .ok_or("invalid connected component range")?;
                if faces.windows(2).any(|ids| ids[0] >= ids[1])
                    || faces
                        .iter()
                        .any(|id| c.face_colors.get(*id as usize) != Some(&(group as u32)))
                {
                    return Err("invalid connected component face permutation");
                }
            }
        }
        Ok(())
    }
}
