use crate::design_graph;
use crate::hdl;
use crate::models::{
    AnalyzerCapture, AnalyzerChannelConfig, AnalyzerConfig, AnalyzerCost, AnalyzerSignal,
    AnalyzerTrigger, AnalyzerTriggerClause, AnalyzerWorkspace, DesignEvidence, EvidenceClass,
    WaveSample, WaveSignal, WaveformData,
};
use crate::security::{canonical_workspace, safe_existing_path};
use chrono::Utc;
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

const CONFIG_SCHEMA: u32 = 1;
const CAPTURE_SCHEMA: u32 = 1;
const MAX_CHANNELS: usize = 16;
const MAX_CAPTURE_BITS: u32 = 128;
const MIN_DEPTH: usize = 64;
const MAX_DEPTH: usize = 4096;

#[derive(Debug, Clone)]
struct NetPort {
    name: String,
    direction: String,
    width: u32,
}

pub fn workspace(root: &str, project: &str) -> Result<AnalyzerWorkspace, String> {
    let workspace_root = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace_root, project)?;
    let signals = discover_signals_at(&workspace_root, &project_path)?;
    let config =
        read_config(&project_path).unwrap_or_else(|| default_config(&project_path, &signals));
    let cost = analyzer_cost(&project_path, &config);
    Ok(AnalyzerWorkspace {
        config,
        signals,
        cost,
        generated: project_path.join("build/analyzer/synth.ys").is_file(),
        artifacts: existing_artifacts(&project_path),
        warnings: analyzer_warnings(&project_path),
    })
}

pub fn save(
    root: &str,
    project: &str,
    config: AnalyzerConfig,
) -> Result<AnalyzerWorkspace, String> {
    let workspace_root = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace_root, project)?;
    let signals = discover_signals_at(&workspace_root, &project_path)?;
    validate_config(&project_path, &config, &signals)?;
    persist_json(&project_path, "analyzer.json", &config)?;
    generate_at(&project_path, &config, &signals)?;
    workspace(root, project)
}

pub fn prepare(root: &str, project: &str) -> Result<AnalyzerWorkspace, String> {
    let workspace_root = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace_root, project)?;
    let signals = discover_signals_at(&workspace_root, &project_path)?;
    let config = read_config(&project_path).ok_or(
        "No Logic Analyzer configuration is saved. Select signals and save the configuration first.",
    )?;
    validate_config(&project_path, &config, &signals)?;
    generate_at(&project_path, &config, &signals)?;
    workspace(root, project)
}

pub fn capture(
    root: &str,
    project: &str,
    port_name: &str,
    timeout_ms: u64,
) -> Result<AnalyzerCapture, String> {
    if !(1_000..=120_000).contains(&timeout_ms) {
        return Err("Capture timeout must be between 1 and 120 seconds".into());
    }
    let workspace = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace, project)?;
    let signals = discover_signals_at(&workspace, &project_path)?;
    let config = read_config(&project_path).ok_or("No Logic Analyzer configuration is saved")?;
    validate_config(&project_path, &config, &signals)?;
    let available = serialport::available_ports()
        .map_err(|error| format!("Cannot enumerate serial devices: {error}"))?;
    if !available.iter().any(|port| port.port_name == port_name) {
        return Err(format!("Serial port '{port_name}' is not available"));
    }
    let mut port = serialport::new(port_name, config.baud_rate)
        .timeout(Duration::from_millis(120))
        .open()
        .map_err(|error| format!("Cannot open analyzer transport {port_name}: {error}"))?;
    let _ = port.clear(serialport::ClearBuffer::All);
    port.write_all(b"R")
        .and_then(|_| port.flush())
        .map_err(|error| format!("Cannot reset analyzer: {error}"))?;
    std::thread::sleep(Duration::from_millis(20));
    port.write_all(b"A")
        .and_then(|_| port.flush())
        .map_err(|error| format!("Cannot arm analyzer: {error}"))?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut status = 0_u8;
    while Instant::now() < deadline {
        port.write_all(b"?")
            .and_then(|_| port.flush())
            .map_err(|error| format!("Cannot query analyzer status: {error}"))?;
        match read_one(&mut *port, deadline) {
            Ok(value) => status = value,
            Err(error) if error.contains("timed out") => continue,
            Err(error) => return Err(error),
        }
        if status == 3 {
            break;
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    if status != 3 {
        let _ = port.write_all(b"S");
        return Err(match status {
            1 => "Analyzer capture timed out while armed; the trigger condition was not observed.",
            2 => "Analyzer triggered but post-trigger capture did not complete before timeout.",
            _ => "Analyzer did not enter the armed state. Rebuild and upload the instrumented design.",
        }
        .into());
    }

    port.write_all(b"D")
        .and_then(|_| port.flush())
        .map_err(|error| format!("Cannot request analyzer samples: {error}"))?;
    let configured_width = config
        .channels
        .iter()
        .map(|channel| channel.width)
        .sum::<u32>();
    let configured_bytes = config
        .sample_depth
        .saturating_mul((configured_width as usize).div_ceil(8));
    let transfer_ms = ((configured_bytes as u128 + 11) * 10_000 / config.baud_rate as u128)
        .saturating_add(2_000)
        .clamp(2_000, 120_000) as u64;
    let transfer_deadline = Instant::now() + Duration::from_millis(transfer_ms);
    let mut header = [0_u8; 10];
    read_exact_until(&mut *port, &mut header, transfer_deadline)?;
    if header[..4] != [b'L', b'A', b'3', 1] {
        return Err(
            "Analyzer returned an unknown capture header. Rebuild the instrumented design.".into(),
        );
    }
    let width = u16::from_le_bytes([header[4], header[5]]) as u32;
    let depth = u16::from_le_bytes([header[6], header[7]]) as usize;
    let trigger_index = u16::from_le_bytes([header[8], header[9]]) as usize;
    let expected_width = config
        .channels
        .iter()
        .map(|channel| channel.width)
        .sum::<u32>();
    if width != expected_width || depth != config.sample_depth || trigger_index >= depth {
        return Err(format!(
            "Analyzer metadata does not match the saved configuration (hardware {width} bits/{depth} samples, expected {expected_width} bits/{} samples).",
            config.sample_depth
        ));
    }
    let bytes_per_sample = (width as usize).div_ceil(8);
    let payload_length = depth
        .checked_mul(bytes_per_sample)
        .filter(|length| *length <= MAX_DEPTH * (MAX_CAPTURE_BITS as usize / 8))
        .ok_or("Analyzer payload exceeds the safety limit")?;
    let mut payload = vec![0_u8; payload_length];
    read_exact_until(&mut *port, &mut payload, transfer_deadline)?;
    let footer = read_one(&mut *port, transfer_deadline)?;
    if footer != b'E' {
        return Err("Analyzer sample transfer ended without a valid footer".into());
    }
    let capture = decode_capture(&project_path, &config, trigger_index, &payload)?;
    persist_json(&project_path, "analyzer-capture.json", &capture)?;
    Ok(capture)
}

pub fn latest_capture(root: &str, project: &str) -> Result<Option<AnalyzerCapture>, String> {
    let workspace = canonical_workspace(root)?;
    let project_path = safe_existing_path(&workspace, project)?;
    let path = project_path.join(".fpga-studio/analyzer-capture.json");
    if !path.is_file() {
        return Ok(None);
    }
    let capture = serde_json::from_slice(
        &fs::read(&path).map_err(|error| format!("Cannot read analyzer capture: {error}"))?,
    )
    .map_err(|error| format!("Analyzer capture metadata is invalid: {error}"))?;
    Ok(Some(capture))
}

fn discover_signals_at(workspace: &Path, project: &Path) -> Result<Vec<AnalyzerSignal>, String> {
    let netlist_path = project.join("build/analyzer_user.json");
    if !netlist_path.is_file() {
        let relative = project.strip_prefix(workspace).unwrap_or(project);
        return Ok(
            hdl::index(&workspace.to_string_lossy(), &relative.to_string_lossy())?
                .signals
                .into_iter()
                .map(|signal| AnalyzerSignal {
                    id: signal.id,
                    name: signal.name,
                    hierarchy: signal.hierarchy,
                    width: signal.width,
                    kind: signal.kind,
                    source_file: Some(signal.file),
                    source_line: Some(signal.line),
                    observable: false,
                    unavailable_reason: signal.unavailable_reason,
                })
                .collect(),
        );
    }
    let payload: Value = serde_json::from_slice(
        &fs::read(&netlist_path)
            .map_err(|error| format!("Cannot read synthesized netlist: {error}"))?,
    )
    .map_err(|error| format!("Synthesized netlist is invalid JSON: {error}"))?;
    let module = top_module(&payload).ok_or("Synthesized netlist contains no top module")?;
    let register_bits = register_output_bits(module);
    let ports = module.get("ports").and_then(Value::as_object);
    let source_pattern =
        Regex::new(r"(?i)([^|]+?\.(?:sv|svh|v|vh)):(\d+)").expect("source location regex");
    let mut result = module
        .get("netnames")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(name, description)| {
            if name.starts_with('$') || description.get("hide_name").is_some_and(truthy) {
                return None;
            }
            let bits = numeric_bits(description.get("bits"));
            if bits.is_empty() || bits.len() > MAX_CAPTURE_BITS as usize {
                return None;
            }
            let source = description
                .get("attributes")
                .and_then(|values| values.get("src"))
                .and_then(Value::as_str)
                .and_then(|raw| project_source(project, raw, &source_pattern));
            let is_port = ports.is_some_and(|values| values.contains_key(name));
            let kind = if bits.iter().any(|bit| register_bits.contains(bit)) {
                "register"
            } else if is_port {
                "port"
            } else {
                "wire"
            };
            Some(AnalyzerSignal {
                id: format!("net:{name}"),
                name: name.rsplit('.').next().unwrap_or(name).into(),
                hierarchy: name.clone(),
                width: bits.len() as u32,
                kind: kind.into(),
                source_file: source.as_ref().map(|value| value.0.clone()),
                source_line: source.as_ref().map(|value| value.1),
                observable: true,
                unavailable_reason: None,
            })
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| {
        left.hierarchy
            .to_ascii_lowercase()
            .cmp(&right.hierarchy.to_ascii_lowercase())
    });
    Ok(result)
}

fn default_config(_project: &Path, signals: &[AnalyzerSignal]) -> AnalyzerConfig {
    let clock = signals
        .iter()
        .find(|signal| signal.name.to_ascii_lowercase().contains("clk"))
        .map(|signal| signal.hierarchy.clone())
        .unwrap_or_else(|| "clk_27mhz".into());
    let mut default_bits = 0_u32;
    let channels = signals
        .iter()
        .filter(|signal| {
            signal.observable
                && signal.hierarchy != clock
                && !signal.name.to_ascii_lowercase().starts_with("uart_")
        })
        .filter(|signal| {
            if default_bits + signal.width > 32 {
                false
            } else {
                default_bits += signal.width;
                true
            }
        })
        .take(8)
        .enumerate()
        .map(|(id, signal)| AnalyzerChannelConfig {
            id,
            signal: signal.hierarchy.clone(),
            width: signal.width,
            radix: if signal.width == 1 { "binary" } else { "hex" }.into(),
        })
        .collect::<Vec<_>>();
    let first = channels.first().map_or(0, |channel| channel.id);
    AnalyzerConfig {
        schema_version: CONFIG_SCHEMA,
        clock_signal: clock,
        clock_hz: 27_000_000,
        transport_rx: "uart_rx".into(),
        transport_tx: "uart_tx".into(),
        baud_rate: 115_200,
        sample_depth: 1024,
        pre_trigger_samples: 512,
        channels,
        trigger: AnalyzerTrigger {
            combinator: "and".into(),
            clauses: vec![AnalyzerTriggerClause {
                channel_id: first,
                operation: "rising".into(),
                value: "1".into(),
            }],
        },
    }
}

fn validate_config(
    project: &Path,
    config: &AnalyzerConfig,
    signals: &[AnalyzerSignal],
) -> Result<(), String> {
    ensure_baseline_is_fresh(project)?;
    if config.schema_version != CONFIG_SCHEMA {
        return Err(format!(
            "Unsupported analyzer configuration schema {}",
            config.schema_version
        ));
    }
    if !(1..=MAX_CHANNELS).contains(&config.channels.len()) {
        return Err(format!(
            "Select between 1 and {MAX_CHANNELS} analyzer channels"
        ));
    }
    let width = config
        .channels
        .iter()
        .map(|channel| channel.width)
        .sum::<u32>();
    if width == 0 || width > MAX_CAPTURE_BITS {
        return Err(format!(
            "Analyzer channel width must be between 1 and {MAX_CAPTURE_BITS} bits"
        ));
    }
    if !(MIN_DEPTH..=MAX_DEPTH).contains(&config.sample_depth)
        || !config.sample_depth.is_power_of_two()
    {
        return Err(format!(
            "Sample depth must be a power of two between {MIN_DEPTH} and {MAX_DEPTH}"
        ));
    }
    if config.pre_trigger_samples == 0 || config.pre_trigger_samples >= config.sample_depth {
        return Err("Pre-trigger samples must be greater than zero and smaller than depth".into());
    }
    if !(300..=4_000_000).contains(&config.baud_rate) {
        return Err("Analyzer baud rate must be between 300 and 4,000,000".into());
    }
    if !(1_000_000..=500_000_000).contains(&config.clock_hz) {
        return Err("Analyzer clock must be between 1 MHz and 500 MHz".into());
    }
    let by_name = signals
        .iter()
        .map(|signal| (signal.hierarchy.as_str(), signal))
        .collect::<BTreeMap<_, _>>();
    let mut ids = BTreeSet::new();
    let mut names = BTreeSet::new();
    for channel in &config.channels {
        if channel.id >= MAX_CHANNELS || !ids.insert(channel.id) {
            return Err("Analyzer channel identifiers must be unique values from 0 to 15".into());
        }
        if !names.insert(channel.signal.as_str()) {
            return Err(format!(
                "Signal '{}' is selected more than once",
                channel.signal
            ));
        }
        let signal = by_name
            .get(channel.signal.as_str())
            .ok_or_else(|| format!("Selected signal '{}' no longer exists", channel.signal))?;
        if !signal.observable {
            return Err(format!(
                "Signal '{}' is unavailable to instrumentation: {}",
                channel.signal,
                signal
                    .unavailable_reason
                    .as_deref()
                    .unwrap_or("mapping unavailable")
            ));
        }
        if !safe_yosys_signal(&channel.signal) {
            return Err(format!(
                "Signal '{}' contains characters that cannot be instrumented safely in v3.0. Select its containing vector or another observable signal.",
                channel.signal
            ));
        }
        if channel.width != signal.width {
            return Err(format!(
                "Signal '{}' width changed from {} to {} bits; reselect it",
                channel.signal, channel.width, signal.width
            ));
        }
        if !matches!(channel.radix.as_str(), "binary" | "hex" | "decimal") {
            return Err("Channel radix must be binary, hex, or decimal".into());
        }
    }
    if config.trigger.combinator != "and" || config.trigger.clauses.is_empty() {
        return Err("The v3.0 trigger engine requires one or more AND-combined clauses".into());
    }
    for clause in &config.trigger.clauses {
        let channel = config
            .channels
            .iter()
            .find(|channel| channel.id == clause.channel_id)
            .ok_or("Trigger references a channel that is not selected")?;
        if !matches!(
            clause.operation.as_str(),
            "rising" | "falling" | "level" | "compare"
        ) {
            return Err(format!(
                "Unsupported trigger operation '{}'",
                clause.operation
            ));
        }
        if matches!(clause.operation.as_str(), "rising" | "falling") && channel.width != 1 {
            return Err("Rising/falling edge triggers require a scalar channel".into());
        }
        if matches!(clause.operation.as_str(), "level" | "compare") {
            parse_trigger_value(&clause.value, channel.width)?;
        }
    }
    let ports = netlist_ports(project)?;
    require_port(&ports, &config.clock_signal, "input", "capture clock")?;
    require_port(&ports, &config.transport_rx, "input", "analyzer UART RX")?;
    require_port(&ports, &config.transport_tx, "output", "analyzer UART TX")?;
    Ok(())
}

fn generate_at(
    project: &Path,
    config: &AnalyzerConfig,
    signals: &[AnalyzerSignal],
) -> Result<(), String> {
    let ports = netlist_ports(project)?;
    let signal_map = signals
        .iter()
        .map(|signal| (signal.hierarchy.as_str(), signal))
        .collect::<BTreeMap<_, _>>();
    let directory = project.join("build/analyzer");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create analyzer build directory: {error}"))?;
    fs::write(directory.join("analyzer_core.sv"), analyzer_core())
        .map_err(|error| format!("Cannot generate analyzer core: {error}"))?;
    let (compare_mask, compare_value, rising_mask, falling_mask) = trigger_vectors(config)?;
    let total_width = config
        .channels
        .iter()
        .map(|channel| channel.width)
        .sum::<u32>();
    let mut offset = 0_u32;
    let port_names = ports
        .iter()
        .map(|port| port.name.as_str())
        .collect::<BTreeSet<_>>();
    let mut wrapper = String::from("`timescale 1ns/1ps\n`default_nettype none\n\nmodule top (\n");
    for (index, port) in ports.iter().enumerate() {
        let separator = if index + 1 == ports.len() { "" } else { "," };
        wrapper.push_str(&format!("    {}{}\n", port_declaration(port), separator));
    }
    wrapper.push_str(");\n");
    for port in &ports {
        if port.direction == "output" && port.name == config.transport_tx {
            wrapper.push_str(&format!(
                "    wire{} __studio_user_{};\n",
                range(port.width),
                port.name
            ));
        }
    }
    for channel in &config.channels {
        if !port_names.contains(channel.signal.as_str()) {
            wrapper.push_str(&format!(
                "    wire{} __studio_channel_{};\n",
                range(channel.width),
                channel.id
            ));
        }
    }
    wrapper.push_str(&format!(
        "    wire [{}:0] __studio_sample;\n",
        total_width - 1
    ));
    wrapper.push_str("\n    fpga_studio_user_top user_design (\n");
    let mut connections = Vec::new();
    for port in &ports {
        let target = if port.direction == "output" && port.name == config.transport_tx {
            format!("__studio_user_{}", port.name)
        } else {
            verilog_identifier(&port.name)
        };
        connections.push(format!(
            "        .{}({target})",
            verilog_identifier(&port.name)
        ));
    }
    for channel in &config.channels {
        if !port_names.contains(channel.signal.as_str()) {
            connections.push(format!(
                "        .{}(__studio_channel_{})",
                verilog_identifier(&channel.signal),
                channel.id
            ));
        }
    }
    wrapper.push_str(&connections.join(",\n"));
    wrapper.push_str("\n    );\n\n");
    for channel in &config.channels {
        let expression = if port_names.contains(channel.signal.as_str()) {
            if channel.signal == config.transport_tx {
                format!("__studio_user_{}", config.transport_tx)
            } else {
                verilog_identifier(&channel.signal)
            }
        } else {
            format!("__studio_channel_{}", channel.id)
        };
        wrapper.push_str(&format!(
            "    assign __studio_sample[{} +: {}] = {};\n",
            offset, channel.width, expression
        ));
        offset += channel.width;
    }
    wrapper.push_str(&format!(
        "\n    fpga_studio_analyzer_core #(\n        .WIDTH({total_width}),\n        .DEPTH({depth}),\n        .PRE_TRIGGER({pre}),\n        .CLOCK_HZ({clock_hz}),\n        .BAUD_RATE({baud}),\n        .COMPARE_MASK({width}'h{compare_mask}),\n        .COMPARE_VALUE({width}'h{compare_value}),\n        .RISING_MASK({width}'h{rising_mask}),\n        .FALLING_MASK({width}'h{falling_mask})\n    ) hardware_analyzer (\n        .clk({clock}),\n        .rx_i({rx}),\n        .tx_o({tx}),\n        .probe_i(__studio_sample)\n    );\nendmodule\n\n`default_nettype wire\n",
        depth = config.sample_depth,
        pre = config.pre_trigger_samples,
        clock_hz = config.clock_hz,
        baud = config.baud_rate,
        width = total_width,
        clock = verilog_identifier(&config.clock_signal),
        rx = verilog_identifier(&config.transport_rx),
        tx = verilog_identifier(&config.transport_tx),
    ));
    fs::write(directory.join("analyzer_wrapper.sv"), wrapper)
        .map_err(|error| format!("Cannot generate analyzer wrapper: {error}"))?;

    let mut stub =
        String::from("`default_nettype none\n\n(* blackbox *) module fpga_studio_user_top (\n");
    let mut stub_ports = ports.iter().map(port_declaration).collect::<Vec<_>>();
    for channel in &config.channels {
        if !port_names.contains(channel.signal.as_str()) {
            stub_ports.push(format!(
                "output wire{} {}",
                range(channel.width),
                verilog_identifier(&channel.signal)
            ));
        }
    }
    stub.push_str("    ");
    stub.push_str(&stub_ports.join(",\n    "));
    stub.push_str("\n);\nendmodule\n\n`default_nettype wire\n");
    fs::write(directory.join("analyzer_user_stub.sv"), stub)
        .map_err(|error| format!("Cannot generate analyzer user-design contract: {error}"))?;

    let family = config_value(project, "YosysFamily").unwrap_or_else(|| "gw2a".into());
    // Instrument the exact synthesized baseline so probe widths and optimized
    // names match the evidence shown in the UI. Re-reading source here can
    // silently change widths when synthesis trimmed unused vector bits.
    let mut script = String::from(
        "# Generated by FPGA Studio 3.0; user RTL is never edited.\nread_json build/analyzer_user.json\n",
    );
    for channel in &config.channels {
        if !port_names.contains(channel.signal.as_str()) {
            let _ = signal_map.get(channel.signal.as_str()).ok_or_else(|| {
                format!("Signal '{}' disappeared during generation", channel.signal)
            })?;
            script.push_str(&format!(
                "select -assert-count 1 top/w:{}\n",
                channel.signal
            ));
            script.push_str(&format!("expose top/w:{}\n", channel.signal));
        }
    }
    script.push_str("rename top fpga_studio_user_top\ndesign -stash fpga_studio_user_design\n");
    script.push_str("read_verilog -sv -lib build/analyzer/analyzer_user_stub.sv\n");
    script.push_str("read_verilog -sv build/analyzer/analyzer_core.sv\n");
    script.push_str("read_verilog -sv build/analyzer/analyzer_wrapper.sv\n");
    script.push_str("hierarchy -check -top top\n");
    script.push_str(&format!(
        "synth_gowin -top top -family {family}\ndesign -copy-from fpga_studio_user_design fpga_studio_user_top\nhierarchy -check -top top\ncheck\nwrite_json build/analyzer/top.json\nstat\n"
    ));
    fs::write(directory.join("synth.ys"), script)
        .map_err(|error| format!("Cannot generate analyzer synthesis script: {error}"))?;

    let metadata = serde_json::json!({
        "schemaVersion": CONFIG_SCHEMA,
        "generatedAt": Utc::now().to_rfc3339(),
        "rtlHash": design_graph::rtl_hash(project)?,
        "configHash": json_hash(config)?,
        "totalWidth": total_width,
        "sampleDepth": config.sample_depth,
        "channels": config.channels,
        "transport": { "rx": config.transport_rx, "tx": config.transport_tx, "baud": config.baud_rate },
        "artifacts": ["build/analyzer/analyzer_core.sv", "build/analyzer/analyzer_wrapper.sv", "build/analyzer/analyzer_user_stub.sv", "build/analyzer/synth.ys"]
    });
    fs::write(
        directory.join("metadata.json"),
        serde_json::to_vec_pretty(&metadata).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Cannot write analyzer metadata: {error}"))?;
    Ok(())
}

fn trigger_vectors(config: &AnalyzerConfig) -> Result<(String, String, String, String), String> {
    let total_width = config
        .channels
        .iter()
        .map(|channel| channel.width)
        .sum::<u32>();
    let mut compare_mask = 0_u128;
    let mut compare_value = 0_u128;
    let mut rising_mask = 0_u128;
    let mut falling_mask = 0_u128;
    let mut offset = 0_u32;
    let offsets = config
        .channels
        .iter()
        .map(|channel| {
            let current = offset;
            offset += channel.width;
            (channel.id, (current, channel.width))
        })
        .collect::<BTreeMap<_, _>>();
    for clause in &config.trigger.clauses {
        let (offset, width) = offsets
            .get(&clause.channel_id)
            .copied()
            .ok_or("Trigger channel mapping is unavailable")?;
        let mask = width_mask(width) << offset;
        match clause.operation.as_str() {
            "rising" => rising_mask |= 1_u128 << offset,
            "falling" => falling_mask |= 1_u128 << offset,
            "level" | "compare" => {
                compare_mask |= mask;
                compare_value |= parse_trigger_value(&clause.value, width)? << offset;
            }
            _ => return Err("Unsupported trigger operation".into()),
        }
    }
    let digits = (total_width as usize).div_ceil(4).max(1);
    Ok((
        format!("{compare_mask:0digits$x}"),
        format!("{compare_value:0digits$x}"),
        format!("{rising_mask:0digits$x}"),
        format!("{falling_mask:0digits$x}"),
    ))
}

fn parse_trigger_value(value: &str, width: u32) -> Result<u128, String> {
    let normalized = value.trim().replace('_', "");
    let parsed = if let Some(value) = normalized.strip_prefix("0x") {
        u128::from_str_radix(value, 16)
    } else if let Some(value) = normalized.strip_prefix("0b") {
        u128::from_str_radix(value, 2)
    } else if normalized.chars().all(|value| matches!(value, '0' | '1')) && normalized.len() > 1 {
        u128::from_str_radix(&normalized, 2)
    } else {
        normalized.parse()
    }
    .map_err(|_| {
        format!("Trigger value '{value}' is not a valid binary, hexadecimal, or decimal number")
    })?;
    if parsed > width_mask(width) {
        return Err(format!(
            "Trigger value '{value}' does not fit in {width} bits"
        ));
    }
    Ok(parsed)
}

fn decode_capture(
    project: &Path,
    config: &AnalyzerConfig,
    trigger_index: usize,
    payload: &[u8],
) -> Result<AnalyzerCapture, String> {
    let width = config
        .channels
        .iter()
        .map(|channel| channel.width)
        .sum::<u32>();
    let bytes_per_sample = (width as usize).div_ceil(8);
    if payload.len() != config.sample_depth * bytes_per_sample {
        return Err("Analyzer payload length is inconsistent with capture metadata".into());
    }
    let mut offset = 0_u32;
    let signals = config
        .channels
        .iter()
        .map(|channel| {
            let channel_offset = offset;
            offset += channel.width;
            let mut samples = Vec::new();
            let mut previous = None;
            for index in 0..config.sample_depth {
                let raw = &payload[index * bytes_per_sample..(index + 1) * bytes_per_sample];
                let mut value = String::with_capacity(channel.width as usize);
                for bit in (0..channel.width).rev() {
                    let absolute = channel_offset + bit;
                    let state = (raw[absolute as usize / 8] >> (absolute % 8)) & 1;
                    value.push(if state == 1 { '1' } else { '0' });
                }
                if previous.as_deref() != Some(value.as_str()) {
                    samples.push(WaveSample {
                        time: index as u64,
                        value: value.clone(),
                    });
                    previous = Some(value);
                }
            }
            WaveSignal {
                id: format!("analyzer:{}", channel.id),
                name: channel
                    .signal
                    .rsplit('.')
                    .next()
                    .unwrap_or(&channel.signal)
                    .into(),
                scope: channel.signal.clone(),
                width: channel.width,
                samples,
            }
        })
        .collect();
    Ok(AnalyzerCapture {
        schema_version: CAPTURE_SCHEMA,
        captured_at: Utc::now().to_rfc3339(),
        rtl_hash: design_graph::rtl_hash(project)?,
        trigger_index,
        waveform: WaveformData {
            path: "hardware://logic-analyzer".into(),
            timescale: "1 sample".into(),
            end_time: config.sample_depth.saturating_sub(1) as u64,
            truncated: false,
            signals,
        },
        source: DesignEvidence {
            class: EvidenceClass::Measured,
            source: "FPGA Studio UART analyzer protocol".into(),
            detail: "Samples were transferred from the programmed FPGA capture RAM.".into(),
            build_number: None,
        },
    })
}

fn analyzer_cost(project: &Path, config: &AnalyzerConfig) -> AnalyzerCost {
    let width = config
        .channels
        .iter()
        .map(|channel| channel.width)
        .sum::<u32>() as i64;
    let bits = width * config.sample_depth as i64;
    let estimated = AnalyzerCost {
        source: EvidenceClass::Estimated,
        lut: 32 + width * 2 + config.trigger.clauses.len() as i64 * 4,
        ff: 56 + width * 2 + config.sample_depth.ilog2() as i64 * 4,
        bram: (bits + 18_431) / 18_432,
        baseline_fmax_m_hz: report_fmax(&project.join("build/timing.json")),
        instrumented_fmax_m_hz: None,
        fmax_impact_percent: None,
    };
    let baseline = report_metrics(&project.join("build/timing.json"));
    let instrumented = report_metrics(&project.join("build/analyzer/timing.json"));
    let (Some(base), Some(analyzed)) = (baseline, instrumented) else {
        return estimated;
    };
    let baseline_fmax = base.3;
    let instrumented_fmax = analyzed.3;
    AnalyzerCost {
        source: EvidenceClass::Measured,
        lut: analyzed.0 - base.0,
        ff: analyzed.1 - base.1,
        bram: analyzed.2 - base.2,
        baseline_fmax_m_hz: baseline_fmax,
        instrumented_fmax_m_hz: instrumented_fmax,
        fmax_impact_percent: baseline_fmax
            .zip(instrumented_fmax)
            .and_then(|(before, after)| {
                (before > 0.0).then_some((after - before) / before * 100.0)
            }),
    }
}

fn report_metrics(path: &Path) -> Option<(i64, i64, i64, Option<f64>)> {
    let payload: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    let utilization = payload.get("utilization")?;
    let used = |name: &str| {
        utilization
            .get(name)
            .and_then(|value| value.get("used"))
            .and_then(Value::as_i64)
            .unwrap_or(0)
    };
    Some((
        used("LUT4"),
        used("DFF"),
        used("BSRAM"),
        report_fmax_value(&payload),
    ))
}

fn report_fmax(path: &Path) -> Option<f64> {
    report_metrics(path).and_then(|metrics| metrics.3)
}

fn report_fmax_value(payload: &Value) -> Option<f64> {
    payload
        .get("fmax")?
        .as_object()?
        .values()
        .filter_map(|clock| clock.get("achieved").and_then(Value::as_f64))
        .min_by(f64::total_cmp)
}

fn analyzer_warnings(project: &Path) -> Vec<String> {
    let mut result = Vec::new();
    if !project.join("build/analyzer_user.json").is_file() {
        result.push("Run a baseline Build before selecting observable signals.".into());
    }
    if project.join("build/analyzer/timing.json").is_file()
        && !project.join("build/analyzer/top.fs").is_file()
    {
        result.push("Instrumented timing exists but the analyzer bitstream is missing.".into());
    }
    result
}

fn existing_artifacts(project: &Path) -> Vec<String> {
    [
        "build/analyzer/analyzer_core.sv",
        "build/analyzer/analyzer_wrapper.sv",
        "build/analyzer/synth.ys",
        "build/analyzer/top.json",
        "build/analyzer/timing.json",
        "build/analyzer/top.fs",
        ".fpga-studio/analyzer-capture.json",
    ]
    .into_iter()
    .filter(|relative| project.join(relative).is_file())
    .map(str::to_owned)
    .collect()
}

fn read_config(project: &Path) -> Option<AnalyzerConfig> {
    serde_json::from_slice(&fs::read(project.join(".fpga-studio/analyzer.json")).ok()?).ok()
}

fn persist_json<T: serde::Serialize>(
    project: &Path,
    file_name: &str,
    value: &T,
) -> Result<(), String> {
    let directory = project.join(".fpga-studio");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create project intelligence directory: {error}"))?;
    let path = directory.join(file_name);
    let temporary = directory.join(format!("{file_name}.tmp"));
    let backup = directory.join(format!("{file_name}.bak"));
    let data = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Cannot serialize {file_name}: {error}"))?;
    fs::write(&temporary, data).map_err(|error| format!("Cannot write {file_name}: {error}"))?;
    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&path, &backup)
            .map_err(|error| format!("Cannot prepare {file_name} update: {error}"))?;
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::rename(&backup, &path);
            return Err(format!("Cannot publish {file_name}: {error}"));
        }
        let _ = fs::remove_file(backup);
    } else {
        fs::rename(&temporary, &path)
            .map_err(|error| format!("Cannot publish {file_name}: {error}"))?;
    }
    Ok(())
}

fn netlist_ports(project: &Path) -> Result<Vec<NetPort>, String> {
    let payload: Value = serde_json::from_slice(
        &fs::read(project.join("build/analyzer_user.json"))
            .map_err(|_| "No synthesized netlist exists. Run a baseline Build first.".to_owned())?,
    )
    .map_err(|error| format!("Synthesized netlist is invalid JSON: {error}"))?;
    let module = top_module(&payload).ok_or("Synthesized netlist contains no top module")?;
    let mut ports = module
        .get("ports")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(name, description)| NetPort {
            name: name.clone(),
            direction: description
                .get("direction")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .into(),
            width: description
                .get("bits")
                .and_then(Value::as_array)
                .map_or(1, |bits| bits.len().max(1)) as u32,
        })
        .collect::<Vec<_>>();
    ports.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(ports)
}

fn require_port(
    ports: &[NetPort],
    name: &str,
    direction: &str,
    purpose: &str,
) -> Result<(), String> {
    let port = ports
        .iter()
        .find(|port| port.name == name)
        .ok_or_else(|| format!("The configured {purpose} port '{name}' does not exist"))?;
    if port.direction != direction || port.width != 1 {
        return Err(format!(
            "The configured {purpose} port '{name}' must be a scalar {direction}"
        ));
    }
    Ok(())
}

fn top_module(payload: &Value) -> Option<&Value> {
    let modules = payload.get("modules")?.as_object()?;
    if let Some(module) = modules.get("top") {
        return Some(module);
    }
    modules.values().find(|module| {
        module
            .get("attributes")
            .and_then(|values| values.get("top"))
            .is_some_and(truthy)
    })
}

fn register_output_bits(module: &Value) -> BTreeSet<u64> {
    module
        .get("cells")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, cell)| {
            cell.get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind.to_ascii_uppercase().contains("DFF"))
        })
        .flat_map(|(_, cell)| {
            numeric_bits(
                cell.get("connections")
                    .and_then(|connections| connections.get("Q")),
            )
        })
        .collect()
}

fn numeric_bits(value: Option<&Value>) -> Vec<u64> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_u64)
        .collect()
}

fn project_source(project: &Path, raw: &str, pattern: &Regex) -> Option<(String, u32)> {
    for captures in pattern.captures_iter(raw) {
        let path = Path::new(captures.get(1)?.as_str());
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
        return Some((
            relative.to_string_lossy().replace('\\', "/"),
            captures.get(2)?.as_str().parse().ok()?,
        ));
    }
    None
}

fn ensure_baseline_is_fresh(project: &Path) -> Result<(), String> {
    fn newest_rtl(path: &Path, newest: &mut Option<std::time::SystemTime>) -> Result<(), String> {
        for entry in fs::read_dir(path)
            .map_err(|error| format!("Cannot list {}: {error}", path.display()))?
        {
            let entry = entry.map_err(|error| format!("Cannot inspect RTL entry: {error}"))?;
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                newest_rtl(&entry.path(), newest)?;
            } else if kind.is_file()
                && matches!(
                    entry.path().extension().and_then(|value| value.to_str()),
                    Some("v" | "sv")
                )
            {
                let modified = entry
                    .metadata()
                    .and_then(|metadata| metadata.modified())
                    .map_err(|error| {
                        format!("Cannot timestamp {}: {error}", entry.path().display())
                    })?;
                *newest = Some(newest.map_or(modified, |current| current.max(modified)));
            }
        }
        Ok(())
    }
    let netlist = project.join("build/analyzer_user.json");
    let built_at = fs::metadata(&netlist)
        .and_then(|metadata| metadata.modified())
        .map_err(|_| "No synthesized netlist exists. Run a baseline Build first.".to_owned())?;
    let mut newest = None;
    newest_rtl(&project.join("rtl"), &mut newest)?;
    if newest.is_some_and(|modified| modified > built_at) {
        return Err(
            "The synthesized netlist is older than the RTL. Run Build before configuring the Logic Analyzer."
                .into(),
        );
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

fn safe_yosys_signal(name: &str) -> bool {
    // `select top/w:<name>` treats glob metacharacters specially. Keeping the
    // accepted form explicit prevents configuration text from becoming Yosys
    // commands while supporting flattened hierarchical names.
    let pattern = Regex::new(r"^[A-Za-z_][A-Za-z0-9_.$]*$").expect("Yosys signal regex");
    pattern.is_match(name)
}

fn port_declaration(port: &NetPort) -> String {
    let kind = match port.direction.as_str() {
        "input" => "input wire",
        "output" => "output wire",
        "inout" => "inout wire",
        _ => "input wire",
    };
    format!(
        "{kind}{} {}",
        range(port.width),
        verilog_identifier(&port.name)
    )
}

fn range(width: u32) -> String {
    if width <= 1 {
        String::new()
    } else {
        format!(" [{}:0]", width - 1)
    }
}

fn verilog_identifier(name: &str) -> String {
    let normal = Regex::new(r"^[A-Za-z_]\w*$").expect("identifier regex");
    if normal.is_match(name) {
        name.into()
    } else {
        format!("\\{name} ")
    }
}

fn width_mask(width: u32) -> u128 {
    if width >= 128 {
        u128::MAX
    } else {
        (1_u128 << width) - 1
    }
}

fn json_hash<T: serde::Serialize>(value: &T) -> Result<String, String> {
    let mut digest = Sha256::new();
    digest.update(serde_json::to_vec(value).map_err(|error| error.to_string())?);
    Ok(format!("{:x}", digest.finalize()))
}

fn read_one(port: &mut dyn serialport::SerialPort, deadline: Instant) -> Result<u8, String> {
    let mut value = [0_u8; 1];
    read_exact_until(port, &mut value, deadline)?;
    Ok(value[0])
}

fn read_exact_until(
    port: &mut dyn serialport::SerialPort,
    target: &mut [u8],
    deadline: Instant,
) -> Result<(), String> {
    let mut offset = 0;
    while offset < target.len() && Instant::now() < deadline {
        match port.read(&mut target[offset..]) {
            Ok(0) => {}
            Ok(count) => offset += count,
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => return Err(format!("Analyzer sample transfer failed: {error}")),
        }
    }
    if offset == target.len() {
        Ok(())
    } else {
        Err(format!(
            "Analyzer sample transfer timed out after {offset}/{} bytes",
            target.len()
        ))
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

fn analyzer_core() -> &'static str {
    r#"`timescale 1ns/1ps
`default_nettype none

module fpga_studio_analyzer_core #(
    parameter integer WIDTH = 8,
    parameter integer DEPTH = 1024,
    parameter integer PRE_TRIGGER = 512,
    parameter integer CLOCK_HZ = 27_000_000,
    parameter integer BAUD_RATE = 115_200,
    parameter logic [WIDTH-1:0] COMPARE_MASK = '0,
    parameter logic [WIDTH-1:0] COMPARE_VALUE = '0,
    parameter logic [WIDTH-1:0] RISING_MASK = '0,
    parameter logic [WIDTH-1:0] FALLING_MASK = '0
) (
    input  wire clk,
    input  wire rx_i,
    output wire tx_o,
    input  wire [WIDTH-1:0] probe_i
);
    localparam integer ADDR_BITS = $clog2(DEPTH);
    localparam integer BYTES_PER_SAMPLE = (WIDTH + 7) / 8;
    localparam integer PAD_BITS = BYTES_PER_SAMPLE * 8 - WIDTH;
    localparam integer POST_SAMPLES = DEPTH - PRE_TRIGGER;

    logic [7:0] power_on_reset = '0;
    wire rst_n = &power_on_reset;
    always_ff @(posedge clk) if (!rst_n) power_on_reset <= power_on_reset + 1'b1;

    logic [WIDTH-1:0] capture_memory [0:DEPTH-1];
    logic [WIDTH-1:0] previous_probe;
    logic [ADDR_BITS-1:0] write_pointer;
    logic [ADDR_BITS:0] pre_count;
    logic [ADDR_BITS:0] post_remaining;
    logic armed, triggered, capture_complete;

    logic [7:0] rx_data;
    logic rx_valid, rx_error;
    logic [7:0] tx_data;
    logic tx_valid, tx_ready;

    wire arm_command = rx_valid && rx_data == 8'h41;
    wire stop_command = rx_valid && rx_data == 8'h53;
    wire reset_command = rx_valid && rx_data == 8'h52;
    wire trigger_match = ((probe_i & COMPARE_MASK) == (COMPARE_VALUE & COMPARE_MASK)) &&
        (((~previous_probe) & probe_i & RISING_MASK) == RISING_MASK) &&
        ((previous_probe & (~probe_i) & FALLING_MASK) == FALLING_MASK);

    always_ff @(posedge clk) begin
        if (!rst_n || reset_command) begin
            previous_probe <= '0;
            write_pointer <= '0;
            pre_count <= '0;
            post_remaining <= '0;
            armed <= 1'b0;
            triggered <= 1'b0;
            capture_complete <= 1'b0;
        end else if (arm_command) begin
            previous_probe <= probe_i;
            write_pointer <= '0;
            pre_count <= '0;
            post_remaining <= '0;
            armed <= 1'b1;
            triggered <= 1'b0;
            capture_complete <= 1'b0;
        end else if (stop_command) begin
            armed <= 1'b0;
        end else if (armed) begin
            capture_memory[write_pointer] <= probe_i;
            write_pointer <= write_pointer + 1'b1;
            previous_probe <= probe_i;
            if (pre_count < PRE_TRIGGER) pre_count <= pre_count + 1'b1;
            if (!triggered && pre_count >= PRE_TRIGGER && trigger_match) begin
                triggered <= 1'b1;
                post_remaining <= POST_SAMPLES - 1;
            end else if (triggered) begin
                if (post_remaining <= 1) begin
                    post_remaining <= '0;
                    armed <= 1'b0;
                    capture_complete <= 1'b1;
                end else post_remaining <= post_remaining - 1'b1;
            end
        end
    end

    fpga_studio_analyzer_uart_rx #(.CLOCK_HZ(CLOCK_HZ), .BAUD_RATE(BAUD_RATE)) command_receiver (
        .clk(clk), .rst_n(rst_n), .rx_i(rx_i), .data_o(rx_data),
        .valid_o(rx_valid), .framing_error_o(rx_error)
    );
    fpga_studio_analyzer_uart_tx #(.CLOCK_HZ(CLOCK_HZ), .BAUD_RATE(BAUD_RATE)) response_transmitter (
        .clk(clk), .rst_n(rst_n), .data_i(tx_data), .valid_i(tx_valid),
        .ready_o(tx_ready), .tx_o(tx_o)
    );

    localparam logic [2:0] D_IDLE = 3'd0, D_HEADER = 3'd1, D_LOAD = 3'd2,
        D_SEND = 3'd3, D_FOOTER = 3'd4;
    logic [2:0] dump_state;
    logic [3:0] header_index;
    logic [ADDR_BITS-1:0] dump_address;
    logic [ADDR_BITS:0] sample_index;
    logic [$clog2(BYTES_PER_SAMPLE+1)-1:0] byte_index;
    logic [BYTES_PER_SAMPLE*8-1:0] dump_shift;

    function automatic logic [7:0] header_byte(input logic [3:0] index);
        case (index)
            4'd0: header_byte = 8'h4c;
            4'd1: header_byte = 8'h41;
            4'd2: header_byte = 8'h33;
            4'd3: header_byte = 8'h01;
            4'd4: header_byte = WIDTH[7:0];
            4'd5: header_byte = WIDTH[15:8];
            4'd6: header_byte = DEPTH[7:0];
            4'd7: header_byte = DEPTH[15:8];
            4'd8: header_byte = PRE_TRIGGER[7:0];
            default: header_byte = PRE_TRIGGER[15:8];
        endcase
    endfunction

    always_ff @(posedge clk) begin
        if (!rst_n || reset_command) begin
            tx_data <= '0;
            tx_valid <= 1'b0;
            dump_state <= D_IDLE;
            header_index <= '0;
            dump_address <= '0;
            sample_index <= '0;
            byte_index <= '0;
            dump_shift <= '0;
        end else begin
            if (tx_valid) tx_valid <= 1'b0;
            case (dump_state)
                D_IDLE: if (!tx_valid && tx_ready && rx_valid) begin
                    if (rx_data == 8'h3f) begin
                        tx_data <= capture_complete ? 8'h03 : triggered ? 8'h02 : armed ? 8'h01 : 8'h00;
                        tx_valid <= 1'b1;
                    end else if (rx_data == 8'h44 && capture_complete) begin
                        header_index <= '0;
                        dump_state <= D_HEADER;
                    end
                end
                D_HEADER: if (!tx_valid && tx_ready) begin
                    tx_data <= header_byte(header_index);
                    tx_valid <= 1'b1;
                    if (header_index == 4'd9) begin
                        dump_address <= write_pointer;
                        sample_index <= '0;
                        dump_state <= D_LOAD;
                    end else header_index <= header_index + 1'b1;
                end
                D_LOAD: begin
                    dump_shift <= {{PAD_BITS{1'b0}}, capture_memory[dump_address]};
                    byte_index <= '0;
                    dump_state <= D_SEND;
                end
                D_SEND: if (!tx_valid && tx_ready) begin
                    tx_data <= dump_shift[7:0];
                    tx_valid <= 1'b1;
                    dump_shift <= dump_shift >> 8;
                    if (byte_index + 1 >= BYTES_PER_SAMPLE) begin
                        if (sample_index + 1 >= DEPTH) dump_state <= D_FOOTER;
                        else begin
                            sample_index <= sample_index + 1'b1;
                            dump_address <= dump_address + 1'b1;
                            dump_state <= D_LOAD;
                        end
                    end else byte_index <= byte_index + 1'b1;
                end
                D_FOOTER: if (!tx_valid && tx_ready) begin
                    tx_data <= 8'h45;
                    tx_valid <= 1'b1;
                    dump_state <= D_IDLE;
                end
                default: dump_state <= D_IDLE;
            endcase
        end
    end
endmodule

module fpga_studio_analyzer_uart_rx #(
    parameter integer CLOCK_HZ = 27_000_000,
    parameter integer BAUD_RATE = 115_200
) (
    input wire clk, input wire rst_n, input wire rx_i,
    output logic [7:0] data_o, output logic valid_o, output logic framing_error_o
);
    localparam integer CLKS_PER_BIT = (CLOCK_HZ + BAUD_RATE / 2) / BAUD_RATE;
    localparam integer COUNT_WIDTH = (CLKS_PER_BIT <= 1) ? 1 : $clog2(CLKS_PER_BIT);
    localparam logic [COUNT_WIDTH-1:0] HALF_COUNT = COUNT_WIDTH'((CLKS_PER_BIT / 2) - 1);
    localparam logic [COUNT_WIDTH-1:0] LAST_COUNT = COUNT_WIDTH'(CLKS_PER_BIT - 1);
    typedef enum logic [1:0] {IDLE, START, DATA, STOP} state_t;
    state_t state;
    logic [COUNT_WIDTH-1:0] count;
    logic [2:0] bit_index;
    logic [7:0] shift;
    always_ff @(posedge clk) begin
        if (!rst_n) begin state <= IDLE; count <= '0; bit_index <= '0; shift <= '0; data_o <= '0; valid_o <= 1'b0; framing_error_o <= 1'b0; end
        else begin
            valid_o <= 1'b0; framing_error_o <= 1'b0;
            case (state)
                IDLE: begin count <= '0; bit_index <= '0; if (!rx_i) state <= START; end
                START: if (count == HALF_COUNT) begin count <= '0; if (rx_i) state <= IDLE; else state <= DATA; end else count <= count + 1'b1;
                DATA: if (count == LAST_COUNT) begin count <= '0; shift[bit_index] <= rx_i; if (bit_index == 3'd7) begin bit_index <= '0; state <= STOP; end else bit_index <= bit_index + 1'b1; end else count <= count + 1'b1;
                STOP: if (count == LAST_COUNT) begin count <= '0; state <= IDLE; if (rx_i) begin data_o <= shift; valid_o <= 1'b1; end else framing_error_o <= 1'b1; end else count <= count + 1'b1;
                default: state <= IDLE;
            endcase
        end
    end
endmodule

module fpga_studio_analyzer_uart_tx #(
    parameter integer CLOCK_HZ = 27_000_000,
    parameter integer BAUD_RATE = 115_200
) (
    input wire clk, input wire rst_n, input wire [7:0] data_i, input wire valid_i,
    output wire ready_o, output wire tx_o
);
    localparam integer CLKS_PER_BIT = (CLOCK_HZ + BAUD_RATE / 2) / BAUD_RATE;
    localparam integer COUNT_WIDTH = (CLKS_PER_BIT <= 1) ? 1 : $clog2(CLKS_PER_BIT);
    localparam logic [COUNT_WIDTH-1:0] LAST_COUNT = COUNT_WIDTH'(CLKS_PER_BIT - 1);
    logic [COUNT_WIDTH-1:0] count;
    logic [3:0] bit_index;
    logic [9:0] frame;
    logic busy;
    assign ready_o = ~busy;
    assign tx_o = busy ? frame[bit_index] : 1'b1;
    always_ff @(posedge clk) begin
        if (!rst_n) begin count <= '0; bit_index <= '0; frame <= 10'h3ff; busy <= 1'b0; end
        else if (!busy) begin count <= '0; bit_index <= '0; if (valid_i) begin frame <= {1'b1, data_i, 1'b0}; busy <= 1'b1; end end
        else if (count == LAST_COUNT) begin count <= '0; if (bit_index == 4'd9) begin bit_index <= '0; busy <= 1'b0; end else bit_index <= bit_index + 1'b1; end
        else count <= count + 1'b1;
    end
endmodule

`default_nettype wire
"#
}

#[cfg(test)]
mod tests {
    use super::{
        analyzer_cost, decode_capture, discover_signals_at, generate_at, parse_trigger_value,
        trigger_vectors, validate_config, CONFIG_SCHEMA,
    };
    use crate::models::{
        AnalyzerChannelConfig, AnalyzerConfig, AnalyzerTrigger, AnalyzerTriggerClause,
        EvidenceClass,
    };
    use std::fs;
    use std::path::Path;

    fn config() -> AnalyzerConfig {
        AnalyzerConfig {
            schema_version: 1,
            clock_signal: "clk".into(),
            clock_hz: 27_000_000,
            transport_rx: "rx".into(),
            transport_tx: "tx".into(),
            baud_rate: 115_200,
            sample_depth: 64,
            pre_trigger_samples: 32,
            channels: vec![
                AnalyzerChannelConfig {
                    id: 0,
                    signal: "state".into(),
                    width: 2,
                    radix: "hex".into(),
                },
                AnalyzerChannelConfig {
                    id: 1,
                    signal: "valid".into(),
                    width: 1,
                    radix: "binary".into(),
                },
            ],
            trigger: AnalyzerTrigger {
                combinator: "and".into(),
                clauses: vec![
                    AnalyzerTriggerClause {
                        channel_id: 0,
                        operation: "compare".into(),
                        value: "0b10".into(),
                    },
                    AnalyzerTriggerClause {
                        channel_id: 1,
                        operation: "rising".into(),
                        value: "1".into(),
                    },
                ],
            },
        }
    }

    #[test]
    fn trigger_values_are_bounded_by_channel_width() {
        assert_eq!(parse_trigger_value("0xA", 4).expect("value"), 10);
        assert!(parse_trigger_value("0x10", 4).is_err());
        let vectors = trigger_vectors(&config()).expect("vectors");
        assert_eq!(vectors.0, "3");
        assert_eq!(vectors.1, "2");
        assert_eq!(vectors.2, "4");
    }

    #[test]
    fn sample_decoder_preserves_channel_order_and_transitions() {
        let directory =
            std::env::temp_dir().join(format!("analyzer-decode-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(directory.join("rtl")).expect("rtl");
        fs::write(directory.join("rtl/top.sv"), "module top; endmodule\n").expect("source");
        let payload = (0..64)
            .map(|index| if index < 32 { 0b001 } else { 0b110 })
            .collect::<Vec<_>>();
        let capture = decode_capture(&directory, &config(), 32, &payload).expect("capture");
        assert_eq!(capture.waveform.signals.len(), 2);
        assert_eq!(capture.waveform.signals[0].samples.len(), 2);
        assert_eq!(capture.waveform.signals[0].samples[1].value, "10");
        assert_eq!(capture.waveform.signals[1].samples[1].value, "1");
        fs::remove_dir_all(directory).expect("remove temporary directory");
    }

    #[test]
    fn resource_estimator_is_explicit_until_reports_exist() {
        let directory =
            std::env::temp_dir().join(format!("analyzer-cost-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("project");
        let cost = analyzer_cost(&directory, &config());
        assert_eq!(cost.source, EvidenceClass::Estimated);
        assert_eq!(cost.lut, 46);
        assert_eq!(cost.ff, 86);
        assert_eq!(cost.bram, 1);
        assert!(cost.instrumented_fmax_m_hz.is_none());
        fs::remove_dir_all(directory).expect("remove temporary directory");
    }

    #[test]
    #[ignore = "uses maintained project build artifacts and is run by the release validation job"]
    fn generates_maintained_uart_analyzer_fixture() {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("workspace root");
        let project = workspace.join("projects/05_serial_command_console");
        let signals = discover_signals_at(workspace, &project).expect("discover synthesized nets");
        let signal = signals
            .iter()
            .find(|signal| signal.hierarchy == "command_buffer")
            .expect("command buffer net");
        let config = AnalyzerConfig {
            schema_version: CONFIG_SCHEMA,
            clock_signal: "clk_27mhz".into(),
            clock_hz: 27_000_000,
            transport_rx: "uart_rx".into(),
            transport_tx: "uart_tx".into(),
            baud_rate: 115_200,
            sample_depth: 64,
            pre_trigger_samples: 32,
            channels: vec![AnalyzerChannelConfig {
                id: 0,
                signal: signal.hierarchy.clone(),
                width: signal.width,
                radix: "hex".into(),
            }],
            trigger: AnalyzerTrigger {
                combinator: "and".into(),
                clauses: vec![AnalyzerTriggerClause {
                    channel_id: 0,
                    operation: "compare".into(),
                    value: "0".into(),
                }],
            },
        };
        validate_config(&project, &config, &signals).expect("valid fixture");
        generate_at(&project, &config, &signals).expect("generate instrumentation");
    }
}
