export type ThemeMode = "dark" | "light" | "system";
export type Activity = "explorer" | "search" | "source" | "hardware" | "ip" | "extensions";
export type BottomPanel = "problems" | "output" | "terminal" | "waveform";
export type WorkbenchView = "editor" | "dashboard" | "analysis" | "verification" | "traceability" | "analyzer" | "health" | "netlist" | "waveform" | "hardware" | "uart" | "welcome";
export type BuildAction = "doctor" | "lint" | "sim" | "build" | "upload" | "flash" | "detect" | "analyzer-build" | "analyzer-upload" | "experiment";

export interface ProjectNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: ProjectNode[];
}

export interface OpenFile {
  path: string;
  name: string;
  language: string;
  content: string;
  savedContent: string;
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  source: string;
  message: string;
  code?: string;
  suggestion?: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface BuildEvent {
  jobId: string;
  phase: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
  timestamp: string;
}

export interface CommandResult {
  jobId: string;
  action: BuildAction;
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  diagnostics: Diagnostic[];
  failureMessage?: string;
}

export interface WorkspaceSnapshot {
  root: string;
  project: string;
  projectPath: string;
  tree: ProjectNode[];
  recentProjects: string[];
}

export interface BuildSummary {
  status: "ready" | "passed" | "failed" | "running";
  fmaxMHz: number | null;
  targetMHz: number | null;
  lutUsed: number | null;
  lutTotal: number | null;
  registersUsed: number | null;
  registersTotal: number | null;
  bitstreamBytes: number | null;
  worstSlackNs: number | null;
  updatedAt: string | null;
  timingMet: boolean | null;
  resources: ResourceUsage[];
  clocks: ClockTiming[];
  criticalPaths: CriticalPath[];
}

export interface ResourceUsage {
  name: string;
  label: string;
  used: number;
  total: number;
}

export interface ClockTiming {
  name: string;
  achievedMHz: number;
  constraintMHz: number;
  slackNs: number;
  timingMet: boolean;
}

export interface CriticalPath {
  source: string;
  destination: string;
  delayNs: number;
  slackNs?: number;
  segments: number;
}

export type VerificationStageStatus = "pass" | "fail" | "warning" | "notRun";

export interface VerificationStage {
  id: string;
  label: string;
  status: VerificationStageStatus;
  detail: string;
  durationMs?: number;
  completedAt?: string;
  artifacts: string[];
}

export interface VerificationSummary {
  generatedAt: string;
  projectUpdatedAt?: string;
  stages: VerificationStage[];
  passed: number;
  warnings: number;
  failed: number;
  notRun: number;
  nextAction: string;
}

export interface BuildHistoryEntry {
  buildNumber: number;
  action: BuildAction;
  success: boolean;
  durationMs: number;
  completedAt: string;
  fmaxMHz: number | null;
  lutUsed: number | null;
  registersUsed: number | null;
  bitstreamBytes: number | null;
}

export interface SerialDevice {
  portName: string;
  displayName: string;
  vendorId?: number;
  productId?: number;
  likelyBoard: boolean;
}

export interface SerialEvent {
  sessionId: string;
  kind: "data" | "status" | "error";
  data: number[];
  message?: string;
  timestamp: string;
}

export interface WaveSample {
  time: number;
  value: string;
}

export interface WaveSignal {
  id: string;
  name: string;
  scope: string;
  width: number;
  samples: WaveSample[];
}

export interface WaveformData {
  path: string;
  timescale: string;
  endTime: number;
  truncated: boolean;
  signals: WaveSignal[];
}

export interface NetlistNode {
  id: string;
  label: string;
  kind: string;
  detail: string;
  sourceFile?: string;
  sourceLine?: number;
}

export interface NetlistEdge {
  id: string;
  source: string;
  target: string;
  nets: string[];
}

export interface NetlistGraph {
  path: string;
  creator: string;
  moduleName: string;
  totalCells: number;
  truncated: boolean;
  nodes: NetlistNode[];
  edges: NetlistEdge[];
}

export interface ReleaseNote {
  version: string;
  title: string;
  items: string[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  level: string;
  category: string;
  base: string;
  overlay?: string;
  hardwareReady: boolean;
  tags: string[];
  supportedBoards?: string[];
}

export interface HdlPattern {
  title: string;
  category: string;
  difficulty: string;
  summary: string;
  code: string;
  aliases: string[];
  synthesizable: boolean;
}

export interface BoardClock {
  name: string;
  frequencyHz: number;
  pin: string;
  ioStandard?: string;
}

export interface BoardProfile {
  schemaVersion: number;
  id: string;
  name: string;
  vendor: string;
  family: string;
  yosysFamily?: string;
  device: string;
  logicCells?: number;
  build?: {
    backend: "oss-cad-suite" | "gowin-eda";
    deviceName: string;
    deviceCode?: string;
    deviceVersion?: "A" | "B" | "C";
  };
  clocks: BoardClock[];
  programmer: {
    backend: string;
    board: string;
    transport: string;
    jtagInterface?: number;
    uartInterface?: number;
    usbVid?: string;
    usbPid?: string;
  };
  constraints: string[];
  timingConstraints?: string[];
  documentation?: string;
  capabilities: string[];
}

export interface GitChange {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface GitStatus {
  available: boolean;
  repository: boolean;
  executable?: string;
  version?: string;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
  message: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  kind: string;
  entry: string;
  capabilities: string[];
  valid: boolean;
  message: string;
}

export interface HdlSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  detail: string;
}

export interface HdlIndex {
  top: string;
  files: string[];
  symbols: HdlSymbol[];
  diagnostics: Diagnostic[];
  modules: HdlModule[];
  instances: HdlInstance[];
  clockDomains: ClockDomain[];
  signals: HdlSignal[];
}

export interface HdlSignal {
  id: string;
  name: string;
  moduleName: string;
  hierarchy: string;
  width: number;
  kind: string;
  file: string;
  line: number;
  column: number;
  observable: boolean;
  unavailableReason?: string;
}

export interface HdlModule {
  name: string;
  file: string;
  line: number;
  ports: string[];
}

export interface HdlInstance {
  parentModule: string;
  moduleName: string;
  instanceName: string;
  file: string;
  line: number;
}

export interface ClockDomain {
  moduleName: string;
  clock: string;
  edge: string;
  reset?: string;
  file: string;
  line: number;
}

export type EvidenceClass = "measured" | "estimated" | "inferred" | "unavailable";

export interface DesignEvidence {
  class: EvidenceClass;
  source: string;
  detail: string;
  buildNumber?: number;
}

export interface PhysicalLocation {
  x: number;
  y: number;
  bel?: string;
}

export interface DesignGraphNode {
  id: string;
  kind: string;
  label: string;
  hierarchy?: string;
  width?: number;
  sourceFile?: string;
  sourceLine?: number;
  netlistName?: string;
  cellType?: string;
  physical?: PhysicalLocation;
  evidence: DesignEvidence;
}

export interface DesignGraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  evidence: DesignEvidence;
}

export interface TimingTraceSegment {
  index: number;
  kind: string;
  delayNs: number;
  net?: string;
  fromCell?: string;
  toCell?: string;
  sourceFile?: string;
  sourceLine?: number;
  physical?: PhysicalLocation;
}

export interface TimingTrace {
  id: string;
  clock: string;
  start: string;
  end: string;
  delayNs: number;
  targetNs?: number;
  slackNs?: number;
  logicLevels: number;
  segments: TimingTraceSegment[];
  rtlSources: string[];
  analyzerChannels: number[];
  evidence: DesignEvidence;
}

export interface DesignIntelligenceGraph {
  schemaVersion: number;
  generatedAt: string;
  rtlHash: string;
  status: string;
  nodes: DesignGraphNode[];
  edges: DesignGraphEdge[];
  timingPaths: TimingTrace[];
  resources: ResourceUsage[];
  unavailable: string[];
}

export interface AnalyzerChannelConfig {
  id: number;
  signal: string;
  width: number;
  radix: "binary" | "hex" | "decimal";
}

export interface AnalyzerTriggerClause {
  channelId: number;
  operation: "rising" | "falling" | "level" | "compare";
  value: string;
}

export interface AnalyzerConfig {
  schemaVersion: number;
  clockSignal: string;
  clockHz: number;
  transportRx: string;
  transportTx: string;
  baudRate: number;
  sampleDepth: number;
  preTriggerSamples: number;
  channels: AnalyzerChannelConfig[];
  trigger: { combinator: "and"; clauses: AnalyzerTriggerClause[] };
}

export interface AnalyzerSignal {
  id: string;
  name: string;
  hierarchy: string;
  width: number;
  kind: string;
  sourceFile?: string;
  sourceLine?: number;
  observable: boolean;
  unavailableReason?: string;
}

export interface AnalyzerCost {
  source: EvidenceClass;
  lut: number;
  ff: number;
  bram: number;
  baselineFmaxMHz?: number;
  instrumentedFmaxMHz?: number;
  fmaxImpactPercent?: number;
}

export interface AnalyzerWorkspace {
  config: AnalyzerConfig;
  signals: AnalyzerSignal[];
  cost: AnalyzerCost;
  generated: boolean;
  artifacts: string[];
  warnings: string[];
}

export interface AnalyzerCapture {
  schemaVersion: number;
  capturedAt: string;
  rtlHash: string;
  triggerIndex: number;
  waveform: WaveformData;
  source: DesignEvidence;
}

export interface DesignSnapshot {
  id: number;
  createdAt: string;
  gitCommit?: string;
  rtlHash: string;
  board: string;
  toolchainVersion: string;
  kind: string;
  experimentId?: string;
  fmaxMHz?: number;
  worstSlackNs?: number;
  resources: ResourceUsage[];
  criticalPath?: TimingTrace;
  analyzerConfigHash?: string;
  verificationStatus: string;
}

export interface SnapshotMetricDelta {
  metric: string;
  baseline?: number;
  candidate?: number;
  delta?: number;
  percent?: number;
  unit: string;
}

export interface PerformanceRegression {
  id: string;
  severity: string;
  title: string;
  detail: string;
  evidence: DesignEvidence[];
}

export interface SnapshotComparison {
  baselineId: number;
  candidateId: number;
  metrics: SnapshotMetricDelta[];
  regressions: PerformanceRegression[];
}

export interface DesignHealthDimension {
  id: string;
  label: string;
  status: "healthy" | "attention" | "critical" | "unavailable";
  detail: string;
  evidence: DesignEvidence[];
}

export interface OptimizationRecommendation {
  id: string;
  category: string;
  title: string;
  summary: string;
  applicable: boolean;
  expectedImpact: string;
  experimentKind: string;
  evidence: DesignEvidence[];
}

export interface OptimizationExperiment {
  id: string;
  kind: string;
  title: string;
  status: string;
  createdAt: string;
  options: string[];
  baselineSnapshotId?: number;
  resultSnapshotId?: number;
  accepted: boolean;
}

export interface OptimizationSummary {
  generatedAt: string;
  health: DesignHealthDimension[];
  recommendations: OptimizationRecommendation[];
  experiments: OptimizationExperiment[];
  snapshots: DesignSnapshot[];
  regressions: PerformanceRegression[];
}
