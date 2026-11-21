//! Terrain identity and two-phase synchronization into the shared solver.
use super::terrain_geometry::{self, TerrainDesc};
use super::{UnifiedPhysicsError, UnifiedPhysicsRuntime};
use crate::physics3d::{BodyId, ColliderId, PhysicsError, Space};
use crate::spatial_scene::SpatialScene;
use crate::tilemap::Tilemap;
use std::collections::BTreeMap;

/// Stable authored identity of geometry with no gameplay entity.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub enum UnifiedTerrainSource {
    /// Row-major cell of the main tilemap.
    Tile {
        /// Authored layer index.
        layer: u32,
        /// Row-major tile index.
        tile: u32,
    },
    /// Spatial scene surface; preserved across source-array reorderings.
    SpatialSurface {
        /// Authored surface id.
        id: u32,
    },
}

/// Native XYZ ray witness with its authored terrain identity.
#[derive(Debug, Clone, PartialEq)]
pub struct UnifiedTerrainRayHit {
    /// Tile or surface owning the collision geometry.
    pub source: UnifiedTerrainSource,
    /// Physical hit, independent of render offsets.
    pub hit: crate::physics3d::RayHit,
}

impl super::Engine {
    /// Synchronizes authored terrain and returns its closest native ray hits.
    /// Entity bodies are returned by `cast_unified_ray_all` instead. Inspection is
    /// two-sided, including one-way platforms; filters retain native semantics.
    /// Invalid input leaves `out` unchanged. True indicates omitted terrain hits.
    pub fn cast_unified_terrain_ray_all(
        &mut self,
        ray: &crate::physics3d::RayCast,
        filter: &crate::physics3d::QueryFilter,
        out: &mut Vec<UnifiedTerrainRayHit>,
        limit: usize,
    ) -> Result<bool, UnifiedPhysicsError> {
        if self.scene_mode != super::SceneMode::Data {
            return Err(UnifiedPhysicsError::WrongScene);
        }
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        if limit == 0 || limit > runtime.physics.config().max_colliders {
            return Err(PhysicsError::InvalidQuery.into());
        }
        runtime.collect_ray(
            &mut self.world,
            self.auto_rigid_body_step_config,
            ray,
            filter,
            (&self.tilemap, &self.spatial_scene),
        )?;
        out.clear();
        out.extend(runtime.native_ray_hits.iter().filter_map(|hit| {
            Some(UnifiedTerrainRayHit {
                source: runtime.terrain.source(hit.target.collider)?,
                hit: hit.clone(),
            })
        }));
        out.sort_unstable_by(|a, b| {
            a.hit
                .distance
                .total_cmp(&b.hit.distance)
                .then(a.source.cmp(&b.source))
        });
        let truncated = out.len() > limit;
        out.truncate(limit);
        Ok(truncated)
    }
}

// A fixed chunk owns at most 8 * 8 independently identifiable colliders. A
// height-span discontinuity starts another body; no AABB/shape merging occurs.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub(super) enum Group {
    Tile {
        layer: u32,
        column: u32,
        row: u32,
        span: Option<(u32, u32, u32)>,
    },
    Surface(u32),
}

impl Group {
    pub(super) fn valid(self) -> bool {
        match self {
            Self::Surface(id) => (1..=65535).contains(&id),
            Self::Tile {
                column, row, span, ..
            } => {
                column <= u32::MAX / 8
                    && row <= u32::MAX / 8
                    && span.is_none_or(|(floor, elevation, height)| {
                        crate::physics3d::PlanarCollisionSpan {
                            floor,
                            elevation: f32::from_bits(elevation),
                            height: f32::from_bits(height),
                        }
                        .valid()
                    })
            }
        }
    }
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct Wanted {
    pub(super) group: Group,
    pub(super) blocking: u8,
    pub(super) tile_columns: u32,
    pub(super) desc: TerrainDesc,
    layer: u32,
    tile: u32,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct Registered {
    pub(super) wanted: Wanted,
    pub(super) body: BodyId,
    collider: ColliderId,
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct Terrain {
    #[serde(deserialize_with = "super::file_ordered::map")]
    pub(super) groups: BTreeMap<Group, BodyId>,
    pub(super) revision: Option<(u64, u32)>,
    pending_revision: Option<(u64, u32)>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) pending_sources: Vec<(UnifiedTerrainSource, Group)>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) pending_groups: Vec<Group>,
    #[serde(deserialize_with = "super::file_ordered::optional_map")]
    pending: Option<BTreeMap<UnifiedTerrainSource, Wanted>>,
    #[serde(deserialize_with = "super::file_ordered::map")]
    pub(super) registered: BTreeMap<UnifiedTerrainSource, Registered>,
    #[serde(deserialize_with = "super::file_ordered::map")]
    pub(super) by_collider: BTreeMap<ColliderId, UnifiedTerrainSource>,
}

#[cfg(test)]
impl Terrain {
    pub(in crate::engine) fn corrupt_runtime_payload_fixture(&mut self, pending: bool) {
        if pending {
            self.pending
                .as_mut()
                .unwrap()
                .values_mut()
                .next()
                .unwrap()
                .desc
                .body
                .gravity_scale = f32::NAN;
        } else {
            self.registered
                .values_mut()
                .next()
                .unwrap()
                .wanted
                .desc
                .collider
                .friction = f32::NAN;
        }
    }
}

impl Terrain {
    pub(super) fn projected_count(&self) -> usize {
        if self.pending.is_some() {
            self.pending_sources.len()
        } else {
            self.registered.len()
        }
    }
    pub(super) fn current_count(&self) -> usize {
        self.registered.len()
    }
    pub(super) fn current_bodies(&self) -> usize {
        self.groups.len()
    }
    pub(super) fn projected_bodies(&self) -> usize {
        if self.pending.is_some() {
            self.pending_groups.len()
        } else {
            self.groups.len()
        }
    }
    fn want(
        &mut self,
        source: UnifiedTerrainSource,
        w: Wanted,
        changes: &mut BTreeMap<UnifiedTerrainSource, Wanted>,
    ) -> Result<(), UnifiedPhysicsError> {
        self.pending_sources
            .try_reserve(1)
            .map_err(|_| PhysicsError::CapacityExceeded)?;
        self.pending_groups
            .try_reserve(1)
            .map_err(|_| PhysicsError::CapacityExceeded)?;
        self.pending_sources.push((source, w.group));
        self.pending_groups.push(w.group);
        if self.registered.get(&source).is_some_and(|r| {
            r.wanted.desc == w.desc
                && r.wanted.group == w.group
                && r.wanted.blocking == w.blocking
                && r.wanted.tile_columns == w.tile_columns
        }) {
            return Ok(());
        }
        changes.insert(source, w);
        Ok(())
    }
    pub(super) fn source(&self, collider: ColliderId) -> Option<UnifiedTerrainSource> {
        self.by_collider.get(&collider).copied()
    }
    // 0: all geometry, 1: movement, 2: projectile, 3: vision. Selection
    // applies to authored terrain only, independently of its sensor response.
    pub(super) fn allows(&self, collider: ColliderId, purpose: u32) -> bool {
        let Some(r) = self
            .by_collider
            .get(&collider)
            .and_then(|k| self.registered.get(k))
        else {
            return false;
        };
        purpose == 0 || (purpose <= 3 && r.wanted.blocking & (1 << (purpose - 1)) != 0)
    }
}

impl UnifiedPhysicsRuntime {
    pub(super) fn prepare_terrain(
        &mut self,
        tiles: &Tilemap,
        spatial: &SpatialScene,
    ) -> Result<(), UnifiedPhysicsError> {
        Self::prepare_terrain_candidate(&mut self.terrain, &self.physics, tiles, spatial)
    }

    pub(in crate::engine) fn validate_collision_tilemap(
        &self,
        tiles: &Tilemap,
        spatial: &SpatialScene,
    ) -> Result<(), UnifiedPhysicsError> {
        let mut candidate = Terrain::default();
        Self::prepare_terrain_candidate(&mut candidate, &self.physics, tiles, spatial)?;
        let count = candidate.projected_count();
        let bodies = candidate.projected_bodies();
        if self.physics.body_count() - self.terrain.current_bodies() + bodies
            > self.physics.config().max_bodies
            || self.physics.collider_count() - self.terrain.current_count() + count
                > self.physics.config().max_colliders
        {
            return Err(PhysicsError::CapacityExceeded.into());
        }
        Ok(())
    }

    fn prepare_terrain_candidate(
        terrain: &mut Terrain,
        physics: &crate::physics3d::PhysicsWorld3d,
        tiles: &Tilemap,
        spatial: &SpatialScene,
    ) -> Result<(), UnifiedPhysicsError> {
        terrain.pending = None;
        terrain.pending_sources.clear();
        terrain.pending_groups.clear();
        let revision = (tiles.physics_revision(), spatial.revision);
        terrain.pending_revision = Some(revision);
        if terrain.revision == Some(revision) {
            return Ok(());
        }
        let space = physics.config().space;
        let mut wanted = BTreeMap::new();
        let capacity = physics.config().max_colliders;
        for t in tiles.terrain_tiles() {
            if terrain.pending_sources.len() >= capacity {
                return Err(PhysicsError::CapacityExceeded.into());
            }
            terrain.want(
                UnifiedTerrainSource::Tile {
                    layer: t.layer,
                    tile: t.tile,
                },
                Wanted {
                    group: tile_group(t, space),
                    blocking: tile_blocking(t),
                    tile_columns: t.columns,
                    desc: chunk_desc(terrain_geometry::tile(t, space)),
                    layer: t.layer,
                    tile: t.tile,
                },
                &mut wanted,
            )?;
        }
        if space == Space::Spatial {
            for (layer, &s) in spatial.surfaces.iter().enumerate() {
                if terrain.pending_sources.len() >= capacity {
                    return Err(PhysicsError::CapacityExceeded.into());
                }
                terrain.want(
                    UnifiedTerrainSource::SpatialSurface { id: s.id },
                    Wanted {
                        group: Group::Surface(s.id),
                        blocking: 7,
                        tile_columns: 0,
                        desc: surface_desc(spatial, s),
                        layer: layer as u32,
                        tile: 0,
                    },
                    &mut wanted,
                )?;
            }
        } else {
            for t in spatial.physics.terrain_tiles() {
                if terrain.pending_sources.len() >= capacity {
                    return Err(PhysicsError::CapacityExceeded.into());
                }
                let Some(s) = spatial.surfaces.get(t.layer as usize) else {
                    continue;
                };
                terrain.want(
                    UnifiedTerrainSource::SpatialSurface { id: s.id },
                    Wanted {
                        group: Group::Surface(s.id),
                        blocking: tile_blocking(t),
                        tile_columns: 0,
                        desc: {
                            let mut d = terrain_geometry::tile(t, space);
                            if spatial.moving_platforms.iter().any(|p| p.origin.id == s.id) {
                                d.body.kind = crate::physics3d::BodyKind::KinematicPosition;
                            }
                            d
                        },
                        layer: t.layer,
                        tile: t.tile,
                    },
                    &mut wanted,
                )?;
            }
        }
        terrain
            .pending_sources
            .sort_unstable_by_key(|(source, _)| *source);
        terrain.pending_groups.sort_unstable();
        terrain.pending_groups.dedup();
        if terrain.pending_groups.len() > physics.config().max_bodies {
            return Err(PhysicsError::CapacityExceeded.into());
        }
        // Validate before retiring any old terrain or consuming authored body inputs.
        for (key, w) in &wanted {
            if terrain
                .registered
                .get(key)
                .is_some_and(|r| r.wanted.desc == w.desc)
            {
                continue;
            }
            physics.validate_body_desc(&w.desc.body)?;
            physics.validate_collider_desc(&w.desc.collider, w.desc.body.kind)?;
            physics.validate_planar_collision_span(w.desc.span)?;
        }
        terrain.pending = Some(wanted);
        Ok(())
    }

    pub(super) fn retire_terrain(&mut self) -> Result<(), UnifiedPhysicsError> {
        let Some(wanted) = &self.terrain.pending else {
            return Ok(());
        };
        let mut error = None;
        self.terrain.registered.retain(|key, r| {
            if self
                .terrain
                .pending_sources
                .binary_search_by_key(key, |(source, _)| *source)
                .is_ok()
                && wanted.get(key).is_none_or(|w| w.group == r.wanted.group)
            {
                return true;
            }
            if let Err(e) = self.physics.remove_collider(r.collider) {
                error = Some(e);
                return true;
            }
            // Capture before erasing the collider -> authored-source provenance.
            self.lifecycle.capture(
                &mut self.physics,
                &self.entities_by_body,
                &self.terrain.by_collider,
            );
            self.terrain.by_collider.remove(&r.collider);
            false
        });
        if let Some(e) = error {
            return Err(e.into());
        }
        self.terrain.groups.retain(|_, body| {
            if self
                .physics
                .collider_ids(*body)
                .is_ok_and(|mut ids| ids.next().is_some())
            {
                return true;
            }
            if let Err(e) = self.physics.remove_body(*body) {
                error = Some(e);
                return true;
            }
            false
        });
        error.map_or(Ok(()), |e| Err(e.into()))
    }

    pub(super) fn commit_terrain(&mut self) -> Result<(), UnifiedPhysicsError> {
        let Some(wanted) = self.terrain.pending.take() else {
            return Ok(());
        };
        for (key, wanted) in wanted {
            let d = &wanted.desc;
            if let Some(r) = self.terrain.registered.get_mut(&key) {
                if r.wanted.desc.body.kind != d.body.kind {
                    self.physics
                        .set_body_options(r.body, &crate::physics3d::BodyOptions::from(&d.body))?;
                }
                if r.wanted.desc.collider != d.collider {
                    self.physics
                        .update_collider(r.collider, d.collider.clone())?;
                }
                if r.wanted.desc.body.pose != d.body.pose {
                    self.physics.set_pose(r.body, d.body.pose)?;
                }
                if r.wanted.desc.span != d.span {
                    self.physics.set_planar_collision_span(r.body, d.span)?;
                }
                if r.wanted.desc.one_way != d.one_way {
                    self.physics.set_terrain_one_way(r.collider, d.one_way)?;
                }
                r.wanted = wanted;
            } else {
                let (body, collider) = if let Some(&body) = self.terrain.groups.get(&wanted.group) {
                    (body, self.physics.add_collider(body, d.collider.clone())?)
                } else {
                    let body = self
                        .physics
                        .create_body(d.body.clone(), d.collider.clone())?;
                    self.physics.set_planar_collision_span(body, d.span)?;
                    let collider = self
                        .physics
                        .collider_ids(body)?
                        .next()
                        .ok_or(PhysicsError::StaleCollider)?;
                    self.terrain.groups.insert(wanted.group, body);
                    (body, collider)
                };
                self.physics.set_terrain_one_way(collider, d.one_way)?;
                self.terrain.by_collider.insert(collider, key);
                self.terrain.registered.insert(
                    key,
                    Registered {
                        wanted,
                        body,
                        collider,
                    },
                );
            }
        }
        self.terrain.revision = self.terrain.pending_revision;
        Ok(())
    }
}

fn tile_blocking(t: crate::tilemap::TerrainTile) -> u8 {
    t.hd.map_or(7, |h| {
        u8::from(h.blocks_movement)
            | (u8::from(h.blocks_projectile) << 1)
            | (u8::from(h.blocks_vision) << 2)
    })
}

fn tile_group(t: crate::tilemap::TerrainTile, space: Space) -> Group {
    Group::Tile {
        layer: t.layer,
        column: (t.tile % t.columns) / 8,
        row: (t.tile / t.columns) / 8,
        span: (space == Space::PlanarXy)
            .then_some(t.span)
            .flatten()
            .map(|s| (s.floor.0, s.elevation.to_bits(), s.height.to_bits())),
    }
}

fn chunk_desc(mut d: TerrainDesc) -> TerrainDesc {
    for (local, center) in d
        .collider
        .pose
        .position
        .iter_mut()
        .zip(d.body.pose.position)
    {
        *local += center;
    }
    d.body.pose = crate::physics3d::Pose::default();
    d
}

fn surface_desc(scene: &SpatialScene, s: crate::spatial_scene::Surface) -> TerrainDesc {
    let mut desc = terrain_geometry::surface(s);
    if let Some(platform) = scene.moving_platforms.iter().find(|p| p.origin.id == s.id) {
        // Reuse origin-local shape so translation rounding does not rebuild a
        // collider (and invalidate rider grounding) every frame.
        desc.collider = terrain_geometry::surface(platform.origin).collider;
        desc.body.kind = crate::physics3d::BodyKind::KinematicPosition;
    }
    desc
}

// Borrowed identity views for cold admission; authoring revisions may be dirty.
impl Registered {
    pub(super) fn file_collider(&self) -> ColliderId {
        self.collider
    }
    #[cfg(test)]
    pub(super) fn file_test_set_collider(&mut self, collider: ColliderId) {
        self.collider = collider;
    }
}
impl Wanted {
    pub(super) fn file_matches_origin(&self, source: UnifiedTerrainSource) -> bool {
        match source {
            UnifiedTerrainSource::Tile { layer, tile } => {
                let Group::Tile {
                    layer: group_layer,
                    column,
                    row,
                    span,
                } = self.group
                else {
                    return false;
                };
                self.layer == layer
                    && self.tile == tile
                    && self.tile_columns > 0
                    && group_layer == layer
                    && column == (tile % self.tile_columns) / 8
                    && row == (tile / self.tile_columns) / 8
                    && span
                        == self
                            .desc
                            .span
                            .map(|s| (s.floor, s.elevation.to_bits(), s.height.to_bits()))
                    && self.desc.body.pose == crate::physics3d::Pose::default()
            }
            // Planar surfaces copy Tilemap terrain provenance; spatial ones
            // use (row, 0). Both are cached authoring, not current array indices.
            UnifiedTerrainSource::SpatialSurface { id } => {
                self.group == Group::Surface(id) && self.tile_columns == 0
            }
        }
    }
}
impl Terrain {
    pub(super) fn file_pending(&self) -> Option<&BTreeMap<UnifiedTerrainSource, Wanted>> {
        self.pending.as_ref()
    }
}

mod file_payload_admission;
