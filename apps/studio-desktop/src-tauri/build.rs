fn main() {
    println!("cargo:rustc-check-cfg=cfg(mobile)");
    #[cfg(feature = "desktop")]
    tauri_build::build();
}
