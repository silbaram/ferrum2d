//! Native pixel sources use the shared immutable sprite transaction, independently of importers.
use super::png_layout::rgba8_srgb as complete_png;
use super::sprite_assets::{array, hash, invalid, text, Contract, Dependency, Source};
use super::{CommandResult, PlacementAssetRegistry, PlacementWriteRegistry};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{io::Cursor, path::Path};

pub(super) const CONTRACT: Contract = Contract {
    directory: ".ferrum-pixels",
    prefix: "pixel.",
    bundle_format: "ferrum2d.pixel-project.assets",
    catalog_format: "ferrum2d.pixel.catalog",
    project_format: "ferrum2d.pixel.project",
    max_dependencies: 0,
    allow_source_png: false,
    max_source_json: 12 * 1024 * 1024,
    max_source_png: 16 * 1024 * 1024,
    check_catalog_revision: true,
    validate: validate_source,
};

fn bounded_integer(value: &Value, key: &str, min: u64, max: u64) -> CommandResult<u64> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && v.fract() == 0.0 && *v >= min as f64 && *v <= max as f64)
        .map(|v| v as u64)
        .ok_or_else(|| invalid(format!("invalid pixel integer {key}")))
}
fn source_text<'a>(value: &'a Value, key: &str) -> CommandResult<&'a str> {
    source_text_limit(value, key, 64)
}
fn source_text_limit<'a>(value: &'a Value, key: &str, max: usize) -> CommandResult<&'a str> {
    let result = text(value, key)?;
    // Match String.prototype.trim, including BOM and excluding Unicode NEL.
    let whitespace = |c| {
        matches!(c, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
    };
    if result.trim_matches(whitespace).is_empty() || result.encode_utf16().count() > max {
        return Err(invalid("invalid pixel source text"));
    }
    Ok(result)
}
fn rgba_bytes(value: &Value, count: usize) -> CommandResult<Vec<u8>> {
    let encoded = value
        .as_str()
        .ok_or_else(|| invalid("missing pixel RGBA"))?;
    if encoded.len() != count.div_ceil(3) * 4 {
        return Err(invalid("invalid pixel byte length"));
    }
    let pixels = STANDARD
        .decode(encoded)
        .map_err(|_| invalid("invalid pixel base64"))?;
    if pixels.len() != count || STANDARD.encode(&pixels) != encoded {
        return Err(invalid("invalid pixel RGBA encoding"));
    }
    Ok(pixels)
}
/// v10 stores one byte per pixel; legacy sources cannot silently accept this contract.
fn indexed_palette(source: &Value) -> CommandResult<Option<Vec<[u8; 4]>>> {
    if bounded_integer(source, "version", 1, 10)? != 10 {
        if source.get("colorMode").is_some() {
            return Err(invalid("indexed color mode requires pixel source v10"));
        }
        return Ok(None);
    }
    if source["colorMode"] != "indexed" {
        return Err(invalid("invalid indexed color mode"));
    }
    let colors = array(source, "palette")?;
    if colors.is_empty() || colors.len() > 256 || colors[0] != "#00000000" {
        return Err(invalid("invalid indexed palette"));
    }
    let mut unique = std::collections::HashSet::new();
    let mut palette = Vec::with_capacity(colors.len());
    for color in colors {
        let hex = color
            .as_str()
            .ok_or_else(|| invalid("invalid indexed palette"))?;
        if hex.len() != 9
            || !hex.starts_with('#')
            || !hex[1..].bytes().all(|v| v.is_ascii_hexdigit())
        {
            return Err(invalid("invalid indexed palette"));
        }
        let value =
            u32::from_str_radix(&hex[1..], 16).map_err(|_| invalid("invalid indexed palette"))?;
        if !unique.insert(value) {
            return Err(invalid("duplicate indexed color"));
        }
        palette.push(value.to_be_bytes());
    }
    Ok(Some(palette))
}
/// v8 requires an explicit byte multiplier; legacy sources must not silently lose it.
fn layer_opacity(layer: &Value, version: u64) -> CommandResult<u8> {
    if version >= 8 {
        return bounded_integer(layer, "opacity", 0, 255).map(|value| value as u8);
    }
    if layer.get("opacity").is_some() {
        return Err(invalid("layer opacity requires pixel source v8"));
    }
    Ok(255)
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlendMode {
    Normal,
    Multiply,
    Screen,
}

fn layer_blend(layer: &Value, version: u64) -> CommandResult<BlendMode> {
    if version >= 9 {
        return match layer["blendMode"].as_str() {
            Some("normal") => Ok(BlendMode::Normal),
            Some("multiply") => Ok(BlendMode::Multiply),
            Some("screen") => Ok(BlendMode::Screen),
            _ => Err(invalid("invalid layer blend mode")),
        };
    }
    if layer.get("blendMode").is_some() {
        return Err(invalid("layer blending requires pixel source v9"));
    }
    Ok(BlendMode::Normal)
}

fn apply_opacity(pixels: &mut [u8], opacity: u8) {
    if opacity == 255 {
        return;
    }
    for pixel in pixels.chunks_exact_mut(4) {
        pixel[3] = ((u32::from(pixel[3]) * u32::from(opacity) + 127) / 255) as u8;
    }
}

/// Integer straight-alpha source-over. Matches the TypeScript authoring composite.
fn composite_over(output: &mut [u8], input: &[u8], mode: BlendMode) {
    for (dst, src) in output.chunks_exact_mut(4).zip(input.chunks_exact(4)) {
        let alpha = u64::from(src[3]);
        if alpha == 0 {
            continue;
        }
        let previous = u64::from(dst[3]);
        let denominator = alpha * 255 + previous * (255 - alpha);
        for channel in 0..3 {
            let source = u64::from(src[channel]);
            let backdrop = u64::from(dst[channel]);
            let (value, divisor) = if mode == BlendMode::Normal {
                (
                    source * alpha * 255 + backdrop * previous * (255 - alpha),
                    denominator,
                )
            } else {
                let blend = if mode == BlendMode::Multiply {
                    source * backdrop
                } else {
                    255 * (source + backdrop) - source * backdrop
                };
                // Integer sRGB separable blending, including uncovered source coverage.
                // u64 keeps all intermediate products exact until the final rounding.
                (
                    source * alpha * (255 - previous) * 255
                        + backdrop * previous * (255 - alpha) * 255
                        + blend * alpha * previous,
                    denominator * 255,
                )
            };
            dst[channel] = ((value + divisor / 2) / divisor) as u8;
        }
        dst[3] = ((denominator + 127) / 255) as u8;
    }
}

/// Fixed atlas UVs must cover non-overlapping, exact pixel rectangles.
fn validate_atlas(source: &Value, width: u64, height: u64) -> CommandResult<()> {
    let atlas = &source["atlas"];
    source_text_limit(atlas, "texture", 256)?;
    let frames = array(atlas, "frames")?;
    if frames.is_empty() || frames.len() > 256 {
        return Err(invalid("invalid pixel atlas frame count"));
    }
    let mut ids = std::collections::HashSet::new();
    let mut rectangles: Vec<[f64; 4]> = Vec::new();
    for frame in frames {
        if !ids.insert(source_text(frame, "id")?) {
            return Err(invalid("duplicate pixel atlas frame"));
        }
        let mut rect = [0.0; 4];
        for (index, (key, side)) in [("u0", width), ("v0", height), ("u1", width), ("v1", height)]
            .into_iter()
            .enumerate()
        {
            let value = frame["frame"][key]
                .as_f64()
                .filter(|v| v.is_finite() && (0.0..=1.0).contains(v))
                .ok_or_else(|| invalid("invalid pixel atlas UV"))?
                * side as f64;
            if (value - value.round()).abs() > 1e-7 {
                return Err(invalid("pixel atlas rectangle is not integer"));
            }
            rect[index] = value.round();
        }
        if rect[0] < 0.0
            || rect[1] < 0.0
            || rect[2] > width as f64
            || rect[3] > height as f64
            || rect[2] <= rect[0]
            || rect[3] <= rect[1]
        {
            return Err(invalid("pixel atlas rectangle outside image"));
        }
        if rectangles.iter().any(|other| {
            rect[0] < other[2] && other[0] < rect[2] && rect[1] < other[3] && other[1] < rect[3]
        }) {
            return Err(invalid("overlapping pixel atlas frames"));
        }
        rectangles.push(rect);
    }
    Ok(())
}

/// Validate every cel, then compose the same near-square atlas as the web authoring model.
fn frame_atlas(source: &Value, width: u64, height: u64) -> CommandResult<(u64, u64, Vec<u8>)> {
    let palette = indexed_palette(source)?;
    if ["frame", "layer", "rgba"]
        .iter()
        .any(|key| source.get(key).is_some())
    {
        return Err(invalid("invalid pixel frame version"));
    }
    let layers = array(source, "layers")?;
    let frames = array(source, "frames")?;
    let max_frames = if bounded_integer(source, "version", 1, 10)? >= 6 {
        64
    } else {
        16
    };
    if layers.is_empty() || layers.len() > 8 || frames.is_empty() || frames.len() > max_frames {
        return Err(invalid(format!(
            "pixel source requires 1..8 layers and 1..{max_frames} frames"
        )));
    }
    if width * height * layers.len() as u64 * frames.len() as u64 > 2_097_152 {
        return Err(invalid("pixel cel budget exceeded"));
    }
    let mut ids = std::collections::HashSet::new();
    let mut metadata = Vec::new();
    for layer in layers {
        let id = source_text(layer, "id")?;
        source_text(layer, "name")?;
        if !ids.insert(id) || layer.get("rgba").is_some() {
            return Err(invalid("invalid image layer metadata"));
        }
        let visible = layer["visible"]
            .as_bool()
            .ok_or_else(|| invalid("invalid image layer flags"))?;
        layer["locked"]
            .as_bool()
            .ok_or_else(|| invalid("invalid image layer flags"))?;
        metadata.push((
            id,
            visible,
            layer_opacity(layer, bounded_integer(source, "version", 1, 10)?)?,
            layer_blend(layer, bounded_integer(source, "version", 1, 10)?)?,
        ));
    }
    let columns = (1_u64..=8)
        .find(|columns| columns * columns >= frames.len() as u64)
        .ok_or_else(|| invalid("invalid pixel atlas columns"))?;
    let rows = (frames.len() as u64).div_ceil(columns);
    let atlas_width = width * columns;
    let atlas_height = height * rows;
    let count = (width * height * 4) as usize;
    let mut atlas = vec![0; (atlas_width * atlas_height * 4) as usize];
    let mut frame_ids = std::collections::HashSet::new();
    for (index, frame) in frames.iter().enumerate() {
        let id = source_text(frame, "id")?;
        if !frame_ids.insert(id) {
            return Err(invalid("duplicate pixel frame ID"));
        }
        bounded_integer(frame, "durationMs", 1, 60_000)?;
        let cels = array(frame, "cels")?;
        if cels.len() != layers.len() {
            return Err(invalid("pixel cels must match image layers"));
        }
        let mut composite: Option<Vec<u8>> = None;
        for ((id, visible, opacity, blend), cel) in metadata.iter().zip(cels) {
            if cel["layerId"].as_str() != Some(*id) {
                return Err(invalid("pixel cels must match image layers"));
            }
            let mut pixels = if let Some(palette) = &palette {
                if cel.get("rgba").is_some() {
                    return Err(invalid("indexed cels cannot contain RGBA bytes"));
                }
                let indices = rgba_bytes(&cel["indices"], count / 4)?;
                let mut pixels = Vec::with_capacity(count);
                for index in indices {
                    pixels.extend_from_slice(
                        palette
                            .get(usize::from(index))
                            .ok_or_else(|| invalid("pixel palette index out of range"))?,
                    );
                }
                pixels
            } else {
                if cel.get("indices").is_some() {
                    return Err(invalid("indexed color mode requires pixel source v10"));
                }
                rgba_bytes(&cel["rgba"], count)?
            };
            apply_opacity(&mut pixels, *opacity);
            if *visible && *opacity > 0 {
                if let Some(output) = composite.as_mut() {
                    composite_over(output, &pixels, *blend);
                } else {
                    composite = Some(pixels);
                }
            }
        }
        let pixels = composite.unwrap_or_else(|| vec![0; count]);
        let x = (index as u64 % columns) * width;
        let y = (index as u64 / columns) * height;
        for row in 0..height as usize {
            let start = (((y as usize + row) * atlas_width as usize) + x as usize) * 4;
            atlas[start..start + width as usize * 4]
                .copy_from_slice(&pixels[row * width as usize * 4..(row + 1) * width as usize * 4]);
        }
    }
    Ok((atlas_width, atlas_height, atlas))
}

/// Keep the editable tag graph valid without owning runtime animation state.
fn validate_tags(source: &Value) -> CommandResult<()> {
    let frames = array(source, "frames")?;
    let frame_ids: std::collections::HashSet<_> = frames
        .iter()
        .filter_map(|frame| frame["id"].as_str())
        .collect();
    let tags = array(source, "tags")?;
    if tags.is_empty() || tags.len() > 16 {
        return Err(invalid("pixel tags require 1..16 entries"));
    }
    let initial = source_text(source, "initialTag")?;
    let next = bounded_integer(source, "nextClipId", 1, 65536)?;
    let mut ids = std::collections::HashSet::new();
    let mut names = std::collections::HashSet::new();
    let mut clips = std::collections::HashSet::new();
    for tag in tags {
        let id = source_text(tag, "id")?;
        let name = source_text(tag, "name")?;
        let clip = bounded_integer(tag, "clipId", 0, 65535)?;
        if !ids.insert(id) || !names.insert(name) || !clips.insert(clip) || clip >= next {
            return Err(invalid("duplicate or invalid pixel tag identity"));
        }
        if let Some(direction) = tag.get("direction") {
            if bounded_integer(source, "version", 1, 10)? < 7
                || !matches!(direction.as_str(), Some("forward" | "reverse" | "pingpong"))
            {
                return Err(invalid("invalid pixel tag direction"));
            }
        }
        if !tag["loop"].is_boolean() {
            return Err(invalid("invalid pixel tag loop"));
        }
        let references = array(tag, "frameIds")?;
        let mut seen = std::collections::HashSet::new();
        if references.is_empty()
            || references.len()
                > if bounded_integer(source, "version", 1, 10)? >= 6 {
                    64
                } else {
                    16
                }
            || references.iter().any(|value| {
                !value
                    .as_str()
                    .is_some_and(|id| frame_ids.contains(id) && seen.insert(id))
            })
        {
            return Err(invalid("invalid pixel tag frame references"));
        }
    }
    if !ids.contains(initial) {
        return Err(invalid("invalid initial pixel tag"));
    }
    Ok(())
}

fn validate_source(
    metadata: &Value,
    png: Vec<u8>,
    bytes: Vec<u8>,
    dependencies: Vec<Dependency>,
    source_png: Option<Vec<u8>>,
) -> CommandResult<Source> {
    if source_png.is_some() {
        return Err(invalid("Unexpected source PNG"));
    }
    if !dependencies.is_empty()
        || bytes.len() > 12 * 1024 * 1024
        || png.len() > 16 * 1024 * 1024
        || text(metadata, "jsonSha256")? != hash(&bytes)
        || text(metadata, "pngSha256")? != hash(&png)
    {
        return Err(invalid("pixel source byte limit or SHA-256 mismatch"));
    }
    if !complete_png(&png) {
        return Err(invalid("invalid pixel PNG layout or color space"));
    }
    let raw = std::str::from_utf8(&bytes).map_err(|_| invalid("pixel source must be UTF-8"))?;
    let source: Value =
        serde_json::from_str(raw).map_err(|_| invalid("invalid pixel source JSON"))?;
    let version = bounded_integer(&source, "version", 1, 10)
        .map_err(|_| invalid("unsupported pixel document format or version"))?;
    indexed_palette(&source)?;
    if source["format"] != "ferrum2d.pixel-document" {
        return Err(invalid("unsupported pixel document format or version"));
    }
    if (version == 1 || version == 4) && bytes.len() > 400_000 {
        return Err(invalid("pixel v1 source exceeds byte limit"));
    }
    if (version < 6 && png.len() > 8 * 1024 * 1024)
        || (version == 2 && bytes.len() > 3 * 1024 * 1024)
        || (!matches!(version, 3 | 5 | 6 | 7 | 8 | 9 | 10)
            && (png.len() > 4 * 1024 * 1024 || source.get("frames").is_some()))
    {
        return Err(invalid(
            "pixel legacy source limit or frame version differs",
        ));
    }
    let width = bounded_integer(&source, "width", 1, 256)?;
    let height = bounded_integer(&source, "height", 1, 256)?;
    source_text(&source, "name")?;
    if version == 4 {
        validate_atlas(&source, width, height)?;
    } else if source.get("atlas").is_some() {
        return Err(invalid("invalid pixel atlas version"));
    }
    if !matches!(version, 3 | 5 | 6 | 7 | 8 | 9 | 10) {
        source_text(&source["frame"], "id")?;
        bounded_integer(&source["frame"], "durationMs", 1, 60_000)?;
    }
    if source["colorSpace"] != "srgb" {
        return Err(invalid("pixel color space differs"));
    }
    let palette = array(&source, "palette")?;
    if palette.len() > 256
        || palette.iter().any(|v| {
            !v.as_str().is_some_and(|s| {
                s.len() == 9 && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
            })
        })
    {
        return Err(invalid("invalid pixel palette"));
    }
    let count = (width * height * 4) as usize;
    let pixels = if matches!(version, 3 | 5 | 6 | 7 | 8 | 9 | 10) {
        Vec::new()
    } else if version == 1 || version == 4 {
        if source.get("layers").is_some() {
            return Err(invalid("invalid image layer version"));
        }
        source_text(&source["layer"], "id")?;
        source_text(&source["layer"], "name")?;
        layer_opacity(&source["layer"], version)?;
        layer_blend(&source["layer"], version)?;
        rgba_bytes(&source["rgba"], count)?
    } else {
        if source.get("layer").is_some() || source.get("rgba").is_some() {
            return Err(invalid("invalid image layer version"));
        }
        let layers = array(&source, "layers")?;
        if layers.is_empty() || layers.len() > 8 {
            return Err(invalid("image layers require 1..8 entries"));
        }
        let mut seen = std::collections::HashSet::new();
        let mut composite: Option<Vec<u8>> = None;
        for layer in layers {
            let id = source_text(layer, "id")?;
            source_text(layer, "name")?;
            if !seen.insert(id) {
                return Err(invalid("duplicate image layer ID"));
            }
            let visible = layer["visible"]
                .as_bool()
                .ok_or_else(|| invalid("invalid image layer flags"))?;
            layer["locked"]
                .as_bool()
                .ok_or_else(|| invalid("invalid image layer flags"))?;
            let opacity = layer_opacity(layer, version)?;
            let blend = layer_blend(layer, version)?;
            let mut pixels = rgba_bytes(&layer["rgba"], count)?;
            apply_opacity(&mut pixels, opacity);
            if visible && opacity > 0 {
                if let Some(output) = composite.as_mut() {
                    composite_over(output, &pixels, blend);
                } else {
                    composite = Some(pixels);
                }
            }
        }
        composite.unwrap_or_else(|| vec![0; count])
    };
    let (width, height, pixels) = if matches!(version, 3 | 5 | 6 | 7 | 8 | 9 | 10) {
        frame_atlas(&source, width, height)?
    } else {
        (width, height, pixels)
    };
    if version == 5
        || version == 7
        || ((version == 6 || version >= 8) && source.get("tags").is_some())
    {
        validate_tags(&source)?;
    } else if ["tags", "initialTag", "nextClipId"]
        .iter()
        .any(|key| source.get(key).is_some())
    {
        return Err(invalid("invalid pixel tag version"));
    }
    let count = (width * height * 4) as usize;
    let max_side = if version >= 6 { 2048 } else { 1024 };
    if bounded_integer(metadata, "width", 1, max_side)? != width
        || bounded_integer(metadata, "height", 1, max_side)? != height
    {
        return Err(invalid("pixel dimensions differ"));
    }
    let identity = text(metadata, "identityDocument")?;
    let identity_bytes = serde_json::to_vec(&json!([identity, raw]))
        .map_err(|_| invalid("invalid pixel identity"))?;
    if text(metadata, "assetId")? != format!("pixel.{}", &hash(&identity_bytes)[..24]) {
        return Err(invalid("pixel revision identity differs"));
    }
    let mut decoder = png::Decoder::new(Cursor::new(&png));
    decoder.set_limits(png::Limits {
        bytes: if matches!(version, 3 | 5 | 6 | 7 | 8 | 9 | 10) {
            16 * 1024 * 1024
        } else {
            2 * 1024 * 1024
        },
    });
    let mut reader = decoder
        .read_info()
        .map_err(|_| invalid("invalid pixel PNG"))?;
    if u64::from(reader.info().width) != width
        || u64::from(reader.info().height) != height
        || reader.info().bit_depth != png::BitDepth::Eight
        || reader.info().color_type != png::ColorType::Rgba
        || reader.info().animation_control.is_some()
        || reader.output_buffer_size() != count
    {
        return Err(invalid("pixel PNG dimensions or RGBA format differ"));
    }
    let mut output = vec![0; count];
    reader
        .next_frame(&mut output)
        .map_err(|_| invalid("pixel PNG decode failed"))?;
    if output != pixels {
        return Err(invalid("pixel PNG and editable source differ"));
    }
    reader
        .finish()
        .map_err(|_| invalid("invalid pixel PNG end or checksum"))?;
    // Metadata is semantic; canonicalize integer spelling for JS roundtrips.
    // The editable JSON bytes remain untouched because they define revision identity.
    let mut metadata = metadata.clone();
    metadata["width"] = json!(width);
    metadata["height"] = json!(height);
    Ok(Source {
        metadata,
        png,
        json: bytes,
        dependencies,
        source_png,
    })
}

pub(super) fn save_inner(
    project: &Path,
    bundle: &Value,
    registry: &PlacementAssetRegistry,
    writes: &PlacementWriteRegistry,
) -> CommandResult<Value> {
    super::sprite_assets::save_inner(&CONTRACT, project, bundle, registry, writes)
}
pub(super) fn load_inner(
    project: &Path,
    registry: &PlacementAssetRegistry,
    writes: &PlacementWriteRegistry,
) -> CommandResult<Value> {
    super::sprite_assets::load_inner(&CONTRACT, project, registry, writes)
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    struct Project(PathBuf);
    impl Project {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "ferrum-pixel-project-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(path.join("public")).expect("fixture directory");
            Self(path.canonicalize().expect("canonical fixture"))
        }
        fn writes(&self) -> PlacementWriteRegistry {
            let writes = PlacementWriteRegistry::default();
            writes
                .authorize_project(&self.0)
                .expect("authorize fixture");
            writes
        }
        fn root(&self) -> PathBuf {
            self.0.join("public/assets/.ferrum-pixels")
        }
    }
    impl Drop for Project {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    pub(in super::super) fn fixture(color: u8) -> Value {
        // A zero-alpha pixel deliberately carries RGB that canvas would lose.
        let pixels = [color, 40, 160, 255, 12, 34, 56, 0];
        let source = json!({"format":"ferrum2d.pixel-document","version":1,"name":"캐릭터","width":2,"height":1,
            "colorSpace":"srgb","layer":{"id":"layer-1","name":"Layer 1"},"frame":{"id":"frame-1","durationMs":100},
            "palette":["#ff0000ff"],"rgba":STANDARD.encode(pixels)});
        let bytes = serde_json::to_vec(&source).expect("source bytes");
        let raw = std::str::from_utf8(&bytes).unwrap();
        let identity = "/project/public/scene-authoring.json";
        let id = format!(
            "pixel.{}",
            &hash(&serde_json::to_vec(&json!([identity, raw])).unwrap())[..24]
        );
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, 2, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&pixels)
                .unwrap();
        }
        let mut textures = serde_json::Map::new();
        textures.insert(id.clone(), json!(format!("{id}.png")));
        let mut options = serde_json::Map::new();
        options.insert(id.clone(), json!({"colorSpace":"srgb"}));
        json!({"format":"ferrum2d.pixel-project.assets","version":1,"overwrite":false,"expectedCatalogRevision":"",
            "revisions":[{"assetId":id,"identityDocument":identity,"width":2,"height":1,"jsonSha256":hash(&bytes),"pngSha256":hash(&png)}],
            "manifest":{"textures":textures,"textureOptions":options},
            "files":[{"path":format!("{id}.png"),"mediaType":"image/png","sha256":hash(&png),"base64":STANDARD.encode(&png)},
                {"path":format!("{id}.json"),"mediaType":"application/json","sha256":hash(&bytes),"base64":STANDARD.encode(&bytes)}]})
    }
    #[test]
    fn stores_editable_pixels_reopens_and_requires_the_opened_catalog_revision() {
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        assert_eq!(
            load_inner(&project.0, &registry, &writes).unwrap()["catalogRevision"],
            ""
        );
        let first = fixture(180);
        let saved = save_inner(&project.0, &first, &registry, &writes).unwrap();
        assert_eq!(saved["assets"].as_array().unwrap().len(), 1);
        assert_eq!(saved["catalogRevision"].as_str().unwrap().len(), 64);
        let fresh = load_inner(
            &project.0,
            &PlacementAssetRegistry::default(),
            &project.writes(),
        )
        .unwrap();
        assert_eq!(saved, fresh);
        let before = fs::read(project.root().join("catalog.json")).unwrap();
        assert!(save_inner(&project.0, &fixture(200), &registry, &writes)
            .unwrap_err()
            .to_string()
            .contains("changed on disk"));
        assert_eq!(
            fs::read(project.root().join("catalog.json")).unwrap(),
            before
        );
        let mut second = fixture(200);
        second["expectedCatalogRevision"] = saved["catalogRevision"].clone();
        let next = save_inner(&project.0, &second, &registry, &writes).unwrap();
        assert_eq!(next["assets"].as_array().unwrap().len(), 2);
        assert_ne!(saved["catalogRevision"], next["catalogRevision"]);
    }
    #[test]
    fn validates_png_source_hashes_identity_and_paths_before_publication() {
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        for change in [0, 1, 2, 3, 4] {
            let mut bundle = fixture(140);
            match change {
                0 => bundle["revisions"][0]["pngSha256"] = json!("0".repeat(64)),
                1 => bundle["files"][1]["path"] = json!("../escaped.json"),
                2 => bundle["revisions"][0]["identityDocument"] = json!("another-scene"),
                3 => bundle["revisions"][0]["width"] = json!(257),
                _ => {
                    let different = fixture(200);
                    bundle["files"][0] = different["files"][0].clone();
                    bundle["files"][0]["path"] = fixture(140)["files"][0]["path"].clone();
                    bundle["revisions"][0]["pngSha256"] =
                        different["revisions"][0]["pngSha256"].clone();
                }
            }
            assert!(save_inner(&project.0, &bundle, &registry, &writes).is_err());
        }
        assert!(!project.root().join("catalog.json").exists());
        assert!(registry.assets.lock().unwrap().is_empty());
        assert!(save_inner(
            &project.0,
            &fixture(140),
            &registry,
            &PlacementWriteRegistry::default()
        )
        .is_err());
    }
    #[test]
    fn partial_file_failure_keeps_the_previous_catalog_and_reclaims_only_our_files() {
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        let saved = save_inner(&project.0, &fixture(100), &registry, &writes).unwrap();
        let before = fs::read(project.root().join("catalog.json")).unwrap();
        let mut next = fixture(200);
        next["expectedCatalogRevision"] = saved["catalogRevision"].clone();
        let id = next["revisions"][0]["assetId"].as_str().unwrap();
        let blocked = project.root().join(format!("{id}.json"));
        fs::write(&blocked, b"external bytes").unwrap();
        assert!(save_inner(&project.0, &next, &registry, &writes).is_err());
        assert_eq!(
            fs::read(project.root().join("catalog.json")).unwrap(),
            before
        );
        assert_eq!(fs::read(blocked).unwrap(), b"external bytes");
        assert!(!project.root().join(format!("{id}.png")).exists());
        assert_eq!(load_inner(&project.0, &registry, &writes).unwrap(), saved);
    }
    #[test]
    fn layered_source_saves_and_requires_its_visible_composite() {
        let mut source: Value = serde_json::from_slice(
            &STANDARD
                .decode(fixture(100)["files"][1]["base64"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        source["version"] = json!(2);
        source.as_object_mut().unwrap().remove("layer");
        source.as_object_mut().unwrap().remove("rgba");
        let base = [255, 0, 0, 255, 12, 34, 56, 0];
        source["layers"] = json!([
            {"id":"base","name":"Body","visible":true,"locked":false,"rgba":STANDARD.encode(base)},
            {"id":"top","name":"Armor","visible":true,"locked":true,"rgba":STANDARD.encode([0,0,255,128,0,0,0,0])}
        ]);
        let expected = [127, 0, 128, 255, 12, 34, 56, 0];
        let bundle = layered_bundle(&source, &expected);
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        let saved = save_inner(&project.0, &bundle, &registry, &writes).unwrap();
        let id = saved["assets"][0]["metadata"]["assetId"].as_str().unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(
                &fs::read(project.root().join(format!("{id}.json"))).unwrap()
            )
            .unwrap(),
            source
        );
        assert_eq!(load_inner(&project.0, &registry, &writes).unwrap(), saved);
        source["layers"][1]["visible"] = json!(false);
        let invalid = layered_bundle(&source, &expected);
        let mismatch = Project::new();
        assert!(
            save_inner(&mismatch.0, &invalid, &registry, &mismatch.writes())
                .unwrap_err()
                .to_string()
                .contains("editable source")
        );
        let other = Project::new();
        save_inner(
            &other.0,
            &layered_bundle(&source, &base),
            &registry,
            &other.writes(),
        )
        .unwrap();
        for duplicate in [false, true] {
            let mut invalid_source = source.clone();
            if duplicate {
                invalid_source["layers"][1]["id"] = invalid_source["layers"][0]["id"].clone();
            } else {
                invalid_source["layers"][1]["locked"] = json!("false");
            }
            let invalid = layered_bundle(&invalid_source, &base);
            let target = Project::new();
            assert!(save_inner(&target.0, &invalid, &registry, &target.writes())
                .unwrap_err()
                .to_string()
                .contains("layer"));
        }
    }

    #[test]
    fn layered_source_above_one_mib_restores_with_the_pixel_specific_bound() {
        let rgba = [0, 0, 255, 255].repeat(256 * 256);
        let mut source = json!({"format":"ferrum2d.pixel-document","version":2,"name":"Large","width":256,"height":256,"colorSpace":"srgb",
            "frame":{"id":"frame-1","durationMs":100},"palette":[],"layers":[]});
        source["layers"] = Value::Array((0..8).map(|i|json!({"id":format!("layer-{i}"),"name":format!("Layer {i}"),"visible":true,"locked":false,
            "rgba":STANDARD.encode(if i==0 {rgba.clone()} else {vec![0;rgba.len()]})})).collect());
        let bytes = serde_json::to_vec(&source).unwrap();
        assert!(bytes.len() > 1024 * 1024 && bytes.len() < 3 * 1024 * 1024);
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        let saved = save_inner(
            &project.0,
            &layered_bundle(&source, &rgba),
            &registry,
            &writes,
        )
        .unwrap();
        assert_eq!(
            load_inner(
                &project.0,
                &PlacementAssetRegistry::default(),
                &project.writes()
            )
            .unwrap(),
            saved
        );
    }

    #[test]
    fn editable_source_integer_spellings_survive_native_save_and_reopen() {
        let pixels = [100, 40, 160, 255, 12, 34, 56, 0];
        for version in [1.0, 2.0] {
            let mut source = json!({"format":"ferrum2d.pixel-document","version":version,"name":"Numbers","width":2.0,"height":1.0,
                "colorSpace":"srgb","frame":{"id":"frame-1","durationMs":100.0},"palette":[]});
            if version == 1.0 {
                source["layer"] = json!({"id":"layer-1","name":"Layer 1"});
                source["rgba"] = json!(STANDARD.encode(pixels));
            } else {
                source["layers"] = json!([{"id":"layer-1","name":"Layer 1","visible":true,"locked":false,"rgba":STANDARD.encode(pixels)}]);
            }
            let project = Project::new();
            let registry = PlacementAssetRegistry::default();
            let saved = save_inner(
                &project.0,
                &layered_bundle(&source, &pixels),
                &registry,
                &project.writes(),
            )
            .expect("JSON integer spellings accepted by Number.isInteger must save");
            let id = saved["assets"][0]["metadata"]["assetId"].as_str().unwrap();
            assert_eq!(
                fs::read(project.root().join(format!("{id}.json"))).unwrap(),
                serde_json::to_vec(&source).unwrap()
            );
            assert_eq!(
                load_inner(
                    &project.0,
                    &PlacementAssetRegistry::default(),
                    &project.writes()
                )
                .unwrap(),
                saved
            );
            // JavaScript parses 2.0 as 2 and sends canonical metadata on resave.
            let mut canonical = layered_bundle(&source, &pixels);
            canonical["revisions"][0]["width"] = json!(2);
            canonical["revisions"][0]["height"] = json!(1);
            canonical["expectedCatalogRevision"] = saved["catalogRevision"].clone();
            let resaved = save_inner(&project.0, &canonical, &registry, &project.writes())
                .expect("equivalent integer metadata must not conflict on resave");
            assert_eq!(resaved["assets"].as_array().unwrap().len(), 1);
        }
    }

    #[test]
    fn editable_source_text_uses_the_frontend_whitespace_set() {
        for (name, accepted) in [
            ("\u{feff}", false),
            (" \u{feff}\t", false),
            ("\u{85}", true),
            ("\u{feff}Body", true),
        ] {
            assert_eq!(
                source_text(&json!({"name":name}), "name").is_ok(),
                accepted,
                "{name:?}"
            );
        }
    }

    #[test]
    fn directional_sources_save_reopen_and_reject_legacy_or_invalid_directions() {
        let pixels = [0, 0, 255, 255];
        let source = json!({"format":"ferrum2d.pixel-document","version":7,"name":"Direction","width":1,"height":1,"colorSpace":"srgb","palette":[],
            "layers":[{"id":"body","name":"Body","visible":true,"locked":false}],
            "frames":[{"id":"a","durationMs":100,"cels":[{"layerId":"body","rgba":STANDARD.encode(pixels)}]}],
            "tags":[{"id":"walk","name":"Walk","clipId":7,"frameIds":["a"],"loop":true,"direction":"reverse"}],
            "initialTag":"walk","nextClipId":8});
        for direction in ["forward", "reverse", "pingpong"] {
            let mut source = source.clone();
            source["tags"][0]["direction"] = json!(direction);
            let project = Project::new();
            let saved = save_inner(
                &project.0,
                &pixel_bundle(&source, &pixels, 1, 1),
                &PlacementAssetRegistry::default(),
                &project.writes(),
            )
            .unwrap();
            assert_eq!(
                load_inner(
                    &project.0,
                    &PlacementAssetRegistry::default(),
                    &project.writes()
                )
                .unwrap(),
                saved
            );
        }
        for change in 0..7 {
            let mut bad = source.clone();
            match change {
                0 => bad["version"] = json!(5),
                1 => bad["version"] = json!(6),
                2 => bad["tags"][0]["direction"] = json!("wrong"),
                3 => bad["tags"][0]["direction"] = json!(["forward"]),
                4 => bad["tags"][0]["direction"] = json!(null),
                5 => bad["tags"][0]["direction"] = json!(0),
                _ => {
                    bad.as_object_mut().unwrap().remove("tags");
                }
            }
            let target = Project::new();
            assert!(save_inner(
                &target.0,
                &pixel_bundle(&bad, &pixels, 1, 1),
                &PlacementAssetRegistry::default(),
                &target.writes()
            )
            .is_err());
            assert!(!target.root().join("catalog.json").exists());
        }
    }

    #[test]
    fn tagged_sources_keep_ids_and_reject_invalid_metadata_atomically() {
        let source = json!({"format":"ferrum2d.pixel-document","version":5,"name":"Tagged","width":2,"height":1,"colorSpace":"srgb","palette":[],
            "layers":[{"id":"body","name":"Body","visible":true,"locked":false}],
            "frames":[{"id":"a","durationMs":100,"cels":[{"layerId":"body","rgba":STANDARD.encode([0,0,255,255,0,0,255,255])}]}],
            "tags":[{"id":"idle","name":"대기","clipId":0,"frameIds":["a"],"loop":true},{"id":"attack","name":"Attack","clipId":7,"frameIds":["a"],"loop":false}],
            "initialTag":"idle","nextClipId":8});
        let pixels = [0, 0, 255, 255, 0, 0, 255, 255];
        let project = Project::new();
        let saved = save_inner(
            &project.0,
            &pixel_bundle(&source, &pixels, 2, 1),
            &PlacementAssetRegistry::default(),
            &project.writes(),
        )
        .unwrap();
        assert_eq!(
            load_inner(
                &project.0,
                &PlacementAssetRegistry::default(),
                &project.writes()
            )
            .unwrap(),
            saved
        );
        for change in 0..10 {
            let mut bad = source.clone();
            match change {
                0 => bad["tags"][1]["id"] = json!("idle"),
                1 => bad["tags"][1]["name"] = json!("대기"),
                2 => bad["tags"][1]["clipId"] = json!(0),
                3 => bad["tags"][0]["frameIds"] = json!(["missing"]),
                4 => bad["tags"][0]["frameIds"] = json!(["a", "a"]),
                5 => bad["initialTag"] = json!("missing"),
                6 => bad["nextClipId"] = json!(7),
                7 => bad["tags"][0]["loop"] = json!(0),
                8 => bad["tags"] = json!([]),
                _ => bad["version"] = json!(3),
            }
            let target = Project::new();
            assert!(save_inner(
                &target.0,
                &pixel_bundle(&bad, &pixels, 2, 1),
                &PlacementAssetRegistry::default(),
                &target.writes()
            )
            .is_err());
            assert!(!target.root().join("catalog.json").exists());
        }
    }

    #[test]
    fn frame_atlas_saves_reopens_and_rejects_wrong_cels_or_padding() {
        let colors = [
            vec![255, 0, 0, 255, 12, 34, 56, 0],
            vec![0, 0, 255, 255, 0, 0, 255, 255],
            vec![0, 255, 0, 255, 0, 255, 0, 255],
        ];
        let mut source = json!({"format":"ferrum2d.pixel-document","version":3,"name":"Frames","width":2,"height":1,"colorSpace":"srgb","palette":[],
            "layers":[{"id":"body","name":"Body","visible":true,"locked":false}],"frames":[]});
        source["frames"]=Value::Array(colors.iter().enumerate().map(|(i,pixels)|json!({"id":format!("frame-{i}"),"durationMs":100*(i+1),"cels":[{"layerId":"body","rgba":STANDARD.encode(pixels)}]})).collect());
        let expected = [
            255, 0, 0, 255, 12, 34, 56, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 0, 255, 0, 255,
            0, 255, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        let bundle = pixel_bundle(&source, &expected, 4, 2);
        let saved = save_inner(&project.0, &bundle, &registry, &writes).unwrap();
        assert_eq!(saved["assets"][0]["metadata"]["width"], 4);
        assert_eq!(
            load_inner(
                &project.0,
                &PlacementAssetRegistry::default(),
                &project.writes()
            )
            .unwrap(),
            saved
        );
        for change in 0..5 {
            let mut invalid = source.clone();
            match change {
                0 => invalid["frames"][1]["id"] = invalid["frames"][0]["id"].clone(),
                1 => invalid["frames"][0]["cels"][0]["layerId"] = json!("other"),
                2 => invalid["frames"][0]["durationMs"] = json!(0),
                3 => invalid["frames"][0]["cels"] = json!([]),
                _ => invalid["layers"][0]["rgba"] = json!("AAAA"),
            }
            let target = Project::new();
            assert!(save_inner(
                &target.0,
                &pixel_bundle(&invalid, &expected, 4, 2),
                &registry,
                &target.writes()
            )
            .is_err());
            assert!(!target.root().join("catalog.json").exists());
        }
        let mut wrong = expected;
        wrong[28] = 255;
        let target = Project::new();
        assert!(save_inner(
            &target.0,
            &pixel_bundle(&source, &wrong, 4, 2),
            &registry,
            &target.writes()
        )
        .unwrap_err()
        .to_string()
        .contains("editable source"));
    }

    fn capacity_source(count: usize, side: usize) -> (Value, Vec<u8>, usize, usize) {
        let columns = (count as f64).sqrt().ceil() as usize;
        let rows = count.div_ceil(columns);
        let (width, height) = (side * columns, side * rows);
        let mut atlas = vec![0; width * height * 4];
        let frames: Vec<_> = (0..count)
            .map(|index| {
                let mut pixels = [index as u8, 40, 70, 255].repeat(side * side);
                pixels[3] = 0; // Preserve hidden RGB even in the final cel.
                for y in 0..side {
                    let start = ((index / columns * side + y) * width + index % columns * side) * 4;
                    atlas[start..start + side * 4]
                        .copy_from_slice(&pixels[y * side * 4..(y + 1) * side * 4]);
                }
                json!({"id":format!("frame-{index}"),"durationMs":83+index,
                    "cels":[{"layerId":"body","rgba":STANDARD.encode(pixels)}]})
            })
            .collect();
        let source = json!({"format":"ferrum2d.pixel-document","version":6,"name":"Capacity",
            "width":side,"height":side,"colorSpace":"srgb","palette":[],
            "layers":[{"id":"body","name":"Body","visible":true,"locked":false}],"frames":frames});
        (source, atlas, width, height)
    }

    #[test]
    fn v6_capacity_sources_save_reopen_and_accept_wide_atlases_and_numeric_version_spelling() {
        for (count, side) in [(64, 32), (17, 256)] {
            let (mut source, pixels, width, height) = capacity_source(count, side);
            source["version"] = json!(6.0);
            source["tags"] = json!([{"id":"all","name":"All","clipId":7,"frameIds":
                (0..count).map(|i|format!("frame-{i}")).collect::<Vec<_>>(),"loop":false}]);
            source["initialTag"] = json!("all");
            source["nextClipId"] = json!(8);
            let project = Project::new();
            let saved = save_inner(
                &project.0,
                &pixel_bundle(&source, &pixels, width as u32, height as u32),
                &PlacementAssetRegistry::default(),
                &project.writes(),
            )
            .unwrap();
            assert_eq!(saved["assets"][0]["metadata"]["width"], width);
            assert_eq!(
                load_inner(
                    &project.0,
                    &PlacementAssetRegistry::default(),
                    &project.writes()
                )
                .unwrap(),
                saved
            );
        }
    }

    #[test]
    fn v6_capacity_validation_rejects_legacy_overflow_and_partial_tags_before_storage() {
        for version in [3, 5, 6] {
            let (mut source, pixels, width, height) =
                capacity_source(if version >= 6 { 65 } else { 17 }, 2);
            source["version"] = json!(version);
            let project = Project::new();
            assert!(save_inner(
                &project.0,
                &pixel_bundle(&source, &pixels, width as u32, height as u32),
                &PlacementAssetRegistry::default(),
                &project.writes()
            )
            .is_err());
            assert!(!project.root().join("catalog.json").exists());
        }
        let (mut source, pixels, width, height) = capacity_source(64, 2);
        source["initialTag"] = json!("missing");
        let project = Project::new();
        assert!(save_inner(
            &project.0,
            &pixel_bundle(&source, &pixels, width as u32, height as u32),
            &PlacementAssetRegistry::default(),
            &project.writes()
        )
        .is_err());
        assert!(!project.root().join("catalog.json").exists());
    }

    #[test]
    fn frame_source_above_three_mib_uses_the_v3_bound_and_checks_cel_budget() {
        let blue = [0, 0, 255, 255].repeat(256 * 256);
        let transparent = vec![0; blue.len()];
        let layers:Vec<Value>=(0..8).map(|i|json!({"id":format!("layer-{i}"),"name":format!("Layer {i}"),"visible":true,"locked":false})).collect();
        let mut source = json!({"format":"ferrum2d.pixel-document","version":3,"name":"Large Frames","width":256,"height":256,"colorSpace":"srgb","palette":[],"layers":layers,"frames":[]});
        source["frames"]=Value::Array((0..2).map(|i|json!({"id":format!("frame-{i}"),"durationMs":100,"cels":(0..8).map(|j|json!({"layerId":format!("layer-{j}"),"rgba":STANDARD.encode(if j==0 {&blue}else{&transparent})})).collect::<Vec<_>>()})).collect());
        let bytes = serde_json::to_vec(&source).unwrap();
        assert!(bytes.len() > 3 * 1024 * 1024 && bytes.len() < 12 * 1024 * 1024);
        let project = Project::new();
        let registry = PlacementAssetRegistry::default();
        let saved = save_inner(
            &project.0,
            &pixel_bundle(&source, &[0, 0, 255, 255].repeat(512 * 256), 512, 256),
            &registry,
            &project.writes(),
        )
        .unwrap();
        assert_eq!(
            load_inner(
                &project.0,
                &PlacementAssetRegistry::default(),
                &project.writes()
            )
            .unwrap(),
            saved
        );
        source["frames"] = Value::Array(
            (0..5)
                .map(|i| json!({"id":format!("frame-{i}"),"durationMs":100,"cels":[]}))
                .collect(),
        );
        let target = Project::new();
        assert!(save_inner(
            &target.0,
            &pixel_bundle(&source, &vec![0; 768 * 512 * 4], 768, 512),
            &registry,
            &target.writes()
        )
        .unwrap_err()
        .to_string()
        .contains("cel budget"));
    }

    #[test]
    fn fixed_atlas_roundtrip_preserves_uv_and_rgba_and_rejects_ambiguous_rects() {
        let pixels = [0, 0, 255, 255, 12, 34, 56, 0];
        let source = json!({"format":"ferrum2d.pixel-document","version":4,"name":"Atlas","width":2,"height":1,
            "colorSpace":"srgb","layer":{"id":"layer-1","name":"Layer 1"},"frame":{"id":"frame-1","durationMs":100},
            "palette":[],"rgba":STANDARD.encode(pixels),"atlas":{"texture":"sheet","frames":[
                {"id":"left","frame":{"u0":0,"v0":0,"u1":0.5,"v1":1}},
                {"id":"right","frame":{"u0":0.5,"v0":0,"u1":1,"v1":1}}]}});
        let target = Project::new();
        let registry = PlacementAssetRegistry::default();
        save_inner(
            &target.0,
            &pixel_bundle(&source, &pixels, 2, 1),
            &registry,
            &target.writes(),
        )
        .unwrap();
        assert_eq!(
            load_inner(&target.0, &registry, &target.writes()).unwrap()["assets"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        for change in 0..8 {
            let mut invalid = source.clone();
            match change {
                0 => invalid["atlas"]["frames"][1]["id"] = json!("left"),
                1 => invalid["atlas"]["frames"][1]["frame"]["u0"] = json!(0),
                2 => invalid["atlas"]["frames"][0]["frame"]["u1"] = json!(0.1),
                3 => invalid["atlas"]["frames"][1]["frame"]["u1"] = json!(2),
                4 => invalid["atlas"]["frames"] = json!([]),
                5 => invalid["atlas"]["frames"][0]["frame"]["u0"] = json!(-1e-12),
                6 => invalid["atlas"]["frames"][1]["frame"]["u1"] = json!(1.0 + 1e-12),
                _ => invalid["version"] = json!(1),
            }
            let target = Project::new();
            assert!(save_inner(
                &target.0,
                &pixel_bundle(&invalid, &pixels, 2, 1),
                &registry,
                &target.writes()
            )
            .is_err());
            assert!(!target.root().join("catalog.json").exists());
        }
    }

    fn layered_bundle(source: &Value, pixels: &[u8]) -> Value {
        let mut bundle = pixel_bundle(
            source,
            pixels,
            source["width"].as_f64().unwrap() as u32,
            source["height"].as_f64().unwrap() as u32,
        );
        bundle["revisions"][0]["width"] = source["width"].clone();
        bundle["revisions"][0]["height"] = source["height"].clone();
        bundle
    }
    fn pixel_bundle(source: &Value, pixels: &[u8], width: u32, height: u32) -> Value {
        let raw = serde_json::to_vec(source).unwrap();
        let identity = "/project/public/scene-authoring.json";
        let id = format!(
            "pixel.{}",
            &hash(
                &serde_json::to_vec(&json!([identity, std::str::from_utf8(&raw).unwrap()]))
                    .unwrap()
            )[..24]
        );
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(pixels)
                .unwrap();
        }
        let mut textures = serde_json::Map::new();
        textures.insert(id.clone(), json!(format!("{id}.png")));
        let mut options = serde_json::Map::new();
        options.insert(id.clone(), json!({"colorSpace":"srgb"}));
        json!({"format":"ferrum2d.pixel-project.assets","version":1,"overwrite":false,"expectedCatalogRevision":"",
            "revisions":[{"assetId":id,"identityDocument":identity,"width":width,"height":height,"jsonSha256":hash(&raw),"pngSha256":hash(&png)}],
            "manifest":{"textures":textures,"textureOptions":options},
            "files":[{"path":format!("{id}.png"),"mediaType":"image/png","sha256":hash(&png),"base64":STANDARD.encode(&png)},
                {"path":format!("{id}.json"),"mediaType":"application/json","sha256":hash(&raw),"base64":STANDARD.encode(&raw)}]})
    }

    #[test]
    fn opacity_sources_save_reopen_and_validate_each_composited_frame() {
        let source = json!({"format":"ferrum2d.pixel-document","version":8,"name":"Opacity","width":1,"height":1,"colorSpace":"srgb","palette":[],
            "layers":[{"id":"body","name":"Body","visible":true,"locked":false,"opacity":128},
                {"id":"hidden","name":"Hidden","visible":false,"locked":true,"opacity":33}],
            "frames":[{"id":"a","durationMs":100,"cels":[{"layerId":"body","rgba":STANDARD.encode([255,0,0,255])},{"layerId":"hidden","rgba":STANDARD.encode([1,2,3,255])}]},
                {"id":"b","durationMs":180,"cels":[{"layerId":"body","rgba":STANDARD.encode([0,0,255,128])},{"layerId":"hidden","rgba":STANDARD.encode([4,5,6,0])}]}],
            "tags":[{"id":"idle","name":"Idle","clipId":3,"frameIds":["b","a"],"loop":true,"direction":"reverse"}],"initialTag":"idle","nextClipId":4});
        let pixels = [255, 0, 0, 128, 0, 0, 255, 64];
        let project = Project::new();
        let registry = PlacementAssetRegistry::default();
        let saved = save_inner(
            &project.0,
            &pixel_bundle(&source, &pixels, 2, 1),
            &registry,
            &project.writes(),
        )
        .unwrap();
        let loaded = load_inner(
            &project.0,
            &PlacementAssetRegistry::default(),
            &project.writes(),
        )
        .unwrap();
        assert_eq!(loaded, saved);
        let id = saved["assets"][0]["metadata"]["assetId"].as_str().unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(
                &fs::read(project.root().join(format!("{id}.json"))).unwrap()
            )
            .unwrap(),
            source
        );
        for opacity in [json!(-1), json!(256), json!(0.5), json!("128"), Value::Null] {
            let mut bad = source.clone();
            bad["layers"][0]["opacity"] = opacity;
            let bad_project = Project::new();
            let error = save_inner(
                &bad_project.0,
                &pixel_bundle(&bad, &pixels, 2, 1),
                &PlacementAssetRegistry::default(),
                &bad_project.writes(),
            )
            .unwrap_err();
            assert!(error.to_string().contains("opacity"), "{error}");
        }
    }

    #[test]
    fn opacity_is_required_in_v8_and_rejected_in_legacy_cels() {
        let (mut source, _, _, _) = capacity_source(2, 1);
        source["version"] = json!(8);
        let project = Project::new();
        let pixels = [0; 8];
        let save = |value: &Value, image: &[u8]| {
            save_inner(
                &project.0,
                &pixel_bundle(value, image, 2, 1),
                &PlacementAssetRegistry::default(),
                &project.writes(),
            )
        };
        assert!(save(&source, &pixels)
            .unwrap_err()
            .to_string()
            .contains("opacity"));
        source["layers"][0]["opacity"] = json!(0);
        let saved =
            save(&source, &pixels).expect("zero opacity is transparent without changing raw cels");
        let id = saved["assets"][0]["metadata"]["assetId"].as_str().unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(
                &fs::read(project.root().join(format!("{id}.json"))).unwrap()
            )
            .unwrap(),
            source
        );
        source["version"] = json!(6);
        let bad_project = Project::new();
        assert!(save_inner(
            &bad_project.0,
            &pixel_bundle(&source, &pixels, 2, 1),
            &PlacementAssetRegistry::default(),
            &bad_project.writes()
        )
        .unwrap_err()
        .to_string()
        .contains("opacity"));
    }

    #[test]
    fn png_gamma_must_agree_with_the_srgb_editable_source() {
        for (gamma, expected) in [(1.0, false), (0.45455, true)] {
            let project = Project::new();
            let mut bundle = fixture(100);
            let mut bytes = Vec::new();
            {
                let mut encoder = png::Encoder::new(&mut bytes, 2, 1);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                encoder.set_source_gamma(png::ScaledFloat::new(gamma));
                encoder
                    .write_header()
                    .unwrap()
                    .write_image_data(&[100, 40, 160, 255, 12, 34, 56, 0])
                    .unwrap();
            }
            bundle["files"][0]["base64"] = json!(STANDARD.encode(&bytes));
            bundle["files"][0]["sha256"] = json!(hash(&bytes));
            bundle["revisions"][0]["pngSha256"] = json!(hash(&bytes));
            assert_eq!(
                save_inner(
                    &project.0,
                    &bundle,
                    &PlacementAssetRegistry::default(),
                    &project.writes()
                )
                .is_ok(),
                expected
            );
        }
    }

    #[test]
    fn incomplete_png_end_or_bad_end_crc_cannot_be_published() {
        for corruption in [0, 1, 2] {
            let project = Project::new();
            let writes = project.writes();
            let registry = PlacementAssetRegistry::default();
            let mut bundle = fixture(100);
            let mut bytes = STANDARD
                .decode(bundle["files"][0]["base64"].as_str().unwrap())
                .unwrap();
            match corruption {
                0 => bytes.truncate(bytes.len() - 12),
                1 => {
                    let last = bytes.len() - 1;
                    bytes[last] ^= 1;
                }
                _ => bytes.extend_from_slice(b"trailing bytes"),
            }
            bundle["files"][0]["base64"] = json!(STANDARD.encode(&bytes));
            bundle["files"][0]["sha256"] = json!(hash(&bytes));
            bundle["revisions"][0]["pngSha256"] = json!(hash(&bytes));
            assert!(save_inner(&project.0, &bundle, &registry, &writes).is_err());
            assert!(!project.root().join("catalog.json").exists());
        }
    }

    #[test]
    fn changed_source_bytes_and_symlink_catalogs_never_load_as_saved_pixels() {
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        let saved = save_inner(&project.0, &fixture(100), &registry, &writes).unwrap();
        let id = saved["assets"][0]["metadata"]["assetId"].as_str().unwrap();
        let path = project.root().join(format!("{id}.json"));
        fs::write(path, b"{}").unwrap();
        assert!(load_inner(&project.0, &registry, &writes).is_err());
        #[cfg(unix)]
        {
            let other = Project::new();
            let other_writes = other.writes();
            fs::create_dir_all(other.root()).unwrap();
            std::os::unix::fs::symlink(
                project.root().join("catalog.json"),
                other.root().join("catalog.json"),
            )
            .unwrap();
            assert!(load_inner(&other.0, &registry, &other_writes).is_err());
        }
    }
    #[test]
    fn indexed_cels_roundtrip_and_reject_ambiguous_or_out_of_range_indices() {
        let source = json!({"format":"ferrum2d.pixel-document","version":10,"colorMode":"indexed","name":"Indices","width":2,"height":1,"colorSpace":"srgb",
            "palette":["#00000000","#ff0000ff","#0c223800","#0000ff80"],
            "layers":[{"id":"body","name":"Body","visible":true,"locked":false,"opacity":255,"blendMode":"normal"},
                {"id":"hidden","name":"Hidden","visible":false,"locked":true,"opacity":42,"blendMode":"screen"}],
            "frames":[{"id":"a","durationMs":93,"cels":[{"layerId":"body","indices":STANDARD.encode([1,2])},{"layerId":"hidden","indices":STANDARD.encode([3,1])}]},
                {"id":"b","durationMs":177,"cels":[{"layerId":"body","indices":STANDARD.encode([3,1])},{"layerId":"hidden","indices":STANDARD.encode([1,2])}]}],
            "tags":[{"id":"idle","name":"Idle","clipId":7,"frameIds":["b","a"],"loop":true,"direction":"pingpong"}],"initialTag":"idle","nextClipId":8});
        let pixels = [
            255, 0, 0, 255, 12, 34, 56, 0, 0, 0, 255, 128, 255, 0, 0, 255,
        ];
        let project = Project::new();
        let saved = save_inner(
            &project.0,
            &pixel_bundle(&source, &pixels, 4, 1),
            &PlacementAssetRegistry::default(),
            &project.writes(),
        )
        .unwrap();
        assert_eq!(
            load_inner(
                &project.0,
                &PlacementAssetRegistry::default(),
                &project.writes()
            )
            .unwrap(),
            saved
        );
        let id = saved["assets"][0]["metadata"]["assetId"].as_str().unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(
                &fs::read(project.root().join(format!("{id}.json"))).unwrap()
            )
            .unwrap(),
            source
        );
        for case in 0..12 {
            let mut bad = source.clone();
            match case {
                0 => bad["colorMode"] = json!("rgba"),
                1 => {
                    bad.as_object_mut().unwrap().remove("colorMode");
                }
                2 => bad["palette"] = json!([]),
                3 => bad["palette"][0] = json!("#ffffff00"),
                4 => bad["palette"][2] = json!("#FF0000FF"),
                5 => bad["frames"][0]["cels"][0]["indices"] = json!(STANDARD.encode([9, 2])),
                6 => bad["frames"][0]["cels"][0]["indices"] = json!(STANDARD.encode([1])),
                7 => bad["frames"][0]["cels"][0]["rgba"] = json!(STANDARD.encode([0; 8])),
                8 => bad["frames"][0]["cels"][0]["layerId"] = json!("other"),
                9 => {
                    bad["layers"][1]
                        .as_object_mut()
                        .unwrap()
                        .remove("blendMode");
                }
                10 => {
                    bad.as_object_mut().unwrap().remove("initialTag");
                }
                _ => bad["version"] = json!(9),
            }
            let project = Project::new();
            assert!(
                save_inner(
                    &project.0,
                    &pixel_bundle(&bad, &pixels, 4, 1),
                    &PlacementAssetRegistry::default(),
                    &project.writes()
                )
                .is_err(),
                "case {case}"
            );
            assert!(
                !project.root().exists(),
                "reject before writing case {case}"
            );
        }
        let mut floating_version = source;
        floating_version["version"] = json!(10.0);
        let project = Project::new();
        assert!(save_inner(
            &project.0,
            &pixel_bundle(&floating_version, &pixels, 4, 1),
            &PlacementAssetRegistry::default(),
            &project.writes()
        )
        .is_ok());
    }

    #[test]
    fn v9_blends_save_and_reopen_against_independent_golden_pixels() {
        let vectors: Vec<Value> = serde_json::from_str(include_str!(
            "../../../../../tests/smoke/pixel-blend-vectors.json"
        ))
        .unwrap();
        let bytes = |value: &Value| -> Vec<u8> {
            value
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_u64().unwrap() as u8)
                .collect()
        };
        for vector in vectors {
            for mode in ["normal", "multiply", "screen"] {
                let source = json!({"format":"ferrum2d.pixel-document","version":9,"name":"Blend","width":1,"height":1,"colorSpace":"srgb","palette":[],
                    "layers":[{"id":"base","name":"Base","visible":true,"locked":false,"opacity":255,"blendMode":"normal"},
                        {"id":"top","name":"Top","visible":true,"locked":false,"opacity":vector["opacity"],"blendMode":mode}],
                    "frames":[{"id":"f","durationMs":130,"cels":[{"layerId":"base","rgba":STANDARD.encode(bytes(&vector["bottom"]))},
                        {"layerId":"top","rgba":STANDARD.encode(bytes(&vector["top"]))}]}]});
                let expected = bytes(&vector["expected"][mode]);
                let project = Project::new();
                let saved = save_inner(
                    &project.0,
                    &pixel_bundle(&source, &expected, 1, 1),
                    &PlacementAssetRegistry::default(),
                    &project.writes(),
                )
                .unwrap();
                assert_eq!(
                    load_inner(
                        &project.0,
                        &PlacementAssetRegistry::default(),
                        &project.writes()
                    )
                    .unwrap(),
                    saved
                );
                let id = saved["assets"][0]["metadata"]["assetId"].as_str().unwrap();
                assert_eq!(
                    serde_json::from_slice::<Value>(
                        &fs::read(project.root().join(format!("{id}.json"))).unwrap()
                    )
                    .unwrap(),
                    source
                );
                let mut wrong = expected.clone();
                wrong[0] ^= 1;
                let rejected = Project::new();
                assert!(save_inner(
                    &rejected.0,
                    &pixel_bundle(&source, &wrong, 1, 1),
                    &PlacementAssetRegistry::default(),
                    &rejected.writes()
                )
                .is_err());
            }
        }
    }

    #[test]
    fn v9_blend_validation_and_capacity_preserve_source_contract() {
        let (mut source, pixels, width, height) = capacity_source(64, 1);
        source["version"] = json!(9);
        source["layers"][0]["opacity"] = json!(255);
        source["layers"][0]["blendMode"] = json!("screen");
        let project = Project::new();
        save_inner(
            &project.0,
            &pixel_bundle(&source, &pixels, width as u32, height as u32),
            &PlacementAssetRegistry::default(),
            &project.writes(),
        )
        .unwrap();
        for bad in [Value::Null, json!("overlay"), json!(0), json!({})] {
            let mut invalid_source = source.clone();
            invalid_source["layers"][0]["blendMode"] = bad;
            assert!(frame_atlas(&invalid_source, 1, 1)
                .unwrap_err()
                .to_string()
                .contains("blend"));
        }
        let mut missing = source.clone();
        missing["layers"][0]
            .as_object_mut()
            .unwrap()
            .remove("blendMode");
        assert!(frame_atlas(&missing, 1, 1)
            .unwrap_err()
            .to_string()
            .contains("blend"));
        missing = source.clone();
        missing["layers"][0]
            .as_object_mut()
            .unwrap()
            .remove("opacity");
        assert!(frame_atlas(&missing, 1, 1)
            .unwrap_err()
            .to_string()
            .contains("opacity"));
        for version in [1, 2, 3, 4, 5, 6, 7, 8] {
            assert!(layer_blend(&source["layers"][0], version).is_err());
        }
    }
}
