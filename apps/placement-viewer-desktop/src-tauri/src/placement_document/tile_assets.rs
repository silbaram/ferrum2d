//! Original Tiled/LDtk sources. Converted frames are recomputed by the public importer.
use super::sprite_assets::{array, hash, invalid, text, Contract, Dependency, Source};
use super::{CommandResult, PlacementAssetRegistry, PlacementWriteRegistry};
use serde_json::{json, Value};
use std::{io::Cursor, path::Path};

const CONTRACT: Contract = Contract {
    check_catalog_revision: false,
    directory: ".ferrum-tiles",
    prefix: "tile.",
    bundle_format: "ferrum2d.tile-import.assets",
    catalog_format: "ferrum2d.tile-import.catalog",
    project_format: "ferrum2d.tile-import.project",
    max_dependencies: 8,
    max_source_json: 1024 * 1024,
    max_source_png: 16 * 1024 * 1024,
    validate: validate_source,
};
fn integer(v: &Value, key: &str, min: u64, max: u64) -> CommandResult<u64> {
    v.get(key)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= min as f64 && *n <= max as f64)
        .map(|n| n as u64)
        .ok_or_else(|| invalid(format!("invalid bounded tile {key}")))
}
fn tiled_layers(
    layers: &[Value],
    root: &Value,
    depth: usize,
    counts: &mut (usize, u64),
) -> CommandResult<()> {
    if depth > 8 {
        return Err(invalid("tile layer nesting exceeds 8"));
    }
    for layer in layers {
        counts.0 += 1;
        if counts.0 > 16 {
            return Err(invalid("tile layer budget exceeds 16"));
        }
        if layer["type"] == "group" {
            tiled_layers(array(layer, "layers")?, root, depth + 1, counts)?;
        }
        if layer["type"] != "tilelayer" {
            continue;
        }
        let w = integer(
            if layer.get("width").is_some() {
                layer
            } else {
                root
            },
            "width",
            1,
            256,
        )?;
        let h = integer(
            if layer.get("height").is_some() {
                layer
            } else {
                root
            },
            "height",
            1,
            256,
        )?;
        counts.1 += w * h;
        if counts.1 > 65_536
            || array(layer, "data")?.len() != (w * h) as usize
            || ["chunks", "encoding", "compression"]
                .iter()
                .any(|k| layer.get(k).is_some())
        {
            return Err(invalid("use bounded uncompressed tile data arrays"));
        }
    }
    Ok(())
}
fn selected_set<'a>(
    sets: &'a [Value],
    kind: &str,
    selected: Option<&str>,
) -> CommandResult<&'a Value> {
    if sets.is_empty()
        || sets.len() > 8
        || (sets.len() == 1 && selected.is_some())
        || (sets.len() > 1 && selected.is_none())
    {
        return Err(invalid("choose one of 1..8 embedded tilesets"));
    }
    let mut keys = std::collections::HashSet::new();
    let mut found = None;
    for set in sets {
        let key = if kind == "tiled" {
            if set.get("source").is_some() {
                return Err(invalid("external tilesets are unsupported"));
            }
            format!("tiled:{}", text(set, "name")?)
        } else {
            format!("ldtk:{}", integer(set, "uid", 1, 9_007_199_254_740_991)?)
        };
        if !keys.insert(key.clone()) {
            return Err(invalid("duplicate tileset identity"));
        }
        if selected == Some(key.as_str()) {
            found = Some(set);
        }
    }
    if sets.len() == 1 {
        return Ok(&sets[0]);
    }
    found.ok_or_else(|| invalid("selected tileset was not found"))
}
fn resolve_dependencies(
    raw: &mut Value,
    kind: &str,
    dependencies: &[Dependency],
) -> CommandResult<()> {
    if kind != "tiled" {
        return if dependencies.is_empty() {
            Ok(())
        } else {
            Err(invalid("TSJ requires a Tiled map"))
        };
    }
    let mut sources = std::collections::HashSet::new();
    let mut names = std::collections::HashSet::new();
    let sets = raw
        .get_mut("tilesets")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid("missing tilesets"))?;
    for set in sets {
        let Some(source) = set.get("source").cloned() else {
            continue;
        };
        let source = source
            .as_str()
            .ok_or_else(|| invalid("invalid TSJ source"))?;
        let name = source.rsplit('/').next().unwrap_or("");
        if source.is_empty()
            || source.len() > 1024
            || source.starts_with('/')
            || source
                .chars()
                .any(|c| c.is_control() || "\\:?#%".contains(c))
            || source.split('/').any(str::is_empty)
            || !source.to_ascii_lowercase().ends_with(".tsj")
            || !sources.insert(source.to_owned())
            || !names.insert(name.to_owned())
        {
            return Err(invalid("invalid or ambiguous relative TSJ source"));
        }
        let dep = dependencies
            .iter()
            .find(|d| d.source == source && d.name == name)
            .ok_or_else(|| invalid("missing external TSJ source"))?;
        if dep.name.len() > 256 || dep.name.chars().any(char::is_control) {
            return Err(invalid("invalid TSJ filename"));
        }
        let text = std::str::from_utf8(&dep.json).map_err(|_| invalid("TSJ is not UTF-8"))?;
        let mut resolved: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|_| invalid("invalid TSJ JSON"))?;
        if !resolved.is_object()
            || resolved.get("source").is_some()
            || resolved["type"] == "map"
            || resolved.get("tilesets").is_some()
        {
            return Err(invalid("nested external tileset is unsupported"));
        }
        resolved["firstgid"] = set["firstgid"].clone();
        *set = resolved;
    }
    if sources.len() != dependencies.len()
        || dependencies.windows(2).any(|d| {
            d[0].source.encode_utf16().cmp(d[1].source.encode_utf16()) != std::cmp::Ordering::Less
        })
    {
        return Err(invalid("unused, duplicate or unsorted TSJ source"));
    }
    Ok(())
}
fn validate_source(
    meta: &Value,
    png: Vec<u8>,
    bytes: Vec<u8>,
    dependencies: Vec<Dependency>,
) -> CommandResult<Source> {
    let name = text(meta, "logicalId")?;
    let identity = text(meta, "identityDocument")?;
    let kind = text(meta, "kind")?;
    let level = integer(meta, "levelIndex", 0, 63)?;
    if name.len() > 48
        || !name.as_bytes()[0].is_ascii_alphanumeric()
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        || !["tiled", "ldtk"].contains(&kind)
        || (kind == "tiled" && level != 0)
    {
        return Err(invalid("invalid tile identity"));
    }
    for key in ["jsonName", "pngName"] {
        let value = text(meta, key)?;
        if value.len() > 256 || value.contains(['/', '\\', '\0']) {
            return Err(invalid("invalid tile source filename"));
        }
    }
    if png.len() > 16 * 1024 * 1024
        || bytes.len() > 1024 * 1024
        || text(meta, "pngSha256")? != hash(&png)
        || text(meta, "jsonSha256")? != hash(&bytes)
    {
        return Err(invalid("tile source byte limit or SHA-256 mismatch"));
    }
    let selected = meta
        .get("tilesetKey")
        .map(|_| text(meta, "tilesetKey"))
        .transpose()?;
    if selected.is_some_and(|key| key.len() > 1024) {
        return Err(invalid("invalid tileset key"));
    }
    let mut identity_parts = vec![
        json!(identity),
        json!(name),
        json!(kind),
        json!(level),
        json!(hash(&bytes)),
        json!(hash(&png)),
    ];
    if let Some(key) = selected {
        identity_parts.push(json!(key));
    }
    if !dependencies.is_empty() {
        identity_parts.push(json!(dependencies
            .iter()
            .map(|d| json!([d.source, d.sha256]))
            .collect::<Vec<_>>()));
    }
    let key = serde_json::to_vec(&identity_parts).map_err(|_| invalid("invalid tile identity"))?;
    if text(meta, "assetId")? != format!("tile.{kind}.{name}.{}", &hash(&key)[..24]) {
        return Err(invalid("tile revision identity differs"));
    }
    let raw = std::str::from_utf8(&bytes).map_err(|_| invalid("tile JSON is not UTF-8"))?;
    let mut raw: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|_| invalid("invalid tile JSON"))?;
    resolve_dependencies(&mut raw, kind, &dependencies)?;
    let (set, image_key, width_key, height_key) = if kind == "tiled" {
        let sets = array(&raw, "tilesets")?;
        let set = selected_set(sets, kind, selected)?;
        if raw["infinite"] == true || raw["orientation"] != "orthogonal" {
            return Err(invalid("choose a finite orthogonal Tiled map"));
        }
        integer(&raw, "width", 1, 256)?;
        integer(&raw, "height", 1, 256)?;
        tiled_layers(array(&raw, "layers")?, &raw, 0, &mut (0, 0))?;
        (set, "image", "imagewidth", "imageheight")
    } else {
        let sets = raw
            .get("defs")
            .ok_or_else(|| invalid("missing LDtk defs"))?;
        let sets = array(sets, "tilesets")?;
        let levels = array(&raw, "levels")?;
        let set = selected_set(sets, kind, selected)?;
        if levels.len() > 64 {
            return Err(invalid("LDtk requires <=64 levels"));
        }
        let selected = levels
            .get(level as usize)
            .ok_or_else(|| invalid("missing LDtk level"))?;
        if selected
            .get("externalRelPath")
            .is_some_and(|v| !v.is_null())
        {
            return Err(invalid("external LDtk levels are unsupported"));
        }
        let layers = array(selected, "layerInstances")?;
        if layers.len() > 16 {
            return Err(invalid("LDtk layer budget exceeded"));
        }
        let mut cells = 0;
        for layer in layers {
            if layer["__type"] == "Entities" {
                continue;
            }
            if layer["__type"] != "Tiles" && layer["__type"] != "AutoLayer" {
                return Err(invalid("unsupported LDtk layer"));
            }
            cells += integer(layer, "__cWid", 1, 256)? * integer(layer, "__cHei", 1, 256)?;
            if cells > 65_536 {
                return Err(invalid("LDtk cell budget exceeded"));
            }
        }
        (set, "relPath", "pxWid", "pxHei")
    };
    let w = integer(meta, "width", 1, 4096)?;
    let h = integer(meta, "height", 1, 4096)?;
    if w * h > 4_194_304
        || integer(set, width_key, 1, 4096)? != w
        || integer(set, height_key, 1, 4096)? != h
        || text(set, image_key)?.rsplit(['/', '\\']).next() != Some(text(meta, "pngName")?)
    {
        return Err(invalid(
            "tileset PNG dimensions or original filename differ",
        ));
    }
    let mut decoder = png::Decoder::new(Cursor::new(&png));
    decoder.set_limits(png::Limits {
        bytes: 40 * 1024 * 1024,
    });
    let mut reader = decoder
        .read_info()
        .map_err(|_| invalid("invalid tile PNG header"))?;
    if u64::from(reader.info().width) != w
        || u64::from(reader.info().height) != h
        || reader.output_buffer_size() > 32 * 1024 * 1024
    {
        return Err(invalid("decoded tileset dimensions differ"));
    }
    reader
        .next_frame(&mut vec![0; reader.output_buffer_size()])
        .map_err(|_| invalid("tile PNG decode failed"))?;
    // Store only original source identity. Caller-provided frames, URLs and converted maps are never trusted.
    let mut canonical = serde_json::Map::new();
    for key in [
        "logicalId",
        "assetId",
        "identityDocument",
        "kind",
        "levelIndex",
        "jsonName",
        "pngName",
        "jsonSha256",
        "pngSha256",
        "width",
        "height",
    ] {
        canonical.insert(key.to_owned(), meta[key].clone());
    }
    if let Some(key) = selected {
        canonical.insert("tilesetKey".to_owned(), json!(key));
    }
    if !dependencies.is_empty() {
        canonical.insert(
            "dependencies".to_owned(),
            json!(dependencies
                .iter()
                .map(|d| json!({"source":d.source, "name":d.name, "sha256":d.sha256}))
                .collect::<Vec<_>>()),
        );
    }
    Ok(Source {
        metadata: Value::Object(canonical),
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
    use base64::{engine::general_purpose::STANDARD, Engine as _};
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
                "ferrum-tile-{}-{}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(path.join("public")).unwrap();
            Self(path.canonicalize().unwrap())
        }
        fn writes(&self) -> PlacementWriteRegistry {
            let w = PlacementWriteRegistry::default();
            w.authorize_project(&self.0).unwrap();
            w
        }
        fn root(&self) -> PathBuf {
            self.0.join("public/assets/.ferrum-tiles")
        }
    }
    impl Drop for Project {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn fixture(kind: &str) -> Value {
        let mut png = Vec::new();
        {
            let mut e = png::Encoder::new(&mut png, 2, 1);
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            e.write_header()
                .unwrap()
                .write_image_data(&[255; 8])
                .unwrap();
        }
        let raw = if kind == "tiled" {
            json!({"orientation":"orthogonal","width":2,"height":1,"tilesets":[{"name":"terrain","image":"tiles.png","imagewidth":2,"imageheight":1}],"layers":[{"type":"tilelayer","width":2,"height":1,"data":[1,2]}]})
        } else {
            json!({"defs":{"tilesets":[{"uid":7,"relPath":"tiles.png","pxWid":2,"pxHei":1}]},"levels":[{"layerInstances":[{"__type":"Tiles","__cWid":2,"__cHei":1}]}]})
        };
        let bytes = serde_json::to_vec(&raw).unwrap();
        let id = format!(
            "tile.{kind}.terrain.{}",
            &hash(
                &serde_json::to_vec(&json!([
                    "original",
                    "terrain",
                    kind,
                    0,
                    hash(&bytes),
                    hash(&png)
                ]))
                .unwrap()
            )[..24]
        );
        json!({"format":"ferrum2d.tile-import.assets","version":1,"overwrite":false,"document":"original","revisions":[{"assetId":id,"logicalId":"terrain","identityDocument":"original","kind":kind,"levelIndex":0,"jsonName":"map.json","pngName":"tiles.png","jsonSha256":hash(&bytes),"pngSha256":hash(&png),"width":2,"height":1,"imported":{"malicious":"ignored"},"frames":[]}],"files":[{"path":format!("{id}.json"),"mediaType":"application/json","sha256":hash(&bytes),"base64":STANDARD.encode(bytes)},{"path":format!("{id}.png"),"mediaType":"image/png","sha256":hash(&png),"base64":STANDARD.encode(png)}],"manifest":{"textures":{&id:format!("{id}.png")},"textureOptions":{&id:{"colorSpace":"srgb"}}}})
    }
    fn multi_fixture(kind: &str, selected: &str) -> Value {
        let mut b = fixture(kind);
        let raw = STANDARD
            .decode(b["files"][0]["base64"].as_str().unwrap())
            .unwrap();
        let mut raw: Value = serde_json::from_slice(&raw).unwrap();
        if kind == "tiled" {
            let mut other = raw["tilesets"][0].clone();
            other["name"] = json!("decor");
            raw["tilesets"].as_array_mut().unwrap().push(other);
        } else {
            let mut other = raw["defs"]["tilesets"][0].clone();
            other["uid"] = json!(8);
            raw["defs"]["tilesets"].as_array_mut().unwrap().push(other);
        }
        let bytes = serde_json::to_vec(&raw).unwrap();
        let meta = &mut b["revisions"][0];
        meta["tilesetKey"] = json!(selected);
        meta["jsonSha256"] = json!(hash(&bytes));
        let parts = json!([
            "original",
            "terrain",
            kind,
            0,
            hash(&bytes),
            meta["pngSha256"],
            selected
        ]);
        let id = format!(
            "tile.{kind}.terrain.{}",
            &hash(&serde_json::to_vec(&parts).unwrap())[..24]
        );
        meta["assetId"] = json!(id);
        b["files"][0]["base64"] = json!(STANDARD.encode(&bytes));
        b["files"][0]["sha256"] = json!(hash(&bytes));
        b["files"][0]["path"] = json!(format!("{id}.json"));
        b["files"][1]["path"] = json!(format!("{id}.png"));
        b["manifest"] = json!({"textures":{&id:format!("{id}.png")}, "textureOptions":{&id:{"colorSpace":"srgb"}}});
        b
    }
    fn external_fixture(revision: u8) -> Value {
        let mut b = fixture("tiled");
        let raw = STANDARD
            .decode(b["files"][0]["base64"].as_str().unwrap())
            .unwrap();
        let mut raw: Value = serde_json::from_slice(&raw).unwrap();
        let mut tsj = raw["tilesets"][0].clone();
        tsj["spacing"] = json!(revision);
        let tsj = serde_json::to_vec(&tsj).unwrap();
        raw["tilesets"] = json!([{"firstgid":1, "source":"../tiles/terrain.tsj"}]);
        let bytes = serde_json::to_vec(&raw).unwrap();
        let meta = &mut b["revisions"][0];
        meta["jsonSha256"] = json!(hash(&bytes));
        meta["dependencies"] =
            json!([{"source":"../tiles/terrain.tsj", "name":"terrain.tsj", "sha256":hash(&tsj)}]);
        let parts = json!([
            "original",
            "terrain",
            "tiled",
            0,
            hash(&bytes),
            meta["pngSha256"],
            [["../tiles/terrain.tsj", hash(&tsj)]]
        ]);
        let id = format!(
            "tile.tiled.terrain.{}",
            &hash(&serde_json::to_vec(&parts).unwrap())[..24]
        );
        meta["assetId"] = json!(id);
        b["files"][0] = json!({"path":format!("{id}.json"),"mediaType":"application/json","sha256":hash(&bytes),"base64":STANDARD.encode(bytes)});
        b["files"][1]["path"] = json!(format!("{id}.png"));
        b["files"].as_array_mut().unwrap().push(json!({"path":format!("{id}.dep.0.tsj"),"mediaType":"application/json","sha256":hash(&tsj),"base64":STANDARD.encode(tsj)}));
        b["manifest"] = json!({"textures":{&id:format!("{id}.png")},"textureOptions":{&id:{"colorSpace":"srgb"}}});
        b
    }
    #[test]
    fn external_tsjs_are_immutable_sources_and_tsj_only_changes_survive_restart() {
        let p = Project::new();
        let w = p.writes();
        let registry = PlacementAssetRegistry::default();
        let first = external_fixture(0);
        let next = external_fixture(1);
        assert_eq!(
            first["revisions"][0]["jsonSha256"],
            next["revisions"][0]["jsonSha256"]
        );
        assert_ne!(
            first["revisions"][0]["assetId"],
            next["revisions"][0]["assetId"]
        );
        let saved = save_inner(&p.0, &first, &registry, &w).unwrap();
        assert_eq!(save_inner(&p.0, &first, &registry, &w).unwrap(), saved);
        save_inner(&p.0, &next, &registry, &w).unwrap();
        let loaded = load_inner(&p.0, &PlacementAssetRegistry::default(), &p.writes()).unwrap();
        assert_eq!(loaded["assets"].as_array().unwrap().len(), 2);
        for asset in loaded["assets"].as_array().unwrap() {
            assert_eq!(asset["dependencies"][0]["source"], "../tiles/terrain.tsj");
            assert!(asset["dependencies"][0]["jsonUrl"]
                .as_str()
                .unwrap()
                .contains("revision="));
        }
        let id = first["revisions"][0]["assetId"].as_str().unwrap();
        assert_eq!(
            fs::read(p.root().join(format!("{id}.dep.0.tsj"))).unwrap(),
            STANDARD
                .decode(first["files"][2]["base64"].as_str().unwrap())
                .unwrap()
        );
        fs::write(p.root().join(format!("{id}.dep.0.tsj")), b"{}").unwrap();
        let fresh = PlacementAssetRegistry::default();
        assert!(load_inner(&p.0, &fresh, &w).is_err());
        assert!(fresh.assets.lock().unwrap().is_empty());
    }
    #[test]
    fn external_dependency_failure_preserves_competing_file_and_rolls_back_owned_sources() {
        let p = Project::new();
        let b = external_fixture(0);
        let id = b["revisions"][0]["assetId"].as_str().unwrap();
        fs::create_dir_all(p.root()).unwrap();
        let path = p.root().join(format!("{id}.dep.0.tsj"));
        fs::write(&path, b"competing TSJ").unwrap();
        let registry = PlacementAssetRegistry::default();
        assert!(save_inner(&p.0, &b, &registry, &p.writes()).is_err());
        assert_eq!(fs::read(path).unwrap(), b"competing TSJ");
        assert_eq!(fs::read_dir(p.root()).unwrap().count(), 1);
        assert!(registry.assets.lock().unwrap().is_empty());
    }
    #[test]
    fn missing_corrupt_and_over_budget_tsjs_are_rejected_before_files_are_created() {
        for issue in ["missing", "hash", "bytes", "extra", "path"] {
            let p = Project::new();
            let mut b = external_fixture(0);
            match issue {
                "missing" => {
                    b["files"].as_array_mut().unwrap().pop();
                }
                "hash" => {
                    b["files"][2]["base64"] = json!(STANDARD.encode(b"{}"));
                }
                "bytes" => {
                    let bytes = vec![b' '; 1024 * 1024];
                    b["files"][2]["base64"] = json!(STANDARD.encode(&bytes));
                    b["files"][2]["sha256"] = json!(hash(&bytes));
                }
                "extra" => {
                    let file = b["files"][2].clone();
                    b["files"].as_array_mut().unwrap().push(file);
                }
                "path" => {
                    b["revisions"][0]["dependencies"][0]["source"] = json!("other.tsj");
                }
                _ => unreachable!(),
            }
            assert!(
                save_inner(&p.0, &b, &PlacementAssetRegistry::default(), &p.writes()).is_err(),
                "{issue}"
            );
            assert!(!p.root().exists());
        }
    }
    #[test]
    fn selected_tilesets_with_the_same_png_have_distinct_durable_revisions() {
        for (kind, a, b) in [
            ("tiled", "tiled:terrain", "tiled:decor"),
            ("ldtk", "ldtk:7", "ldtk:8"),
        ] {
            let p = Project::new();
            let w = p.writes();
            let registry = PlacementAssetRegistry::default();
            let first = multi_fixture(kind, a);
            let second = multi_fixture(kind, b);
            assert_ne!(
                first["revisions"][0]["assetId"],
                second["revisions"][0]["assetId"]
            );
            save_inner(&p.0, &first, &registry, &w).unwrap();
            save_inner(&p.0, &second, &registry, &w).unwrap();
            let loaded = load_inner(&p.0, &PlacementAssetRegistry::default(), &p.writes()).unwrap();
            assert_eq!(loaded["assets"].as_array().unwrap().len(), 2);
            assert_eq!(loaded["assets"][0]["metadata"]["tilesetKey"], a);
            assert_eq!(loaded["assets"][1]["metadata"]["tilesetKey"], b);
        }
    }
    #[test]
    fn invalid_selected_tileset_is_rejected_before_creating_files() {
        for kind in ["tiled", "ldtk"] {
            let p = Project::new();
            let b = multi_fixture(kind, "missing");
            assert!(save_inner(&p.0, &b, &PlacementAssetRegistry::default(), &p.writes()).is_err());
            assert!(!p.root().exists());
        }
    }
    #[test]
    fn saves_originals_idempotently_and_reopens_both_formats() {
        for kind in ["tiled", "ldtk"] {
            let p = Project::new();
            let w = p.writes();
            let a = PlacementAssetRegistry::default();
            let b = fixture(kind);
            let saved = save_inner(&p.0, &b, &a, &w).unwrap();
            assert_eq!(saved, save_inner(&p.0, &b, &a, &w).unwrap());
            let loaded = load_inner(&p.0, &PlacementAssetRegistry::default(), &p.writes()).unwrap();
            assert_eq!(loaded, saved);
            assert!(loaded["assets"][0]["metadata"].get("frames").is_none());
            let id = b["revisions"][0]["assetId"].as_str().unwrap();
            assert_eq!(
                fs::read(p.root().join(format!("{id}.json"))).unwrap(),
                STANDARD
                    .decode(b["files"][0]["base64"].as_str().unwrap())
                    .unwrap()
            );
        }
    }
    #[test]
    fn rejects_unauthorized_or_invalid_sources_before_writes() {
        let p = Project::new();
        let a = PlacementAssetRegistry::default();
        assert!(save_inner(
            &p.0,
            &fixture("tiled"),
            &a,
            &PlacementWriteRegistry::default()
        )
        .is_err());
        for key in [
            "assetId",
            "pngSha256",
            "kind",
            "identityDocument",
            "pngName",
        ] {
            let mut b = fixture("tiled");
            b["revisions"][0][key] = json!("bad");
            assert!(save_inner(&p.0, &b, &a, &p.writes()).is_err());
        }
        assert!(!p.root().exists());
    }
    #[test]
    fn preserves_competing_file_and_rolls_back_owned_png() {
        let p = Project::new();
        let b = fixture("tiled");
        let w = p.writes();
        let a = PlacementAssetRegistry::default();
        fs::create_dir_all(p.root()).unwrap();
        let id = b["revisions"][0]["assetId"].as_str().unwrap();
        let path = p.root().join(format!("{id}.json"));
        fs::write(&path, b"external").unwrap();
        assert!(save_inner(&p.0, &b, &a, &w).is_err());
        assert_eq!(fs::read(path).unwrap(), b"external");
        assert_eq!(fs::read_dir(p.root()).unwrap().count(), 1);
        assert!(a.assets.lock().unwrap().is_empty());
    }
    #[test]
    fn changed_sources_are_rejected_on_load() {
        let p = Project::new();
        let b = fixture("ldtk");
        let w = p.writes();
        let a = PlacementAssetRegistry::default();
        save_inner(&p.0, &b, &a, &w).unwrap();
        let id = b["revisions"][0]["assetId"].as_str().unwrap();
        fs::write(p.root().join(format!("{id}.png")), b"tampered").unwrap();
        let fresh = PlacementAssetRegistry::default();
        assert!(load_inner(&p.0, &fresh, &w).is_err());
        assert!(fresh.assets.lock().unwrap().is_empty());
    }
}
