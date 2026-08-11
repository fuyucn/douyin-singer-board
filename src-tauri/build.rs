use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    // Locate the platform-specific sidecar binary built by
    // `pnpm sidecar:build:bin`, then copy it to OUT_DIR with a fixed name so
    // lib.rs can `include_bytes!` it with a platform-independent path.
    let target = env::var("TARGET").expect("TARGET not set");
    let ext = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    let (prefix, hint, out_name) = ("sidecar", "pnpm sidecar:build:bin", "sidecar.bin");

    let src = PathBuf::from(&manifest_dir)
        .join("binaries")
        .join(format!("{prefix}-{target}{ext}"));
    let dst = out_dir.join(out_name);

    if src.exists() {
        fs::copy(&src, &dst).expect("copy binary to OUT_DIR");
        println!("cargo:rerun-if-changed={}", src.display());
    } else {
        // First-time build with no binary: write a tiny placeholder so
        // include_bytes! still compiles. The runtime detects the empty
        // payload and aborts with a clear message.
        fs::write(&dst, b"").expect("placeholder binary");
        println!(
            "cargo:warning={prefix} binary not found at {} — run `{hint}` first",
            src.display()
        );
    }

    tauri_build::build()
}
