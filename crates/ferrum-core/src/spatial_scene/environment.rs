//! Optional native-owned lighting and post-process settings. Existing vertex/render ABI stays intact.
use super::{cross, dot, unit, Point};
pub(crate) const ENVIRONMENT_VALUES: usize = 80;
pub(crate) const MAX_SHADOW_CASTERS: usize = 1024;
#[derive(Default)]
pub(crate) struct SpatialEnvironment {
    pub values: Option<[f32; ENVIRONMENT_VALUES]>,
    pub shadow_matrices: Vec<f32>,
}
impl SpatialEnvironment {
    pub fn new(v: &[f32]) -> Option<Self> {
        if v.is_empty() {
            return Some(Self::default());
        }
        let a: [f32; 80] = v.try_into().ok()?;
        if a.iter().any(|x| !x.is_finite())
            || a[0].fract() != 0.
            || !(0. ..=15.).contains(&a[0])
            || a[1].fract() != 0.
            || !(0. ..=4.).contains(&a[1])
            || a[2].fract() != 0.
            || !(-1. ..=3.).contains(&a[2])
        {
            return None;
        }
        let flags = a[0] as u32;
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
            || a[8..12].iter().chain(a[76..].iter()).any(|x| *x != 0.)
        {
            return None;
        }
        let mut result = Self {
            values: Some(a),
            shadow_matrices: Vec::new(),
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
    pub fn shadows(&self) -> bool {
        self.values.is_some_and(|v| v[2] >= 0.)
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
