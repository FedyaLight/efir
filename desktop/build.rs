#[cfg(feature = "shell")]
use std::{fs, path::Path};
#[cfg(feature = "shell")]
fn copy_web(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.')
            || ["README.md", "netlify.toml", "peerjs.min.js"].contains(&name.as_ref())
        {
            continue;
        }
        let dest = target.join(name.as_ref());
        if entry.file_type()?.is_dir() {
            copy_web(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}
fn main() {
    println!("cargo:rerun-if-changed=../web");
    #[cfg(feature = "shell")]
    {
        let target = Path::new("resources/web");
        if target.exists() {
            fs::remove_dir_all(target).expect("remove old web resources");
        }
        copy_web(Path::new("../web"), target).expect("copy common web resources");
        tauri_build::try_build(
            tauri_build::Attributes::new()
                .app_manifest(tauri_build::AppManifest::new().commands(&["native"])),
        )
        .expect("Tauri build");
    }
}
