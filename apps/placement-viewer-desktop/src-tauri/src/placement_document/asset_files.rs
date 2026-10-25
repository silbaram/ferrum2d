//! Bounded immutable project files shared by atlas and normal catalogs.
use super::{CommandResult, PlacementDesktopError};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
fn invalid(message: &str) -> PlacementDesktopError {
    PlacementDesktopError::InvalidAssetFolderPath(message.to_owned())
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
pub(super) fn directory(
    project: &Path,
    name: &str,
    create: bool,
) -> CommandResult<Option<PathBuf>> {
    let mut path = project.to_owned();
    for component in ["public", "assets", name] {
        path.push(component);
        if !path.exists() && create {
            fs::create_dir(&path).map_err(|e| io(&path, e))?;
        }
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
            _ => {
                return Err(invalid(
                    "project asset directories must not be symbolic links",
                ))
            }
        }
        if path.canonicalize().map_err(|e| io(&path, e))? != path {
            return Err(invalid("project asset directory changed"));
        }
    }
    Ok(Some(path))
}

pub(super) fn bounded_read(path: &Path, limit: usize) -> CommandResult<Vec<u8>> {
    let metadata = fs::symlink_metadata(path).map_err(|e| io(path, e))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > limit as u64 {
        return Err(invalid("asset is a link, non-file, or exceeds byte limit"));
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| io(path, e))?
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| io(path, e))?;
    if bytes.len() > limit {
        return Err(invalid("asset exceeds byte limit"));
    }
    Ok(bytes)
}

pub(super) fn read_catalog(root: &Path) -> CommandResult<Option<Vec<u8>>> {
    let path = root.join("catalog.json");
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => bounded_read(&path, 1024 * 1024).map(Some),
    }
}

#[derive(Debug)]
pub(super) struct Created {
    path: PathBuf,
    metadata: fs::Metadata,
    sha256: String,
    length: usize,
}

fn same_file(path: &Path, expected: &fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        fs::symlink_metadata(path)
            .is_ok_and(|now| now.dev() == expected.dev() && now.ino() == expected.ino())
    }
    // Keep unreferenced immutable files when identity cannot be proven.
    #[cfg(not(unix))]
    {
        let _ = (path, expected);
        false
    }
}

pub(super) fn create_file(
    path: &Path,
    bytes: &[u8],
    created: &mut Vec<Created>,
) -> CommandResult<()> {
    if fs::symlink_metadata(path).is_ok() {
        if bounded_read(path, bytes.len())? != bytes {
            return Err(invalid("existing asset differs; no files were overwritten"));
        }
        return Ok(());
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| io(path, e))?;
    created.push(Created {
        path: path.to_owned(),
        metadata: file.metadata().map_err(|e| io(path, e))?,
        sha256: hash(bytes),
        length: bytes.len(),
    });
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| io(path, e))
}

pub(super) fn rollback(created: Vec<Created>) {
    for entry in created.into_iter().rev() {
        if same_file(&entry.path, &entry.metadata)
            && bounded_read(&entry.path, entry.length)
                .is_ok_and(|bytes| hash(&bytes) == entry.sha256)
        {
            let _ = fs::remove_file(entry.path);
        }
    }
}

pub(super) fn publish_catalog(
    project: &Path,
    name: &str,
    root: &Path,
    temporary: &Path,
    expected: Option<&[u8]>,
) -> CommandResult<()> {
    if read_catalog(root)?.as_deref() != expected
        || directory(project, name, false)?.as_deref() != Some(root)
    {
        return Err(invalid(
            "project catalog changed on disk; reopen before saving",
        ));
    }
    let target = root.join("catalog.json");
    fs::rename(temporary, &target).map_err(|e| io(&target, e))
}
