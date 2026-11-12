//! Optional native-owned lighting and post-process settings. Existing vertex/render ABI stays intact.
use super::{add, cross, dot, scale, unit, Point, SpatialCamera};
use crate::{entity::Entity, world::World};
/// Append-only wire layouts, indexed by ABI version minus one.
const ENVIRONMENT_LAYOUT_LENGTHS: [usize; 15] = [
    80, 112, 128, 512, 528, 544, 576, 580, 584, 592, 600, 608, 616, 632, 700,
];
pub(crate) const ENVIRONMENT_VALUES: usize =
    ENVIRONMENT_LAYOUT_LENGTHS[ENVIRONMENT_LAYOUT_LENGTHS.len() - 1];
fn environment_version(length: usize) -> Option<u32> {
    ENVIRONMENT_LAYOUT_LENGTHS
        .iter()
        .position(|&size| size == length)
        .map(|index| index as u32 + 1)
}
const LIGHT_CHANNEL_VALUES: usize = 576;
#[path = "light_channels.rs"]
mod light_channels;
#[path = "light_selection.rs"]
mod light_selection;
#[path = "lighting_upgrade.rs"]
mod lighting_upgrade;
#[path = "point_shadows.rs"]
pub(super) mod point_shadows;
pub(crate) use light_selection::LightSelectionDiagnostic;
pub(crate) const MAX_SHADOW_CASTERS: usize = 1024;
/// Validated cold history, installed only after the matching source/pose transaction commits.
pub(crate) struct PreparedLightSelection(light_selection::LightSelection);
#[derive(Default)]
pub(crate) struct SpatialEnvironment {
    pub values: Option<[f32; ENVIRONMENT_VALUES]>,
    pub value_len: usize,
    pub frame_values: Vec<f32>,
    pub shadow_matrices: Vec<f32>,
    selection: light_selection::LightSelection,
}
impl SpatialEnvironment {
    pub(crate) fn abi_version(&self) -> u32 {
        // The absent/default environment has historically reported version 1.
        environment_version(self.value_len).unwrap_or(1)
    }

    pub fn new(v: &[f32]) -> Option<Self> {
        if v.is_empty() {
            return Some(Self::default());
        }
        environment_version(v.len())?;
        let mut a = [0.; ENVIRONMENT_VALUES];
        a[..v.len()].copy_from_slice(v);
        if a.iter().any(|x| !x.is_finite())
            || a[0].fract() != 0.
            || !(0. ..=if v.len() >= 512 { 127. } else { 31. }).contains(&a[0])
            || a[1].fract() != 0.
            || !(0. ..=4.).contains(&a[1])
            || a[2].fract() != 0.
            || !(-1. ..=3.).contains(&a[2])
        {
            return None;
        }
        let flags = a[0] as u32;
        let preserve_inactive = v.len() >= LIGHT_CHANNEL_VALUES;
        if flags & 16 != 0 {
            if v.len() < 112
                || a[80..82]
                    .iter()
                    .any(|x| x.fract() != 0. || !(1. ..=2048.).contains(x))
                || a[80] * a[81] > 1_048_576.
                || ![0., 1.].contains(&a[82])
            {
                return None;
            }
        } else if a[80..83].iter().any(|x| *x != 0.) {
            return None;
        }
        if ![0., 1.].contains(&a[83])
            || ![0., 1.].contains(&a[95])
            || ![0., 1.].contains(&a[96])
            || ![0., 1.].contains(&a[97])
            || a[98].abs() > 1e6
            || a[99..112].iter().any(|x| *x != 0.)
        {
            return None;
        }
        if a[83] == 1. {
            if (flags & 1 == 0 && !preserve_inactive)
                || unit([a[84], a[85], a[86]]).is_none()
                || a[84..87].iter().any(|x| x.abs() > 1.)
                || !(0. ..=64.).contains(&a[87])
                || a[88..91].iter().any(|x| !(0. ..=1.).contains(x))
            {
                return None;
            }
            if a[92] > 0. {
                if ![128., 256., 512., 1024.].contains(&a[92])
                    || !(1. ..=10000.).contains(&a[91])
                    || !(0. ..=10.).contains(&a[93])
                    || !(1. ..=10000.).contains(&a[94])
                {
                    return None;
                }
            } else if a[91..95].iter().any(|x| *x != 0.) {
                return None;
            }
        } else if a[84..95].iter().any(|x| *x != 0.) {
            return None;
        }
        if flags & 4 == 0 && a[96..99].iter().any(|x| *x != 0.) {
            return None;
        }
        if a[97] == 0. && a[98] != 0. {
            return None;
        }
        if flags & 1 == 0 && !preserve_inactive && a[95] != 0. {
            return None;
        }
        if ![0., 1.].contains(&a[112])
            || a[125..128].iter().any(|x| *x != 0.)
            || !(0. ..=10.).contains(&a[123])
            || !(0. ..=10.).contains(&a[124])
        {
            return None;
        }
        if a[112] == 1. {
            if (flags & 1 == 0 && !preserve_inactive)
                || unit([a[113], a[114], a[115]]).is_none()
                || a[113..116].iter().any(|x| x.abs() > 1.)
                || a[116..119]
                    .iter()
                    .chain(&a[120..123])
                    .any(|x| !(0. ..=1.).contains(x))
                || !(0. ..=64.).contains(&a[119])
            {
                return None;
            }
        } else if a[113..123].iter().any(|x| *x != 0.) {
            return None;
        }
        if (a[2] < 0. && a[123] != 0.) || (a[92] == 0. && a[124] != 0.) {
            return None;
        }
        if v.len() >= 512 && !lighting_upgrade::valid(&a, preserve_inactive) {
            return None;
        }
        // v5: optional fixed world-space sun center; the remaining extension is reserved.
        if ![0., 1.].contains(&a[512])
            || a[516..528].iter().any(|x| *x != 0.)
            || (a[512] == 0. && a[513..516].iter().any(|x| *x != 0.))
            || (a[512] == 1. && (a[92] == 0. || a[513..516].iter().any(|x| x.abs() > 1e6)))
        {
            return None;
        }
        // v6: explicit legacy/separated composition. No reserved prefix slots are reused.
        if ![0., 1.].contains(&a[528]) || a[529..544].iter().any(|x| *x != 0.) {
            return None;
        }
        if v.len() >= LIGHT_CHANNEL_VALUES && !light_channels::valid(&a[..LIGHT_CHANNEL_VALUES]) {
            return None;
        }
        if v.len() >= 580 && !light_selection::valid(&a) {
            return None;
        }
        if v.len() == 584
            && !(a[580] == 1.
                && a[528] == 1.
                && a[128] == 1.
                && ((a[581] == 4. && a[582] == 4.) || (a[581] == 2. && [4., 8.].contains(&a[582])))
                && [0., 1.].contains(&a[583])
                && (a[583] == 1. || a[576..580].iter().all(|x| *x == 0.)))
        {
            return None;
        }
        if v.len() >= 592
            && (!(if v.len() > 592 && a[589] == 0. {
                a[584..592].iter().all(|x| *x == 0.)
            } else {
                point_shadows::valid(&a)
            }) || ![0., 1.].contains(&a[583])
                || (a[583] == 0. && a[576..580].iter().any(|x| *x != 0.))
                || if a[580] == 1. {
                    !(a[528] == 1.
                        && a[128] == 1.
                        && ((a[581] == 4. && a[582] == 4.)
                            || (a[581] == 2. && [4., 8.].contains(&a[582]))))
                } else {
                    a[580..583].iter().any(|x| *x != 0.)
                })
        {
            return None;
        }
        // v11: optional sun PCSS, with a disabled render tail when lighting is off.
        if !(if a[592] == 0. {
            a[593..600].iter().all(|x| *x == 0.)
        } else {
            a[592] == 1.
                && a[83] == 1.
                && a[92] > 0.
                && (0. ..=5.).contains(&a[593])
                && (1. ..=32.).contains(&a[594])
                && a[595..600].iter().all(|x| *x == 0.)
        }) {
            return None;
        }
        // v12: independent point PCSS controls, without changing depth-map ownership.
        if !point_shadows::valid_pcss(&a) {
            return None;
        }
        // v13: analytic height fog, independent of lighting's enabled state.
        if !(if a[608] == 0. {
            a[609..616].iter().all(|x| *x == 0.)
        } else {
            a[608] == 1.
                && flags & 2 != 0
                && a[609].abs() <= 1e6
                && (0. ..=10.).contains(&a[610])
                && (0. ..=10.).contains(&a[611])
                && a[612..616].iter().all(|x| *x == 0.)
        }) {
            return None;
        }
        // v14: bounded sun shafts; disabled authored lighting keeps its source config.
        if !(if a[616] == 0. {
            a[617..632].iter().all(|x| *x == 0.)
        } else {
            a[616] == 1.
                && a[528] == 1.
                && a[83] == 1.
                && a[92] > 0.
                && (0. ..=4.).contains(&a[617])
                && (0. ..=1.).contains(&a[618])
                && (0.1..=10000.).contains(&a[619])
                && a[620..623].iter().all(|x| (0. ..=1.).contains(x))
                && (0. ..=0.9).contains(&a[623])
                && ((a[624] == 4. && a[625] == 16.)
                    || (a[624] == 2. && [32., 48.].contains(&a[625])))
                && a[626..632].iter().all(|x| *x == 0.)
        }) {
            return None;
        }
        // v15: bounded authored regional indirect light. OFF preserves the source.
        if !valid_light_probes(&a) {
            return None;
        }
        let count = a[1] as usize;
        if (flags & 1 == 0 && (count != 0 || a[2] != -1.))
            || a[5..8].iter().any(|x| !(0. ..=4.).contains(x))
            || !(0. ..=10.).contains(&a[4])
        {
            return None;
        }
        if a[2] >= 0. && (a[2] as usize >= count || ![128., 256., 512., 1024.].contains(&a[3])) {
            return None;
        }
        if a[2] < 0. && a[3] != 0. {
            return None;
        }
        for i in 0..4 {
            let l = &a[12 + i * 12..24 + i * 12];
            if i >= count {
                if l.iter().any(|x| *x != 0.) {
                    return None;
                }
                continue;
            }
            if l[..3].iter().any(|x| x.abs() > 1e6)
                || !(0.1..=1e6).contains(&l[3])
                || l[4..7].iter().any(|x| !(0. ..=1.).contains(x))
                || !(0. ..=64.).contains(&l[7])
                || l[8..].iter().any(|x| *x != 0.)
            {
                return None;
            }
        }
        if !(0.001..=1e6).contains(&a[60])
            || !(0. ..=1e6).contains(&a[61])
            || !(0. ..=32.).contains(&a[62])
            || !(0. ..=12.).contains(&a[63])
            || !(-10. ..=10.).contains(&a[64])
            || a[65..67].iter().any(|x| !(0. ..=2.).contains(x))
            || ![0., 1., 2.].contains(&a[67])
            || a[68..71].iter().any(|x| !(0. ..=4.).contains(x))
            || !(0. ..=1e6).contains(&a[71])
            || a[72] <= a[71]
            || a[72] > 1e6
            || a[73..76].iter().any(|x| !(0. ..=1.).contains(x))
            || a[8..12].iter().chain(a[76..80].iter()).any(|x| *x != 0.)
        {
            return None;
        }
        let mut result = Self {
            values: Some(a),
            shadow_matrices: Vec::new(),
            value_len: v.len(),
            frame_values: v.to_vec(),
            selection: light_selection::LightSelection::new(v),
        };
        for slot in [
            (a[2] >= 0.).then_some(a[2] as usize),
            point_shadows::second_slot(&a),
        ]
        .into_iter()
        .flatten()
        {
            let p = 12 + slot * 12;
            let eye = [a[p], a[p + 1], a[p + 2]];
            let far = a[p + 3];
            let near = (far * 0.0001).clamp(0.001, 0.1);
            for (forward, up) in [
                ([1., 0., 0.], [0., -1., 0.]),
                ([-1., 0., 0.], [0., -1., 0.]),
                ([0., 1., 0.], [0., 0., 1.]),
                ([0., -1., 0.], [0., 0., -1.]),
                ([0., 0., 1.], [0., -1., 0.]),
                ([0., 0., -1.], [0., -1., 0.]),
            ] {
                result
                    .shadow_matrices
                    .extend(cube_matrix(eye, forward, up, near, far)?);
            }
        }
        Some(result)
    }
    pub fn camera_valid(&self, camera: &SpatialCamera) -> bool {
        self.values.as_ref().is_none_or(|v| {
            v[92] == 0.
                || sun_matrix(
                    Self::sun_center(v, camera),
                    [v[84], v[85], v[86]],
                    v[94],
                    v[91],
                    v[92],
                )
                .iter()
                .all(|x| x.is_finite())
        })
    }
    pub fn build(
        &mut self,
        camera: &SpatialCamera,
        world: &World,
        bindings: &[Option<(Entity, f32)>; 16],
        actor: Option<(Entity, f32)>,
    ) {
        let Some(mut v) = self.values else {
            return;
        };
        if self.value_len >= 512 {
            let sources = if self.selection.enabled() {
                let data = lighting_upgrade::candidates(&v, camera, world, bindings, actor, false);
                let (sources, weights) = self.selection.display(&v, &data);
                // Final light poses follow interpolation, without changing selection history.
                let rendered =
                    lighting_upgrade::candidates(&v, camera, world, bindings, actor, true);
                v[12..60].fill(0.);
                v[144..176].fill(0.);
                let count = sources.iter().flatten().count();
                v[1] = count as f32;
                v[2] = if v[0] as u32 & 1 != 0 && v[138] >= 0. {
                    0.
                } else {
                    -1.
                };
                if v[2] < 0. {
                    v[3] = 0.;
                }
                for (slot, source) in sources.iter().enumerate() {
                    if let Some(source) = source {
                        let p = 192 + source * 20;
                        let to = 12 + slot * 12;
                        v.copy_within(p..p + 8, to);
                        v[to..to + 3].copy_from_slice(&rendered.positions[*source]);
                        v[to + 7] *= if rendered.visible[*source] {
                            weights[slot]
                        } else {
                            0.
                        };
                        v.copy_within(p + 8..p + 14, 144 + slot * 8);
                    }
                }
                sources
            } else {
                lighting_upgrade::select(&mut v, camera, world, bindings, actor)
            };
            if self.value_len >= LIGHT_CHANNEL_VALUES {
                light_channels::remap(&mut v[..LIGHT_CHANNEL_VALUES], sources);
                if v[0] as u32 & 1 == 0 {
                    // Inactive authoring remains in self.values; only the render
                    // copy loses active sun/fill/maps and fixed-map presentation.
                    v[83..96].fill(0.);
                    v[112..125].fill(0.);
                    v[512..528].fill(0.);
                    v[592..608].fill(0.);
                    v[616..700].fill(0.);
                }
            }
            self.shadow_matrices.clear();
            if self.value_len >= 592 && v[589] == 1. {
                v[588] = if v[0] as u32 & 1 != 0 && v[584] >= 0. {
                    1.
                } else {
                    -1.
                };
            }
            for slot in [
                (v[2] >= 0.).then_some(v[2] as usize),
                point_shadows::second_slot(&v),
            ]
            .into_iter()
            .flatten()
            {
                let p = 12 + slot * 12;
                let eye = [v[p], v[p + 1], v[p + 2]];
                let far = v[p + 3];
                let near = (far * 0.0001).clamp(0.001, 0.1);
                for (forward, up) in [
                    ([1., 0., 0.], [0., -1., 0.]),
                    ([-1., 0., 0.], [0., -1., 0.]),
                    ([0., 1., 0.], [0., 0., 1.]),
                    ([0., -1., 0.], [0., 0., -1.]),
                    ([0., 0., 1.], [0., -1., 0.]),
                    ([0., 0., -1.], [0., -1., 0.]),
                ] {
                    if let Some(matrix) = cube_matrix(eye, forward, up, near, far) {
                        self.shadow_matrices.extend(matrix);
                    }
                }
            }
        }
        self.frame_values.copy_from_slice(&v[..self.value_len]);
        if v[97] == 1. {
            let focus = actor
                .filter(|(a, _)| world.is_current_entity(*a))
                .and_then(|(a, visual_offset)| {
                    let p = world.render_transform_at_index(a.id as usize)?;
                    let elevation = world
                        .render_height_span_at(a.id as usize)
                        .map_or(0., |s| s.elevation)
                        + visual_offset
                        + v[98];
                    let depth = dot(
                        super::sub(
                            [p.x, elevation, -p.y],
                            [
                                camera.parameters[1],
                                camera.parameters[2],
                                camera.parameters[3],
                            ],
                        ),
                        camera.forward,
                    );
                    (depth.is_finite()
                        && depth >= camera.parameters[8]
                        && depth <= camera.parameters[9]
                        && depth <= 1e6)
                        .then_some(depth)
                })
                .unwrap_or(v[60]);
            self.frame_values[99] = focus;
        }
        let base = if v[2] >= 0. { 96 } else { 0 }
            + if point_shadows::second_slot(&v).is_some() {
                96
            } else {
                0
            };
        self.shadow_matrices.truncate(base);
        if v[92] > 0. {
            let target = Self::sun_center(&v, camera);
            self.shadow_matrices.extend(sun_matrix(
                target,
                [v[84], v[85], v[86]],
                v[94],
                v[91],
                v[92],
            ));
        }
    }
    pub fn shadows(&self) -> bool {
        self.values
            .as_ref()
            .is_some_and(|v| v[0] as u32 & 1 != 0 && (v[2] >= 0. || v[92] > 0.))
    }
    pub fn advance_light_selection(
        &mut self,
        camera: &SpatialCamera,
        world: &World,
        bindings: &[Option<(Entity, f32)>; 16],
        actor: Option<(Entity, f32)>,
        dt: f32,
    ) {
        if !self.selection.enabled() {
            return;
        }
        let Some(v) = self.values.as_ref() else {
            return;
        };
        let data = lighting_upgrade::candidates(v, camera, world, bindings, actor, false);
        self.selection.advance(
            v,
            &data,
            [
                camera.parameters[4],
                camera.parameters[5],
                camera.parameters[6],
            ],
            dt,
        );
    }
    pub fn light_selection_enabled(&self) -> bool {
        self.selection.enabled()
    }
    pub fn retain_compatible_light_selection(&mut self, previous: &Self) {
        if let (Some(source), Some(old_source)) = (&self.values, &previous.values) {
            self.selection
                .retain_compatible(&previous.selection, source, old_source);
        }
    }
    pub fn reset_light_selection(&mut self) -> bool {
        if !self.selection.enabled() {
            return false;
        }
        self.selection.reset();
        true
    }
    pub fn light_selection_diagnostics(&self) -> &[LightSelectionDiagnostic] {
        self.selection.diagnostics()
    }
    pub fn capture_light_selection(&self) -> Vec<f64> {
        self.selection.capture()
    }
    pub fn restore_light_selection(&mut self, values: &[f64]) -> bool {
        if values.is_empty() {
            return !self.selection.enabled();
        }
        let Some(source) = self.values.as_ref() else {
            return false;
        };
        self.selection.restore(values, source)
    }
    pub fn prepare_light_selection(&self, values: &[f64]) -> Option<PreparedLightSelection> {
        let mut selection = self.selection.clone();
        if values.is_empty() {
            return (!selection.enabled()).then_some(PreparedLightSelection(selection));
        }
        selection
            .restore(values, self.values.as_ref()?)
            .then_some(PreparedLightSelection(selection))
    }
    pub fn commit_light_selection(&mut self, prepared: PreparedLightSelection) {
        self.selection = prepared.0;
    }
    fn sun_center(values: &[f32; ENVIRONMENT_VALUES], camera: &SpatialCamera) -> Point {
        if values[512] == 1. {
            [values[513], values[514], values[515]]
        } else {
            [
                camera.parameters[4],
                camera.parameters[5],
                camera.parameters[6],
            ]
        }
    }
}
fn cube_matrix(eye: Point, forward: Point, up: Point, near: f32, far: f32) -> Option<[f32; 16]> {
    let r = unit(cross(forward, up))?;
    let u = cross(r, forward);
    let view = [
        r[0],
        u[0],
        -forward[0],
        0.,
        r[1],
        u[1],
        -forward[1],
        0.,
        r[2],
        u[2],
        -forward[2],
        0.,
        -dot(r, eye),
        -dot(u, eye),
        dot(forward, eye),
        1.,
    ];
    let p = [
        1.,
        0.,
        0.,
        0.,
        0.,
        1.,
        0.,
        0.,
        0.,
        0.,
        -(far + near) / (far - near),
        -1.,
        0.,
        0.,
        -2. * far * near / (far - near),
        0.,
    ];
    let matrix: [f32; 16] = std::array::from_fn(|i| {
        let row = i % 4;
        let col = i / 4;
        (0..4).map(|k| p[k * 4 + row] * view[col * 4 + k]).sum()
    });
    matrix.iter().all(|v| v.is_finite()).then_some(matrix)
}

fn sun_matrix(
    center: Point,
    direction: Point,
    extent: f32,
    distance: f32,
    resolution: f32,
) -> [f32; 16] {
    // Input is validated. Rotate a fixed +Y light frame towards the sun instead
    // of switching reference-up axes near zenith (which rotates the finite map).
    let dir = unit(direction).unwrap_or([0., 1., 0.]);
    let forward = scale(dir, -1.);
    let horizontal = dir[0].hypot(dir[2]);
    let r = if horizontal > 0. {
        let x = dir[0] / horizontal;
        let z = dir[2] / horizontal;
        let tilt = 1. - dir[1];
        // Rodrigues' shortest rotation, without dividing by 1 + dir.y near
        // the opposite pole. hypot also keeps tiny horizontal vectors finite.
        [1. - tilt * x * x, -dir[0], -tilt * x * z]
    } else {
        // At exact -Y the shortest rotation has no unique axis; keep fixed roll.
        [1., 0., 0.]
    };
    let u = cross(r, forward);
    let texel = extent * 2. / resolution;
    let x = (dot(center, r) / texel).round() * texel - dot(center, r);
    let y = (dot(center, u) / texel).round() * texel - dot(center, u);
    let eye = add(
        add(add(center, scale(r, x)), scale(u, y)),
        scale(dir, distance),
    );
    let view = [
        r[0],
        u[0],
        -forward[0],
        0.,
        r[1],
        u[1],
        -forward[1],
        0.,
        r[2],
        u[2],
        -forward[2],
        0.,
        -dot(r, eye),
        -dot(u, eye),
        dot(forward, eye),
        1.,
    ];
    let mut p = [0.; 16];
    p[0] = 1. / extent;
    p[5] = 1. / extent;
    p[10] = -1. / distance;
    p[14] = -1. - 0.001 / distance;
    p[15] = 1.;
    std::array::from_fn(|i| (0..4).map(|k| p[k * 4 + i % 4] * view[i / 4 * 4 + k]).sum())
}

/// Input is already finite. The source marker retains an explicitly empty probe array.
fn valid_light_probes(v: &[f32; ENVIRONMENT_VALUES]) -> bool {
    if v[632] == 0. {
        return v[633..700].iter().all(|x| *x == 0.);
    }
    if v[632] != 1.
        || v[633].fract() != 0.
        || !(0. ..=8.).contains(&v[633])
        || v[634] != 0.
        || v[635] != 0.
    {
        return false;
    }
    let count = v[633] as usize;
    v[636..636 + count * 8].chunks_exact(8).all(|p| {
        p[..3].iter().all(|x| x.abs() <= 1e6)
            && (0.1..=10000.).contains(&p[3])
            && p[4..7].iter().all(|x| (0. ..=1.).contains(x))
            && (0. ..=4.).contains(&p[7])
    }) && v[636 + count * 8..700].iter().all(|x| *x == 0.)
}
