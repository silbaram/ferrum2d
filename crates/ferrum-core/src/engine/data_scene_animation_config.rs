use crate::components::SpriteFrame;
use crate::world::sprite_playback::{SpriteClip, MAX_CLIP_FRAMES, MAX_CLIP_TOTAL_FRAMES};

/// Cold-path v2 decoder. No world mutation until every clip and buffer is valid.
pub(super) fn decode_clips(
    descriptors: &[f32],
    frames: &[f32],
    durations_ms: &[f32],
) -> Option<Vec<SpriteClip>> {
    if descriptors.is_empty()
        || !descriptors.len().is_multiple_of(7)
        || descriptors.len() > 64 * 7
        || frames.len() > MAX_CLIP_TOTAL_FRAMES * 4
        || durations_ms.len() > MAX_CLIP_TOTAL_FRAMES
    {
        return None;
    }
    let mut clips: Vec<SpriteClip> = Vec::with_capacity(descriptors.len() / 7);
    let (mut offset, mut time_offset) = (0, 0);
    for descriptor in descriptors.chunks_exact(7) {
        let [id, count, fps, looping, direction, emit, timed] = [
            descriptor[0],
            descriptor[1],
            descriptor[2],
            descriptor[3],
            descriptor[4],
            descriptor[5],
            descriptor[6],
        ];
        if !id.is_finite()
            || !(0.0..=65535.0).contains(&id)
            || id.fract() != 0.0
            || !count.is_finite()
            || !(1.0..=MAX_CLIP_FRAMES as f32).contains(&count)
            || count.fract() != 0.0
            || !direction.is_finite()
            || !(0.0..=2.0).contains(&direction)
            || direction.fract() != 0.0
            || (looping != 0.0 && looping != 1.0)
            || (emit != 0.0 && emit != 1.0)
            || (timed != 0.0 && timed != 1.0)
            || (timed == 1.0 && fps != 0.0)
            || (timed == 0.0 && (!fps.is_finite() || !(0.001..=1000.0).contains(&fps)))
            || clips.iter().any(|clip| clip.id == id as u32)
        {
            return None;
        }
        let end = offset + count as usize * 4;
        let mut clip_frames = Vec::with_capacity(count as usize);
        for uv in frames.get(offset..end)?.chunks_exact(4) {
            clip_frames.push(SpriteFrame::from_values(uv[0], uv[1], uv[2], uv[3])?);
        }
        let durations = if timed == 1.0 {
            let end = time_offset + count as usize;
            let times = durations_ms.get(time_offset..end)?;
            time_offset = end;
            Some(times)
        } else {
            None
        };
        clips.push(
            SpriteClip::uniform(id as u32, clip_frames, fps, looping == 1.0).extended(
                direction as u32,
                durations,
                emit == 1.0,
            )?,
        );
        offset = end;
    }
    (offset == frames.len() && time_offset == durations_ms.len()).then_some(clips)
}
