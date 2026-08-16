# Legacy Python companion

This folder contains the maintained compatibility UI from FPGA Studio 1.2. It
uses Python's built-in Tk interface and remains available for lightweight or
older systems. The supported Studio 3.0 desktop product, RTL Analysis,
Verification Center, multi-board packages, and one-file Windows installer are
documented in the repository [README](../README.md) and implemented under
[`studio/`](../studio/).

Start it from the repository root:

```powershell
.\FPGA-IDE.ps1
```

On Windows, a beginner can also double-click `Open-FPGA-IDE.cmd` in File
Explorer. The PowerShell launcher starts the GUI without a console window.

Use `-Project projects/03_uart_terminal` to select another project at startup,
or `-Theme light` / `-Theme dark` to override the remembered appearance.
Use `-Console` when diagnosing a GUI startup problem.

## What is included

- Accessible dark and light workspaces, runtime theme switching, persistent
  preference, custom icon regeneration, searchable project explorer, open-file
  tabs, breadcrumbs, bracket matching, and rich editor chrome.
- Module hierarchy plus module, port, signal, parameter, and instance indexing.
- `Ctrl+Space` completions for HDL keywords, modules, ports, internal signals,
  and 72 smart pattern aliases such as `fsm`, `sync2`, `fifo`, and `counter`.
- `F12` or `Ctrl+Click` navigation to modules, ports, signals, and instances;
  `Shift+F12` exact project references; and named-port instance generation.
- Searchable `Ctrl+Shift+P` command palette and whole-project
  `Ctrl+Shift+F` text search.
- Searchable HDL Pattern Library with 72 reviewed references across sequential
  logic, combinational logic, counters/timing, CDC/input handling, state
  machines, arithmetic, handshakes/interfaces, memories/buffers, and
  verification. Category and difficulty filters plus clear synthesizable RTL
  versus simulation-only labels help beginners choose safely.
- Offline contextual code explanation for selected HDL constructs and symbols.
- Beginner diagnostics for missing top modules, duplicate modules, incomplete
  constraints/electrical standards, duplicate pins, recursive hierarchy,
  missing/self-checking simulations, incomplete cases, and common RTL hazards.
- Safe one-click fixes for strict-net directives and missing testbench skeletons.
- Contextual Beginner Coach with suggested fixes and the safe FPGA workflow.
- Project Insights with a health score, verification readiness, module graph,
  timing margin, device utilization, pin coverage, and artifact status.
- Pin Assignment Inspector showing each signal, package pin, electrical
  properties, and source line without guessing board connections.
- A complete New Project Wizard with verified board-I/O and UART starting
  points, safe names, clean copies, and an optional first-project tutorial.
- Verification Center selection for testbenches and GTKWave layouts, with
  PASS/FAIL assertion summaries and clickable console source locations.
- Guided hardware setup that clearly separates JTAG Interface 0/WinUSB from
  UART Interface 1/serial, plus Doctor and Detect actions.
- Integrated dependency-free Windows UART terminal with COM auto-detection,
  read/write ASCII or hex, timestamps, line endings, history, and log saving.
- Searchable synthesized-netlist popup backed by `build/top.json`, with a
  categorized overview, component/type filtering, local fan-in/fan-out,
  zooming, panning, named nets, and RTL source navigation.
- Versioned first-launch release notes that appear once per release and remain
  available from Help and the command palette.
- Streaming console output for simulate, GTKWave, lint, debug, build, SRAM
  upload, persistent flash, JTAG detection, doctor, UART, setup, and driver
  configuration.
- Confirmation before persistent flash and a Stop button for running commands.

## Appearance and recovery

Use the theme button in the upper-right header, **View > Dark mode / Light
mode**, or `Ctrl+Alt+T`. Switching is live: open editors and dialogs remain in
place, while native Tk widgets, ttk controls, syntax highlighting, menus,
selections, status colors, tooltips, canvases, and custom icons are rethemed.
The choice is stored in `.fpga-studio/settings.json`; an invalid or damaged
preference safely falls back to dark mode.

The release gate validates every semantic color and interaction state against
contrast targets, starts the full UI in both modes, performs 30 live switches
with dialogs open, checks icon integrity and editor-state retention, and
injects a theme failure to prove that the previous palette is restored.

## Where code belongs

For each folder under `projects/`:

- Put synthesizable `.v` and `.sv` modules under `rtl/`.
- Put the configured top module in `rtl/top.sv` unless you deliberately change
  `Top` in `fpga.config.psd1`.
- Put a self-checking `tb_top` testbench in `sim/tb_top.sv`.
- Assign every top-level hardware port in `constraints/primer20k_dock.cst`.
- Treat `build/` as generated output; do not write source code there.

The editor intelligence is intentionally lightweight assistance. It
recognizes the common Verilog/SystemVerilog patterns used by these learning
projects, but it is not a standards-complete language server or a replacement
for Verilator lint and simulation.

## Using the HDL Pattern Library

Press `Ctrl+Alt+S` to browse all 72 patterns. Search by concept, title, code, or
alias; for example, try `debounce`, `metastability`, `fifo`, `uart`, or `pwm`.
Use category and difficulty filters to narrow the list. Every entry explains
its purpose and identifies whether it belongs in synthesizable RTL or only in
a testbench.

Patterns are building blocks, not complete hardware specifications. Rename
signals, define the shown parameters and widths, consider the clock/reset and
board requirements, then run Smart Check, Verilator lint, and a self-checking
simulation before building or programming the FPGA.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save the current file |
| `Ctrl+Space` | Show project-aware completions |
| `F12` / `Ctrl+Click` | Go to a project symbol definition |
| `Shift+F12` | Find exact project symbol references |
| `Ctrl+Shift+P` | Open the searchable command palette |
| `Ctrl+Shift+F` | Search text throughout the project |
| `Ctrl+Alt+S` | Open the HDL Pattern Library |
| `Ctrl+Alt+T` | Toggle dark/light mode |
| `Ctrl+Shift+E` | Explain selected HDL context |
| `Ctrl+/` | Toggle line comments |
| `Ctrl+D` | Duplicate the current line |
| `F5` | Simulate |
| `F6` | Simulate and open GTKWave |
| `F7` | Run Verilator lint |
| `F8` | Run the debug flow |
| `F9` | Build and upload to SRAM |
| `Ctrl+B` | Build the bitstream |

For automated checks without opening a window:

```powershell
python ide\fpga_ide.py --check projects\01_button_led_pwm
.\FPGA-IDE.ps1 -SmokeTest -Project projects/01_button_led_pwm
python ide\fpga_ide.py --theme-stress-test --project projects\01_button_led_pwm
python -m unittest discover -s ide\tests -v
```
