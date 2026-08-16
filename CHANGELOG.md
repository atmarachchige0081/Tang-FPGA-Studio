# Changelog

All notable user-facing changes are recorded here.

## 3.0.0 — 2026-08-16

### Added

- Added a shared evidence-aware design graph connecting RTL declarations,
  synthesized cells/nets, physical placement, timing segments, and analyzer
  probes, with cached incremental refresh and explicit unavailable links.
- Added a real generated on-chip analyzer: exact post-synthesis internal probe
  discovery, 1–16 channels/128 bits, 64–4096 samples, circular pre-trigger
  capture, edge/level/vector AND triggers, SRAM-only upload, and binary UART
  waveform acquisition.
- Added Design Health across verification, timing, logic depth, fanout, area,
  memory, I/O, clock/reset, observability, and hardware, plus evidence-backed recommendations,
  isolated retiming/placement experiments, build history, snapshots,
  comparison, and regression thresholds.
- Added the verified Hardware Intelligence UART laboratory and a dedicated New
  Project template for learning the complete v3 flow.
- Added responsive Trace, Analyzer, and Design Health workspaces, v3 command
  navigation, first-launch release notes, documentation, and reproducible dark
  and light screenshots.

### Changed

- Normal builds now retain an IO-pad-free synthesized artifact for exact probe
  discovery while preserving the original bitstream pipeline and artifacts.
- Build completion records reproducible local evidence including source and
  configuration hashes, toolchain, board, timing, resources, verification, and
  critical-path identity.
- FPGA work remains serialized per project while expensive graph, report,
  serial, analyzer, and experiment work stays off the UI thread.

### Safety

- Analyzer instrumentation and optimization experiments never modify source
  RTL or replace the normal build. Analyzer upload cannot write persistent
  flash.
- Stale, ambiguous, optimized-away, unavailable, or estimated evidence is
  labelled honestly; successful programming is not presented as successful
  hardware behavior or capture.
- Channel, width, memory depth, serial timeout, artifact size, experiment,
  snapshot, and history bounds prevent unbounded work and corrupt state is
  recovered or reported without crashing the editor.

### Verified

- Passed the production frontend build, 23 Vitest checks, 46 Rust tests
  (including the two maintained-project artifact tests), strict Rust formatting
  and Clippy, 34 Python compatibility checks, four maintained HDL lint and
  simulation flows, and a zero-vulnerability production/development npm audit.
- Passed the three-round concurrency stress suite and parallel full bitstream
  builds for five distinct Tang device families at laptop-safe parallelism two.
- The Hardware Intelligence demo produced a fresh 4,620,140-byte Primer 20K
  bitstream with 253 LUT4, 113 DFF, and 267.67 MHz routed Fmax against 27 MHz.
  Its generated analyzer image produced a 7,263,596-byte bitstream with 1,454
  LUT4, 391 DFF, 2 BSRAM, and 209.91 MHz routed Fmax.
- The optimized Windows executable, one-file NSIS installer, and packaged
  headless smoke test pass.

### Limitations

- On-device analyzer capture requires both a working JTAG link and UART link.
  The release host saw the correct WinUSB Interface 0 and preserved COM15, but
  its attached debugger returned `ftdi_usb_reset failed`; no upload or capture
  was claimed after that failure. Reconnect the board USB cable before the
  hardware acceptance step if Windows leaves the endpoint in this state.
- Optimization experiments apply only allowlisted build strategies in isolated
  artifacts. Pipeline and fanout findings are evidence-linked guidance; Studio
  does not silently rewrite user RTL.

## 2.1.0 — 2026-08-08

### Added

- Added a native RTL Analysis workspace with stable finding codes, source
  locations, plain-language explanations, suggested fixes, severity/search
  filters, module hierarchy, instances, and detected clock/reset domains.
- Added conservative checks for duplicate or missing modules, definitely unused
  internal signals, multiple continuous drivers, direct sized-literal
  truncation, continuous combinational self-loops, reset sensitivity/polarity
  conflicts, and explicit logic-generated clocks.
- Added an evidence-driven Verification Center covering live analysis, lint,
  simulation, synthesis/place-and-route, timing, resource fit, bitstream, JTAG,
  programming, and explicit hardware behavior.
- Added user-recorded hardware observations with atomic project-local storage.
  JTAG detection and programming success remain distinct from functional proof.
- Added complete nextpnr clock and utilization parsing plus the eight longest
  reported critical paths, timing slack, resource labels, and responsive tables.

### Changed

- Build Insights now shows every reported clock and resource class instead of
  only the first clock plus LUT/FF totals.
- Verification evidence becomes a warning after a relevant source or bitstream
  change, so an old pass is not presented as current.
- Expanded the toolbar, menus, and `Ctrl+K` action center with Analyze and Verify
  navigation and clearer recommended next actions.
- Refined the new intelligence surfaces for natural dark/light presentation,
  compact laptop layouts, loading skeletons, empty/error states, and keyboard-
  accessible controls.

### Fixed

- Build report status now reflects timing failure instead of marking every
  readable timing report as passed.
- Timing summaries now pair achieved frequency with its actual clock constraint
  and calculate path slack from real nextpnr delays.
- Constrained the main flex workspace width so dense analysis and verification
  cards do not render behind the right edge on 1440-pixel displays.
- Hardware evidence can be updated repeatedly on Windows using a recoverable
  atomic replace instead of failing when the record already exists.
- Updated the pinned HTML sanitizer and transitive ID generator so the shipped
  frontend dependency graph reports zero known npm vulnerabilities.

### Verified

- Native frontend production build and 19 Vitest checks; 34 Rust HDL, report,
  verification, parser, security, package, and concurrency checks; 34 Python
  compatibility checks; zero-vulnerability npm audit; and strict Rust
  formatting and Clippy enforcement.
- The maintained LED/PWM, UART terminal, serial command console, and starter
  projects produce no blocking live-analysis findings.
- Dark and light RTL-analysis screenshots plus the Verification Center are
  reproducibly captured from the current React frontend at 1440×900.
- The full local release check and three-round stress suite passed, including
  repeat UI/store and job-lock tests plus parallel full bitstream builds for all
  five distinct Tang device families at laptop-safe parallelism two.
- The maintained Primer project produced a fresh 4,620,140-byte uncompressed
  bitstream and achieved 250.63 MHz against its 27 MHz constraint. The optimized
  2.1.0 native executable, NSIS installer, and packaged headless smoke test pass.
- Live Primer 20K Dock acceptance passed on Windows: Interface 0 JTAG ID
  `0x81b`, two uncompressed volatile SRAM uploads to 100%, Interface 1 preserved
  as COM15, and a 115200-baud `PING`/`PONG - your UART link works!` round trip
  from the programmed serial-command design. Persistent flash was not written.

### Limitations

- Live analysis is deliberately conservative and does not claim arbitrary CDC,
  latch, FSM reachability, or procedural multiple-driver proof. Use lint,
  simulation, synthesis, timing, and specialist CDC/formal tools for those jobs.
- Hardware behavior requires a user observation; the application cannot infer
  correct LEDs, UART replies, or external I/O solely from JTAG/programmer output.
- The installer is provenance-attested but is not Authenticode-signed by a
  trusted commercial Windows publisher, so Windows may show Unknown publisher.

## 2.0.1 — 2026-08-02

- Kept packaged SPI teaching signals warning-free under the GitHub runner's
  Verilator version while preserving the verified `0xA5` loopback behavior.
- Made VGA timing constants and the RISC-V decode scaffold explicitly
  width-safe under strict Linux Verilator warning checks.
- Split companion and native CI responsibilities so each clean job installs
  only the dependencies it executes, and enforced canonical Rust formatting.
- Replaced every README screenshot still referenced from the retired Python v1
  interface with reproducible 1440x900 captures of the current Studio 2
  frontend in dark and light modes.

## 2.0.0 — 2026-08-02

### Added

- Added validated packages for Tang Nano 1K, 4K, 9K, and 20K plus Tang Primer
  20K Dock, Core, and Lite variants, including installed OSS CAD Suite family
  mappings and all openFPGALoader board aliases.
- Added a friendly UART command-console project with case-insensitive `HELP`,
  `PING`, `LED ON`, `LED OFF`, `STATUS`, and `ABOUT` commands, complete replies,
  a self-checking terminal model, waveform layout, and synthesized bitstream.
- Added real read-only Git status and declarative plugin/provider discovery to
  the native Studio, plus bundled board and HDL-pattern providers.
- Added a laptop-safe parallel board-family build smoke test and a repeatable
  frontend/backend/concurrency stress runner.
- Added real File, Edit, Project, Build, Hardware, and Help menus plus a
  keyboard-navigable `Ctrl+K` action center with a context-aware next step.
- Added native startup panic logging and a visible recovery dialog under
  `%LOCALAPPDATA%\Tang FPGA Studio\logs\crash.log`.

### Changed

- New Project now filters board choices by template compatibility and writes
  project-specific device, family, constraints, clock, and programmer settings.
- Hardware Manager uses the active board manifest and limits automatic Zadig
  repair to the known Primer Dock `0403:6010` Interface 0 layout.
- UART Terminal includes clickable beginner command presets, while the HDL
  pattern panel now waits for workspace discovery and offers visible retry.
- Backend FPGA jobs now enforce one writer per project so independent UI views
  cannot corrupt a shared build directory.
- Native filesystem, Git, board, plugin, HDL, waveform, netlist, and serial
  operations now run off the UI thread. Output, waveform, and netlist rendering
  are bounded to keep large designs responsive.
- Gowin bitstreams are packed without the optional compression mode that is
  mis-parsed by the pinned openFPGALoader, then structurally validated before
  programming. JTAG programming has a 90-second watchdog and specific recovery
  guidance for a reset FTDI endpoint.

### Verified

- Native frontend production build and 17 Vitest checks; 22 Rust parser,
  security, package, and concurrency checks; UART lint, protocol simulation,
  Primer place/route/packing at 27 MHz; and parallel full bitstream builds for
  all five distinct Tang FPGA device families.
- Live Primer 20K Dock acceptance passed on Windows: JTAG ID `0x81b`, validated
  uncompressed SRAM upload to 100%, and a 115200-baud COM15 `PING`/`PONG` UART
  round trip from the programmed FPGA.

## 1.2.0 — 2026-07-27

### Added

- Added a root-level, literal-beginner `INSTALL.md` covering each Windows
  prerequisite through a first safe SRAM upload, with automated sequence,
  link, repository URL, and hardware-safety checks.
- Replaced the folder-name prompt with a safe New Project Wizard offering
  complete board-I/O and UART starting points plus an optional guided tutorial.
- Added HDL symbol navigation for modules, ports, signals, and instances,
  project-wide exact references, and named-port module-instantiation generation.
- Added a dependency-free integrated Windows UART terminal with COM-port
  discovery, transmit and receive, ASCII/hex views, timestamps, line endings,
  history, connection recovery, and UTF-8 log saving.
- Added a Verification Center for selecting testbenches and GTKWave layouts,
  running simulation/debug, and summarizing PASS/FAIL assertion lines.
- Added guided board/JTAG/UART/driver setup and an interactive six-step first
  FPGA workflow that persists progress per project.
- Added clickable Verilator/Icarus-style console locations and selection-safe
  PowerShell support for `-Testbench`, `-TestbenchTop`, and `-WaveLayout`.
- Added a complete UART greeting/echo learning project with RX, TX, physical
  UART constraints, waveform layout, documentation, and protocol-level tests.
- Added a separate synthesized-netlist viewer with searchable components,
  categorized overview, local fan-in/fan-out, named nets, zoom/pan controls,
  large-design limits, and source navigation from Yosys cell metadata.
- Added versioned first-launch release notes that appear once per release and
  remain available from Help and the command palette.
- Added a release-driven installer notification workflow with a secure
  token-free polling fallback in the one-file installer repository.

### Changed

- Refined both themes into calmer, more natural professional palettes and
  replaced mechanical labels with clearer human language and workflow groups.
- Expanded CI and local release gates to validate the maintained UART project
  and retheme nine open feature dialogs across 30 live theme changes.

### Verified

- 33 Python tests, dark/light startup, theme rollback and contrast checks,
  Verilator lint, a 30-byte bidirectional UART simulation, and Tang Primer 20K
  synthesis/place/route/packing at 27 MHz (345.90 MHz reported maximum).

## 1.1.0 — 2026-07-26

### Added

- Added a complete accessible light theme alongside the refined dark theme,
  with a header control, View menu, `Ctrl+Alt+T` shortcut, startup override,
  and locally remembered preference.
- Added semantic color tokens, theme-aware custom icon regeneration, live
  retheming for open editors/dialogs/menus/canvases, and safe rollback when a
  platform-specific UI operation fails.
- Expanded the HDL Pattern Library from six snippets to 72 categorized,
  searchable references with difficulty, scope, explanations, code copying,
  editor insertion, and completion aliases.
- Added automated validation for library size, metadata, aliases, filtering,
  and separation of synthesizable RTL from testbench-only constructs.
- Added WCAG contrast validation, dark/light startup smoke tests, a 30-cycle
  live-switch stress test with dialogs open, state/icon checks, and injected
  failure recovery verification.

### Verified

- Complete release gate across Python, PowerShell, project intelligence,
  Verilator lint, self-checking Icarus simulation, both UI themes, and
  reproducible dark/light screenshots.

## 1.0.0 — 2026-07-26

### Added

- Premium, DPI-aware desktop workspace with custom iconography, searchable
  explorer, open-file tabs, editor breadcrumbs, bracket matching, tooltips,
  and grouped Create/Verify/Implement actions.
- Command palette, project-wide search, HDL Pattern Library, contextual HDL
  explanation, pin assignment inspector, safe quick fixes, and generated
  testbench skeletons.
- Module, port, signal, parameter, and instance indexing with hierarchy,
  constraint, electrical-standard, duplicate-pin, recursion, case-completeness,
  synthesis, and simulation diagnostics.
- Project health, workflow readiness, module hierarchy, Fmax, resource use,
  artifact status, session history, and live command timing.
- Rotating crash/diagnostic logs, remembered project selection, hardware-action
  validation, and safer interruption of programming commands.
- Reproducible screenshots, CI quality gates, release checks, security policy,
  contribution guide, code of conduct, and MIT license.

### Verified

- Tang Primer 20K Project 01 Verilator lint, self-checking Icarus simulation,
  nextpnr timing data, and open-source bitstream workflow.

## 0.1.0-beta — 2026-07-26

- Initial dependency-free desktop UI for the repository's verified PowerShell
  simulation, waveform, build, upload, flash, JTAG, UART, and diagnosis flow.
