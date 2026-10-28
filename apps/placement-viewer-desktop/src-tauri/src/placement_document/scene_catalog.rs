//! Bounded, read-only scene discovery. Listing never grants document write authority.
use super::{CommandResult, PlacementDesktopError, PlacementWriteRegistry, SCENE_AUTHORING_FORMAT};
use serde::Serialize;
use serde_json::Value;
use std::{fs, io::Read, path::Path};

const MAX_FILE: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneEntry {
    path: String,
    relative_path: String,
    mode: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostic: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneCatalog {
    scenes: Vec<SceneEntry>,
    truncated: bool,
    diagnostics: Vec<ScanDiagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanDiagnostic {
    relative_path: String,
    code: String,
}

fn unreadable(catalog: &mut SceneCatalog, project: &Path, path: &Path, error: &std::io::Error) {
    if catalog.diagnostics.len() >= 32 {
        catalog.truncated = true;
        return;
    }
    catalog.diagnostics.push(ScanDiagnostic {
        relative_path: path
            .strip_prefix(project)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
            .chars()
            .take(1024)
            .collect(),
        code: format!("{:?}", error.kind()),
    });
}

#[derive(Default)]
struct Budget {
    visited: usize,
    candidates: usize,
    bytes: u64,
}

pub(super) fn list_project_scenes(
    project: &Path,
    registry: &PlacementWriteRegistry,
) -> CommandResult<SceneCatalog> {
    // A standalone Open JSON does not grant project folder browsing authority.
    let project = registry.require_asset_project(project)?;
    let root = project.join("public");
    let mut catalog = SceneCatalog::default();
    let meta = match fs::symlink_metadata(&root) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(catalog),
        Err(source) => return Err(PlacementDesktopError::Io { path: root, source }),
    };
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(PlacementDesktopError::InvalidProjectPath(
            "public must be a project directory".into(),
        ));
    }
    visit(&root, &project, 0, &mut Budget::default(), &mut catalog)?;
    catalog
        .scenes
        .sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(catalog)
}

fn visit(
    directory: &Path,
    project: &Path,
    depth: usize,
    budget: &mut Budget,
    catalog: &mut SceneCatalog,
) -> CommandResult<()> {
    if depth > 8 {
        catalog.truncated = true;
        return Ok(());
    }
    let io = |source| PlacementDesktopError::Io {
        path: directory.to_path_buf(),
        source,
    };
    let mut entries = Vec::new();
    let iterator = match fs::read_dir(directory) {
        Ok(iterator) => iterator,
        Err(error) if depth > 0 => {
            unreadable(catalog, project, directory, &error);
            return Ok(());
        }
        Err(error) => return Err(io(error)),
    };
    for entry in iterator {
        budget.visited += 1;
        if budget.visited > 4096 {
            catalog.truncated = true;
            break;
        }
        match entry {
            Ok(entry) => entries.push(entry),
            Err(error) => unreadable(catalog, project, directory, &error),
        }
    }
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if budget.visited > 4096
            || budget.candidates >= 512
            || catalog.scenes.len() >= 256
            || budget.bytes >= 32 * 1024 * 1024
        {
            catalog.truncated = true;
            break;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            catalog.truncated = true;
            continue;
        };
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                unreadable(catalog, project, &path, &error);
                continue;
            }
        };
        if name.starts_with('.') || file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir()
            && ["assets", "node_modules", "dist", "target"].contains(&name.as_str())
        {
            continue;
        }
        if name
            .chars()
            .any(|c| c.is_control() || ['\\', '?', '#', '%', ':'].contains(&c))
            || name.len() > 255
        {
            catalog.truncated = true;
            continue;
        }
        // Canonical containment also protects against an ancestor swapped during traversal.
        let canonical = match path.canonicalize() {
            Ok(canonical) => canonical,
            Err(error) => {
                unreadable(catalog, project, &path, &error);
                continue;
            }
        };
        if !canonical.starts_with(project.join("public")) {
            catalog.truncated = true;
            continue;
        }
        if file_type.is_dir() {
            if !["assets", "node_modules", "dist", "target"].contains(&name.as_str()) {
                visit(&canonical, project, depth + 1, budget, catalog)?;
            }
            continue;
        }
        if !file_type.is_file() || !name.ends_with(".json") {
            continue;
        }
        budget.candidates += 1;
        let known = name == "scene-authoring.json" || name.ends_with(".scene-authoring.json");
        let parsed = (|| -> Result<Value, String> {
            let mut report_io = |error: std::io::Error| {
                unreadable(catalog, project, &canonical, &error);
                error.to_string()
            };
            let file = fs::File::open(&canonical).map_err(&mut report_io)?;
            let size = file.metadata().map_err(&mut report_io)?.len();
            if size > MAX_FILE || budget.bytes + size > 32 * 1024 * 1024 {
                catalog.truncated = true;
                return Err("Document exceeds catalog read budget".into());
            }
            let mut source = Vec::new();
            file.take(MAX_FILE + 1)
                .read_to_end(&mut source)
                .map_err(|error| {
                    unreadable(catalog, project, &canonical, &error);
                    error.to_string()
                })?;
            budget.bytes += source.len() as u64;
            if source.len() as u64 > MAX_FILE {
                return Err("Document exceeds 2 MiB".into());
            }
            serde_json::from_slice(&source).map_err(|e| e.to_string())
        })();
        let (mode, diagnostic) = match parsed {
            Ok(value) if value["format"] == SCENE_AUTHORING_FORMAT && value["version"] == 1 => (
                if value.get("spatial").is_some_and(|v| !v.is_null()) {
                    "hd2d"
                } else {
                    "2d"
                },
                None,
            ),
            Ok(value) if !known && value["format"] != SCENE_AUTHORING_FORMAT => continue,
            Ok(_) => (
                "invalid",
                Some("Unsupported Scene Authoring document".into()),
            ),
            Err(_) if !known => continue,
            Err(error) => ("invalid", Some(error)),
        };
        let relative_path = canonical
            .strip_prefix(project)
            .expect("contained path")
            .to_string_lossy()
            .replace('\\', "/");
        if relative_path.len() > 1024 {
            catalog.truncated = true;
            continue;
        }
        catalog.scenes.push(SceneEntry {
            path: canonical.to_string_lossy().into_owned(),
            relative_path,
            mode,
            diagnostic,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn missing_child_is_reported_without_losing_other_scenes_and_root_failure_is_an_error() {
        let root = std::env::temp_dir().join(format!("ferrum-scene-io-{}", std::process::id()));
        fs::create_dir_all(root.join("public")).unwrap();
        fs::write(
            root.join("public/scene.json"),
            json!({"format":SCENE_AUTHORING_FORMAT,"version":1}).to_string(),
        )
        .unwrap();
        let mut catalog = SceneCatalog::default();
        let mut budget = Budget::default();
        // A child can disappear between directory enumeration and opening it.
        visit(
            &root.join("public/deleted"),
            &root,
            1,
            &mut budget,
            &mut catalog,
        )
        .unwrap();
        visit(&root.join("public"), &root, 0, &mut budget, &mut catalog).unwrap();
        assert_eq!(catalog.scenes.len(), 1);
        assert_eq!(catalog.diagnostics.len(), 1);
        assert_eq!(catalog.diagnostics[0].relative_path, "public/deleted");
        assert!(!catalog.truncated);
        assert!(visit(&root.join("missing"), &root, 0, &mut budget, &mut catalog).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn listing_requires_open_project_and_never_authorizes_sibling_writes() {
        let root =
            std::env::temp_dir().join(format!("ferrum-scene-catalog-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("public/levels")).unwrap();
        let first = root.join("public/scene-authoring.json");
        let second = root.join("public/levels/cave.json");
        let doc = json!({"format":SCENE_AUTHORING_FORMAT,"version":1});
        fs::write(&first, doc.to_string()).unwrap();
        fs::write(&second, doc.to_string()).unwrap();
        fs::write(root.join("public/broken.scene-authoring.json"), "{").unwrap();
        fs::write(root.join("public/game.json"), "{}").unwrap();
        fs::write(root.join("public/room#1.json"), doc.to_string()).unwrap();
        let registry = PlacementWriteRegistry::default();
        registry.authorize_scene_document(&first).unwrap();
        assert!(list_project_scenes(&root, &registry).is_err());
        registry.authorize_project(&root).unwrap();
        let catalog = list_project_scenes(&root, &registry).unwrap();
        assert_eq!(catalog.scenes.len(), 3);
        assert_eq!(catalog.scenes[0].mode, "invalid");
        assert!(catalog.truncated);
        assert!(registry.require_scene_document(&second).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&root, root.join("public/loop")).unwrap();
            std::os::unix::fs::symlink(&first, root.join("public/link.scene-authoring.json"))
                .unwrap();
            assert_eq!(
                list_project_scenes(&root, &registry).unwrap().scenes.len(),
                3
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scene_limit_is_reported_and_loading_normalizes_alias_paths_with_a_size_limit() {
        let root = std::env::temp_dir().join(format!("ferrum-scene-budget-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("public")).unwrap();
        let doc = json!({"format":SCENE_AUTHORING_FORMAT,"version":1,"sceneComposition":{}});
        for index in 0..257 {
            fs::write(
                root.join(format!("public/scene-{index:03}.json")),
                doc.to_string(),
            )
            .unwrap();
        }
        let registry = PlacementWriteRegistry::default();
        registry.authorize_project(&root).unwrap();
        let catalog = list_project_scenes(&root, &registry).unwrap();
        assert_eq!(catalog.scenes.len(), 256);
        assert!(catalog.truncated);
        let source = root.join("public/scene-000.json");
        let alias = root.join("public/../public/scene-000.json");
        let response = super::super::load_placement_scene_document_inner(
            Some(alias.to_string_lossy().into_owned()),
            Some(&registry),
        )
        .unwrap();
        assert_eq!(
            response.path,
            source.canonicalize().unwrap().to_string_lossy()
        );
        let oversized = root.join("public/large.scene-authoring.json");
        fs::write(&oversized, vec![b' '; MAX_FILE as usize + 1]).unwrap();
        assert!(super::super::read_scene_document(&oversized).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
