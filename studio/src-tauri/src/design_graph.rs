use crate::models::{
    AnalyzerConfig, DesignEvidence, DesignGraphEdge, DesignGraphNode, DesignIntelligenceGraph,
    EvidenceClass, PhysicalLocation, ResourceUsage, TimingTrace, TimingTraceSegment,
};
use crate::security::{canonical_workspace, safe_existing_path};
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

const SCHEMA_VERSION: u32 = 1;
const MAX_REPORT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_GRAPH_NODES: usize = 60_000;
const MAX_TIMING_PATHS: usize = 16;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GraphCache {
    schema_version: u32,
    fingerprint: String,
    graph: DesignIntelligenceGraph,
}

pub fn read(root: &str, project: &str) -> Result<DesignIntelligenceGraph, String> {
    let workspace = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace, project)?;
    let fingerprint = fingerprint(&project_path)?;
    let cache_path = project_path.join(".fpga-studio/design-graph.json");
    if let Ok(payload) = fs::read(&cache_path) {
        if let Ok(cache) = serde_json::from_slice::<GraphCache>(&payload) {
            if cache.schema_version == SCHEMA_VERSION && cache.fingerprint == fingerprint {
                return Ok(cache.graph);
            }
        }
    }

    let graph = build(&project_path)?;
    persist_cache(&project_path, &fingerprint, &graph)?;
    Ok(graph)
}

pub fn rtl_hash(project: &Path) -> Result<String, String> {
    let mut paths = Vec::new();
    collect_hdl(&project.join("rtl"), &mut paths)?;
    paths.sort();
    let mut digest = Sha256::new();
    for path in paths {
        let relative = path.strip_prefix(project).unwrap_or(&path);
        digest.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
        digest.update([0]);
        digest.update(
            fs::read(&path).map_err(|error| format!("Cannot hash {}: {error}", path.display()))?,
        );
        digest.update([0xff]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn build(project: &Path) -> Result<DesignIntelligenceGraph, String> {
    let rtl_hash = rtl_hash(project)?;
    let mut nodes = BTreeMap::<String, DesignGraphNode>::new();
    let mut edges = BTreeMap::<String, DesignGraphEdge>::new();
    let mut unavailable = Vec::new();
    let mut resources = Vec::new();
    let analyzer = read_analyzer_config(project);

    let netlist_path = project.join("build/top.json");
    if let Some(payload) = read_json(&netlist_path)? {
        parse_netlist(project, &payload, &mut nodes, &mut edges)?;
    } else {
        unavailable
            .push("RTL to netlist mapping unavailable: run Build to create build/top.json.".into());
    }

    let physical_path = project.join("build/top_pnr.json");
    if let Some(payload) = read_json(&physical_path)? {
        parse_physical(project, &payload, &mut nodes, &mut edges)?;
    } else {
        unavailable
            .push("Physical placement unavailable: run Build to create build/top_pnr.json.".into());
    }

    let timing_path = project.join("build/timing.json");
    let timing_paths = if let Some(payload) = read_json(&timing_path)? {
        resources = parse_resources(&payload);
        parse_timing(project, &payload, analyzer.as_ref(), &mut nodes, &mut edges)
    } else {
        unavailable
            .push("Timing traceability unavailable: run Build to create build/timing.json.".into());
        Vec::new()
    };

    if analyzer.is_none() {
        unavailable.push(
            "Hardware analyzer mapping unavailable: save a Logic Analyzer configuration.".into(),
        );
    }
    if nodes.len() >= MAX_GRAPH_NODES {
        unavailable.push(format!(
            "The design graph reached its {MAX_GRAPH_NODES}-node interactive safety limit."
        ));
    }
    let status = if netlist_path.is_file() && physical_path.is_file() && timing_path.is_file() {
        "complete"
    } else {
        "partial"
    };
    Ok(DesignIntelligenceGraph {
        schema_version: SCHEMA_VERSION,
        generated_at: Utc::now().to_rfc3339(),
        rtl_hash,
        status: status.into(),
        nodes: nodes.into_values().collect(),
        edges: edges.into_values().collect(),
        timing_paths,
        resources,
        unavailable,
    })
}

fn parse_netlist(
    project: &Path,
    payload: &Value,
    nodes: &mut BTreeMap<String, DesignGraphNode>,
    edges: &mut BTreeMap<String, DesignGraphEdge>,
) -> Result<(), String> {
    let (_, module) = top_module(payload).ok_or("Yosys netlist contains no top module")?;
    if let Some(netnames) = module.get("netnames").and_then(Value::as_object) {
        for (name, description) in netnames.iter().take(MAX_GRAPH_NODES) {
            let width = description
                .get("bits")
                .and_then(Value::as_array)
                .map_or(1, |bits| bits.len().max(1)) as u32;
            let source = description
                .get("attributes")
                .and_then(|attributes| attributes.get("src"))
                .and_then(Value::as_str)
                .and_then(|value| source_location(project, value));
            let net_id = format!("net:{name}");
            nodes
                .entry(net_id.clone())
                .or_insert_with(|| DesignGraphNode {
                    id: net_id.clone(),
                    kind: "net".into(),
                    label: leaf_name(name),
                    hierarchy: Some(name.clone()),
                    width: Some(width),
                    source_file: source.as_ref().map(|value| value.0.clone()),
                    source_line: source.as_ref().map(|value| value.1),
                    netlist_name: Some(name.clone()),
                    cell_type: None,
                    physical: None,
                    evidence: evidence(
                        EvidenceClass::Measured,
                        "Yosys netlist",
                        "Signal exists in build/top.json after synthesis.",
                    ),
                });
            if let Some((file, line)) = source {
                link_source(file, line, &net_id, "synthesizes-to", nodes, edges);
            }
        }
    }
    if let Some(cells) = module.get("cells").and_then(Value::as_object) {
        for (name, description) in cells
            .iter()
            .take(MAX_GRAPH_NODES.saturating_sub(nodes.len()))
        {
            let cell_type = description
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_owned();
            let source = description
                .get("attributes")
                .and_then(|attributes| attributes.get("src"))
                .and_then(Value::as_str)
                .and_then(|value| source_location(project, value));
            let cell_id = format!("cell:{name}");
            nodes
                .entry(cell_id.clone())
                .or_insert_with(|| DesignGraphNode {
                    id: cell_id.clone(),
                    kind: "cell".into(),
                    label: leaf_name(name),
                    hierarchy: Some(name.clone()),
                    width: None,
                    source_file: source.as_ref().map(|value| value.0.clone()),
                    source_line: source.as_ref().map(|value| value.1),
                    netlist_name: Some(name.clone()),
                    cell_type: Some(cell_type),
                    physical: None,
                    evidence: evidence(
                        EvidenceClass::Measured,
                        "Yosys netlist",
                        "Cell exists in build/top.json after synthesis.",
                    ),
                });
            if let Some((file, line)) = source {
                link_source(file, line, &cell_id, "implements-as", nodes, edges);
            }
        }
    }
    Ok(())
}

fn parse_physical(
    project: &Path,
    payload: &Value,
    nodes: &mut BTreeMap<String, DesignGraphNode>,
    edges: &mut BTreeMap<String, DesignGraphEdge>,
) -> Result<(), String> {
    let (_, module) = top_module(payload).ok_or("Placed netlist contains no top module")?;
    let Some(cells) = module.get("cells").and_then(Value::as_object) else {
        return Ok(());
    };
    for (name, description) in cells
        .iter()
        .take(MAX_GRAPH_NODES.saturating_sub(nodes.len()))
    {
        let attributes = description.get("attributes").and_then(Value::as_object);
        let bel = attributes
            .and_then(|values| values.get("NEXTPNR_BEL"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let physical = bel.as_deref().and_then(location_from_bel);
        let source = attributes
            .and_then(|values| values.get("src"))
            .and_then(Value::as_str)
            .and_then(|value| source_location(project, value));
        let id = format!("cell:{name}");
        let entry = nodes.entry(id.clone()).or_insert_with(|| DesignGraphNode {
            id: id.clone(),
            kind: "cell".into(),
            label: leaf_name(name),
            hierarchy: Some(name.clone()),
            width: None,
            source_file: source.as_ref().map(|value| value.0.clone()),
            source_line: source.as_ref().map(|value| value.1),
            netlist_name: Some(name.clone()),
            cell_type: description
                .get("type")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            physical: None,
            evidence: evidence(
                EvidenceClass::Measured,
                "nextpnr placed netlist",
                "Cell exists in build/top_pnr.json.",
            ),
        });
        if physical.is_some() {
            entry.physical = physical;
            entry.evidence = evidence(
                EvidenceClass::Measured,
                "nextpnr placement",
                "BEL is recorded in build/top_pnr.json.",
            );
        }
        if let Some((file, line)) = source {
            link_source(file, line, &id, "placed-as", nodes, edges);
        }
    }
    Ok(())
}

fn parse_timing(
    project: &Path,
    payload: &Value,
    analyzer: Option<&AnalyzerConfig>,
    nodes: &mut BTreeMap<String, DesignGraphNode>,
    edges: &mut BTreeMap<String, DesignGraphEdge>,
) -> Vec<TimingTrace> {
    let clock_targets = payload
        .get("fmax")
        .and_then(Value::as_object)
        .map(|values| {
            values
                .iter()
                .filter_map(|(name, value)| {
                    value
                        .get("constraint")
                        .and_then(Value::as_f64)
                        .map(|frequency| (name.clone(), frequency))
                })
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let mut result = payload
        .get("critical_paths")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_TIMING_PATHS * 4)
        .enumerate()
        .map(|(path_index, path)| {
            let start = path
                .get("from")
                .and_then(Value::as_str)
                .unwrap_or("unavailable")
                .to_owned();
            let end = path
                .get("to")
                .and_then(Value::as_str)
                .unwrap_or("unavailable")
                .to_owned();
            let clock = clock_name(&start, &end);
            let raw_segments = path
                .get("path")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let delay_ns = raw_segments
                .iter()
                .filter_map(|segment| segment.get("delay").and_then(Value::as_f64))
                .sum::<f64>();
            let target_ns = clock_targets
                .get(&clock)
                .copied()
                .filter(|frequency| *frequency > 0.0)
                .map(|frequency| 1000.0 / frequency);
            let slack_ns = target_ns.map(|target| target - delay_ns);
            let mut rtl_sources = BTreeSet::new();
            let mut segments = Vec::new();
            for (index, segment) in raw_segments.iter().enumerate() {
                let kind = segment
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_owned();
                let net = segment
                    .get("net")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                let from_cell = endpoint_cell(segment.get("from"));
                let to_cell = endpoint_cell(segment.get("to"));
                let physical = segment
                    .get("to")
                    .and_then(|endpoint| endpoint.get("loc"))
                    .and_then(Value::as_array)
                    .and_then(|values| location_from_array(values));
                let source = segment
                    .get("sources")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .find_map(|value| source_location(project, value));
                if let Some((file, line)) = &source {
                    rtl_sources.insert(format!("{file}:{line}"));
                }
                let timing_id = format!("timing:{path_index}");
                for cell in [from_cell.as_ref(), to_cell.as_ref()].into_iter().flatten() {
                    let cell_id = format!("cell:{cell}");
                    if nodes.contains_key(&cell_id) {
                        add_edge(&timing_id, &cell_id, "passes-through", edges);
                    }
                }
                if let Some(net) = &net {
                    let net_id = format!("net:{net}");
                    if nodes.contains_key(&net_id) {
                        add_edge(&timing_id, &net_id, "uses-net", edges);
                    }
                }
                segments.push(TimingTraceSegment {
                    index,
                    kind,
                    delay_ns: segment.get("delay").and_then(Value::as_f64).unwrap_or(0.0),
                    net,
                    from_cell,
                    to_cell,
                    source_file: source.as_ref().map(|value| value.0.clone()),
                    source_line: source.as_ref().map(|value| value.1),
                    physical,
                });
            }
            let analyzer_channels = analyzer
                .map(|config| {
                    config
                        .channels
                        .iter()
                        .filter(|channel| {
                            segments.iter().any(|segment| {
                                segment.net.as_ref().is_some_and(|net| {
                                    net == &channel.signal
                                        || net.ends_with(&channel.signal)
                                        || channel.signal.ends_with(net)
                                })
                            })
                        })
                        .map(|channel| channel.id)
                        .collect()
                })
                .unwrap_or_default();
            let logic_levels = segments
                .iter()
                .filter(|segment| segment.kind.eq_ignore_ascii_case("logic"))
                .count();
            let timing_id = format!("timing:{path_index}");
            nodes.insert(
                timing_id.clone(),
                DesignGraphNode {
                    id: timing_id,
                    kind: "timingPath".into(),
                    label: format!("Critical path #{}", path_index + 1),
                    hierarchy: None,
                    width: None,
                    source_file: None,
                    source_line: None,
                    netlist_name: None,
                    cell_type: None,
                    physical: None,
                    evidence: evidence(
                        EvidenceClass::Measured,
                        "nextpnr timing report",
                        "Path and delays are recorded in build/timing.json.",
                    ),
                },
            );
            TimingTrace {
                id: format!("path-{}", path_index + 1),
                clock,
                start,
                end,
                delay_ns,
                target_ns,
                slack_ns,
                logic_levels,
                segments,
                rtl_sources: rtl_sources.into_iter().collect(),
                analyzer_channels,
                evidence: evidence(
                    EvidenceClass::Measured,
                    "nextpnr timing report",
                    "Delay is the sum of actual detailed timing segments.",
                ),
            }
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| right.delay_ns.total_cmp(&left.delay_ns));
    result.truncate(MAX_TIMING_PATHS);
    result
}

fn parse_resources(payload: &Value) -> Vec<ResourceUsage> {
    let Some(values) = payload.get("utilization").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut resources = values
        .iter()
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
    resources
}

fn top_module(payload: &Value) -> Option<(&str, &Value)> {
    let modules = payload.get("modules")?.as_object()?;
    if let Some(module) = modules.get("top") {
        return Some(("top", module));
    }
    modules.iter().find_map(|(name, module)| {
        let top = module
            .get("attributes")
            .and_then(|values| values.get("top"))
            .is_some_and(truthy);
        top.then_some((name.as_str(), module))
    })
}

fn source_location(project: &Path, source: &str) -> Option<(String, u32)> {
    let pattern = Regex::new(r"(?i)([^|]+?\.(?:sv|svh|v|vh)):(\d+)").ok()?;
    for captures in pattern.captures_iter(source) {
        let raw = captures.get(1)?.as_str();
        let path = Path::new(raw);
        let candidate = if path.is_absolute() {
            path.to_path_buf()
        } else {
            project.join(path)
        };
        let Ok(candidate) = candidate.canonicalize() else {
            continue;
        };
        let Ok(relative) = candidate.strip_prefix(project) else {
            continue;
        };
        let line = captures.get(2)?.as_str().parse().ok()?;
        return Some((relative.to_string_lossy().replace('\\', "/"), line));
    }
    None
}

fn link_source(
    file: String,
    line: u32,
    target: &str,
    relation: &str,
    nodes: &mut BTreeMap<String, DesignGraphNode>,
    edges: &mut BTreeMap<String, DesignGraphEdge>,
) {
    let source_id = format!("rtl:{file}:{line}");
    nodes
        .entry(source_id.clone())
        .or_insert_with(|| DesignGraphNode {
            id: source_id.clone(),
            kind: "rtl".into(),
            label: format!("{}:{line}", file.rsplit('/').next().unwrap_or(&file)),
            hierarchy: None,
            width: None,
            source_file: Some(file),
            source_line: Some(line),
            netlist_name: None,
            cell_type: None,
            physical: None,
            evidence: evidence(
                EvidenceClass::Measured,
                "Yosys src attribute",
                "Source span was preserved by synthesis.",
            ),
        });
    add_edge(&source_id, target, relation, edges);
}

fn add_edge(
    source: &str,
    target: &str,
    relation: &str,
    edges: &mut BTreeMap<String, DesignGraphEdge>,
) {
    let id = format!("{source}|{relation}|{target}");
    edges.entry(id.clone()).or_insert_with(|| DesignGraphEdge {
        id,
        source: source.into(),
        target: target.into(),
        relation: relation.into(),
        evidence: evidence(
            EvidenceClass::Measured,
            "implementation artifacts",
            "Relationship is present in generated Yosys/nextpnr data.",
        ),
    });
}

fn evidence(class: EvidenceClass, source: &str, detail: &str) -> DesignEvidence {
    DesignEvidence {
        class,
        source: source.into(),
        detail: detail.into(),
        build_number: None,
    }
}

fn endpoint_cell(value: Option<&Value>) -> Option<String> {
    value?
        .get("cell")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn location_from_array(values: &[Value]) -> Option<PhysicalLocation> {
    Some(PhysicalLocation {
        x: values.first()?.as_i64()?,
        y: values.get(1)?.as_i64()?,
        bel: None,
    })
}

fn location_from_bel(bel: &str) -> Option<PhysicalLocation> {
    let pattern = Regex::new(r"X(\d+)Y(\d+)").ok()?;
    let captures = pattern.captures(bel)?;
    Some(PhysicalLocation {
        x: captures.get(1)?.as_str().parse().ok()?,
        y: captures.get(2)?.as_str().parse().ok()?,
        bel: Some(bel.into()),
    })
}

fn clock_name(start: &str, end: &str) -> String {
    for value in [start, end] {
        if let Some(clock) = value.split_whitespace().last() {
            if clock != "unavailable" {
                return clock.to_owned();
            }
        }
    }
    "unavailable".into()
}

fn leaf_name(name: &str) -> String {
    name.rsplit('.').next().unwrap_or(name).to_owned()
}

fn read_analyzer_config(project: &Path) -> Option<AnalyzerConfig> {
    serde_json::from_slice(&fs::read(project.join(".fpga-studio/analyzer.json")).ok()?).ok()
}

fn read_json(path: &Path) -> Result<Option<Value>, String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(None);
    };
    if metadata.len() > MAX_REPORT_BYTES {
        return Err(format!(
            "{} exceeds the 128 MiB design-intelligence safety limit",
            path.display()
        ));
    }
    let payload =
        fs::read(path).map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    serde_json::from_slice(&payload)
        .map(Some)
        .map_err(|error| format!("{} is invalid JSON: {error}", path.display()))
}

fn fingerprint(project: &Path) -> Result<String, String> {
    let mut digest = Sha256::new();
    digest.update(rtl_hash(project)?.as_bytes());
    for relative in [
        "build/top.json",
        "build/top_pnr.json",
        "build/timing.json",
        ".fpga-studio/analyzer.json",
    ] {
        let path = project.join(relative);
        digest.update(relative.as_bytes());
        if let Ok(metadata) = fs::metadata(&path) {
            digest.update(metadata.len().to_le_bytes());
            if let Ok(modified) = metadata.modified() {
                if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                    digest.update(duration.as_nanos().to_le_bytes());
                }
            }
        }
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn persist_cache(
    project: &Path,
    fingerprint: &str,
    graph: &DesignIntelligenceGraph,
) -> Result<(), String> {
    let directory = project.join(".fpga-studio");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create design-intelligence cache: {error}"))?;
    let path = directory.join("design-graph.json");
    let temporary = directory.join("design-graph.json.tmp");
    let payload = serde_json::to_vec_pretty(&GraphCache {
        schema_version: SCHEMA_VERSION,
        fingerprint: fingerprint.into(),
        graph: graph.clone(),
    })
    .map_err(|error| format!("Cannot serialize design graph: {error}"))?;
    fs::write(&temporary, payload)
        .map_err(|error| format!("Cannot write design graph cache: {error}"))?;
    if path.exists() {
        let backup = directory.join("design-graph.json.bak");
        let _ = fs::remove_file(&backup);
        fs::rename(&path, &backup)
            .map_err(|error| format!("Cannot rotate design graph cache: {error}"))?;
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::rename(&backup, &path);
            return Err(format!("Cannot publish design graph cache: {error}"));
        }
        let _ = fs::remove_file(backup);
    } else {
        fs::rename(&temporary, &path)
            .map_err(|error| format!("Cannot publish design graph cache: {error}"))?;
    }
    Ok(())
}

fn collect_hdl(path: &Path, result: &mut Vec<PathBuf>) -> Result<(), String> {
    if !path.is_dir() {
        return Ok(());
    }
    for entry in
        fs::read_dir(path).map_err(|error| format!("Cannot list {}: {error}", path.display()))?
    {
        let entry = entry.map_err(|error| format!("Cannot inspect HDL entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Cannot inspect HDL entry: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_hdl(&entry.path(), result)?;
        } else if file_type.is_file()
            && matches!(
                entry.path().extension().and_then(|value| value.to_str()),
                Some("v" | "sv" | "vh" | "svh")
            )
        {
            result.push(entry.path());
        }
    }
    Ok(())
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_i64().is_some_and(|value| value != 0),
        Value::String(value) => !value.trim_matches(['0', ' ']).is_empty(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{build, location_from_bel, rtl_hash};
    use std::fs;

    #[test]
    fn physical_bel_coordinates_are_evidence_backed() {
        let location = location_from_bel("X40Y28/LUT4").expect("location");
        assert_eq!((location.x, location.y), (40, 28));
        assert_eq!(location.bel.as_deref(), Some("X40Y28/LUT4"));
    }

    #[test]
    fn partial_graph_never_invents_missing_artifacts() {
        let directory =
            std::env::temp_dir().join(format!("fpga-studio-design-graph-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(directory.join("rtl")).expect("rtl directory");
        fs::write(directory.join("rtl/top.sv"), "module top; endmodule\n").expect("rtl");
        let graph = build(&directory).expect("graph");
        assert_eq!(graph.status, "partial");
        assert!(graph.nodes.is_empty());
        assert!(graph
            .unavailable
            .iter()
            .any(|message| message.contains("run Build")));
        assert_eq!(rtl_hash(&directory).expect("hash").len(), 64);
        fs::remove_dir_all(directory).expect("remove temporary project");
    }
}
