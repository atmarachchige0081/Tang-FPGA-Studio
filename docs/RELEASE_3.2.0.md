# Tang FPGA Studio 3.2 — professional, configurable HDL workspace

Tang FPGA Studio 3.2 combines three related improvements in one release:

1. a compact professional desktop interface;
2. portable configurable FPGA projects; and
3. real project-aware Verilog/SystemVerilog editing assistance.

## Professional interface

- The start screen leads with the active project, physical board, FPGA device,
  clock, and build state.
- The shell, menus, activity bar, explorer, editor, toolbar, output dock,
  Problems panel, and status bar use one restrained dark/light design system.
- Engineering data is presented as dense property rows, tables, and panels
  rather than marketing cards.
- The responsive release layouts cover 1280 × 720 through full-HD maximized
  windows, including project creation and output/error states.

## Template and custom projects

The New Project dialog has two real modes:

- **Template project** copies a verified preset, applies a compatible board
  package, and then creates a normal portable project.
- **Custom project** starts from the portable hardware scaffold and records an
  explicit board, FPGA target, top module, timing target, constraint paths,
  build route, programmer route, and source structure.

Board and silicon are separate records in the schema-v2
`fpga.project.json` manifest. A board is the physical Sipeed platform and its
clock, constraints, and programmer. The FPGA target records Gowin vendor,
family, complete device identifier, package, and speed grade. The backend
validates that the selected combination is represented by an installed board
package; the UI does not offer arbitrary devices that the toolchain cannot
build.

Paths stored by project creation are project-relative. Custom constraint names
remain under `constraints/`, while source and test roots are `rtl/` and `sim/`
in this release because the build script supports those roots. Recent projects
can be reopened from the start screen, and the active/recent selection is
written transactionally to `.fpga-studio/workspace-state.json`.

## HDL intelligence

The Monaco editor uses the local Rust HDL index and a lightweight current-
buffer scan. Implemented Verilog/SystemVerilog assistance includes:

- context-aware completion for project modules, signals, ports, parameters,
  localparams, functions, tasks, packages, typedefs, macros, keywords, and
  project HDL include files;
- named-port snippets restricted to the interface of the module currently
  being instantiated;
- module signature/port help and compact hover declarations;
- project-wide definitions and references, with `F12` definition navigation
  and Monaco's `Shift+F12` references view;
- a cached symbol index, module hierarchy, top-module awareness, clock/reset
  data, duplicate/missing module findings, definite structural diagnostics,
  and unclosed-module syntax diagnostics;
- inline editor markers and a grouped/filterable Problems panel whose entries
  open the exact file, line, and column;
- bounded asynchronous project-text search plus file and HDL symbol search.

Indexing runs after project open/save rather than on every keystroke. The
current buffer contributes local symbols immediately, so typing remains
responsive while the persisted project index stays cached. If indexing fails,
the editor continues with syntax highlighting, folding, bracket completion,
indentation, multi-cursor editing, and normal file save behavior.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Command/action center |
| `Ctrl+P` | Go to project file |
| `Ctrl+T` | Go to HDL symbol |
| `Ctrl+Shift+F` | Search project text |
| `F12` | Go to definition |
| `Shift+F12` | Find references |
| `Ctrl+G` | Go to line (Monaco) |
| `Ctrl+S` | Save active file |
| `Ctrl+Shift+B` | Build project |
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` | Switch editor tabs |

## Validation evidence

- Frontend type check, optimized Vite build, and 32 Vitest tests.
- 49 passing Rust tests plus two explicitly ignored artifact-dependent tests.
- The HDL performance tests cover 5,000 completion candidates under a 100 ms
  budget and an 800-signal/assignment source within a 3-second debug-test
  indexing budget. The full 49-test Rust run completed in 2.87 seconds after
  compilation on the release machine.
- Project tests cover template creation, custom creation, validation rollback,
  portable manifests, custom constraints, search, persistence, and reopen.
- Existing Nano, Primer, Console 60K, and Console 138K registry and generation
  tests remain part of the backend and release gates.

The final release gate additionally runs the repository HDL simulations,
board-profile checks, production Tauri build, installer generation, packaged
launch smoke test, and manual dark/light UI inspection.

## Honest limitations

- HDL intelligence supports Verilog and SystemVerilog. VHDL is searchable as
  text but has no parser, synthesis, completion, or navigation claim.
- Custom targets are restricted to installed Tang/Gowin board packages. The
  UI does not claim support for arbitrary vendors or unregistered
  board/device combinations.
- `rtl/`, `sim/`, and `constraints/` are the supported portable source
  structure for this release.
- Static HDL diagnostics are intentionally conservative; the full Yosys,
  Verilator, Icarus, nextpnr, and Gowin EDA output remains authoritative.
- The Console 60K implementation route still requires Gowin EDA because the
  pinned open-source database does not contain GW5AT-60B.
