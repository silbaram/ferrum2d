//! Input predicate mirrors the owner's constructor without allocating a new
//! environment/frame or changing authored/temporal state.
use super::*;
use crate::spatial_scene::file_admission::{bits, finite, require, Budget, Error, Field, Problem};
fn source_values(v: &[f32]) -> Option<[f32; ENVIRONMENT_VALUES]> {
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
            && ((a[624] == 4. && a[625] == 16.) || (a[624] == 2. && [32., 48.].contains(&a[625])))
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
    Some(a)
}

impl SpatialEnvironment {
    pub(in crate::spatial_scene) fn validate_file(
        &self,
        frame_camera: &[f32; 28],
        b: &mut Budget,
    ) -> Result<(), Error> {
        b.work(ENVIRONMENT_VALUES * 3)?;
        b.work(self.frame_values.len())?;
        b.work(self.shadow_matrices.len())?;
        let Some(source) = self.values.as_ref() else {
            require(
                self.value_len == 0
                    && self.frame_values.is_empty()
                    && self.shadow_matrices.is_empty(),
                Field::Environment,
                0,
                Problem::Length,
            )?;
            return self.selection.validate_file(&[], b);
        };
        require(
            environment_version(self.value_len).is_some()
                && self.frame_values.len() == self.value_len,
            Field::Environment,
            0,
            Problem::Length,
        )?;
        let expected = source_values(&source[..self.value_len]).ok_or(Error::Invalid {
            field: Field::Environment,
            index: 0,
            problem: Problem::Range,
        })?;
        require(
            bits(source, &expected),
            Field::Environment,
            0,
            Problem::Cache,
        )?;
        require(
            finite(&self.frame_values) && finite(&self.shadow_matrices),
            Field::Environment,
            1,
            Problem::Number,
        )?;
        let mut frame = [0.; ENVIRONMENT_VALUES];
        frame[..self.value_len].copy_from_slice(&self.frame_values);
        for i in 0..self.value_len {
            let dynamic =
                self.value_len >= 512 && (matches!(i,1..=3|12..=59|144..=175|545..=548|588));
            let off = source[0] as u32 & 1 == 0
                && (matches!(i,83..=95|112..=124|512..=527|592..=607|616..=699));
            if !dynamic && i != 99 {
                require(
                    frame[i].to_bits() == source[i].to_bits() || off && frame[i] == 0.,
                    Field::Environment,
                    i,
                    Problem::Cache,
                )?;
            }
        }
        require(
            frame[1].fract() == 0.
                && (0. ..=4.).contains(&frame[1])
                && frame[2].fract() == 0.
                && (-1. ..=3.).contains(&frame[2])
                && (frame[2] < 0. || frame[2] < frame[1]),
            Field::Environment,
            1,
            Problem::Range,
        )?;
        require(
            frame[99] >= 0. && frame[99] <= 1e6,
            Field::Environment,
            99,
            Problem::Range,
        )?;
        for slot in 0..4 {
            let p = 12 + slot * 12;
            let row = &frame[p..p + 12];
            require(
                if slot >= frame[1] as usize {
                    row.iter().all(|v| *v == 0.)
                } else {
                    row[..3].iter().all(|v| v.abs() <= 1e6)
                        && (0.1..=1e6).contains(&row[3])
                        && row[4..7].iter().all(|v| (0. ..=1.).contains(v))
                        && (0. ..=64.).contains(&row[7])
                        && row[8..].iter().all(|v| *v == 0.)
                },
                Field::Environment,
                p,
                Problem::Range,
            )?;
        }
        for (i, value) in frame.iter().enumerate().take(549).skip(545) {
            require(
                value.fract() == 0. && (0. ..=65535.).contains(value),
                Field::Environment,
                i,
                Problem::Range,
            )?;
        }
        require(
            frame[588].fract() == 0. && (-1. ..=3.).contains(&frame[588]),
            Field::Environment,
            588,
            Problem::Range,
        )?;
        let second = point_shadows::second_slot(&frame);
        let base = usize::from(frame[2] >= 0.) * 96 + usize::from(second.is_some()) * 96;
        require(
            self.shadow_matrices.len() == base
                || frame[92] > 0. && self.shadow_matrices.len() == base + 16,
            Field::Environment,
            0,
            Problem::Length,
        )?;
        let mut at = 0;
        for slot in [(frame[2] >= 0.).then_some(frame[2] as usize), second]
            .into_iter()
            .flatten()
        {
            require(
                slot < frame[1] as usize,
                Field::Environment,
                slot,
                Problem::Reference,
            )?;
            let p = 12 + slot * 12;
            let eye = [frame[p], frame[p + 1], frame[p + 2]];
            let far = frame[p + 3];
            let near = (far * 0.0001).clamp(0.001, 0.1);
            for (forward, up) in [
                ([1., 0., 0.], [0., -1., 0.]),
                ([-1., 0., 0.], [0., -1., 0.]),
                ([0., 1., 0.], [0., 0., 1.]),
                ([0., -1., 0.], [0., 0., -1.]),
                ([0., 0., 1.], [0., -1., 0.]),
                ([0., 0., -1.], [0., -1., 0.]),
            ] {
                let expected = cube_matrix(eye, forward, up, near, far).ok_or(Error::Invalid {
                    field: Field::Environment,
                    index: at,
                    problem: Problem::Number,
                })?;
                require(
                    bits(&self.shadow_matrices[at..at + 16], &expected),
                    Field::Environment,
                    at,
                    Problem::Cache,
                )?;
                at += 16;
            }
        }
        if self.shadow_matrices.len() > base {
            let camera = SpatialCamera::new(&frame_camera[16..]).ok_or(Error::Invalid {
                field: Field::Environment,
                index: base,
                problem: Problem::Reference,
            })?;
            let expected = sun_matrix(
                SpatialEnvironment::sun_center(&frame, &camera),
                [frame[84], frame[85], frame[86]],
                frame[94],
                frame[91],
                frame[92],
            );
            require(
                bits(&self.shadow_matrices[base..], &expected),
                Field::Environment,
                base,
                Problem::Cache,
            )?;
        }
        self.selection.validate_file(&source[..self.value_len], b)
    }
}
