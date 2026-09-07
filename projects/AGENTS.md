# FPGA Studio project guidance for AI agents

This file describes how to work safely inside a Tang FPGA Studio project. It does not define the circuit to build. The user supplies the design requirements, interfaces, behavior, and acceptance criteria.

## Scope and authority

- These instructions apply to this project directory and all directories below it.
- Follow the user's current request first. Do not invent missing functional requirements.
- Treat `fpga.project.json`, `fpga.config.psd1`, and the selected board constraints as authoritative environment configuration.
- Inspect existing RTL, tests, constraints, and documentation before editing.
- Make focused changes and preserve unrelated user work.

## Project structure

- `rtl/`: synthesizable Verilog or SystemVerilog design sources.
- `sim/`: testbenches, simulation-only helpers, and optional GTKWave layouts.
- `constraints/`: physical pin constraints (`.cst`) and optional timing constraints (`.sdc`).
- `fpga.config.psd1`: build entry point, top module, FPGA part, clock target, programmer route, and bitstream path.
- `fpga.project.json`: FPGA Studio project metadata, board identity, source roots, and creation mode.
- `README.md`: user-facing behavior, controls, architecture, setup, and verified results.
- `build/`: generated synthesis, place-and-route, timing, simulation, and bitstream artifacts. Do not hand-edit or commit generated files unless the user explicitly asks.

Paths shown in FPGA Studio are relative to the workspace root. The active project may be under `projects/` or another folder selected by the user inside that workspace.

## Before changing HDL

1. Read `fpga.config.psd1` and confirm `Top`, `Device`, `Family`, `Constraint`, `ClockMHz`, and `ProgrammerBoard`.
2. Read `fpga.project.json` when present and confirm the selected physical board.
3. Read the active `.cst` and `.sdc` files. Never guess pin numbers, I/O standards, clock pins, or board polarity.
4. Find the top module and relevant self-checking testbench.
5. Ask the user when behavior, reset semantics, clock-domain relationships, or external electrical requirements are ambiguous.

## HDL development rules

- Keep synthesizable design code in `rtl/` and simulation-only code in `sim/`.
- Preserve the configured top-module name unless the configuration is updated in the same change.
- Prefer explicit widths, named ports, deterministic reset behavior, and nonblocking assignments in sequential logic.
- Do not create gated clocks in ordinary RTL. Use clock enables unless the device-specific design explicitly requires a clock primitive.
- Synchronize asynchronous single-bit inputs and use an appropriate CDC structure for buses, pulses, or multi-clock data.
- Avoid inferred latches, implicit nets, multiple drivers, unsized arithmetic surprises, and simulation-only constructs in synthesizable modules.
- Use `default_nettype none` where consistent with the project, and restore `default_nettype wire` at the end of reusable source files.
- Treat warnings about clocks, CDC, unconstrained I/O, inferred latches, truncation, or timing as engineering findings rather than cosmetic output.

## Running the project

Find the nearest ancestor containing `fpga.ps1`; that directory is the FPGA Studio workspace root. Run commands from there and pass the workspace-relative project path:

```powershell
.\fpga.ps1 lint   -Project "<project-path>"
.\fpga.ps1 sim    -Project "<project-path>"
.\fpga.ps1 wave   -Project "<project-path>"
.\fpga.ps1 debug  -Project "<project-path>"
.\fpga.ps1 build  -Project "<project-path>"
.\fpga.ps1 detect -Project "<project-path>"
.\fpga.ps1 upload -Project "<project-path>"
```

FPGA Studio's Save, Lint, Simulate, Build, SRAM, Waveform, Hardware, and UART actions call the same workspace toolchain. Prefer these maintained commands over ad-hoc tool invocations because they use the registered board configuration and produce reports the IDE understands.

## Required verification order

Use the smallest relevant check while developing, then verify in this order before claiming completion:

1. Save all edited files.
2. Run lint and resolve blocking diagnostics.
3. Run a self-checking simulation that covers normal behavior, reset, boundaries, and relevant error cases.
4. Run build and inspect synthesis, placement, resource use, and timing results.
5. Confirm the implemented clock constraint matches the physical board clock and the requested design target.
6. If hardware is available, use SRAM upload first because it is volatile.
7. Use persistent flash only when the user explicitly requests it and the correct board/programmer has been detected.

Never describe simulation, timing, or hardware behavior as verified unless that specific check actually ran successfully. Distinguish measured results from estimates and assumptions.

## Hardware safety

- Detect the JTAG chain before programming.
- Use only the programmer route declared by the board profile.
- On FTDI-based Tang Primer boards, Interface 0 is normally JTAG and Interface 1 normally provides UART. Do not replace Interface 1's serial driver.
- Do not automatically change USB drivers, erase flash, or perform persistent programming.
- Do not increase clocks merely because synthesis reports a higher theoretical Fmax. Board clocks and generated clocks require correct constraints and hardware-aware clocking resources.
- Record the exact board, FPGA device, bitstream, command, and observed result when reporting a hardware test.

## Editing and generated files

- Add new modules under `rtl/`, matching testbenches under `sim/`, and only verified board constraints under `constraints/`.
- Update `README.md` when controls, ports, build steps, supported boards, or known limitations change.
- Do not edit files under `build/`, `obj_dir/`, or tool-generated cache directories as source code.
- Do not add machine-specific absolute paths to portable project files.
- Keep secrets, credentials, personal serial data, and local machine identifiers out of the repository.

## Debugging guidance

- Start with the first actionable compiler or simulator message; later errors are often consequences.
- For syntax errors, inspect the exact reported line and the preceding declaration or assignment.
- For simulation failures, reduce the problem to a deterministic self-checking test and inspect only relevant waveform signals.
- For synthesis or timing failures, use the generated Yosys and timing reports; do not infer success from an emitted file alone.
- For programming failures, separate bitstream generation, JTAG detection, USB-driver access, and FPGA-family compatibility into distinct checks.

## Completion report

When handing work back, state:

- what behavior changed;
- which source, test, constraint, or configuration files changed;
- which lint, simulation, build, timing, and hardware checks actually passed;
- any warnings, assumptions, unsupported boards, or remaining risks.
