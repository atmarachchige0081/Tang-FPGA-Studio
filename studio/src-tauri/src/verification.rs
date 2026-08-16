use crate::models::{
    AnalyzerCapture, BuildAction, BuildHistoryEntry, DiagnosticSeverity, EvidenceClass,
    HardwareVerificationRecord, VerificationStage, VerificationStageStatus, VerificationSummary,
};
use crate::reports;
use crate::security::{canonical_workspace, safe_existing_path};
use crate::{design_graph, hdl};
use chrono::{DateTime, Utc};
use std::fs;
use std::path::Path;
use std::time::SystemTime;

pub fn summary(root: &str, project: &str) -> Result<VerificationSummary, String> {
    let hdl = hdl::index(root, project)?;
    let workspace = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace, project)?;
    let history = reports::read_history_file(&project_path)?;
    let newest_source = newest_source_time(&project_path);
    let project_updated_at = newest_source.map(|time| DateTime::<Utc>::from(time).to_rfc3339());
    let report = reports::build_summary(root, project);

    let errors = hdl
        .diagnostics
        .iter()
        .filter(|item| matches!(item.severity, DiagnosticSeverity::Error))
        .count();
    let warnings = hdl.diagnostics.len().saturating_sub(errors);
    let analysis_status = if errors > 0 {
        VerificationStageStatus::Fail
    } else if warnings > 0 {
        VerificationStageStatus::Warning
    } else {
        VerificationStageStatus::Pass
    };
    let mut stages = vec![VerificationStage {
        id: "analysis".into(),
        label: "Design analysis".into(),
        status: analysis_status,
        detail: if errors > 0 {
            format!("{errors} blocking finding(s) and {warnings} warning(s) in the live HDL scan.")
        } else if warnings > 0 {
            format!("No blocking findings; review {warnings} conservative warning(s).")
        } else {
            format!(
                "{} HDL file(s), {} module(s), and {} clock domain(s) scanned cleanly.",
                hdl.files.len(),
                hdl.modules.len(),
                hdl.clock_domains.len()
            )
        },
        duration_ms: None,
        completed_at: Some(Utc::now().to_rfc3339()),
        artifacts: hdl.files.clone(),
    }];

    stages.push(history_stage(
        "lint",
        "Toolchain lint",
        latest(&history, &[BuildAction::Lint]),
        newest_source,
        Vec::new(),
        "Run Lint to check the complete source set with Verilator.",
    ));
    stages.push(history_stage(
        "simulation",
        "Simulation",
        latest(&history, &[BuildAction::Sim]),
        newest_source,
        existing_artifacts(&project_path, &["build/waves.vcd"]),
        "Run Simulate to execute the testbench and regenerate the waveform.",
    ));

    let implementation = latest(
        &history,
        &[BuildAction::Build, BuildAction::Upload, BuildAction::Flash],
    );
    stages.push(history_stage(
        "synthesis",
        "Synthesis & place/route",
        implementation,
        newest_source,
        existing_artifacts(&project_path, &["build/top.json", "build/top_pnr.json"]),
        "Run Build to synthesize and place the current RTL.",
    ));

    stages.push(match &report {
        Ok(report) if report.updated_at.is_some() => VerificationStage {
            id: "timing".into(),
            label: "Timing analysis".into(),
            status: if report.timing_met == Some(false) {
                VerificationStageStatus::Fail
            } else if report.timing_met.is_none()
                || artifact_is_stale(&project_path.join("build/timing.json"), newest_source)
            {
                VerificationStageStatus::Warning
            } else {
                VerificationStageStatus::Pass
            },
            detail: if report.timing_met == Some(false) {
                format!(
                    "Timing failed: worst slack is {} ns across {} constrained clock(s).",
                    report
                        .worst_slack_ns
                        .map(|value| format!("{value:.3}"))
                        .unwrap_or_else(|| "unknown".into()),
                    report.clocks.len()
                )
            } else if report.timing_met.is_none() {
                "The implementation report has no constrained clocks; timing cannot be certified."
                    .into()
            } else if artifact_is_stale(&project_path.join("build/timing.json"), newest_source) {
                "Timing passed previously, but the report predates a source change.".into()
            } else {
                format!(
                    "All {} constrained clock(s) pass; worst slack {} ns.",
                    report.clocks.len(),
                    report
                        .worst_slack_ns
                        .map(|value| format!("{value:.3}"))
                        .unwrap_or_else(|| "not reported".into())
                )
            },
            duration_ms: implementation.map(|entry| entry.duration_ms),
            completed_at: report.updated_at.clone(),
            artifacts: vec!["build/timing.json".into()],
        },
        Ok(_) => not_run(
            "timing",
            "Timing analysis",
            "No nextpnr timing report exists. Run Build first.",
        ),
        Err(error) => VerificationStage {
            id: "timing".into(),
            label: "Timing analysis".into(),
            status: VerificationStageStatus::Fail,
            detail: error.clone(),
            duration_ms: None,
            completed_at: None,
            artifacts: existing_artifacts(&project_path, &["build/timing.json"]),
        },
    });

    stages.push(match &report {
        Ok(report) if !report.resources.is_empty() => VerificationStage {
            id: "resources".into(),
            label: "Resource fit".into(),
            status: if report
                .resources
                .iter()
                .any(|resource| resource.used > resource.total)
            {
                VerificationStageStatus::Fail
            } else if artifact_is_stale(&project_path.join("build/timing.json"), newest_source) {
                VerificationStageStatus::Warning
            } else {
                VerificationStageStatus::Pass
            },
            detail: format!(
                "{} device resource classes reported; LUT4 {}/{} and DFF {}/{}.",
                report.resources.len(),
                report.lut_used.unwrap_or(0),
                report.lut_total.unwrap_or(0),
                report.registers_used.unwrap_or(0),
                report.registers_total.unwrap_or(0)
            ),
            duration_ms: None,
            completed_at: report.updated_at.clone(),
            artifacts: vec!["build/timing.json".into()],
        },
        Ok(_) => not_run(
            "resources",
            "Resource fit",
            "No implementation utilization data is available.",
        ),
        Err(error) => VerificationStage {
            id: "resources".into(),
            label: "Resource fit".into(),
            status: VerificationStageStatus::Fail,
            detail: error.clone(),
            duration_ms: None,
            completed_at: None,
            artifacts: Vec::new(),
        },
    });

    let bitstream = project_path.join("build/top.fs");
    let bitstream_entry = implementation.filter(|entry| entry.success);
    stages.push(if bitstream.is_file() {
        let stale = artifact_is_stale(&bitstream, newest_source);
        VerificationStage {
            id: "bitstream".into(),
            label: "Bitstream".into(),
            status: if bitstream_entry.is_none() || stale {
                VerificationStageStatus::Warning
            } else {
                VerificationStageStatus::Pass
            },
            detail: if stale {
                "A bitstream exists, but it predates a source change. Rebuild before programming."
                    .into()
            } else if bitstream_entry.is_none() {
                "A bitstream exists without a successful recorded implementation run.".into()
            } else {
                format!(
                    "Programming file is current and {} bytes.",
                    fs::metadata(&bitstream)
                        .map(|value| value.len())
                        .unwrap_or(0)
                )
            },
            duration_ms: bitstream_entry.map(|entry| entry.duration_ms),
            completed_at: modified_at(&bitstream),
            artifacts: vec!["build/top.fs".into()],
        }
    } else {
        not_run(
            "bitstream",
            "Bitstream",
            "No programming file exists. Complete a successful Build.",
        )
    });

    stages.push(history_stage(
        "jtag",
        "JTAG link",
        latest(&history, &[BuildAction::Detect]),
        None,
        Vec::new(),
        "Run Detect with the board connected to verify the JTAG chain.",
    ));
    stages.push(history_stage(
        "programming",
        "Board programming",
        latest(&history, &[BuildAction::Upload, BuildAction::Flash]),
        newest_source,
        existing_artifacts(&project_path, &["build/top.fs"]),
        "Use SRAM for a reversible hardware test, or Flash after confirming the design.",
    ));
    stages.push(analyzer_capture_stage(&project_path));
    stages.push(hardware_stage(&project_path, newest_source));

    let passed = count(&stages, VerificationStageStatus::Pass);
    let warnings = count(&stages, VerificationStageStatus::Warning);
    let failed = count(&stages, VerificationStageStatus::Fail);
    let not_run = count(&stages, VerificationStageStatus::NotRun);
    let next_action = next_action(&stages);
    Ok(VerificationSummary {
        generated_at: Utc::now().to_rfc3339(),
        project_updated_at,
        stages,
        passed,
        warnings,
        failed,
        not_run,
        next_action,
    })
}

fn analyzer_capture_stage(project: &Path) -> VerificationStage {
    let relative = ".fpga-studio/analyzer-capture.json";
    let path = project.join(relative);
    if !path.is_file() {
        return not_run(
            "hardwareCapture",
            "Logic Analyzer capture",
            "No measured on-chip capture exists. Build and SRAM-upload an analyzer image, then arm a hardware trigger.",
        );
    }
    let capture = fs::read(&path)
        .map_err(|error| error.to_string())
        .and_then(|bytes| {
            serde_json::from_slice::<AnalyzerCapture>(&bytes).map_err(|error| error.to_string())
        });
    let Ok(capture) = capture else {
        return VerificationStage {
            id: "hardwareCapture".into(),
            label: "Logic Analyzer capture".into(),
            status: VerificationStageStatus::Warning,
            detail: "Analyzer capture metadata is unreadable; capture the hardware event again."
                .into(),
            duration_ms: None,
            completed_at: modified_at(&path),
            artifacts: vec![relative.into()],
        };
    };
    let current_hash = design_graph::rtl_hash(project).ok();
    let stale = current_hash.as_deref() != Some(capture.rtl_hash.as_str());
    let measured = capture.source.class == EvidenceClass::Measured;
    VerificationStage {
        id: "hardwareCapture".into(),
        label: "Logic Analyzer capture".into(),
        status: if stale || !measured {
            VerificationStageStatus::Warning
        } else {
            VerificationStageStatus::Pass
        },
        detail: if stale {
            "The previous physical capture is stale because the RTL changed afterward.".into()
        } else if !measured {
            "Capture metadata exists, but it is not labelled as measured hardware evidence.".into()
        } else {
            format!(
                "Measured {} channel(s) around trigger sample {}.",
                capture.waveform.signals.len(),
                capture.trigger_index
            )
        },
        duration_ms: None,
        completed_at: Some(capture.captured_at),
        artifacts: vec![relative.into()],
    }
}

pub fn record_hardware(
    root: &str,
    project: &str,
    passed: bool,
    note: &str,
) -> Result<VerificationSummary, String> {
    let note = note.trim();
    if note.len() < 4 {
        return Err(
            "Describe the behavior you observed before recording hardware evidence.".into(),
        );
    }
    if note.len() > 500 {
        return Err("Hardware evidence notes are limited to 500 characters.".into());
    }
    let workspace = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace, project)?;
    let directory = project_path.join(".fpga-studio");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create verification directory: {error}"))?;
    let bitstream_updated_at = modified_at(&project_path.join("build/top.fs"));
    let record = HardwareVerificationRecord {
        schema_version: 1,
        passed,
        note: note.into(),
        recorded_at: Utc::now().to_rfc3339(),
        bitstream_updated_at,
    };
    let path = directory.join("hardware-verification.json");
    let temporary = directory.join("hardware-verification.json.tmp");
    let backup = directory.join("hardware-verification.json.bak");
    let data = serde_json::to_vec_pretty(&record)
        .map_err(|error| format!("Cannot serialize hardware evidence: {error}"))?;
    fs::write(&temporary, data)
        .map_err(|error| format!("Cannot write hardware evidence: {error}"))?;
    if path.is_file() {
        let _ = fs::remove_file(&backup);
        fs::rename(&path, &backup)
            .map_err(|error| format!("Cannot prepare hardware evidence update: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        if backup.is_file() {
            let _ = fs::rename(&backup, &path);
        }
        return Err(format!("Cannot publish hardware evidence: {error}"));
    }
    if backup.is_file() {
        let _ = fs::remove_file(backup);
    }
    summary(root, project)
}

fn hardware_stage(project: &Path, newest_source: Option<SystemTime>) -> VerificationStage {
    let path = project.join(".fpga-studio/hardware-verification.json");
    if !path.is_file() {
        return not_run(
            "hardware",
            "Hardware behavior",
            "Not automatically inferred: confirm LEDs, UART, or other board behavior after programming.",
        );
    }
    let record: Result<HardwareVerificationRecord, String> = fs::read(&path)
        .map_err(|error| format!("Cannot read hardware evidence: {error}"))
        .and_then(|data| {
            serde_json::from_slice(&data)
                .map_err(|error| format!("Hardware evidence is invalid JSON: {error}"))
        });
    let Ok(record) = record else {
        return VerificationStage {
            id: "hardware".into(),
            label: "Hardware behavior".into(),
            status: VerificationStageStatus::Warning,
            detail: record.expect_err("error branch"),
            duration_ms: None,
            completed_at: None,
            artifacts: vec![".fpga-studio/hardware-verification.json".into()],
        };
    };
    if record.schema_version != 1 {
        return VerificationStage {
            id: "hardware".into(),
            label: "Hardware behavior".into(),
            status: VerificationStageStatus::Warning,
            detail: format!(
                "Unsupported hardware evidence schema {}.",
                record.schema_version
            ),
            duration_ms: None,
            completed_at: Some(record.recorded_at),
            artifacts: vec![".fpga-studio/hardware-verification.json".into()],
        };
    }
    let recorded = DateTime::parse_from_rfc3339(&record.recorded_at)
        .map(|value| value.with_timezone(&Utc))
        .ok();
    let stale = newest_source.is_some_and(|source| {
        recorded.is_none_or(|recorded| recorded < DateTime::<Utc>::from(source))
    }) || modified_at(&project.join("build/top.fs")) != record.bitstream_updated_at;
    VerificationStage {
        id: "hardware".into(),
        label: "Hardware behavior".into(),
        status: if stale {
            VerificationStageStatus::Warning
        } else if record.passed {
            VerificationStageStatus::Pass
        } else {
            VerificationStageStatus::Fail
        },
        detail: if stale {
            format!(
                "Recorded observation is stale after a source or bitstream change: {}",
                record.note
            )
        } else if record.passed {
            format!("User-confirmed board behavior: {}", record.note)
        } else {
            format!("User-recorded hardware issue: {}", record.note)
        },
        duration_ms: None,
        completed_at: Some(record.recorded_at),
        artifacts: vec![".fpga-studio/hardware-verification.json".into()],
    }
}

fn latest<'a>(
    history: &'a [BuildHistoryEntry],
    actions: &[BuildAction],
) -> Option<&'a BuildHistoryEntry> {
    history.iter().rev().find(|entry| {
        actions
            .iter()
            .any(|action| action.as_str() == entry.action.as_str())
    })
}

fn history_stage(
    id: &str,
    label: &str,
    entry: Option<&BuildHistoryEntry>,
    newest_source: Option<SystemTime>,
    artifacts: Vec<String>,
    missing_detail: &str,
) -> VerificationStage {
    let Some(entry) = entry else {
        return not_run(id, label, missing_detail);
    };
    let stale = newest_source.is_some_and(|source| {
        DateTime::parse_from_rfc3339(&entry.completed_at)
            .map(|completed| completed.with_timezone(&Utc) < DateTime::<Utc>::from(source))
            .unwrap_or(false)
    });
    VerificationStage {
        id: id.into(),
        label: label.into(),
        status: if !entry.success {
            VerificationStageStatus::Fail
        } else if stale {
            VerificationStageStatus::Warning
        } else {
            VerificationStageStatus::Pass
        },
        detail: if !entry.success {
            format!(
                "The latest {} run failed. Open Problems and Output for the actionable error.",
                entry.action.as_str()
            )
        } else if stale {
            format!(
                "The latest {} run passed, but project sources changed afterward.",
                entry.action.as_str()
            )
        } else {
            format!(
                "The latest {} run completed successfully in {} ms.",
                entry.action.as_str(),
                entry.duration_ms
            )
        },
        duration_ms: Some(entry.duration_ms),
        completed_at: Some(entry.completed_at.clone()),
        artifacts,
    }
}

fn not_run(id: &str, label: &str, detail: &str) -> VerificationStage {
    VerificationStage {
        id: id.into(),
        label: label.into(),
        status: VerificationStageStatus::NotRun,
        detail: detail.into(),
        duration_ms: None,
        completed_at: None,
        artifacts: Vec::new(),
    }
}

fn count(stages: &[VerificationStage], status: VerificationStageStatus) -> usize {
    stages.iter().filter(|stage| stage.status == status).count()
}

fn next_action(stages: &[VerificationStage]) -> String {
    let stage = stages
        .iter()
        .find(|stage| stage.status == VerificationStageStatus::Fail)
        .or_else(|| {
            stages
                .iter()
                .find(|stage| stage.status == VerificationStageStatus::Warning)
        })
        .or_else(|| {
            stages
                .iter()
                .find(|stage| stage.status == VerificationStageStatus::NotRun)
        });
    match stage.map(|stage| stage.id.as_str()) {
        Some("analysis") => "Resolve the blocking HDL findings, then run Lint.".into(),
        Some("lint") => "Run Lint on the current sources.".into(),
        Some("simulation") => "Run Simulate and inspect the waveform.".into(),
        Some("synthesis" | "timing" | "resources" | "bitstream") => {
            "Run Build and review timing, resources, and critical paths.".into()
        }
        Some("jtag") => "Connect the board and run Detect JTAG.".into(),
        Some("programming") => "Use SRAM to test the current bitstream safely.".into(),
        Some("hardware") => "Observe and validate the intended behavior on the board.".into(),
        _ => "All recorded verification stages are current.".into(),
    }
}

fn existing_artifacts(project: &Path, relative_paths: &[&str]) -> Vec<String> {
    relative_paths
        .iter()
        .filter(|path| project.join(path).is_file())
        .map(|path| (*path).into())
        .collect()
}

fn artifact_is_stale(path: &Path, newest_source: Option<SystemTime>) -> bool {
    newest_source.is_some_and(|source| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .map_or(true, |artifact| artifact < source)
    })
}

fn modified_at(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(|time| DateTime::<Utc>::from(time).to_rfc3339())
}

fn newest_source_time(project: &Path) -> Option<SystemTime> {
    let mut newest = None;
    for relative in ["rtl", "sim", "constraints"] {
        collect_newest(&project.join(relative), &mut newest);
    }
    for relative in ["fpga.config.psd1", "project.fpga.json"] {
        if let Ok(modified) =
            fs::metadata(project.join(relative)).and_then(|value| value.modified())
        {
            newest = Some(newest.map_or(modified, |current: SystemTime| current.max(modified)));
        }
    }
    newest
}

fn collect_newest(path: &Path, newest: &mut Option<SystemTime>) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.is_file() {
        if let Ok(modified) = metadata.modified() {
            *newest = Some(newest.map_or(modified, |current| current.max(modified)));
        }
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_type().is_ok_and(|kind| !kind.is_symlink()) {
            collect_newest(&entry.path(), newest);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{analyzer_capture_stage, history_stage, latest, next_action, record_hardware};
    use crate::models::{
        BuildAction, BuildHistoryEntry, VerificationStage, VerificationStageStatus,
    };

    fn entry(action: BuildAction, success: bool) -> BuildHistoryEntry {
        BuildHistoryEntry {
            build_number: 1,
            action,
            success,
            duration_ms: 42,
            completed_at: chrono::Utc::now().to_rfc3339(),
            fmax_m_hz: None,
            lut_used: None,
            registers_used: None,
            bitstream_bytes: None,
        }
    }

    #[test]
    fn latest_action_selection_is_specific() {
        let history = vec![
            entry(BuildAction::Lint, true),
            entry(BuildAction::Build, true),
        ];
        assert_eq!(
            latest(&history, &[BuildAction::Lint])
                .unwrap()
                .action
                .as_str(),
            "lint"
        );
    }

    #[test]
    fn failed_history_is_never_presented_as_passed() {
        let item = entry(BuildAction::Sim, false);
        let stage = history_stage(
            "simulation",
            "Simulation",
            Some(&item),
            None,
            Vec::new(),
            "missing",
        );
        assert_eq!(stage.status, VerificationStageStatus::Fail);
    }

    #[test]
    fn next_action_prioritizes_failures() {
        let stage = |id: &str, status| VerificationStage {
            id: id.into(),
            label: id.into(),
            status,
            detail: String::new(),
            duration_ms: None,
            completed_at: None,
            artifacts: Vec::new(),
        };
        let stages = vec![
            stage("lint", VerificationStageStatus::NotRun),
            stage("analysis", VerificationStageStatus::Fail),
        ];
        assert!(next_action(&stages).contains("HDL"));
    }

    #[test]
    fn hardware_evidence_requires_a_note_and_is_persisted() {
        let root = std::env::temp_dir().join(format!(
            "fpga-studio-hardware-evidence-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(root.join("rtl")).expect("rtl");
        std::fs::write(root.join("fpga.ps1"), "# workspace marker").expect("marker");
        std::fs::write(root.join("fpga.config.psd1"), "@{ Top = 'top' }").expect("config");
        std::fs::write(root.join("rtl/top.sv"), "module top; endmodule\n").expect("source");
        assert!(record_hardware(&root.to_string_lossy(), ".", true, "").is_err());
        let result = record_hardware(&root.to_string_lossy(), ".", true, "LED blink observed")
            .expect("record evidence");
        assert!(result.stages.iter().any(|stage| {
            stage.id == "hardware" && stage.status == VerificationStageStatus::Pass
        }));
        assert!(root
            .join(".fpga-studio/hardware-verification.json")
            .is_file());
        let updated = record_hardware(
            &root.to_string_lossy(),
            ".",
            false,
            "UART reply was incorrect",
        )
        .expect("update evidence");
        assert!(updated.stages.iter().any(|stage| {
            stage.id == "hardware" && stage.status == VerificationStageStatus::Fail
        }));
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn analyzer_capture_becomes_stale_after_rtl_changes() {
        let root = std::env::temp_dir().join(format!(
            "fpga-studio-analyzer-evidence-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(root.join("rtl")).expect("rtl");
        std::fs::create_dir_all(root.join(".fpga-studio")).expect("state");
        std::fs::write(root.join("rtl/top.sv"), "module top; endmodule\n").expect("source");
        let hash = crate::design_graph::rtl_hash(&root).expect("hash");
        let payload = serde_json::json!({
            "schemaVersion": 1,
            "capturedAt": chrono::Utc::now().to_rfc3339(),
            "rtlHash": hash,
            "triggerIndex": 1,
            "waveform": { "path": "capture", "timescale": "1 sample", "endTime": 2, "truncated": false, "signals": [] },
            "source": { "class": "measured", "source": "UART analyzer capture", "detail": "fixture" }
        });
        std::fs::write(
            root.join(".fpga-studio/analyzer-capture.json"),
            serde_json::to_vec(&payload).expect("json"),
        )
        .expect("capture");
        assert_eq!(
            analyzer_capture_stage(&root).status,
            VerificationStageStatus::Pass
        );
        std::fs::write(
            root.join("rtl/top.sv"),
            "module top; wire changed; endmodule\n",
        )
        .expect("changed source");
        assert_eq!(
            analyzer_capture_stage(&root).status,
            VerificationStageStatus::Warning
        );
        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
