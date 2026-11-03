//! Lossless, bounded trim restoration independently checked by native storage.
use super::sprite_assets::invalid;
use super::CommandResult;
use serde_json::Value;
use std::{collections::BTreeMap, io::Cursor};

pub(super) type Rect = (u64, u64, u64, u64);
fn number(value: &Value, key: &str, max: u64) -> CommandResult<u64> {
    super::aseprite_assets::number(value, key, max)
}
fn rgba(png: &[u8], width: u64, height: u64) -> CommandResult<Vec<u8>> {
    if !super::png_layout::rgba8_srgb(png) {
        return Err(invalid("trim PNG requires a complete sRGB layout"));
    }
    let mut decoder = png::Decoder::new(Cursor::new(png));
    decoder.set_limits(png::Limits {
        bytes: 40 * 1024 * 1024,
    });
    let mut reader = decoder
        .read_info()
        .map_err(|_| invalid("invalid trim PNG"))?;
    if u64::from(reader.info().width) != width
        || u64::from(reader.info().height) != height
        || reader.info().bit_depth != png::BitDepth::Eight
        || reader.info().color_type != png::ColorType::Rgba
        || reader.info().animation_control.is_some()
        || reader.output_buffer_size() != (width * height * 4) as usize
    {
        return Err(invalid(
            "trim restoration requires an RGBA8 PNG with matching dimensions",
        ));
    }
    let mut bytes = vec![0; reader.output_buffer_size()];
    reader
        .next_frame(&mut bytes)
        .map_err(|_| invalid("invalid trim PNG pixels"))?;
    Ok(bytes)
}

/// Source order is preserved in metadata. Rect placement uses UTF-8 frame IDs.
pub(super) fn validate(
    frames: &[(&str, &Value)],
    source_png: &[u8],
    png: &[u8],
    source_size: (u64, u64),
    size: (u64, u64),
) -> CommandResult<BTreeMap<String, Rect>> {
    let (sw, sh) = source_size;
    let mut source = BTreeMap::new();
    let mut canvas = None;
    let mut trimmed = false;
    for (name, frame) in frames {
        for flag in ["trimmed", "rotated"] {
            if frame.get(flag).is_some_and(|v| !v.is_boolean()) {
                return Err(invalid("invalid trim flags"));
            }
        }
        if frame["rotated"] == true {
            return Err(invalid("rotated frames are unsupported"));
        }
        let rect = &frame["frame"];
        let x = number(rect, "x", sw)?;
        let y = number(rect, "y", sh)?;
        let w = number(rect, "w", sw)?;
        let h = number(rect, "h", sh)?;
        if w == 0 || h == 0 || x + w > sw || y + h > sh {
            return Err(invalid("frame is outside source PNG"));
        }
        let is_trimmed = frame["trimmed"] == true;
        let original = frame.get("sourceSize").filter(|v| !v.is_null());
        let offset = frame.get("spriteSourceSize").filter(|v| !v.is_null());
        if is_trimmed && (original.is_none() || offset.is_none()) {
            return Err(invalid(
                "trimmed frames require sourceSize and spriteSourceSize",
            ));
        }
        let cw = original.map_or(Ok(w), |v| number(v, "w", 4096))?;
        let ch = original.map_or(Ok(h), |v| number(v, "h", 4096))?;
        let ox = offset.map_or(Ok(0), |v| number(v, "x", cw))?;
        let oy = offset.map_or(Ok(0), |v| number(v, "y", ch))?;
        if cw == 0
            || ch == 0
            || ox + w > cw
            || oy + h > ch
            || offset.is_some_and(|v| {
                number(v, "w", sw).ok() != Some(w) || number(v, "h", sh).ok() != Some(h)
            })
        {
            return Err(invalid("trimmed frame exceeds source canvas"));
        }
        if !is_trimmed && (cw != w || ch != h || ox != 0 || oy != 0) {
            return Err(invalid("trim offsets require trimmed:true"));
        }
        if canvas.is_some_and(|v| v != (cw, ch)) {
            return Err(invalid(
                "trimmed frames require a shared source canvas size",
            ));
        }
        canvas = Some((cw, ch));
        trimmed |= is_trimmed;
        source.insert((*name).to_owned(), (x, y, w, h, ox, oy));
    }
    if !trimmed {
        return Err(invalid("source PNG requires trimmed frames"));
    }
    let (cw, ch) = canvas.ok_or_else(|| invalid("missing trim frames"))?;
    let count = frames.len() as u64;
    let mut layout = None;
    for columns in 1..=count {
        let w = columns * cw;
        let h = count.div_ceil(columns) * ch;
        if w > 4096 || h > 4096 || w * h > 4_194_304 {
            continue;
        }
        let candidate = (w.max(h), w * h, w, columns, h);
        if layout.is_none_or(|old| candidate < old) {
            layout = Some(candidate);
        }
    }
    let (_, _, width, columns, height) =
        layout.ok_or_else(|| invalid("restored atlas exceeds 4096 side / 4MP budget"))?;
    if size != (width, height) {
        return Err(invalid("restored atlas dimensions differ"));
    }
    let input = rgba(source_png, sw, sh)?;
    let mut output = vec![0; (width * height * 4) as usize];
    let mut result = BTreeMap::new();
    for (index, (name, (x, y, w, h, ox, oy))) in source.into_iter().enumerate() {
        let dx = index as u64 % columns * cw;
        let dy = index as u64 / columns * ch;
        for row in 0..h {
            let start = (((y + row) * sw + x) * 4) as usize;
            let dest = (((dy + oy + row) * width + dx + ox) * 4) as usize;
            output[dest..dest + (w * 4) as usize]
                .copy_from_slice(&input[start..start + (w * 4) as usize]);
        }
        result.insert(name, (dx, dy, cw, ch));
    }
    if rgba(png, width, height)? != output {
        return Err(invalid("restored PNG differs from original trim pixels"));
    }
    Ok(result)
}
