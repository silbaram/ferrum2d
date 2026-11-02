use super::super::{aseprite_assets, pixel_assets, tile_assets, PlacementAssetRegistry};
use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};

static SERIAL: AtomicU64 = AtomicU64::new(0);
struct Project {
    root: PathBuf,
    writes: PlacementWriteRegistry,
    assets: PlacementAssetRegistry,
}
impl Project {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "ferrum-cleanup-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("public")).unwrap();
        let root = root.canonicalize().unwrap();
        fs::write(root.join("public/scene-authoring.json"), serde_json::to_vec(&json!({"format":"ferrum2d.consumer.scene-authoring","version":1,"sceneComposition":{"prefabs":{},"fragments":{}}})).unwrap()).unwrap();
        let writes = PlacementWriteRegistry::default();
        writes.authorize_project(&root).unwrap();
        Self {
            root,
            writes,
            assets: PlacementAssetRegistry::default(),
        }
    }
    fn pixel(&self, color: u8) -> String {
        let mut bundle = pixel_assets::tests::fixture(color);
        let current = pixel_assets::load_inner(&self.root, &self.assets, &self.writes).unwrap();
        bundle["expectedCatalogRevision"] = current["catalogRevision"].clone();
        let id = bundle["revisions"][0]["assetId"]
            .as_str()
            .unwrap()
            .to_owned();
        pixel_assets::save_inner(&self.root, &bundle, &self.assets, &self.writes).unwrap();
        id
    }
    fn request(&self, key: &str) -> CleanupRequest {
        CleanupRequest {
            expected_snapshot: inspect(&self.root, &self.writes).unwrap().snapshot,
            selected: vec![key.into()],
            protected_keys: Vec::new(),
        }
    }
    fn catalog(&self, kind: CatalogKind) -> Vec<u8> {
        fs::read(
            self.root
                .join("public/assets")
                .join(kind.directory())
                .join("catalog.json"),
        )
        .unwrap()
    }
}
impl Drop for Project {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn inspection_is_read_only_and_does_not_grant_scene_write_authority() {
    let project = Project::new();
    let id = project.pixel(1);
    let before = project.catalog(CatalogKind::Pixel);
    assert!(inspect(&project.root, &PlacementWriteRegistry::default()).is_err());
    let report = inspect(&project.root, &project.writes).unwrap();
    assert_eq!(report.revisions.len(), 1);
    assert_eq!(report.revisions[0].id, id);
    assert!(report.revisions[0].references.is_empty());
    assert!(!report.deletion_allowed);
    assert!(report.backups.is_empty());
    assert_eq!(report.json_files, 1);
    assert_eq!(project.catalog(CatalogKind::Pixel), before);
    assert!(!project.root.join(BACKUPS).exists());
    assert!(project
        .writes
        .require_scene_document(&project.root.join("public/scene-authoring.json"))
        .is_err());
}

#[test]
fn closed_unknown_json_and_escaped_names_protect_assets() {
    let project = Project::new();
    let id = project.pixel(2);
    let key = CatalogKind::Pixel.key(&id);
    fs::create_dir(project.root.join("public/closed")).unwrap();
    fs::write(
        project.root.join("public/closed/room.json"),
        format!(
            "{{\"unused\":{{\"asset\":\"{}\"}}}}",
            id.replacen('p', "\\u0070", 1)
        ),
    )
    .unwrap();
    let report = inspect(&project.root, &project.writes).unwrap();
    assert!(report.revisions[0]
        .references
        .contains("public/closed/room.json"));
    assert!(apply(&project.root, project.request(&key), &project.writes).is_err());
    assert!(!project.root.join(BACKUPS).exists());
}

#[test]
fn catalog_metadata_and_extra_manifest_aliases_protect_sources() {
    let project = Project::new();
    let id = project.pixel(3);
    project.pixel(4);
    let root = project.root.join("public/assets/.ferrum-pixels");
    let mut value: Value = serde_json::from_slice(&project.catalog(CatalogKind::Pixel)).unwrap();
    value["manifest"]["textures"]["legacy-alias"] = json!(format!("{id}.png"));
    fs::write(
        root.join("catalog.json"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    let report = inspect(&project.root, &project.writes).unwrap();
    assert!(report
        .revisions
        .iter()
        .find(|r| r.id == id)
        .unwrap()
        .references
        .iter()
        .any(|r| r.contains(":manifest")));
}

#[test]
fn registered_texture_option_metadata_protects_other_revisions() {
    let project = Project::new();
    let owner = project.pixel(24);
    let target = project.pixel(25);
    let mut catalog: Value = serde_json::from_slice(&project.catalog(CatalogKind::Pixel)).unwrap();
    catalog["manifest"]["textureOptions"][&owner]["previewSource"] = json!(target);
    fs::write(
        project
            .root
            .join("public/assets/.ferrum-pixels/catalog.json"),
        serde_json::to_vec(&catalog).unwrap(),
    )
    .unwrap();
    let report = inspect(&project.root, &project.writes).unwrap();
    let target = report
        .revisions
        .iter()
        .find(|revision| revision.id == target)
        .unwrap();
    assert!(target
        .references
        .contains("catalog:.ferrum-pixels:manifest"));
    assert!(report
        .revisions
        .iter()
        .find(|revision| revision.id == owner)
        .unwrap()
        .references
        .is_empty());
    assert!(apply(&project.root, project.request(&target.key), &project.writes).is_err());
    assert!(!project.root.join(BACKUPS).exists());
}

#[test]
fn loose_managed_json_and_extra_catalog_metadata_protect_sources() {
    let project = Project::new();
    let id = project.pixel(18);
    let root = project.root.join("public/assets/.ferrum-pixels");
    fs::write(
        root.join("custom.JSON"),
        serde_json::to_vec(&json!({"asset":id})).unwrap(),
    )
    .unwrap();
    let report = inspect(&project.root, &project.writes).unwrap();
    assert!(report.revisions[0]
        .references
        .contains("public/assets/.ferrum-pixels/custom.JSON"));
    fs::remove_file(root.join("custom.JSON")).unwrap();
    let mut catalog: Value = serde_json::from_slice(&project.catalog(CatalogKind::Pixel)).unwrap();
    catalog["custom"] = json!({"texture":id});
    fs::write(
        root.join("catalog.json"),
        serde_json::to_vec(&catalog).unwrap(),
    )
    .unwrap();
    assert!(
        inspect(&project.root, &project.writes).unwrap().revisions[0]
            .references
            .contains("catalog:.ferrum-pixels:metadata")
    );
    assert!(!project.root.join(BACKUPS).exists());
}

#[test]
fn unresolved_numeric_textures_protect_all_candidates() {
    let project = Project::new();
    project.pixel(19);
    let path = project.root.join("public/numeric.json");
    fs::write(&path, br#"{"sceneComposition":{"prefabs":{"hero":{"props":{"components":{"visual":{"kind":"sprite","texture":7}}}}}}}"#).unwrap();
    let report = inspect(&project.root, &project.writes).unwrap();
    assert!(report.revisions[0]
        .references
        .iter()
        .any(|reference| reference.contains("unresolved numeric texture")));
    assert!(apply(
        &project.root,
        project.request(&report.revisions[0].key),
        &project.writes
    )
    .is_err());
    assert!(!project.root.join(BACKUPS).exists());
}

#[test]
fn normal_revision_identity_is_protected_without_a_texture_or_file_reference() {
    let project = Project::new();
    let (metadata, files) = normal_assets::tests::fixture(3);
    normal_assets::save_inner(
        &project.root,
        &metadata,
        &files,
        &project.assets,
        &project.writes,
    )
    .unwrap();
    let id = hash(metadata.as_bytes());
    fs::write(
        project.root.join("public/pairs.json"),
        serde_json::to_vec(&json!({"normalPairId":id})).unwrap(),
    )
    .unwrap();
    let report = inspect(&project.root, &project.writes).unwrap();
    assert_eq!(report.revisions[0].id, id);
    assert!(report.revisions[0].references.contains("public/pairs.json"));
}

#[test]
fn reducing_a_large_compact_catalog_never_publishes_an_unreadable_pretty_catalog() {
    let project = Project::new();
    let id = project.pixel(23);
    let root = project.root.join("public/assets/.ferrum-pixels");
    let mut catalog: Value = serde_json::from_slice(&project.catalog(CatalogKind::Pixel)).unwrap();
    catalog["notes"] = json!(vec![0; 200_000]);
    let original = serde_json::to_vec(&catalog).unwrap();
    assert!(original.len() < 1024 * 1024);
    assert!(serde_json::to_vec_pretty(&catalog).unwrap().len() > 1024 * 1024);
    fs::write(root.join("catalog.json"), &original).unwrap();
    let result = apply(
        &project.root,
        project.request(&CatalogKind::Pixel.key(&id)),
        &project.writes,
    )
    .expect("a valid compact catalog must remain loadable after retirement");
    let after = asset_files::read_catalog(&root).unwrap().unwrap();
    let value: Value = serde_json::from_slice(&after).unwrap();
    assert_eq!(value["notes"], catalog["notes"]);
    assert_eq!(
        inspect(&project.root, &project.writes)
            .unwrap()
            .revisions
            .len(),
        0
    );
    restore(&project.root, &result.backup_id, &project.writes).unwrap();
    assert_eq!(project.catalog(CatalogKind::Pixel), original);
}

#[test]
fn all_catalog_types_retire_restore_exactly_and_keep_shared_files() {
    let project = Project::new();
    project.pixel(5);
    project.pixel(6);
    for color in [1, 2] {
        aseprite_assets::save_inner(
            &project.root,
            &aseprite_assets::tests::fixture(color),
            &project.assets,
            &project.writes,
        )
        .unwrap();
    }
    for kind in ["tiled", "ldtk"] {
        tile_assets::save_inner(
            &project.root,
            &tile_assets::tests::fixture(kind),
            &project.assets,
            &project.writes,
        )
        .unwrap();
    }
    for index in [1, 2] {
        let (metadata, files) = normal_assets::tests::fixture(index);
        normal_assets::save_inner(
            &project.root,
            &metadata,
            &files,
            &project.assets,
            &project.writes,
        )
        .unwrap();
    }
    let scene = fs::read(project.root.join("public/scene-authoring.json")).unwrap();
    for kind in CatalogKind::ALL {
        let before = snapshot(&project.root).unwrap();
        let catalog_before = project.catalog(kind);
        let candidates = before
            .report
            .revisions
            .iter()
            .filter(|r| r.kind == kind)
            .collect::<Vec<_>>();
        assert_eq!(candidates.len(), 2);
        assert!(candidates[0].references.is_empty(), "{:?}", candidates[0]);
        let selected = candidates[0];
        let remaining = candidates[1];
        let result = apply(
            &project.root,
            project.request(&selected.key),
            &project.writes,
        )
        .unwrap();
        assert!(result.requires_reload);
        assert!(result.removed_files > 0);
        let after = inspect(&project.root, &project.writes).unwrap();
        assert_eq!(after.revisions.iter().filter(|r| r.kind == kind).count(), 1);
        let live = project.root.join("public/assets").join(kind.directory());
        for file in &remaining.files {
            assert!(live.join(&file.name).is_file());
        }
        for file in &selected.files {
            if !remaining.files.iter().any(|f| f.name == file.name) {
                assert!(!live.join(&file.name).exists());
            }
        }
        restore(&project.root, &result.backup_id, &project.writes).unwrap();
        assert_eq!(project.catalog(kind), catalog_before);
        assert_eq!(
            fs::read(project.root.join("public/scene-authoring.json")).unwrap(),
            scene
        );
        assert_eq!(
            inspect(&project.root, &project.writes).unwrap().snapshot,
            before.report.snapshot
        );
        restore(&project.root, &result.backup_id, &project.writes).unwrap();
    }
}

#[test]
fn stale_disk_state_and_open_workspace_protection_reject_without_backup() {
    let project = Project::new();
    let id = project.pixel(7);
    let key = CatalogKind::Pixel.key(&id);
    let mut protected = project.request(&key);
    protected.protected_keys.push(key.clone());
    assert!(apply(&project.root, protected, &project.writes).is_err());
    let stale = project.request(&key);
    fs::write(project.root.join("public/new.json"), b"{}").unwrap();
    assert!(apply(&project.root, stale, &project.writes)
        .unwrap_err()
        .to_string()
        .contains("changed"));
    assert!(!project.root.join(BACKUPS).exists());
}

#[test]
fn new_scene_reference_during_publication_rolls_back_without_changing_scene() {
    let project = Project::new();
    let id = project.pixel(8);
    let before = project.catalog(CatalogKind::Pixel);
    let scene = project.root.join("public/late.json");
    let bytes = serde_json::to_vec(&json!({"asset":id})).unwrap();
    let result = transaction::apply_with_hook(
        &project.root,
        project.request(&CatalogKind::Pixel.key(&id)),
        &project.writes,
        |_| fs::write(&scene, &bytes).map_err(|e| io(&scene, e)),
    );
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("originals restored"));
    assert_eq!(project.catalog(CatalogKind::Pixel), before);
    assert_eq!(fs::read(&scene).unwrap(), bytes);
    assert_eq!(
        inspect(&project.root, &project.writes)
            .unwrap()
            .revisions
            .len(),
        1
    );
}

#[test]
fn publish_conflict_restores_files_and_does_not_overwrite_external_catalog() {
    let project = Project::new();
    let id = project.pixel(9);
    let root = project.root.join("public/assets/.ferrum-pixels");
    let path = root.join(format!("{id}.json"));
    let original = fs::read(&path).unwrap();
    let foreign = b"{\"external\":true}";
    let result = transaction::apply_with_hook(
        &project.root,
        project.request(&CatalogKind::Pixel.key(&id)),
        &project.writes,
        |root| fs::write(root.join("catalog.json"), foreign).map_err(|e| io(root, e)),
    );
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("recovery needs review"));
    assert_eq!(fs::read(&path).unwrap(), original);
    assert_eq!(fs::read(root.join("catalog.json")).unwrap(), foreign);
}

#[test]
fn backup_tamper_and_newer_catalog_prevent_restore() {
    let project = Project::new();
    let id = project.pixel(10);
    let result = apply(
        &project.root,
        project.request(&CatalogKind::Pixel.key(&id)),
        &project.writes,
    )
    .unwrap();
    let before = project.catalog(CatalogKind::Pixel);
    assert!(restore(&project.root, "../bad", &project.writes).is_err());
    let backup_png = Path::new(&result.backup_path)
        .join(".ferrum-pixels")
        .join(format!("{id}.png"));
    let original = fs::read(&backup_png).unwrap();
    fs::write(&backup_png, b"changed").unwrap();
    assert!(restore(&project.root, &result.backup_id, &project.writes).is_err());
    assert_eq!(project.catalog(CatalogKind::Pixel), before);
    fs::write(&backup_png, original).unwrap();
    project.pixel(11);
    let newer = project.catalog(CatalogKind::Pixel);
    assert!(restore(&project.root, &result.backup_id, &project.writes)
        .unwrap_err()
        .to_string()
        .contains("newer"));
    assert_eq!(project.catalog(CatalogKind::Pixel), newer);
}

#[test]
fn interruption_after_publish_leaves_a_loadable_catalog_and_recoverable_backup() {
    let project = Project::new();
    let id = project.pixel(14);
    let keep = project.pixel(15);
    let before = project.catalog(CatalogKind::Pixel);
    let interrupted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        transaction::apply_with_hooks(
            &project.root,
            project.request(&CatalogKind::Pixel.key(&id)),
            &project.writes,
            |_| Ok(()),
            |_| panic!("simulated process interruption after publication"),
        )
    }));
    assert!(interrupted.is_err());
    // A restarted host has a fresh registry; no in-memory lock/journal is needed.
    let writes = PlacementWriteRegistry::default();
    writes.authorize_project(&project.root).unwrap();
    let loaded = pixel_assets::load_inner(&project.root, &project.assets, &writes).unwrap();
    assert_eq!(loaded["assets"].as_array().unwrap().len(), 1);
    assert_eq!(loaded["assets"][0]["metadata"]["assetId"], keep);
    let report = inspect(&project.root, &writes).unwrap();
    assert_eq!(report.backups.len(), 1);
    restore(&project.root, &report.backups[0].id, &writes).unwrap();
    assert_eq!(project.catalog(CatalogKind::Pixel), before);
}

#[test]
fn failed_unlink_rolls_back_published_catalog_and_original_files() {
    let project = Project::new();
    let id = project.pixel(16);
    let before = project.catalog(CatalogKind::Pixel);
    let failure = transaction::apply_with_hooks(
        &project.root,
        project.request(&CatalogKind::Pixel.key(&id)),
        &project.writes,
        |_| Ok(()),
        |_| Err(invalid("simulated unlink failure")),
    );
    assert!(failure
        .unwrap_err()
        .to_string()
        .contains("originals restored"));
    assert_eq!(project.catalog(CatalogKind::Pixel), before);
    assert_eq!(
        inspect(&project.root, &project.writes)
            .unwrap()
            .revisions
            .len(),
        1
    );
}

#[test]
fn incomplete_backups_are_reported_and_counted_without_blocking_valid_recovery() {
    let project = Project::new();
    let id = project.pixel(17);
    let before = project.catalog(CatalogKind::Pixel);
    let result = apply(
        &project.root,
        project.request(&CatalogKind::Pixel.key(&id)),
        &project.writes,
    )
    .unwrap();
    for i in 0..7 {
        fs::create_dir(project.root.join(BACKUPS).join(format!("partial-{i}"))).unwrap();
    }
    let report = inspect(&project.root, &project.writes).unwrap();
    assert_eq!(report.backups.len(), 8);
    assert_eq!(
        report
            .backups
            .iter()
            .filter(|entry| entry.problem.is_some())
            .count(),
        7
    );
    restore(&project.root, &result.backup_id, &project.writes).unwrap();
    assert_eq!(project.catalog(CatalogKind::Pixel), before);
    assert!(apply(
        &project.root,
        project.request(&CatalogKind::Pixel.key(&id)),
        &project.writes
    )
    .unwrap_err()
    .to_string()
    .contains("limit"));
}

#[test]
fn recovery_listing_and_restore_survive_unrelated_invalid_public_json() {
    let project = Project::new();
    let id = project.pixel(20);
    let before = project.catalog(CatalogKind::Pixel);
    let result = apply(
        &project.root,
        project.request(&CatalogKind::Pixel.key(&id)),
        &project.writes,
    )
    .unwrap();
    fs::write(project.root.join("public/broken.json"), b"invalid").unwrap();
    assert!(inspect(&project.root, &project.writes).is_err());
    assert!(list_backups(&project.root, &PlacementWriteRegistry::default()).is_err());
    let backups = list_backups(&project.root, &project.writes).unwrap();
    assert_eq!(backups.len(), 1);
    assert_eq!(backups[0].id, result.backup_id);
    restore(&project.root, &backups[0].id, &project.writes).unwrap();
    assert_eq!(project.catalog(CatalogKind::Pixel), before);
    assert_eq!(
        fs::read(project.root.join("public/broken.json")).unwrap(),
        b"invalid"
    );
}

#[test]
fn a_corrupt_restore_marker_does_not_hide_other_backups() {
    let project = Project::new();
    let first_id = project.pixel(21);
    let second_id = project.pixel(22);
    let first = apply(
        &project.root,
        project.request(&CatalogKind::Pixel.key(&first_id)),
        &project.writes,
    )
    .unwrap();
    let before_second = project.catalog(CatalogKind::Pixel);
    let second = apply(
        &project.root,
        project.request(&CatalogKind::Pixel.key(&second_id)),
        &project.writes,
    )
    .unwrap();
    fs::write(
        Path::new(&first.backup_path).join("restored.json"),
        vec![b' '; 1025],
    )
    .unwrap();
    let backups = list_backups(&project.root, &project.writes).unwrap();
    assert_eq!(backups.len(), 2);
    assert!(backups
        .iter()
        .find(|backup| backup.id == first.backup_id)
        .unwrap()
        .problem
        .is_some());
    assert!(backups
        .iter()
        .find(|backup| backup.id == second.backup_id)
        .unwrap()
        .problem
        .is_none());
    restore(&project.root, &second.backup_id, &project.writes).unwrap();
    assert_eq!(project.catalog(CatalogKind::Pixel), before_second);
}

#[test]
fn malformed_oversized_or_excessive_public_json_blocks_cleanup() {
    let project = Project::new();
    project.pixel(12);
    let bad = project.root.join("public/bad.json");
    fs::write(&bad, b"invalid").unwrap();
    assert!(inspect(&project.root, &project.writes).is_err());
    fs::write(&bad, vec![b' '; MAX_JSON + 1]).unwrap();
    assert!(inspect(&project.root, &project.writes).is_err());
    fs::remove_file(bad).unwrap();
    for i in 0..256 {
        fs::write(project.root.join(format!("public/{i}.json")), b"{}").unwrap();
    }
    assert!(inspect(&project.root, &project.writes)
        .unwrap_err()
        .to_string()
        .contains("256"));
}

#[cfg(unix)]
#[test]
fn symlinked_json_or_backup_directory_is_rejected() {
    let project = Project::new();
    project.pixel(13);
    let link = project.root.join("public/link.json");
    std::os::unix::fs::symlink(project.root.join("public/scene-authoring.json"), &link).unwrap();
    assert!(inspect(&project.root, &project.writes).is_err());
    fs::remove_file(link).unwrap();
    std::os::unix::fs::symlink(project.root.join("public"), project.root.join(BACKUPS)).unwrap();
    assert!(inspect(&project.root, &project.writes).is_err());
}
