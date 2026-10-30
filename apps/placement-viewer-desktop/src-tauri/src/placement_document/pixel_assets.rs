//! Native pixel sources use the shared immutable sprite transaction, independently of importers.
use super::sprite_assets::{array, hash, invalid, text, Contract, Dependency, Source};
use super::{CommandResult, PlacementAssetRegistry, PlacementWriteRegistry};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{io::Cursor, path::Path};

const CONTRACT: Contract = Contract {
    directory: ".ferrum-pixels",
    prefix: "pixel.",
    bundle_format: "ferrum2d.pixel-project.assets",
    catalog_format: "ferrum2d.pixel.catalog",
    project_format: "ferrum2d.pixel.project",
    max_dependencies: 0,
    max_source_json: 3 * 1024 * 1024,
    max_source_png: 4 * 1024 * 1024,
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
    let result = text(value, key)?;
    // Match String.prototype.trim, including BOM and excluding Unicode NEL.
    let whitespace = |c| {
        matches!(c, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
    };
    if result.trim_matches(whitespace).is_empty() || result.encode_utf16().count() > 64 {
        return Err(invalid("invalid pixel source text"));
    }
    Ok(result)
}
fn complete_png(bytes: &[u8]) -> bool {
    if !bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return false;
    }
    let mut offset: usize = 8;
    while let Some(header) = bytes.get(offset..offset.saturating_add(8)) {
        let size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
        let Some(end) = offset
            .checked_add(size)
            .and_then(|v| v.checked_add(12))
            .filter(|v| *v <= bytes.len())
        else {
            return false;
        };
        let body = &bytes[offset + 8..end - 4];
        let kind = &header[4..8];
        if [b"iCCP", b"cICP", b"mDCv", b"cLLi"]
            .iter()
            .any(|name| kind == name.as_slice())
            || (kind == b"gAMA" && body != 45455_u32.to_be_bytes())
            || (kind == b"cHRM"
                && (body.len() != 32
                    || body
                        .chunks_exact(4)
                        .zip([31270_u32, 32900, 64000, 33000, 30000, 60000, 15000, 6000])
                        .any(|(bytes, value)| bytes != value.to_be_bytes())))
        {
            return false;
        }
        if &header[4..8] == b"IEND" {
            return size == 0 && end == bytes.len();
        }
        offset = end;
    }
    false
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
/// Integer straight-alpha source-over. Matches the TypeScript authoring composite.
fn composite_over(output: &mut [u8], input: &[u8]) {
    for (dst, src) in output.chunks_exact_mut(4).zip(input.chunks_exact(4)) {
        let alpha = u32::from(src[3]);
        if alpha == 0 {
            continue;
        }
        let previous = u32::from(dst[3]);
        let denominator = alpha * 255 + previous * (255 - alpha);
        for channel in 0..3 {
            let value = u32::from(src[channel]) * alpha * 255
                + u32::from(dst[channel]) * previous * (255 - alpha);
            dst[channel] = ((value + denominator / 2) / denominator) as u8;
        }
        dst[3] = ((denominator + 127) / 255) as u8;
    }
}

fn validate_source(
    metadata: &Value,
    png: Vec<u8>,
    bytes: Vec<u8>,
    dependencies: Vec<Dependency>,
) -> CommandResult<Source> {
    if !dependencies.is_empty()
        || bytes.len() > 3 * 1024 * 1024
        || png.len() > 4 * 1024 * 1024
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
    let version = bounded_integer(&source, "version", 1, 2)
        .map_err(|_| invalid("unsupported pixel document format or version"))?;
    if source["format"] != "ferrum2d.pixel-document" {
        return Err(invalid("unsupported pixel document format or version"));
    }
    if version == 1 && bytes.len() > 400_000 {
        return Err(invalid("pixel v1 source exceeds byte limit"));
    }
    let width = bounded_integer(&source, "width", 1, 256)?;
    let height = bounded_integer(&source, "height", 1, 256)?;
    source_text(&source, "name")?;
    source_text(&source["frame"], "id")?;
    bounded_integer(&source["frame"], "durationMs", 1, 60_000)?;
    if source["colorSpace"] != "srgb"
        || bounded_integer(metadata, "width", 1, 256)? != width
        || bounded_integer(metadata, "height", 1, 256)? != height
    {
        return Err(invalid("pixel dimensions or color space differ"));
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
    let pixels = if version == 1 {
        if source.get("layers").is_some() {
            return Err(invalid("invalid image layer version"));
        }
        source_text(&source["layer"], "id")?;
        source_text(&source["layer"], "name")?;
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
            let pixels = rgba_bytes(&layer["rgba"], count)?;
            if visible {
                if let Some(output) = composite.as_mut() {
                    composite_over(output, &pixels);
                } else {
                    composite = Some(pixels);
                }
            }
        }
        composite.unwrap_or_else(|| vec![0; count])
    };
    let identity = text(metadata, "identityDocument")?;
    let identity_bytes = serde_json::to_vec(&json!([identity, raw]))
        .map_err(|_| invalid("invalid pixel identity"))?;
    if text(metadata, "assetId")? != format!("pixel.{}", &hash(&identity_bytes)[..24]) {
        return Err(invalid("pixel revision identity differs"));
    }
    let mut decoder = png::Decoder::new(Cursor::new(&png));
    decoder.set_limits(png::Limits {
        bytes: 2 * 1024 * 1024,
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
mod tests {
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
    fn fixture(color: u8) -> Value {
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

    fn layered_bundle(source: &Value, pixels: &[u8]) -> Value {
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
            let mut encoder = png::Encoder::new(
                &mut png,
                source["width"].as_f64().unwrap() as u32,
                source["height"].as_f64().unwrap() as u32,
            );
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
            "revisions":[{"assetId":id,"identityDocument":identity,"width":source["width"],"height":source["height"],"jsonSha256":hash(&raw),"pngSha256":hash(&png)}],
            "manifest":{"textures":textures,"textureOptions":options},
            "files":[{"path":format!("{id}.png"),"mediaType":"image/png","sha256":hash(&png),"base64":STANDARD.encode(&png)},
                {"path":format!("{id}.json"),"mediaType":"application/json","sha256":hash(&raw),"base64":STANDARD.encode(&raw)}]})
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
}
