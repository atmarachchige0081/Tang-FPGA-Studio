use crate::models::BoardProfile;
use crate::security::{canonical_workspace, safe_existing_path};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

const MAX_PROFILE_BYTES: u64 = 128 * 1024;
const MAX_PROFILES: usize = 64;

pub fn list(root: &str) -> Result<Vec<BoardProfile>, String> {
    let workspace = canonical_workspace(root)?;
    let vendor_root = safe_existing_path(&workspace, "boards/gowin")?;
    let mut profiles = Vec::new();
    for entry in fs::read_dir(&vendor_root)
        .map_err(|error| format!("Cannot inspect board packages: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Cannot read a board package: {error}"))?;
        let path = entry.path().join("board.json");
        if !path.is_file() {
            continue;
        }
        if profiles.len() >= MAX_PROFILES {
            return Err(format!(
                "More than {MAX_PROFILES} board packages were found"
            ));
        }
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
        if metadata.len() > MAX_PROFILE_BYTES {
            return Err(format!("Board profile {} is too large", path.display()));
        }
        let profile: BoardProfile = serde_json::from_slice(
            &fs::read(&path).map_err(|error| format!("Cannot read {}: {error}", path.display()))?,
        )
        .map_err(|error| format!("Board profile {} is invalid: {error}", path.display()))?;
        validate(&workspace, &path, &profile)?;
        profiles.push(profile);
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for profile in &profiles {
        if !ids.insert(profile.id.as_str()) {
            return Err(format!("Duplicate board id '{}'", profile.id));
        }
        if !names.insert(profile.name.as_str()) {
            return Err(format!("Duplicate board display name '{}'", profile.name));
        }
    }
    profiles.sort_by(|left, right| left.name.cmp(&right.name));
    if profiles.is_empty() {
        return Err("No FPGA board packages were found".into());
    }
    Ok(profiles)
}

pub fn active(root: &str, project: &str) -> Result<BoardProfile, String> {
    let workspace = canonical_workspace(root)?;
    let project_dir = safe_existing_path(&workspace, project)?;
    let board_id = read_board_id(&project_dir).unwrap_or_else(|| "tang_primer_20k".into());
    list(&workspace.to_string_lossy())?
        .into_iter()
        .find(|profile| profile.id == board_id)
        .ok_or_else(|| format!("Project selects unknown board package '{board_id}'"))
}

fn read_board_id(project_dir: &Path) -> Option<String> {
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(project_dir.join("fpga.project.json")).ok()?).ok()?;
    value.get("board")?.as_str().map(str::to_owned)
}

fn validate(workspace: &Path, profile_path: &Path, profile: &BoardProfile) -> Result<(), String> {
    if profile.schema_version != 1 {
        return Err(format!(
            "{} uses an unsupported schema",
            profile_path.display()
        ));
    }
    if profile.id.is_empty()
        || !profile.id.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '_' | '-')
        })
    {
        return Err(format!(
            "{} has an invalid board id",
            profile_path.display()
        ));
    }
    if profile.clocks.is_empty() || profile.constraints.is_empty() {
        return Err(format!(
            "{} must declare a clock and constraints",
            profile_path.display()
        ));
    }
    if profile.programmer.backend != "openFPGALoader" {
        return Err(format!(
            "{} requests an unsupported programmer",
            profile_path.display()
        ));
    }
    if let Some(build) = &profile.build {
        if !matches!(build.backend.as_str(), "oss-cad-suite" | "gowin-eda") {
            return Err(format!(
                "Board '{}' requests unsupported build backend '{}'",
                profile.id, build.backend
            ));
        }
        if build.device_name.trim().is_empty() {
            return Err(format!("Board '{}' has no Gowin device name", profile.id));
        }
        if build.backend == "gowin-eda"
            && (build.device_code.as_deref().unwrap_or_default().is_empty()
                || build
                    .device_version
                    .as_deref()
                    .unwrap_or_default()
                    .is_empty())
        {
            return Err(format!(
                "Board '{}' must declare the Gowin device code and version",
                profile.id
            ));
        }
    }
    let package = profile_path
        .parent()
        .ok_or("Board package has no directory")?;
    for relative in &profile.constraints {
        let constraint = safe_existing_path(package, relative);
        if !constraint
            .as_ref()
            .map(|path| path.starts_with(workspace) && path.is_file())
            .unwrap_or(false)
        {
            return Err(format!(
                "Board '{}' is missing constraint file {relative}",
                profile.id
            ));
        }
    }
    for relative in &profile.timing_constraints {
        let constraint = safe_existing_path(package, relative);
        if !constraint
            .as_ref()
            .map(|path| path.starts_with(workspace) && path.is_file())
            .unwrap_or(false)
        {
            return Err(format!(
                "Board '{}' is missing timing constraint file {relative}",
                profile.id
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{list, read_board_id};
    use std::fs;

    #[test]
    fn reads_board_from_manifest() {
        let directory =
            std::env::temp_dir().join(format!("fpga-board-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("fpga.project.json"),
            r#"{"board":"tang_nano_9k"}"#,
        )
        .unwrap();
        assert_eq!(read_board_id(&directory).as_deref(), Some("tang_nano_9k"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn repository_contains_every_supported_tang_profile() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let profiles =
            list(&root.to_string_lossy()).expect("repository board packages must validate");
        for expected in [
            "tang_nano_1k",
            "tang_nano_4k",
            "tang_nano_9k",
            "tang_nano_20k",
            "tang_console_60k",
            "tang_console_138k",
            "tang_primer_20k",
            "tang_primer_20k_core",
            "tang_primer_20k_lite",
        ] {
            assert!(
                profiles.iter().any(|profile| profile.id == expected),
                "missing {expected}"
            );
        }
        let console_60k = profiles
            .iter()
            .find(|profile| profile.id == "tang_console_60k")
            .expect("Console 60K profile");
        assert_eq!(console_60k.name, "Sipeed Tang Console 60K");
        assert_eq!(console_60k.device, "GW5AT-LV60PG484AC1/I0");
        assert_eq!(console_60k.family, "GW5AT-60B");
        assert_eq!(console_60k.clocks[0].frequency_hz, 50_000_000);
        assert_eq!(console_60k.programmer.board, "tangconsole");
        assert_eq!(
            console_60k
                .build
                .as_ref()
                .map(|build| build.backend.as_str()),
            Some("gowin-eda")
        );

        let console_138k = profiles
            .iter()
            .find(|profile| profile.id == "tang_console_138k")
            .expect("Console 138K profile");
        assert_eq!(console_138k.name, "Sipeed Tang Console 138K");
        assert_eq!(console_138k.device, "GW5AST-LV138PG484AC1/I0");
        assert_eq!(console_138k.family, "GW5AST-138C");
        assert_eq!(console_138k.clocks[0].pin, "V22");
        assert_eq!(console_138k.programmer.board, "tangmega138k");
    }
}
