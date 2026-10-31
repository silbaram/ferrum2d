//! Durable color/normal pairs with original ordered provenance JSON.
use super::{
    asset_files, placement_asset_revision, placement_runtime_asset_url, CommandResult,
    PlacementAssetRegistry, PlacementDesktopError, PlacementWriteRegistry,
    RegisteredPlacementAsset, MAX_REGISTERED_ASSET_REVISIONS,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

const DIRECTORY: &str = ".ferrum-normals";
const FORMAT: &str = "ferrum2d.sprite-normal.catalog";
const MAX_METADATA: usize = 4 * 1024 * 1024;
const MAX_PNG: usize = 16 * 1024 * 1024;
const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_PAIRS: usize = 8;
const MAX_PIXELS: u64 = 8_388_608;
static SERIAL: AtomicU64 = AtomicU64::new(0);
fn invalid(detail: &str) -> PlacementDesktopError {
    PlacementDesktopError::InvalidAssetFolderPath(detail.to_owned())
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn text<'a>(v: &'a Value, key: &str) -> CommandResult<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.trim() == *s && s.len() <= 4096)
        .ok_or_else(|| invalid("invalid normal asset text"))
}
fn array<'a>(v: &'a Value, key: &str) -> CommandResult<&'a [Value]> {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| invalid("invalid normal asset array"))
}
fn integer(v: &Value, key: &str, min: u64, max: u64) -> CommandResult<u64> {
    v.get(key)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= min as f64 && *n <= max as f64)
        .map(|n| n as u64)
        .ok_or_else(|| invalid("normal asset integer out of range"))
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}
fn header(v: &Value, format: &str) -> CommandResult<()> {
    if v["format"] != format || v["version"] != 1 {
        return Err(invalid("unsupported normal asset format"));
    }
    Ok(())
}
fn uv(v: &Value, width: u64, height: u64) -> CommandResult<[f64; 4]> {
    let mut values = [0.0; 4];
    for (i, key) in ["u0", "v0", "u1", "v1"].iter().enumerate() {
        values[i] = v
            .get(key)
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite() && (0.0..=1.0).contains(n))
            .ok_or_else(|| invalid("invalid normal frame UV"))?;
        let extent = if i % 2 == 0 { width } else { height } as f64;
        if (values[i] * extent - (values[i] * extent).round()).abs() > 1e-4 {
            return Err(invalid("normal UV must align with pixels"));
        }
    }
    if values[0] as f32 >= values[2] as f32 || values[1] as f32 >= values[3] as f32 {
        return Err(invalid("empty normal frame UV"));
    }
    Ok(values)
}
fn validate_binding(binding: &Value) -> CommandResult<(u64, u64)> {
    header(binding, "ferrum2d.sprite-normal.binding")?;
    let width = integer(binding, "width", 1, 4096)?;
    let height = integer(binding, "height", 1, 4096)?;
    if width * height > 4_194_304 {
        return Err(invalid("normal dimensions exceed 4 MP"));
    }
    let frames = array(binding, "frames")?;
    if frames.is_empty() || frames.len() > 32 {
        return Err(invalid("normal binding requires 1..32 frames"));
    }
    let frames = frames
        .iter()
        .map(|f| uv(f, width, height))
        .collect::<CommandResult<Vec<_>>>()?;
    let generation = &binding["generation"];
    let revision = text(generation, "revision")?;
    if revision.len() != 40
        || !revision
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || !generation["settings"].is_object()
    {
        return Err(invalid("invalid normal generation identity"));
    }
    text(generation, "repository")?;
    text(&generation["input"], "path")?;
    for value in [
        &generation["binarySha256"],
        &generation["configSha256"],
        &generation["input"]["sha256"],
    ] {
        if !value.as_str().is_some_and(digest) {
            return Err(invalid("invalid generation SHA-256"));
        }
    }
    if let Some(animation) = binding.get("animationSet") {
        let clips = array(animation, "clips")?;
        if clips.is_empty() || clips.len() > 64 {
            return Err(invalid("invalid normal animation clip count"));
        }
        let mut ids = HashSet::new();
        for clip in clips {
            if !ids.insert(integer(clip, "id", 0, 65535)?) {
                return Err(invalid("duplicate normal animation ID"));
            }
            let fps = clip["fps"]
                .as_f64()
                .ok_or_else(|| invalid("missing animation FPS"))?;
            if !(0.001..=1000.0).contains(&fps)
                || !(0.001..=1000.0).contains(&(fps as f32))
                || clip.get("loop").is_some_and(|v| !v.is_boolean())
            {
                return Err(invalid("invalid animation FPS/loop"));
            }
            let values = array(clip, "frames")?;
            if values.is_empty() || values.len() > 32 {
                return Err(invalid("invalid animation frame count"));
            }
            for value in values {
                if !frames.contains(&uv(value, width, height)?) {
                    return Err(invalid("animation UV differs from binding layout"));
                }
            }
        }
        let initial = if animation.get("initialClip").is_some() {
            integer(animation, "initialClip", 0, 65535)?
        } else {
            integer(&clips[0], "id", 0, 65535)?
        };
        if !ids.contains(&initial) {
            return Err(invalid("unknown initial normal clip"));
        }
    }
    Ok((width, height))
}

#[derive(Debug)]
struct Pair {
    metadata: Vec<u8>,
    value: Value,
    pngs: Vec<Vec<u8>>,
    width: u64,
    height: u64,
}
impl Pair {
    fn id(&self) -> String {
        hash(&self.metadata)
    }
    fn binding(&self) -> &Value {
        &self.value["binding"]
    }
}
fn png_info(bytes: &[u8], width: u64, height: u64) -> CommandResult<()> {
    if bytes.len() > MAX_PNG {
        return Err(invalid("normal PNG exceeds 16 MiB"));
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: 40 * 1024 * 1024,
    });
    let mut reader = decoder
        .read_info()
        .map_err(|_| invalid("invalid normal PNG"))?;
    if u64::from(reader.info().width) != width
        || u64::from(reader.info().height) != height
        || reader.output_buffer_size() > 32 * 1024 * 1024
    {
        return Err(invalid("decoded normal PNG dimensions differ"));
    }
    let mut pixels = vec![0; reader.output_buffer_size()];
    reader
        .next_frame(&mut pixels)
        .map_err(|_| invalid("normal PNG decode failed"))?;
    Ok(())
}
fn pair(metadata: Vec<u8>, pngs: Vec<Vec<u8>>) -> CommandResult<Pair> {
    if metadata.len() > MAX_METADATA || pngs.len() != 2 {
        return Err(invalid("normal metadata budget exceeded"));
    }
    let value: Value =
        serde_json::from_slice(&metadata).map_err(|_| invalid("invalid normal metadata JSON"))?;
    header(&value, "ferrum2d.sprite-normal.assets")?;
    if value["overwrite"] != false || !array(&value, "files")?.is_empty() {
        return Err(invalid(
            "normal metadata must omit file payloads and use overwrite:false",
        ));
    }
    text(&value, "document")?;
    let binding = &value["binding"];
    let (width, height) = validate_binding(binding)?;
    let mut ids = HashSet::new();
    for (index, kind) in ["color", "normal"].iter().enumerate() {
        let texture = &binding["textures"][kind];
        let id = text(texture, "asset")?;
        let space = if index == 0 { "srgb" } else { "none" };
        if !safe_id(id)
            || !ids.insert(id)
            || texture["colorSpace"] != space
            || !digest(text(texture, "sha256")?)
            || text(texture, "sha256")? != hash(&pngs[index])
        {
            return Err(invalid("normal texture identity/hash/color space differs"));
        }
        text(texture, "path")?;
        if value["manifest"]["textures"][id] != format!("{id}.png")
            || value["manifest"]["textureOptions"][id]["colorSpace"] != space
        {
            return Err(invalid("normal manifest differs"));
        }
        png_info(&pngs[index], width, height)?;
    }
    let report = &value["report"];
    let raw_metadata = value["metadataJson"]
        .as_str()
        .filter(|s| s.len() <= MAX_METADATA)
        .ok_or_else(|| invalid("invalid generator metadata JSON"))?;
    let parsed: Value = serde_json::from_str(raw_metadata)
        .map_err(|_| invalid("invalid generator metadata JSON"))?;
    // Worker metadataJson is the raw upstream report input, whereas Aseprite uses its aggregate report.
    if report["format"] == "ferrum2d.aseprite-normal.report"
        || report["format"] == "ferrum2d.pixel-normal.report"
    {
        if parsed != *report
            || report["version"] != 1
            || report["pipeline"]
                != if report["format"] == "ferrum2d.pixel-normal.report" {
                    "pixel-rects-v1"
                } else {
                    "aseprite-rects-v1"
                }
            || report["source"]["pngSha256"] != binding["textures"]["color"]["sha256"]
            || report["output"]["sha256"] != binding["textures"]["normal"]["sha256"]
            || report["output"]["width"] != width
            || report["output"]["height"] != height
            || !report["frames"].is_array()
        {
            return Err(invalid("Frame normal provenance differs"));
        }
        if report["format"] == "ferrum2d.pixel-normal.report" {
            validate_pixel_report(report, binding, width, height)?;
        }
    } else {
        header(report, "ferrum2d.sprite-normals.report")?;
        if report["ok"] != true
            || report["normalFormat"] != "opengl"
            || report["colorSpace"] != "none"
        {
            return Err(invalid("incomplete normal generation report"));
        }
        for key in ["repository", "revision", "binarySha256"] {
            if report["generator"][key] != binding["generation"][key] {
                return Err(invalid("normal generator identity differs"));
            }
        }
        let results = array(report, "results")?;
        let result = results
            .first()
            .ok_or_else(|| invalid("missing normal generation result"))?;
        if result["input"]["path"] != binding["generation"]["input"]["path"]
            || result["input"]["sha256"] != binding["generation"]["input"]["sha256"]
            || report["settings"] != binding["generation"]["settings"]
            || report.get("animation") != binding["generation"].get("animation")
        {
            return Err(invalid("normal input/settings provenance differs"));
        }
        let outputs = array(result, "outputs")?;
        let output_hash = |path: &Value| -> CommandResult<&Value> {
            let found = outputs
                .iter()
                .filter(|output| &output["path"] == path)
                .collect::<Vec<_>>();
            if found.len() != 1 {
                return Err(invalid("missing or duplicate normal output"));
            }
            Ok(&found[0]["sha256"])
        };
        if let Some(animation) = result.get("ferrumAnimation") {
            let descriptor = &value["descriptor"];
            header(descriptor, "ferrum2d.sprite-normal.animation")?;
            if descriptor["animationSet"] != binding["animationSet"]
                || descriptor["atlas"]["width"] != width
                || descriptor["atlas"]["height"] != height
                || output_hash(&animation["color"])? != &binding["textures"]["color"]["sha256"]
                || output_hash(&animation["normal"])? != &binding["textures"]["normal"]["sha256"]
                || output_hash(&animation["descriptor"])?
                    != &binding["generation"]["descriptorSha256"]
            {
                return Err(invalid("normal animation descriptor differs"));
            }
        } else if result["width"] != width
            || result["height"] != height
            || result["color"] != binding["textures"]["color"]["path"]
            || result["normal"] != binding["textures"]["normal"]["path"]
            || result["input"]["sha256"] != binding["textures"]["color"]["sha256"]
            || output_hash(&result["normal"])? != &binding["textures"]["normal"]["sha256"]
            || binding.get("animationSet").is_some()
            || value.get("descriptor").is_some()
        {
            return Err(invalid("static normal output differs"));
        }
    }
    if report["config"]["sha256"] != binding["generation"]["configSha256"] {
        return Err(invalid("normal config provenance differs"));
    }
    Ok(Pair {
        metadata,
        value,
        pngs,
        width,
        height,
    })
}
fn validate_pixel_report(
    report: &Value,
    binding: &Value,
    width: u64,
    height: u64,
) -> CommandResult<()> {
    let source = &report["source"];
    let id = text(source, "assetId")?;
    if !id.starts_with("pixel.")
        || id.len() != 30
        || !id[6..]
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        || !digest(text(source, "jsonSha256")?)
        || source["assetId"] != binding["textures"]["color"]["asset"]
        || source["pngSha256"] != binding["generation"]["input"]["sha256"]
        || source["jsonSha256"] != binding["generation"]["settings"]["jsonSha256"]
        || binding["generation"]["settings"]["pipeline"] != "pixel-rects-v1"
    {
        return Err(invalid("pixel normal source differs"));
    }
    let frames = array(report, "frames")?;
    if frames.is_empty() || frames.len() > 256 {
        return Err(invalid("invalid pixel normal frame count"));
    }
    let mut ids = HashSet::new();
    let mut rectangles: Vec<[u64; 4]> = Vec::new();
    for frame in frames {
        let id = text(frame, "id")?;
        if id.trim().is_empty() || id.encode_utf16().count() > 64 || !ids.insert(id) {
            return Err(invalid("invalid pixel normal frame ID"));
        }
        let rect = array(frame, "rect")?;
        if rect.len() != 4 {
            return Err(invalid("invalid pixel normal rect"));
        }
        let mut values = [0; 4];
        for (index, value) in rect.iter().enumerate() {
            values[index] = value
                .as_f64()
                .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= 4096.0)
                .map(|n| n as u64)
                .ok_or_else(|| invalid("invalid pixel normal rect"))?;
        }
        let [x, y, w, h] = values;
        if w == 0
            || h == 0
            || x > width
            || y > height
            || w > width - x
            || h > height - y
            || rectangles
                .iter()
                .any(|r| x < r[0] + r[2] && r[0] < x + w && y < r[1] + r[3] && r[1] < y + h)
        {
            return Err(invalid("pixel normal rect out of bounds or overlapping"));
        }
        rectangles.push(values);
        let generated = &frame["report"];
        if generated["ok"] != true
            || generated["format"] != "ferrum2d.sprite-normals.report"
            || generated["normalFormat"] != "opengl"
            || generated["colorSpace"] != "none"
        {
            return Err(invalid("invalid pixel frame generator report"));
        }
        for key in ["repository", "revision", "binarySha256"] {
            if generated["generator"][key] != binding["generation"][key] {
                return Err(invalid("pixel frame generator differs"));
            }
        }
    }
    Ok(())
}

fn validate_pixel_source(project: &Path, pair: &Pair) -> CommandResult<()> {
    let report = &pair.value["report"];
    if report["format"] != "ferrum2d.pixel-normal.report" {
        return Ok(());
    }
    let id = text(&report["source"], "assetId")?;
    let root = asset_files::directory(project, ".ferrum-pixels", false)?
        .ok_or_else(|| invalid("save pixel sources before normals"))?;
    let bytes = asset_files::bounded_read(&root.join(format!("{id}.json")), 12 * 1024 * 1024)?;
    if hash(&bytes) != text(&report["source"], "jsonSha256")? {
        return Err(invalid("pixel source hash differs from normals"));
    }
    let color = asset_files::bounded_read(&root.join(format!("{id}.png")), 8 * 1024 * 1024)?;
    if hash(&color) != text(&report["source"], "pngSha256")? {
        return Err(invalid("pixel source PNG differs from normals"));
    }
    let source: Value =
        serde_json::from_slice(&bytes).map_err(|_| invalid("invalid pixel source JSON"))?;
    let width = integer(&source, "width", 1, 256)?;
    let height = integer(&source, "height", 1, 256)?;
    let mut expected = Vec::new();
    match integer(&source, "version", 1, 5)? {
        3 | 5 => {
            let frames = array(&source, "frames")?;
            if frames.is_empty() || frames.len() > 16 {
                return Err(invalid("invalid pixel source frame count"));
            }
            let columns = (1_u64..=4)
                .find(|n| n * n >= frames.len() as u64)
                .ok_or_else(|| invalid("invalid pixel columns"))?;
            for (index, frame) in frames.iter().enumerate() {
                expected.push(json!({"id":frame["id"],"rect":[index as u64%columns*width,index as u64/columns*height,width,height]}));
            }
        }
        4 => {
            for frame in array(&source["atlas"], "frames")? {
                let uv = &frame["frame"];
                let edge = |key: &str, size: u64| {
                    uv[key]
                        .as_f64()
                        .map(|v| (v * size as f64).round() as u64)
                        .ok_or_else(|| invalid("invalid pixel atlas UV"))
                };
                let x = edge("u0", width)?;
                let y = edge("v0", height)?;
                let x1 = edge("u1", width)?;
                let y1 = edge("v1", height)?;
                if x1 <= x || y1 <= y {
                    return Err(invalid("invalid pixel atlas rect"));
                }
                expected.push(json!({"id":frame["id"],"rect":[x,y,x1-x,y1-y]}));
            }
        }
        _ => expected.push(json!({"id":source["frame"]["id"],"rect":[0,0,width,height]})),
    }
    let actual: Vec<_> = array(report, "frames")?
        .iter()
        .map(|frame| json!({"id":frame["id"],"rect":frame["rect"]}))
        .collect();
    if expected != actual {
        return Err(invalid("pixel frame layout differs from normals"));
    }
    Ok(())
}

fn incoming(metadata: &str, files: &[Value]) -> CommandResult<Pair> {
    if metadata.len() > MAX_METADATA || files.len() != 2 {
        return Err(invalid("invalid normal file/metadata count"));
    }
    let value: Value =
        serde_json::from_str(metadata).map_err(|_| invalid("invalid normal metadata"))?;
    let mut pngs = Vec::new();
    for kind in ["color", "normal"] {
        let name = text(&value["binding"]["textures"][kind], "asset")?;
        let path = format!("{name}.png");
        let found = files
            .iter()
            .filter(|f| f["path"] == path)
            .collect::<Vec<_>>();
        if found.len() != 1 || found[0]["mediaType"] != "image/png" {
            return Err(invalid("unexpected normal file"));
        }
        let encoded = found[0]["base64"]
            .as_str()
            .ok_or_else(|| invalid("missing normal base64"))?;
        if encoded.len() > MAX_PNG.div_ceil(3) * 4 {
            return Err(invalid("normal encoded PNG exceeds limit"));
        }
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| invalid("invalid normal base64"))?;
        if text(found[0], "sha256")? != hash(&bytes) {
            return Err(invalid("normal file SHA-256 differs"));
        }
        pngs.push(bytes);
    }
    pair(metadata.as_bytes().to_vec(), pngs)
}
fn budget(pairs: &[Pair]) -> CommandResult<()> {
    if pairs.len() > MAX_PAIRS
        || pairs
            .iter()
            .flat_map(|p| &p.pngs)
            .map(Vec::len)
            .sum::<usize>()
            > MAX_BYTES
        || pairs.iter().map(|p| p.width * p.height * 2).sum::<u64>() > MAX_PIXELS
    {
        return Err(invalid("normal project budget is 8 pairs / 64 MiB / 8 MP"));
    }
    let mut textures = HashMap::new();
    for pair in pairs {
        for kind in ["color", "normal"] {
            let texture = &pair.binding()["textures"][kind];
            let id = text(texture, "asset")?;
            if textures
                .insert(id, texture)
                .is_some_and(|old| old != texture)
            {
                return Err(invalid("normal texture name conflict"));
            }
        }
    }
    Ok(())
}
fn png_name(sha: &str) -> String {
    format!("normal-{sha}.png")
}
fn manifest(pairs: &[Pair]) -> Value {
    let mut textures = serde_json::Map::new();
    let mut options = serde_json::Map::new();
    for pair in pairs {
        for kind in ["color", "normal"] {
            let texture = &pair.binding()["textures"][kind];
            let id = texture["asset"].as_str().unwrap_or_default();
            textures.insert(
                id.to_owned(),
                json!(png_name(texture["sha256"].as_str().unwrap_or_default())),
            );
            options.insert(id.to_owned(), json!({"colorSpace":texture["colorSpace"]}));
        }
    }
    json!({"textures":textures,"textureOptions":options})
}
fn load_pairs(root: &Path, bytes: Option<&[u8]>) -> CommandResult<Vec<Pair>> {
    let Some(bytes) = bytes else {
        return Ok(Vec::new());
    };
    let catalog: Value =
        serde_json::from_slice(bytes).map_err(|_| invalid("invalid normal catalog"))?;
    header(&catalog, FORMAT)?;
    let entries = array(&catalog, "entries")?;
    if entries.len() > MAX_PAIRS {
        return Err(invalid("normal catalog exceeds pair budget"));
    }
    let mut pairs = Vec::new();
    let mut ids = HashSet::new();
    for entry in entries {
        let id = entry
            .as_str()
            .filter(|s| digest(s))
            .ok_or_else(|| invalid("invalid normal metadata ID"))?;
        if !ids.insert(id) {
            return Err(invalid("duplicate normal metadata ID"));
        }
        let bytes = asset_files::bounded_read(&root.join(format!("{id}.json")), MAX_METADATA)?;
        if hash(&bytes) != id {
            return Err(invalid("normal metadata SHA-256 differs"));
        }
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| invalid("invalid normal metadata"))?;
        let mut pngs = Vec::new();
        for kind in ["color", "normal"] {
            let sha = text(&value["binding"]["textures"][kind], "sha256")?;
            if !digest(sha) {
                return Err(invalid("invalid normal PNG hash"));
            }
            pngs.push(asset_files::bounded_read(
                &root.join(png_name(sha)),
                MAX_PNG,
            )?);
        }
        pairs.push(pair(bytes, pngs)?);
        budget(&pairs)?;
    }
    if catalog["manifest"] != manifest(&pairs) {
        return Err(invalid("normal catalog manifest differs"));
    }
    Ok(pairs)
}
fn register(
    root: &Path,
    pairs: &[Pair],
    registry: &PlacementAssetRegistry,
    publish: impl FnOnce() -> CommandResult<()>,
) -> CommandResult<Value> {
    let mut additions = HashMap::new();
    let mut textures = serde_json::Map::new();
    let mut entries = Vec::new();
    for pair in pairs {
        let metadata_name = format!("{}.json", pair.id());
        for (name, mime, id) in std::iter::once((metadata_name, "application/json", None)).chain(
            ["color", "normal"].into_iter().map(|kind| {
                let texture = &pair.binding()["textures"][kind];
                (
                    png_name(texture["sha256"].as_str().unwrap_or_default()),
                    "image/png",
                    texture["asset"].as_str(),
                )
            }),
        ) {
            let path = root.join(&name);
            let revision = placement_asset_revision(&path)?;
            additions.insert(
                format!("@{revision}/{name}"),
                RegisteredPlacementAsset {
                    asset_root: root.to_owned(),
                    path,
                    mime_type: mime,
                    content_revision: Some(revision.clone()),
                },
            );
            let url = format!("{}?revision={revision}", placement_runtime_asset_url(&name));
            if let Some(id) = id {
                textures.insert(id.to_owned(), json!(url));
            } else {
                entries.push(json!({"sha256":pair.id(),"metadataUrl":url}));
            }
        }
    }
    let mut registered = registry
        .assets
        .lock()
        .map_err(|_| PlacementDesktopError::WriteRegistryUnavailable)?;
    let extra = additions
        .keys()
        .filter(|key| !registered.contains_key(*key))
        .count();
    if registered.len() + extra > MAX_REGISTERED_ASSET_REVISIONS {
        return Err(invalid("asset protocol revision budget exhausted"));
    }
    publish()?;
    registered.extend(additions);
    Ok(
        json!({"format":"ferrum2d.sprite-normal.project","version":1,"registered":true,"entries":entries,"textures":textures}),
    )
}
pub(super) fn save_inner(
    project: &Path,
    metadata: &str,
    files: &[Value],
    registry: &PlacementAssetRegistry,
    writes: &PlacementWriteRegistry,
) -> CommandResult<Value> {
    let project = writes.require_asset_project(project)?;
    let next = incoming(metadata, files)?;
    let _save = writes
        .scene_save_lock
        .lock()
        .map_err(|_| PlacementDesktopError::WriteRegistryUnavailable)?;
    validate_pixel_source(&project, &next)?;
    let root = asset_files::directory(&project, DIRECTORY, true)?
        .ok_or_else(|| invalid("missing normal directory"))?;
    let previous = asset_files::read_catalog(&root)?;
    let mut pairs = load_pairs(&root, previous.as_deref())?;
    for pair in &pairs {
        validate_pixel_source(&project, pair)?;
    }
    if !pairs.iter().any(|p| p.id() == next.id()) {
        pairs.push(next);
    }
    budget(&pairs)?;
    let mut created = Vec::new();
    let temporary = root.join(format!(
        ".catalog-{}-{}.tmp",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        for pair in &pairs {
            for bytes in &pair.pngs {
                asset_files::create_file(&root.join(png_name(&hash(bytes))), bytes, &mut created)?;
            }
            asset_files::create_file(
                &root.join(format!("{}.json", pair.id())),
                &pair.metadata,
                &mut created,
            )?;
        }
        let catalog = json!({"format":FORMAT,"version":1,"entries":pairs.iter().map(Pair::id).collect::<Vec<_>>(),"manifest":manifest(&pairs)});
        let bytes = serde_json::to_vec_pretty(&catalog)
            .map_err(|_| invalid("normal catalog serialization failed"))?;
        asset_files::create_file(&temporary, &bytes, &mut created)?;
        register(&root, &pairs, registry, || {
            asset_files::publish_catalog(
                &project,
                DIRECTORY,
                &root,
                &temporary,
                previous.as_deref(),
            )
        })
    })();
    if result.is_err() {
        asset_files::rollback(created);
    }
    result
}
pub(super) fn load_inner(
    project: &Path,
    registry: &PlacementAssetRegistry,
    writes: &PlacementWriteRegistry,
) -> CommandResult<Value> {
    let project = writes.require_asset_project(project)?;
    let _save = writes
        .scene_save_lock
        .lock()
        .map_err(|_| PlacementDesktopError::WriteRegistryUnavailable)?;
    let Some(root) = asset_files::directory(&project, DIRECTORY, false)? else {
        return Ok(
            json!({"format":"ferrum2d.sprite-normal.project","version":1,"registered":true,"entries":[],"textures":{}}),
        );
    };
    let pairs = load_pairs(&root, asset_files::read_catalog(&root)?.as_deref())?;
    for pair in &pairs {
        validate_pixel_source(&project, pair)?;
    }
    register(&root, &pairs, registry, || Ok(()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};
    struct Project(PathBuf);
    impl Project {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "ferrum-normal-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(path.join("public")).expect("project");
            Self(path)
        }
        fn writes(&self) -> PlacementWriteRegistry {
            let writes = PlacementWriteRegistry::default();
            writes.authorize_project(&self.0).expect("authorize");
            writes
        }
        fn root(&self) -> PathBuf {
            self.0.join("public/assets").join(DIRECTORY)
        }
    }
    impl Drop for Project {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn fixture(index: u8) -> (String, Vec<Value>) {
        let encode = |rgba: [u8; 4]| {
            let mut bytes = Vec::new();
            {
                let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                encoder
                    .write_header()
                    .expect("header")
                    .write_image_data(&rgba)
                    .expect("PNG");
            }
            bytes
        };
        let color = encode([index, 40, 70, 255]);
        let normal = encode([128, 128, 255, 255]);
        let color_name = format!("pair{index}.color");
        let normal_name = format!("pair{index}.normal");
        let sha = "a".repeat(64);
        let revision = "a".repeat(40);
        let report = json!({"format":"ferrum2d.sprite-normals.report","version":1,"ok":true,"normalFormat":"opengl","colorSpace":"none","settings":{},"generator":{"repository":"generator","revision":revision,"binarySha256":sha},"config":{"sha256":sha},"results":[{"input":{"path":"source.png","sha256":hash(&color)},"color":"source.png","normal":"source_n.png","width":1,"height":1,"outputs":[{"path":"source_n.png","sha256":hash(&normal)}]}]});
        let binding = json!({"format":"ferrum2d.sprite-normal.binding","version":1,"width":1,"height":1,"textures":{"color":{"asset":color_name,"path":"source.png","sha256":hash(&color),"colorSpace":"srgb"},"normal":{"asset":normal_name,"path":"source_n.png","sha256":hash(&normal),"colorSpace":"none"}},"frames":[{"u0":0,"v0":0,"u1":1,"v1":1}],"generation":{"repository":"generator","revision":revision,"binarySha256":sha,"configSha256":sha,"settings":{},"input":{"path":"source.png","sha256":hash(&color)}}});
        let value = json!({"format":"ferrum2d.sprite-normal.assets","version":1,"overwrite":false,"document":"scene","binding":binding,"report":report,"metadataJson":"{}","manifest":{"textures":{&color_name:format!("{color_name}.png"),&normal_name:format!("{normal_name}.png")},"textureOptions":{&color_name:{"colorSpace":"srgb"},&normal_name:{"colorSpace":"none"}}},"files":[]});
        (
            serde_json::to_string(&value).expect("metadata"),
            vec![
                json!({"path":format!("{color_name}.png"),"mediaType":"image/png","sha256":hash(&color),"base64":STANDARD.encode(color)}),
                json!({"path":format!("{normal_name}.png"),"mediaType":"image/png","sha256":hash(&normal),"base64":STANDARD.encode(normal)}),
            ],
        )
    }
    #[test]
    fn pixel_normal_pairs_verify_source_json_png_and_frame_layout_before_publish() {
        let project = Project::new();
        let registry = PlacementAssetRegistry::default();
        let writes = project.writes();
        let (metadata, mut files) = fixture(1);
        let mut value: Value = serde_json::from_str(&metadata).unwrap();
        let id = format!("pixel.{}", "a".repeat(24));
        let source = json!({"format":"ferrum2d.pixel-document","version":1,"name":"Sprite","width":1,"height":1,"colorSpace":"srgb","palette":[],"layer":{"id":"body","name":"Body"},"frame":{"id":"frame-1","durationMs":100},"rgba":STANDARD.encode([1,40,70,255])});
        let source_bytes = serde_json::to_vec(&source).unwrap();
        let root = asset_files::directory(&project.0, ".ferrum-pixels", true)
            .unwrap()
            .unwrap();
        fs::write(root.join(format!("{id}.json")), &source_bytes).unwrap();
        fs::write(
            root.join(format!("{id}.png")),
            STANDARD
                .decode(files[0]["base64"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        let color = value["binding"]["textures"]["color"]["sha256"].clone();
        let normal = value["binding"]["textures"]["normal"]["sha256"].clone();
        let generated = value["report"].clone();
        value["binding"]["textures"]["color"]["asset"] = json!(id);
        value["binding"]["textures"]["color"]["path"] = json!(format!("{id}.png"));
        value["binding"]["generation"]["settings"] =
            json!({"pipeline":"pixel-rects-v1","jsonSha256":hash(&source_bytes)});
        value["manifest"]["textures"]
            .as_object_mut()
            .unwrap()
            .remove("pair1.color");
        value["manifest"]["textures"][&id] = json!(format!("{id}.png"));
        value["manifest"]["textureOptions"]
            .as_object_mut()
            .unwrap()
            .remove("pair1.color");
        value["manifest"]["textureOptions"][&id] = json!({"colorSpace":"srgb"});
        files[0]["path"] = json!(format!("{id}.png"));
        value["report"] = json!({"format":"ferrum2d.pixel-normal.report","version":1,"pipeline":"pixel-rects-v1","source":{"assetId":id,"jsonSha256":hash(&source_bytes),"pngSha256":color},"settings":{},"frames":[{"id":"frame-1","rect":[0,0,1,1],"report":generated}],"output":{"sha256":normal,"width":1,"height":1},"config":{"sha256":"a".repeat(64)}});
        value["metadataJson"] = json!(value["report"].to_string());
        let saved = save_inner(&project.0, &value.to_string(), &files, &registry, &writes).unwrap();
        assert_eq!(saved, load_inner(&project.0, &registry, &writes).unwrap());
        for change in 0..5 {
            let mut bad = value.clone();
            match change {
                0 => bad["report"]["source"]["jsonSha256"] = json!("f".repeat(64)),
                1 => bad["report"]["frames"][0]["id"] = json!("other"),
                2 => bad["report"]["frames"][0]["rect"] = json!([0, 0, 2, 1]),
                3 => {
                    bad["report"]["frames"][0]["report"]["generator"]["revision"] =
                        json!("f".repeat(40))
                }
                _ => bad["report"]["frames"] = json!([]),
            }
            bad["metadataJson"] = json!(bad["report"].to_string());
            assert!(save_inner(&project.0, &bad.to_string(), &files, &registry, &writes).is_err());
            assert_eq!(saved, load_inner(&project.0, &registry, &writes).unwrap());
        }
        let png_path = root.join(format!("{id}.png"));
        let source_png = fs::read(&png_path).unwrap();
        let normal_catalog = fs::read(project.root().join("catalog.json")).unwrap();
        fs::write(&png_path, b"changed").unwrap();
        assert!(load_inner(&project.0, &registry, &writes).is_err());
        assert!(save_inner(&project.0, &value.to_string(), &files, &registry, &writes).is_err());
        assert_eq!(
            fs::read(project.root().join("catalog.json")).unwrap(),
            normal_catalog
        );
        fs::write(&png_path, source_png).unwrap();
        assert_eq!(saved, load_inner(&project.0, &registry, &writes).unwrap());
        fs::write(root.join(format!("{id}.json")), b"changed").unwrap();
        assert!(load_inner(&project.0, &registry, &writes).is_err());
    }

    #[test]
    fn normal_pair_roundtrip_preserves_ordered_metadata_and_color_spaces() {
        let project = Project::new();
        let writes = project.writes();
        let assets = PlacementAssetRegistry::default();
        let (metadata, files) = fixture(1);
        let saved = save_inner(&project.0, &metadata, &files, &assets, &writes).expect("save");
        assert_eq!(
            saved,
            load_inner(&project.0, &assets, &writes).expect("load")
        );
        assert_eq!(
            saved,
            save_inner(&project.0, &metadata, &files, &assets, &writes).expect("retry")
        );
        assert_eq!(
            fs::read(
                project
                    .root()
                    .join(format!("{}.json", hash(metadata.as_bytes())))
            )
            .expect("raw metadata"),
            metadata.as_bytes()
        );
        let catalog: Value = serde_json::from_slice(
            &fs::read(project.root().join("catalog.json")).expect("catalog"),
        )
        .expect("JSON");
        assert_eq!(
            catalog["manifest"]["textureOptions"]["pair1.normal"]["colorSpace"],
            "none"
        );
        assert_eq!(
            catalog["manifest"]["textureOptions"]["pair1.color"]["colorSpace"],
            "srgb"
        );
    }
    #[test]
    fn invalid_pairs_are_rejected_before_file_creation() {
        for kind in 0..9 {
            let project = Project::new();
            let writes = project.writes();
            let assets = PlacementAssetRegistry::default();
            let (metadata, mut files) = fixture(1);
            let mut value: Value = serde_json::from_str(&metadata).expect("JSON");
            match kind {
                0 => files[0]["base64"] = json!("invalid"),
                1 => value["binding"]["textures"]["color"]["asset"] = json!("../outside"),
                2 => value["binding"]["textures"]["normal"]["colorSpace"] = json!("srgb"),
                3 => value["binding"]["width"] = json!(2),
                4 => value["binding"]["frames"][0]["u1"] = json!(0),
                5 => value["report"]["config"]["sha256"] = json!("bad"),
                6 => value["report"]["results"][0]["normal"] = json!("other.png"),
                7 => files[1] = files[0].clone(),
                _ => value["overwrite"] = json!(true),
            }
            assert!(
                save_inner(&project.0, &value.to_string(), &files, &assets, &writes).is_err(),
                "case {kind}"
            );
            assert!(!project.root().exists());
        }
    }
    #[test]
    fn normal_project_authorization_quota_and_tamper_checks() {
        let project = Project::new();
        let assets = PlacementAssetRegistry::default();
        let (metadata, files) = fixture(1);
        assert!(save_inner(
            &project.0,
            &metadata,
            &files,
            &assets,
            &PlacementWriteRegistry::default()
        )
        .is_err());
        let writes = project.writes();
        for index in 0..8 {
            let (metadata, files) = fixture(index);
            save_inner(&project.0, &metadata, &files, &assets, &writes).expect("quota");
        }
        let before = fs::read(project.root().join("catalog.json")).expect("catalog");
        let (metadata, files) = fixture(9);
        assert!(save_inner(&project.0, &metadata, &files, &assets, &writes).is_err());
        assert_eq!(
            fs::read(project.root().join("catalog.json")).expect("catalog"),
            before
        );
        let normal = incoming(&fixture(0).0, &fixture(0).1).expect("pair").pngs[1].clone();
        fs::write(project.root().join(png_name(&hash(&normal))), b"changed").expect("tamper");
        assert!(load_inner(&project.0, &PlacementAssetRegistry::default(), &writes).is_err());
    }
    #[test]
    fn competing_file_is_preserved_and_owned_partial_writes_are_rolled_back() {
        let project = Project::new();
        let writes = project.writes();
        let assets = PlacementAssetRegistry::default();
        let (metadata, files) = fixture(1);
        let pair = incoming(&metadata, &files).expect("pair");
        let root = asset_files::directory(&project.0, DIRECTORY, true)
            .expect("directory")
            .expect("root");
        let path = root.join(png_name(&hash(&pair.pngs[1])));
        fs::write(&path, b"external").expect("competing");
        assert!(save_inner(&project.0, &metadata, &files, &assets, &writes).is_err());
        assert_eq!(fs::read(&path).expect("external"), b"external");
        assert!(!root.join("catalog.json").exists());
        assert!(assets.assets.lock().expect("registry").is_empty());
        #[cfg(unix)]
        assert!(!root.join(png_name(&hash(&pair.pngs[0]))).exists());
    }
    #[test]
    #[cfg(unix)]
    fn normal_directory_catalog_and_png_symlinks_are_rejected() {
        use std::os::unix::fs::symlink;
        let project = Project::new();
        let outside = Project::new();
        let writes = project.writes();
        let assets = PlacementAssetRegistry::default();
        let (metadata, files) = fixture(1);
        fs::create_dir(project.0.join("public/assets")).expect("assets");
        symlink(&outside.0, project.root()).expect("link");
        assert!(save_inner(&project.0, &metadata, &files, &assets, &writes).is_err());
        fs::remove_file(project.root()).expect("unlink");
        fs::create_dir(project.root()).expect("normal dir");
        let target = outside.0.join("target");
        fs::write(&target, b"external").expect("target");
        symlink(&target, project.root().join("catalog.json")).expect("catalog link");
        assert!(save_inner(&project.0, &metadata, &files, &assets, &writes).is_err());
        fs::remove_file(project.root().join("catalog.json")).expect("unlink");
        let pair = incoming(&metadata, &files).expect("pair");
        symlink(&target, project.root().join(png_name(&hash(&pair.pngs[0])))).expect("PNG link");
        assert!(save_inner(&project.0, &metadata, &files, &assets, &writes).is_err());
        assert_eq!(fs::read(target).expect("external"), b"external");
    }
}
