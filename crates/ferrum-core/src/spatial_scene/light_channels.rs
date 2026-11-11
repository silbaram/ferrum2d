//! Explicit environment v7 extension; old versions keep their original lengths.
pub(super) const SUN: usize = 544;
const SELECTED: usize = 545;
const AUTHORED: usize = 549;
const RESERVED: usize = 565;

pub(super) fn valid(v: &[f32]) -> bool {
    v[SUN..RESERVED]
        .iter()
        .all(|n| n.fract() == 0. && (0. ..=65535.).contains(n))
        && v[RESERVED..].iter().all(|n| *n == 0.)
        && v[SELECTED + v[1] as usize..AUTHORED]
            .iter()
            .all(|n| *n == 0.)
        && v[AUTHORED + v[137] as usize..RESERVED]
            .iter()
            .all(|n| *n == 0.)
}

pub(super) fn remap(v: &mut [f32], sources: [Option<usize>; 4]) {
    v[SELECTED..AUTHORED].fill(0.);
    for (slot, source) in sources.into_iter().enumerate() {
        if let Some(source) = source {
            v[SELECTED + slot] = v[AUTHORED + source];
        }
    }
}
