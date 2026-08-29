import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AnalyzerCapture,
  AnalyzerConfig,
  AnalyzerWorkspace,
  BuildAction,
  BoardProfile,
  BuildEvent,
  BuildHistoryEntry,
  BuildSummary,
  CommandResult,
  CustomProjectRequest,
  DesignIntelligenceGraph,
  DesignSnapshot,
  HdlIndex,
  HdlPattern,
  GitStatus,
  NetlistGraph,
  OptimizationExperiment,
  OptimizationSummary,
  ProjectNode,
  ProjectSearchMatch,
  ProjectTemplate,
  PluginInfo,
  SerialDevice,
  SerialEvent,
  SnapshotComparison,
  WaveformData,
  VerificationSummary,
  WorkspaceSnapshot,
} from "../types";

const isDesktop = (): boolean => typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

const demoSource = `module top (
  input  logic clk,
  input  logic reset_n,
  output logic led
);
  logic [23:0] counter;

  always_ff @(posedge clk or negedge reset_n) begin
    if (!reset_n) begin
      counter <= '0;
      led <= 1'b0;
    end else if (&counter) begin
      counter <= '0;
      led <= ~led;
    end else begin
      counter <= counter + 1'b1;
    end
  end
endmodule
`;

const demoTree: ProjectNode[] = [
  { name: "rtl", path: "rtl", kind: "directory", children: [{ name: "top.sv", path: "rtl/top.sv", kind: "file" }] },
  { name: "sim", path: "sim", kind: "directory", children: [{ name: "tb_top.sv", path: "sim/tb_top.sv", kind: "file" }] },
  { name: "constraints", path: "constraints", kind: "directory", children: [{ name: "tang_primer_20k.cst", path: "constraints/tang_primer_20k.cst", kind: "file" }] },
  { name: "fpga.config.psd1", path: "fpga.config.psd1", kind: "file" },
];

const demoTemplates: ProjectTemplate[] = [
  { id: "led_button", name: "LED and button starter", description: "Board I/O, counter, simulation, and waveform.", level: "Beginner", category: "Fundamentals", base: "projects/_template", hardwareReady: true, tags: ["led", "button"] },
  { id: "console_led_button", name: "Tang Console LED and buttons", description: "A 50 MHz Console starter with revision-correct I/O.", level: "Beginner", category: "Fundamentals", base: "projects/_template", overlay: "templates/console_led_button", hardwareReady: true, tags: ["console", "led", "button"], supportedBoards: ["tang_console_60k", "tang_console_138k"] },
  { id: "uart_terminal", name: "UART terminal", description: "Verified greeting and echo at 115200 baud.", level: "Beginner +", category: "Interfaces", base: "projects/03_uart_terminal", hardwareReady: true, tags: ["uart", "serial"] },
  { id: "serial_commands", name: "Friendly serial command console", description: "Verified command parsing and friendly FPGA replies.", level: "Beginner +", category: "Interfaces", base: "projects/05_serial_command_console", hardwareReady: true, tags: ["uart", "commands"] },
  { id: "hardware_intelligence", name: "Hardware Intelligence laboratory", description: "Trace real paths, probe internal state, and compare evidence-backed builds.", level: "Beginner +", category: "Debugging", base: "projects/06_hardware_intelligence", hardwareReady: true, tags: ["analyzer", "traceability", "timing"] },
  { id: "spi_controller", name: "SPI controller", description: "Mode-0 byte transfers and loopback verification.", level: "Intermediate", category: "Interfaces", base: "projects/_template", hardwareReady: true, tags: ["spi", "fsm"] },
  { id: "pwm_controller", name: "Button-controlled PWM", description: "Debouncing and multi-channel LED PWM.", level: "Beginner +", category: "Control", base: "projects/01_button_led_pwm", hardwareReady: true, tags: ["pwm", "cdc"] },
  { id: "vga_timing", name: "VGA timing laboratory", description: "Raster coordinates and sync timing.", level: "Intermediate", category: "Video", base: "projects/_template", hardwareReady: true, tags: ["vga", "timing"] },
  { id: "riscv_scaffold", name: "RISC-V core scaffold", description: "RV32I decoder and program-counter shell.", level: "Advanced starter", category: "Processors", base: "projects/_template", hardwareReady: true, tags: ["risc-v", "rv32i"] },
];

const demoBoard: BoardProfile = {
  schemaVersion: 1, id: "tang_primer_20k", name: "Sipeed Tang Primer 20K with Dock",
  vendor: "Gowin", family: "GW2A-18C", yosysFamily: "gw2a", device: "GW2A-LV18PG256C8/I7",
  logicCells: 20736, clocks: [{ name: "clk_27mhz", frequencyHz: 27000000, pin: "H11", ioStandard: "LVCMOS33" }],
  programmer: { backend: "openFPGALoader", board: "tangprimer20k", transport: "ftdi-mpsse", jtagInterface: 0, uartInterface: 1, usbVid: "0403", usbPid: "6010" },
  constraints: ["constraints/primer20k_dock.cst"], capabilities: ["jtag", "sram", "flash", "uart", "leds"],
};

const demoBoards: BoardProfile[] = [demoBoard, {
  schemaVersion: 1, id: "tang_console_60k", name: "Sipeed Tang Console 60K",
  vendor: "Gowin", family: "GW5AT-60B", yosysFamily: "gw5a", device: "GW5AT-LV60PG484AC1/I0",
  build: { backend: "gowin-eda", deviceName: "GW5AT-60B", deviceCode: "gw5at60b-002", deviceVersion: "B" },
  logicCells: 59904, clocks: [{ name: "clk_50mhz", frequencyHz: 50000000, pin: "V22", ioStandard: "LVCMOS33" }],
  programmer: { backend: "openFPGALoader", board: "tangconsole", transport: "bl616", jtagInterface: 0, uartInterface: 1, usbVid: "0403", usbPid: "6010" },
  constraints: ["constraints/tang_console_60k.cst"], timingConstraints: ["constraints/tang_console_60k.sdc"], capabilities: ["jtag", "sram", "flash", "uart", "leds", "buttons"],
}, {
  schemaVersion: 1, id: "tang_console_138k", name: "Sipeed Tang Console 138K",
  vendor: "Gowin", family: "GW5AST-138C", yosysFamily: "gw5a", device: "GW5AST-LV138PG484AC1/I0",
  build: { backend: "oss-cad-suite", deviceName: "GW5AST-138C", deviceCode: "gw5ast138c-007", deviceVersion: "C" },
  logicCells: 138240, clocks: [{ name: "clk_50mhz", frequencyHz: 50000000, pin: "V22", ioStandard: "LVCMOS33" }],
  programmer: { backend: "openFPGALoader", board: "tangmega138k", transport: "bl616", jtagInterface: 0, uartInterface: 1, usbVid: "0403", usbPid: "6010" },
  constraints: ["constraints/tang_console_138k.cst"], timingConstraints: ["constraints/tang_console_138k.sdc"], capabilities: ["jtag", "sram", "flash", "uart", "leds", "buttons"],
}];

export const bridge = {
  isDesktop,

  async workspaceSnapshot(): Promise<WorkspaceSnapshot> {
    if (isDesktop()) return invoke<WorkspaceSnapshot>("workspace_snapshot");
    return { root: "Browser preview", project: "Tang Primer 20K Demo", projectPath: ".", tree: demoTree, recentProjects: [] };
  },

  async openProject(root: string, project: string): Promise<WorkspaceSnapshot> {
    if (isDesktop()) return invoke<WorkspaceSnapshot>("open_project", { root, project });
    return { root, project: project.split("/").at(-1) ?? project, projectPath: project, tree: demoTree, recentProjects: [project] };
  },

  async readText(root: string, path: string): Promise<string> {
    if (isDesktop()) return invoke<string>("read_text_file", { root, path });
    if (path === "rtl/top.sv") return demoSource;
    return `// Browser preview for ${path}\n`;
  },

  async writeText(root: string, path: string, content: string): Promise<void> {
    if (isDesktop()) await invoke("write_text_file", { root, path, content });
  },

  async searchProject(root: string, project: string, query: string): Promise<ProjectSearchMatch[]> {
    if (isDesktop()) return invoke<ProjectSearchMatch[]>("search_project_text", { root, project, query });
    const needle = query.toLowerCase();
    return demoSource.split("\n").flatMap((line, index) => {
      const column = line.toLowerCase().indexOf(needle);
      return column >= 0 ? [{ file: "rtl/top.sv", line: index + 1, column: column + 1, preview: line.trim() }] : [];
    });
  },

  async projectTemplates(root: string): Promise<ProjectTemplate[]> {
    return isDesktop() ? invoke<ProjectTemplate[]>("list_project_templates", { root }) : demoTemplates;
  },

  async hdlPatterns(root: string): Promise<HdlPattern[]> {
    if (isDesktop()) return invoke<HdlPattern[]>("list_hdl_patterns", { root });
    return [
      { title: "Clocked register with synchronous reset", category: "Sequential logic", difficulty: "Beginner", summary: "Stores a value on the rising edge and clears it synchronously.", code: "always_ff @(posedge clk) begin\n    if (reset) value <= '0;\n    else value <= next_value;\nend", aliases: ["ffreg"], synthesizable: true },
      { title: "Two-flop input synchronizer", category: "Clock domain crossing", difficulty: "Beginner", summary: "Reduces metastability risk for a single asynchronous input.", code: "always_ff @(posedge clk) begin\n    sync_ff1 <= async_in;\n    sync_ff2 <= sync_ff1;\nend", aliases: ["sync2"], synthesizable: true },
      { title: "Self-checking assertion", category: "Verification", difficulty: "Beginner", summary: "Stops a simulation when an expected condition is false.", code: "assert (actual === expected) else $fatal(1, \"Mismatch\");", aliases: ["check"], synthesizable: false },
    ];
  },

  async boards(root: string): Promise<BoardProfile[]> {
    return isDesktop() ? invoke<BoardProfile[]>("list_boards", { root }) : demoBoards;
  },

  async activeBoard(root: string, project: string): Promise<BoardProfile> {
    return isDesktop() ? invoke<BoardProfile>("active_board", { root, project }) : demoBoard;
  },

  async gitStatus(root: string): Promise<GitStatus> {
    if (isDesktop()) return invoke<GitStatus>("read_git_status", { root });
    return { available: true, repository: true, executable: "git", version: "git version (preview)", branch: "main", upstream: "origin/main", ahead: 0, behind: 0, changes: [], message: "Working tree clean" };
  },

  async plugins(root: string): Promise<PluginInfo[]> {
    if (isDesktop()) return invoke<PluginInfo[]>("list_plugins", { root });
    return [
      { id: "fpga-studio.boards", name: "Tang Board Packages", version: "2.0.0", kind: "board", entry: "provider.json", capabilities: ["read-project"], valid: true, message: "Bundled and ready" },
      { id: "fpga-studio.hdl-patterns", name: "HDL Pattern Library", version: "2.0.0", kind: "ip", entry: "provider.json", capabilities: ["read-project", "write-generated"], valid: true, message: "Bundled and ready" },
    ];
  },

  async hdlIndex(root: string, project: string): Promise<HdlIndex> {
    if (isDesktop()) return invoke<HdlIndex>("read_hdl_index", { root, project });
    return { top: "top", files: ["rtl/top.sv"], symbols: [
      { name: "top", kind: "module", file: "rtl/top.sv", line: 1, column: 8, detail: "SystemVerilog module" },
      { name: "clk", kind: "input", file: "rtl/top.sv", line: 2, column: 16, detail: "input declaration" },
      { name: "led", kind: "output", file: "rtl/top.sv", line: 4, column: 16, detail: "output declaration" },
      { name: "counter", kind: "logic", file: "rtl/top.sv", line: 6, column: 16, detail: "logic declaration" },
    ], references: [
      { name: "top", file: "rtl/top.sv", line: 1, column: 8, declaration: true },
      { name: "clk", file: "rtl/top.sv", line: 2, column: 16, declaration: true },
      { name: "clk", file: "rtl/top.sv", line: 8, column: 28, declaration: false },
    ], diagnostics: [], modules: [{ name: "top", file: "rtl/top.sv", line: 1, ports: ["clk", "reset_n", "led"], portDetails: [
      { name: "clk", direction: "input", dataType: "logic" },
      { name: "reset_n", direction: "input", dataType: "logic" },
      { name: "led", direction: "output", dataType: "logic" },
    ] }], instances: [], clockDomains: [{ moduleName: "top", clock: "clk", edge: "posedge", reset: "reset_n", file: "rtl/top.sv", line: 8 }], signals: [
      { id: "top:counter", name: "counter", moduleName: "top", hierarchy: "counter", width: 24, kind: "logic", file: "rtl/top.sv", line: 6, column: 16, observable: true },
      { id: "top:led", name: "led", moduleName: "top", hierarchy: "led", width: 1, kind: "output", file: "rtl/top.sv", line: 4, column: 16, observable: true },
    ] };
  },

  async designGraph(root: string, project: string): Promise<DesignIntelligenceGraph> {
    if (isDesktop()) return invoke<DesignIntelligenceGraph>("read_design_graph", { root, project });
    const evidence = { class: "measured" as const, source: "Browser preview report", detail: "Preview implementation evidence." };
    return {
      schemaVersion: 1, generatedAt: new Date().toISOString(), rtlHash: "preview", status: "complete",
      nodes: [
        { id: "rtl:counter", kind: "rtl-signal", label: "counter", hierarchy: "counter", width: 24, sourceFile: "rtl/top.sv", sourceLine: 6, evidence },
        { id: "cell:counter", kind: "cell", label: "counter DFF", netlistName: "counter_DFF_Q", cellType: "DFF", physical: { x: 12, y: 7, bel: "R12C7_SLICE0" }, evidence },
      ],
      edges: [{ id: "maps", source: "rtl:counter", target: "cell:counter", relation: "synthesizes-to", evidence }],
      timingPaths: [{ id: "path:0", clock: "top.clk", start: "counter.Q", end: "counter.D", delayNs: 13.81, targetNs: 37.04, slackNs: 23.22, logicLevels: 3, rtlSources: ["rtl/top.sv:8"], analyzerChannels: [0], evidence, segments: [
        { index: 0, kind: "logic", delayNs: 0.23, fromCell: "counter.Q", sourceFile: "rtl/top.sv", sourceLine: 8, physical: { x: 12, y: 7, bel: "R12C7_SLICE0" } },
        { index: 1, kind: "routing", delayNs: 0.71, net: "counter[4]", fromCell: "counter.Q", toCell: "add.I0", physical: { x: 14, y: 8 } },
        { index: 2, kind: "logic", delayNs: 0.57, fromCell: "add", toCell: "counter.D", sourceFile: "rtl/top.sv", sourceLine: 15, physical: { x: 14, y: 8, bel: "R14C8_SLICE1" } },
      ] }],
      resources: [{ name: "LUT4", label: "Logic LUTs", used: 1842, total: 20736 }], unavailable: [],
    };
  },

  async analyzerWorkspace(root: string, project: string): Promise<AnalyzerWorkspace> {
    if (isDesktop()) return invoke<AnalyzerWorkspace>("read_analyzer_workspace", { root, project });
    return {
      config: { schemaVersion: 1, clockSignal: "clk", clockHz: 27_000_000, transportRx: "uart_rx", transportTx: "uart_tx", baudRate: 115_200, sampleDepth: 1024, preTriggerSamples: 512, channels: [{ id: 0, signal: "counter", width: 24, radix: "hex" }], trigger: { combinator: "and", clauses: [{ channelId: 0, operation: "compare", value: "0x40" }] } },
      signals: [{ id: "net:counter", name: "counter", hierarchy: "counter", width: 24, kind: "register", sourceFile: "rtl/top.sv", sourceLine: 6, observable: true }],
      cost: { source: "estimated", lut: 210, ff: 82, bram: 2, baselineFmaxMHz: 72.4 }, generated: false, artifacts: [], warnings: [],
    };
  },

  async saveAnalyzerConfig(root: string, project: string, config: AnalyzerConfig): Promise<AnalyzerWorkspace> {
    if (isDesktop()) return invoke<AnalyzerWorkspace>("save_analyzer_config", { root, project, config });
    return { ...(await this.analyzerWorkspace(root, project)), config, generated: true };
  },

  async prepareAnalyzer(root: string, project: string): Promise<AnalyzerWorkspace> {
    if (isDesktop()) return invoke<AnalyzerWorkspace>("prepare_analyzer", { root, project });
    return this.analyzerWorkspace(root, project);
  },

  async captureAnalyzer(root: string, project: string, portName: string, timeoutMs: number): Promise<AnalyzerCapture> {
    if (isDesktop()) return invoke<AnalyzerCapture>("capture_analyzer", { root, project, portName, timeoutMs });
    const waveform = await this.readWaveform(root, project);
    return { schemaVersion: 1, capturedAt: new Date().toISOString(), rtlHash: "preview", triggerIndex: 50, waveform, source: { class: "measured", source: portName || "preview UART", detail: "Preview capture." } };
  },

  async analyzerCapture(root: string, project: string): Promise<AnalyzerCapture | null> {
    return isDesktop() ? invoke<AnalyzerCapture | null>("read_analyzer_capture", { root, project }) : null;
  },

  async optimizationSummary(root: string, project: string): Promise<OptimizationSummary> {
    if (isDesktop()) return invoke<OptimizationSummary>("read_optimization_summary", { root, project });
    const evidence = [{ class: "measured" as const, source: "build/timing.json", detail: "Complete preview implementation." }];
    return { generatedAt: new Date().toISOString(), health: [
      { id: "correctness", label: "Correctness", status: "healthy", detail: "Verification checks are current.", evidence },
      { id: "timing", label: "Timing", status: "healthy", detail: "Worst slack is +23.22 ns.", evidence },
      { id: "area", label: "Area", status: "healthy", detail: "Highest utilization is 8.9%.", evidence },
      { id: "cdc-reset", label: "CDC & reset", status: "healthy", detail: "One reset-aware clock domain.", evidence: [{ class: "inferred", source: "RTL structural scan", detail: "Conservative inference." }] },
      { id: "observability", label: "Observability", status: "attention", detail: "Analyzer configured; no capture yet.", evidence },
      { id: "hardware", label: "Hardware verification", status: "unavailable", detail: "No board observation recorded.", evidence: [{ class: "unavailable", source: "Hardware evidence", detail: "Not recorded." }] },
    ], recommendations: [{ id: "retime-critical-path", category: "timing", title: "Measure a retiming experiment", summary: "Critical path contains several logic levels.", applicable: true, expectedImpact: "Potential Fmax improvement, verified with a separate build.", experimentKind: "retime", evidence }], experiments: [], snapshots: [], regressions: [] };
  },

  async recordSnapshot(root: string, project: string, kind: string, experimentId?: string): Promise<DesignSnapshot> {
    if (isDesktop()) return invoke<DesignSnapshot>("record_design_snapshot", { root, project, kind, experimentId });
    return { id: Date.now(), createdAt: new Date().toISOString(), rtlHash: "preview", board: demoBoard.device, toolchainVersion: "preview", kind, experimentId, fmaxMHz: 72.4, worstSlackNs: 23.22, resources: [], verificationStatus: "partial" };
  },

  async compareSnapshots(root: string, project: string, baselineId: number, candidateId: number): Promise<SnapshotComparison> {
    if (isDesktop()) return invoke<SnapshotComparison>("compare_design_snapshots", { root, project, baselineId, candidateId });
    return { baselineId, candidateId, metrics: [], regressions: [] };
  },

  async prepareExperiment(root: string, project: string, recommendationId: string): Promise<OptimizationExperiment> {
    if (isDesktop()) return invoke<OptimizationExperiment>("prepare_optimization_experiment", { root, project, recommendationId });
    return { id: crypto.randomUUID(), kind: "retime", title: "Preview experiment", status: "prepared", createdAt: new Date().toISOString(), options: ["synth_gowin -retime"], accepted: false };
  },

  async finishExperiment(root: string, project: string, experimentId: string, success: boolean): Promise<OptimizationExperiment> {
    if (isDesktop()) return invoke<OptimizationExperiment>("finish_optimization_experiment", { root, project, experimentId, success });
    return { id: experimentId, kind: "retime", title: "Preview experiment", status: success ? "complete" : "failed", createdAt: new Date().toISOString(), options: [], accepted: false };
  },

  async createProject(root: string, name: string, templateId: string, displayName: string, boardId: string): Promise<WorkspaceSnapshot> {
    if (isDesktop()) return invoke<WorkspaceSnapshot>("create_project", { root, name, templateId, displayName, boardId });
    return { root, project: displayName || name, projectPath: `projects/${name}`, tree: demoTree, recentProjects: [`projects/${name}`] };
  },

  async createCustomProject(root: string, name: string, request: CustomProjectRequest): Promise<WorkspaceSnapshot> {
    if (isDesktop()) return invoke<WorkspaceSnapshot>("create_custom_project", { root, name, request });
    return { root, project: request.displayName || name, projectPath: `projects/${name}`, tree: demoTree, recentProjects: [`projects/${name}`] };
  },

  async run(root: string, project: string, action: BuildAction, jobId: string): Promise<CommandResult> {
    if (isDesktop()) return invoke<CommandResult>("run_fpga_command", { root, project, action, jobId });
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    return { jobId, action, success: true, exitCode: 0, durationMs: 500, diagnostics: [], failureMessage: undefined };
  },

  async cancel(jobId: string): Promise<boolean> {
    return isDesktop() ? invoke<boolean>("cancel_job", { jobId }) : false;
  },

  async buildSummary(root: string, project: string): Promise<BuildSummary> {
    if (isDesktop()) return invoke<BuildSummary>("read_build_summary", { root, project });
    return {
      status: "passed", fmaxMHz: 72.4, targetMHz: 27, lutUsed: 1842, lutTotal: 20736,
      registersUsed: 1106, registersTotal: 15552, bitstreamBytes: 142336, worstSlackNs: 23.22,
      updatedAt: new Date().toISOString(), timingMet: true,
      resources: [
        { name: "LUT4", label: "Logic LUTs", used: 1842, total: 20736 },
        { name: "DFF", label: "Flip-flops", used: 1106, total: 15552 },
        { name: "BSRAM", label: "Block RAM", used: 2, total: 46 },
        { name: "IOB", label: "I/O blocks", used: 12, total: 384 },
        { name: "rPLL", label: "PLLs", used: 0, total: 4 },
      ],
      clocks: [{ name: "top.clk", achievedMHz: 72.4, constraintMHz: 27, slackNs: 23.22, timingMet: true }],
      criticalPaths: [{ source: "posedge top.clk", destination: "posedge top.clk", delayNs: 13.81, slackNs: 23.22, segments: 9 }],
    };
  },

  async verificationSummary(root: string, project: string): Promise<VerificationSummary> {
    if (isDesktop()) return invoke<VerificationSummary>("read_verification_summary", { root, project });
    const now = new Date().toISOString();
    return {
      generatedAt: now, projectUpdatedAt: now, passed: 7, warnings: 0, failed: 0, notRun: 3,
      nextAction: "Connect the board and run Detect JTAG.",
      stages: [
        { id: "analysis", label: "Design analysis", status: "pass", detail: "1 HDL file, 1 module, and 1 clock domain scanned cleanly.", completedAt: now, artifacts: ["rtl/top.sv"] },
        { id: "lint", label: "Toolchain lint", status: "pass", detail: "The latest lint run completed successfully in 740 ms.", durationMs: 740, completedAt: now, artifacts: [] },
        { id: "simulation", label: "Simulation", status: "pass", detail: "Self-checking simulation passed.", durationMs: 1220, completedAt: now, artifacts: ["build/waves.vcd"] },
        { id: "synthesis", label: "Synthesis & place/route", status: "pass", detail: "Implementation completed successfully.", durationMs: 8200, completedAt: now, artifacts: ["build/top.json", "build/top_pnr.json"] },
        { id: "timing", label: "Timing analysis", status: "pass", detail: "All constrained clocks pass; worst slack +23.220 ns.", completedAt: now, artifacts: ["build/timing.json"] },
        { id: "resources", label: "Resource fit", status: "pass", detail: "Device utilization fits the selected board.", completedAt: now, artifacts: ["build/timing.json"] },
        { id: "bitstream", label: "Bitstream", status: "pass", detail: "Programming file is current and structurally valid.", completedAt: now, artifacts: ["build/top.fs"] },
        { id: "jtag", label: "JTAG link", status: "notRun", detail: "Run Detect with the board connected.", artifacts: [] },
        { id: "programming", label: "Board programming", status: "notRun", detail: "Use SRAM for a reversible hardware test.", artifacts: [] },
        { id: "hardware", label: "Hardware behavior", status: "notRun", detail: "Record the LEDs, UART, or other behavior you observe.", artifacts: [] },
      ],
    };
  },

  async recordHardwareVerification(root: string, project: string, passed: boolean, note: string): Promise<VerificationSummary> {
    if (isDesktop()) return invoke<VerificationSummary>("record_hardware_verification", { root, project, passed, note });
    const current = await this.verificationSummary(root, project);
    const hardware = { id: "hardware", label: "Hardware behavior", status: passed ? "pass" as const : "fail" as const, detail: `${passed ? "User-confirmed board behavior" : "User-recorded hardware issue"}: ${note}`, completedAt: new Date().toISOString(), artifacts: [".fpga-studio/hardware-verification.json"] };
    const stages = [...current.stages.filter((stage) => stage.id !== "hardware"), hardware];
    return { ...current, stages, passed: stages.filter((stage) => stage.status === "pass").length, failed: stages.filter((stage) => stage.status === "fail").length, notRun: stages.filter((stage) => stage.status === "notRun").length };
  },

  async buildHistory(root: string, project: string): Promise<BuildHistoryEntry[]> {
    if (isDesktop()) return invoke<BuildHistoryEntry[]>("read_build_history", { root, project });
    return [
      { buildNumber: 1, action: "lint", success: true, durationMs: 740, completedAt: new Date(Date.now() - 180_000).toISOString(), fmaxMHz: null, lutUsed: null, registersUsed: null, bitstreamBytes: null },
      { buildNumber: 2, action: "sim", success: true, durationMs: 1220, completedAt: new Date(Date.now() - 120_000).toISOString(), fmaxMHz: null, lutUsed: null, registersUsed: null, bitstreamBytes: null },
      { buildNumber: 3, action: "build", success: true, durationMs: 8200, completedAt: new Date().toISOString(), fmaxMHz: 72.4, lutUsed: 1842, registersUsed: 1106, bitstreamBytes: 142336 },
    ];
  },

  async serialDevices(): Promise<SerialDevice[]> {
    if (isDesktop()) return invoke<SerialDevice[]>("list_serial_devices");
    return [{ portName: "COM5", displayName: "Tang Primer Debugger UART (preview)", likelyBoard: true }];
  },

  async launchZadig(root: string, project: string): Promise<string> {
    if (isDesktop()) return invoke<string>("launch_zadig", { root, project });
    return "Browser preview: verified Zadig would open for JTAG Interface 0.";
  },

  async connectSerial(portName: string, baudRate: number, sessionId: string): Promise<void> {
    if (isDesktop()) await invoke("connect_serial", { portName, baudRate, sessionId });
  },

  async writeSerial(sessionId: string, data: number[]): Promise<void> {
    if (isDesktop()) await invoke("write_serial", { sessionId, data });
  },

  async disconnectSerial(sessionId: string): Promise<boolean> {
    return isDesktop() ? invoke<boolean>("disconnect_serial", { sessionId }) : true;
  },

  async onSerialEvent(handler: (event: SerialEvent) => void): Promise<UnlistenFn> {
    if (isDesktop()) return listen<SerialEvent>("fpga-serial-event", ({ payload }) => handler(payload));
    return () => undefined;
  },

  async readWaveform(root: string, project: string): Promise<WaveformData> {
    if (isDesktop()) return invoke<WaveformData>("read_waveform", { root, project });
    return {
      path: "projects/demo/build/waves.vcd",
      timescale: "1 ns",
      endTime: 100,
      truncated: false,
      signals: [
        { id: "!", name: "clk", scope: "tb_top", width: 1, samples: Array.from({ length: 21 }, (_, index) => ({ time: index * 5, value: String(index % 2) })) },
        { id: "#", name: "reset_n", scope: "tb_top", width: 1, samples: [{ time: 0, value: "0" }, { time: 15, value: "1" }] },
        { id: "$", name: "counter[7:0]", scope: "tb_top.dut", width: 8, samples: [{ time: 0, value: "00000000" }, { time: 25, value: "00000001" }, { time: 45, value: "00000010" }, { time: 65, value: "00000011" }] },
        { id: "%", name: "led", scope: "tb_top.dut", width: 1, samples: [{ time: 0, value: "0" }, { time: 65, value: "1" }] },
      ],
    };
  },

  async readNetlist(root: string, project: string): Promise<NetlistGraph> {
    if (isDesktop()) return invoke<NetlistGraph>("read_netlist", { root, project });
    return {
      path: "projects/demo/build/top.json",
      creator: "Yosys browser preview",
      moduleName: "top",
      totalCells: 3,
      truncated: false,
      nodes: [
        { id: "port:clk", label: "clk", kind: "INPUT", detail: "1-bit top-level port" },
        { id: "counter", label: "counter[23:0]", kind: "Sequential", detail: "$dff" },
        { id: "reduce", label: "reduce", kind: "Logic", detail: "$reduce_and" },
        { id: "port:led", label: "led", kind: "OUTPUT", detail: "1-bit top-level port" },
      ],
      edges: [
        { id: "edge:0", source: "port:clk", target: "counter", nets: ["clk"] },
        { id: "edge:1", source: "counter", target: "reduce", nets: ["counter"] },
        { id: "edge:2", source: "reduce", target: "port:led", nets: ["led"] },
      ],
    };
  },

  async onBuildEvent(handler: (event: BuildEvent) => void): Promise<UnlistenFn> {
    if (isDesktop()) return listen<BuildEvent>("fpga-build-event", ({ payload }) => handler(payload));
    return () => undefined;
  },
};
