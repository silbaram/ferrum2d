use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

fn collect(path: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            collect(&entry.path(), files)?;
        } else if kind.is_file() && entry.path().extension().is_some_and(|e| e == "rs") {
            files.push(entry.path());
        }
    }
    Ok(())
}
fn hash(bytes: &[u8], value: &mut u64) {
    for byte in bytes {
        *value = (*value ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
    }
}
fn main() -> io::Result<()> {
    let root = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR").expect("Cargo supplies manifest directory"),
    );
    let mut files = Vec::new();
    collect(&root.join("src"), &mut files)?;
    collect(&root.join("vendor/rapier3d/src"), &mut files)?;
    collect(&root.join("vendor/parry3d/src"), &mut files)?;
    for name in [
        "build.rs",
        "Cargo.toml",
        "Cargo.lock",
        "vendor/rapier3d/Cargo.toml",
        "vendor/rapier3d/FERRUM-PATCHES.md",
        "vendor/rapier3d/UPSTREAM.json",
        "vendor/parry3d/Cargo.toml",
        "vendor/parry3d/FERRUM-PATCHES.md",
        "vendor/parry3d/UPSTREAM.json",
    ] {
        files.push(root.join(name));
    }
    files.sort();
    let mut value = 0xcbf29ce484222325;
    for file in &files {
        println!("cargo:rerun-if-changed={}", file.display());
        hash(
            file.strip_prefix(&root)
                .expect("collected inside crate")
                .to_string_lossy()
                .as_bytes(),
            &mut value,
        );
        hash(&[0], &mut value);
        hash(&fs::read(file)?, &mut value);
        hash(&[0], &mut value);
    }
    // Watch directories too, so adding/removing a schema input invalidates the build.
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=vendor/rapier3d/src");
    println!("cargo:rerun-if-changed=vendor/parry3d/src");
    for variable in [
        "TARGET",
        "CARGO_CFG_TARGET_POINTER_WIDTH",
        "CARGO_CFG_TARGET_ENDIAN",
    ] {
        hash(
            env::var(variable)
                .expect("Cargo supplies target metadata")
                .as_bytes(),
            &mut value,
        );
        hash(&[0], &mut value);
    }
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo supplies output directory"));
    fs::write(
        out.join("checkpoint_build.rs"),
        format!("const BUILD: u64 = {value};\n"),
    )
}
