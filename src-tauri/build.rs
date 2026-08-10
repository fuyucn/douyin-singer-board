use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    // Locate the platform-specific binaries built by `pnpm sidecar:build:bin`
    // and `pnpm kugou-api:build:bin`, then copy them to OUT_DIR with fixed
    // names so lib.rs can `include_bytes!` them with platform-independent paths.
    let target = env::var("TARGET").expect("TARGET not set");
    let ext = if target.contains("windows") { ".exe" } else { "" };
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    // (binary-prefix, hint-script, OUT_DIR file name)
    let bins = [
        ("sidecar", "pnpm sidecar:build:bin", "sidecar.bin"),
        ("kugou-api", "pnpm kugou-api:build:bin", "kugou-api.bin"),
    ];

    for (prefix, hint, out_name) in bins {
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
    }

    tauri_build::build()
}
