//! Bounded light selection. Authored records stay immutable for save/restore.
use super::{Entity, SpatialCamera, World};

pub(super) fn valid(v: &[f32], preserve_inactive: bool) -> bool {
    let range = |i: usize, a: f32, b: f32| (a..=b).contains(&v[i]);
    let zero = |a: usize, b: usize| v[a..b].iter().all(|x| *x == 0.);
    for p in [128, 132] {
        if ![0., 1.].contains(&v[p]) {
            return false;
        }
        if v[p] == 0. {
            if !zero(p + 1, p + 4) {
                return false;
            }
            continue;
        }
        if !range(p + 1, 0., if p == 128 { 4. } else { 1. })
            || !range(
                p + 2,
                0.1,
                if p == 128 {
                    if v.len() >= 584 && v[580] == 1. {
                        96.
                    } else {
                        24.
                    }
                } else {
                    1000.
                },
            )
            || !range(p + 3, 0., if p == 128 { 64. } else { 100. })
        {
            return false;
        }
    }
    let flags = v[0] as u32;
    if (flags & 32 != 0) != (v[128] == 1.)
        || (flags & 64 != 0) != (v[132] == 1.)
        || ![1., 2., 3., 4.].contains(&v[136])
        || v[137].fract() != 0.
        || !range(137, 0., 16.)
        || v[138].fract() != 0.
        || !range(138, -1., v[137] - 1.)
        || !zero(142, 144)
        || !zero(176, 192)
    {
        return false;
    }
    if v[138] >= 0. {
        if ![128., 256., 512., 1024.].contains(&v[139])
            || !range(140, 0., 10.)
            || !range(141, 0., 10.)
        {
            return false;
        }
    } else if !zero(139, 142) {
        return false;
    }
    if flags & 1 == 0 && !preserve_inactive && (v[137] != 0. || v[138] != -1.) {
        return false;
    }
    if if v[138] >= 0. && flags & 1 != 0 {
        v[2] != 0. || v[3] != v[139] || v[4] != v[140] || v[123] != v[141]
    } else {
        v[2] != -1.
    } {
        return false;
    }
    for i in 0..16 {
        let p = 192 + i * 20;
        if i >= v[137] as usize {
            if !zero(p, p + 20) {
                return false;
            }
            continue;
        }
        if v[p..p + 3].iter().any(|x| x.abs() > 1e6)
            || !range(p + 3, 0.1, 1e6)
            || v[p + 4..p + 7].iter().any(|x| !(0. ..=1.).contains(x))
            || !range(p + 7, 0., 64.)
            || ![0., 1.].contains(&v[p + 13])
            || ![0., 1.].contains(&v[p + 14])
            || !zero(p + 15, p + 20)
        {
            return false;
        }
        if v[p + 13] > 0. {
            if v[p + 8..p + 11].iter().any(|x| x.abs() > 1.)
                || super::unit([v[p + 8], v[p + 9], v[p + 10]]).is_none()
                || !range(p + 11, 0., 1.)
                || !range(p + 12, v[p + 11], 1.)
            {
                return false;
            }
        } else if !zero(p + 8, p + 13) {
            return false;
        }
    }
    for i in 0..4 {
        let p = 144 + i * 8;
        if ![0., 1.].contains(&v[p + 5]) || !zero(p + 6, p + 8) {
            return false;
        }
        if v[p + 5] > 0. {
            if i >= v[1] as usize
                || v[p..p + 3].iter().any(|x| x.abs() > 1.)
                || super::unit([v[p], v[p + 1], v[p + 2]]).is_none()
                || !range(p + 3, 0., 1.)
                || !range(p + 4, v[p + 3], 1.)
            {
                return false;
            }
        } else if !zero(p, p + 5) {
            return false;
        }
    }
    v[1] <= v[136]
}

pub(super) fn select(
    v: &mut [f32],
    camera: &SpatialCamera,
    world: &World,
    bindings: &[Option<(Entity, f32)>; 16],
    actor: Option<(Entity, f32)>,
) -> [Option<usize>; 4] {
    let mut sources = [None; 4];
    if v[0] as u32 & 1 == 0 {
        v[1] = 0.;
        v[2] = -1.;
        v[3] = 0.;
        v[12..60].fill(0.);
        v[144..176].fill(0.);
        return sources;
    }
    let candidates = candidates(v, camera, world, bindings, actor, true);
    let positions = candidates.positions;
    let visible = candidates.visible;
    let count = candidates.count;
    let mut ranked = std::array::from_fn::<_, 16, _>(|i| {
        (
            i,
            if let Some(owner) = super::point_shadows::owner(v, i) {
                f32::MAX / (owner + 1) as f32
            } else {
                candidates.scores[i]
            },
        )
    });
    ranked[..count].sort_unstable_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let active = count.min(v[136] as usize);
    v[12..60].fill(0.);
    v[144..176].fill(0.);
    v[1] = active as f32;
    v[2] = if v[138] >= 0. { 0. } else { -1. };
    for (slot, (source, _)) in ranked[..active].iter().enumerate() {
        sources[slot] = Some(*source);
        let p = 192 + source * 20;
        let to = 12 + slot * 12;
        v.copy_within(p..p + 8, to);
        v[to..to + 3].copy_from_slice(&positions[*source]);
        if !visible[*source] {
            v[to + 7] = 0.;
        }
        v.copy_within(p + 8..p + 14, 144 + slot * 8);
    }
    sources
}

#[derive(Debug)]
pub(super) struct Candidates {
    pub positions: [[f32; 3]; 16],
    pub visible: [bool; 16],
    pub scores: [f32; 16],
    pub unavailable: [u32; 16],
    pub count: usize,
}

/// Simulation scoring reads authoritative poses; only emission uses render interpolation.
pub(super) fn candidates(
    v: &[f32],
    camera: &SpatialCamera,
    world: &World,
    bindings: &[Option<(Entity, f32)>; 16],
    actor: Option<(Entity, f32)>,
    render: bool,
) -> Candidates {
    let mut positions = [[0.; 3]; 16];
    let mut visible = [true; 16];
    let mut scores = [-1.; 16];
    let mut unavailable = [0u32; 16];
    let count = v[137] as usize;
    // Contribution-aware occupancy belongs to the opt-in temporal policy only.
    // Older source layouts and disabled policies keep their exact distance ranking.
    let contribution_aware = v.len() >= 580 && v[576] == 1.;
    let target = [
        camera.parameters[4],
        camera.parameters[5],
        camera.parameters[6],
    ];
    for i in 0..count {
        let p = 192 + i * 20;
        let mut position = [v[p], v[p + 1], v[p + 2]];
        {
            let binding = bindings[i].or_else(|| if v[p + 14] > 0. { actor } else { None });
            if (bindings[i].is_some() || v[p + 14] > 0.)
                && binding.is_none_or(|(entity, _)| {
                    !world.is_current_entity(entity) || world.transform(entity).is_none()
                })
            {
                visible[i] = false;
                unavailable[i] = 6;
            }
            if let Some((entity, offset)) = binding.filter(|(a, _)| world.is_current_entity(*a)) {
                if let Some(t) = if render {
                    world.render_transform_at_index(entity.id as usize)
                } else {
                    world.transform(entity)
                } {
                    position[0] += t.x;
                    position[1] += if render {
                        world
                            .render_height_span_at(entity.id as usize)
                            .map_or(0., |s| s.elevation)
                    } else {
                        world.height_span(entity).map_or(0., |s| s.elevation)
                    } + offset;
                    position[2] -= t.y;
                }
            }
        }
        if position.iter().any(|x| !x.is_finite() || x.abs() > 1e6) {
            visible[i] = false;
            unavailable[i] = 9;
            position = [v[p], v[p + 1], v[p + 2]];
        }
        positions[i] = position;
        let energy = v[p + 4..p + 7].iter().copied().fold(0., f32::max);
        if contribution_aware && visible[i] {
            let radius = v[p + 3];
            if energy == 0.
                || v[549 + i] as u32 & 255 == 0
                || !camera.intersects_bounds(
                    position.map(|axis| axis - radius),
                    position.map(|axis| axis + radius),
                )
            {
                visible[i] = false;
                unavailable[i] = 7;
            }
        }
        let distance = super::dot(
            super::super::sub(position, target),
            super::super::sub(position, target),
        );
        scores[i] = if visible[i] {
            v[p + 7] * if contribution_aware { energy } else { 1. }
                / (1. + distance / (v[p + 3] * v[p + 3]))
        } else {
            -1.
        };
    }
    Candidates {
        positions,
        visible,
        scores,
        unavailable,
        count,
    }
}
