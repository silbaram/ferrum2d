//! Shared bounded immutable PNG/JSON storage for native sprite importers.
use super::asset_files::{bounded_read, create_file, read_catalog, rollback};
use super::{
    placement_asset_revision, placement_runtime_asset_url, CommandResult, PlacementAssetRegistry,
    PlacementDesktopError, PlacementWriteRegistry, RegisteredPlacementAsset,
    MAX_REGISTERED_ASSET_REVISIONS,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
const MAX_JSON: usize = 1024 * 1024;
const MAX_PNG: usize = 16 * 1024 * 1024;
const MAX_TOTAL: usize = 64 * 1024 * 1024;
const MAX_REVISIONS: usize = 8;
static SERIAL: AtomicU64 = AtomicU64::new(0);
type ValidateSource = fn(&Value, Vec<u8>, Vec<u8>, Vec<Dependency>) -> CommandResult<Source>;
#[derive(Debug)]
pub(super) struct Contract {
    pub(super) directory: &'static str,
    pub(super) prefix: &'static str,
    pub(super) bundle_format: &'static str,
    pub(super) catalog_format: &'static str,
    pub(super) project_format: &'static str,
    pub(super) max_dependencies: usize,
    pub(super) check_catalog_revision: bool,
    pub(super) validate: ValidateSource,
}
pub(super) fn invalid(detail: impl Into<String>) -> PlacementDesktopError {
    PlacementDesktopError::InvalidAssetFolderPath(detail.into())
}

pub(super) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn text<'a>(value: &'a Value, key: &str) -> CommandResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 1024)
        .ok_or_else(|| invalid(format!("missing or invalid {key}")))
}

pub(super) fn array<'a>(value: &'a Value, key: &str) -> CommandResult<&'a [Value]> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| invalid(format!("invalid {key}")))
}

pub(super) fn header(value: &Value, format: &str) -> CommandResult<()> {
    if value.get("format").and_then(Value::as_str) != Some(format)
        || value.get("version").and_then(Value::as_u64) != Some(1)
    {
        return Err(invalid("unsupported sprite catalog/bundle format"));
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Dependency {
    pub(super) source: String,
    pub(super) name: String,
    pub(super) sha256: String,
    pub(super) json: Vec<u8>,
}

#[derive(Debug)]
pub(super) struct Source {
    pub(super) metadata: Value,
    pub(super) png: Vec<u8>,
    pub(super) json: Vec<u8>,
    pub(super) dependencies: Vec<Dependency>,
}

impl Source {
    fn id(&self) -> CommandResult<&str> {
        text(&self.metadata, "assetId")
    }
    fn bytes(&self) -> usize {
        self.png.len()
            + self.json.len()
            + self
                .dependencies
                .iter()
                .map(|d| d.json.len())
                .sum::<usize>()
    }
}

fn dependency_metadata<'a>(contract: &Contract, meta: &'a Value) -> CommandResult<&'a [Value]> {
    let entries = if meta.get("dependencies").is_some() {
        array(meta, "dependencies")?
    } else {
        &[]
    };
    if entries.len() > contract.max_dependencies {
        return Err(invalid("external dependency budget exceeded"));
    }
    Ok(entries)
}
fn read_dependencies(
    contract: &Contract,
    meta: &Value,
    json_bytes: usize,
    read: impl Fn(usize, usize) -> CommandResult<Vec<u8>>,
) -> CommandResult<Vec<Dependency>> {
    let mut total = json_bytes;
    let mut result = Vec::new();
    for (i, entry) in dependency_metadata(contract, meta)?.iter().enumerate() {
        let bytes = read(i, MAX_JSON.saturating_sub(total))?;
        total += bytes.len();
        if total > MAX_JSON || text(entry, "sha256")? != hash(&bytes) {
            return Err(invalid("TSJ byte limit or SHA-256 differs"));
        }
        result.push(Dependency {
            source: text(entry, "source")?.to_owned(),
            name: text(entry, "name")?.to_owned(),
            sha256: hash(&bytes),
            json: bytes,
        });
    }
    Ok(result)
}

fn bundle_sources(contract: &Contract, bundle: &Value) -> CommandResult<Vec<Source>> {
    header(bundle, contract.bundle_format)?;
    if bundle.get("overwrite") != Some(&Value::Bool(false)) {
        return Err(invalid("Sprite assets must use overwrite:false"));
    }
    let revisions = array(bundle, "revisions")?;
    let files = array(bundle, "files")?;
    if revisions.is_empty()
        || revisions.len() > MAX_REVISIONS
        || files.len()
            != revisions
                .iter()
                .map(|meta| dependency_metadata(contract, meta).map(|d| 2 + d.len()))
                .collect::<CommandResult<Vec<_>>>()?
                .iter()
                .sum::<usize>()
    {
        return Err(invalid("Sprite project budget is 8 revisions / 64 MiB"));
    }
    let mut paths = HashSet::new();
    let mut result = Vec::new();
    let mut total = 0;
    for metadata in revisions {
        let id = text(metadata, "assetId")?;
        if !paths.insert(id) {
            return Err(invalid("duplicate asset revision"));
        }
        let read = |extension: &str, limit: usize, mime: &str| -> CommandResult<Vec<u8>> {
            let path = format!("{id}.{extension}");
            let found: Vec<_> = files
                .iter()
                .filter(|file| file.get("path").and_then(Value::as_str) == Some(&path))
                .collect();
            if found.len() != 1 || found[0].get("mediaType").and_then(Value::as_str) != Some(mime) {
                return Err(invalid("unexpected or duplicate asset file"));
            }
            let encoded = found[0]
                .get("base64")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("missing base64"))?;
            if encoded.len() > limit.div_ceil(3) * 4 {
                return Err(invalid("encoded asset exceeds byte limit"));
            }
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| invalid("invalid base64"))?;
            if bytes.len() > limit || text(found[0], "sha256")? != hash(&bytes) {
                return Err(invalid("asset SHA-256 differs"));
            }
            Ok(bytes)
        };
        if bundle
            .pointer("/manifest/textures")
            .and_then(|v| v.get(id))
            .and_then(Value::as_str)
            != Some(format!("{id}.png").as_str())
            || bundle
                .pointer("/manifest/textureOptions")
                .and_then(|v| v.get(id))
                .and_then(|v| v.get("colorSpace"))
                .and_then(Value::as_str)
                != Some("srgb")
        {
            return Err(invalid("manifest texture name/color space differs"));
        }
        let mut normalized = metadata.clone();
        if normalized.get("identityDocument").is_none() {
            normalized["identityDocument"] = bundle["document"].clone();
        }
        let json = read("json", MAX_JSON, "application/json")?;
        let dependencies = read_dependencies(contract, &normalized, json.len(), |i, limit| {
            read(&format!("dep.{i}.tsj"), limit, "application/json")
        })?;
        let source = (contract.validate)(
            &normalized,
            read("png", MAX_PNG, "image/png")?,
            json,
            dependencies,
        )?;
        total += source.bytes();
        if total > MAX_TOTAL {
            return Err(invalid("Sprite source budget exceeds 64 MiB"));
        }
        result.push(source);
    }
    Ok(result)
}

pub(super) fn directory(
    contract: &Contract,
    project: &Path,
    create: bool,
) -> CommandResult<Option<PathBuf>> {
    super::asset_files::directory(project, contract.directory, create)
}
fn publish_catalog(
    contract: &Contract,
    project: &Path,
    root: &Path,
    temporary: &Path,
    expected: Option<&[u8]>,
) -> CommandResult<()> {
    super::asset_files::publish_catalog(project, contract.directory, root, temporary, expected)
}
fn catalog_sources(
    contract: &Contract,
    root: &Path,
    bytes: Option<&[u8]>,
) -> CommandResult<Vec<Source>> {
    let Some(bytes) = bytes else {
        return Ok(Vec::new());
    };
    let catalog: Value =
        serde_json::from_slice(bytes).map_err(|_| invalid("invalid project catalog JSON"))?;
    header(&catalog, contract.catalog_format)?;
    let entries = array(&catalog, "revisions")?;
    if entries.len() > MAX_REVISIONS {
        return Err(invalid("project catalog exceeds 8 revisions"));
    }
    let mut ids = HashSet::new();
    let mut sources = Vec::new();
    let mut total = 0;
    for entry in entries {
        let id = text(entry, "assetId")?;
        if !id.starts_with(contract.prefix)
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
            || !ids.insert(id)
        {
            return Err(invalid("invalid or duplicate catalog revision"));
        }
        if catalog
            .pointer("/manifest/textures")
            .and_then(|v| v.get(id))
            .and_then(Value::as_str)
            != Some(format!("{id}.png").as_str())
            || catalog
                .pointer("/manifest/textureOptions")
                .and_then(|v| v.get(id))
                .and_then(|v| v.get("colorSpace"))
                .and_then(Value::as_str)
                != Some("srgb")
        {
            return Err(invalid("project catalog manifest differs"));
        }
        let json = bounded_read(&root.join(format!("{id}.json")), MAX_JSON)?;
        let dependencies = read_dependencies(contract, entry, json.len(), |i, limit| {
            bounded_read(&root.join(format!("{id}.dep.{i}.tsj")), limit)
        })?;
        let source = (contract.validate)(
            entry,
            bounded_read(&root.join(format!("{id}.png")), MAX_PNG)?,
            json,
            dependencies,
        )?;
        total += source.bytes();
        if total > MAX_TOTAL {
            return Err(invalid("project catalog exceeds 64 MiB"));
        }
        sources.push(source);
    }
    Ok(sources)
}

pub(super) fn register(
    contract: &Contract,
    root: &Path,
    sources: &[Source],
    registry: &PlacementAssetRegistry,
    publish: impl FnOnce() -> CommandResult<()>,
) -> CommandResult<Value> {
    let mut additions = HashMap::new();
    let mut assets = Vec::new();
    for source in sources {
        let id = source.id()?;
        let mut entry = json!({"metadata": source.metadata});
        let mut register_file = |extension: &str, mime| -> CommandResult<String> {
            let key = format!("{id}.{extension}");
            let path = root.join(&key);
            let revision = placement_asset_revision(&path)?;
            additions.insert(
                format!("@{revision}/{key}"),
                RegisteredPlacementAsset {
                    asset_root: root.to_owned(),
                    path,
                    mime_type: mime,
                    content_revision: Some(revision.clone()),
                },
            );
            Ok(format!(
                "{}?revision={revision}",
                placement_runtime_asset_url(&key)
            ))
        };
        entry["pngUrl"] = json!(register_file("png", "image/png")?);
        entry["jsonUrl"] = json!(register_file("json", "application/json")?);
        if !source.dependencies.is_empty() {
            let mut dependencies = Vec::new();
            for (i, dep) in source.dependencies.iter().enumerate() {
                dependencies.push(json!({"source":dep.source, "jsonUrl":register_file(&format!("dep.{i}.tsj"), "application/json")?}));
            }
            entry["dependencies"] = json!(dependencies);
        }
        assets.push(entry);
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
    Ok(json!({"format":contract.project_format, "version":1, "assets":assets}))
}

pub(super) fn save_inner(
    contract: &Contract,
    project: &Path,
    bundle: &Value,
    registry: &PlacementAssetRegistry,
    writes: &PlacementWriteRegistry,
) -> CommandResult<Value> {
    let project = writes.require_asset_project(project)?;
    // Validate all incoming bytes before touching the filesystem.
    let incoming = bundle_sources(contract, bundle)?;
    let _save = writes
        .scene_save_lock
        .lock()
        .map_err(|_| PlacementDesktopError::WriteRegistryUnavailable)?;
    let root =
        directory(contract, &project, true)?.ok_or_else(|| invalid("missing asset directory"))?;
    let previous = read_catalog(&root)?;
    if contract.check_catalog_revision
        && bundle
            .get("expectedCatalogRevision")
            .and_then(Value::as_str)
            != Some(previous.as_deref().map(hash).unwrap_or_default().as_str())
    {
        return Err(invalid(
            "project catalog changed on disk; reopen before saving",
        ));
    }
    let mut sources = catalog_sources(contract, &root, previous.as_deref())?;
    for source in incoming {
        if let Some(old) = sources
            .iter()
            .find(|old| old.metadata.get("assetId") == source.metadata.get("assetId"))
        {
            if old.metadata != source.metadata
                || old.png != source.png
                || old.json != source.json
                || old.dependencies != source.dependencies
            {
                return Err(invalid("immutable catalog revision differs"));
            }
        } else {
            sources.push(source);
        }
    }
    if sources.len() > MAX_REVISIONS || sources.iter().map(Source::bytes).sum::<usize>() > MAX_TOTAL
    {
        return Err(invalid("Sprite project budget is 8 revisions / 64 MiB"));
    }
    let mut created = Vec::new();
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    let temporary = root.join(format!(".catalog-{}-{serial}.tmp", std::process::id()));
    let result = (|| {
        for source in &sources {
            let id = source.id()?;
            create_file(&root.join(format!("{id}.png")), &source.png, &mut created)?;
            create_file(&root.join(format!("{id}.json")), &source.json, &mut created)?;
            for (i, dep) in source.dependencies.iter().enumerate() {
                create_file(
                    &root.join(format!("{id}.dep.{i}.tsj")),
                    &dep.json,
                    &mut created,
                )?;
            }
        }
        let mut textures = serde_json::Map::new();
        let mut options = serde_json::Map::new();
        for source in &sources {
            let id = source.id()?;
            textures.insert(id.to_owned(), Value::String(format!("{id}.png")));
            options.insert(id.to_owned(), json!({"colorSpace":"srgb"}));
        }
        let next = json!({"format":contract.catalog_format, "version":1, "revisions":sources.iter().map(|s| &s.metadata).collect::<Vec<_>>(),
            "manifest":{"textures":textures,"textureOptions":options}});
        let bytes = serde_json::to_vec_pretty(&next)
            .map_err(|_| invalid("catalog serialization failed"))?;
        if bytes.len() > MAX_JSON {
            return Err(invalid("catalog exceeds 1 MiB"));
        }
        create_file(&temporary, &bytes, &mut created)?;
        // Hold the registry lock across publication so failures cannot leave stale protocol entries.
        let mut response = register(contract, &root, &sources, registry, || {
            publish_catalog(contract, &project, &root, &temporary, previous.as_deref())
        })?;
        response["catalogRevision"] = json!(hash(&bytes));
        Ok(response)
    })();
    if result.is_err() {
        rollback(created);
    }
    result
}

pub(super) fn load_inner(
    contract: &Contract,
    project: &Path,
    registry: &PlacementAssetRegistry,
    writes: &PlacementWriteRegistry,
) -> CommandResult<Value> {
    let project = writes.require_asset_project(project)?;
    let _save = writes
        .scene_save_lock
        .lock()
        .map_err(|_| PlacementDesktopError::WriteRegistryUnavailable)?;
    let Some(root) = directory(contract, &project, false)? else {
        return Ok(
            json!({"format":contract.project_format, "version":1, "assets":[], "catalogRevision":""}),
        );
    };
    let catalog = read_catalog(&root)?;
    let sources = catalog_sources(contract, &root, catalog.as_deref())?;
    let mut response = register(contract, &root, &sources, registry, || Ok(()))?;
    response["catalogRevision"] = json!(catalog.as_deref().map(hash).unwrap_or_default());
    Ok(response)
}
