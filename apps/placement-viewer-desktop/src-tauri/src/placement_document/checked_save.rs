use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::Value;

use super::{read_scene_document, validate_scene_document, CommandResult, PlacementDesktopError};

static SAVE_SERIAL: AtomicU64 = AtomicU64::new(0);

/// Compare semantic JSON immediately before replacement; external writers do not share our lock.
pub(super) fn save_checked(path: &Path, document: Value, expected: &Value) -> CommandResult<Value> {
    validate_scene_document(&document)?;
    validate_scene_document(expected)?;
    let conflict = || {
        PlacementDesktopError::InvalidDocument(
            "scene document changed on disk; reload before saving".to_owned(),
        )
    };
    if !same_json(&read_scene_document(path)?, expected) {
        return Err(conflict());
    }
    let serial = SAVE_SERIAL.fetch_add(1, Ordering::Relaxed);
    let temporary = path.with_file_name(format!(
        ".ferrum-scene-save-{}-{serial}.tmp",
        std::process::id()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|source| PlacementDesktopError::Io {
            path: temporary.clone(),
            source,
        })?;
    let result = (|| {
        let permissions = fs::metadata(path)
            .map_err(|source| PlacementDesktopError::Io {
                path: path.to_path_buf(),
                source,
            })?
            .permissions();
        file.set_permissions(permissions)
            .map_err(|source| PlacementDesktopError::Io {
                path: temporary.clone(),
                source,
            })?;
        let json = serde_json::to_string_pretty(&document).map_err(|source| {
            PlacementDesktopError::Json {
                path: path.to_path_buf(),
                source,
            }
        })?;
        file.write_all(format!("{json}\n").as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|source| PlacementDesktopError::Io {
                path: temporary.clone(),
                source,
            })?;
        drop(file);
        if !same_json(&read_scene_document(path)?, expected) {
            return Err(conflict());
        }
        fs::rename(&temporary, path).map_err(|source| PlacementDesktopError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        Ok(document)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

// Browser JSON.stringify turns 1.0 into 1. Compare their numeric value without
// converting large integer IDs to f64 and hiding an external one-unit change.
fn same_json(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .all(|(key, value)| right.get(key).is_some_and(|other| same_json(value, other)))
        }
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| same_json(left, right))
        }
        (Value::Number(left), Value::Number(right)) if left != right => {
            let (integer, float) = if left.is_f64() {
                (right, left)
            } else {
                (left, right)
            };
            let integer = integer
                .as_i64()
                .map(i128::from)
                .or_else(|| integer.as_u64().map(i128::from));
            match (integer, float.as_f64()) {
                (Some(integer), Some(float)) => float.fract() == 0.0 && float as i128 == integer,
                _ => false,
            }
        }
        _ => left == right,
    }
}
