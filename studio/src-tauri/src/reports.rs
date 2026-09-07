use crate::models::{
    BuildAction, BuildHistoryEntry, BuildHistoryFile, BuildSummary, ClockTiming, CriticalPath,
    ResourceUsage,
};
use crate::security::{canonical_workspace, resolve_project_path};
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::fs;
use std::path::Path;

const MAX_TIMING_REPORT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_HISTORY_BYTES: u64 = 4 * 1024 * 1024;

pub fn build_summary(root: &str, project: &str) -> Result<BuildSummary, String> {
    let root = canonical_workspace(root)?;
    let project = resolve_project_path(&root, project)?;
    let report_path = project.join("build/timing.json");
    let bitstream_path = project.join("build/top.fs");
    if !report_path.is_file() {
        return Ok(empty_summary(file_size(&bitstream_path)));
    }
    let report_bytes = file_size(&report_path).unwrap_or(0);
    if report_bytes > MAX_TIMING_REPORT_BYTES {
        return Err("Timing report exceeds the 64 MiB safety limit".into());
    }
    let data: Value = serde_json::from_slice(
        &fs::read(&report_path).map_err(|error| format!("Cannot read timing report: {error}"))?,
    )
    .map_err(|error| format!("Timing report is invalid JSON: {error}"))?;
    parse_summary(
        &data,
        file_size(&bitstream_path),
        fs::metadata(&report_path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .map(|time| DateTime::<Utc>::from(time).to_rfc3339()),
    )
}

fn empty_summary(bitstream_bytes: Option<u64>) -> BuildSummary {
    BuildSummary {
        status: "ready".into(),
        fmax_m_hz: None,
        target_m_hz: None,
        lut_used: None,
        lut_total: None,
        registers_used: None,
        registers_total: None,
        bitstream_bytes,
        worst_slack_ns: None,
        updated_at: None,
        timing_met: None,
        resources: Vec::new(),
        clocks: Vec::new(),
        critical_paths: Vec::new(),
    }
}

fn parse_summary(
    data: &Value,
    bitstream_bytes: Option<u64>,
    updated_at: Option<String>,
) -> Result<BuildSummary, String> {
    if !data.is_object() {
        return Err("Timing report root must be a JSON object".into());
    }
    let mut clocks = Vec::new();
    if let Some(items) = data.get("fmax").and_then(Value::as_object) {
        for (name, value) in items {
            let Some(achieved) = value.get("achieved").and_then(Value::as_f64) else {
                continue;
            };
            let Some(constraint) = value.get("constraint").and_then(Value::as_f64) else {
                continue;
            };
            let slack_ns = if achieved > 0.0 && constraint > 0.0 {
                1000.0 / constraint - 1000.0 / achieved
            } else {
                0.0
            };
            clocks.push(ClockTiming {
                name: name.clone(),
                achieved_m_hz: achieved,
                constraint_m_hz: constraint,
                slack_ns,
                timing_met: achieved + f64::EPSILON >= constraint,
            });
        }
    }
    clocks.sort_by(|left, right| left.slack_ns.total_cmp(&right.slack_ns));
    let timing_met = (!clocks.is_empty()).then(|| clocks.iter().all(|clock| clock.timing_met));

    let mut resources = Vec::new();
    if let Some(items) = data.get("utilization").and_then(Value::as_object) {
        for (name, value) in items {
            let Some(used) = value.get("used").and_then(Value::as_u64) else {
                continue;
            };
            let Some(total) = value.get("available").and_then(Value::as_u64) else {
                continue;
            };
            resources.push(ResourceUsage {
                name: name.clone(),
                label: resource_label(name).into(),
                used,
                total,
            });
        }
    }
    resources.sort_by(|left, right| {
        resource_rank(&left.name)
            .cmp(&resource_rank(&right.name))
            .then_with(|| right.used.cmp(&left.used))
            .then_with(|| left.name.cmp(&right.name))
    });

    let mut critical_paths = data
        .get("critical_paths")
        .and_then(Value::as_array)
        .map(|paths| {
            paths
                .iter()
                .filter_map(|path| {
                    let segments = path.get("path")?.as_array()?;
                    let delay_ns = segments
                        .iter()
                        .filter_map(|segment| segment.get("delay").and_then(Value::as_f64))
                        .sum::<f64>();
                    let source = path
                        .get("from")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown source")
                        .to_owned();
                    let destination = path
                        .get("to")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown destination")
                        .to_owned();
                    let clock_name = source
                        .strip_prefix("posedge ")
                        .or_else(|| source.strip_prefix("negedge "));
                    let slack_ns = clock_name
                        .and_then(|clock_name| clocks.iter().find(|clock| clock.name == clock_name))
                        .and_then(|clock| {
                            (clock.constraint_m_hz > 0.0)
                                .then(|| 1000.0 / clock.constraint_m_hz - delay_ns)
                        });
                    Some(CriticalPath {
                        source,
                        destination,
                        delay_ns,
                        slack_ns,
                        segments: segments.len(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    critical_paths.sort_by(|left, right| right.delay_ns.total_cmp(&left.delay_ns));
    critical_paths.truncate(8);

    let (lut_used, lut_total) = utilization_pair(data.get("utilization"), "LUT4");
    let (registers_used, registers_total) = utilization_pair(data.get("utilization"), "DFF");
    let fmax_m_hz = clocks.first().map(|clock| clock.achieved_m_hz);
    let target_m_hz = clocks.first().map(|clock| clock.constraint_m_hz);
    let worst_slack_ns = critical_paths
        .iter()
        .filter_map(|path| path.slack_ns)
        .min_by(f64::total_cmp)
        .or_else(|| {
            clocks
                .iter()
                .map(|clock| clock.slack_ns)
                .min_by(f64::total_cmp)
        });

    Ok(BuildSummary {
        status: if timing_met == Some(false) {
            "failed".into()
        } else {
            "passed".into()
        },
        fmax_m_hz,
        target_m_hz,
        lut_used,
        lut_total,
        registers_used,
        registers_total,
        bitstream_bytes,
        worst_slack_ns,
        updated_at,
        timing_met,
        resources,
        clocks,
        critical_paths,
    })
}

fn resource_rank(name: &str) -> u8 {
    match name {
        "LUT4" => 0,
        "DFF" => 1,
        "BSRAM" => 2,
        "MULT18X18" | "MULT36X36" | "MULT9X9" => 3,
        "IOB" => 4,
        "rPLL" => 5,
        "BUFG" => 6,
        _ => 10,
    }
}

fn resource_label(name: &str) -> &str {
    match name {
        "LUT4" => "Logic LUTs",
        "DFF" => "Flip-flops",
        "BSRAM" => "Block RAM",
        "IOB" => "I/O blocks",
        "BUFG" => "Global clock buffers",
        "rPLL" => "PLLs",
        "MULT18X18" => "18×18 DSP multipliers",
        "MULT36X36" => "36×36 DSP multipliers",
        "MULT9X9" => "9×9 DSP multipliers",
        _ => name,
    }
}

fn utilization_pair(root: Option<&Value>, name: &str) -> (Option<u64>, Option<u64>) {
    let item = root.and_then(|value| value.get(name));
    (
        item.and_then(|value| value.get("used"))
            .and_then(Value::as_u64),
        item.and_then(|value| value.get("available"))
            .and_then(Value::as_u64),
    )
}

fn file_size(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|metadata| metadata.len())
}

pub fn build_history(root: &str, project: &str) -> Result<Vec<BuildHistoryEntry>, String> {
    let root = canonical_workspace(root)?;
    let project = resolve_project_path(&root, project)?;
    read_history_file(&project)
}

pub fn record_history(
    root: &str,
    project: &str,
    action: BuildAction,
    success: bool,
    duration_ms: u128,
) -> Result<(), String> {
    let summary = build_summary(root, project)?;
    let root = canonical_workspace(root)?;
    let project = resolve_project_path(&root, project)?;
    let mut entries = read_history_file(&project)?;
    let build_number = entries.last().map_or(1, |entry| entry.build_number + 1);
    entries.push(BuildHistoryEntry {
        build_number,
        action,
        success,
        duration_ms,
        completed_at: Utc::now().to_rfc3339(),
        fmax_m_hz: summary.fmax_m_hz,
        lut_used: summary.lut_used,
        registers_used: summary.registers_used,
        bitstream_bytes: summary.bitstream_bytes,
    });
    if entries.len() > 200 {
        entries.drain(..entries.len() - 200);
    }
    let directory = project.join(".fpga-studio");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create build history directory: {error}"))?;
    let path = directory.join("build-history.json");
    let temporary = directory.join("build-history.json.tmp");
    let backup = directory.join("build-history.json.bak");
    let data = serde_json::to_vec_pretty(&BuildHistoryFile {
        schema_version: 1,
        entries,
    })
    .map_err(|error| format!("Cannot serialize build history: {error}"))?;
    fs::write(&temporary, data).map_err(|error| format!("Cannot write build history: {error}"))?;
    if path.is_file() {
        let _ = fs::remove_file(&backup);
        fs::rename(&path, &backup)
            .map_err(|error| format!("Cannot prepare build history update: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        if backup.is_file() {
            let _ = fs::rename(&backup, &path);
        }
        return Err(format!("Cannot publish build history: {error}"));
    }
    if backup.is_file() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

pub(crate) fn read_history_file(project: &Path) -> Result<Vec<BuildHistoryEntry>, String> {
    let path = project.join(".fpga-studio/build-history.json");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    if file_size(&path).unwrap_or(0) > MAX_HISTORY_BYTES {
        return Err("Build history exceeds the 4 MiB safety limit".into());
    }
    let history: BuildHistoryFile = serde_json::from_slice(
        &fs::read(&path).map_err(|error| format!("Cannot read build history: {error}"))?,
    )
    .map_err(|error| format!("Build history is invalid JSON: {error}"))?;
    if history.schema_version != 1 {
        return Err(format!(
            "Unsupported build history schema {}",
            history.schema_version
        ));
    }
    Ok(history.entries)
}

#[cfg(test)]
mod tests {
    use super::{parse_summary, read_history_file, utilization_pair};
    use serde_json::json;

    #[test]
    fn parses_all_clocks_resources_and_critical_paths() {
        let report = json!({
            "fmax": {
                "core.clk": {"achieved": 80.0, "constraint": 50.0},
                "io.clk": {"achieved": 20.0, "constraint": 25.0}
            },
            "utilization": {
                "LUT4": {"used": 12, "available": 100},
                "DFF": {"used": 8, "available": 80},
                "BSRAM": {"used": 1, "available": 4}
            },
            "critical_paths": [{
                "from": "posedge core.clk", "to": "posedge core.clk",
                "path": [{"delay": 2.5}, {"delay": 1.0}]
            }]
        });
        let summary = parse_summary(&report, Some(4096), Some("now".into())).expect("summary");
        assert_eq!(summary.clocks.len(), 2);
        assert_eq!(summary.resources.len(), 3);
        assert_eq!(summary.critical_paths[0].segments, 2);
        assert_eq!(summary.timing_met, Some(false));
        assert_eq!(summary.status, "failed");
        assert_eq!(summary.bitstream_bytes, Some(4096));
    }

    #[test]
    fn missing_optional_report_sections_are_honest() {
        let summary = parse_summary(&json!({}), None, None).expect("summary");
        assert!(summary.clocks.is_empty());
        assert!(summary.resources.is_empty());
        assert_eq!(summary.timing_met, None);
    }

    #[test]
    fn rejects_non_object_reports_and_bounds_large_path_sets() {
        assert!(parse_summary(&json!(["not", "a", "report"]), None, None).is_err());
        let paths = (0..30)
            .map(|index| {
                json!({
                    "from": "posedge clk",
                    "to": "posedge clk",
                    "path": [{"delay": index as f64 + 0.5}]
                })
            })
            .collect::<Vec<_>>();
        let summary = parse_summary(
            &json!({
                "fmax": {"clk": {"achieved": 50.0, "constraint": 25.0}},
                "critical_paths": paths
            }),
            None,
            None,
        )
        .expect("large report");
        assert_eq!(summary.critical_paths.len(), 8);
        assert!(summary.critical_paths[0].delay_ns > summary.critical_paths[7].delay_ns);
    }

    #[test]
    fn reads_utilization_pairs() {
        let report = json!({"LUT4": {"used": 12, "available": 100}});
        assert_eq!(
            utilization_pair(Some(&report), "LUT4"),
            (Some(12), Some(100))
        );
    }

    #[test]
    fn missing_history_is_empty() {
        let directory =
            std::env::temp_dir().join(format!("fpga-studio-history-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("temporary directory");
        assert!(read_history_file(&directory).expect("history").is_empty());
        std::fs::remove_dir_all(directory).expect("remove temporary directory");
    }
}
