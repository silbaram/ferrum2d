use super::{shapes, Engine};
use crate::engine::unified_physics::{UnifiedPhysicsRuntime, UnifiedTerrainSource};
use crate::entity::Entity;
use crate::physics3d::{ColliderId, ColliderRef, PlanarCollisionSpan, Pose, QueryFilter, RayCast};
use wasm_bindgen::prelude::*;

const METADATA: usize = 12;
const VALUES: usize = 13;
const MAX_QUERIES: usize = 256;
const MAX_HITS: usize = 65536;

#[repr(C)]
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct HitRecord {
    query: u32,
    kind: u32,
    flags: u32,
    #[serde(with = "crate::checkpoint_codec::array")]
    entity: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    body: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    collider: [u32; 2],
    value: f32,
    #[serde(with = "crate::checkpoint_codec::array")]
    point: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    normal: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    terrain: [u32; 3],
}
const _: () = assert!(std::mem::size_of::<HitRecord>() == 76);
const _: () = assert!(std::mem::align_of::<HitRecord>() == 4);
const _: () = assert!(std::mem::size_of::<[u32; 3]>() == 12);

impl HitRecord {
    fn new(index: usize, kind: u32, target: ColliderRef, runtime: &UnifiedPhysicsRuntime) -> Self {
        let entity = runtime.entities_by_body.get(&target.body);
        Self {
            query: index as u32,
            kind,
            flags: u32::from(entity.is_some()) | (u32::from(target.sensor) << 1),
            entity: entity.map_or([0; 2], |e| [e.id, e.generation]),
            body: [target.body.slot, target.body.generation],
            collider: [target.collider.slot, target.collider.generation],
            value: 0.0,
            point: [0.0; 3],
            normal: [0.0; 3],
            terrain: match runtime.terrain.source(target.collider) {
                Some(UnifiedTerrainSource::Tile { layer, tile }) => [1, layer, tile],
                Some(UnifiedTerrainSource::SpatialSurface { id }) => [2, id, 0],
                None => [0; 3],
            },
        }
    }
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct QueryBuffers {
    #[serde(with = "crate::checkpoint_codec::vector")]
    hits: Vec<HitRecord>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    summaries: Vec<[u32; 3]>,
}
impl QueryBuffers {
    fn clear(&mut self) {
        self.hits.clear();
        self.summaries.clear();
    }
}

fn validate_row(m: &[u32], v: &[f32]) -> Result<(), String> {
    let shape = matches!(m[0], 2 | 3);
    if m[0] > 4
        || m[1] & !511 != 0
        || (m[1] >> 6) > 4
        || m[9] == 0
        || m[9] as usize > MAX_HITS
        || (m[0] != 0 && m[1] & 32 != 0)
        || (m[1] & 4 == 0 && m[4..6] != [0, 0])
        || (m[1] & 8 == 0 && m[6..8] != [0, 0])
        || (m[1] & 16 == 0 && (m[8] != 0 || v[11..13] != [0.0, 0.0]))
        || (!shape && (m[10..12] != [0, 0] || v[3..7] != [0.0, 0.0, 0.0, 1.0]))
        || (!matches!(m[0], 0 | 3) && v[7..10] != [0.0; 3])
        || (!matches!(m[0], 0 | 4) && v[10] != 0.0)
    {
        return Err("Invalid unified physics query metadata or unused values".into());
    }
    Ok(())
}

#[wasm_bindgen]
impl Engine {
    /// Query v1: 12 metadata u32s + 13 f32s per request, sequential convex shape streams.
    /// Results are 19 words per hit; each query has offset/count/truncated in three u32s.
    pub fn unified_physics_query_version(&self) -> u32 {
        1
    }

    /// Executes at most 256 mixed queries without advancing simulation time.
    /// Kind 0 ray, 1 point overlap, 2 convex overlap, 3 convex sweep, 4 closest point.
    /// Limits sum to at most 65536 hits. Any error clears all public output buffers.
    pub fn query_unified_physics(
        &mut self,
        metadata: &[u32],
        values: &[f32],
        shape_metadata: &[u32],
        shape_values: &[f32],
    ) -> Result<(), String> {
        self.unified_physics_queries.clear();
        let result = self.run_unified_queries(metadata, values, shape_metadata, shape_values);
        if result.is_err() {
            self.unified_physics_queries.clear();
        }
        result
    }
    pub fn unified_physics_query_hit_stride_words(&self) -> usize {
        19
    }
    pub fn unified_physics_query_summary_stride_words(&self) -> usize {
        3
    }
    pub fn unified_physics_query_count(&self) -> usize {
        self.unified_physics_queries.summaries.len()
    }
    pub fn unified_physics_query_hit_count(&self) -> usize {
        self.unified_physics_queries.hits.len()
    }
    pub fn unified_physics_query_hit_ptr(&self) -> *const u32 {
        self.unified_physics_queries.hits.as_ptr().cast()
    }
    pub fn unified_physics_query_summary_ptr(&self) -> *const u32 {
        self.unified_physics_queries.summaries.as_ptr().cast()
    }
}

#[cfg(test)]
mod tests;

impl Engine {
    fn run_unified_queries(
        &mut self,
        metadata: &[u32],
        values: &[f32],
        mut shape_metadata: &[u32],
        mut shape_values: &[f32],
    ) -> Result<(), String> {
        if !metadata.len().is_multiple_of(METADATA)
            || metadata.len() / METADATA > MAX_QUERIES
            || values.len() != metadata.len() / METADATA * VALUES
            || values.iter().any(|v| !v.is_finite())
            || shape_metadata.len() > MAX_QUERIES * 2
            || shape_values.len() > MAX_QUERIES * 768
        {
            return Err("Invalid unified physics query batch size or values".into());
        }
        let mut requested = 0usize;
        for (m, v) in metadata
            .chunks_exact(METADATA)
            .zip(values.chunks_exact(VALUES))
        {
            validate_row(m, v)?;
            requested += m[9] as usize;
        }
        if requested > MAX_HITS {
            return Err("Unified physics query hit capacity exceeded".into());
        }
        if self.scene_mode != crate::engine::SceneMode::Data {
            return Err("Unified physics queries require a Data Scene".into());
        }
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or("Unified physics is not configured")?;
        runtime
            .prepare_query(
                &mut self.world,
                self.auto_rigid_body_step_config,
                &self.tilemap,
                &self.spatial_scene,
            )
            .map_err(|e| e.to_string())?;
        let out = &mut self.unified_physics_queries;
        for (index, (m, v)) in metadata
            .chunks_exact(METADATA)
            .zip(values.chunks_exact(VALUES))
            .enumerate()
        {
            let (sm, tail) = shape_metadata
                .split_at_checked(m[10] as usize)
                .ok_or("Truncated query shape metadata")?;
            shape_metadata = tail;
            let (sv, tail) = shape_values
                .split_at_checked(m[11] as usize)
                .ok_or("Truncated query shape values")?;
            shape_values = tail;
            let shape = if matches!(m[0], 2 | 3) {
                if sm.first().is_none_or(|code| *code > 3) {
                    return Err("Queries require convex primitives or hulls".into());
                }
                Some(shapes::decode(sm, sv)?)
            } else {
                None
            };
            let exclude_body = if m[1] & 4 != 0 {
                let e = Entity {
                    id: m[4],
                    generation: m[5],
                };
                if !self.world.is_current_entity(e) {
                    return Err("Stale query excluded entity".into());
                }
                Some(
                    runtime
                        .bindings
                        .get(&(e.id, e.generation))
                        .ok_or("Unbound query excluded entity")?
                        .body,
                )
            } else {
                None
            };
            let filter = QueryFilter {
                category: m[2],
                mask: m[3],
                respect_target_mask: m[1] & 2 != 0,
                include_sensors: m[1] & 1 != 0,
                exclude_body,
                exclude_collider: (m[1] & 8 != 0).then_some(ColliderId {
                    slot: m[6],
                    generation: m[7],
                }),
                planar_span: (m[1] & 16 != 0).then_some(PlanarCollisionSpan {
                    floor: m[8],
                    elevation: v[11],
                    height: v[12],
                }),
            };
            let pose = Pose {
                position: [v[0], v[1], v[2]],
                rotation: [v[3], v[4], v[5], v[6]],
            };
            let motion = [v[7], v[8], v[9]];
            // Purpose selection happens before the caller's hit limit. Query
            // geometry once; never let earlier non-terrain hits hide terrain.
            let terrain_selection = m[1] >> 6;
            let mut filter = filter;
            if terrain_selection != 0 {
                filter.include_sensors = true;
                filter.respect_target_mask = false;
            }
            let limit = if terrain_selection == 0 {
                (m[9] as usize).min(runtime.physics.config().max_colliders)
            } else {
                runtime.physics.config().max_colliders
            };
            let start = out.hits.len();
            let result = match m[0] {
                0 => runtime.physics.cast_ray_all(
                    &RayCast {
                        origin: pose.position,
                        direction: motion,
                        max_distance: v[10],
                        solid: m[1] & 32 != 0,
                    },
                    &filter,
                    &mut runtime.native_ray_hits,
                    limit,
                ),
                1 => runtime.physics.overlap_point(
                    pose.position,
                    &filter,
                    &mut runtime.native_point_hits,
                    limit,
                ),
                2 => runtime.physics.overlap(
                    shape.as_ref().ok_or("Missing overlap shape")?,
                    pose,
                    &filter,
                    &mut runtime.native_point_hits,
                    limit,
                ),
                3 => runtime.physics.sweep_all(
                    shape.as_ref().ok_or("Missing sweep shape")?,
                    pose,
                    motion,
                    &filter,
                    &mut runtime.native_sweep_hits,
                    limit,
                ),
                4 => runtime.physics.project_point_all(
                    pose.position,
                    v[10],
                    &filter,
                    &mut runtime.native_nearest_hits,
                    limit,
                ),
                _ => unreachable!("query kind was checked before preparation"),
            };
            let mut truncated =
                result.map_err(|e| format!("Unified physics query {index}: {e}"))?;
            if terrain_selection != 0 {
                let terrain = &runtime.terrain;
                let requested = m[9] as usize;
                macro_rules! select {
                    ($hits:expr, $id:expr) => {{
                        $hits.retain(|hit| terrain.allows(($id)(hit), terrain_selection - 1));
                        truncated |= $hits.len() > requested;
                        $hits.truncate(requested);
                    }};
                }
                match m[0] {
                    0 => select!(runtime.native_ray_hits, |h: &crate::physics3d::RayHit| h
                        .target
                        .collider),
                    1 | 2 => select!(runtime.native_point_hits, |h: &ColliderRef| h.collider),
                    3 => select!(
                        runtime.native_sweep_hits,
                        |h: &crate::physics3d::SweepHit| h.target.collider
                    ),
                    4 => select!(
                        runtime.native_nearest_hits,
                        |h: &crate::physics3d::PointHit| h.target.collider
                    ),
                    _ => unreachable!(),
                }
            }
            match m[0] {
                0 => {
                    for hit in &runtime.native_ray_hits {
                        let mut row = HitRecord::new(index, m[0], hit.target, runtime);
                        row.value = hit.distance;
                        row.point = hit.point;
                        row.normal = hit.normal;
                        out.hits.push(row);
                    }
                }
                1 | 2 => {
                    for hit in &runtime.native_point_hits {
                        out.hits.push(HitRecord::new(index, m[0], *hit, runtime));
                    }
                }
                3 => {
                    for hit in &runtime.native_sweep_hits {
                        let mut row = HitRecord::new(index, m[0], hit.target, runtime);
                        row.value = hit.fraction;
                        row.point = hit.point;
                        row.normal = hit.normal;
                        row.flags |= u32::from(hit.initial_overlap) << 2;
                        out.hits.push(row);
                    }
                }
                4 => {
                    for hit in &runtime.native_nearest_hits {
                        let mut row = HitRecord::new(index, m[0], hit.target, runtime);
                        row.value = hit.distance;
                        row.point = hit.point;
                        row.flags |= u32::from(hit.is_inside) << 3;
                        out.hits.push(row);
                    }
                }
                _ => unreachable!("query kind was checked before preparation"),
            }
            out.summaries.push([
                start as u32,
                (out.hits.len() - start) as u32,
                u32::from(truncated),
            ]);
        }
        if !shape_metadata.is_empty() || !shape_values.is_empty() {
            return Err("Trailing query shape payload".into());
        }
        Ok(())
    }
}

mod file_output_admission;
