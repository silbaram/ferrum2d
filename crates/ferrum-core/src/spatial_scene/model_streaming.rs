//! Native distance policy; CPU decoding and bounded GPU ownership remain on the platform.
use super::{models::SpatialModels, SpatialCamera};
use std::collections::BTreeMap;
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Chunk {
    #[serde(with = "crate::checkpoint_codec::array")]
    bounds: [f32; 6],
    enter: f32,
    exit: f32,
    active: bool,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Level {
    asset: u32,
    distance: f32,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Policy {
    chunk: usize,
    #[serde(with = "crate::checkpoint_codec::vector")]
    levels: Vec<Level>,
    selected: usize,
}
/// A cold authoring handoff only; never part of the persisted game-state format.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ModelLodContinuity {
    #[serde(with = "crate::checkpoint_codec::vector")]
    levels: Vec<Level>,
    selected: usize,
}
#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct ModelStreaming {
    #[serde(with = "crate::checkpoint_codec::vector")]
    chunks: Vec<Chunk>,
    #[serde(deserialize_with = "crate::spatial_scene::file_admission::ordered::map")]
    policies: BTreeMap<(u32, u32), Policy>,
}
impl SpatialModels {
    pub(crate) fn capture_lod_continuity(&self, key: (u32, u32)) -> Option<ModelLodContinuity> {
        self.streaming
            .policies
            .get(&key)
            .map(|policy| ModelLodContinuity {
                levels: policy.levels.clone(),
                selected: policy.selected,
            })
    }
    pub(crate) fn restore_lod_continuity(&mut self, key: (u32, u32), state: &ModelLodContinuity) {
        if let Some(policy) = self.streaming.policies.get_mut(&key) {
            if policy.levels == state.levels {
                policy.selected = state.selected;
            }
        }
    }
    /// Chunks: min XYZ/max XYZ/enter/exit (world XYZ). Rows: entity/generation/asset/primitives/triangles/chunk (1 based, 0 always resident).
    /// Each model starts with its original asset at distance 0; at most four ascending levels per model.
    pub fn configure_streaming(
        &mut self,
        chunks: &[f32],
        metadata: &[u32],
        distances: &[f32],
    ) -> bool {
        if !chunks.len().is_multiple_of(8)
            || chunks.len() > 64 * 8
            || !metadata.len().is_multiple_of(6)
            || metadata.len() > 1024 * 4 * 6
            || distances.len() != metadata.len() / 6
        {
            return false;
        }
        let mut next = ModelStreaming::default();
        for v in chunks.chunks_exact(8) {
            if v.iter().any(|x| !x.is_finite())
                || (0..3).any(|i| v[i] > v[i + 3])
                || v[6] < 0.
                || v[7] <= v[6]
                || v.iter().any(|x| x.abs() > 1e6)
            {
                return false;
            }
            next.chunks.push(Chunk {
                bounds: v[..6].try_into().expect("six bounds"),
                enter: v[6],
                exit: v[7],
                active: false,
            });
        }
        let mut costs = BTreeMap::<(u32, u32), (u32, u32)>::new();
        for (m, &distance) in metadata.chunks_exact(6).zip(distances) {
            let key = (m[0], m[1]);
            let Some(binding) = self.bindings.get(&key) else {
                return false;
            };
            if m[2] == 0
                || !(1..=32).contains(&m[3])
                || !(1..=65536).contains(&m[4])
                || m[5] as usize > next.chunks.len()
                || !distance.is_finite()
                || !(0. ..=1e6).contains(&distance)
            {
                return false;
            }
            let policy = next.policies.entry(key).or_insert_with(|| Policy {
                chunk: m[5] as usize,
                levels: Vec::new(),
                selected: 0,
            });
            if policy.chunk != m[5] as usize
                || policy.levels.len() >= 4
                || policy.levels.last().is_some_and(|l| l.distance >= distance)
                || (policy.levels.is_empty() && (distance != 0. || m[2] != binding.asset))
            {
                return false;
            }
            policy.levels.push(Level {
                asset: m[2],
                distance,
            });
            let cost = costs.entry(key).or_default();
            cost.0 = cost.0.max(m[3]);
            cost.1 = cost.1.max(m[4]);
        }
        // Every binding is represented so raw policy cannot bypass the scene submission budget.
        if costs.len() != self.bindings.len()
            || costs.values().map(|c| u64::from(c.0)).sum::<u64>() > 4096
            || costs.values().map(|c| u64::from(c.1)).sum::<u64>() > 262144
        {
            return false;
        }
        self.streaming = next;
        true
    }
    pub fn streaming_asset_in_use(&self, asset: u32) -> bool {
        self.streaming
            .policies
            .values()
            .any(|p| p.levels.iter().any(|l| l.asset == asset))
    }
}
impl ModelStreaming {
    pub fn update_chunks(&mut self, camera: &SpatialCamera) {
        let eye = [
            camera.parameters[1],
            camera.parameters[2],
            camera.parameters[3],
        ];
        for c in &mut self.chunks {
            let d = (0..3)
                .map(|i| {
                    let x = eye[i].clamp(c.bounds[i], c.bounds[i + 3]);
                    (eye[i] - x).powi(2)
                })
                .sum::<f32>()
                .sqrt();
            c.active = d <= if c.active { c.exit } else { c.enter };
        }
    }
    pub fn select(
        &mut self,
        key: (u32, u32),
        base: u32,
        matrix: &[f32; 16],
        camera: &SpatialCamera,
    ) -> (u32, bool) {
        let Some(p) = self.policies.get_mut(&key) else {
            return (base, true);
        };
        let d = ((matrix[12] - camera.parameters[1]).powi(2)
            + (matrix[13] - camera.parameters[2]).powi(2)
            + (matrix[14] - camera.parameters[3]).powi(2))
        .sqrt();
        // Ten percent hysteresis prevents upload churn at LOD boundaries.
        while p.selected + 1 < p.levels.len() && d >= p.levels[p.selected + 1].distance * 1.1 {
            p.selected += 1;
        }
        while p.selected > 0 && d < p.levels[p.selected].distance * 0.9 {
            p.selected -= 1;
        }
        (
            p.levels[p.selected].asset,
            p.chunk == 0 || self.chunks[p.chunk - 1].active,
        )
    }
}

impl ModelStreaming {
    pub(super) fn validate_file(
        &self,
        bindings: &BTreeMap<(u32, u32), super::models::ModelBinding>,
        b: &mut super::file_admission::Budget,
    ) -> Result<(), super::file_admission::Error> {
        use super::file_admission::{finite, require, Field, Problem};
        b.work(self.chunks.len())?;
        b.work(self.policies.len())?;
        require(
            self.chunks.len() <= 64
                && (self.policies.is_empty() || self.policies.len() == bindings.len()),
            Field::Streaming,
            0,
            Problem::Length,
        )?;
        for (i, c) in self.chunks.iter().enumerate() {
            require(
                finite(&c.bounds)
                    && finite(&[c.enter, c.exit])
                    && c.bounds
                        .iter()
                        .chain([c.enter, c.exit].iter())
                        .all(|v| v.abs() <= 1e6)
                    && (0..3).all(|axis| c.bounds[axis] <= c.bounds[axis + 3])
                    && c.enter >= 0.
                    && c.exit > c.enter,
                Field::Streaming,
                i,
                Problem::Range,
            )?;
        }
        b.sort(bindings.len().max(self.policies.len()))?;
        for (i, ((key, p), (binding_key, binding))) in
            self.policies.iter().zip(bindings).enumerate()
        {
            require(
                key == binding_key && p.chunk <= self.chunks.len(),
                Field::Streaming,
                i,
                Problem::Reference,
            )?;
            validate_levels(&p.levels, p.selected, b)?;
            require(
                p.levels[0].asset == binding.asset,
                Field::Streaming,
                i,
                Problem::Reference,
            )?;
        }
        Ok(())
    }
}
fn validate_levels(
    levels: &[Level],
    selected: usize,
    b: &mut super::file_admission::Budget,
) -> Result<(), super::file_admission::Error> {
    use super::file_admission::{require, Field, Problem};
    b.work(levels.len())?;
    require(
        !levels.is_empty() && levels.len() <= 4 && selected < levels.len(),
        Field::Streaming,
        0,
        Problem::Length,
    )?;
    for (i, l) in levels.iter().enumerate() {
        require(
            l.asset != 0
                && l.distance.is_finite()
                && (0. ..=1e6).contains(&l.distance)
                && if i == 0 {
                    l.distance == 0.
                } else {
                    levels[i - 1].distance < l.distance
                },
            Field::Streaming,
            i,
            Problem::Order,
        )?;
    }
    Ok(())
}
impl ModelLodContinuity {
    pub(crate) fn validate_file(
        &self,
        b: &mut super::file_admission::Budget,
    ) -> Result<(), super::file_admission::Error> {
        validate_levels(&self.levels, self.selected, b)
    }
}
#[cfg(test)]
impl ModelStreaming {
    pub(super) fn corrupt_file_fixture(&mut self, case: u32) {
        let p = self.policies.values_mut().next().unwrap();
        match case {
            0 => p.selected = usize::MAX,
            1 => p.chunk = usize::MAX,
            2 => p.levels[0].distance = f32::NAN,
            _ => unreachable!(),
        }
    }
}
#[cfg(test)]
impl ModelLodContinuity {
    pub(crate) fn corrupt_file_fixture(&mut self) {
        self.selected = usize::MAX;
    }
}

#[cfg(test)]
impl ModelStreaming {
    pub(super) fn file_collection_packet(&self, packet: &[u8], duplicate: bool) -> Vec<u8> {
        super::file_admission::collection_tests::map_packet(packet, &self.policies, duplicate)
    }
}

// Cold readonly projection. Header callback precedes every variable level visit;
// the caller charges policy/level work before either pass. No streaming update.
impl SpatialModels {
    pub(crate) fn file_roster_policy_count(&self) -> usize {
        self.streaming.policies.len()
    }
    pub(crate) fn visit_file_roster_lods<E>(
        &self,
        visit: &mut impl FnMut((u32, u32), usize, Option<(usize, u32)>) -> Result<(), E>,
    ) -> Result<(), E> {
        for (&key, p) in &self.streaming.policies {
            visit(key, p.levels.len(), None)?;
            for (i, l) in p.levels.iter().enumerate() {
                visit(key, p.levels.len(), Some((i, l.asset)))?;
            }
        }
        Ok(())
    }
}
impl ModelLodContinuity {
    pub(crate) fn file_roster_levels(&self) -> impl ExactSizeIterator<Item = u32> + '_ {
        self.levels.iter().map(|l| l.asset)
    }
    pub(crate) fn file_roster_selected(&self) -> usize {
        self.selected
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{components::Transform2D, world::World};
    fn camera(x: f32) -> SpatialCamera {
        SpatialCamera::new(&[0., x, 0., 1., x, 0., 0., 100., 0.1, 2000., 100., 100.]).unwrap()
    }
    #[test]
    fn chunk_and_lod_hysteresis_are_native_atomic_and_preserve_off_camera_shadows() {
        let mut world = World::default();
        let e = world.spawn_entity();
        world.set_transform(e, Transform2D { x: 0., y: 0. });
        let mut models = SpatialModels::default();
        assert!(models.configure(
            &world,
            &[e.id, e.generation, 1, 3, 1, 2],
            &[0., 0., 1., -1., -1., -1., 1., 1., 1.]
        ));
        let chunks = [-10., -10., -10., 10., 10., 10., 200., 300.];
        let rows = [
            e.id,
            e.generation,
            1,
            1,
            2,
            1,
            e.id,
            e.generation,
            2,
            1,
            1,
            1,
        ];
        assert!(models.configure_streaming(&chunks, &rows, &[0., 100.]));
        assert!(models.draw_snapshot((e.id, e.generation)).is_empty());
        let asset = |m: &SpatialModels| unsafe {
            std::slice::from_raw_parts(m.draws.as_ptr().cast::<u32>(), 20)[0]
        };
        models.build(&world, &camera(80.), &[], false, &Default::default());
        assert_eq!(asset(&models), 1);
        models.build(&world, &camera(112.), &[], false, &Default::default());
        assert_eq!(asset(&models), 2);
        let snapshot = models.draw_snapshot((e.id, e.generation));
        assert_eq!(snapshot.len(), 20);
        assert_eq!(snapshot[0], 2);
        assert!(models.draw_snapshot((e.id, e.generation + 1)).is_empty());
        models.build(&world, &camera(95.), &[], false, &Default::default());
        assert_eq!(asset(&models), 2);
        assert_eq!(models.draw_snapshot((e.id, e.generation))[0], 2);
        models.build(&world, &camera(88.), &[], false, &Default::default());
        assert_eq!(asset(&models), 1);
        assert_eq!(models.draw_snapshot((e.id, e.generation))[0], 1);
        models.build(&world, &camera(260.), &[], false, &Default::default());
        assert_eq!(models.draws.len(), 1);
        models.build(&world, &camera(320.), &[], false, &Default::default());
        assert!(models.draws.is_empty());
        assert!(models.draw_snapshot((e.id, e.generation)).is_empty());
        models.build(&world, &camera(260.), &[], false, &Default::default());
        assert!(models.draws.is_empty());
        // A light can still require the same far model. Identity frustum includes the origin bounds.
        let identity = [
            1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
        ];
        models.build(&world, &camera(320.), &identity, false, &Default::default());
        assert_eq!(asset(&models), 2);
        let words = unsafe { std::slice::from_raw_parts(models.draws.as_ptr().cast::<u32>(), 20) };
        assert_eq!(words[2], 128);
        assert_eq!(models.draw_snapshot((e.id, e.generation))[2], 128);
        assert!(models.streaming_asset_in_use(2));
        assert!(!models.configure_streaming(&chunks, &rows, &[0., 0.]));
        models.build(&world, &camera(180.), &[], false, &Default::default());
        assert_eq!(asset(&models), 2);
        assert!(!models.configure_streaming(
            &[-1., -1., -1., 1., 1., 1., 20., 10.],
            &rows,
            &[0., 100.]
        ));
    }
}
