use crate::models::{WaveSample, WaveSignal, WaveformData};
use crate::security::{canonical_workspace, resolve_project_path, workspace_path_reference};
use std::collections::HashMap;
use std::fs;

const MAX_VCD_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SIGNALS: usize = 1_000;
const MAX_SAMPLES: usize = 100_000;

pub fn read(root: &str, project: &str) -> Result<WaveformData, String> {
    let root = canonical_workspace(root)?;
    let project = resolve_project_path(&root, project)?;
    let path = project.join("build/waves.vcd");
    let metadata = fs::metadata(&path)
        .map_err(|_| "No waveform exists yet. Run simulation first.".to_owned())?;
    if metadata.len() > MAX_VCD_BYTES {
        return Err(format!("Waveform is {} MiB; the responsive integrated-viewer limit is 64 MiB. Open it in GTKWave instead.", metadata.len() / 1024 / 1024));
    }
    let content =
        fs::read_to_string(&path).map_err(|error| format!("Cannot read waveform: {error}"))?;
    parse(&content, workspace_path_reference(&root, &path))
}

fn parse(content: &str, path: String) -> Result<WaveformData, String> {
    let mut scopes = Vec::<String>::new();
    let mut signals = Vec::<WaveSignal>::new();
    // VCD aliases intentionally reuse an identifier in multiple scopes. Keep every
    // declaration synchronized instead of silently assigning changes to the last one.
    let mut indexes = HashMap::<String, Vec<usize>>::new();
    let mut time = 0_u64;
    let mut end_time = 0_u64;
    let mut timescale = "unknown".to_owned();
    let mut samples = 0_usize;
    let mut truncated = false;
    let mut lines = content.lines().peekable();
    while let Some(line) = lines.next() {
        let line = line.trim();
        if line.starts_with("$timescale") {
            let mut value = line
                .trim_start_matches("$timescale")
                .replace("$end", "")
                .trim()
                .to_owned();
            while value.is_empty() {
                let Some(next) = lines.next() else { break };
                value = next.replace("$end", "").trim().to_owned();
            }
            if !value.is_empty() {
                timescale = value;
            }
        } else if line.starts_with("$scope") {
            let parts = line.split_whitespace().collect::<Vec<_>>();
            if let Some(name) = parts.get(2) {
                scopes.push((*name).to_owned());
            }
        } else if line.starts_with("$upscope") {
            scopes.pop();
        } else if line.starts_with("$var") && signals.len() < MAX_SIGNALS {
            let parts = line.split_whitespace().collect::<Vec<_>>();
            if parts.len() >= 5 {
                let width = parts[2].parse::<u32>().unwrap_or(1);
                let id = parts[3].to_owned();
                let mut name = parts[4].to_owned();
                if let Some(range) = parts.get(5).filter(|value| **value != "$end") {
                    name.push_str(range);
                }
                indexes.entry(id.clone()).or_default().push(signals.len());
                signals.push(WaveSignal {
                    id,
                    name,
                    scope: scopes.join("."),
                    width,
                    samples: Vec::new(),
                });
            }
        } else if let Some(value) = line.strip_prefix('#') {
            time = value
                .parse()
                .map_err(|_| format!("Invalid VCD timestamp '{line}'"))?;
            end_time = end_time.max(time);
        } else if !line.starts_with('$') && !line.is_empty() {
            let change =
                if let Some(vector) = line.strip_prefix('b').or_else(|| line.strip_prefix('B')) {
                    let mut parts = vector.split_whitespace();
                    parts
                        .next()
                        .zip(parts.next())
                        .map(|(value, id)| (id, value))
                } else {
                    let mut chars = line.chars();
                    chars
                        .next()
                        .map(|value| (chars.as_str(), &line[..value.len_utf8()]))
                };
            if let Some((id, value)) = change {
                if let Some(signal_indexes) = indexes.get(id) {
                    for &index in signal_indexes {
                        if samples >= MAX_SAMPLES {
                            truncated = true;
                        } else if signals[index]
                            .samples
                            .last()
                            .is_none_or(|previous| previous.value != value)
                        {
                            signals[index].samples.push(WaveSample {
                                time,
                                value: value.to_owned(),
                            });
                            samples += 1;
                        }
                    }
                }
            }
        }
    }
    if signals.is_empty() {
        return Err("Waveform contains no VCD signal declarations".into());
    }
    Ok(WaveformData {
        path,
        timescale,
        end_time,
        truncated,
        signals,
    })
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn parses_scopes_vectors_and_scalar_changes() {
        let vcd = "$timescale 1 ns $end\n$scope module tb $end\n$var wire 1 ! clk $end\n$var wire 4 # data [3:0] $end\n$upscope $end\n$enddefinitions $end\n#0\n0!\nb0000 #\n#5\n1!\nb1010 #\n#10\n0!\n";
        let result = parse(vcd, "build/waves.vcd".into()).expect("valid waveform");
        assert_eq!(result.timescale, "1 ns");
        assert_eq!(result.end_time, 10);
        assert_eq!(result.signals.len(), 2);
        assert_eq!(result.signals[1].name, "data[3:0]");
        assert_eq!(result.signals[1].samples[1].value, "1010");
    }

    #[test]
    fn keeps_aliased_signals_in_each_scope_synchronized() {
        let vcd = "$timescale 1 ns $end\n$scope module tb $end\n$var wire 1 ! clk $end\n$scope module dut $end\n$var wire 1 ! clk $end\n$upscope $end\n$upscope $end\n$enddefinitions $end\n#0\n0!\n#5\n1!\n";
        let result = parse(vcd, "build/waves.vcd".into()).expect("valid aliases");
        assert_eq!(result.signals.len(), 2);
        assert_eq!(result.signals[0].samples.len(), 2);
        assert_eq!(result.signals[1].samples.len(), 2);
        for (left, right) in result.signals[0]
            .samples
            .iter()
            .zip(&result.signals[1].samples)
        {
            assert_eq!(left.time, right.time);
            assert_eq!(left.value, right.value);
        }
    }
}
