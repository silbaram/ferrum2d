use std::{
    fmt, fs,
    path::{Path, PathBuf},
};

use serde::{Serialize, Serializer};
use serde_json::Value;

type CommandResult<T> = Result<T, PlacementDesktopError>;

const SCENE_AUTHORING_FORMAT: &str = "ferrum2d.consumer.scene-authoring";
const SCENE_DOCUMENT_ENV_VAR: &str = "FERRUM_PLACEMENT_SCENE_DOCUMENT";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementSceneDocumentResponse {
    path: String,
    document: Value,
}

#[derive(Debug)]
pub enum PlacementDesktopError {
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    Json {
        path: PathBuf,
        source: serde_json::Error,
    },
    InvalidDocumentPath(String),
    InvalidDocument(String),
}

impl fmt::Display for PlacementDesktopError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { path, source } => write!(formatter, "{}: {}", path.display(), source),
            Self::Json { path, source } => {
                write!(formatter, "{}: invalid JSON: {}", path.display(), source)
            }
            Self::InvalidDocumentPath(detail) => {
                write!(formatter, "invalid placement scene document path: {detail}")
            }
            Self::InvalidDocument(detail) => {
                write!(formatter, "invalid placement scene document: {detail}")
            }
        }
    }
}

impl std::error::Error for PlacementDesktopError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::Json { source, .. } => Some(source),
            Self::InvalidDocumentPath(_) => None,
            Self::InvalidDocument(_) => None,
        }
    }
}

impl Serialize for PlacementDesktopError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
pub fn load_placement_scene_document(
    scene_document_path: Option<String>,
) -> CommandResult<PlacementSceneDocumentResponse> {
    let path = resolve_scene_document_path(scene_document_path.as_deref())?;
    let document = read_scene_document(&path)?;
    Ok(PlacementSceneDocumentResponse {
        path: path.display().to_string(),
        document,
    })
}

#[tauri::command]
pub fn save_placement_scene_document(
    scene_document_path: Option<String>,
    document: Value,
) -> CommandResult<PlacementSceneDocumentResponse> {
    let path = resolve_scene_document_path(scene_document_path.as_deref())?;
    let document = write_scene_document(&path, document)?;
    Ok(PlacementSceneDocumentResponse {
        path: path.display().to_string(),
        document,
    })
}

fn read_scene_document(path: &Path) -> CommandResult<Value> {
    let source = fs::read_to_string(path).map_err(|source| PlacementDesktopError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let document =
        serde_json::from_str::<Value>(&source).map_err(|source| PlacementDesktopError::Json {
            path: path.to_path_buf(),
            source,
        })?;
    validate_scene_document(&document)?;
    Ok(document)
}

fn write_scene_document(path: &Path, document: Value) -> CommandResult<Value> {
    validate_scene_document(&document)?;
    let json =
        serde_json::to_string_pretty(&document).map_err(|source| PlacementDesktopError::Json {
            path: path.to_path_buf(),
            source,
        })?;
    fs::write(path, format!("{json}\n")).map_err(|source| PlacementDesktopError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(document)
}

fn validate_scene_document(document: &Value) -> CommandResult<()> {
    let format = document.get("format").and_then(Value::as_str);
    if format != Some(SCENE_AUTHORING_FORMAT) {
        return Err(PlacementDesktopError::InvalidDocument(
            "format must be ferrum2d.consumer.scene-authoring".to_string(),
        ));
    }
    if document.get("version").and_then(Value::as_i64) != Some(1) {
        return Err(PlacementDesktopError::InvalidDocument(
            "version must be 1".to_string(),
        ));
    }
    if !document
        .get("sceneComposition")
        .is_some_and(Value::is_object)
    {
        return Err(PlacementDesktopError::InvalidDocument(
            "sceneComposition must be an object".to_string(),
        ));
    }
    Ok(())
}

fn resolve_scene_document_path(path: Option<&str>) -> CommandResult<PathBuf> {
    let env_path = std::env::var(SCENE_DOCUMENT_ENV_VAR).ok();
    resolve_scene_document_path_with_env(path, env_path.as_deref())
}

fn resolve_scene_document_path_with_env(
    path: Option<&str>,
    env_path: Option<&str>,
) -> CommandResult<PathBuf> {
    if let Some(path) = path {
        return parse_scene_document_path(path);
    }
    if let Some(path) = env_path {
        return parse_scene_document_path(path);
    }
    Ok(sample_scene_document_path())
}

fn parse_scene_document_path(path: &str) -> CommandResult<PathBuf> {
    let path = path.trim();
    if path.is_empty() {
        return Err(PlacementDesktopError::InvalidDocumentPath(
            "path must not be empty".to_string(),
        ));
    }
    Ok(PathBuf::from(path))
}

fn sample_scene_document_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../placement-viewer/public/placement.scene-authoring.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_sample_scene_document() {
        let response =
            load_placement_scene_document(None).expect("sample scene document should load");
        assert!(response.path.ends_with("placement.scene-authoring.json"));
        assert_eq!(
            response.document.get("format").and_then(Value::as_str),
            Some(SCENE_AUTHORING_FORMAT)
        );
    }

    #[test]
    fn loads_scene_document_from_explicit_path() {
        let source = read_scene_document(&sample_scene_document_path())
            .expect("sample scene document should load");
        let path = std::env::temp_dir().join(format!(
            "ferrum-placement-viewer-desktop-load-test-{}.json",
            std::process::id()
        ));
        write_scene_document(&path, source.clone()).expect("scene document fixture should save");

        let response = load_placement_scene_document(Some(path.display().to_string()))
            .expect("explicit scene document should load");
        let _ = fs::remove_file(&path);

        assert_eq!(response.path, path.display().to_string());
        assert_eq!(response.document, source);
    }

    #[test]
    fn rejects_empty_scene_document_path() {
        let error = resolve_scene_document_path_with_env(Some("  "), None)
            .expect_err("empty scene document path should be rejected");
        assert!(matches!(
            error,
            PlacementDesktopError::InvalidDocumentPath(_)
        ));
    }

    #[test]
    fn explicit_path_wins_over_environment_path() {
        let explicit_path = PathBuf::from("/tmp/ferrum-explicit.scene-authoring.json");
        let env_path = PathBuf::from("/tmp/ferrum-env.scene-authoring.json");

        let resolved = resolve_scene_document_path_with_env(
            Some(explicit_path.to_str().expect("path should be valid utf-8")),
            Some(env_path.to_str().expect("path should be valid utf-8")),
        )
        .expect("explicit path should resolve");

        assert_eq!(resolved, explicit_path);
    }

    #[test]
    fn environment_path_is_used_before_sample_fallback() {
        let env_path = PathBuf::from("/tmp/ferrum-env.scene-authoring.json");

        let resolved = resolve_scene_document_path_with_env(
            None,
            Some(env_path.to_str().expect("path should be valid utf-8")),
        )
        .expect("environment path should resolve");

        assert_eq!(resolved, env_path);
    }

    #[test]
    fn writes_scene_document_to_path() {
        let source = load_placement_scene_document(None)
            .expect("sample scene document should load")
            .document;
        let path = std::env::temp_dir().join(format!(
            "ferrum-placement-viewer-desktop-save-test-{}.json",
            std::process::id()
        ));
        let written =
            write_scene_document(&path, source.clone()).expect("scene document should save");
        let loaded = read_scene_document(&path).expect("saved scene document should reload");
        let _ = fs::remove_file(&path);

        assert_eq!(written, source);
        assert_eq!(loaded, source);
    }

    #[test]
    fn save_command_writes_explicit_scene_document_path() {
        let source = read_scene_document(&sample_scene_document_path())
            .expect("sample scene document should load");
        let path = std::env::temp_dir().join(format!(
            "ferrum-placement-viewer-desktop-command-save-test-{}.json",
            std::process::id()
        ));

        let response =
            save_placement_scene_document(Some(path.display().to_string()), source.clone())
                .expect("explicit scene document should save");
        let loaded = read_scene_document(&path).expect("saved scene document should reload");
        let _ = fs::remove_file(&path);

        assert_eq!(response.path, path.display().to_string());
        assert_eq!(response.document, source);
        assert_eq!(loaded, source);
    }
}
