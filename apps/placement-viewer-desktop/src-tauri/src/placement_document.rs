use std::{
    fmt, fs,
    path::{Path, PathBuf},
};

use serde::{Serialize, Serializer};
use serde_json::Value;

type CommandResult<T> = Result<T, PlacementDesktopError>;

const AGENT_HANDOFF_FORMAT: &str = "ferrum2d.placement-viewer.agent-handoff";
const PROJECT_HANDOFF_FILE: &str = ".ferrum-placement-handoff.json";
const PROJECT_SCENE_DOCUMENT_CANDIDATES: &[&str] = &[
    "public/scene-authoring.json",
    "public/placement.scene-authoring.json",
];
const SCENE_AUTHORING_FORMAT: &str = "ferrum2d.consumer.scene-authoring";
const SCENE_DOCUMENT_ENV_VAR: &str = "FERRUM_PLACEMENT_SCENE_DOCUMENT";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementSceneDocumentResponse {
    path: String,
    document: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementProjectDocumentResponse {
    project_path: String,
    scene_document_path: String,
    handoff_path: String,
    document: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementAgentHandoffResponse {
    path: String,
    handoff: Value,
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
    InvalidProjectPath(String),
    InvalidHandoff(String),
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
            Self::InvalidProjectPath(detail) => {
                write!(formatter, "invalid placement project folder: {detail}")
            }
            Self::InvalidHandoff(detail) => {
                write!(formatter, "invalid placement agent handoff: {detail}")
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
            Self::InvalidProjectPath(_) => None,
            Self::InvalidHandoff(_) => None,
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
pub fn load_placement_project_folder(
    project_path: String,
) -> CommandResult<PlacementProjectDocumentResponse> {
    let project_path = parse_project_path(&project_path)?;
    let scene_document_path = project_scene_document_path(&project_path)?;
    let document = read_scene_document(&scene_document_path)?;
    let handoff_path = project_path.join(PROJECT_HANDOFF_FILE);
    Ok(PlacementProjectDocumentResponse {
        project_path: project_path.display().to_string(),
        scene_document_path: scene_document_path.display().to_string(),
        handoff_path: handoff_path.display().to_string(),
        document,
    })
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
pub fn save_placement_agent_handoff(
    project_path: Option<String>,
    scene_document_path: Option<String>,
    handoff: Value,
) -> CommandResult<PlacementAgentHandoffResponse> {
    validate_agent_handoff(&handoff)?;
    let project_path =
        resolve_handoff_project_path(project_path.as_deref(), scene_document_path.as_deref())?;
    let handoff_path = project_path.join(PROJECT_HANDOFF_FILE);
    write_agent_handoff(&handoff_path, handoff)
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

fn write_agent_handoff(
    path: &Path,
    handoff: Value,
) -> CommandResult<PlacementAgentHandoffResponse> {
    let json =
        serde_json::to_string_pretty(&handoff).map_err(|source| PlacementDesktopError::Json {
            path: path.to_path_buf(),
            source,
        })?;
    fs::write(path, format!("{json}\n")).map_err(|source| PlacementDesktopError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(PlacementAgentHandoffResponse {
        path: path.display().to_string(),
        handoff,
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

fn validate_agent_handoff(handoff: &Value) -> CommandResult<()> {
    if handoff.get("format").and_then(Value::as_str) != Some(AGENT_HANDOFF_FORMAT) {
        return Err(PlacementDesktopError::InvalidHandoff(
            "format must be ferrum2d.placement-viewer.agent-handoff".to_string(),
        ));
    }
    if handoff.get("version").and_then(Value::as_i64) != Some(1) {
        return Err(PlacementDesktopError::InvalidHandoff(
            "version must be 1".to_string(),
        ));
    }
    if handoff.get("assetDiagnostics").is_some_and(Value::is_array) {
        return Ok(());
    }
    Err(PlacementDesktopError::InvalidHandoff(
        "assetDiagnostics must be an array".to_string(),
    ))
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

fn resolve_handoff_project_path(
    project_path: Option<&str>,
    scene_document_path: Option<&str>,
) -> CommandResult<PathBuf> {
    if let Some(project_path) = project_path {
        return parse_project_path(project_path);
    }
    let scene_document_path = match scene_document_path {
        Some(path) => parse_scene_document_path(path)?,
        None => sample_scene_document_path(),
    };
    Ok(infer_project_path_from_scene_document(&scene_document_path))
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

fn parse_project_path(path: &str) -> CommandResult<PathBuf> {
    let path = path.trim();
    if path.is_empty() {
        return Err(PlacementDesktopError::InvalidProjectPath(
            "path must not be empty".to_string(),
        ));
    }
    let path = PathBuf::from(path);
    let metadata = fs::metadata(&path).map_err(|source| PlacementDesktopError::Io {
        path: path.clone(),
        source,
    })?;
    if !metadata.is_dir() {
        return Err(PlacementDesktopError::InvalidProjectPath(format!(
            "{} is not a directory",
            path.display()
        )));
    }
    Ok(path)
}

fn project_scene_document_path(project_path: &Path) -> CommandResult<PathBuf> {
    for candidate in PROJECT_SCENE_DOCUMENT_CANDIDATES {
        let path = project_path.join(candidate);
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(PlacementDesktopError::InvalidProjectPath(format!(
        "{} must contain public/scene-authoring.json",
        project_path.display()
    )))
}

fn infer_project_path_from_scene_document(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    if parent.file_name().and_then(|name| name.to_str()) == Some("public") {
        return parent
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| parent.to_path_buf());
    }
    parent.to_path_buf()
}

fn sample_scene_document_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../placement-viewer/public/placement.scene-authoring.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "ferrum-placement-viewer-desktop-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn create_project_fixture(name: &str) -> (PathBuf, Value) {
        let project_path = unique_temp_dir(name);
        let public_path = project_path.join("public");
        fs::create_dir_all(&public_path).expect("project public directory should be created");
        let document = read_scene_document(&sample_scene_document_path())
            .expect("sample scene document should load");
        write_scene_document(&public_path.join("scene-authoring.json"), document.clone())
            .expect("project scene document should be written");
        (project_path, document)
    }

    fn sample_handoff() -> Value {
        json!({
            "format": AGENT_HANDOFF_FORMAT,
            "version": 1,
            "workflow": "human-placement-agent-behavior",
            "placementOwner": "sceneComposition.fragments[].instances[]",
            "behaviorOwner": "sceneComposition.prefabs[].props.behaviorRecipes + behaviorRecipes.entities",
            "selectedInstanceId": "crate_left",
            "assetDiagnostics": []
        })
    }

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

    #[test]
    fn loads_scene_document_from_project_folder() {
        let (project_path, source) = create_project_fixture("project-load");

        let response = load_placement_project_folder(project_path.display().to_string())
            .expect("project folder should load");
        let _ = fs::remove_dir_all(&project_path);

        assert_eq!(response.project_path, project_path.display().to_string());
        assert_eq!(
            response.scene_document_path,
            project_path
                .join("public/scene-authoring.json")
                .display()
                .to_string()
        );
        assert_eq!(
            response.handoff_path,
            project_path
                .join(PROJECT_HANDOFF_FILE)
                .display()
                .to_string()
        );
        assert_eq!(response.document, source);
    }

    #[test]
    fn rejects_project_folder_without_scene_document() {
        let project_path = unique_temp_dir("project-missing-scene");
        fs::create_dir_all(&project_path).expect("project directory should be created");

        let error = load_placement_project_folder(project_path.display().to_string())
            .expect_err("project folder without scene-authoring should be rejected");
        let _ = fs::remove_dir_all(&project_path);

        assert!(matches!(
            error,
            PlacementDesktopError::InvalidProjectPath(_)
        ));
    }

    #[test]
    fn writes_handoff_to_project_folder() {
        let (project_path, _) = create_project_fixture("project-handoff");
        let handoff = sample_handoff();

        let response = save_placement_agent_handoff(
            Some(project_path.display().to_string()),
            None,
            handoff.clone(),
        )
        .expect("handoff should save to project folder");
        let loaded = fs::read_to_string(project_path.join(PROJECT_HANDOFF_FILE))
            .expect("handoff file should be written");
        let _ = fs::remove_dir_all(&project_path);

        assert_eq!(
            response.path,
            project_path
                .join(PROJECT_HANDOFF_FILE)
                .display()
                .to_string()
        );
        assert_eq!(response.handoff, handoff);
        assert_eq!(
            serde_json::from_str::<Value>(&loaded).expect("handoff json should parse"),
            handoff
        );
    }

    #[test]
    fn writes_handoff_to_project_inferred_from_scene_document() {
        let (project_path, _) = create_project_fixture("scene-inferred-handoff");
        let scene_document_path = project_path.join("public/scene-authoring.json");
        let handoff = sample_handoff();

        let response = save_placement_agent_handoff(
            None,
            Some(scene_document_path.display().to_string()),
            handoff.clone(),
        )
        .expect("handoff should save to inferred project folder");
        let _ = fs::remove_dir_all(&project_path);

        assert_eq!(
            response.path,
            project_path
                .join(PROJECT_HANDOFF_FILE)
                .display()
                .to_string()
        );
    }

    #[test]
    fn rejects_invalid_handoff() {
        let (project_path, _) = create_project_fixture("invalid-handoff");

        let error = save_placement_agent_handoff(
            Some(project_path.display().to_string()),
            None,
            json!({ "format": "not-ferrum" }),
        )
        .expect_err("invalid handoff should be rejected");
        let _ = fs::remove_dir_all(&project_path);

        assert!(matches!(error, PlacementDesktopError::InvalidHandoff(_)));
    }
}
