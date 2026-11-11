//! Optional environment v10: two explicit shadow owners, without entity boundary calls.

pub(super) fn valid(v: &[f32]) -> bool {
    if v[589] != 1.
        || v[590..592].iter().any(|x| *x != 0.)
        || v[138] < 0.
        || v[584].fract() != 0.
        || v[584] < -1.
        || v[584] >= v[137]
        || v[584] == v[138]
    {
        return false;
    }
    if v[584] < 0. {
        return v[585..588].iter().all(|x| *x == 0.) && v[588] == -1.;
    }
    v[136] >= 2.
        && (v[0] as u32 & 1 == 0 || v[1] >= 2.)
        && [128., 256., 512., 1024.].contains(&v[585])
        && (0. ..=10.).contains(&v[586])
        && (0. ..=10.).contains(&v[587])
        && v[588] == if v[0] as u32 & 1 != 0 { 1. } else { -1. }
}

pub(super) fn owner(v: &[f32], source: usize) -> Option<usize> {
    if source as f32 == v[138] {
        Some(0)
    } else if v.len() >= 592 && v[589] == 1. && source as f32 == v[584] {
        Some(1)
    } else {
        None
    }
}

pub(super) fn second_slot(v: &[f32]) -> Option<usize> {
    (v.len() >= 592 && v[589] == 1. && v[588] >= 0.).then(|| v[588] as usize)
}

/// v12 appends two four-float owner records; inactive records are entirely zero.
pub(super) fn valid_pcss(v: &[f32]) -> bool {
    v[600..608].chunks_exact(4).enumerate().all(|(owner, row)| {
        if row[0] == 0. {
            row[1..].iter().all(|x| *x == 0.)
        } else {
            row[0] == 1.
                && v[138] >= 0.
                && (owner == 0 || (v[589] == 1. && v[584] >= 0.))
                && (0. ..=1000.).contains(&row[1])
                && (1. ..=32.).contains(&row[2])
                && row[3] == 0.
        }
    })
}
