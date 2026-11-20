//! Cold readonly admission of spatial payloads. Host/GPU resources, the native
//! world and World arena/payload have separate admission prerequisites. Cached
//! outputs and stale generations are checked without rendering or repairing.
use super::*;

pub(super) mod ordered;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    pub max_work: u64,
    pub max_scratch_bytes: usize,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Usage {
    pub work: u64,
    /// Cumulative requested payload capacity, not allocator metadata or peak RSS.
    pub scratch_bytes: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Field {
    Camera,
    Presentation,
    Surface,
    Platform,
    Connection,
    Vertex,
    Material,
    Receiver,
    DrawRange,
    Binding,
    Attachment,
    Model,
    Streaming,
    Environment,
    Selection,
    Debug,
    Navigation,
    Continuity,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Problem {
    Number,
    Range,
    Length,
    Reference,
    Order,
    Duplicate,
    Cache,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    WorkLimit,
    ScratchLimit,
    Allocation,
    Invalid {
        field: Field,
        index: usize,
        problem: Problem,
    },
    Tilemap(crate::tilemap::file_admission::Error),
    Scratch(crate::collision::file_scratch_admission::Error),
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "spatial file admission rejected: {self:?}")
    }
}
impl std::error::Error for Error {}
pub(crate) fn require(ok: bool, field: Field, index: usize, problem: Problem) -> Result<(), Error> {
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid {
            field,
            index,
            problem,
        })
    }
}
pub(crate) struct Budget {
    limits: Limits,
    pub(crate) usage: Usage,
}
impl Budget {
    pub(crate) fn new(limits: Limits) -> Self {
        Self {
            limits,
            usage: Usage::default(),
        }
    }
    pub(crate) fn work(&mut self, count: usize) -> Result<(), Error> {
        let count = u64::try_from(count).map_err(|_| Error::WorkLimit)?;
        let next = self.usage.work.checked_add(count).ok_or(Error::WorkLimit)?;
        if next > self.limits.max_work {
            return Err(Error::WorkLimit);
        }
        self.usage.work = next;
        Ok(())
    }
    pub(crate) fn product(&mut self, count: usize, each: usize) -> Result<(), Error> {
        self.work(count.checked_mul(each).ok_or(Error::WorkLimit)?)
    }
    pub(crate) fn sort(&mut self, count: usize) -> Result<(), Error> {
        let log = (usize::BITS - count.saturating_sub(1).leading_zeros()) as usize;
        self.product(count, log + 1)
    }
    pub(crate) fn vector<T>(&mut self, count: usize) -> Result<Vec<T>, Error> {
        self.work(count)?;
        let bytes = count
            .checked_mul(std::mem::size_of::<T>())
            .ok_or(Error::ScratchLimit)?;
        let next = self
            .usage
            .scratch_bytes
            .checked_add(bytes)
            .ok_or(Error::ScratchLimit)?;
        if next > self.limits.max_scratch_bytes {
            return Err(Error::ScratchLimit);
        }
        self.usage.scratch_bytes = next;
        let mut out = Vec::new();
        out.try_reserve_exact(count)
            .map_err(|_| Error::Allocation)?;
        Ok(out)
    }
    pub(crate) fn remaining(&self) -> Limits {
        Limits {
            max_work: self.limits.max_work - self.usage.work,
            max_scratch_bytes: self.limits.max_scratch_bytes - self.usage.scratch_bytes,
        }
    }
    pub(crate) fn external(&mut self, usage: Usage) -> Result<(), Error> {
        let work = self
            .usage
            .work
            .checked_add(usage.work)
            .ok_or(Error::WorkLimit)?;
        let scratch = self
            .usage
            .scratch_bytes
            .checked_add(usage.scratch_bytes)
            .ok_or(Error::ScratchLimit)?;
        if work > self.limits.max_work {
            return Err(Error::WorkLimit);
        }
        if scratch > self.limits.max_scratch_bytes {
            return Err(Error::ScratchLimit);
        }
        self.usage = Usage {
            work,
            scratch_bytes: scratch,
        };
        Ok(())
    }
}
pub(crate) fn finite(values: &[f32]) -> bool {
    values.iter().all(|x| x.is_finite())
}
pub(crate) fn bits(a: &[f32], b: &[f32]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(a, b)| a.to_bits() == b.to_bits())
}
pub(crate) fn entity_history(world: &World, e: Entity) -> bool {
    world.generation_at_index(e.id as usize).is_some_and(|g| {
        e.generation < g || e.generation == g && (world.is_current_entity(e) || g == u32::MAX)
    })
}
pub(crate) fn masks(v: SpatialReceiverMasks) -> bool {
    v.light_mask <= 255 && v.shadow_mask <= 255
}
pub(crate) fn material(v: SpatialMaterial) -> bool {
    v.normal_texture <= 16_777_215 && v.flags <= 3
}
pub(crate) fn billboard(v: Billboard) -> bool {
    finite(&[v.units_per_pixel, v.cutoff, v.elevation])
        && v.units_per_pixel > 0.
        && (0. ..=1.).contains(&v.cutoff)
        && material(v.material)
        && masks(v.receiver_masks)
}
pub(crate) fn span(v: crate::components::HeightSpan) -> bool {
    crate::components::HeightSpan::new(v.floor, v.elevation, v.height).is_some()
}
pub(crate) fn surface(v: Surface) -> bool {
    finite(&v.bounds)
        && finite(&v.heights)
        && v.base.is_finite()
        && v.bounds[2] > 0.
        && v.bounds[3] > 0.
        && (v.bounds[0] + v.bounds[2]).is_finite()
        && (v.bounds[1] + v.bounds[3]).is_finite()
        && v.bounds[0] + v.bounds[2] > v.bounds[0]
        && v.bounds[1] + v.bounds[3] > v.bounds[1]
        && v.base <= v.heights[0].min(v.heights[1])
        && v.color.iter().all(|x| (0. ..=1.).contains(x))
        && (1..=65535).contains(&v.id)
        && v.floor <= 65535
        && v.texture <= 16_777_215
        && [0, 1, 2, 4].contains(&v.kind)
        && (v.kind == 2 || v.heights[0] == v.heights[1] && !v.ramp_x)
        && (v.is_rendered || v.texture == 16_777_215)
        && masks(v.receiver_masks)
}
pub(crate) fn vertex(v: &SpatialVertex) -> bool {
    finite(&v.position)
        && finite(&v.uv)
        && finite(&v.color)
        && v.texture.is_finite()
        && v.texture.fract() == 0.
        && (0. ..=u32::MAX as f32).contains(&v.texture)
        && (0. ..=1.).contains(&v.cutoff)
}
fn camera(v: &SpatialCamera) -> bool {
    let Some(expected) = SpatialCamera::new(&v.parameters) else {
        return false;
    };
    bits(&v.matrix, &expected.matrix)
        && bits(&v.right, &expected.right)
        && bits(&v.up, &expected.up)
        && bits(&v.forward, &expected.forward)
        && v.frustum
            .iter()
            .flatten()
            .zip(expected.frustum.iter().flatten())
            .all(|(a, b)| a.to_bits() == b.to_bits())
        && v.clip_magnitudes
            .iter()
            .flatten()
            .zip(expected.clip_magnitudes.iter().flatten())
            .all(|(a, b)| a.to_bits() == b.to_bits())
}

/// Spatial root and owned presentation/navigation subsystems. Delegated
/// Tilemap and movement scratch checks are composed by the Engine wrapper;
/// this does not admit a whole Engine or its host resources.
pub(crate) fn validate_root(
    scene: &SpatialScene,
    world: &World,
    b: &mut Budget,
) -> Result<(), Error> {
    b.work(160)?;
    require(
        !scene.frame_active || scene.camera.is_some(),
        Field::Camera,
        0,
        Problem::Reference,
    )?;
    if let Some(v) = &scene.camera {
        require(camera(v), Field::Camera, 0, Problem::Cache)?;
    }
    if scene.frame_camera.iter().any(|x| *x != 0.) {
        let c = SpatialCamera::new(&scene.frame_camera[16..]).ok_or(Error::Invalid {
            field: Field::Camera,
            index: 1,
            problem: Problem::Range,
        })?;
        require(
            bits(&scene.frame_camera[..16], &c.matrix),
            Field::Camera,
            1,
            Problem::Cache,
        )?;
    }
    require(
        finite(&scene.frame_camera) && finite(&scene.presentation),
        Field::Presentation,
        0,
        Problem::Number,
    )?;
    // The initial/default and retained last-frame presentation need not match the
    // current camera/environment, which may have just been cold-reconfigured.
    require(
        scene.presentation.iter().all(|x| *x == 0.)
            || scene.presentation[2] >= 0.
                && scene.presentation[3] >= 0.
                && scene.presentation[4] >= 0.
                && scene.presentation[5] >= 0.
                && scene.presentation[4].fract() == 0.
                && scene.presentation[5].fract() == 0.
                && scene.presentation[4] <= 2048.
                && scene.presentation[5] <= 2048.,
        Field::Presentation,
        0,
        Problem::Range,
    )?;
    if scene.presentation.iter().any(|v| *v != 0.) {
        let p = scene.presentation;
        // fit=min(viewport/grid), followed by at most three positive f32
        // rounding operations; four epsilon leaves a conservative envelope.
        let cap = 1. + 4. * f32::EPSILON;
        require(
            p[2] <= cap
                && p[3] <= cap
                && p[0] == (1. - p[2]) * 0.5
                && p[1] == (1. - p[3]) * 0.5
                && ((p[4] == 0. && p[5] == 0.) || (p[4] >= 1. && p[5] >= 1.)),
            Field::Presentation,
            0,
            Problem::Cache,
        )?;
    }
    b.work(scene.surfaces.len())?;
    require(
        scene.surfaces.len() <= 256,
        Field::Surface,
        0,
        Problem::Length,
    )?;
    for (i, v) in scene.surfaces.iter().enumerate() {
        require(surface(*v), Field::Surface, i, Problem::Range)?;
    }
    b.product(scene.surfaces.len(), scene.surfaces.len())?;
    for (i, a) in scene.surfaces.iter().enumerate() {
        for other in &scene.surfaces[..i] {
            require(a.id != other.id, Field::Surface, i, Problem::Duplicate)?;
            require(
                a.floor != other.floor || !rectangles_overlap(a.bounds, other.bounds),
                Field::Surface,
                i,
                Problem::Range,
            )?;
        }
    }
    b.work(scene.bindings.len())?;
    require(
        scene.bindings.len() <= 10_000,
        Field::Binding,
        0,
        Problem::Length,
    )?;
    for (i, (&(id, generation), v)) in scene.bindings.iter().enumerate() {
        require(
            entity_history(world, Entity { id, generation }),
            Field::Binding,
            i,
            Problem::Reference,
        )?;
        require(billboard(*v), Field::Binding, i, Problem::Range)?;
    }
    b.work(scene.runtime_billboards.len())?;
    for (i, (e, v)) in scene.runtime_billboards.iter().enumerate() {
        require(
            entity_history(world, *e) && billboard(*v),
            Field::Binding,
            i,
            Problem::Reference,
        )?;
    }
    b.work(scene.runtime_sprite_rotations.len())?;
    for (i, (e, v)) in scene.runtime_sprite_rotations.iter().enumerate() {
        require(
            entity_history(world, *e) && v.is_finite(),
            Field::Binding,
            i,
            Problem::Reference,
        )?;
        if i != 0 {
            let a = scene.runtime_sprite_rotations[i - 1].0;
            require(
                (a.id, a.generation) < (e.id, e.generation),
                Field::Binding,
                i,
                Problem::Order,
            )?;
        }
    }
    b.work(scene.preview_hidden_entities.len())?;
    require(
        scene.preview_hidden_entities.len() <= 16384,
        Field::Binding,
        0,
        Problem::Length,
    )?;
    for (i, &(id, generation)) in scene.preview_hidden_entities.iter().enumerate() {
        require(
            entity_history(world, Entity { id, generation }),
            Field::Binding,
            i,
            Problem::Reference,
        )?;
    }
    b.work(scene.preview_hidden_surfaces.len())?;
    require(
        scene.preview_hidden_surfaces.len() <= 256,
        Field::Surface,
        0,
        Problem::Length,
    )?;
    for (i, &id) in scene.preview_hidden_surfaces.iter().enumerate() {
        require((1..=65535).contains(&id), Field::Surface, i, Problem::Range)?;
    }
    b.work(scene.light_bindings.len() + 1)?;
    for (i, v) in scene.light_bindings.iter().enumerate() {
        if let Some((e, h)) = v {
            require(
                entity_history(world, *e) && h.is_finite() && h.abs() <= 1e6,
                Field::Binding,
                i,
                Problem::Reference,
            )?;
        }
    }
    if let Some((e, speed, step, drop)) = scene.actor {
        require(
            entity_history(world, e)
                && finite(&[speed, step, drop])
                && speed >= 0.
                && step >= 0.
                && drop >= 0.,
            Field::Binding,
            0,
            Problem::Range,
        )?;
    }
    source_geometry(scene, b)?;
    outputs(scene, b)?;
    scene.validate_file_terrain_presentation(b)?;
    scene.validate_file_connections(b)?;
    scene.validate_file_platforms(b)?;
    scene.attachments.validate_file(world, b)?;
    scene.models.validate_file(world, b)?;
    scene.environment.validate_file(&scene.frame_camera, b)?;
    scene.debug.validate_file(world, b)?;
    scene.navigation.validate_file_root(scene, world, b)
}

fn outputs(scene: &SpatialScene, b: &mut Budget) -> Result<(), Error> {
    for values in [
        &scene.terrain,
        &scene.billboards,
        &scene.shadow_quad_scratch,
    ] {
        b.work(values.len())?;
        for (i, v) in values.iter().enumerate() {
            require(vertex(v), Field::Vertex, i, Problem::Number)?;
        }
    }
    require(
        scene.terrain.len() == scene.surfaces.len() * 36
            && scene.billboards.len().is_multiple_of(6)
            && [0, 6].contains(&scene.shadow_quad_scratch.len()),
        Field::Vertex,
        0,
        Problem::Length,
    )?;
    for values in [&scene.shadow_casters, &scene.previous_shadow_casters] {
        b.product(values.len(), 6)?;
        require(
            values.len() <= MAX_SHADOW_CASTERS,
            Field::Vertex,
            0,
            Problem::Length,
        )?;
        for (i, v) in values.iter().enumerate() {
            require(v.iter().all(vertex), Field::Vertex, i, Problem::Number)?;
            if i != 0 {
                require(
                    values[i - 1][0].texture <= v[0].texture,
                    Field::Vertex,
                    i,
                    Problem::Order,
                )?;
            }
        }
    }
    for values in [&scene.terrain_materials, &scene.billboard_materials] {
        b.work(values.len())?;
        for (i, v) in values.iter().enumerate() {
            require(material(*v), Field::Material, i, Problem::Range)?;
        }
    }
    require(
        scene.terrain_materials.len() == scene.surfaces.len()
            && (!scene.frame_active
                || scene.billboard_materials.len() <= scene.billboards.len() / 6),
        Field::Material,
        0,
        Problem::Length,
    )?;
    for (values, count, current) in [
        (&scene.terrain_receiver_masks, scene.surfaces.len(), true),
        (
            &scene.billboard_receiver_masks,
            scene.billboards.len() / 6,
            scene.frame_active,
        ),
    ] {
        b.work(values.len())?;
        require(
            values.is_empty() || !current || values.len() == count,
            Field::Receiver,
            0,
            Problem::Length,
        )?;
        for (i, v) in values.iter().enumerate() {
            require(masks(*v), Field::Receiver, i, Problem::Range)?;
        }
    }
    b.work(scene.terrain_draw_ranges.len())?;
    let mut end = 0u32;
    for (i, r) in scene.terrain_draw_ranges.iter().enumerate() {
        let next = r
            .first_vertex
            .checked_add(r.vertex_count)
            .ok_or(Error::Invalid {
                field: Field::DrawRange,
                index: i,
                problem: Problem::Range,
            })?;
        require(
            r.vertex_count != 0
                && r.first_vertex.is_multiple_of(36)
                && r.vertex_count.is_multiple_of(36)
                && r.first_vertex >= end
                && next as usize <= scene.terrain.len(),
            Field::DrawRange,
            i,
            Problem::Range,
        )?;
        end = next;
    }
    b.product(scene.shadow_casters.len(), 6)?;
    require(
        scene.shadow_casters == scene.previous_shadow_casters,
        Field::Vertex,
        0,
        Problem::Cache,
    )?;
    b.work(scene.shadow_draw_ranges.len())?;
    let mut previous = None;
    for (i, r) in scene.shadow_draw_ranges.iter().enumerate() {
        let stride = if r.source == 0 { 36 } else { 6 };
        let end = r.first.checked_add(r.count).ok_or(Error::Invalid {
            field: Field::DrawRange,
            index: i,
            problem: Problem::Range,
        })?;
        // configure_surfaces/environment can retain last-frame shadow ranges.
        // Build regenerates them before use, so current terrain length is not a
        // valid bound for this deliberately stale output. Producer maxima are.
        let bound = if r.source == 0 {
            256 * 36
        } else {
            MAX_SHADOW_CASTERS * 6
        };
        require(
            r.face <= 12
                && r.source <= 1
                && r.count > 0
                && r.first.is_multiple_of(stride)
                && r.count.is_multiple_of(stride)
                && end as usize <= bound,
            Field::DrawRange,
            i,
            Problem::Range,
        )?;
        if let Some((face, source, last)) = previous {
            require(
                (r.face, r.source) > (face, source)
                    || (r.face, r.source) == (face, source) && r.first >= last,
                Field::DrawRange,
                i,
                Problem::Order,
            )?;
        }
        previous = Some((r.face, r.source, end));
    }
    Ok(())
}

fn source_geometry(scene: &SpatialScene, b: &mut Budget) -> Result<(), Error> {
    b.product(scene.surfaces.len(), 80)?;
    let count = scene.surfaces.len();
    let definitions = if count == 0 { 0 } else { count + 1 };
    let (sizes, half_open) = scene.physics.file_spatial_sizes();
    require(
        sizes
            == [
                definitions,
                0,
                0,
                definitions,
                definitions,
                0,
                count,
                count,
                count,
            ]
            && (count == 0 || half_open),
        Field::Surface,
        0,
        Problem::Cache,
    )?;
    let mut expected = b.vector::<SpatialVertex>(if count == 0 { 0 } else { 36 })?;
    for (i, surface) in scene.surfaces.iter().enumerate() {
        expected.clear();
        super::append_surface(&mut expected, *surface);
        require(
            scene
                .terrain
                .get(i * 36..i * 36 + 36)
                .is_some_and(|actual| {
                    actual.iter().zip(&expected).all(|(a, z)| {
                        bits(&a.position, &z.position)
                            && bits(&a.uv, &z.uv)
                            && bits(&a.color, &z.color)
                            && bits(&[a.texture, a.cutoff], &[z.texture, z.cutoff])
                    })
                }),
            Field::Vertex,
            i,
            Problem::Cache,
        )?;
        let m = scene.terrain_materials.get(i).ok_or(Error::Invalid {
            field: Field::Material,
            index: i,
            problem: Problem::Length,
        })?;
        require(
            m.normal_texture == 16_777_215 && (surface.is_rendered || m.flags == 0),
            Field::Material,
            i,
            Problem::Cache,
        )?;
        let receiver = scene
            .terrain_receiver_masks
            .get(i)
            .copied()
            .unwrap_or_default();
        require(
            receiver == surface.receiver_masks,
            Field::Receiver,
            i,
            Problem::Cache,
        )?;
        let (layer, costs_default) = scene.physics.file_spatial_layer(i).ok_or(Error::Invalid {
            field: Field::Surface,
            index: i,
            problem: Problem::Reference,
        })?;
        require(
            layer.columns == 1
                && layer.rows == 1
                && layer.collision
                && costs_default
                && layer.tiles.as_slice() == [i as u32 + 1]
                && bits(
                    &[
                        layer.origin_x,
                        layer.origin_y,
                        layer.tile_width,
                        layer.tile_height,
                    ],
                    &surface.bounds,
                ),
            Field::Surface,
            i,
            Problem::Cache,
        )?;
        let (definition, height, hd) = scene.physics.file_spatial_definition(i + 1);
        let definition = definition.ok_or(Error::Invalid {
            field: Field::Surface,
            index: i,
            problem: Problem::Reference,
        })?;
        require(
            definition.texture_id == 0
                && bits(
                    &[
                        definition.frame.u0,
                        definition.frame.v0,
                        definition.frame.u1,
                        definition.frame.v1,
                        definition.r,
                        definition.g,
                        definition.b,
                        definition.a,
                    ],
                    &[0., 0., 1., 1., 1., 1., 1., 1.],
                ),
            Field::Surface,
            i,
            Problem::Cache,
        )?;
        let height = height.ok_or(Error::Invalid {
            field: Field::Surface,
            index: i,
            problem: Problem::Reference,
        })?;
        require(
            height.floor.0 == surface.floor
                && bits(
                    &[height.elevation, height.height],
                    &[
                        if surface.walkable {
                            surface.heights[0]
                        } else {
                            surface.base
                        },
                        if surface.walkable {
                            0.
                        } else {
                            surface.heights[0].max(surface.heights[1]) - surface.base
                        },
                    ],
                ),
            Field::Surface,
            i,
            Problem::Cache,
        )?;
        let hd = hd.ok_or(Error::Invalid {
            field: Field::Surface,
            index: i,
            problem: Problem::Reference,
        })?;
        require(
            hd.kind.code() == surface.kind
                && hd.blocks_movement == !surface.walkable
                && hd.blocks_projectile
                && hd.blocks_vision
                && bits(&[hd.occluder_height], &[surface.heights[0] - surface.base]),
            Field::Surface,
            i,
            Problem::Cache,
        )?;
        require(
            match hd.ramp {
                Some(r) => {
                    surface.kind == 2
                        && r.axis.code() == u32::from(!surface.ramp_x)
                        && bits(&[r.start_elevation, r.end_elevation], &surface.heights)
                }
                None => surface.kind != 2,
            },
            Field::Surface,
            i,
            Problem::Cache,
        )?;
    }
    Ok(())
}

pub(crate) fn validate_movement(
    scene: &SpatialScene,
    world: &World,
    b: &mut Budget,
) -> Result<(), Error> {
    let limits = b.remaining();
    let usage = scene
        .movement_scratch
        .validate_file(
            world,
            crate::collision::file_scratch_admission::Limits {
                max_work: limits.max_work,
                max_scratch_bytes: limits.max_scratch_bytes,
            },
        )
        .map_err(|error| match error {
            crate::collision::file_scratch_admission::Error::WorkLimit => Error::WorkLimit,
            crate::collision::file_scratch_admission::Error::ScratchLimit => Error::ScratchLimit,
            crate::collision::file_scratch_admission::Error::Allocation => Error::Allocation,
            other => Error::Scratch(other),
        })?;
    b.external(Usage {
        work: usage.work,
        scratch_bytes: usage.scratch_bytes,
    })
}

#[cfg(test)]
pub(super) mod collection_tests;
#[cfg(test)]
mod tests;
