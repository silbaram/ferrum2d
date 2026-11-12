//! Aseprite source validation and native project persistence.
use super::sprite_assets::{array, hash, invalid, text, Source};
use super::{CommandResult, PlacementAssetRegistry, PlacementWriteRegistry};
#[cfg(test)]
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{collections::HashSet, io::Cursor, path::Path};
#[cfg(test)]
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
const DIRECTORY: &str = ".ferrum-aseprite";
const MAX_JSON: usize = 1024 * 1024;
const MAX_PNG: usize = 16 * 1024 * 1024;
#[cfg(test)]
static SERIAL: AtomicU64 = AtomicU64::new(0);
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 48
        && name.as_bytes()[0].is_ascii_alphanumeric()
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

fn file_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 256 && !name.contains(['/', '\\', '\0'])
}

pub(super) fn number(value: &Value, key: &str, max: u64) -> CommandResult<u64> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= max as f64)
        .map(|n| n as u64)
        .ok_or_else(|| invalid(format!("invalid bounded integer {key}")))
}

fn validate_source(
    metadata: &Value,
    png: Vec<u8>,
    bytes: Vec<u8>,
    dependencies: Vec<super::sprite_assets::Dependency>,
    source_png: Option<Vec<u8>>,
) -> CommandResult<Source> {
    let name = text(metadata, "logicalId")?;
    let identity = text(metadata, "identityDocument")?;
    let id = text(metadata, "assetId")?;
    if !safe_name(name)
        || !file_name(text(metadata, "jsonName")?)
        || !file_name(text(metadata, "pngName")?)
    {
        return Err(invalid("invalid source name"));
    }
    if png.len() > MAX_PNG
        || bytes.len() > MAX_JSON
        || text(metadata, "pngSha256")? != hash(&png)
        || text(metadata, "jsonSha256")? != hash(&bytes)
        || source_png.as_ref().is_some_and(|p| p.len() > MAX_PNG)
        || metadata.get("sourcePng").is_some() != source_png.is_some()
    {
        return Err(invalid("Aseprite source byte limit or SHA-256 mismatch"));
    }
    let original_png = source_png.as_deref().unwrap_or(&png);
    if let Some(original) = &source_png {
        if text(&metadata["sourcePng"], "sha256")? != hash(original) {
            return Err(invalid("source PNG SHA-256 differs"));
        }
    }
    let identity_bytes =
        serde_json::to_vec(&json!([identity, name, hash(&bytes), hash(original_png)]))
            .map_err(|_| invalid("invalid revision identity"))?;
    if id != format!("aseprite.{name}.{}", &hash(&identity_bytes)[..24]) {
        return Err(invalid("Aseprite revision identity differs"));
    }
    let source_text =
        std::str::from_utf8(&bytes).map_err(|_| invalid("source JSON is not UTF-8"))?;
    let source: Value = serde_json::from_str(source_text.trim_start_matches('\u{feff}'))
        .map_err(|_| invalid("invalid Aseprite JSON"))?;
    let width = number(metadata, "width", 4096)?;
    let height = number(metadata, "height", 4096)?;
    let sw = if source_png.is_some() {
        number(&metadata["sourcePng"], "width", 4096)?
    } else {
        width
    };
    let sh = if source_png.is_some() {
        number(&metadata["sourcePng"], "height", 4096)?
    } else {
        height
    };
    if width == 0
        || height == 0
        || width * height > 4_194_304
        || sw == 0
        || sh == 0
        || sw * sh > 4_194_304
        || source.pointer("/meta/size/w").and_then(Value::as_f64) != Some(sw as f64)
        || source.pointer("/meta/size/h").and_then(Value::as_f64) != Some(sh as f64)
        || source
            .pointer("/meta/image")
            .and_then(Value::as_str)
            .and_then(|s| s.rsplit(['/', '\\']).next())
            != Some(text(metadata, "pngName")?)
    {
        return Err(invalid(
            "Aseprite PNG dimensions or original filename differ",
        ));
    }
    if source_png.is_none() {
        let mut decoder = png::Decoder::new(Cursor::new(&png));
        decoder.set_limits(png::Limits {
            bytes: 40 * 1024 * 1024,
        });
        let mut reader = decoder
            .read_info()
            .map_err(|_| invalid("invalid PNG header"))?;
        if u64::from(reader.info().width) != width
            || u64::from(reader.info().height) != height
            || reader.output_buffer_size() > 32 * 1024 * 1024
        {
            return Err(invalid("decoded PNG dimensions differ"));
        }
        let mut pixels = vec![0; reader.output_buffer_size()];
        reader
            .next_frame(&mut pixels)
            .map_err(|_| invalid("PNG decode failed"))?;
    }
    let frames: Vec<(&str, &Value)> = match source.get("frames") {
        Some(Value::Object(values)) => values.iter().map(|(id, v)| (id.as_str(), v)).collect(),
        Some(Value::Array(values)) => values
            .iter()
            .map(|v| Ok((text(v, "filename")?, v)))
            .collect::<CommandResult<_>>()?,
        _ => return Err(invalid("invalid source frames")),
    };
    let evidence = array(metadata, "frames")?;
    if frames.is_empty() || frames.len() > 256 || evidence.len() != frames.len() {
        return Err(invalid("Aseprite requires 1–256 matching frames"));
    }
    let restored = source_png
        .as_ref()
        .map(|original| {
            super::aseprite_trim::validate(&frames, original, &png, (sw, sh), (width, height))
        })
        .transpose()?;
    let mut names = HashSet::new();
    for (name, frame) in frames {
        if name.is_empty()
            || name.encode_utf16().count() > 256
            || ["__proto__", "constructor", "prototype"].contains(&name)
            || !names.insert(name)
        {
            return Err(invalid("invalid or duplicate frame name"));
        }
        let (x, y, w, h) = if let Some(restored) = &restored {
            *restored
                .get(name)
                .ok_or_else(|| invalid("missing restored frame"))?
        } else {
            for flag in ["trimmed", "rotated"] {
                if frame
                    .get(flag)
                    .is_some_and(|value| value != &Value::Bool(false))
                {
                    return Err(invalid("trimmed/rotated frames are unsupported"));
                }
            }
            let rect = frame
                .get("frame")
                .ok_or_else(|| invalid("missing frame rect"))?;
            let x = number(rect, "x", width)?;
            let y = number(rect, "y", height)?;
            let w = number(rect, "w", width)?;
            let h = number(rect, "h", height)?;
            if w == 0 || h == 0 || x + w > width || y + h > height {
                return Err(invalid("frame is outside PNG"));
            }
            if let Some(size) = frame.get("sourceSize").filter(|v| !v.is_null()) {
                if number(size, "w", width)? != w || number(size, "h", height)? != h {
                    return Err(invalid("trimmed sourceSize is unsupported"));
                }
            }
            if let Some(size) = frame.get("spriteSourceSize").filter(|v| !v.is_null()) {
                if number(size, "x", 0)? != 0
                    || number(size, "y", 0)? != 0
                    || number(size, "w", width)? != w
                    || number(size, "h", height)? != h
                {
                    return Err(invalid("trimmed spriteSourceSize is unsupported"));
                }
            }
            (x, y, w, h)
        };
        let matches: Vec<_> = evidence
            .iter()
            .filter(|v| v.get("id").and_then(Value::as_str) == Some(name))
            .collect();
        if matches.len() != 1 {
            return Err(invalid("frame evidence identity differs"));
        }
        let found = matches[0];
        for (key, expected) in [("x", x), ("y", y), ("width", w), ("height", h)] {
            if number(found, key, 4096)? != expected {
                return Err(invalid("frame evidence rect differs"));
            }
        }
        for (key, expected) in [
            ("u0", x as f64 / width as f64),
            ("v0", y as f64 / height as f64),
            ("u1", (x + w) as f64 / width as f64),
            ("v1", (y + h) as f64 / height as f64),
        ] {
            let actual = found
                .get("uv")
                .and_then(|uv| uv.get(key))
                .and_then(Value::as_f64)
                .ok_or_else(|| invalid("missing frame UV"))?;
            if (actual - expected).abs() > 1e-12 {
                return Err(invalid("frame evidence UV differs"));
            }
        }
    }
    // Copy only the durable contract, never a caller-provided path or runtime URL.
    let mut canonical = serde_json::Map::new();
    for key in [
        "logicalId",
        "assetId",
        "identityDocument",
        "jsonName",
        "pngName",
        "jsonSha256",
        "pngSha256",
        "width",
        "height",
        "frames",
    ] {
        canonical.insert(key.to_owned(), metadata[key].clone());
    }
    if source_png.is_some() {
        canonical.insert(
            "sourcePng".to_owned(),
            json!({"sha256":hash(original_png),"width":sw,"height":sh}),
        );
        canonical.insert("width".to_owned(), json!(width));
        canonical.insert("height".to_owned(), json!(height));
        if let Some(restored) = &restored {
            canonical.insert("frames".to_owned(),json!(restored.iter().map(|(id,(x,y,w,h))|json!({"id":id,"x":x,"y":y,"width":w,"height":h,"uv":{"u0":*x as f64/width as f64,"v0":*y as f64/height as f64,"u1":(x+w) as f64/width as f64,"v1":(y+h) as f64/height as f64}})).collect::<Vec<_>>()));
        }
    }
    Ok(Source {
        metadata: Value::Object(canonical),
        png,
        json: bytes,
        dependencies,
        source_png,
    })
}

pub(super) const CONTRACT: super::sprite_assets::Contract = super::sprite_assets::Contract {
    check_catalog_revision: false,
    directory: DIRECTORY,
    prefix: "aseprite.",
    bundle_format: "ferrum2d.aseprite.assets",
    catalog_format: "ferrum2d.aseprite.catalog",
    project_format: "ferrum2d.aseprite.project",
    max_dependencies: 0,
    allow_source_png: true,
    max_source_json: MAX_JSON,
    max_source_png: MAX_PNG,
    validate: validate_source,
};
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
fn directory(project: &Path, create: bool) -> CommandResult<Option<PathBuf>> {
    super::sprite_assets::directory(&CONTRACT, project, create)
}
#[cfg(test)]
fn register(
    root: &Path,
    sources: &[Source],
    registry: &PlacementAssetRegistry,
    publish: impl FnOnce() -> CommandResult<()>,
) -> CommandResult<Value> {
    super::sprite_assets::register(&CONTRACT, root, sources, registry, publish)
}
#[cfg(test)]
pub(super) mod tests {
    use super::super::asset_files::{create_file, rollback};
    use super::*;
    use std::collections::HashMap;
    fn publish_catalog(
        project: &Path,
        root: &Path,
        temporary: &Path,
        expected: Option<&[u8]>,
    ) -> CommandResult<()> {
        super::super::asset_files::publish_catalog(project, DIRECTORY, root, temporary, expected)
    }

    /// Real storage/protocol functions over a test-only stdio transport for browser smoke.
    #[test]
    #[ignore = "requires the Aseprite project browser-smoke stdio client"]
    fn browser_bridge() {
        use std::io::BufRead;
        let assets = PlacementAssetRegistry::default();
        let writes = PlacementWriteRegistry::default();
        for line in std::io::stdin().lock().lines() {
            let line = line.expect("bridge input");
            let request: Value = serde_json::from_str(&line).expect("bridge request JSON");
            let args = &request["args"];
            let result: CommandResult<Value> = (|| match request["command"].as_str().unwrap_or("") {
                "load_placement_project_folder" => {
                    serde_json::to_value(super::super::load_placement_project_folder_inner(
                        text(args, "projectPath")?.to_owned(),
                        Some(&assets),
                        Some(&writes),
                    )?)
                    .map_err(|_| invalid("bridge project serialization"))
                }
                "load_placement_aseprite_assets" => {
                    load_inner(Path::new(text(args, "projectPath")?), &assets, &writes)
                }
                "load_placement_scene_document" => {
                    serde_json::to_value(super::super::load_placement_scene_document_inner(
                        Some(text(args, "sceneDocumentPath")?.to_owned()),
                        Some(&writes),
                    )?)
                    .map_err(|_| invalid("bridge scene serialization"))
                }
                "list_placement_project_scenes" => {
                    serde_json::to_value(super::super::scene_catalog::list_project_scenes(
                        Path::new(text(args, "projectPath")?),
                        &writes,
                    )?)
                    .map_err(|_| invalid("bridge scene catalog serialization"))
                }
                "inspect_placement_asset_folder" => {
                    let path =
                        super::super::parse_asset_folder_path(text(args, "assetFolderPath")?)?;
                    serde_json::to_value(super::super::inspect_asset_folder_path(
                        &path,
                        Some(&assets),
                    )?)
                    .map_err(|_| invalid("bridge asset folder serialization"))
                }
                "load_placement_pixel_assets" => super::super::pixel_assets::load_inner(
                    Path::new(text(args, "projectPath")?),
                    &assets,
                    &writes,
                ),
                "inspect_placement_asset_cleanup" => {
                    serde_json::to_value(super::super::asset_cleanup::inspect(
                        Path::new(text(args, "projectPath")?),
                        &writes,
                    )?)
                    .map_err(|_| invalid("bridge cleanup report serialization"))
                }
                "apply_placement_asset_cleanup" => {
                    serde_json::to_value(super::super::asset_cleanup::apply(
                        Path::new(text(args, "projectPath")?),
                        serde_json::from_value(args["request"].clone())
                            .map_err(|_| invalid("bridge cleanup request"))?,
                        &writes,
                    )?)
                    .map_err(|_| invalid("bridge cleanup result serialization"))
                }
                "list_placement_asset_cleanup_backups" => {
                    serde_json::to_value(super::super::asset_cleanup::list_backups(
                        Path::new(text(args, "projectPath")?),
                        &writes,
                    )?)
                    .map_err(|_| invalid("bridge cleanup backups serialization"))
                }
                "restore_placement_asset_cleanup" => {
                    serde_json::to_value(super::super::asset_cleanup::restore(
                        Path::new(text(args, "projectPath")?),
                        text(args, "backupId")?,
                        &writes,
                    )?)
                    .map_err(|_| invalid("bridge cleanup result serialization"))
                }
                "save_placement_pixel_assets" => super::super::pixel_assets::save_inner(
                    Path::new(text(args, "projectPath")?),
                    &args["bundle"],
                    &assets,
                    &writes,
                ),
                "load_placement_tile_assets" => super::super::tile_assets::load_inner(
                    Path::new(text(args, "projectPath")?),
                    &assets,
                    &writes,
                ),
                "save_placement_tile_assets" => super::super::tile_assets::save_inner(
                    Path::new(text(args, "projectPath")?),
                    &args["bundle"],
                    &assets,
                    &writes,
                ),
                "load_placement_normal_assets" => super::super::normal_assets::load_inner(
                    Path::new(text(args, "projectPath")?),
                    &assets,
                    &writes,
                ),
                "save_placement_normal_assets" => super::super::normal_assets::save_inner(
                    Path::new(text(args, "projectPath")?),
                    args["metadataJson"]
                        .as_str()
                        .ok_or_else(|| invalid("missing normal metadata JSON"))?,
                    array(args, "files")?,
                    &assets,
                    &writes,
                ),
                "save_placement_aseprite_assets" => save_inner(
                    Path::new(text(args, "projectPath")?),
                    &args["bundle"],
                    &assets,
                    &writes,
                ),
                "save_placement_scene_document" => {
                    serde_json::to_value(super::super::save_placement_scene_document_inner(
                        Some(text(args, "sceneDocumentPath")?.to_owned()),
                        args["document"].clone(),
                        args["expectedDocument"].clone(),
                        &writes,
                    )?)
                    .map_err(|_| invalid("bridge scene serialization"))
                }
                "save_placement_agent_handoff" => {
                    serde_json::to_value(super::super::save_placement_agent_handoff_inner(
                        Some(text(args, "projectPath")?.to_owned()),
                        None,
                        args["handoff"].clone(),
                        &writes,
                    )?)
                    .map_err(|_| invalid("bridge handoff serialization"))
                }
                "protocol" => {
                    let uri: http::Uri = text(args, "uri")?
                        .parse()
                        .map_err(|_| invalid("bridge URI"))?;
                    let response = match assets.asset_for_request(&uri) {
                        Ok(asset) => super::super::asset_response(&asset, true),
                        Err(status) => super::super::placement_asset_error_response(status),
                    };
                    Ok(
                        json!({"status":response.status().as_u16(),"mime":response.headers().get("content-type")
                            .and_then(|v|v.to_str().ok()).unwrap_or("application/octet-stream"),"base64":STANDARD.encode(response.body())}),
                    )
                }
                _ => Err(invalid("unsupported project smoke command")),
            })();
            let reply = match result {
                Ok(value) => json!({"id":request["id"],"result":value}),
                Err(error) => json!({"id":request["id"],"error":error.to_string()}),
            };
            println!("FERRUM_ASEPRITE_REPLY {reply}");
        }
    }

    struct Project(PathBuf);
    impl Project {
        fn new() -> Self {
            let id = SERIAL.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "ferrum-aseprite-project-{}-{id}",
                std::process::id()
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
        fn assets(&self) -> PathBuf {
            self.0.join("public/assets").join(DIRECTORY)
        }
    }
    impl Drop for Project {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    pub(in super::super) fn fixture(color: u8) -> Value {
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, 8, 4);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("PNG header");
            writer
                .write_image_data(&[color, 50, 180, 255].repeat(32))
                .expect("PNG pixels");
        }
        let raw = json!({"frames":{
            "idle.png":{"frame":{"x":0,"y":0,"w":4,"h":4},"rotated":false,"trimmed":false},
            "walk.png":{"frame":{"x":4,"y":0,"w":4,"h":4},"duration":100}
        },"meta":{"image":"hero.png","size":{"w":8,"h":4}}});
        let bytes = serde_json::to_vec(&raw).expect("JSON bytes");
        let json_hash = hash(&bytes);
        let png_hash = hash(&png);
        let identity = "original-document";
        let digest = hash(
            &serde_json::to_vec(&json!([identity, "hero", json_hash, png_hash])).expect("identity"),
        );
        let id = format!("aseprite.hero.{}", &digest[..24]);
        let frames = json!([
            {"id":"idle.png","x":0,"y":0,"width":4,"height":4,"uv":{"u0":0,"v0":0,"u1":0.5,"v1":1}},
            {"id":"walk.png","x":4,"y":0,"width":4,"height":4,"uv":{"u0":0.5,"v0":0,"u1":1,"v1":1}}
        ]);
        let textures = HashMap::from([(id.clone(), format!("{id}.png"))]);
        let options = HashMap::from([(id.clone(), json!({"colorSpace":"srgb"}))]);
        json!({"format":"ferrum2d.aseprite.assets","version":1,"overwrite":false,"document":identity,
            "revisions":[{"logicalId":"hero","assetId":id,"identityDocument":identity,"jsonName":"hero.json","pngName":"hero.png",
                "jsonSha256":json_hash,"pngSha256":png_hash,"width":8,"height":4,"frames":frames,"persisted":false}],
            "manifest":{"textures":textures,"textureOptions":options},
            "files":[{"path":format!("{id}.png"),"mediaType":"image/png","sha256":png_hash,"base64":STANDARD.encode(&png)},
                {"path":format!("{id}.json"),"mediaType":"application/json","sha256":json_hash,"base64":STANDARD.encode(&bytes)}]})
    }

    pub(in super::super) fn trim_fixture() -> Value {
        fn image(w: u32, h: u32, pixels: &[u8]) -> Vec<u8> {
            let mut data = Vec::new();
            {
                let mut encoder = png::Encoder::new(&mut data, w, h);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                encoder
                    .write_header()
                    .unwrap()
                    .write_image_data(pixels)
                    .unwrap();
            }
            data
        }
        let mut packed = [180, 50, 220, 255].repeat(32);
        packed[..4].copy_from_slice(&[91, 92, 93, 0]);
        let original = image(8, 4, &packed);
        let raw = json!({"frames":{
            "idle.png":{"frame":{"x":0,"y":0,"w":4,"h":4},"trimmed":true,"rotated":false,"sourceSize":{"w":6,"h":6},"spriteSourceSize":{"x":1,"y":1,"w":4,"h":4}},
            "walk.png":{"frame":{"x":4,"y":0,"w":4,"h":4},"trimmed":true,"sourceSize":{"w":6,"h":6},"spriteSourceSize":{"x":2,"y":0,"w":4,"h":4}}
        },"meta":{"image":"hero.png","size":{"w":8,"h":4}}});
        let json = serde_json::to_vec(&raw).unwrap();
        let jhash = hash(&json);
        let ohash = hash(&original);
        let id = format!(
            "aseprite.hero.{}",
            &hash(
                &serde_json::to_vec(&json!(["original-document", "hero", jhash, ohash])).unwrap()
            )[..24]
        );
        let mut pixels = vec![0; 6 * 12 * 4];
        for (index, (sx, ox, oy)) in [(0, 1, 1), (4, 2, 0)].into_iter().enumerate() {
            for y in 0..4 {
                for x in 0..4 {
                    let from = (y * 8 + sx + x) * 4;
                    let to = ((index * 6 + oy + y) * 6 + ox + x) * 4;
                    pixels[to..to + 4].copy_from_slice(&packed[from..from + 4]);
                }
            }
        }
        let png = image(6, 12, &pixels);
        let phash = hash(&png);
        let frames = json!([
            {"id":"idle.png","x":0,"y":0,"width":6,"height":6,"uv":{"u0":0,"v0":0,"u1":1,"v1":0.5}},
            {"id":"walk.png","x":0,"y":6,"width":6,"height":6,"uv":{"u0":0,"v0":0.5,"u1":1,"v1":1}}
        ]);
        json!({"format":"ferrum2d.aseprite.assets","version":1,"overwrite":false,"document":"original-document",
            "revisions":[{"logicalId":"hero","assetId":id,"identityDocument":"original-document","jsonName":"hero.json","pngName":"hero.png","jsonSha256":jhash,"pngSha256":phash,"width":6,"height":12,"frames":frames,"sourcePng":{"sha256":ohash,"width":8,"height":4}}],
            "manifest":{"textures":{id.clone():format!("{id}.png")},"textureOptions":{id.clone():{"colorSpace":"srgb"}}},
            "files":[{"path":format!("{id}.png"),"mediaType":"image/png","sha256":phash,"base64":STANDARD.encode(png)},
                {"path":format!("{id}.json"),"mediaType":"application/json","sha256":jhash,"base64":STANDARD.encode(json)},
                {"path":format!("{id}.source.png"),"mediaType":"image/png","sha256":ohash,"base64":STANDARD.encode(original)}]})
    }

    #[test]
    fn trim_sources_save_reopen_and_register_original_png_without_losing_identity() {
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        let bundle = trim_fixture();
        let response = save_inner(&project.0, &bundle, &registry, &writes).unwrap();
        let id = bundle["revisions"][0]["assetId"].as_str().unwrap();
        assert_eq!(
            hash(&fs::read(project.assets().join(format!("{id}.source.png"))).unwrap()),
            bundle["revisions"][0]["sourcePng"]["sha256"]
        );
        save_inner(&project.0, &bundle, &registry, &writes).unwrap();
        let fresh = PlacementAssetRegistry::default();
        assert_eq!(load_inner(&project.0, &fresh, &writes).unwrap(), response);
        let uri = response["assets"][0]["sourcePngUrl"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        let asset = fresh.asset_for_request(&uri).unwrap();
        let reply = super::super::asset_response(&asset, true);
        assert_eq!(reply.status(), http::StatusCode::OK);
        assert_eq!(
            hash(reply.body()),
            bundle["revisions"][0]["sourcePng"]["sha256"]
        );
        fs::write(
            project.assets().join(format!("{id}.source.png")),
            b"tampered",
        )
        .unwrap();
        assert!(load_inner(&project.0, &fresh, &writes).is_err());
    }

    #[test]
    fn trim_source_metadata_is_canonical_before_immutable_retry() {
        let project = Project::new();
        let writes = project.writes();
        let assets = PlacementAssetRegistry::default();
        let mut bundle = trim_fixture();
        bundle["revisions"][0]["sourcePng"]["note"] = json!("unsupported");
        bundle["revisions"][0]["sourcePng"]["width"] = json!(8.0);
        bundle["revisions"][0]["frames"]
            .as_array_mut()
            .unwrap()
            .reverse();
        bundle["revisions"][0]["frames"][0]["x"] = json!(0.0);
        bundle["revisions"][0]["frames"][0]["uv"]["u0"] = json!(1e-13);
        bundle["revisions"][0]["frames"][0]["note"] = json!("unsupported");
        let saved = save_inner(&project.0, &bundle, &assets, &writes).unwrap();
        assert_eq!(
            saved["assets"][0]["metadata"]["sourcePng"]
                .as_object()
                .unwrap()
                .len(),
            3
        );
        bundle = trim_fixture();
        assert_eq!(
            save_inner(&project.0, &bundle, &assets, &writes).unwrap(),
            saved
        );
    }

    #[test]
    fn trim_native_rejects_png_envelopes_the_browser_cannot_reopen() {
        let bundle = trim_fixture();
        let raw = STANDARD
            .decode(bundle["files"][1]["base64"].as_str().unwrap())
            .unwrap();
        let json: Value = serde_json::from_slice(&raw).unwrap();
        let frames = json["frames"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(id, v)| (id.as_str(), v))
            .collect::<Vec<_>>();
        let source = STANDARD
            .decode(bundle["files"][2]["base64"].as_str().unwrap())
            .unwrap();
        let runtime = STANDARD
            .decode(bundle["files"][0]["base64"].as_str().unwrap())
            .unwrap();
        let mut trailing = source.clone();
        trailing.push(0);
        assert!(super::super::aseprite_trim::validate(
            &frames,
            &trailing,
            &runtime,
            (8, 4),
            (6, 12)
        )
        .unwrap_err()
        .to_string()
        .contains("sRGB layout"));
        let mut trailing_runtime = runtime.clone();
        trailing_runtime.push(0);
        assert!(super::super::aseprite_trim::validate(
            &frames,
            &source,
            &trailing_runtime,
            (8, 4),
            (6, 12)
        )
        .unwrap_err()
        .to_string()
        .contains("sRGB layout"));
        let mut gamma = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut gamma, 8, 4);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_source_gamma(png::ScaledFloat::new(1.0));
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[180, 50, 220, 255].repeat(32))
                .unwrap();
        }
        assert!(
            super::super::aseprite_trim::validate(&frames, &gamma, &runtime, (8, 4), (6, 12))
                .unwrap_err()
                .to_string()
                .contains("sRGB layout")
        );
    }

    #[test]
    fn trim_source_mismatches_are_rejected_before_any_catalog_is_published() {
        for change in 0..5 {
            let project = Project::new();
            let mut bundle = trim_fixture();
            match change {
                0 => {
                    bundle["files"].as_array_mut().unwrap().pop();
                }
                1 => bundle["revisions"][0]["sourcePng"]["sha256"] = json!("0".repeat(64)),
                2 => bundle["revisions"][0]["frames"][0]["uv"]["u1"] = json!(0.5),
                3 => bundle["revisions"][0]["width"] = json!(12),
                _ => bundle["revisions"][0]["sourcePng"] = Value::Null,
            }
            assert!(save_inner(
                &project.0,
                &bundle,
                &PlacementAssetRegistry::default(),
                &project.writes()
            )
            .is_err());
            assert!(!project.assets().join("catalog.json").exists());
        }
        let bundle = trim_fixture();
        let metadata = &bundle["revisions"][0];
        let original = STANDARD
            .decode(bundle["files"][2]["base64"].as_str().unwrap())
            .unwrap();
        let bytes = STANDARD
            .decode(bundle["files"][1]["base64"].as_str().unwrap())
            .unwrap();
        let mut altered = vec![0; 6 * 12 * 4];
        altered[..4].copy_from_slice(&[1, 2, 3, 255]);
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, 6, 12);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&altered)
                .unwrap();
        }
        let mut next = metadata.clone();
        next["pngSha256"] = json!(hash(&png));
        assert!(
            validate_source(&next, png, bytes, Vec::new(), Some(original))
                .unwrap_err()
                .to_string()
                .contains("restored PNG differs")
        );
    }

    #[test]
    fn saves_reopens_sources_frames_and_revision_urls_without_overwriting() {
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        let bundle = fixture(180);
        let response = save_inner(&project.0, &bundle, &registry, &writes).expect("save");
        let catalog = fs::read(project.assets().join("catalog.json")).expect("catalog bytes");
        let id = bundle["revisions"][0]["assetId"].as_str().expect("id");
        let path = project.assets().join(format!("{id}.png"));
        let before = fs::metadata(&path).expect("source stat");
        save_inner(&project.0, &bundle, &registry, &writes).expect("idempotent save");
        assert_eq!(
            fs::read(project.assets().join("catalog.json")).expect("catalog"),
            catalog
        );
        assert_eq!(
            fs::metadata(&path)
                .expect("stat")
                .modified()
                .expect("modified"),
            before.modified().expect("modified")
        );
        let fresh = PlacementAssetRegistry::default();
        assert_eq!(
            load_inner(&project.0, &fresh, &project.writes()).expect("fresh reopen"),
            response
        );
        let uri: http::Uri = response["assets"][0]["jsonUrl"]
            .as_str()
            .expect("source URL")
            .parse()
            .expect("URI");
        let asset = fresh
            .asset_for_request(&uri)
            .expect("registered immutable source");
        let read = super::super::asset_response(&asset, true);
        assert_eq!(read.status(), http::StatusCode::OK);
        assert_eq!(hash(read.body()), bundle["revisions"][0]["jsonSha256"]);
        fs::write(&path, b"external corruption").expect("tamper");
        assert!(load_inner(&project.0, &fresh, &writes).is_err());
        assert_eq!(
            fs::read(project.assets().join("catalog.json")).expect("catalog"),
            catalog
        );
    }

    #[test]
    fn newer_revisions_keep_previous_sources_and_frames() {
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        let old = save_inner(&project.0, &fixture(100), &registry, &writes).expect("first");
        let next = save_inner(&project.0, &fixture(200), &registry, &writes).expect("second");
        assert_eq!(next["assets"].as_array().expect("assets").len(), 2);
        assert_eq!(old["assets"][0], next["assets"][0]);
        assert_ne!(
            next["assets"][0]["metadata"]["assetId"],
            next["assets"][1]["metadata"]["assetId"]
        );
    }

    #[test]
    fn legacy_bundle_identity_is_reconstructed_from_document() {
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        let mut legacy = fixture(120);
        legacy["revisions"][0]
            .as_object_mut()
            .expect("metadata")
            .remove("identityDocument");
        let response = save_inner(&project.0, &legacy, &registry, &writes).expect("legacy export");
        assert_eq!(
            response["assets"][0]["metadata"]["identityDocument"],
            "original-document"
        );
    }

    #[test]
    fn rejects_invalid_inputs_before_creating_any_asset_files() {
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        for kind in 0..8 {
            let mut bad = fixture(100);
            match kind {
                0 => bad["files"][0]["base64"] = json!("invalid-base64"),
                1 => bad["revisions"][0]["assetId"] = json!("../../outside"),
                2 => bad["revisions"][0]["pngSha256"] = json!("bad hash"),
                3 => bad["revisions"][0]["frames"][0]["uv"]["u1"] = json!(0.75),
                4 => bad["revisions"][0]["width"] = json!(4097),
                5 => {
                    bad["manifest"]["textureOptions"]
                        .as_object_mut()
                        .expect("options")
                        .values_mut()
                        .next()
                        .expect("option")["colorSpace"] = json!("none")
                }
                6 => bad["files"][1] = bad["files"][0].clone(),
                _ => bad["overwrite"] = json!(true),
            }
            assert!(
                save_inner(&project.0, &bad, &registry, &writes).is_err(),
                "case {kind}"
            );
            assert!(!project.assets().exists());
        }
    }

    #[test]
    fn rejects_unopened_projects_and_project_catalog_quota() {
        let project = Project::new();
        let registry = PlacementAssetRegistry::default();
        assert!(save_inner(
            &project.0,
            &fixture(80),
            &registry,
            &PlacementWriteRegistry::default()
        )
        .is_err());
        assert!(!project.assets().exists());
        let scene_writes = PlacementWriteRegistry::default();
        let scene_path = project.0.join("public/scene-authoring.json");
        fs::write(&scene_path, b"{}").expect("scene path");
        scene_writes
            .authorize_scene_document(&scene_path)
            .expect("opened scene");
        assert!(save_inner(&project.0, &fixture(80), &registry, &scene_writes).is_err());
        assert!(!project.assets().exists());
        let writes = project.writes();
        for i in 0..8 {
            save_inner(&project.0, &fixture(i), &registry, &writes).expect("within quota");
        }
        let before = fs::read(project.assets().join("catalog.json")).expect("catalog");
        assert!(save_inner(&project.0, &fixture(20), &registry, &writes).is_err());
        assert_eq!(
            fs::read(project.assets().join("catalog.json")).expect("catalog"),
            before
        );
    }

    #[test]
    fn partial_install_preserves_competing_file_and_rolls_back_owned_png() {
        let project = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        let root = directory(&project.0, true)
            .expect("directory")
            .expect("root");
        let bundle = fixture(130);
        let id = bundle["revisions"][0]["assetId"].as_str().expect("id");
        let conflict = root.join(format!("{id}.json"));
        fs::write(&conflict, b"competing source").expect("conflict");
        assert!(save_inner(&project.0, &bundle, &registry, &writes).is_err());
        assert_eq!(
            fs::read(&conflict).expect("competing bytes"),
            b"competing source"
        );
        #[cfg(unix)]
        assert!(!root.join(format!("{id}.png")).exists());
        assert!(!root.join("catalog.json").exists());
        assert!(registry.assets.lock().expect("registry").is_empty());
    }

    #[test]
    fn publication_preserves_external_catalog_and_does_not_publish_registry() {
        let project = Project::new();
        let root = directory(&project.0, true)
            .expect("directory")
            .expect("root");
        let temp = root.join("temporary");
        fs::write(&temp, b"new").expect("temporary");
        fs::write(root.join("catalog.json"), b"external").expect("external");
        assert!(publish_catalog(&project.0, &root, &temp, None).is_err());
        assert_eq!(
            fs::read(root.join("catalog.json")).expect("catalog"),
            b"external"
        );
        let registry = PlacementAssetRegistry::default();
        assert!(register(&root, &[], &registry, || Err(invalid("publication failed"))).is_err());
        assert!(registry.assets.lock().expect("registry").is_empty());
    }

    #[test]
    fn rollback_preserves_bytes_changed_in_place_by_an_external_writer() {
        let project = Project::new();
        let path = project.0.join("prepared.png");
        let mut owned = Vec::new();
        create_file(&path, b"owned bytes", &mut owned).expect("prepare");
        fs::write(&path, b"external edit in same inode").expect("external write");
        rollback(owned);
        assert_eq!(
            fs::read(path).expect("external source"),
            b"external edit in same inode"
        );
    }

    #[test]
    #[cfg(unix)]
    fn rejects_directory_catalog_and_source_symlinks() {
        use std::os::unix::fs::symlink;
        let project = Project::new();
        let outside = Project::new();
        let writes = project.writes();
        let registry = PlacementAssetRegistry::default();
        symlink(&outside.0, project.0.join("public/assets")).expect("assets link");
        assert!(save_inner(&project.0, &fixture(20), &registry, &writes).is_err());
        assert!(fs::read_dir(&outside.0)
            .expect("outside")
            .all(|e| e.expect("entry").file_name() == "public"));
        fs::remove_file(project.0.join("public/assets")).expect("unlink");
        let root = directory(&project.0, true)
            .expect("directory")
            .expect("root");
        let target = outside.0.join("catalog.json");
        fs::write(&target, b"external").expect("target");
        symlink(&target, root.join("catalog.json")).expect("catalog link");
        assert!(save_inner(&project.0, &fixture(20), &registry, &writes).is_err());
        fs::remove_file(root.join("catalog.json")).expect("unlink");
        let bundle = fixture(20);
        let id = bundle["revisions"][0]["assetId"].as_str().expect("id");
        symlink(&target, root.join(format!("{id}.png"))).expect("source link");
        assert!(save_inner(&project.0, &bundle, &registry, &writes).is_err());
        assert_eq!(fs::read(target).expect("outside bytes"), b"external");
    }
}
