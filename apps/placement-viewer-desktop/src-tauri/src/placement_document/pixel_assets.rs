//! Native pixel sources use the shared immutable sprite transaction, independently of importers.
use super::sprite_assets::{array, hash, header, invalid, text, Contract, Dependency, Source};
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
    if result.trim().is_empty() || result.encode_utf16().count() > 64 {
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
fn validate_source(
    metadata: &Value,
    png: Vec<u8>,
    bytes: Vec<u8>,
    dependencies: Vec<Dependency>,
) -> CommandResult<Source> {
    if !dependencies.is_empty()
        || bytes.len() > 400_000
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
    header(&source, "ferrum2d.pixel-document")?;
    let width = bounded_integer(&source, "width", 1, 256)?;
    let height = bounded_integer(&source, "height", 1, 256)?;
    source_text(&source, "name")?;
    source_text(&source["layer"], "id")?;
    source_text(&source["layer"], "name")?;
    source_text(&source["frame"], "id")?;
    bounded_integer(&source["frame"], "durationMs", 1, 60_000)?;
    if source["colorSpace"] != "srgb"
        || metadata["width"].as_u64() != Some(width)
        || metadata["height"].as_u64() != Some(height)
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
    let encoded = source["rgba"]
        .as_str()
        .ok_or_else(|| invalid("missing pixel RGBA"))?;
    let count = (width * height * 4) as usize;
    if encoded.len() != count.div_ceil(3) * 4 {
        return Err(invalid("invalid pixel byte length"));
    }
    let pixels = STANDARD
        .decode(encoded)
        .map_err(|_| invalid("invalid pixel base64"))?;
    if pixels.len() != count || STANDARD.encode(&pixels) != encoded {
        return Err(invalid("invalid pixel RGBA encoding"));
    }
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
    Ok(Source {
        metadata: metadata.clone(),
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
