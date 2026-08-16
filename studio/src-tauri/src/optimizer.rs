use crate::design_graph;
use crate::hdl;
use crate::models::{
    DesignEvidence, DesignHealthDimension, DesignSnapshot, EvidenceClass, OptimizationExperiment,
    OptimizationRecommendation, OptimizationSummary, PerformanceRegression, ResourceUsage,
    SnapshotComparison, SnapshotMetricDelta, VerificationStageStatus,
};
use crate::security::{canonical_workspace, safe_existing_path};
use crate::verification;
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::Command;

const MAX_SNAPSHOTS: usize = 100;
const MAX_EXPERIMENTS: usize = 50;
type ReportMetrics = (Option<f64>, Option<f64>, Vec<ResourceUsage>);

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotFile {
    schema_version: u32,
    snapshots: Vec<DesignSnapshot>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExperimentFile {
    schema_version: u32,
    experiments: Vec<OptimizationExperiment>,
}

pub fn summary(root: &str, project: &str) -> Result<OptimizationSummary, String> {
    let workspace = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace, project)?;
    let graph = design_graph::read(root, project)?;
    let verification = verification::summary(root, project)?;
    let hdl = hdl::index(root, project)?;
    let snapshots = read_snapshots(&project_path)?.snapshots;
    let experiments = read_experiments(&project_path)?.experiments;

    let measured = |source: &str, detail: String| DesignEvidence {
        class: EvidenceClass::Measured,
        source: source.into(),
        detail,
        build_number: None,
    };
    let unavailable = |source: &str, detail: String| DesignEvidence {
        class: EvidenceClass::Unavailable,
        source: source.into(),
        detail,
        build_number: None,
    };

    let timing_path = graph.timing_paths.first();
    let timing_health = if let Some(path) = timing_path {
        let slack = path.slack_ns;
        DesignHealthDimension {
            id: "timing".into(),
            label: "Timing".into(),
            status: if slack.is_some_and(|value| value < 0.0) {
                "critical"
            } else {
                "healthy"
            }
            .into(),
            detail: slack.map_or_else(
                || format!("Measured critical delay: {:.3} ns.", path.delay_ns),
                |value| format!("Measured worst-path slack: {value:.3} ns."),
            ),
            evidence: vec![path.evidence.clone()],
        }
    } else {
        DesignHealthDimension {
            id: "timing".into(),
            label: "Timing".into(),
            status: "unavailable".into(),
            detail: "Run Build to measure timing paths.".into(),
            evidence: vec![unavailable(
                "build/timing.json",
                "No detailed timing path is available.".into(),
            )],
        }
    };

    let max_resource = graph
        .resources
        .iter()
        .filter(|resource| resource.total > 0)
        .max_by(|left, right| {
            let left = left.used as f64 / left.total as f64;
            let right = right.used as f64 / right.total as f64;
            left.total_cmp(&right)
        });
    let area_health = max_resource.map_or_else(
        || DesignHealthDimension {
            id: "area".into(),
            label: "Area".into(),
            status: "unavailable".into(),
            detail: "Run Build to measure device utilization.".into(),
            evidence: vec![unavailable(
                "build/timing.json",
                "No utilization table is available.".into(),
            )],
        },
        |resource| {
            let percent = resource.used as f64 / resource.total as f64 * 100.0;
            DesignHealthDimension {
                id: "area".into(),
                label: "Area".into(),
                status: if percent >= 90.0 {
                    "critical"
                } else if percent >= 70.0 {
                    "attention"
                } else {
                    "healthy"
                }
                .into(),
                detail: format!(
                    "Highest utilization is {} at {}/{} ({percent:.1}%).",
                    resource.label, resource.used, resource.total
                ),
                evidence: vec![measured(
                    "build/timing.json",
                    format!("{} utilization from nextpnr.", resource.name),
                )],
            }
        },
    );

    let logic_depth = timing_path.map_or_else(
        || DesignHealthDimension {
            id: "logic-depth".into(),
            label: "Logic depth".into(),
            status: "unavailable".into(),
            detail: "Run Build to measure a routed register-to-register path.".into(),
            evidence: vec![unavailable(
                "build/timing.json",
                "No detailed timing path is available.".into(),
            )],
        },
        |path| DesignHealthDimension {
            id: "logic-depth".into(),
            label: "Logic depth".into(),
            status: if path.logic_levels >= 20 {
                "critical"
            } else if path.logic_levels >= 8 {
                "attention"
            } else {
                "healthy"
            }
            .into(),
            detail: format!(
                "The measured critical path crosses {} logic level(s).",
                path.logic_levels
            ),
            evidence: vec![path.evidence.clone()],
        },
    );

    let mut fanout_counts = BTreeMap::<String, usize>::new();
    for edge in &graph.edges {
        *fanout_counts.entry(edge.source.clone()).or_default() += 1;
    }
    let max_fanout = fanout_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(node_id, count)| {
            let label = graph
                .nodes
                .iter()
                .find(|node| node.id == node_id)
                .map_or(node_id, |node| node.label.clone());
            (label, count)
        });
    let fanout_health = max_fanout.as_ref().map_or_else(
        || DesignHealthDimension {
            id: "fanout".into(),
            label: "Fanout".into(),
            status: "unavailable".into(),
            detail: "No mapped net fanout is available.".into(),
            evidence: vec![unavailable(
                "Design intelligence graph",
                "Synthesis connectivity is unavailable.".into(),
            )],
        },
        |(label, count)| DesignHealthDimension {
            id: "fanout".into(),
            label: "Fanout".into(),
            status: if *count >= 64 {
                "critical"
            } else if *count >= 24 {
                "attention"
            } else {
                "healthy"
            }
            .into(),
            detail: format!("Highest mapped fanout is {count} from {label}."),
            evidence: vec![DesignEvidence {
                class: EvidenceClass::Inferred,
                source: "Synthesized design graph".into(),
                detail: "Fanout is counted from available mapped graph edges; bounded graphs may under-count.".into(),
                build_number: None,
            }],
        },
    );

    let memory_resources = graph
        .resources
        .iter()
        .filter(|resource| {
            let name = resource.name.to_ascii_uppercase();
            name.contains("RAM") || name.contains("BSRAM")
        })
        .collect::<Vec<_>>();
    let memory_used = memory_resources
        .iter()
        .map(|resource| resource.used)
        .sum::<u64>();
    let memory_total = memory_resources
        .iter()
        .map(|resource| resource.total)
        .sum::<u64>();
    let memory_health = if memory_resources.is_empty() {
        DesignHealthDimension {
            id: "memory".into(),
            label: "Memory".into(),
            status: "unavailable".into(),
            detail: "No implementation memory classes are reported.".into(),
            evidence: vec![unavailable(
                "build/timing.json",
                "Memory utilization is unavailable.".into(),
            )],
        }
    } else {
        let percent = if memory_total > 0 {
            memory_used as f64 / memory_total as f64 * 100.0
        } else {
            0.0
        };
        DesignHealthDimension {
            id: "memory".into(),
            label: "Memory".into(),
            status: if percent >= 90.0 {
                "critical"
            } else if percent >= 70.0 {
                "attention"
            } else {
                "healthy"
            }
            .into(),
            detail: format!("Measured memory use is {memory_used}/{memory_total} ({percent:.1}%)."),
            evidence: vec![measured(
                "build/timing.json",
                "Memory resource classes reported by nextpnr.".into(),
            )],
        }
    };

    let io_resource = graph
        .resources
        .iter()
        .find(|resource| resource.name.eq_ignore_ascii_case("IOB"));
    let io_health = io_resource.map_or_else(
        || DesignHealthDimension {
            id: "io".into(),
            label: "I/O".into(),
            status: "unavailable".into(),
            detail: "No implemented I/O resource class is reported.".into(),
            evidence: vec![unavailable(
                "build/timing.json",
                "I/O utilization is unavailable.".into(),
            )],
        },
        |resource| {
            let percent = if resource.total > 0 {
                resource.used as f64 / resource.total as f64 * 100.0
            } else {
                0.0
            };
            DesignHealthDimension {
                id: "io".into(),
                label: "I/O".into(),
                status: if percent >= 90.0 {
                    "critical"
                } else if percent >= 70.0 {
                    "attention"
                } else {
                    "healthy"
                }
                .into(),
                detail: format!(
                    "Measured I/O use is {}/{} ({percent:.1}%).",
                    resource.used, resource.total
                ),
                evidence: vec![measured(
                    "build/timing.json",
                    "IOB utilization reported by nextpnr.".into(),
                )],
            }
        },
    );

    let resetless = hdl
        .clock_domains
        .iter()
        .filter(|domain| domain.reset.is_none())
        .count();
    let cdc_health = DesignHealthDimension {
        id: "clocking-reset".into(),
        label: "Clocking & reset".into(),
        status: if hdl.clock_domains.is_empty() {
            "unavailable"
        } else if resetless > 0 {
            "attention"
        } else {
            "healthy"
        }
        .into(),
        detail: format!(
            "{} inferred clock domain(s); {resetless} sequential domain(s) have no recognized reset.",
            hdl.clock_domains.len()
        ),
        evidence: vec![DesignEvidence {
            class: EvidenceClass::Inferred,
            source: "RTL structural scan".into(),
            detail: "Clock/reset structure is inferred conservatively from sequential blocks.".into(),
            build_number: None,
        }],
    };

    let analyzer_saved = project_path.join(".fpga-studio/analyzer.json").is_file();
    let analyzer_captured = project_path
        .join(".fpga-studio/analyzer-capture.json")
        .is_file();
    let observability = DesignHealthDimension {
        id: "observability".into(),
        label: "Observability".into(),
        status: if analyzer_captured {
            "healthy"
        } else if analyzer_saved {
            "attention"
        } else {
            "unavailable"
        }
        .into(),
        detail: if analyzer_captured {
            "A measured on-chip analyzer capture is available.".into()
        } else if analyzer_saved {
            "Analyzer probes are configured; build, upload to SRAM, and capture.".into()
        } else {
            "No on-chip analyzer configuration is saved.".into()
        },
        evidence: vec![if analyzer_captured {
            measured(
                ".fpga-studio/analyzer-capture.json",
                "Capture received from instrumented FPGA hardware.".into(),
            )
        } else {
            unavailable(
                ".fpga-studio/analyzer-capture.json",
                "No hardware capture has been recorded.".into(),
            )
        }],
    };

    let hardware_stage = verification
        .stages
        .iter()
        .find(|stage| stage.id == "hardware");
    let hardware = DesignHealthDimension {
        id: "hardware".into(),
        label: "Hardware verification".into(),
        status: match hardware_stage.map(|stage| stage.status) {
            Some(VerificationStageStatus::Pass) => "healthy",
            Some(VerificationStageStatus::Fail) => "critical",
            Some(VerificationStageStatus::Warning) => "attention",
            _ => "unavailable",
        }
        .into(),
        detail: hardware_stage
            .map(|stage| stage.detail.clone())
            .unwrap_or_else(|| "No observed board behavior is recorded.".into()),
        evidence: vec![match hardware_stage.map(|stage| stage.status) {
            Some(VerificationStageStatus::Pass | VerificationStageStatus::Fail) => measured(
                ".fpga-studio/hardware-verification.json",
                "User-recorded physical board observation.".into(),
            ),
            _ => unavailable(
                ".fpga-studio/hardware-verification.json",
                "Hardware behavior has not been observed and recorded.".into(),
            ),
        }],
    };

    let correctness = DesignHealthDimension {
        id: "correctness".into(),
        label: "Verification".into(),
        status: if verification.failed > 0 {
            "critical"
        } else if verification.not_run > 0 || verification.warnings > 0 {
            "attention"
        } else {
            "healthy"
        }
        .into(),
        detail: format!(
            "Verification: {} passed, {} warning, {} failed, {} not run.",
            verification.passed, verification.warnings, verification.failed, verification.not_run
        ),
        evidence: vec![DesignEvidence {
            class: EvidenceClass::Measured,
            source: "Verification pipeline".into(),
            detail: verification.next_action.clone(),
            build_number: None,
        }],
    };

    let mut recommendations = Vec::new();
    if let Some(path) = timing_path {
        let logic_delay = path
            .segments
            .iter()
            .filter(|segment| segment.kind == "logic")
            .map(|segment| segment.delay_ns)
            .sum::<f64>();
        let routing_delay = path
            .segments
            .iter()
            .filter(|segment| segment.kind == "routing")
            .map(|segment| segment.delay_ns)
            .sum::<f64>();
        recommendations.push(OptimizationRecommendation {
            id: "retime-critical-path".into(),
            category: "timing".into(),
            title: "Measure a retiming experiment".into(),
            summary: format!(
                "The measured critical path has {} logic levels and {:.3} ns of logic delay.",
                path.logic_levels, logic_delay
            ),
            applicable: path.logic_levels >= 4,
            expected_impact:
                "Potential Fmax improvement; actual effect is only reported after a separate build."
                    .into(),
            experiment_kind: "retime".into(),
            evidence: vec![path.evidence.clone()],
        });
        recommendations.push(OptimizationRecommendation {
            id: "pipeline-boundary-review".into(),
            category: "timing".into(),
            title: "Inspect a pipeline boundary".into(),
            summary: format!(
                "The measured critical path crosses {} logic levels from {} to {}.",
                path.logic_levels, path.start, path.end
            ),
            applicable: path.logic_levels >= 8,
            expected_impact: "A well-placed register may reduce logic depth, but no improvement is claimed until a user-approved RTL variant is built and measured.".into(),
            experiment_kind: "none".into(),
            evidence: vec![path.evidence.clone()],
        });
        recommendations.push(OptimizationRecommendation {
            id: "placement-seed".into(),
            category: "routing".into(),
            title: "Try an alternate placement seed".into(),
            summary: format!(
                "Critical-path routing delay is {routing_delay:.3} ns versus {logic_delay:.3} ns of logic."
            ),
            applicable: routing_delay > logic_delay,
            expected_impact: "May find a better placement without changing RTL; measured by a complete implementation run.".into(),
            experiment_kind: "placement-seed".into(),
            evidence: vec![path.evidence.clone()],
        });
    }
    if let Some((label, count)) = &max_fanout {
        recommendations.push(OptimizationRecommendation {
            id: "high-fanout-review".into(),
            category: "routing".into(),
            title: "Review a high-fanout control net".into(),
            summary: format!("{label} drives {count} mapped destinations in the synthesized graph."),
            applicable: *count >= 24,
            expected_impact: "Register replication can reduce routing pressure when functionally safe; this is guidance only and Studio does not rewrite the RTL.".into(),
            experiment_kind: "none".into(),
            evidence: vec![DesignEvidence {
                class: EvidenceClass::Inferred,
                source: "Synthesized design graph".into(),
                detail: format!("Observed {count} outgoing mapped edge(s) from {label}."),
                build_number: None,
            }],
        });
    }
    if let Some(resource) = max_resource {
        let percent = resource.used as f64 / resource.total as f64 * 100.0;
        recommendations.push(OptimizationRecommendation {
            id: "area-review".into(),
            category: "area".into(),
            title: "Review the dominant resource".into(),
            summary: format!(
                "{} uses {percent:.1}% of the target device.",
                resource.label
            ),
            applicable: percent >= 70.0,
            expected_impact: "Guidance only; no RTL is changed automatically.".into(),
            experiment_kind: "none".into(),
            evidence: vec![measured(
                "build/timing.json",
                format!(
                    "{}/{} {} used.",
                    resource.used, resource.total, resource.name
                ),
            )],
        });
    }

    let regressions = consecutive_regressions(&snapshots);
    Ok(OptimizationSummary {
        generated_at: Utc::now().to_rfc3339(),
        health: vec![
            correctness,
            timing_health,
            logic_depth,
            fanout_health,
            area_health,
            memory_health,
            io_health,
            cdc_health,
            observability,
            hardware,
        ],
        recommendations,
        experiments,
        snapshots,
        regressions,
    })
}

pub fn record_snapshot(
    root: &str,
    project: &str,
    kind: &str,
    experiment_id: Option<String>,
) -> Result<DesignSnapshot, String> {
    if !matches!(kind, "baseline" | "analyzer" | "experiment") {
        return Err("Snapshot kind must be baseline, analyzer, or experiment".into());
    }
    let workspace = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace, project)?;
    let report_path = match kind {
        "analyzer" => project_path.join("build/analyzer/timing.json"),
        "experiment" => project_path.join("build/experiment/timing.json"),
        _ => project_path.join("build/timing.json"),
    };
    let (fmax, slack, resources) = report_metrics(&report_path)?;
    let graph = design_graph::read(root, project)?;
    let verification = verification::summary(root, project)?;
    let mut file = read_snapshots(&project_path)?;
    let next_id = file
        .snapshots
        .iter()
        .map(|snapshot| snapshot.id)
        .max()
        .unwrap_or(0)
        + 1;
    let snapshot = DesignSnapshot {
        id: next_id,
        created_at: Utc::now().to_rfc3339(),
        git_commit: git_commit(&workspace),
        rtl_hash: design_graph::rtl_hash(&project_path)?,
        board: config_value(&project_path, "Device").unwrap_or_else(|| "unknown".into()),
        toolchain_version: config_value(&project_path, "ToolchainVersion")
            .unwrap_or_else(|| "unknown".into()),
        kind: kind.into(),
        experiment_id,
        fmax_m_hz: fmax,
        worst_slack_ns: slack,
        resources,
        critical_path: (kind == "baseline")
            .then(|| graph.timing_paths.first().cloned())
            .flatten(),
        analyzer_config_hash: analyzer_config_hash(&project_path),
        verification_status: if verification.failed > 0 {
            "failed"
        } else if verification.not_run > 0 || verification.warnings > 0 {
            "partial"
        } else {
            "passed"
        }
        .into(),
    };
    if file.snapshots.len() >= MAX_SNAPSHOTS {
        let remove = file.snapshots.len() + 1 - MAX_SNAPSHOTS;
        file.snapshots.drain(..remove);
    }
    file.schema_version = 1;
    file.snapshots.push(snapshot.clone());
    persist(&project_path, "snapshots.json", &file)?;
    Ok(snapshot)
}

pub fn compare(
    root: &str,
    project: &str,
    baseline_id: u64,
    candidate_id: u64,
) -> Result<SnapshotComparison, String> {
    let workspace = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace, project)?;
    let snapshots = read_snapshots(&project_path)?.snapshots;
    let baseline = snapshots
        .iter()
        .find(|snapshot| snapshot.id == baseline_id)
        .ok_or("Baseline snapshot does not exist")?;
    let candidate = snapshots
        .iter()
        .find(|snapshot| snapshot.id == candidate_id)
        .ok_or("Candidate snapshot does not exist")?;
    Ok(compare_snapshots(baseline, candidate))
}

pub fn prepare_experiment(
    root: &str,
    project: &str,
    recommendation_id: &str,
) -> Result<OptimizationExperiment, String> {
    let workspace = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace, project)?;
    let (kind, title, synth_option, options) = match recommendation_id {
        "retime-critical-path" => (
            "retime",
            "Retiming critical-path experiment",
            " -retime",
            vec!["synth_gowin -retime".into()],
        ),
        "placement-seed" => (
            "placement-seed",
            "Alternate placement seed experiment",
            "",
            vec!["--seed=31".into()],
        ),
        _ => return Err("This recommendation has no runnable experiment".into()),
    };
    let top = config_value(&project_path, "Top").unwrap_or_else(|| "top".into());
    let family = config_value(&project_path, "YosysFamily").unwrap_or_else(|| "gw2a".into());
    let sources = rtl_sources(&project_path)?;
    let mut script = String::from("# Non-destructive FPGA Studio optimization experiment.\n");
    for source in sources {
        script.push_str(&format!("read_verilog -sv \"{source}\"\n"));
    }
    script.push_str(&format!(
        "synth_gowin -top {top} -family {family}{synth_option} -json build/experiment/top.json\nstat\n"
    ));
    let directory = project_path.join("build/experiment");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create experiment directory: {error}"))?;
    fs::write(directory.join("synth.ys"), script)
        .map_err(|error| format!("Cannot write experiment synthesis script: {error}"))?;

    let baseline = read_snapshots(&project_path)?
        .snapshots
        .into_iter()
        .rev()
        .find(|snapshot| snapshot.kind == "baseline")
        .map(|snapshot| snapshot.id);
    let experiment = OptimizationExperiment {
        id: uuid::Uuid::new_v4().to_string(),
        kind: kind.into(),
        title: title.into(),
        status: "prepared".into(),
        created_at: Utc::now().to_rfc3339(),
        options,
        baseline_snapshot_id: baseline,
        result_snapshot_id: None,
        accepted: false,
    };
    let mut file = read_experiments(&project_path)?;
    if file.experiments.len() >= MAX_EXPERIMENTS {
        let remove = file.experiments.len() + 1 - MAX_EXPERIMENTS;
        file.experiments.drain(..remove);
    }
    file.schema_version = 1;
    file.experiments.push(experiment.clone());
    persist(&project_path, "experiments.json", &file)?;
    persist(&project_path, "current-experiment.json", &experiment)?;
    Ok(experiment)
}

pub fn finish_experiment(
    root: &str,
    project: &str,
    experiment_id: &str,
    success: bool,
) -> Result<OptimizationExperiment, String> {
    let workspace = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace, project)?;
    let snapshot = if success {
        Some(record_snapshot(
            root,
            project,
            "experiment",
            Some(experiment_id.into()),
        )?)
    } else {
        None
    };
    let mut file = read_experiments(&project_path)?;
    let experiment = file
        .experiments
        .iter_mut()
        .find(|experiment| experiment.id == experiment_id)
        .ok_or("Experiment does not exist")?;
    experiment.status = if success { "complete" } else { "failed" }.into();
    experiment.result_snapshot_id = snapshot.map(|snapshot| snapshot.id);
    let result = experiment.clone();
    persist(&project_path, "experiments.json", &file)?;
    Ok(result)
}

fn report_metrics(path: &Path) -> Result<ReportMetrics, String> {
    let payload: Value = serde_json::from_slice(
        &fs::read(path)
            .map_err(|_| format!("No implementation report exists at {}", path.display()))?,
    )
    .map_err(|error| format!("Implementation report is invalid JSON: {error}"))?;
    let clocks = payload.get("fmax").and_then(Value::as_object);
    let fmax = clocks
        .into_iter()
        .flatten()
        .filter_map(|(_, clock)| clock.get("achieved").and_then(Value::as_f64))
        .min_by(f64::total_cmp);
    let slack = clocks
        .into_iter()
        .flatten()
        .filter_map(|(_, clock)| {
            let achieved = clock.get("achieved")?.as_f64()?;
            let constraint = clock.get("constraint")?.as_f64()?;
            (achieved > 0.0 && constraint > 0.0)
                .then_some(1_000.0 / constraint - 1_000.0 / achieved)
        })
        .min_by(f64::total_cmp);
    let mut resources = payload
        .get("utilization")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(name, value)| {
            Some(ResourceUsage {
                name: name.clone(),
                label: name.clone(),
                used: value.get("used")?.as_u64()?,
                total: value.get("available")?.as_u64()?,
            })
        })
        .collect::<Vec<_>>();
    resources.sort_by(|left, right| left.name.cmp(&right.name));
    Ok((fmax, slack, resources))
}

fn compare_snapshots(baseline: &DesignSnapshot, candidate: &DesignSnapshot) -> SnapshotComparison {
    let mut metrics = vec![
        metric("Fmax", baseline.fmax_m_hz, candidate.fmax_m_hz, "MHz"),
        metric(
            "Worst slack",
            baseline.worst_slack_ns,
            candidate.worst_slack_ns,
            "ns",
        ),
    ];
    let before = baseline
        .resources
        .iter()
        .map(|resource| (resource.name.as_str(), resource.used as f64))
        .collect::<BTreeMap<_, _>>();
    for resource in &candidate.resources {
        metrics.push(metric(
            &resource.name,
            before.get(resource.name.as_str()).copied(),
            Some(resource.used as f64),
            "cells",
        ));
    }
    let mut regressions = regressions_from_metrics(&metrics, baseline.id, candidate.id);
    let verification_rank = |status: &str| match status {
        "passed" => 2,
        "partial" => 1,
        "failed" => 0,
        _ => -1,
    };
    if verification_rank(&candidate.verification_status)
        < verification_rank(&baseline.verification_status)
    {
        regressions.push(PerformanceRegression {
            id: format!("{}-{}-verification", baseline.id, candidate.id),
            severity: "warning".into(),
            title: "Verification regressed".into(),
            detail: format!(
                "Snapshot {} → {} changed verification from {} to {}.",
                baseline.id,
                candidate.id,
                baseline.verification_status,
                candidate.verification_status
            ),
            evidence: vec![DesignEvidence {
                class: EvidenceClass::Measured,
                source: "Design snapshots".into(),
                detail:
                    "Both verification states were recorded with their implementation snapshots."
                        .into(),
                build_number: None,
            }],
        });
    }
    SnapshotComparison {
        baseline_id: baseline.id,
        candidate_id: candidate.id,
        metrics,
        regressions,
    }
}

fn metric(
    name: &str,
    baseline: Option<f64>,
    candidate: Option<f64>,
    unit: &str,
) -> SnapshotMetricDelta {
    let delta = baseline
        .zip(candidate)
        .map(|(before, after)| after - before);
    let percent = baseline.zip(delta).and_then(|(before, change)| {
        (before.abs() > f64::EPSILON).then_some(change / before * 100.0)
    });
    SnapshotMetricDelta {
        metric: name.into(),
        baseline,
        candidate,
        delta,
        percent,
        unit: unit.into(),
    }
}

fn regressions_from_metrics(
    metrics: &[SnapshotMetricDelta],
    baseline_id: u64,
    candidate_id: u64,
) -> Vec<PerformanceRegression> {
    let mut result = Vec::new();
    for metric in metrics {
        let regressed = if metric.metric == "Fmax" {
            metric.percent.is_some_and(|percent| percent < -5.0)
        } else if metric.metric == "Worst slack" {
            metric
                .baseline
                .zip(metric.candidate)
                .is_some_and(|(before, after)| after < before && after - before < -0.2)
        } else {
            metric.percent.is_some_and(|percent| percent > 10.0)
                || (metric.metric.to_ascii_uppercase().contains("RAM")
                    && metric.baseline == Some(0.0)
                    && metric.candidate.is_some_and(|value| value > 0.0))
        };
        if regressed {
            result.push(PerformanceRegression {
                id: format!("{baseline_id}-{candidate_id}-{}", metric.metric),
                severity: "warning".into(),
                title: format!("{} regressed", metric.metric),
                detail: format!(
                    "Snapshot {baseline_id} → {candidate_id}: {} changed from {:?} to {:?} {}.",
                    metric.metric, metric.baseline, metric.candidate, metric.unit
                ),
                evidence: vec![DesignEvidence {
                    class: EvidenceClass::Measured,
                    source: "Design snapshots".into(),
                    detail: "Both values came from completed implementation reports.".into(),
                    build_number: None,
                }],
            });
        }
    }
    result
}

fn consecutive_regressions(snapshots: &[DesignSnapshot]) -> Vec<PerformanceRegression> {
    snapshots
        .windows(2)
        .flat_map(|pair| compare_snapshots(&pair[0], &pair[1]).regressions)
        .collect()
}

fn read_snapshots(project: &Path) -> Result<SnapshotFile, String> {
    read_file(project, "snapshots.json")
}

fn read_experiments(project: &Path) -> Result<ExperimentFile, String> {
    read_file(project, "experiments.json")
}

fn read_file<T: for<'de> Deserialize<'de> + Default>(
    project: &Path,
    name: &str,
) -> Result<T, String> {
    let path = project.join(".fpga-studio").join(name);
    if !path.is_file() {
        return Ok(T::default());
    }
    serde_json::from_slice(&fs::read(&path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("{} is invalid: {error}", path.display()))
}

fn persist<T: Serialize>(project: &Path, name: &str, value: &T) -> Result<(), String> {
    let directory = project.join(".fpga-studio");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(name);
    let temporary = directory.join(format!("{name}.tmp"));
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Cannot write {}: {error}", temporary.display()))?;
    let backup = directory.join(format!("{name}.bak"));
    if path.is_file() {
        let _ = fs::remove_file(&backup);
        fs::rename(&path, &backup)
            .map_err(|error| format!("Cannot rotate {}: {error}", path.display()))?;
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        if backup.is_file() {
            let _ = fs::rename(&backup, &path);
        }
        return Err(format!("Cannot publish {}: {error}", path.display()));
    }
    if backup.is_file() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn config_value(project: &Path, key: &str) -> Option<String> {
    let content = fs::read_to_string(project.join("fpga.config.psd1")).ok()?;
    let pattern = Regex::new(&format!(
        r#"(?m)^\s*{}\s*=\s*['\"]([^'\"]+)['\"]"#,
        regex::escape(key)
    ))
    .ok()?;
    pattern
        .captures(&content)?
        .get(1)
        .map(|value| value.as_str().into())
}

fn rtl_sources(project: &Path) -> Result<Vec<String>, String> {
    fn collect(base: &Path, path: &Path, result: &mut Vec<String>) -> Result<(), String> {
        for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                collect(base, &entry.path(), result)?;
            } else if matches!(
                entry
                    .path()
                    .extension()
                    .and_then(|extension| extension.to_str()),
                Some("v" | "sv")
            ) {
                result.push(
                    entry
                        .path()
                        .strip_prefix(base)
                        .unwrap_or(&entry.path())
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
        Ok(())
    }
    let mut sources = Vec::new();
    collect(project, &project.join("rtl"), &mut sources)?;
    sources.sort();
    if sources.is_empty() {
        return Err("No RTL sources exist for this experiment".into());
    }
    Ok(sources)
}

fn git_commit(workspace: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(workspace)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn analyzer_config_hash(project: &Path) -> Option<String> {
    let payload = fs::read(project.join(".fpga-studio/analyzer.json")).ok()?;
    let mut digest = Sha256::new();
    digest.update(payload);
    Some(format!("{:x}", digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::{compare_snapshots, metric, prepare_experiment, record_snapshot};
    use crate::models::DesignSnapshot;
    use std::path::Path;

    fn snapshot(id: u64, fmax: f64) -> DesignSnapshot {
        DesignSnapshot {
            id,
            created_at: "2026-01-01T00:00:00Z".into(),
            git_commit: None,
            rtl_hash: "rtl".into(),
            board: "device".into(),
            toolchain_version: "tools".into(),
            kind: "baseline".into(),
            experiment_id: None,
            fmax_m_hz: Some(fmax),
            worst_slack_ns: Some(1.0),
            resources: Vec::new(),
            critical_path: None,
            analyzer_config_hash: None,
            verification_status: "passed".into(),
        }
    }

    #[test]
    fn metric_percent_is_evidence_preserving() {
        let result = metric("Fmax", Some(100.0), Some(90.0), "MHz");
        assert_eq!(result.delta, Some(-10.0));
        assert_eq!(result.percent, Some(-10.0));
    }

    #[test]
    fn fmax_decline_is_flagged_as_regression() {
        let comparison = compare_snapshots(&snapshot(1, 100.0), &snapshot(2, 80.0));
        assert_eq!(comparison.regressions.len(), 1);
    }

    #[test]
    fn verification_and_negative_slack_declines_are_regressions() {
        let mut before = snapshot(1, 100.0);
        before.worst_slack_ns = Some(-1.0);
        before.verification_status = "passed".into();
        let mut after = snapshot(2, 100.0);
        after.worst_slack_ns = Some(-1.5);
        after.verification_status = "failed".into();
        let comparison = compare_snapshots(&before, &after);
        assert!(comparison
            .regressions
            .iter()
            .any(|item| item.title == "Worst slack regressed"));
        assert!(comparison
            .regressions
            .iter()
            .any(|item| item.title == "Verification regressed"));
    }

    #[test]
    #[ignore = "uses maintained project reports and is run by the release validation job"]
    fn prepares_maintained_retiming_experiment() {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("workspace root");
        let root = workspace.to_string_lossy();
        let project = "projects/05_serial_command_console";
        record_snapshot(&root, project, "baseline", None).expect("baseline snapshot");
        let experiment = prepare_experiment(&root, project, "retime-critical-path")
            .expect("retiming experiment");
        assert_eq!(experiment.kind, "retime");
        assert!(workspace
            .join(project)
            .join("build/experiment/synth.ys")
            .is_file());
    }
}
