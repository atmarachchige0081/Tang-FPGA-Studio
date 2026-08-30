# Changelog

All notable user-facing changes are recorded here.

## 3.2.2 — 2026-08-30

### Fixed

- Moved the new `PROCASSINIT` waiver from HDL source metacomments to the pinned
  Windows Verilator invocation. This preserves strict lint on OSS CAD Suite
  5.051 while keeping Ubuntu's older stable Verilator compatible.
- Added a regression that prevents version-specific Verilator warning comments
  from returning to maintained HDL examples.

### Verified

- Repassed the 37-test Python suite and all four genuine Windows Verilator and
  Icarus HDL lint/simulation routes, including the overflow-safe UART console.
- Passed both Windows application jobs and the Ubuntu HDL quality gate for the
  final branch and immutable `v3.2.2` tag.

## 3.2.1 — 2026-08-30

### Fixed

- Fixed Windows Verilator jobs opening the extensionless OSS CAD Suite Perl
  wrapper as a document, which could hang lint or report a false pass. Studio
  now invokes `verilator_bin.exe` with a validated `VERILATOR_ROOT`.
- Bounded Vitest to two workers so full and repeated verification runs remain
  reliable under laptop CPU and memory pressure.
- Kept the HDL indexer's three-second debug performance budget while allowing
  one fresh measurement, preventing an unrelated OS scheduling pause from
  becoming a false release failure.
- Fixed strict Verilator findings in maintained example projects while keeping
  the Gowin power-on initialization intent explicit and narrowly waived.
- Fixed the serial command console accepting or acting on a truncated prefix
  of an overlong command. The example now reports an unknown command without
  changing LED state, with simulation coverage for the regression.
- Distinguished absent JTAG hardware from FTDI reset, USB enumeration, and
  Interface 0 access failures so beginners are not incorrectly told to replace
  a driver when the board or cable is not visible.
- Added execution-policy-safe `.cmd` entry points for release, stress, board,
  and screenshot verification on Windows.

### Verified

- Passed the production frontend build, 32 frontend tests, Rust backend suite,
  Python UI/toolchain suite, strict HDL lint/simulation, six-board build matrix,
  three-round concurrency stress run, Clippy with warnings denied, and Windows
  package launch smoke test.
- Audited 216 npm and 425 locked Rust dependencies with zero known
  vulnerabilities affecting the shipped Windows application.

## 3.2.0 — 2026-08-29

### UI

- Redesigned the application shell and start screen as a compact professional
  desktop IDE with the active project, target, device, clock, and build state
  visible at a glance.
- Replaced the marketing-style welcome page, oversized dashboard tiles, and
  board product cards with structured panels, property rows, and compact
  engineering tables.
- Consolidated project creation into a task-oriented two-pane dialog with a
  dense template list and standard project and target fields.
- Simplified the build toolbar, target indicator, output dock, release dialog,
  command palette, hardware manager, and intelligence workspaces.
- Introduced a restrained shared color, spacing, radius, border, typography,
  and focus system for dark and light themes.
- Added reproducible screenshot checks for dialogs, exclusions, custom window
  sizes, and the 1280 × 720, 1366 × 768, and 1920 × 1080 release layouts.

### Projects

- Added a Custom Project mode alongside the existing verified template
  presets. Custom projects explicitly configure a registered board, separate
  FPGA silicon target, top module, timing target, constraint paths, build
  route, programmer route, and portable source structure.
- Added schema-v2 portable project manifests with separate physical-board and
  FPGA-target records. Machine-specific paths are not stored.
- Added transactional recent-project reopening and backend validation that
  rejects unsupported target/board, toolchain, programmer, clock, and unsafe
  constraint-path combinations without leaving a partial project.
- Kept template projects as presets that produce normal projects rather than a
  separate restricted project type.

### IDE

- Added cached project-aware Verilog/SystemVerilog completion for modules,
  signals, ports, parameters, localparams, functions, tasks, types, packages,
  macros, keywords, and local HDL include files.
- Added context-specific module-port completion and compact signature help,
  hover declarations, go-to-definition, find-references, and a navigable module
  hierarchy.
- Added bounded asynchronous project-text search, file search, symbol search,
  and keyboard navigation through `Ctrl+P`, `Ctrl+T`, `Ctrl+Shift+F`, `F12`,
  and `Shift+F12`.
- Professionalized the Problems panel with severity grouping, filtering,
  sorting, source locations, and click-through navigation to file, line, and
  column.
- Added conservative missing-module and unclosed-module diagnostics while
  preserving toolchain diagnostics as the authoritative result.

### Performance and compatibility

- Replaced repeated linear source-position scans with a cached per-file line
  index and removed quadratic unused-signal counting from the Rust HDL index.
- Added completion and large-source performance regression tests, graceful
  degradation when indexing is unavailable, custom-project persistence tests,
  and UI navigation tests.
- Preserved existing board definitions, synthesis/programming behavior,
  template compatibility, and existing project layouts. VHDL and arbitrary
  unregistered FPGA vendors are not presented as supported.

## 3.1.1 — 2026-08-29

### Fixed

- Fixed source files remaining on Monaco's **Loading...** screen in packaged
  desktop builds. The editor and its worker now load from application-bundled
  assets instead of a CDN blocked by the desktop content-security policy, so
  HDL files open for editing without network access.

### Verified

- Added a regression test that requires the React editor loader to receive the
  bundled Monaco instance and create a local editor worker.
- Rebuilt the optimized frontend with a packaged `editor.worker` asset. No
  board registry, build, programming, or hardware behavior changed.

## 3.1.0 — 2026-08-29

### Added

- Added first-class Sipeed Tang Console 60K support for
  `GW5AT-LV60PG484AC1/I0` / `GW5AT-60B`, including PG484A metadata, a 50 MHz
  clock, BL616 JTAG/UART, openFPGALoader `tangconsole`, Gowin EDA project
  generation, and version-B selection.
- Added first-class current-revision Tang Console 138K support for
  `GW5AST-LV138PG484AC1/I0` / `GW5AST-138C`, including the bundled
  nextpnr/Apicula database and openFPGALoader `tangmega138k` route.
- Added independent `.cst` and `.sdc` packages for both boards. The 60K button
  bank remains `LVCMOS15`; the 138K C-revision button bank is `LVCMOS33`.
- Added a self-checking Tang Console LED/button/reset starter template and
  project-wizard filtering for both Console targets.
- Added backend/revision metadata to the board registry, generated project
  configuration, browser preview, project wizard, and Hardware Manager.
- Added six-design Console validation across minimal logic, LEDs, counters,
  clocked logic, reset logic, and a moderate multi-lane design.

### Changed

- Project generation now removes inherited `.cst`/`.sdc` files before copying
  the chosen board package, preventing generated Console projects from keeping
  stale Primer constraints.
- Builds route through the pinned open-source flow or Gowin EDA according to
  board metadata. Missing Gowin EDA reports the exact Console 60K prerequisite
  instead of failing later as an unknown nextpnr device.
- Generalized dual-interface JTAG guidance for the Primer and Console onboard
  debuggers while continuing to protect UART Interface 1 from driver changes.

### Fixed

- Isolated Yosys/ABC scratch paths per project. Parallel builds no longer race
  through a shared temporary directory; the 12-case Console matrix reproduced
  the old collision and passed completely after this fix.

### Verified

- 46 Rust backend tests passed, including registry, exact device metadata,
  generated constraints, backend persistence, negative paths, and existing
  project compatibility.
- The self-checking Console starter simulation passed.
- Parallel bitstream smoke builds passed for Nano 1K/4K/9K/20K, Primer 20K,
  and Console 138K C-revision with the pinned OSS CAD Suite.
- Console 138K received full open-source build-matrix validation. Console 60K
  received Yosys synthesis plus generated Gowin project/Tcl validation because
  Gowin EDA is not installed on the release machine.
- The optimized application, NSIS installer, 3.1.0 version resources, and
  packaged headless smoke test passed.

### Limitations

- GW5AT-60B is absent from the pinned open-source nextpnr/Apicula database, so
  Console 60K place-and-route and bitstream generation require Gowin EDA
  Education 1.9.11.03 or newer. Set `GOWIN_EDA_ROOT` when `gw_sh` is not on
  `PATH`.
- The Console 138K profile deliberately targets current C-revision silicon.
  Older B-revision SOMs require Gowin EDA and a B-revision project selection.
- No physical Tang Console board was available for v3.1 hardware validation;
  no Console programming or I/O behavior claim is made.

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
  bitstream with 315 LUT4, 138 DFF, and 193.12 MHz routed Fmax against 27 MHz.
  The maintained command-console analyzer image produced a 7,263,596-byte
  bitstream with 1,454 LUT4, 391 DFF, 2 BSRAM, and 209.91 MHz routed Fmax.
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
