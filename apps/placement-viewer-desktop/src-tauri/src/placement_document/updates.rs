//! Version checks and explicitly requested updates. Project authority stays in the host registry.
use super::PlacementWriteRegistry;
#[cfg(feature = "desktop")]
use serde_json::json;
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const REPOSITORY: &str = "silbaram/ferrum2d";
static SERIAL: AtomicU64 = AtomicU64::new(0);
type UpdateResult<T> = Result<T, String>;

#[derive(Default)]
pub struct UpdateState {
    busy: AtomicBool,
    restart_required: AtomicBool,
    app_check_serial: AtomicU64,
    #[cfg(feature = "desktop")]
    pending: std::sync::Mutex<Option<(String, tauri_plugin_updater::Update)>>,
}
impl UpdateState {
    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::Acquire)
    }
}
struct UpdateGuard<'a>(&'a AtomicBool);
impl Drop for UpdateGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
fn begin(state: &UpdateState) -> UpdateResult<UpdateGuard<'_>> {
    state
        .busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "Another update is running".to_owned())?;
    Ok(UpdateGuard(&state.busy))
}
fn target_version(value: &str) -> UpdateResult<semver::Version> {
    let version =
        semver::Version::parse(value).map_err(|_| "Expected an exact beta version".to_owned())?;
    if !version.build.is_empty()
        || version
            .pre
            .as_str()
            .strip_prefix("beta.")
            .and_then(|n| n.parse::<u64>().ok())
            .is_none()
    {
        return Err("Expected an exact beta version".into());
    }
    Ok(version)
}
fn metadata_url(version: &str, os: &str, arch: &str) -> UpdateResult<String> {
    target_version(version)?;
    if !["linux", "macos", "windows"].contains(&os) || !["x64", "arm64"].contains(&arch) {
        return Err("Unsupported update platform".into());
    }
    Ok(format!("https://github.com/{REPOSITORY}/releases/download/ferrum-web-v{version}/viewer-updater-{os}-{arch}.json"))
}
fn release_page(value: &str) -> UpdateResult<&str> {
    let parts: Vec<_> = value
        .strip_prefix("https://github.com/")
        .ok_or("Invalid release link")?
        .split('/')
        .collect();
    if parts.len() != 5
        || parts[2] != "releases"
        || parts[3] != "tag"
        || parts[..2].iter().any(|part| {
            part.is_empty()
                || !part.as_bytes()[0].is_ascii_alphanumeric()
                || !part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        })
    {
        return Err("Invalid release link".into());
    }
    target_version(
        parts[4]
            .strip_prefix("ferrum-web-v")
            .ok_or("Invalid release link")?,
    )?;
    Ok(value)
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn open_placement_release_page(url: String, app: tauri::AppHandle) -> UpdateResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(release_page(&url)?, None::<&str>)
        .map_err(|e| e.to_string())
}
fn approved_project(path: &str, registry: &PlacementWriteRegistry) -> UpdateResult<PathBuf> {
    registry
        .require_asset_project(Path::new(path))
        .map_err(|error| error.to_string())
}

struct HelperDirectory(PathBuf);
impl HelperDirectory {
    fn new() -> UpdateResult<Self> {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "ferrum-update-{}-{nonce}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&directory).map_err(|e| e.to_string())?;
        let result = Self(directory);
        for (name, source) in [
            (
                "update-game.mjs",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../../packages/create-game/bin/update-game.mjs"
                )),
            ),
            (
                "github-release.mjs",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../../packages/create-game/bin/github-release.mjs"
                )),
            ),
            (
                "update-integrity.mjs",
                include_str!(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../../packages/create-game/bin/update-integrity.mjs"
                )),
            ),
        ] {
            fs::write(result.0.join(name), source).map_err(|e| e.to_string())?;
        }
        Ok(result)
    }
}
impl Drop for HelperDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn project_helper(root: &Path, update: Option<(&str, &str)>) -> UpdateResult<Value> {
    let helper = HelperDirectory::new()?;
    let mut command = Command::new("node");
    command
        .arg(helper.0.join("update-game.mjs"))
        .arg("--project")
        .arg(root);
    if let Some((version, expected)) = update {
        target_version(version)?;
        semver::Version::parse(expected).map_err(|e| e.to_string())?;
        command.args(["--apply", "--to", version, "--expected-version", expected]);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Node.js is required for project engine updates".to_owned())?;
    let read = |mut pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 8192];
            while let Ok(count) = pipe.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                // Drain even excessive output so a child cannot block on a full pipe.
                let retained = count.min((128 * 1024usize).saturating_sub(bytes.len()));
                bytes.extend_from_slice(&buffer[..retained]);
            }
            bytes
        })
    };
    let stdout = read(Box::new(
        child.stdout.take().ok_or("Missing updater output")?,
    ));
    let stderr = read(Box::new(
        child.stderr.take().ok_or("Missing updater error output")?,
    ));
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(if update.is_some() { 1000 } else { 180 }) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Project update timed out; inspect .ferrum-updates backups".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let stdout = stdout.join().map_err(|_| "Updater output reader failed")?;
    let stderr = stderr.join().map_err(|_| "Updater error reader failed")?;
    let bytes = if status.success() { &stdout } else { &stderr };
    let mut value: Value = serde_json::from_slice(bytes)
        .or_else(|error| {
            if status.success() {
                return Err(error);
            }
            bytes
                .split(|byte| *byte == b'\n')
                .rev()
                .find_map(|line| serde_json::from_slice(line).ok())
                .ok_or(error)
        })
        .map_err(|_| "Invalid updater response".to_owned())?;
    if !status.success() || value["ok"] != true {
        return Err(value["error"]
            .as_str()
            .unwrap_or("Project update failed")
            .to_owned());
    }
    if value["projectPath"]
        .as_str()
        .and_then(|path| fs::canonicalize(path).ok())
        .as_deref()
        != Some(root)
    {
        return Err("Updater project response mismatch".into());
    }
    value["projectPath"] = Value::String(root.to_string_lossy().into_owned());
    Ok(value)
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn placement_update_info(app: tauri::AppHandle) -> Value {
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(Value::as_str)
        .filter(|key| !key.trim().is_empty());
    let os = if std::env::consts::OS == "macos" {
        "macos"
    } else {
        std::env::consts::OS
    };
    let arch = if std::env::consts::ARCH == "x86_64" {
        "x64"
    } else if std::env::consts::ARCH == "aarch64" {
        "arm64"
    } else {
        "unsupported"
    };
    #[cfg(target_os = "linux")]
    let portable = {
        use tauri::Manager;
        app.env().appimage.is_some_and(|path| !path.is_empty())
    };
    #[cfg(not(target_os = "linux"))]
    let portable = true;
    json!({"viewerVersion":app.package_info().version.to_string(),"bundledEngineVersion":app.package_info().version.to_string(),"repository":REPOSITORY,"os":os,"arch":arch,"configured":key.is_some(),"canInstall":key.is_some() && portable,"reason":if !portable { "Linux automatic updates require AppImage" } else if key.is_none() { "This build has no update signing key" } else { "" }})
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub async fn check_placement_project_update(
    project_path: String,
    registry: tauri::State<'_, PlacementWriteRegistry>,
) -> UpdateResult<Value> {
    let root = approved_project(&project_path, &registry)?;
    tauri::async_runtime::spawn_blocking(move || project_helper(&root, None))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(feature = "desktop")]
#[tauri::command]
pub async fn apply_placement_project_update(
    project_path: String,
    version: String,
    expected_version: String,
    registry: tauri::State<'_, PlacementWriteRegistry>,
    state: tauri::State<'_, UpdateState>,
) -> UpdateResult<Value> {
    let _guard = begin(&state)?;
    let root = approved_project(&project_path, &registry)?;
    tauri::async_runtime::spawn_blocking(move || {
        project_helper(&root, Some((&version, &expected_version)))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(feature = "desktop")]
#[tauri::command]
pub async fn check_placement_viewer_update(
    version: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> UpdateResult<Value> {
    use tauri_plugin_updater::UpdaterExt;
    if state.is_busy() {
        return Err("Another update is running".into());
    }
    let serial = state.app_check_serial.fetch_add(1, Ordering::AcqRel) + 1;
    let info = placement_update_info(app.clone());
    if info["canInstall"] != true {
        return Err(info["reason"]
            .as_str()
            .unwrap_or("Automatic updates are unavailable")
            .into());
    }
    let endpoint = metadata_url(
        &version,
        info["os"].as_str().unwrap_or(""),
        info["arch"].as_str().unwrap_or(""),
    )?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint.parse().map_err(|_| "Invalid updater URL")?])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    if state.is_busy() || state.app_check_serial.load(Ordering::Acquire) != serial {
        return Err("Update check was superseded".into());
    }
    let mut pending = state
        .pending
        .lock()
        .map_err(|_| "Updater state unavailable")?;
    if let Some(update) = update {
        if update.version != version
            || !update.download_url.as_str().starts_with(&format!(
                "https://github.com/{REPOSITORY}/releases/download/ferrum-web-v{version}/"
            ))
        {
            return Err("Updater release does not match the selected version".into());
        }
        let token = format!(
            "{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        );
        *pending = Some((token.clone(), update));
        Ok(json!({"available":true,"version":version,"token":token}))
    } else {
        *pending = None;
        Ok(json!({"available":false}))
    }
}
#[cfg(feature = "desktop")]
#[tauri::command]
pub async fn apply_placement_viewer_update(
    token: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> UpdateResult<Value> {
    use tauri::Emitter;
    let _guard = begin(&state)?;
    let update = {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "Updater state unavailable")?;
        if pending.as_ref().map(|value| value.0.as_str()) != Some(token.as_str()) {
            return Err("Check for updates again before installing".into());
        }
        pending.take().ok_or("Update is unavailable")?.1
    };
    let mut received = 0u64;
    let mut last = Instant::now();
    update
        .download_and_install(
            |count, total| {
                received += count as u64;
                if last.elapsed() > Duration::from_millis(200) {
                    let _ = app.emit(
                        "ferrum-update-progress",
                        json!({"phase":"download","received":received,"total":total}),
                    );
                    last = Instant::now();
                }
            },
            || {
                let _ = app.emit("ferrum-update-progress", json!({"phase":"install"}));
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    state.restart_required.store(true, Ordering::Release);
    Ok(json!({"installed":true,"restartRequired":true}))
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn restart_placement_viewer_after_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> UpdateResult<()> {
    if !state.restart_required.load(Ordering::Acquire) || state.is_busy() {
        return Err("No completed editor update is ready to restart".into());
    }
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_targets_are_exact_beta_versions_and_fixed_release_urls() {
        assert!(metadata_url("0.1.0-beta.10", "windows", "x64")
            .unwrap()
            .ends_with("/ferrum-web-v0.1.0-beta.10/viewer-updater-windows-x64.json"));
        for invalid in [
            "latest",
            "0.1.0",
            "0.1.0-beta.01",
            "0.1.0-beta.1+other",
            "../malicious",
            "0.1.0-beta.1.2",
        ] {
            assert!(target_version(invalid).is_err(), "{invalid}");
        }
        assert!(metadata_url("0.1.0-beta.1", "../linux", "x64").is_err());
    }
    #[test]
    fn only_explicit_projects_can_update_and_updates_are_serialized() {
        let directory = HelperDirectory::new().unwrap();
        let registry = PlacementWriteRegistry::default();
        assert!(approved_project(directory.0.to_str().unwrap(), &registry).is_err());
        registry.authorize_project(&directory.0).unwrap();
        assert!(approved_project(directory.0.to_str().unwrap(), &registry).is_ok());
        let state = UpdateState::default();
        let guard = begin(&state).unwrap();
        assert!(begin(&state).is_err());
        drop(guard);
        assert!(begin(&state).is_ok());
    }
    #[test]
    fn embedded_helper_reports_project_errors_without_loading_game_code() {
        assert!(Command::new("node")
            .arg("--version")
            .output()
            .expect("Node.js is required for updater development tests")
            .status
            .success());
        let directory = HelperDirectory::new().unwrap();
        fs::write(directory.0.join("package.json"), r#"{"name":"empty-game"}"#).unwrap();
        assert!(project_helper(&directory.0, None)
            .unwrap_err()
            .contains("Project does not depend"));
    }
    #[test]
    fn release_links_allow_only_exact_github_beta_pages() {
        assert!(release_page(
            "https://github.com/silbaram/ferrum2d/releases/tag/ferrum-web-v0.1.0-beta.10"
        )
        .is_ok());
        for url in [
            "javascript:alert(1)",
            "https://github.com@evil.test/a/b/releases/tag/ferrum-web-v0.1.0-beta.1",
            "https://github.com/a/b/releases/tag/ferrum-web-v0.1.0-beta.1?x",
            "https://github.com/a/b/releases/download/v/a.exe",
            "https://github.com/../b/releases/tag/ferrum-web-v0.1.0-beta.1",
        ] {
            assert!(release_page(url).is_err());
        }
    }
}
