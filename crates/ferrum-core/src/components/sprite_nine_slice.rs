/// Source-pixel borders for a flat sprite. The center and edge lengths stretch;
/// borders compress proportionally when the target is smaller than their sum.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SpriteNineSlice {
    pub source_width: f32,
    pub source_height: f32,
    pub left: f32,
    pub right: f32,
    pub top: f32,
    pub bottom: f32,
    pub border_scale: f32,
    pub flip_x: bool,
    pub flip_y: bool,
}

impl SpriteNineSlice {
    pub fn from_record(v: &[f32]) -> Option<Self> {
        if v.len() != 9
            || v.iter().any(|v| !v.is_finite())
            || v[..6]
                .iter()
                .any(|v| v.fract() != 0. || *v < 0. || *v > 16_384.)
            || v[0] < 1.
            || v[1] < 1.
            || v[2] + v[3] >= v[0]
            || v[4] + v[5] >= v[1]
            || v[6] <= 0.
            || v[6] > 65_536.
            || ![0., 1.].contains(&v[7])
            || ![0., 1.].contains(&v[8])
        {
            return None;
        }
        Some(Self {
            source_width: v[0],
            source_height: v[1],
            left: v[2],
            right: v[3],
            top: v[4],
            bottom: v[5],
            border_scale: v[6],
            flip_x: v[7] != 0.,
            flip_y: v[8] != 0.,
        })
    }
}
