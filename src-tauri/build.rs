use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    // Locate the platform-specific sidecar binary built by `pnpm sidecar:build:bin`
    // and copy it to OUT_DIR/sidecar.bin so lib.rs can `include_bytes!` it
    // with a fixed (platform-independent) path.
    let target = env::var("TARGET").expect("TARGET not set");
    let ext = if target.contains("windows") { ".exe" } else { "" };
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let src = PathBuf::from(&manifest_dir)
        .join("binaries")
        .join(format!("sidecar-{}{}", target, ext));

    let out_dir = env::var("OUT_DIR").unwrap();
    let dst = PathBuf::from(&out_dir).join("sidecar.bin");

    if src.exists() {
        fs::copy(&src, &dst).expect("copy sidecar to OUT_DIR");
        println!("cargo:rerun-if-changed={}", src.display());
    } else {
        // First-time build with no sidecar binary: write a tiny placeholder so
        // include_bytes! still compiles. The runtime will detect the empty/short
        // payload and abort with a clear message.
        fs::write(&dst, b"").expect("placeholder sidecar");
        println!(
            "cargo:warning=sidecar binary not found at {} — run `pnpm sidecar:build:bin` first",
            src.display()
        );
    }

    tauri_build::build()
}
