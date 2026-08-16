use crate::models::{
    ClockDomain, Diagnostic, DiagnosticSeverity, HdlIndex, HdlInstance, HdlModule, HdlSignal,
    HdlSymbol,
};
use crate::security::{canonical_workspace, safe_existing_path};
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_HDL_FILES: usize = 500;
const MAX_HDL_BYTES: u64 = 2 * 1024 * 1024;

pub fn index(root: &str, project: &str) -> Result<HdlIndex, String> {
    let root = canonical_workspace(root)?;
    let project = safe_existing_path(&root, project)?;
    let mut source_paths = Vec::new();
    collect_sources(&project.join("rtl"), &mut source_paths)?;
    source_paths.sort();
    if source_paths.len() > MAX_HDL_FILES {
        return Err(format!(
            "This project contains {} HDL files; the live intelligence limit is {MAX_HDL_FILES}",
            source_paths.len()
        ));
    }

    let top = configured_top(&project);
    let mut files = Vec::new();
    let mut symbols = Vec::new();
    let mut diagnostics = Vec::new();
    let mut modules = Vec::new();
    let mut instances = Vec::new();
    let mut clock_domains = Vec::new();
    let mut signals = Vec::new();
    let mut module_declarations = HashMap::<String, HdlSymbol>::new();

    for path in source_paths {
        let relative = path
            .strip_prefix(&root)
            .map_err(|_| "HDL source escaped the workspace")?
            .to_string_lossy()
            .replace('\\', "/");
        files.push(relative.clone());
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
        if metadata.len() > MAX_HDL_BYTES {
            diagnostics.push(diagnostic(
                DiagnosticSeverity::Warning,
                "HDL004",
                "File exceeds the 2 MiB live-intelligence limit",
                "Split generated or very large sources into smaller files, or rely on the full lint tool for this file.",
                Some(relative),
                Some(1),
                Some(1),
            ));
            continue;
        }

        let content = fs::read_to_string(&path)
            .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        let clean = sanitize(&content);
        let file_modules = parse_modules(&clean, &relative);
        let file_instances = parse_instances(&clean, &relative, &file_modules);
        let file_domains = parse_clock_domains(&clean, &relative, &file_modules);
        signals.extend(parse_hdl_signals(&clean, &relative, &file_modules));

        for module in &file_modules {
            let symbol = HdlSymbol {
                name: module.name.clone(),
                kind: "module".into(),
                file: module.file.clone(),
                line: module.line,
                column: 1,
                detail: format!("SystemVerilog module with {} port(s)", module.ports.len()),
            };
            if let Some(previous) = module_declarations.get(&module.name) {
                diagnostics.push(diagnostic(
                    DiagnosticSeverity::Error,
                    "HDL001",
                    &format!(
                        "Module '{}' is declared more than once (first at {}:{})",
                        module.name, previous.file, previous.line
                    ),
                    "Rename one module or remove the duplicate source from rtl/.",
                    Some(module.file.clone()),
                    Some(module.line),
                    Some(1),
                ));
            } else {
                module_declarations.insert(module.name.clone(), symbol.clone());
            }
            symbols.push(symbol);
        }
        symbols.extend(parse_declaration_symbols(&clean, &relative));
        symbols.extend(file_instances.iter().map(|instance| HdlSymbol {
            name: instance.instance_name.clone(),
            kind: "instance".into(),
            file: instance.file.clone(),
            line: instance.line,
            column: 1,
            detail: format!("Instance of {}", instance.module_name),
        }));
        diagnostics.extend(analyze_source(&clean, &relative));
        modules.extend(file_modules);
        instances.extend(file_instances);
        clock_domains.extend(file_domains);
    }

    if files.is_empty() {
        diagnostics.push(diagnostic(
            DiagnosticSeverity::Error,
            "HDL002",
            "No Verilog or SystemVerilog files were found under rtl/",
            "Add a .v or .sv source file under the project's rtl directory.",
            None,
            None,
            None,
        ));
    } else if !module_declarations.contains_key(&top) {
        diagnostics.push(diagnostic(
            DiagnosticSeverity::Error,
            "HDL003",
            &format!("Configured top module '{top}' was not found"),
            "Set Top in fpga.config.psd1 to an existing module, or add the missing module.",
            Some(
                project
                    .join("fpga.config.psd1")
                    .strip_prefix(&root)
                    .unwrap_or(Path::new("fpga.config.psd1"))
                    .to_string_lossy()
                    .replace('\\', "/"),
            ),
            Some(1),
            Some(1),
        ));
    }

    symbols.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.file.cmp(&right.file))
            .then_with(|| left.line.cmp(&right.line))
    });
    diagnostics.sort_by(|left, right| {
        left.file
            .cmp(&right.file)
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.code.cmp(&right.code))
    });
    modules.sort_by(|left, right| left.name.cmp(&right.name).then(left.file.cmp(&right.file)));
    instances.sort_by(|left, right| {
        left.parent_module
            .cmp(&right.parent_module)
            .then(left.instance_name.cmp(&right.instance_name))
    });
    clock_domains.sort_by(|left, right| {
        left.module_name
            .cmp(&right.module_name)
            .then(left.clock.cmp(&right.clock))
    });
    clock_domains.dedup_by(|left, right| {
        left.module_name == right.module_name
            && left.clock == right.clock
            && left.edge == right.edge
            && left.reset == right.reset
            && left.file == right.file
    });
    signals.sort_by(|left, right| {
        left.hierarchy
            .cmp(&right.hierarchy)
            .then(left.name.cmp(&right.name))
            .then(left.line.cmp(&right.line))
    });
    signals.dedup_by(|left, right| {
        left.module_name == right.module_name
            && left.name == right.name
            && left.file == right.file
            && left.line == right.line
    });

    Ok(HdlIndex {
        top,
        files,
        symbols,
        diagnostics,
        modules,
        instances,
        clock_domains,
        signals,
    })
}

fn diagnostic(
    severity: DiagnosticSeverity,
    code: &str,
    message: &str,
    suggestion: &str,
    file: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
) -> Diagnostic {
    Diagnostic {
        severity,
        source: "hdl-intelligence".into(),
        message: message.into(),
        code: Some(code.into()),
        suggestion: Some(suggestion.into()),
        file,
        line,
        column,
    }
}

fn analyze_source(content: &str, file: &str) -> Vec<Diagnostic> {
    let mut result = Vec::new();
    let word = Regex::new(r"[A-Za-z_]\w*").expect("identifier regex");
    let internal = Regex::new(
        r"(?m)^\s*(logic|wire|reg)\s+(?:signed\s+|unsigned\s+)?(?:\[\s*(\d+)\s*:\s*(\d+)\s*\]\s*)?([^;\n]+);",
    )
    .expect("internal declaration regex");
    let mut widths = HashMap::<String, usize>::new();
    for captures in internal.captures_iter(content) {
        let width = captures
            .get(2)
            .and_then(|upper| upper.as_str().parse::<i64>().ok())
            .zip(
                captures
                    .get(3)
                    .and_then(|lower| lower.as_str().parse::<i64>().ok()),
            )
            .map_or(1, |(upper, lower)| {
                (upper - lower).unsigned_abs() as usize + 1
            });
        let Some(names) = captures.get(4) else {
            continue;
        };
        for part in names.as_str().split(',') {
            let Some(identifier) = word.find(part.trim()) else {
                continue;
            };
            let name = identifier.as_str();
            widths.insert(name.into(), width);
            let uses = Regex::new(&format!(r"\b{}\b", regex::escape(name)))
                .expect("escaped identifier")
                .find_iter(content)
                .count();
            if uses == 1 {
                let offset = names.start() + part.find(name).unwrap_or(0);
                let (line, column) = position(content, offset);
                result.push(diagnostic(
                    DiagnosticSeverity::Warning,
                    "HDL101",
                    &format!("Internal signal '{name}' is declared but never used"),
                    "Remove the signal or connect it to the intended logic.",
                    Some(file.into()),
                    Some(line),
                    Some(column),
                ));
            }
        }
    }

    let assign = Regex::new(r"(?m)\bassign\s+([A-Za-z_]\w*)\s*=\s*([^;]+);")
        .expect("continuous assignment regex");
    let literal =
        Regex::new(r"(?i)^\s*(\d+)'s?[bodh][0-9a-f_xz?]+\s*$").expect("sized literal regex");
    let mut drivers = HashMap::<String, Vec<usize>>::new();
    for captures in assign.captures_iter(content) {
        let Some(target) = captures.get(1) else {
            continue;
        };
        let Some(expression) = captures.get(2) else {
            continue;
        };
        drivers
            .entry(target.as_str().into())
            .or_default()
            .push(target.start());
        let target_word =
            Regex::new(&format!(r"\b{}\b", regex::escape(target.as_str()))).expect("target regex");
        if target_word.is_match(expression.as_str()) {
            let (line, column) = position(content, target.start());
            result.push(diagnostic(
                DiagnosticSeverity::Error,
                "HDL104",
                &format!("Combinational assignment to '{}' depends on itself", target.as_str()),
                "Break the combinational loop with registered state or correct the expression source.",
                Some(file.into()),
                Some(line),
                Some(column),
            ));
        }
        if let (Some(target_width), Some(literal_match)) = (
            widths.get(target.as_str()),
            literal.captures(expression.as_str()),
        ) {
            let literal_width = literal_match
                .get(1)
                .and_then(|value| value.as_str().parse::<usize>().ok())
                .unwrap_or(0);
            if literal_width > *target_width {
                let (line, column) = position(content, target.start());
                result.push(diagnostic(
                    DiagnosticSeverity::Warning,
                    "HDL103",
                    &format!(
                        "{}-bit literal is truncated when assigned to {}-bit '{}'",
                        literal_width,
                        target_width,
                        target.as_str()
                    ),
                    "Resize the destination or use a literal whose declared width matches it.",
                    Some(file.into()),
                    Some(line),
                    Some(column),
                ));
            }
        }
    }
    for (target, locations) in drivers {
        if locations.len() > 1 {
            let (line, column) = position(content, locations[1]);
            result.push(diagnostic(
                DiagnosticSeverity::Error,
                "HDL102",
                &format!(
                    "Signal '{target}' has {} continuous drivers",
                    locations.len()
                ),
                "Drive this signal from one assignment and combine the source conditions there.",
                Some(file.into()),
                Some(line),
                Some(column),
            ));
        }
    }

    result.extend(reset_polarity_diagnostics(content, file));
    let generated = Regex::new(
        r"(?m)\b([A-Za-z_]\w*(?:clk|clock)[A-Za-z_0-9]*)\s*(?:<=|=)\s*~\s*([A-Za-z_]\w*)\b",
    )
    .expect("generated clock regex");
    for captures in generated.captures_iter(content) {
        let Some(signal) = captures.get(1) else {
            continue;
        };
        if captures.get(2).map(|value| value.as_str()) != Some(signal.as_str()) {
            continue;
        }
        let (line, column) = position(content, signal.start());
        result.push(diagnostic(
                DiagnosticSeverity::Warning,
                "HDL106",
                &format!("Signal '{}' is used as a logic-generated clock", signal.as_str()),
                "Prefer the board clock with a clock-enable pulse; generated clocks complicate timing and clock-domain analysis.",
                Some(file.into()),
                Some(line),
                Some(column),
            ));
    }
    result
}

fn reset_polarity_diagnostics(content: &str, file: &str) -> Vec<Diagnostic> {
    let block =
        Regex::new(r"(?s)always_(?:ff|latch)\s*@\s*\(([^)]*)\)").expect("always sensitivity regex");
    let event = Regex::new(r"\b(posedge|negedge)\s+([A-Za-z_]\w*)").expect("event regex");
    let mut result = Vec::new();
    for captures in block.captures_iter(content) {
        let Some(sensitivity) = captures.get(1) else {
            continue;
        };
        let events: Vec<_> = event.captures_iter(sensitivity.as_str()).collect();
        for reset_event in events.iter().skip(1) {
            let edge = reset_event.get(1).map_or("", |value| value.as_str());
            let reset = reset_event.get(2).map_or("", |value| value.as_str());
            if !reset.to_ascii_lowercase().contains("reset")
                && !reset.to_ascii_lowercase().contains("rst")
            {
                continue;
            }
            let tail_start = captures.get(0).map_or(0, |value| value.end());
            let tail_end = (tail_start + 500).min(content.len());
            let tail = &content[tail_start..tail_end];
            let condition = Regex::new(&format!(
                r"\bif\s*\(\s*(!?)\s*{}\s*\)",
                regex::escape(reset)
            ))
            .expect("reset condition regex");
            if let Some(condition) = condition.captures(tail) {
                let negated = condition.get(1).is_some_and(|value| value.as_str() == "!");
                let matches_edge =
                    (edge == "negedge" && negated) || (edge == "posedge" && !negated);
                if !matches_edge {
                    let location =
                        sensitivity.start() + reset_event.get(2).map_or(0, |value| value.start());
                    let (line, column) = position(content, location);
                    result.push(diagnostic(
                        DiagnosticSeverity::Error,
                        "HDL105",
                        &format!(
                            "Reset '{reset}' uses {edge} sensitivity but the reset condition has the opposite polarity"
                        ),
                        "Make the sensitivity edge and reset condition agree (negedge with !reset, or posedge with reset).",
                        Some(file.into()),
                        Some(line),
                        Some(column),
                    ));
                }
            }
        }
    }
    result
}

fn parse_modules(content: &str, file: &str) -> Vec<HdlModule> {
    let module = Regex::new(r"(?m)^\s*module\s+([A-Za-z_]\w*)").expect("module regex");
    let endmodule = Regex::new(r"(?m)^\s*endmodule\b").expect("endmodule regex");
    let port = Regex::new(
        r"\b(?:input|output|inout)\b\s*(?:wire\s+|reg\s+|logic\s+)?(?:signed\s+|unsigned\s+)?(?:\[[^\]]+\]\s*)?([A-Za-z_]\w*)",
    )
    .expect("port regex");
    let starts: Vec<_> = module.captures_iter(content).collect();
    let mut result = Vec::new();
    for (index, captures) in starts.iter().enumerate() {
        let Some(name) = captures.get(1) else {
            continue;
        };
        let start = captures.get(0).map_or(0, |value| value.start());
        let next_start = starts
            .get(index + 1)
            .and_then(|next| next.get(0))
            .map_or(content.len(), |value| value.start());
        let end = endmodule
            .find_at(content, name.end())
            .filter(|value| value.start() < next_start)
            .map_or(next_start, |value| value.end());
        let header_end = content[name.end()..end]
            .find(';')
            .map_or(end, |offset| name.end() + offset);
        let ports = port
            .captures_iter(&content[name.end()..header_end])
            .filter_map(|capture| capture.get(1).map(|value| value.as_str().into()))
            .collect();
        let (line, _) = position(content, name.start());
        result.push(HdlModule {
            name: name.as_str().into(),
            file: file.into(),
            line,
            ports,
        });
        let _ = start;
    }
    result
}

fn parse_instances(content: &str, file: &str, modules: &[HdlModule]) -> Vec<HdlInstance> {
    let instance =
        Regex::new(r"(?m)^\s*([A-Za-z_]\w*)\s*(?:#\s*\([^;]*?\)\s*)?([A-Za-z_]\w*)\s*\(")
            .expect("instance regex");
    let keywords: HashSet<&str> = [
        "module",
        "if",
        "else",
        "for",
        "foreach",
        "while",
        "case",
        "casex",
        "casez",
        "function",
        "task",
        "always",
        "always_ff",
        "always_comb",
        "initial",
        "assert",
        "cover",
        "property",
        "generate",
    ]
    .into_iter()
    .collect();
    let module_pattern = Regex::new(r"(?m)^\s*module\s+").expect("module keyword regex");
    let module_offsets: Vec<(usize, String)> = module_pattern
        .find_iter(content)
        .zip(modules.iter())
        .map(|(found, module)| (found.start(), module.name.clone()))
        .collect();
    instance
        .captures_iter(content)
        .filter_map(|captures| {
            let type_name = captures.get(1)?;
            let instance_name = captures.get(2)?;
            if keywords.contains(type_name.as_str()) {
                return None;
            }
            let parent_module = module_offsets
                .iter()
                .rev()
                .find(|(offset, _)| *offset <= type_name.start())
                .map(|(_, name)| name.clone())?;
            let (line, _) = position(content, instance_name.start());
            Some(HdlInstance {
                parent_module,
                module_name: type_name.as_str().into(),
                instance_name: instance_name.as_str().into(),
                file: file.into(),
                line,
            })
        })
        .collect()
}

fn parse_clock_domains(content: &str, file: &str, modules: &[HdlModule]) -> Vec<ClockDomain> {
    let block =
        Regex::new(r"(?s)\b(?:always_ff|always)\s*@\s*\(([^)]*)\)").expect("clock block regex");
    let event = Regex::new(r"\b(posedge|negedge)\s+([A-Za-z_]\w*)").expect("clock event regex");
    let module_pattern = Regex::new(r"(?m)^\s*module\s+").expect("module keyword regex");
    let module_offsets: Vec<(usize, String)> = module_pattern
        .find_iter(content)
        .zip(modules.iter())
        .map(|(found, module)| (found.start(), module.name.clone()))
        .collect();
    block
        .captures_iter(content)
        .filter_map(|captures| {
            let sensitivity = captures.get(1)?;
            let mut events = event.captures_iter(sensitivity.as_str());
            let clock = events.next()?;
            let clock_edge = clock.get(1)?.as_str();
            let clock_name = clock.get(2)?.as_str();
            let reset = events.find_map(|candidate| {
                let name = candidate.get(2)?.as_str();
                let lower = name.to_ascii_lowercase();
                (lower.contains("rst") || lower.contains("reset")).then(|| name.into())
            });
            let offset = captures.get(0)?.start();
            let module_name = module_offsets
                .iter()
                .rev()
                .find(|(module_offset, _)| *module_offset <= offset)
                .map(|(_, name)| name.clone())?;
            let (line, _) = position(content, offset);
            Some(ClockDomain {
                module_name,
                clock: clock_name.into(),
                edge: clock_edge.into(),
                reset,
                file: file.into(),
                line,
            })
        })
        .collect()
}

fn parse_declaration_symbols(content: &str, file: &str) -> Vec<HdlSymbol> {
    let declaration = Regex::new(
        r"(?m)^\s*(input|output|inout|logic|wire|reg|parameter|localparam)\b([^;\n]*)(?:;|,|\))",
    )
    .expect("declaration regex");
    let identifier = Regex::new(r"[A-Za-z_]\w*").expect("identifier regex");
    let ignored = [
        "logic",
        "wire",
        "reg",
        "signed",
        "unsigned",
        "input",
        "output",
        "inout",
        "parameter",
        "localparam",
    ];
    let mut symbols = Vec::new();
    for captures in declaration.captures_iter(content) {
        let kind = captures.get(1).map_or("signal", |value| value.as_str());
        let Some(body) = captures.get(2) else {
            continue;
        };
        for value in identifier.find_iter(body.as_str()) {
            if ignored.contains(&value.as_str()) || value.as_str().chars().all(char::is_numeric) {
                continue;
            }
            let offset = body.start() + value.start();
            let (line, column) = position(content, offset);
            symbols.push(HdlSymbol {
                name: value.as_str().into(),
                kind: kind.into(),
                file: file.into(),
                line,
                column,
                detail: format!("{kind} declaration"),
            });
        }
    }
    symbols
}

fn parse_hdl_signals(content: &str, file: &str, modules: &[HdlModule]) -> Vec<HdlSignal> {
    let declaration = Regex::new(
        r"(?m)^\s*(input|output|inout|logic|wire|reg)\b\s*(?:(?:logic|wire|reg|signed|unsigned)\b\s*)*(?:\[\s*(\d+)\s*:\s*(\d+)\s*\])?\s*([^;\n\)]+)(?:;|\)|$)",
    )
    .expect("signal declaration regex");
    let identifier = Regex::new(r"^([A-Za-z_]\w*)").expect("signal identifier regex");
    let mut result = Vec::new();
    for captures in declaration.captures_iter(content) {
        let Some(full) = captures.get(0) else {
            continue;
        };
        let (line, _) = position(content, full.start());
        let Some(module) = modules
            .iter()
            .filter(|module| module.line <= line)
            .max_by_key(|module| module.line)
        else {
            continue;
        };
        let kind = captures.get(1).map_or("signal", |value| value.as_str());
        let width = captures
            .get(2)
            .and_then(|msb| msb.as_str().parse::<i64>().ok())
            .zip(
                captures
                    .get(3)
                    .and_then(|lsb| lsb.as_str().parse::<i64>().ok()),
            )
            .map_or(1, |(msb, lsb)| (msb - lsb).unsigned_abs() as u32 + 1);
        let Some(names) = captures.get(4) else {
            continue;
        };
        for raw in names.as_str().split(',') {
            let candidate = raw.trim().split('=').next().unwrap_or("").trim();
            let Some(name) = identifier
                .captures(candidate)
                .and_then(|value| value.get(1))
            else {
                continue;
            };
            let offset = names.start() + raw.find(name.as_str()).unwrap_or(0);
            let (signal_line, column) = position(content, offset);
            result.push(HdlSignal {
                id: format!("rtl:{}:{}", module.name, name.as_str()),
                name: name.as_str().into(),
                module_name: module.name.clone(),
                hierarchy: module.name.clone(),
                width,
                kind: kind.into(),
                file: file.into(),
                line: signal_line,
                column,
                observable: false,
                unavailable_reason: Some(
                    "Run Build to prove that this signal survives synthesis and can be instrumented."
                        .into(),
                ),
            });
        }
    }
    result
}

fn sanitize(content: &str) -> String {
    let bytes = content.as_bytes();
    let mut output = bytes.to_vec();
    let mut index = 0;
    while index < bytes.len() {
        if index + 1 < bytes.len() && bytes[index] == b'/' && bytes[index + 1] == b'/' {
            output[index] = b' ';
            output[index + 1] = b' ';
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                output[index] = b' ';
                index += 1;
            }
        } else if index + 1 < bytes.len() && bytes[index] == b'/' && bytes[index + 1] == b'*' {
            output[index] = b' ';
            output[index + 1] = b' ';
            index += 2;
            while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                if bytes[index] != b'\n' {
                    output[index] = b' ';
                }
                index += 1;
            }
            if index + 1 < bytes.len() {
                output[index] = b' ';
                output[index + 1] = b' ';
                index += 2;
            }
        } else if bytes[index] == b'"' {
            output[index] = b' ';
            index += 1;
            while index < bytes.len() {
                let escaped = index > 0 && bytes[index - 1] == b'\\';
                if bytes[index] != b'\n' {
                    output[index] = b' ';
                }
                if bytes[index] == b'"' && !escaped {
                    index += 1;
                    break;
                }
                index += 1;
            }
        } else {
            index += 1;
        }
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn collect_sources(directory: &Path, result: &mut Vec<PathBuf>) -> Result<(), String> {
    if !directory.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Cannot list {}: {error}", directory.display()))?
    {
        let entry = entry.map_err(|error| format!("Cannot read HDL directory entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Cannot inspect HDL entry: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_sources(&entry.path(), result)?;
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

fn configured_top(project: &Path) -> String {
    let content = fs::read_to_string(project.join("fpga.config.psd1")).unwrap_or_default();
    Regex::new(r#"(?m)^\s*Top\s*=\s*['\"]([A-Za-z_]\w*)['\"]"#)
        .expect("top regex")
        .captures(&content)
        .and_then(|captures| captures.get(1))
        .map_or_else(|| "top".into(), |value| value.as_str().to_owned())
}

fn position(content: &str, offset: usize) -> (u32, u32) {
    let prefix = &content[..offset];
    let line = prefix.bytes().filter(|value| *value == b'\n').count() as u32 + 1;
    let column = prefix
        .rsplit_once('\n')
        .map_or(prefix.len(), |(_, tail)| tail.len()) as u32
        + 1;
    (line, column)
}

#[cfg(test)]
mod tests {
    use super::index;
    use std::fs;

    fn project(source: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("fpga-studio-hdl-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("rtl")).expect("rtl");
        fs::write(root.join("fpga.ps1"), "# marker").expect("marker");
        fs::write(root.join("fpga.config.psd1"), "@{ Top = 'top' }").expect("config");
        fs::write(root.join("rtl/top.sv"), source).expect("top");
        root
    }

    #[test]
    fn indexes_hierarchy_clocks_and_clean_design() {
        let root = project(
            "module top(input logic clk, input logic rst_n, output logic led);\nlogic state;\nchild u_child(.clk(clk));\nalways_ff @(posedge clk or negedge rst_n) begin\n if (!rst_n) state <= 1'b0; else state <= ~state;\nend\nassign led = state;\nendmodule\nmodule child(input logic clk); endmodule\n",
        );
        let result = index(&root.to_string_lossy(), ".").expect("index");
        assert!(result
            .instances
            .iter()
            .any(|item| item.instance_name == "u_child"));
        assert!(result
            .clock_domains
            .iter()
            .any(|item| item.clock == "clk" && item.reset.as_deref() == Some("rst_n")));
        assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reports_definite_static_design_problems() {
        let root = project(
            "module top(input logic clk, input logic rst_n, output logic led);\nlogic unused;\nlogic [3:0] narrow;\nwire looped;\nassign led = 1'b0;\nassign led = 1'b1;\nassign narrow = 8'hff;\nassign looped = ~looped;\nalways_ff @(posedge clk or negedge rst_n) begin if (rst_n) narrow <= 4'b0; end\nendmodule\n",
        );
        let result = index(&root.to_string_lossy(), ".").expect("index");
        for code in ["HDL101", "HDL102", "HDL103", "HDL104", "HDL105"] {
            assert!(
                result
                    .diagnostics
                    .iter()
                    .any(|item| item.code.as_deref() == Some(code)),
                "missing {code}: {:?}",
                result.diagnostics
            );
        }
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn ignores_problem_like_text_in_comments_and_strings() {
        let root = project(
            "module top(input logic clk, output logic led);\n// assign led = led;\ninitial $display(\"assign led = led;\");\nassign led = clk;\nendmodule\n",
        );
        let result = index(&root.to_string_lossy(), ".").expect("index");
        assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reports_duplicate_modules() {
        let root = project("module top; endmodule\nmodule top; endmodule\n");
        let result = index(&root.to_string_lossy(), ".").expect("index");
        assert!(result
            .diagnostics
            .iter()
            .any(|item| item.code.as_deref() == Some("HDL001")));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reports_empty_and_oversized_projects_without_panicking() {
        let empty =
            std::env::temp_dir().join(format!("fpga-studio-empty-hdl-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&empty).expect("empty project");
        fs::write(empty.join("fpga.ps1"), "# marker").expect("marker");
        let empty_result = index(&empty.to_string_lossy(), ".").expect("empty index");
        assert!(empty_result
            .diagnostics
            .iter()
            .any(|item| item.code.as_deref() == Some("HDL002")));
        fs::remove_dir_all(empty).expect("empty cleanup");

        let large = project(&format!(
            "module top; endmodule\n// {}",
            "x".repeat((super::MAX_HDL_BYTES + 1) as usize)
        ));
        let large_result = index(&large.to_string_lossy(), ".").expect("large index");
        assert!(large_result
            .diagnostics
            .iter()
            .any(|item| item.code.as_deref() == Some("HDL004")));
        fs::remove_dir_all(large).expect("large cleanup");
    }

    #[test]
    fn maintained_projects_have_no_blocking_live_findings() {
        let workspace = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .expect("repository workspace");
        for project in [
            "projects/01_button_led_pwm",
            "projects/03_uart_terminal",
            "projects/05_serial_command_console",
            "projects/_template",
        ] {
            let result = index(&workspace.to_string_lossy(), project).expect("maintained index");
            let errors: Vec<_> = result
                .diagnostics
                .iter()
                .filter(|item| matches!(item.severity, crate::models::DiagnosticSeverity::Error))
                .collect();
            assert!(errors.is_empty(), "{project}: {errors:?}");
        }
    }
}
