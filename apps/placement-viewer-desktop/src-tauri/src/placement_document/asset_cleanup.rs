//! Explicit, bounded retirement of managed catalog revisions with recoverable originals.
#[cfg(test)]
mod tests;
mod transaction;

use super::{
    asset_files, normal_assets, sprite_assets, CommandResult, PlacementDesktopError,
    PlacementWriteRegistry,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

const MAX_SOURCE: usize = 64 * 1024 * 1024;
const MAX_JSON: usize = 2 * 1024 * 1024;
const MAX_SCAN: usize = 32 * 1024 * 1024;
const BACKUPS: &str = ".ferrum-asset-backups";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CatalogKind {
    Pixel,
    Aseprite,
    Tile,
    Normal,
}
impl CatalogKind {
    const ALL: [Self; 4] = [Self::Pixel, Self::Aseprite, Self::Tile, Self::Normal];
    fn directory(self) -> &'static str {
        match self {
            Self::Pixel => ".ferrum-pixels",
            Self::Aseprite => ".ferrum-aseprite",
            Self::Tile => ".ferrum-tiles",
            Self::Normal => ".ferrum-normals",
        }
    }
    fn key(self, id: &str) -> String {
        format!("{}:{id}", self.directory())
    }
    fn contract(self) -> Option<&'static sprite_assets::Contract> {
        match self {
            Self::Pixel => Some(&super::pixel_assets::CONTRACT),
            Self::Aseprite => Some(&super::aseprite_assets::CONTRACT),
            Self::Tile => Some(&super::tile_assets::CONTRACT),
            Self::Normal => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedFile {
    pub name: String,
    pub bytes: usize,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub key: String,
    pub kind: CatalogKind,
    pub id: String,
    pub assets: Vec<String>,
    pub files: Vec<ManagedFile>,
    pub references: BTreeSet<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    format: &'static str,
    version: u8,
    pub snapshot: String,
    pub revisions: Vec<Revision>,
    pub backups: Vec<transaction::BackupSummary>,
    pub catalogs: Vec<CatalogSummary>,
    pub json_files: usize,
    pub json_bytes: usize,
    deletion_allowed: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSummary {
    kind: CatalogKind,
    revisions: usize,
    backup_bytes: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupRequest {
    pub expected_snapshot: String,
    pub selected: Vec<String>,
    pub protected_keys: Vec<String>,
}

#[derive(Debug)]
struct Catalog {
    kind: CatalogKind,
    root: PathBuf,
    bytes: Vec<u8>,
    value: Value,
    revisions: Vec<Revision>,
}
struct Snapshot {
    report: CleanupReport,
    catalogs: Vec<Catalog>,
    parts: BTreeMap<String, String>,
}

fn invalid(detail: impl Into<String>) -> PlacementDesktopError {
    PlacementDesktopError::InvalidAssetFolderPath(detail.into())
}
fn io(path: &Path, source: std::io::Error) -> PlacementDesktopError {
    PlacementDesktopError::Io {
        path: path.to_owned(),
        source,
    }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn fingerprint(parts: &BTreeMap<String, String>) -> CommandResult<String> {
    Ok(hash(&serde_json::to_vec(parts).map_err(|_| {
        invalid("cleanup snapshot serialization failed")
    })?))
}
fn regular_directory(path: &Path) -> CommandResult<()> {
    let meta = fs::symlink_metadata(path).map_err(|e| io(path, e))?;
    if !meta.is_dir()
        || meta.file_type().is_symlink()
        || path.canonicalize().map_err(|e| io(path, e))? != path
    {
        return Err(invalid(format!(
            "cleanup directory is not canonical: {}",
            path.display()
        )));
    }
    Ok(())
}
fn file(name: String, bytes: &[u8]) -> ManagedFile {
    ManagedFile {
        name,
        bytes: bytes.len(),
        sha256: hash(bytes),
    }
}

fn catalog(kind: CatalogKind, root: PathBuf, bytes: Vec<u8>) -> CommandResult<Catalog> {
    regular_directory(&root)?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| invalid("invalid cleanup catalog JSON"))?;
    let mut revisions = Vec::new();
    if let Some(contract) = kind.contract() {
        for source in sprite_assets::catalog_sources(contract, &root, Some(&bytes))? {
            let id = sprite_assets::text(&source.metadata, "assetId")?.to_owned();
            let mut files = vec![
                file(format!("{id}.json"), &source.json),
                file(format!("{id}.png"), &source.png),
            ];
            if let Some(original) = &source.source_png {
                files.push(file(format!("{id}.source.png"), original));
            }
            for (index, dependency) in source.dependencies.iter().enumerate() {
                files.push(file(format!("{id}.dep.{index}.tsj"), &dependency.json));
            }
            revisions.push(Revision {
                key: kind.key(&id),
                kind,
                assets: vec![id.clone()],
                id,
                files,
                references: BTreeSet::new(),
            });
        }
    } else {
        for pair in normal_assets::load_pairs(&root, Some(&bytes))? {
            let id = pair.id();
            let mut files = vec![file(format!("{id}.json"), &pair.metadata)];
            let mut assets = Vec::new();
            for (index, channel) in ["color", "normal"].iter().enumerate() {
                let texture = &pair.binding()["textures"][channel];
                assets.push(
                    texture["asset"]
                        .as_str()
                        .ok_or_else(|| invalid("normal asset name missing"))?
                        .to_owned(),
                );
                files.push(file(
                    normal_assets::png_name(
                        texture["sha256"]
                            .as_str()
                            .ok_or_else(|| invalid("normal hash missing"))?,
                    ),
                    &pair.pngs[index],
                ));
            }
            revisions.push(Revision {
                key: kind.key(&id),
                kind,
                id,
                files,
                assets,
                references: BTreeSet::new(),
            });
        }
    }
    // Include catalog metadata references, not just the validated source JSON files.
    if revisions.len() > 8 {
        return Err(invalid("cleanup catalog exceeds revision budget"));
    }
    Ok(Catalog {
        kind,
        root,
        bytes,
        value,
        revisions,
    })
}

fn files(revisions: &[Revision]) -> CommandResult<BTreeMap<String, ManagedFile>> {
    let mut result = BTreeMap::new();
    for revision in revisions {
        for file in &revision.files {
            if let Some(previous) = result.insert(file.name.clone(), file.clone()) {
                if previous != *file {
                    return Err(invalid("shared managed file has conflicting content"));
                }
            }
        }
    }
    if result.len() > 512 || result.values().map(|f| f.bytes).sum::<usize>() > MAX_SOURCE {
        return Err(invalid("cleanup catalog exceeds source budget"));
    }
    Ok(result)
}

fn checked_bytes(root: &Path, expected: &ManagedFile) -> CommandResult<Vec<u8>> {
    regular_directory(root)?;
    let bytes = asset_files::bounded_read(&root.join(&expected.name), expected.bytes)?;
    if bytes.len() != expected.bytes || hash(&bytes) != expected.sha256 {
        return Err(invalid("managed source changed on disk; analyze again"));
    }
    Ok(bytes)
}

fn references(revisions: &mut [Revision], text: &str, origin: &str, owners: &[Revision]) {
    for revision in revisions {
        if owners.iter().any(|owner| owner.key == revision.key) {
            continue;
        }
        let own_asset = |id: &String| {
            owners
                .iter()
                .any(|owner| owner.kind == revision.kind && owner.assets.contains(id))
        };
        let own_file = |name: &str| {
            owners.iter().any(|owner| {
                owner.kind == revision.kind && owner.files.iter().any(|file| file.name == name)
            })
        };
        if text.contains(&revision.id)
            || revision
                .assets
                .iter()
                .any(|id| !own_asset(id) && text.contains(id))
            || revision
                .files
                .iter()
                .any(|file| !own_file(&file.name) && text.contains(&file.name))
        {
            revision.references.insert(origin.to_owned());
        }
    }
}

// Numeric runtime handles cannot be mapped safely from a closed source file.
// Keep every revision rather than treating an unresolved handle as no reference.
fn protect_numeric_textures(revisions: &mut [Revision], value: &Value, origin: &str) {
    fn has_numeric_texture(value: &Value) -> bool {
        match value {
            Value::Object(object) => object.iter().any(|(key, value)| {
                (matches!(
                    key.as_str(),
                    "texture"
                        | "normalTexture"
                        | "emissionTexture"
                        | "specularTexture"
                        | "roughnessTexture"
                ) && value.is_number())
                    || has_numeric_texture(value)
            }),
            Value::Array(values) => values.iter().any(has_numeric_texture),
            _ => false,
        }
    }
    if has_numeric_texture(value) {
        for revision in revisions {
            revision
                .references
                .insert(format!("{origin}: unresolved numeric texture"));
        }
    }
}

#[derive(Default)]
struct ScanBudget {
    nodes: usize,
    files: usize,
    bytes: usize,
}
fn scan_public(
    root: &Path,
    path: &Path,
    depth: usize,
    budget: &mut ScanBudget,
    revisions: &mut [Revision],
    parts: &mut BTreeMap<String, String>,
) -> CommandResult<()> {
    regular_directory(path)?;
    if depth > 8 {
        return Err(invalid("cleanup JSON scan exceeds depth 8"));
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| io(path, e))? {
        if budget.nodes + entries.len() >= 4096 {
            return Err(invalid("cleanup scan exceeds 4096 entries"));
        }
        entries.push(entry.map_err(|e| io(path, e))?);
    }
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        budget.nodes += 1;
        if budget.nodes > 4096 {
            return Err(invalid("cleanup scan exceeds 4096 entries"));
        }
        let path = entry.path();
        let name = entry.file_name();
        if !name
            .to_str()
            .is_some_and(|name| !name.contains('\\') && !name.chars().any(char::is_control))
        {
            return Err(invalid("cleanup scan encountered an unsupported file name"));
        }
        let metadata = fs::symlink_metadata(&path).map_err(|e| io(&path, e))?;
        if metadata.file_type().is_symlink() {
            return Err(invalid(format!(
                "cleanup scan encountered a link: {}",
                path.display()
            )));
        }
        if metadata.is_dir() {
            scan_public(root, &path, depth + 1, budget, revisions, parts)?;
        } else if path
            .extension()
            .and_then(|v| v.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        {
            // Registered originals/catalogs were already validated with their
            // own larger bounds. Still inspect loose JSON inside managed roots.
            let relative = path
                .strip_prefix(root)
                .map_err(|_| invalid("cleanup scan escaped public"))?
                .to_string_lossy()
                .replace('\\', "/");
            if CatalogKind::ALL
                .iter()
                .any(|kind| relative == format!("assets/{}/catalog.json", kind.directory()))
                || relative
                    .strip_prefix("assets/")
                    .is_some_and(|name| parts.contains_key(&format!("file:{name}")))
            {
                continue;
            }
            if !metadata.is_file() {
                return Err(invalid("cleanup JSON must be a regular file"));
            }
            budget.files += 1;
            if budget.files > 256 {
                return Err(invalid("cleanup scan exceeds 256 JSON files"));
            }
            let bytes = asset_files::bounded_read(
                &path,
                MAX_JSON.min(MAX_SCAN.saturating_sub(budget.bytes)),
            )?;
            budget.bytes += bytes.len();
            let value = serde_json::from_slice::<Value>(&bytes).map_err(|_| {
                invalid(format!(
                    "cleanup scan found invalid JSON: {}",
                    path.display()
                ))
            })?;
            let text =
                std::str::from_utf8(&bytes).map_err(|_| invalid("cleanup JSON must be UTF-8"))?;
            let relative = path
                .strip_prefix(root)
                .map_err(|_| invalid("cleanup scan escaped public"))?
                .to_string_lossy()
                .replace('\\', "/");
            parts.insert(format!("json:{relative}"), hash(&bytes));
            // Search decoded strings too: escaped asset names must not evade protection.
            let decoded = serde_json::to_string(&value)
                .map_err(|_| invalid("cleanup JSON serialization failed"))?;
            references(revisions, text, &format!("public/{relative}"), &[]);
            references(revisions, &decoded, &format!("public/{relative}"), &[]);
            protect_numeric_textures(revisions, &value, &format!("public/{relative}"));
        }
    }
    Ok(())
}

fn snapshot(project: &Path) -> CommandResult<Snapshot> {
    let mut catalogs = Vec::new();
    let mut revisions = Vec::new();
    let mut parts = BTreeMap::new();
    for kind in CatalogKind::ALL {
        let Some(root) = asset_files::directory(project, kind.directory(), false)? else {
            parts.insert(format!("catalog:{}", kind.directory()), String::new());
            continue;
        };
        let Some(bytes) = asset_files::read_catalog(&root)? else {
            parts.insert(format!("catalog:{}", kind.directory()), String::new());
            continue;
        };
        parts.insert(format!("catalog:{}", kind.directory()), hash(&bytes));
        let value = catalog(kind, root, bytes)?;
        for file in files(&value.revisions)?.values() {
            parts.insert(
                format!("file:{}/{}", kind.directory(), file.name),
                file.sha256.clone(),
            );
        }
        revisions.extend(value.revisions.clone());
        catalogs.push(value);
    }
    for catalog in &catalogs {
        let mut extra = catalog.value.clone();
        if let Some(object) = extra.as_object_mut() {
            for name in ["revisions", "entries"] {
                object.remove(name);
            }
        }
        if let Some(manifest) = extra.get_mut("manifest").and_then(Value::as_object_mut) {
            for name in ["textures", "textureOptions"] {
                manifest.remove(name);
            }
        }
        references(
            &mut revisions,
            &extra.to_string(),
            &format!("catalog:{}:metadata", catalog.kind.directory()),
            &[],
        );
        protect_numeric_textures(
            &mut revisions,
            &extra,
            &format!("catalog:{}:metadata", catalog.kind.directory()),
        );
        for file in files(&catalog.revisions)?
            .values()
            .filter(|f| f.name.ends_with(".json") || f.name.ends_with(".tsj"))
        {
            let bytes = checked_bytes(&catalog.root, file)?;
            let value: Value =
                serde_json::from_slice(&bytes).map_err(|_| invalid("invalid managed JSON"))?;
            let decoded = serde_json::to_string(&value)
                .map_err(|_| invalid("managed JSON serialization failed"))?;
            let owners = catalog
                .revisions
                .iter()
                .filter(|r| r.files.iter().any(|f| f.name == file.name))
                .cloned()
                .collect::<Vec<_>>();
            references(
                &mut revisions,
                &decoded,
                &format!("assets/{}/{}", catalog.kind.directory(), file.name),
                &owners,
            );
            protect_numeric_textures(
                &mut revisions,
                &value,
                &format!("assets/{}/{}", catalog.kind.directory(), file.name),
            );
        }
        if let Some(entries) = catalog.value["revisions"].as_array() {
            for entry in entries {
                let owner = catalog
                    .revisions
                    .iter()
                    .filter(|r| entry["assetId"].as_str() == Some(r.id.as_str()))
                    .cloned()
                    .collect::<Vec<_>>();
                references(
                    &mut revisions,
                    &entry.to_string(),
                    &format!("catalog:{}", catalog.kind.directory()),
                    &owner,
                );
                protect_numeric_textures(
                    &mut revisions,
                    entry,
                    &format!("catalog:{}", catalog.kind.directory()),
                );
            }
        }
        for name in ["textures", "textureOptions"] {
            if let Some(entries) = catalog.value["manifest"][name].as_object() {
                for (key, value) in entries {
                    let owners = catalog
                        .revisions
                        .iter()
                        .filter(|revision| revision.assets.contains(key))
                        .cloned()
                        .collect::<Vec<_>>();
                    let origin = format!("catalog:{}:manifest", catalog.kind.directory());
                    references(&mut revisions, &format!("{key}: {value}"), &origin, &owners);
                    protect_numeric_textures(&mut revisions, value, &origin);
                }
            }
        }
    }
    let mut budget = ScanBudget::default();
    let public = project.join("public");
    scan_public(&public, &public, 0, &mut budget, &mut revisions, &mut parts)?;
    let report = CleanupReport {
        format: "ferrum2d.asset-cleanup",
        version: 1,
        snapshot: fingerprint(&parts)?,
        revisions,
        catalogs: catalogs
            .iter()
            .map(|c| {
                Ok(CatalogSummary {
                    kind: c.kind,
                    revisions: c.revisions.len(),
                    backup_bytes: files(&c.revisions)?
                        .values()
                        .map(|f| f.bytes)
                        .sum::<usize>()
                        + c.bytes.len(),
                })
            })
            .collect::<CommandResult<Vec<_>>>()?,
        backups: transaction::backups(project)?,
        json_files: budget.files,
        json_bytes: budget.bytes,
        deletion_allowed: false,
    };
    Ok(Snapshot {
        report,
        catalogs,
        parts,
    })
}

/// Read-only inspection never grants scene write authority or registers asset URLs.
pub(super) fn inspect(
    project: &Path,
    writes: &PlacementWriteRegistry,
) -> CommandResult<CleanupReport> {
    let project = writes.require_asset_project(project)?;
    let _guard = writes
        .scene_save_lock
        .lock()
        .map_err(|_| PlacementDesktopError::WriteRegistryUnavailable)?;
    Ok(snapshot(&project)?.report)
}
pub(super) use transaction::BackupSummary;
#[cfg(feature = "desktop")]
pub(super) use transaction::CleanupResult;
#[cfg(any(feature = "desktop", test))]
pub(super) use transaction::{apply, restore};

/// Recovery discovery must not depend on current public JSON/catalog being parseable.
pub(super) fn list_backups(
    project: &Path,
    writes: &PlacementWriteRegistry,
) -> CommandResult<Vec<BackupSummary>> {
    let project = writes.require_asset_project(project)?;
    let _guard = writes
        .scene_save_lock
        .lock()
        .map_err(|_| PlacementDesktopError::WriteRegistryUnavailable)?;
    transaction::backups(&project)
}
