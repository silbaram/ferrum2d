//! Optional native-owned lighting and post-process settings. Existing vertex/render ABI stays intact.
use super::{add, cross, dot, scale, unit, Point, SpatialCamera};
use crate::{entity::Entity, world::World};
pub(crate) const ENVIRONMENT_VALUES: usize = 512;
#[path = "lighting_upgrade.rs"]
mod lighting_upgrade;
pub(crate) const MAX_SHADOW_CASTERS: usize = 1024;
#[derive(Default)]
pub(crate) struct SpatialEnvironment {
    pub values: Option<[f32; ENVIRONMENT_VALUES]>,
    pub value_len: usize,
    pub frame_values: Vec<f32>,
    pub shadow_matrices: Vec<f32>,
}
impl SpatialEnvironment {
    pub fn new(v: &[f32]) -> Option<Self> {
        if v.is_empty() {
            return Some(Self::default());
        }
        if ![80, 112, 128, ENVIRONMENT_VALUES].contains(&v.len()) {
            return None;
        }
        let mut a = [0.; ENVIRONMENT_VALUES];
        a[..v.len()].copy_from_slice(v);
        if a.iter().any(|x| !x.is_finite())
            || a[0].fract() != 0.
            || !(0. ..=if v.len() == 512 { 127. } else { 31. }).contains(&a[0])
            || a[1].fract() != 0.
            || !(0. ..=4.).contains(&a[1])
            || a[2].fract() != 0.
            || !(-1. ..=3.).contains(&a[2])
        {
            return None;
        }
        let flags = a[0] as u32;
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
            if flags & 1 == 0
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
        if flags & 1 == 0 && a[95] != 0. {
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
            if flags & 1 == 0
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
        if v.len() == 512 && !lighting_upgrade::valid(&a) {
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
        };
        if a[2] >= 0. {
            let p = 12 + a[2] as usize * 12;
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
                    [
                        camera.parameters[4],
                        camera.parameters[5],
                        camera.parameters[6],
                    ],
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
        if self.value_len == 512 {
            lighting_upgrade::select(&mut v, camera, world, bindings, actor);
            self.shadow_matrices.clear();
            if v[2] >= 0. {
                let p = 12 + v[2] as usize * 12;
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
                    let p = world.transform(a)?;
                    let elevation =
                        world.height_span(a).map_or(0., |s| s.elevation) + visual_offset + v[98];
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
        let base = if v[2] >= 0. { 96 } else { 0 };
        self.shadow_matrices.truncate(base);
        if v[92] > 0. {
            let target = [
                camera.parameters[4],
                camera.parameters[5],
                camera.parameters[6],
            ];
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
            .is_some_and(|v| v[2] >= 0. || v[92] > 0.)
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
    // Input is validated; choose an up axis that remains defined for a vertical sun.
    let dir = unit(direction).unwrap_or([0., 1., 0.]);
    let forward = scale(dir, -1.);
    let up = if dir[1].abs() > 0.99 {
        [0., 0., 1.]
    } else {
        [0., 1., 0.]
    };
    let r = unit(cross(forward, up)).unwrap_or([1., 0., 0.]);
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
