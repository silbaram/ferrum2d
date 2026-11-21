// Ferrum2D modified source; see FERRUM-PATCHES.md.
use super::*;
impl<'de> serde::Deserialize<'de> for Compound {
    fn deserialize<D: serde::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(rename = "Compound")]
        struct State {
            shapes: Vec<(Pose, SharedShape)>,
            bvh: Bvh,
            aabbs: Vec<Aabb>,
            aabb: Aabb,
            #[serde(default)]
            flags: CompoundFlags,
            #[serde(default)]
            pseudo_normals: Option<Vec<Option<CompoundPseudoNormals>>>,
        }
        let s = <State as serde::Deserialize>::deserialize(source)?;
        let result = Self {
            shapes: s.shapes,
            bvh: s.bvh,
            aabbs: s.aabbs,
            aabb: s.aabb,
            flags: s.flags,
            pseudo_normals: s.pseudo_normals,
        };
        result
            .validate_storage()
            .map_err(serde::de::Error::custom)?;
        Ok(result)
    }
}
fn contains(outer: &Aabb, inner: &Aabb) -> bool {
    outer.mins.is_finite()
        && outer.maxs.is_finite()
        && inner.mins.is_finite()
        && inner.maxs.is_finite()
        && outer.mins.cmple(inner.mins).all()
        && outer.maxs.cmpge(inner.maxs).all()
        && inner.mins.cmple(inner.maxs).all()
}
impl Compound {
    fn validate_storage(&self) -> Result<(), &'static str> {
        if self.shapes.is_empty()
            || self.aabbs.len() != self.shapes.len()
            || self.flags.bits() & !CompoundFlags::all().bits() != 0
        {
            return Err("invalid compound storage/flags");
        }
        for ((pose, shape), bounds) in self.shapes.iter().zip(&self.aabbs) {
            if !pose.is_finite() || shape.as_composite_shape().is_some() {
                return Err("invalid/nested compound part");
            }
            #[cfg(feature = "dim3")]
            if (pose.rotation.length_squared() - 1.0).abs() > 1.0e-3 {
                return Err("invalid compound rotation");
            }
            if !contains(bounds, &shape.compute_aabb(pose)) || !contains(&self.aabb, bounds) {
                return Err("compound bounds do not cover its parts");
            }
        }
        self.bvh.validate_geometry(self.shapes.len(), |i| {
            self.aabbs
                .get(i as usize)
                .copied()
                .ok_or("invalid compound part index")
        })?;
        if self.flags.contains(CompoundFlags::FIX_INTERNAL_EDGES) && self.pseudo_normals.is_none() {
            return Err("missing compound pseudo normals");
        }
        if let Some(normals) = &self.pseudo_normals {
            if normals.len() != self.shapes.len() {
                return Err("invalid compound pseudo normal count");
            }
            for normal in normals.iter().flatten() {
                #[cfg(feature = "dim3")]
                if normal.boundary_faces.iter().any(|f| {
                    !f.face.is_finite() || f.edge_pseudo_normals.iter().any(|n| !n.is_finite())
                }) {
                    return Err("invalid compound face cone");
                }
                #[cfg(feature = "dim2")]
                if normal.boundary_edges.iter().any(|e| {
                    !e.face.is_finite()
                        || !e.clockwise_limit.is_finite()
                        || !e.counter_clockwise_limit.is_finite()
                }) {
                    return Err("invalid compound edge cone");
                }
            }
        }
        Ok(())
    }
}
