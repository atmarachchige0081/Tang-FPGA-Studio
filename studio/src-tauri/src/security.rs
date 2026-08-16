use std::path::{Component, Path, PathBuf};

const TEXT_EXTENSIONS: &[&str] = &[
    "v", "sv", "vh", "svh", "cst", "sdc", "json", "jsonc", "md", "txt", "toml", "yml", "yaml",
    "ps1", "psd1", "tcl", "gtkw", "py", "rs", "ts", "tsx", "js", "jsx", "css", "html", "htm", "sh",
    "bat", "cmd",
];

pub fn canonical_workspace(root: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root)
        .map_err(|error| format!("Workspace is unavailable: {error}"))?;
    if !root.is_dir() {
        return Err("Workspace root is not a directory".into());
    }
    if !root.join("fpga.ps1").is_file() {
        return Err(
            "The selected folder is not an FPGA Studio workspace (fpga.ps1 is missing)".into(),
        );
    }
    Ok(root)
}

/// Convert Rust's Windows verbatim path into a form accepted by legacy child
/// processes such as Windows PowerShell 5.1. Keep canonical paths internally
/// for boundary checks, but never pass a `\\?\` path to a script host.
pub fn child_process_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(network) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{network}"));
        }
        if let Some(local) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(local);
        }
    }
    path.to_path_buf()
}

pub fn safe_existing_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    validate_relative(relative)?;
    let candidate = std::fs::canonicalize(root.join(relative))
        .map_err(|error| format!("Path is unavailable: {error}"))?;
    if !candidate.starts_with(root) {
        return Err("The requested path is outside the workspace".into());
    }
    Ok(candidate)
}

pub fn safe_file_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    validate_relative(relative)?;
    let candidate = root.join(relative);
    let parent = candidate.parent().ok_or("File has no parent directory")?;
    let parent = std::fs::canonicalize(parent)
        .map_err(|error| format!("File directory is unavailable: {error}"))?;
    if !parent.starts_with(root) {
        return Err("The requested file is outside the workspace".into());
    }
    if candidate.exists() {
        let canonical = std::fs::canonicalize(&candidate)
            .map_err(|error| format!("File is unavailable: {error}"))?;
        if !canonical.starts_with(root) {
            return Err("The requested file resolves outside the workspace".into());
        }
    }
    let extension = candidate
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !TEXT_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("Editing .{extension} files is not supported"));
    }
    Ok(candidate)
}

fn validate_relative(relative: &str) -> Result<(), String> {
    if relative.trim().is_empty() {
        return Err("A relative path is required".into());
    }
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err("Absolute paths and path traversal are not allowed".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{child_process_path, validate_relative};
    use std::path::Path;

    #[test]
    fn relative_paths_are_accepted() {
        assert!(validate_relative("rtl/top.sv").is_ok());
        assert!(validate_relative("./sim/tb_top.sv").is_ok());
    }

    #[test]
    fn traversal_and_absolute_paths_are_rejected() {
        assert!(validate_relative("../outside.sv").is_err());
        assert!(validate_relative("C:\\outside.sv").is_err());
        assert!(validate_relative("/outside.sv").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_windows_paths_are_safe_for_legacy_child_processes() {
        assert_eq!(
            child_process_path(Path::new(r"\\?\C:\Users\Example\FPGA")),
            Path::new(r"C:\Users\Example\FPGA")
        );
        assert_eq!(
            child_process_path(Path::new(r"\\?\UNC\server\share\FPGA")),
            Path::new(r"\\server\share\FPGA")
        );
    }

    #[cfg(windows)]
    #[test]
    fn normalized_script_path_preserves_powershell_script_root() {
        let directory = std::env::temp_dir().join(format!(
            "fpga studio powershell path {}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).expect("temporary directory");
        let script = directory.join("script-root-check.ps1");
        std::fs::write(
            &script,
            "if (-not $PSScriptRoot) { exit 7 }\nif (-not (Test-Path -LiteralPath $PSScriptRoot -PathType Container)) { exit 8 }\n",
        )
        .expect("test script");
        let canonical = std::fs::canonicalize(&script).expect("canonical script");
        let status = std::process::Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(child_process_path(&canonical))
            .status()
            .expect("PowerShell should start");
        assert!(status.success());
        std::fs::remove_dir_all(directory).expect("cleanup");
    }
}
