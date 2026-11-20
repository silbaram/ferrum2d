//! Render-only translation sampled from a successful native position path.
//! Authoritative surfaces, physics spans, picker and authoring revisions remain
//! unchanged. The draw mesh and shadow ranges use the same presented geometry.
use super::{SpatialScene, SpatialVertex, Surface};

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct TerrainPresentation {
    source_revision: Option<u32>,
    revision: u32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    offsets: Vec<(u32, [f32; 3])>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    vertices: Vec<SpatialVertex>,
}
impl TerrainPresentation {
    pub(super) fn vertices<'a>(
        &'a self,
        revision: u32,
        source: &'a [SpatialVertex],
    ) -> &'a [SpatialVertex] {
        if self.source_revision == Some(revision) && !self.offsets.is_empty() {
            &self.vertices
        } else {
            source
        }
    }
    pub(super) fn surface(&self, mut s: Surface, revision: u32) -> Surface {
        if self.source_revision != Some(revision) {
            return s;
        }
        if let Some((_, d)) = self.offsets.iter().find(|(id, _)| *id == s.id) {
            s.bounds[0] += d[0];
            s.bounds[1] -= d[2];
            s.base += d[1];
            s.heights[0] += d[1];
            s.heights[1] += d[1];
        }
        s
    }
}
impl SpatialScene {
    pub(crate) fn present_native_terrain(&mut self, offsets: &[(u32, [f32; 3])]) {
        let p = &mut self.terrain_presentation;
        if offsets.is_empty() {
            // Static frames borrow the original authoring mesh. No second full
            // mesh allocation and no pointer switch on the first frame.
            if !p.offsets.is_empty() {
                p.revision = p.revision.wrapping_add(1);
            }
            p.offsets.clear();
            p.vertices.clear();
            p.source_revision = Some(self.revision);
            return;
        }
        if p.source_revision == Some(self.revision) && p.offsets == offsets {
            return;
        }
        let full =
            p.source_revision != Some(self.revision) || p.vertices.len() != self.terrain.len();
        if full {
            p.vertices.clear();
            p.vertices.extend_from_slice(&self.terrain);
        }
        for (index, s) in self.surfaces.iter().enumerate() {
            if !full && !p.offsets.iter().chain(offsets).any(|(id, _)| *id == s.id) {
                continue;
            }
            let d = offsets
                .iter()
                .find(|(id, _)| *id == s.id)
                .map_or([0.; 3], |(_, d)| *d);
            for (out, source) in p.vertices[index * 36..index * 36 + 36]
                .iter_mut()
                .zip(&self.terrain[index * 36..index * 36 + 36])
            {
                *out = *source;
                for (v, d) in out.position.iter_mut().zip(d) {
                    if d != 0. {
                        *v += d;
                    }
                }
            }
        }
        p.source_revision = Some(self.revision);
        p.offsets.clear();
        p.offsets.extend_from_slice(offsets);
        p.revision = p.revision.wrapping_add(1);
    }
    pub(crate) fn presented_terrain(&self) -> &[SpatialVertex] {
        if self.terrain_presentation.source_revision == Some(self.revision)
            && !self.terrain_presentation.offsets.is_empty()
        {
            &self.terrain_presentation.vertices
        } else {
            &self.terrain
        }
    }
    pub(crate) fn terrain_render_revision(&self) -> u32 {
        self.terrain_presentation
            .revision
            .wrapping_add(self.revision)
    }
}

impl SpatialScene {
    pub(super) fn validate_file_terrain_presentation(
        &self,
        b: &mut super::file_admission::Budget,
    ) -> Result<(), super::file_admission::Error> {
        use super::file_admission::{require, Field, Problem};
        let p = &self.terrain_presentation;
        b.work(4)?;
        b.product(p.offsets.len(), 5)?;
        b.product(p.vertices.len(), 12)?;
        require(
            p.offsets.len() <= 16
                && p.vertices.len() <= 256 * 36
                && p.vertices.len().is_multiple_of(36)
                && (p.source_revision.is_some() || p.offsets.is_empty() && p.vertices.is_empty()),
            Field::Vertex,
            0,
            Problem::Length,
        )?;
        for (i, (id, d)) in p.offsets.iter().enumerate() {
            b.work(i)?;
            require(
                *id > 0
                    && *id <= 65535
                    && d.iter().all(|v| v.is_finite() && v.abs() <= 2e6)
                    && !p.offsets[..i].iter().any(|(prev, _)| prev == id),
                Field::Vertex,
                i,
                Problem::Number,
            )?;
        }
        for (i, v) in p.vertices.iter().enumerate() {
            require(
                super::file_admission::vertex(v),
                Field::Vertex,
                i,
                Problem::Number,
            )?;
        }
        require(
            !p.offsets.is_empty() || p.vertices.is_empty(),
            Field::Vertex,
            0,
            Problem::Cache,
        )?;
        if p.source_revision == Some(self.revision) && !p.offsets.is_empty() {
            require(
                p.vertices.len() == self.terrain.len(),
                Field::Vertex,
                0,
                Problem::Length,
            )?;
            b.product(self.surfaces.len(), p.offsets.len() + 1)?;
            for (index, (id, _)) in p.offsets.iter().enumerate() {
                require(
                    self.surfaces.iter().any(|s| s.id == *id),
                    Field::Vertex,
                    index,
                    Problem::Reference,
                )?;
            }
            for (index, s) in self.surfaces.iter().enumerate() {
                let d = p
                    .offsets
                    .iter()
                    .find(|(id, _)| *id == s.id)
                    .map_or([0.; 3], |(_, d)| *d);
                for (actual, source) in p.vertices[index * 36..index * 36 + 36]
                    .iter()
                    .zip(&self.terrain[index * 36..index * 36 + 36])
                {
                    let mut expected = *source;
                    for (v, d) in expected.position.iter_mut().zip(d) {
                        if d != 0. {
                            *v += d;
                        }
                    }
                    require(
                        super::file_admission::bits(&actual.position, &expected.position)
                            && super::file_admission::bits(&actual.uv, &expected.uv)
                            && super::file_admission::bits(&actual.color, &expected.color)
                            && super::file_admission::bits(
                                &[actual.texture, actual.cutoff],
                                &[expected.texture, expected.cutoff],
                            ),
                        Field::Vertex,
                        index,
                        Problem::Cache,
                    )?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
impl SpatialScene {
    pub(crate) fn corrupt_terrain_presentation_fixture(&mut self) {
        self.terrain_presentation.vertices[0].position[0] += 1.;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terrain_integration_static_frames_borrow_original_mesh_without_presentation_allocation() {
        let mut scene = SpatialScene::default();
        assert!(
            scene.configure_surfaces(&[0., 0., 2., 2., 0., 1., 1., 1., 1., 1., 1.], &[1, 0, 0, 1])
        );
        let original = scene.terrain.as_ptr();
        let revision = scene.terrain_render_revision();
        for _ in 0..4 {
            scene.present_native_terrain(&[]);
            assert_eq!(scene.presented_terrain().as_ptr(), original);
            assert_eq!(scene.terrain_presentation.vertices.capacity(), 0);
            assert_eq!(scene.terrain_presentation.offsets.capacity(), 0);
            assert_eq!(scene.terrain_render_revision(), revision);
        }
        scene.present_native_terrain(&[(1, [0.5, 0., 0.])]);
        assert_ne!(scene.presented_terrain().as_ptr(), original);
        let interpolated = scene.terrain_render_revision();
        let capacity = scene.terrain_presentation.vertices.capacity();
        scene.present_native_terrain(&[]);
        assert_eq!(scene.presented_terrain().as_ptr(), original);
        assert!(scene.terrain_presentation.vertices.is_empty());
        assert_eq!(scene.terrain_presentation.vertices.capacity(), capacity);
        assert_ne!(scene.terrain_render_revision(), interpolated);
        let current = scene.terrain_render_revision();
        scene.present_native_terrain(&[]);
        assert_eq!(scene.terrain_render_revision(), current);
        let mut b = crate::spatial_scene::file_admission::Budget::new(
            crate::spatial_scene::file_admission::Limits {
                max_work: 10000,
                max_scratch_bytes: 0,
            },
        );
        scene.validate_file_terrain_presentation(&mut b).unwrap();
    }
}
