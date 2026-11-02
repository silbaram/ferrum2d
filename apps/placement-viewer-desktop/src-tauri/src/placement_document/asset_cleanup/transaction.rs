use super::*;
use serde_json::json;
use std::{
    io::Write,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static SERIAL: AtomicU64 = AtomicU64::new(0);
const MAX_BACKUPS: usize = 8;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    format: String,
    version: u8,
    id: String,
    kind: CatalogKind,
    before_hash: String,
    after_hash: String,
    selected: Vec<String>,
    created_at: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub id: String,
    pub kind: Option<CatalogKind>,
    pub selected: Vec<String>,
    pub created_at: u64,
    pub restored: bool,
    pub problem: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub backup_id: String,
    pub backup_path: String,
    pub removed_files: usize,
    pub removed_bytes: usize,
    pub requires_reload: bool,
}

fn clock() -> CommandResult<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| invalid("system clock unavailable"))?
        .as_millis()
        .try_into()
        .map_err(|_| invalid("system clock out of range"))
}
fn nonce() -> CommandResult<String> {
    Ok(hash(
        format!(
            "{}:{}:{}",
            std::process::id(),
            clock()?,
            SERIAL.fetch_add(1, Ordering::Relaxed)
        )
        .as_bytes(),
    ))
}
fn backup_root(project: &Path, create: bool) -> CommandResult<Option<PathBuf>> {
    let root = project.join(BACKUPS);
    if !root.exists() && create {
        fs::create_dir(&root).map_err(|e| io(&root, e))?;
    }
    match fs::symlink_metadata(&root) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io(&root, e)),
        Ok(_) => {
            regular_directory(&root)?;
            Ok(Some(root))
        }
    }
}
fn journal(root: &Path, id: &str) -> CommandResult<Journal> {
    if !digest(id) {
        return Err(invalid("invalid cleanup backup ID"));
    }
    let root = root.join(id);
    regular_directory(&root)?;
    let value: Journal = serde_json::from_slice(&asset_files::bounded_read(
        &root.join("journal.json"),
        16 * 1024,
    )?)
    .map_err(|_| {
        invalid(format!(
            "incomplete or invalid cleanup backup: {}",
            root.display()
        ))
    })?;
    if value.format != "ferrum2d.asset-cleanup.backup"
        || value.version != 1
        || value.id != id
        || !digest(&value.before_hash)
        || !digest(&value.after_hash)
        || value.selected.is_empty()
        || value.selected.len() > 8
        || value.selected.iter().collect::<BTreeSet<_>>().len() != value.selected.len()
    {
        return Err(invalid("invalid cleanup backup journal"));
    }
    Ok(value)
}
pub(super) fn backups(project: &Path) -> CommandResult<Vec<BackupSummary>> {
    let Some(root) = backup_root(project, false)? else {
        return Ok(Vec::new());
    };
    let mut result = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| io(&root, e))? {
        let entry = entry.map_err(|e| io(&root, e))?;
        if result.len() >= MAX_BACKUPS {
            return Err(invalid("cleanup backup limit reached; retain or archive existing backups before creating more"));
        }
        // A damaged/foreign child must not hide other valid recovery records.
        let id = entry.file_name().to_string_lossy().into_owned();
        let journal = match journal(&root, &id) {
            Ok(journal) => journal,
            Err(error) => {
                result.push(BackupSummary {
                    id,
                    kind: None,
                    selected: Vec::new(),
                    created_at: 0,
                    restored: false,
                    problem: Some(error.to_string()),
                });
                continue;
            }
        };
        let restored = (|| match fs::symlink_metadata(entry.path().join("restored.json")) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(io(&entry.path(), e)),
            Ok(_) => {
                let bytes = asset_files::bounded_read(&entry.path().join("restored.json"), 1024)?;
                let value: Value = serde_json::from_slice(&bytes)
                    .map_err(|_| invalid("invalid cleanup restore marker"))?;
                if value["beforeHash"] != journal.before_hash {
                    return Err(invalid("cleanup restore marker hash differs"));
                }
                Ok(true)
            }
        })();
        let (restored, problem) = match restored {
            Ok(value) => (value, None),
            Err(error) => (false, Some(error.to_string())),
        };
        result.push(BackupSummary {
            id,
            kind: Some(journal.kind),
            selected: journal.selected,
            created_at: journal.created_at,
            restored,
            problem,
        });
    }
    result.sort_by_key(|v| std::cmp::Reverse(v.created_at));
    Ok(result)
}

fn write_new(path: &Path, bytes: &[u8]) -> CommandResult<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| io(path, e))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| io(path, e))
}
pub(super) fn reduced(catalog: &Catalog, selected: &BTreeSet<&str>) -> CommandResult<Vec<u8>> {
    let mut value = catalog.value.clone();
    let field = if catalog.kind == CatalogKind::Normal {
        "entries"
    } else {
        "revisions"
    };
    value[field]
        .as_array_mut()
        .ok_or_else(|| invalid("catalog revision list missing"))?
        .retain(|entry| {
            let id = if catalog.kind == CatalogKind::Normal {
                entry.as_str()
            } else {
                entry["assetId"].as_str()
            };
            !id.is_some_and(|id| selected.contains(id))
        });
    let keep = catalog
        .revisions
        .iter()
        .filter(|r| !selected.contains(r.id.as_str()))
        .flat_map(|r| r.assets.iter())
        .collect::<BTreeSet<_>>();
    let removed = catalog
        .revisions
        .iter()
        .filter(|r| selected.contains(r.id.as_str()))
        .flat_map(|r| r.assets.iter())
        .filter(|name| !keep.contains(name))
        .collect::<BTreeSet<_>>();
    for map in ["textures", "textureOptions"] {
        let values = value["manifest"][map]
            .as_object_mut()
            .ok_or_else(|| invalid("catalog manifest missing"))?;
        for name in &removed {
            values.remove(name.as_str());
        }
    }
    let bytes = serde_json::to_vec_pretty(&value)
        .map_err(|_| invalid("cleanup catalog serialization failed"))?;
    // Extra catalog metadata can be valid but much larger after pretty printing.
    // Never publish bytes that read_catalog (also used by rollback) cannot read.
    if bytes.len() <= 1024 * 1024 {
        return Ok(bytes);
    }
    let compact =
        serde_json::to_vec(&value).map_err(|_| invalid("cleanup catalog serialization failed"))?;
    if compact.len() > 1024 * 1024 {
        return Err(invalid("reduced catalog exceeds 1 MiB"));
    }
    Ok(compact)
}
fn publish(
    project: &Path,
    kind: CatalogKind,
    root: &Path,
    bytes: &[u8],
    expected: Option<&[u8]>,
) -> CommandResult<()> {
    let temporary = root.join(format!(".cleanup-{}.tmp", nonce()?));
    write_new(&temporary, bytes)?;
    let result =
        asset_files::publish_catalog(project, kind.directory(), root, &temporary, expected);
    if result.is_err()
        && asset_files::bounded_read(&temporary, bytes.len()).is_ok_and(|v| v == bytes)
    {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn saved_catalog(project: &Path, id: &str) -> CommandResult<(Journal, Catalog)> {
    let root =
        backup_root(project, false)?.ok_or_else(|| invalid("cleanup backup directory missing"))?;
    let record = journal(&root, id)?;
    let catalog_root = root.join(id).join(record.kind.directory());
    regular_directory(&catalog_root)?;
    let bytes = asset_files::read_catalog(&catalog_root)?
        .ok_or_else(|| invalid("backup catalog missing"))?;
    if hash(&bytes) != record.before_hash {
        return Err(invalid("cleanup backup catalog hash differs"));
    }
    let original = catalog(record.kind, catalog_root, bytes)?;
    if !record
        .selected
        .iter()
        .all(|id| original.revisions.iter().any(|r| r.id == *id))
    {
        return Err(invalid("backup selection differs from original catalog"));
    }
    let selected = record
        .selected
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let after = reduced(&original, &selected)?;
    if hash(&after) != record.after_hash {
        return Err(invalid("cleanup backup after hash differs"));
    }
    Ok((record, original))
}

fn restore_files(root: &Path, original: &Catalog) -> CommandResult<()> {
    let originals = files(&original.revisions)?;
    // Check all destinations before creating even one file. Never replace changed originals.
    for file in originals.values() {
        match fs::symlink_metadata(root.join(&file.name)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(io(&root.join(&file.name), e)),
            Ok(_) => {
                checked_bytes(root, file)?;
            }
        }
    }
    let mut created = Vec::new();
    for file in originals.values() {
        let bytes = checked_bytes(&original.root, file)?;
        asset_files::create_file(&root.join(&file.name), &bytes, &mut created)?;
    }
    Ok(())
}
fn restore_original(project: &Path, record: &Journal, original: &Catalog) -> CommandResult<()> {
    let root = asset_files::directory(project, record.kind.directory(), true)?
        .ok_or_else(|| invalid("asset directory missing"))?;
    let current = asset_files::read_catalog(&root)?;
    let current_hash = current.as_deref().map(hash).unwrap_or_default();
    if current_hash != record.after_hash && current_hash != record.before_hash {
        return Err(invalid(
            "catalog changed after cleanup; restore will not overwrite newer edits",
        ));
    }
    restore_files(&root, original)?;
    publish(
        project,
        record.kind,
        &root,
        &original.bytes,
        current.as_deref(),
    )
}

/// Apply only an explicitly selected, unreferenced set from one unchanged catalog snapshot.
pub(in super::super) fn apply(
    project: &Path,
    request: CleanupRequest,
    writes: &PlacementWriteRegistry,
) -> CommandResult<CleanupResult> {
    apply_with_hook(project, request, writes, |_| Ok(()))
}

// Fault/concurrency tests can intervene at the actual publication boundary.
pub(super) fn apply_with_hook(
    project: &Path,
    request: CleanupRequest,
    writes: &PlacementWriteRegistry,
    before_publish: impl FnOnce(&Path) -> CommandResult<()>,
) -> CommandResult<CleanupResult> {
    apply_with_hooks(project, request, writes, before_publish, |_| Ok(()))
}

pub(super) fn apply_with_hooks(
    project: &Path,
    request: CleanupRequest,
    writes: &PlacementWriteRegistry,
    before_publish: impl FnOnce(&Path) -> CommandResult<()>,
    after_publish: impl FnOnce(&Path) -> CommandResult<()>,
) -> CommandResult<CleanupResult> {
    let project = writes.require_asset_project(project)?;
    let _guard = writes
        .scene_save_lock
        .lock()
        .map_err(|_| PlacementDesktopError::WriteRegistryUnavailable)?;
    if !digest(&request.expected_snapshot)
        || request.selected.is_empty()
        || request.selected.len() > 8
        || request.protected_keys.len() > 32
    {
        return Err(invalid("invalid cleanup selection or snapshot"));
    }
    let before = snapshot(&project)?;
    if before.report.snapshot != request.expected_snapshot {
        return Err(invalid("project changed on disk; analyze cleanup again"));
    }
    if before.report.backups.len() >= MAX_BACKUPS {
        return Err(invalid("cleanup backup limit is 8"));
    }
    let selected = request.selected.iter().collect::<BTreeSet<_>>();
    if selected.len() != request.selected.len() {
        return Err(invalid("duplicate cleanup selection"));
    }
    let revisions = selected
        .iter()
        .map(|key| {
            before
                .report
                .revisions
                .iter()
                .find(|r| &r.key == *key)
                .ok_or_else(|| invalid("unknown cleanup revision"))
        })
        .collect::<CommandResult<Vec<_>>>()?;
    let kind = revisions[0].kind;
    if revisions.iter().any(|r| {
        r.kind != kind || !r.references.is_empty() || request.protected_keys.contains(&r.key)
    }) {
        return Err(invalid(
            "cleanup selection is referenced, protected or spans catalogs",
        ));
    }
    let original = before
        .catalogs
        .iter()
        .find(|c| c.kind == kind)
        .ok_or_else(|| invalid("cleanup catalog missing"))?;
    let selected_ids = revisions
        .iter()
        .map(|r| r.id.as_str())
        .collect::<BTreeSet<_>>();
    let remaining = original
        .revisions
        .iter()
        .filter(|r| !selected_ids.contains(r.id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let keep = files(&remaining)?;
    let originals = files(&original.revisions)?;
    let removed = originals
        .values()
        .filter(|f| !keep.contains_key(&f.name))
        .collect::<Vec<_>>();
    let after = reduced(original, &selected_ids)?;
    let id = nonce()?;
    let backup_root =
        backup_root(&project, true)?.ok_or_else(|| invalid("backup directory missing"))?;
    let destination = backup_root.join(&id);
    fs::create_dir(&destination).map_err(|e| io(&destination, e))?;
    let saved = destination.join(kind.directory());
    fs::create_dir(&saved).map_err(|e| io(&saved, e))?;
    // A full, self-contained snapshot can be revalidated with the original catalog parser.
    for file in originals.values() {
        write_new(
            &saved.join(&file.name),
            &checked_bytes(&original.root, file)?,
        )?;
    }
    write_new(&saved.join("catalog.json"), &original.bytes)?;
    catalog(kind, saved, original.bytes.clone())?;
    let record = Journal {
        format: "ferrum2d.asset-cleanup.backup".into(),
        version: 1,
        id: id.clone(),
        kind,
        before_hash: hash(&original.bytes),
        after_hash: hash(&after),
        selected: selected_ids.iter().map(|id| (*id).to_owned()).collect(),
        created_at: clock()?,
    };
    write_new(
        &destination.join("journal.json"),
        &serde_json::to_vec_pretty(&record)
            .map_err(|_| invalid("backup journal serialization failed"))?,
    )?;
    // Backup creation and validation may take time. Recheck every source and reference before mutation.
    if snapshot(&project).map_err(|error| invalid(format!(
        "project inspection failed during backup; no originals removed. Backup: {}. {error}", destination.display()
    )))?.report.snapshot != request.expected_snapshot {
        return Err(invalid(format!(
            "project changed during backup; no originals removed. Backup: {}",
            destination.display()
        )));
    }
    let result = (|| {
        before_publish(&original.root)?;
        // Publish before unlinking: interruption leaves either a complete old
        // catalog or a loadable reduced one with harmless leftover sources.
        // Both states can be recovered using the prepared backup journal.
        publish(
            &project,
            kind,
            &original.root,
            &after,
            Some(&original.bytes),
        )?;
        after_publish(&original.root)?;
        for file in &removed {
            checked_bytes(&original.root, file)?;
            if asset_files::read_catalog(&original.root)?.as_deref() != Some(after.as_slice()) {
                return Err(invalid("catalog changed during cleanup"));
            }
            fs::remove_file(original.root.join(&file.name))
                .map_err(|e| io(&original.root.join(&file.name), e))?;
        }
        let mut expected = before.parts.clone();
        expected.insert(format!("catalog:{}", kind.directory()), hash(&after));
        for file in &removed {
            expected.remove(&format!("file:{}/{}", kind.directory(), file.name));
        }
        if snapshot(&project)?.report.snapshot != fingerprint(&expected)? {
            return Err(invalid(
                "project references or sources changed during cleanup",
            ));
        }
        Ok(())
    })();
    if let Err(error) = result {
        let (_, saved) = saved_catalog(&project, &id).map_err(|restore| {
            invalid(format!(
                "cleanup failed; recovery needs review. Backup: {}. {error}; {restore}",
                destination.display()
            ))
        })?;
        // Restore missing immutable files even if an external writer changed the
        // catalog. Its newer catalog is never overwritten by the rollback.
        restore_files(&original.root, &saved).map_err(|restore| {
            invalid(format!(
                "cleanup failed; recovery needs review. Backup: {}. {error}; {restore}",
                destination.display()
            ))
        })?;
        return match restore_original(&project, &record, &saved) {
            Ok(()) => Err(invalid(format!(
                "cleanup failed; originals restored. Backup: {}. {error}",
                destination.display()
            ))),
            Err(restore) => Err(invalid(format!(
                "cleanup failed; recovery needs review. Backup: {}. {error}; {restore}",
                destination.display()
            ))),
        };
    }
    Ok(CleanupResult {
        backup_id: id,
        backup_path: destination.to_string_lossy().into_owned(),
        removed_files: removed.len(),
        removed_bytes: removed.iter().map(|f| f.bytes).sum(),
        requires_reload: true,
    })
}

/// Restore an intact backup only while the live catalog still matches its recorded before/after state.
pub(in super::super) fn restore(
    project: &Path,
    id: &str,
    writes: &PlacementWriteRegistry,
) -> CommandResult<CleanupResult> {
    let project = writes.require_asset_project(project)?;
    let _guard = writes
        .scene_save_lock
        .lock()
        .map_err(|_| PlacementDesktopError::WriteRegistryUnavailable)?;
    if !digest(id) {
        return Err(invalid("invalid cleanup backup ID"));
    }
    let destination = project.join(BACKUPS).join(id);
    let (record, original) = saved_catalog(&project, id).map_err(|error| {
        invalid(format!(
            "restore validation failed; no originals changed. Backup: {}. {error}",
            destination.display()
        ))
    })?;
    restore_original(&project, &record, &original).map_err(|error| {
        invalid(format!(
            "restore incomplete; recovery needs review. Backup: {}. {error}",
            destination.display()
        ))
    })?;
    let marker = destination.join("restored.json");
    if !marker.exists() {
        write_new(
            &marker,
            &serde_json::to_vec(&json!({"beforeHash":record.before_hash}))
                .map_err(|_| invalid("restore marker serialization failed"))?,
        )?;
    }
    Ok(CleanupResult {
        backup_id: id.to_owned(),
        backup_path: destination.to_string_lossy().into_owned(),
        removed_files: 0,
        removed_bytes: 0,
        requires_reload: true,
    })
}
