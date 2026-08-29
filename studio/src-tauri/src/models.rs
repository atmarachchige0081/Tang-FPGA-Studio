use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNode {
    pub name: String,
    pub path: String,
    pub kind: NodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<ProjectNode>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    File,
    Directory,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub root: String,
    pub project: String,
    pub project_path: String,
    pub tree: Vec<ProjectNode>,
    pub recent_projects: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub level: String,
    pub category: String,
    pub base: String,
    #[serde(default)]
    pub overlay: Option<String>,
    pub hardware_ready: bool,
    pub tags: Vec<String>,
    #[serde(default)]
    pub supported_boards: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateCatalog {
    pub schema_version: u32,
    pub templates: Vec<ProjectTemplate>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdlPattern {
    pub title: String,
    pub category: String,
    pub difficulty: String,
    pub summary: String,
    pub code: String,
    pub aliases: Vec<String>,
    pub synthesizable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardClock {
    pub name: String,
    pub frequency_hz: u64,
    pub pin: String,
    #[serde(default)]
    pub io_standard: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardProgrammer {
    pub backend: String,
    pub board: String,
    pub transport: String,
    #[serde(default)]
    pub jtag_interface: Option<u8>,
    #[serde(default)]
    pub uart_interface: Option<u8>,
    #[serde(default)]
    pub usb_vid: Option<String>,
    #[serde(default)]
    pub usb_pid: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardBuild {
    pub backend: String,
    pub device_name: String,
    #[serde(default)]
    pub device_code: Option<String>,
    #[serde(default)]
    pub device_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardProfile {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub family: String,
    #[serde(default)]
    pub yosys_family: Option<String>,
    pub device: String,
    #[serde(default)]
    pub logic_cells: Option<u64>,
    #[serde(default)]
    pub build: Option<BoardBuild>,
    pub clocks: Vec<BoardClock>,
    pub programmer: BoardProgrammer,
    pub constraints: Vec<String>,
    #[serde(default)]
    pub timing_constraints: Vec<String>,
    #[serde(default)]
    pub documentation: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub available: bool,
    pub repository: bool,
    pub executable: Option<String>,
    pub version: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<GitChange>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub kind: String,
    pub entry: String,
    pub capabilities: Vec<String>,
    pub valid: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternCatalog {
    pub schema_version: u32,
    pub patterns: Vec<HdlPattern>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdlIndex {
    pub top: String,
    pub files: Vec<String>,
    pub symbols: Vec<HdlSymbol>,
    pub diagnostics: Vec<Diagnostic>,
    pub modules: Vec<HdlModule>,
    pub instances: Vec<HdlInstance>,
    pub clock_domains: Vec<ClockDomain>,
    pub signals: Vec<HdlSignal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdlSymbol {
    pub name: String,
    pub kind: String,
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdlModule {
    pub name: String,
    pub file: String,
    pub line: u32,
    pub ports: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdlInstance {
    pub parent_module: String,
    pub module_name: String,
    pub instance_name: String,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockDomain {
    pub module_name: String,
    pub clock: String,
    pub edge: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset: Option<String>,
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdlSignal {
    pub id: String,
    pub name: String,
    pub module_name: String,
    pub hierarchy: String,
    pub width: u32,
    pub kind: String,
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub observable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildAction {
    Doctor,
    Lint,
    Sim,
    Build,
    Upload,
    Flash,
    Detect,
    #[serde(rename = "analyzer-build")]
    AnalyzerBuild,
    #[serde(rename = "analyzer-upload")]
    AnalyzerUpload,
    Experiment,
}

impl BuildAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Doctor => "doctor",
            Self::Lint => "lint",
            Self::Sim => "sim",
            Self::Build => "build",
            Self::Upload => "upload",
            Self::Flash => "flash",
            Self::Detect => "detect",
            Self::AnalyzerBuild => "analyzer-build",
            Self::AnalyzerUpload => "analyzer-upload",
            Self::Experiment => "experiment",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub source: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildEvent {
    pub job_id: String,
    pub phase: String,
    pub stream: String,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub job_id: String,
    pub action: BuildAction,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub diagnostics: Vec<Diagnostic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSummary {
    pub status: String,
    pub fmax_m_hz: Option<f64>,
    pub target_m_hz: Option<f64>,
    pub lut_used: Option<u64>,
    pub lut_total: Option<u64>,
    pub registers_used: Option<u64>,
    pub registers_total: Option<u64>,
    pub bitstream_bytes: Option<u64>,
    pub worst_slack_ns: Option<f64>,
    pub updated_at: Option<String>,
    pub timing_met: Option<bool>,
    pub resources: Vec<ResourceUsage>,
    pub clocks: Vec<ClockTiming>,
    pub critical_paths: Vec<CriticalPath>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceUsage {
    pub name: String,
    pub label: String,
    pub used: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockTiming {
    pub name: String,
    pub achieved_m_hz: f64,
    pub constraint_m_hz: f64,
    pub slack_ns: f64,
    pub timing_met: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticalPath {
    pub source: String,
    pub destination: String,
    pub delay_ns: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slack_ns: Option<f64>,
    pub segments: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationSummary {
    pub generated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_updated_at: Option<String>,
    pub stages: Vec<VerificationStage>,
    pub passed: usize,
    pub warnings: usize,
    pub failed: usize,
    pub not_run: usize,
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationStage {
    pub id: String,
    pub label: String,
    pub status: VerificationStageStatus,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub artifacts: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VerificationStageStatus {
    Pass,
    Fail,
    Warning,
    NotRun,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareVerificationRecord {
    pub schema_version: u32,
    pub passed: bool,
    pub note: String,
    pub recorded_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitstream_updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildHistoryEntry {
    pub build_number: u64,
    pub action: BuildAction,
    pub success: bool,
    pub duration_ms: u128,
    pub completed_at: String,
    pub fmax_m_hz: Option<f64>,
    pub lut_used: Option<u64>,
    pub registers_used: Option<u64>,
    pub bitstream_bytes: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildHistoryFile {
    pub schema_version: u32,
    pub entries: Vec<BuildHistoryEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialDevice {
    pub port_name: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor_id: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_id: Option<u16>,
    pub likely_board: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialEvent {
    pub session_id: String,
    pub kind: String,
    pub data: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformData {
    pub path: String,
    pub timescale: String,
    pub end_time: u64,
    pub truncated: bool,
    pub signals: Vec<WaveSignal>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveSignal {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub width: u32,
    pub samples: Vec<WaveSample>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveSample {
    pub time: u64,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetlistGraph {
    pub path: String,
    pub creator: String,
    pub module_name: String,
    pub total_cells: usize,
    pub truncated: bool,
    pub nodes: Vec<NetlistNode>,
    pub edges: Vec<NetlistEdge>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetlistNode {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_line: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetlistEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub nets: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EvidenceClass {
    Measured,
    Estimated,
    Inferred,
    Unavailable,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignEvidence {
    pub class: EvidenceClass,
    pub source: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_number: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalLocation {
    pub x: i64,
    pub y: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bel: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignGraphNode {
    pub id: String,
    pub kind: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hierarchy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub netlist_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub physical: Option<PhysicalLocation>,
    pub evidence: DesignEvidence,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignGraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub relation: String,
    pub evidence: DesignEvidence,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingTraceSegment {
    pub index: usize,
    pub kind: String,
    pub delay_ns: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_cell: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_cell: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub physical: Option<PhysicalLocation>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingTrace {
    pub id: String,
    pub clock: String,
    pub start: String,
    pub end: String,
    pub delay_ns: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_ns: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slack_ns: Option<f64>,
    pub logic_levels: usize,
    pub segments: Vec<TimingTraceSegment>,
    pub rtl_sources: Vec<String>,
    pub analyzer_channels: Vec<usize>,
    pub evidence: DesignEvidence,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignIntelligenceGraph {
    pub schema_version: u32,
    pub generated_at: String,
    pub rtl_hash: String,
    pub status: String,
    pub nodes: Vec<DesignGraphNode>,
    pub edges: Vec<DesignGraphEdge>,
    pub timing_paths: Vec<TimingTrace>,
    pub resources: Vec<ResourceUsage>,
    pub unavailable: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerChannelConfig {
    pub id: usize,
    pub signal: String,
    pub width: u32,
    #[serde(default = "default_radix")]
    pub radix: String,
}

fn default_radix() -> String {
    "hex".into()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerTriggerClause {
    pub channel_id: usize,
    pub operation: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerTrigger {
    pub combinator: String,
    pub clauses: Vec<AnalyzerTriggerClause>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerConfig {
    pub schema_version: u32,
    pub clock_signal: String,
    pub clock_hz: u64,
    pub transport_rx: String,
    pub transport_tx: String,
    pub baud_rate: u32,
    pub sample_depth: usize,
    pub pre_trigger_samples: usize,
    pub channels: Vec<AnalyzerChannelConfig>,
    pub trigger: AnalyzerTrigger,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerSignal {
    pub id: String,
    pub name: String,
    pub hierarchy: String,
    pub width: u32,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_line: Option<u32>,
    pub observable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerCost {
    pub source: EvidenceClass,
    pub lut: i64,
    pub ff: i64,
    pub bram: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_fmax_m_hz: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrumented_fmax_m_hz: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fmax_impact_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerWorkspace {
    pub config: AnalyzerConfig,
    pub signals: Vec<AnalyzerSignal>,
    pub cost: AnalyzerCost,
    pub generated: bool,
    pub artifacts: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzerCapture {
    pub schema_version: u32,
    pub captured_at: String,
    pub rtl_hash: String,
    pub trigger_index: usize,
    pub waveform: WaveformData,
    pub source: DesignEvidence,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignSnapshot {
    pub id: u64,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_commit: Option<String>,
    pub rtl_hash: String,
    pub board: String,
    pub toolchain_version: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fmax_m_hz: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worst_slack_ns: Option<f64>,
    pub resources: Vec<ResourceUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critical_path: Option<TimingTrace>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analyzer_config_hash: Option<String>,
    pub verification_status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMetricDelta {
    pub metric: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceRegression {
    pub id: String,
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub evidence: Vec<DesignEvidence>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotComparison {
    pub baseline_id: u64,
    pub candidate_id: u64,
    pub metrics: Vec<SnapshotMetricDelta>,
    pub regressions: Vec<PerformanceRegression>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignHealthDimension {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
    pub evidence: Vec<DesignEvidence>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationRecommendation {
    pub id: String,
    pub category: String,
    pub title: String,
    pub summary: String,
    pub applicable: bool,
    pub expected_impact: String,
    pub experiment_kind: String,
    pub evidence: Vec<DesignEvidence>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationExperiment {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub options: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_snapshot_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_snapshot_id: Option<u64>,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationSummary {
    pub generated_at: String,
    pub health: Vec<DesignHealthDimension>,
    pub recommendations: Vec<OptimizationRecommendation>,
    pub experiments: Vec<OptimizationExperiment>,
    pub snapshots: Vec<DesignSnapshot>,
    pub regressions: Vec<PerformanceRegression>,
}
