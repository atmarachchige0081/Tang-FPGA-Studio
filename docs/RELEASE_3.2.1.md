# Tang FPGA Studio 3.2.1 — Windows reliability hotfix

Tang FPGA Studio 3.2.1 is a focused hotfix for the 3.2 professional IDE. It
does not change project formats, board identifiers, or supported build routes.
Existing 3.2 projects open without migration.

## What was fixed

### Genuine Verilator execution on Windows

OSS CAD Suite includes both an extensionless Perl launcher named `verilator`
and the native `verilator_bin.exe`. Windows PowerShell could treat the Perl
launcher as a document, open it in another application, and return without
running lint. That caused stalled jobs and, in one path, a misleading success.

Studio now selects `verilator_bin.exe`, validates its runtime data directory,
sets `VERILATOR_ROOT`, and uses the same resolved executable for lint and
Hardware Doctor. Missing runtime data fails with an installation repair message
instead of silently skipping analysis.

### Stable verification under load

Vitest now uses at most two workers. This keeps the frontend suite responsive
during repeated stress rounds and concurrent HDL/board checks on a typical
laptop, avoiding intermittent worker startup timeouts under memory pressure.
The HDL indexing regression keeps its original three-second debug budget but
uses the faster of two fresh measurements, filtering one unrelated scheduler
pause without weakening the performance ceiling.

Windows users can launch the repository checks even when local PowerShell
script execution is restricted:

```powershell
.\scripts\release-check.cmd
.\scripts\stress-test.cmd -Rounds 3 -Parallelism 2
.\scripts\test-console-boards.cmd
```

### Correct maintained HDL examples

Real native Verilator lint exposed warnings that the previous launcher path had
not executed. The maintained Primer examples now document and narrowly waive
only the intentional Gowin configuration-memory power-on initialization.

The UART command console also fixes width diagnostics and an input-safety bug:
an overlong command such as `LED OFFX` can no longer be truncated to `LED OFF`.
It returns the friendly unknown-command response and leaves the LED unchanged.
The simulator explicitly checks that behavior.

### Honest hardware recovery guidance

JTAG failure messages now distinguish:

- no programmer or cable visible;
- an Interface 0 FTDI reset problem;
- a USB endpoint that did not enumerate cleanly; and
- an adapter that exists but cannot be opened.

Studio never changes a USB driver automatically. On supported dual-interface
Tang debuggers, only JTAG Interface 0 should use WinUSB; Interface 1 remains the
UART serial interface. Descriptor or error `-12` failures first recommend a
direct port and a known data-capable cable before any driver action.

## Release verification

The hotfix release gate covers:

- TypeScript type checking and an optimized Vite production build;
- 32 bounded frontend tests;
- the complete Rust backend suite and Clippy with warnings denied;
- Python UI, command-runner, board-registry, and Windows-launcher regressions;
- genuine native Verilator lint plus Icarus simulation for maintained examples;
- full build smoke tests for Tang Nano 1K, 4K, 9K, 20K, Tang Primer 20K, and
  Tang Console 138K, with the registered Gowin route check for Console 60K;
- three repeated UI/store/backend rounds while board builds run in parallel;
- production Tauri/NSIS packaging and a packaged executable launch smoke test;
- `npm audit` across 216 dependencies and `cargo audit` across 425 locked Rust
  dependencies, with no known vulnerability reported for the Windows release.

The Cargo advisory database additionally reports maintenance/unsoundness
warnings for GTK3-era Linux-only Tauri dependencies. They are absent from the
`x86_64-pc-windows-msvc` dependency tree and are not linked into this Windows
installer.

## Hardware validation boundary

During hotfix verification, the connected computer reported a USB device
descriptor failure and openFPGALoader error `-12`; Windows did not enumerate an
FTDI/JTAG or COM endpoint. No SRAM upload or persistent flash was attempted
against an unidentified endpoint. Reconnect the debugger directly with a known
data cable, verify it appears in Hardware Doctor, and use volatile SRAM upload
before any persistent write.

## Upgrade

Install 3.2.1 over 3.2.0 using the Windows x64 installer. Projects and settings
remain compatible. The first launch shows these notes once; they remain
available from **Help → Release notes**.
