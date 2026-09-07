use crate::models::{NetlistEdge, NetlistGraph, NetlistNode};
use crate::security::{canonical_workspace, resolve_project_path, workspace_path_reference};
use regex::Regex;
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::Path;

const MAX_JSON_BYTES: u64 = 64 * 1024 * 1024;
const MAX_NETLIST_CELLS: usize = 50_000;
const MAX_VISIBLE_NODES: usize = 1_500;
const MAX_VISIBLE_EDGES: usize = 5_000;

pub fn read(root: &str, project: &str) -> Result<NetlistGraph, String> {
    let root = canonical_workspace(root)?;
    let project = resolve_project_path(&root, project)?;
    let path = project.join("build/top.json");
    let metadata = fs::metadata(&path)
        .map_err(|_| "No synthesized netlist exists yet. Run Build first.".to_owned())?;
    if metadata.len() > MAX_JSON_BYTES {
        return Err(format!(
            "Netlist is {} MiB; the interactive viewer limit is 64 MiB.",
            metadata.len() / 1024 / 1024
        ));
    }
    let payload: Value = serde_json::from_slice(
        &fs::read(&path).map_err(|error| format!("Cannot read netlist: {error}"))?,
    )
    .map_err(|error| format!("Synthesized netlist is invalid JSON: {error}"))?;
    parse(&payload, &project, workspace_path_reference(&root, &path))
}

fn parse(payload: &Value, project: &Path, path: String) -> Result<NetlistGraph, String> {
    let modules = payload
        .get("modules")
        .and_then(Value::as_object)
        .filter(|modules| !modules.is_empty())
        .ok_or("The Yosys JSON file contains no modules")?;
    let module_name = if modules.contains_key("top") {
        "top".to_owned()
    } else {
        modules
            .iter()
            .find(|(_, module)| {
                module
                    .get("attributes")
                    .and_then(|attributes| attributes.get("top"))
                    .is_some_and(truthy)
            })
            .map(|(name, _)| name.clone())
            .ok_or("Top module 'top' was not found in the synthesized netlist")?
    };
    let module = modules
        .get(&module_name)
        .and_then(Value::as_object)
        .ok_or("The selected module has an invalid representation")?;
    let raw_cells = module
        .get("cells")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if raw_cells.len() > MAX_NETLIST_CELLS {
        return Err(format!(
            "This netlist has {} cells; the safety limit is {MAX_NETLIST_CELLS}.",
            raw_cells.len()
        ));
    }

    let ports = module.get("ports").and_then(Value::as_object);
    let mut nodes = Vec::new();
    let mut producers = HashMap::<u64, BTreeSet<String>>::new();
    let mut consumers = HashMap::<u64, BTreeSet<String>>::new();
    if let Some(ports) = ports {
        let mut values = ports.iter().collect::<Vec<_>>();
        values.sort_by_key(|(name, _)| *name);
        for (name, description) in values {
            let direction = description
                .get("direction")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let bits = integer_bits(description.get("bits"));
            let id = format!("port:{name}");
            for bit in &bits {
                if matches!(direction, "input" | "inout") {
                    producers.entry(*bit).or_default().insert(id.clone());
                }
                if matches!(direction, "output" | "inout") {
                    consumers.entry(*bit).or_default().insert(id.clone());
                }
            }
            nodes.push(NetlistNode {
                id,
                label: name.clone(),
                kind: direction.to_ascii_uppercase(),
                detail: format!("{}-bit top-level port", bits.len().max(1)),
                source_file: None,
                source_line: None,
            });
        }
    }

    let mut cells = raw_cells.iter().collect::<Vec<_>>();
    cells.sort_by_key(|(name, _)| *name);
    let available_for_cells = MAX_VISIBLE_NODES.saturating_sub(nodes.len());
    for (name, description) in cells.iter().take(available_for_cells) {
        let cell_type = description
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let directions = description
            .get("port_directions")
            .and_then(Value::as_object);
        let connections = description.get("connections").and_then(Value::as_object);
        if let Some(connections) = connections {
            for (port, bits) in connections {
                let direction = directions
                    .and_then(|values| values.get(port))
                    .and_then(Value::as_str)
                    .unwrap_or("input");
                connect_endpoint(
                    name,
                    direction,
                    &integer_bits(Some(bits)),
                    &mut producers,
                    &mut consumers,
                );
            }
        }
        let (source_file, source_line) = source_location(description, project);
        nodes.push(NetlistNode {
            id: (*name).clone(),
            label: (*name).clone(),
            kind: cell_category(cell_type).to_owned(),
            detail: cell_type.to_owned(),
            source_file,
            source_line,
        });
    }

    let visible = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<BTreeSet<_>>();
    let names = named_nets(module);
    let mut grouped = HashMap::<(String, String), BTreeSet<String>>::new();
    'nets: for (bit, sources) in &producers {
        let label = names
            .get(bit)
            .cloned()
            .unwrap_or_else(|| format!("net {bit}"));
        for source in sources {
            for target in consumers.get(bit).into_iter().flatten() {
                if source != target
                    && visible.contains(source.as_str())
                    && visible.contains(target.as_str())
                {
                    grouped
                        .entry((source.clone(), target.clone()))
                        .or_default()
                        .insert(label.clone());
                    if grouped.len() >= MAX_VISIBLE_EDGES {
                        break 'nets;
                    }
                }
            }
        }
    }
    let mut connections = grouped.into_iter().collect::<Vec<_>>();
    connections.sort_by(|left, right| left.0.cmp(&right.0));
    let edges = connections
        .into_iter()
        .enumerate()
        .map(|(index, ((source, target), nets))| NetlistEdge {
            id: format!("edge:{index}"),
            source,
            target,
            nets: nets.into_iter().collect(),
        })
        .collect::<Vec<_>>();
    let truncated = raw_cells.len() > available_for_cells || edges.len() >= MAX_VISIBLE_EDGES;
    Ok(NetlistGraph {
        path,
        creator: payload
            .get("creator")
            .and_then(Value::as_str)
            .unwrap_or("Yosys")
            .to_owned(),
        module_name,
        total_cells: raw_cells.len(),
        truncated,
        nodes,
        edges,
    })
}

fn integer_bits(value: Option<&Value>) -> Vec<u64> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_u64)
        .collect()
}

fn connect_endpoint(
    id: &str,
    direction: &str,
    bits: &[u64],
    producers: &mut HashMap<u64, BTreeSet<String>>,
    consumers: &mut HashMap<u64, BTreeSet<String>>,
) {
    for bit in bits {
        if matches!(direction, "output" | "inout") {
            producers.entry(*bit).or_default().insert(id.to_owned());
        }
        if matches!(direction, "input" | "inout") {
            consumers.entry(*bit).or_default().insert(id.to_owned());
        }
    }
}

fn named_nets(module: &serde_json::Map<String, Value>) -> HashMap<u64, String> {
    let mut result = HashMap::new();
    if let Some(netnames) = module.get("netnames").and_then(Value::as_object) {
        for (name, description) in netnames {
            let hidden = description.get("hide_name").is_some_and(truthy);
            for bit in integer_bits(description.get("bits")) {
                if !result.contains_key(&bit) || !hidden {
                    result.insert(bit, name.clone());
                }
            }
        }
    }
    result
}

fn source_location(description: &Value, project: &Path) -> (Option<String>, Option<u32>) {
    let Some(source) = description
        .get("attributes")
        .and_then(|attributes| attributes.get("src"))
        .and_then(Value::as_str)
    else {
        return (None, None);
    };
    let pattern = Regex::new(r"(?i)([^|]+\.(?:sv|svh|v|vh)):(\d+)").expect("source regex");
    let Some(captures) = pattern.captures(source) else {
        return (None, None);
    };
    let raw_path = Path::new(captures.get(1).map_or("", |value| value.as_str()));
    let candidate = if raw_path.is_absolute() {
        raw_path.to_path_buf()
    } else {
        project.join(raw_path)
    };
    let Ok(candidate) = candidate.canonicalize() else {
        return (None, None);
    };
    let Ok(relative) = candidate.strip_prefix(project) else {
        return (None, None);
    };
    (
        Some(relative.to_string_lossy().replace('\\', "/")),
        captures
            .get(2)
            .and_then(|value| value.as_str().parse().ok()),
    )
}

fn cell_category(cell_type: &str) -> &'static str {
    let value = cell_type.trim_start_matches('$').to_ascii_uppercase();
    if ["IBUF", "OBUF", "IOBUF", "IOLOGIC"]
        .iter()
        .any(|item| value.contains(item))
    {
        "I/O"
    } else if ["DFF", "LATCH"].iter().any(|item| value.contains(item)) {
        "Sequential"
    } else if ["RAM", "MEM", "FIFO", "ROM"]
        .iter()
        .any(|item| value.contains(item))
    {
        "Memory"
    } else if ["PLL", "CLK", "GSR", "DCS", "DQCE"]
        .iter()
        .any(|item| value.contains(item))
    {
        "Clock/reset"
    } else if [
        "LUT", "MUX", "ALU", "ADD", "SUB", "MUL", "AND", "OR", "XOR", "NOT",
    ]
    .iter()
    .any(|item| value.contains(item))
    {
        "Logic"
    } else if matches!(value.as_str(), "VCC" | "GND") {
        "Constants"
    } else {
        "Other"
    }
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
    use super::parse;
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn parses_ports_cells_and_connections() {
        let payload = json!({
            "creator": "Yosys test",
            "modules": {"top": {
                "ports": {
                    "clk": {"direction": "input", "bits": [2]},
                    "led": {"direction": "output", "bits": [3]}
                },
                "cells": {"ff": {
                    "type": "$dff",
                    "port_directions": {"CLK": "input", "Q": "output"},
                    "connections": {"CLK": [2], "Q": [3]}
                }},
                "netnames": {"clock": {"hide_name": 0, "bits": [2]}}
            }}
        });
        let graph = parse(&payload, Path::new("."), "build/top.json".into()).expect("netlist");
        assert_eq!(graph.nodes.len(), 3);
        assert_eq!(graph.edges.len(), 2);
        assert!(graph
            .edges
            .iter()
            .any(|edge| edge.source == "port:clk" && edge.target == "ff"));
        assert!(graph
            .edges
            .iter()
            .any(|edge| edge.source == "ff" && edge.target == "port:led"));
    }
}
