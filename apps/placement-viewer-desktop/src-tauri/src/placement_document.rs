use std::{
    collections::{HashMap, HashSet},
    fmt, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Serialize, Serializer};
use serde_json::Value;
use tauri::{http, Manager, State};

type CommandResult<T> = Result<T, PlacementDesktopError>;

const AGENT_HANDOFF_FORMAT: &str = "ferrum2d.placement-viewer.agent-handoff";
const PROJECT_ASSET_FOLDER: &str = "public/assets";
const PROJECT_HANDOFF_FILE: &str = ".ferrum-placement-handoff.json";
const PROJECT_SCENE_DOCUMENT_CANDIDATES: &[&str] = &[
    "public/scene-authoring.json",
    "public/placement.scene-authoring.json",
];
const ACCESS_CONTROL_ALLOW_ORIGIN_VALUE: &str = "*";
const RUNTIME_ASSET_PROTOCOL: &str = "ferrum-asset";
const SCENE_AUTHORING_FORMAT: &str = "ferrum2d.consumer.scene-authoring";
const SCENE_DOCUMENT_ENV_VAR: &str = "FERRUM_PLACEMENT_SCENE_DOCUMENT";
const SUPPORTED_IMAGE_EXTENSIONS: &[&str] = &["gif", "jpeg", "jpg", "png", "webp"];
const TEXTURE_ATLAS_INPUT_FILE: &str = "texture-atlas.input.json";

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
    asset_folder: PlacementAssetFolderResponse,
    document: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementAgentHandoffResponse {
    path: String,
    handoff: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementAssetFolderResponse {
    asset_folder_path: String,
    exists: bool,
    image_count: usize,
    texture_atlas_input_path: Option<String>,
    images: Vec<PlacementAssetFolderImage>,
    diagnostics: Vec<PlacementAssetFolderDiagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementAssetFolderImage {
    id: String,
    file_name: String,
    path: String,
    runtime_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementAssetFolderDiagnostic {
    severity: &'static str,
    code: &'static str,
    path: String,
    message: String,
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
    InvalidAssetFolderPath(String),
    InvalidProjectPath(String),
    InvalidHandoff(String),
}

#[derive(Debug, Default)]
pub struct PlacementAssetRegistry {
    assets: Mutex<HashMap<String, RegisteredPlacementAsset>>,
}

#[derive(Debug, Clone)]
struct RegisteredPlacementAsset {
    path: PathBuf,
    mime_type: &'static str,
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
            Self::InvalidAssetFolderPath(detail) => {
                write!(formatter, "invalid placement asset folder path: {detail}")
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
            Self::InvalidAssetFolderPath(_) => None,
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
    asset_registry: State<'_, PlacementAssetRegistry>,
) -> CommandResult<PlacementProjectDocumentResponse> {
    load_placement_project_folder_inner(project_path, Some(&asset_registry))
}

fn load_placement_project_folder_inner(
    project_path: String,
    asset_registry: Option<&PlacementAssetRegistry>,
) -> CommandResult<PlacementProjectDocumentResponse> {
    let project_path = parse_project_path(&project_path)?;
    let scene_document_path = project_scene_document_path(&project_path)?;
    let document = read_scene_document(&scene_document_path)?;
    let handoff_path = project_path.join(PROJECT_HANDOFF_FILE);
    let asset_folder =
        inspect_asset_folder_path(&project_asset_folder_path(&project_path), asset_registry)?;
    Ok(PlacementProjectDocumentResponse {
        project_path: project_path.display().to_string(),
        scene_document_path: scene_document_path.display().to_string(),
        handoff_path: handoff_path.display().to_string(),
        asset_folder,
        document,
    })
}

#[tauri::command]
pub fn inspect_placement_asset_folder(
    asset_folder_path: String,
    asset_registry: State<'_, PlacementAssetRegistry>,
) -> CommandResult<PlacementAssetFolderResponse> {
    let path = parse_asset_folder_path(&asset_folder_path)?;
    inspect_asset_folder_path(&path, Some(&asset_registry))
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

pub fn placement_asset_protocol_response<R: tauri::Runtime>(
    context: tauri::UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    if request.method() == http::Method::OPTIONS {
        return placement_asset_options_response();
    }
    let registry = context.app_handle().state::<PlacementAssetRegistry>();
    match registry.asset_for_request(request.uri()) {
        Ok(asset) => asset_response(&asset),
        Err(status) => placement_asset_error_response(status),
    }
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

fn parse_asset_folder_path(path: &str) -> CommandResult<PathBuf> {
    let path = path.trim();
    if path.is_empty() {
        return Err(PlacementDesktopError::InvalidAssetFolderPath(
            "path must not be empty".to_string(),
        ));
    }
    Ok(PathBuf::from(path))
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

fn project_asset_folder_path(project_path: &Path) -> PathBuf {
    project_path.join(PROJECT_ASSET_FOLDER)
}

fn inspect_asset_folder_path(
    path: &Path,
    asset_registry: Option<&PlacementAssetRegistry>,
) -> CommandResult<PlacementAssetFolderResponse> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => {
            asset_registry.map(PlacementAssetRegistry::clear);
            return Ok(PlacementAssetFolderResponse {
                asset_folder_path: path.display().to_string(),
                exists: false,
                image_count: 0,
                texture_atlas_input_path: None,
                images: Vec::new(),
                diagnostics: vec![PlacementAssetFolderDiagnostic {
                    severity: "error",
                    code: "missingAssetFolder",
                    path: "assetFolder".to_string(),
                    message: format!("{} does not exist", path.display()),
                }],
            });
        }
        Err(source) => {
            asset_registry.map(PlacementAssetRegistry::clear);
            return Err(PlacementDesktopError::Io {
                path: path.to_path_buf(),
                source,
            });
        }
    };
    if !metadata.is_dir() {
        asset_registry.map(PlacementAssetRegistry::clear);
        return Ok(PlacementAssetFolderResponse {
            asset_folder_path: path.display().to_string(),
            exists: false,
            image_count: 0,
            texture_atlas_input_path: None,
            images: Vec::new(),
            diagnostics: vec![PlacementAssetFolderDiagnostic {
                severity: "error",
                code: "notDirectoryAssetFolder",
                path: "assetFolder".to_string(),
                message: format!("{} is not a directory", path.display()),
            }],
        });
    }
    let canonical_asset_root = path
        .canonicalize()
        .map_err(|source| PlacementDesktopError::Io {
            path: path.to_path_buf(),
            source,
        })?;

    let mut candidates = Vec::new();
    for entry in fs::read_dir(path).map_err(|source| PlacementDesktopError::Io {
        path: path.to_path_buf(),
        source,
    })? {
        let entry = entry.map_err(|source| PlacementDesktopError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        let entry_path = entry.path();
        if !entry_path.is_file() || !is_supported_image_path(&entry_path) {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        let base_id = entry_path
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| file_name.clone());
        let canonical_path =
            entry_path
                .canonicalize()
                .map_err(|source| PlacementDesktopError::Io {
                    path: entry_path.clone(),
                    source,
                })?;
        if !canonical_path.starts_with(&canonical_asset_root) {
            continue;
        }
        let mime_type = image_mime_type(&entry_path).unwrap_or("application/octet-stream");
        candidates.push((file_name, base_id, canonical_path, mime_type));
    }
    candidates.sort_by(|left, right| left.0.cmp(&right.0));
    let mut used_ids = HashSet::new();
    let mut registry_assets = HashMap::new();
    let mut images = Vec::new();
    for (file_name, base_id, canonical_path, mime_type) in candidates {
        let id = unique_asset_id(&base_id, &mut used_ids);
        let runtime_url = placement_runtime_asset_url(&id);
        registry_assets.insert(
            id.clone(),
            RegisteredPlacementAsset {
                path: canonical_path.clone(),
                mime_type,
            },
        );
        images.push(PlacementAssetFolderImage {
            id,
            file_name,
            path: canonical_path.display().to_string(),
            runtime_url,
        });
    }
    if let Some(asset_registry) = asset_registry {
        asset_registry.replace(registry_assets);
    }
    let texture_atlas_input_path = path.join(TEXTURE_ATLAS_INPUT_FILE);
    Ok(PlacementAssetFolderResponse {
        asset_folder_path: path.display().to_string(),
        exists: true,
        image_count: images.len(),
        texture_atlas_input_path: texture_atlas_input_path
            .is_file()
            .then(|| texture_atlas_input_path.display().to_string()),
        images,
        diagnostics: Vec::new(),
    })
}

impl PlacementAssetRegistry {
    fn replace(&self, assets: HashMap<String, RegisteredPlacementAsset>) {
        if let Ok(mut current) = self.assets.lock() {
            *current = assets;
        }
    }

    fn clear(&self) {
        self.replace(HashMap::new());
    }

    fn asset_for_request(
        &self,
        uri: &http::Uri,
    ) -> Result<RegisteredPlacementAsset, http::StatusCode> {
        let Some(asset_id) = placement_asset_id_from_uri(uri) else {
            return Err(http::StatusCode::BAD_REQUEST);
        };
        let assets = self
            .assets
            .lock()
            .map_err(|_| http::StatusCode::INTERNAL_SERVER_ERROR)?;
        assets
            .get(&asset_id)
            .cloned()
            .ok_or(http::StatusCode::NOT_FOUND)
    }
}

fn asset_response(asset: &RegisteredPlacementAsset) -> http::Response<Vec<u8>> {
    match fs::read(&asset.path) {
        Ok(bytes) => placement_asset_response_builder(http::StatusCode::OK)
            .header(http::header::CONTENT_TYPE, asset.mime_type)
            .header(http::header::CACHE_CONTROL, "no-store")
            .body(bytes)
            .expect("placement asset response should build"),
        Err(_) => placement_asset_error_response(http::StatusCode::NOT_FOUND),
    }
}

fn placement_asset_options_response() -> http::Response<Vec<u8>> {
    placement_asset_response_builder(http::StatusCode::NO_CONTENT)
        .body(Vec::new())
        .expect("empty placement asset options response should build")
}

fn placement_asset_error_response(status: http::StatusCode) -> http::Response<Vec<u8>> {
    placement_asset_response_builder(status)
        .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Vec::new())
        .expect("empty placement asset error response should build")
}

fn placement_asset_response_builder(status: http::StatusCode) -> http::response::Builder {
    http::Response::builder()
        .status(status)
        .header(
            http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
            ACCESS_CONTROL_ALLOW_ORIGIN_VALUE,
        )
        .header(
            http::header::ACCESS_CONTROL_ALLOW_METHODS,
            "GET, HEAD, OPTIONS",
        )
        .header(http::header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
}

fn placement_asset_id_from_uri(uri: &http::Uri) -> Option<String> {
    let path = uri.path().trim_start_matches('/');
    let raw_id =
        if uri.scheme_str() == Some(RUNTIME_ASSET_PROTOCOL) && uri.host() == Some("project") {
            path
        } else if let Some(rest) = path.strip_prefix("project/") {
            rest
        } else {
            return None;
        };
    percent_decode(raw_id)
}

fn unique_asset_id(base_id: &str, used_ids: &mut HashSet<String>) -> String {
    let trimmed = base_id.trim();
    let base = if trimmed.is_empty() { "asset" } else { trimmed };
    if used_ids.insert(base.to_string()) {
        return base.to_string();
    }
    for index in 2..10_000 {
        let candidate = format!("{base}_{index}");
        if used_ids.insert(candidate.clone()) {
            return candidate;
        }
    }
    format!("{base}_{}", used_ids.len() + 1)
}

fn placement_runtime_asset_url(asset_id: &str) -> String {
    format!(
        "{RUNTIME_ASSET_PROTOCOL}://localhost/project/{}",
        percent_encode_path_segment(asset_id)
    )
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?;
    if extension.eq_ignore_ascii_case("gif") {
        return Some("image/gif");
    }
    if extension.eq_ignore_ascii_case("jpeg") || extension.eq_ignore_ascii_case("jpg") {
        return Some("image/jpeg");
    }
    if extension.eq_ignore_ascii_case("png") {
        return Some("image/png");
    }
    if extension.eq_ignore_ascii_case("webp") {
        return Some("image/webp");
    }
    None
}

fn percent_encode_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn percent_decode(value: &str) -> Option<String> {
    let mut bytes = Vec::new();
    let mut index = 0;
    let source = value.as_bytes();
    while index < source.len() {
        if source[index] != b'%' {
            bytes.push(source[index]);
            index += 1;
            continue;
        }
        if index + 2 >= source.len() {
            return None;
        }
        let hex = std::str::from_utf8(&source[index + 1..index + 3]).ok()?;
        let byte = u8::from_str_radix(hex, 16).ok()?;
        bytes.push(byte);
        index += 3;
    }
    String::from_utf8(bytes).ok()
}

fn is_supported_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_IMAGE_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
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

    fn create_project_asset_fixture(name: &str) -> PathBuf {
        let project_path = unique_temp_dir(name);
        let asset_path = project_path.join(PROJECT_ASSET_FOLDER);
        fs::create_dir_all(&asset_path).expect("project asset directory should be created");
        fs::write(asset_path.join("atlas.png"), b"png").expect("png fixture should be written");
        fs::write(asset_path.join("ship.WEBP"), b"webp").expect("webp fixture should be written");
        fs::write(asset_path.join("notes.txt"), b"ignore").expect("text fixture should be written");
        fs::write(asset_path.join(TEXTURE_ATLAS_INPUT_FILE), b"{}")
            .expect("atlas input fixture should be written");
        project_path
    }

    fn assert_placement_asset_cors_headers(response: &http::Response<Vec<u8>>) {
        assert_eq!(
            response
                .headers()
                .get(http::header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some(&http::HeaderValue::from_static(
                ACCESS_CONTROL_ALLOW_ORIGIN_VALUE
            ))
        );
        assert_eq!(
            response
                .headers()
                .get(http::header::ACCESS_CONTROL_ALLOW_METHODS),
            Some(&http::HeaderValue::from_static("GET, HEAD, OPTIONS"))
        );
        assert_eq!(
            response
                .headers()
                .get(http::header::ACCESS_CONTROL_ALLOW_HEADERS),
            Some(&http::HeaderValue::from_static("*"))
        );
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

    fn registry_asset_ids(registry: &PlacementAssetRegistry) -> Vec<String> {
        let assets = registry.assets.lock().expect("registry should lock");
        let mut ids = assets.keys().cloned().collect::<Vec<_>>();
        ids.sort();
        ids
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

        let response =
            load_placement_project_folder_inner(project_path.display().to_string(), None)
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
        assert_eq!(
            response.asset_folder.asset_folder_path,
            project_path
                .join(PROJECT_ASSET_FOLDER)
                .display()
                .to_string()
        );
        assert!(!response.asset_folder.exists);
        assert_eq!(response.document, source);
    }

    #[test]
    fn inspects_project_asset_folder() {
        let project_path = create_project_asset_fixture("asset-folder");

        let registry = PlacementAssetRegistry::default();
        let response =
            inspect_asset_folder_path(&project_path.join(PROJECT_ASSET_FOLDER), Some(&registry))
                .expect("asset folder should inspect");

        assert!(response.exists);
        assert_eq!(response.image_count, 2);
        assert_eq!(
            response
                .texture_atlas_input_path
                .as_deref()
                .expect("atlas input path should be returned"),
            project_path
                .join(PROJECT_ASSET_FOLDER)
                .join(TEXTURE_ATLAS_INPUT_FILE)
                .display()
                .to_string()
        );
        assert_eq!(
            response
                .images
                .iter()
                .map(|image| image.file_name.as_str())
                .collect::<Vec<_>>(),
            vec!["atlas.png", "ship.WEBP"]
        );
        assert_eq!(
            response
                .images
                .iter()
                .map(|image| image.runtime_url.as_str())
                .collect::<Vec<_>>(),
            vec![
                "ferrum-asset://localhost/project/atlas",
                "ferrum-asset://localhost/project/ship"
            ]
        );
        assert_eq!(registry_asset_ids(&registry), vec!["atlas", "ship"]);
        let asset = registry
            .asset_for_request(
                &"ferrum-asset://project/ship"
                    .parse::<http::Uri>()
                    .expect("asset uri should parse"),
            )
            .expect("registered asset should resolve");
        let asset_response = asset_response(&asset);
        assert_eq!(asset_response.status(), http::StatusCode::OK);
        assert_placement_asset_cors_headers(&asset_response);
        assert_eq!(
            asset_response.headers().get(http::header::CONTENT_TYPE),
            Some(&http::HeaderValue::from_static("image/webp"))
        );
        assert_eq!(asset_response.body(), b"webp");
        let _ = fs::remove_dir_all(&project_path);
    }

    #[test]
    fn placement_asset_protocol_supports_fetch_cors_preflight_and_errors() {
        let options_response = placement_asset_options_response();
        assert_eq!(options_response.status(), http::StatusCode::NO_CONTENT);
        assert_placement_asset_cors_headers(&options_response);

        let error_response = placement_asset_error_response(http::StatusCode::NOT_FOUND);
        assert_eq!(error_response.status(), http::StatusCode::NOT_FOUND);
        assert_placement_asset_cors_headers(&error_response);
        assert_eq!(
            error_response.headers().get(http::header::CONTENT_TYPE),
            Some(&http::HeaderValue::from_static("text/plain; charset=utf-8"))
        );
    }

    #[test]
    fn placement_asset_id_accepts_native_protocol_url_shapes() {
        let direct_uri = "ferrum-asset://localhost/project/ship%20one"
            .parse::<http::Uri>()
            .expect("direct asset uri should parse");
        assert_eq!(
            placement_asset_id_from_uri(&direct_uri).as_deref(),
            Some("ship one")
        );

        let legacy_direct_uri = "ferrum-asset://project/ship%20one"
            .parse::<http::Uri>()
            .expect("legacy direct asset uri should parse");
        assert_eq!(
            placement_asset_id_from_uri(&legacy_direct_uri).as_deref(),
            Some("ship one")
        );

        let localhost_proxy_uri = "http://ferrum-asset.localhost/project/ship%20one"
            .parse::<http::Uri>()
            .expect("localhost proxy asset uri should parse");
        assert_eq!(
            placement_asset_id_from_uri(&localhost_proxy_uri).as_deref(),
            Some("ship one")
        );
    }

    #[test]
    fn inspects_duplicate_asset_ids_with_stable_suffixes() {
        let project_path = unique_temp_dir("duplicate-asset-ids");
        let asset_path = project_path.join(PROJECT_ASSET_FOLDER);
        fs::create_dir_all(&asset_path).expect("project asset directory should be created");
        fs::write(asset_path.join("ship.png"), b"png").expect("first image should be written");
        fs::write(asset_path.join("ship.webp"), b"webp").expect("second image should be written");

        let response =
            inspect_asset_folder_path(&asset_path, None).expect("asset folder should inspect");
        let _ = fs::remove_dir_all(&project_path);

        assert_eq!(
            response
                .images
                .iter()
                .map(|image| image.id.as_str())
                .collect::<Vec<_>>(),
            vec!["ship", "ship_2"]
        );
        assert_eq!(
            response
                .images
                .iter()
                .map(|image| image.runtime_url.as_str())
                .collect::<Vec<_>>(),
            vec![
                "ferrum-asset://localhost/project/ship",
                "ferrum-asset://localhost/project/ship_2"
            ]
        );
    }

    #[test]
    fn reports_missing_asset_folder_as_diagnostic() {
        let project_path = unique_temp_dir("missing-asset-folder");

        let response = inspect_asset_folder_path(&project_path.join(PROJECT_ASSET_FOLDER), None)
            .expect("missing asset folder should return diagnostics");

        assert!(!response.exists);
        assert_eq!(response.image_count, 0);
        assert_eq!(response.diagnostics.len(), 1);
        assert_eq!(response.diagnostics[0].code, "missingAssetFolder");
    }

    #[test]
    fn rejects_project_folder_without_scene_document() {
        let project_path = unique_temp_dir("project-missing-scene");
        fs::create_dir_all(&project_path).expect("project directory should be created");

        let error = load_placement_project_folder_inner(project_path.display().to_string(), None)
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
