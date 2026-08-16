# Tang FPGA Studio 3.0 — Hardware Intelligence

Tang FPGA Studio 3.0 turns implementation evidence into one connected local
workflow: trace a source signal to physical logic and timing, instrument real
internal nets, capture them on the FPGA, and compare measured build outcomes.

## Major capabilities

- A shared cached RTL → netlist → physical → timing → analyzer design graph.
- Cross-domain traceability with real path delay segments and explicit
  measured, inferred, or unavailable evidence.
- A generated on-chip logic analyzer with 1–16 channels, 128 total bits,
  64–4096 samples, circular pre-trigger storage, AND triggers, and binary UART
  capture transport.
- Separate analyzer images and isolated optimization experiments that never
  edit RTL or overwrite the normal build.
- Ten-dimension Design Health, evidence-backed recommendations, history,
  snapshots, thresholded regressions, and build comparison.
- A verified Hardware Intelligence UART laboratory for the complete guided
  simulation, implementation, trace, probe, capture, and optimization flow.
- Natural, responsive dark and light interfaces for Trace, Analyzer, and
  Design Health, plus v3 first-launch release notes and command navigation.

## Safety and evidence

Analyzer uploads are SRAM-only. Flash remains a separate confirmed action.
Probe discovery uses real synthesized netnames; optimized-away or ambiguous
signals are shown as unavailable. Estimated analyzer cost is replaced by
measured resource and timing deltas after implementation. Experiments are
allowlisted, isolated, bounded, and retain the baseline.

The application is local after toolchain setup, sends no telemetry, and does
not require an account. A successful compile, JTAG scan, upload, and hardware
capture remain distinct facts.

## Release validation

The maintained Primer 20K Dock release design passes strict Verilator lint,
self-checking Icarus UART simulation, Yosys synthesis, nextpnr placement and
routing, and Apicula bitstream packing at 27 MHz. The instrumented build has
also completed full real place-and-route and packing with measured analyzer
resource and timing reports.

The final gate passed 23 frontend tests, all 46 Rust tests including the two
maintained-project artifact tests, 34 Python compatibility tests, four HDL
lint/simulation flows, five parallel board-family builds, three repeated
concurrency rounds, strict formatting and warning-free Clippy, and a full npm
audit with zero reported vulnerabilities. The normal Hardware Intelligence
demo used 315 LUT4 and 138 DFF and reached 193.12 MHz. The separate instrumented
command-console image used 1,454 LUT4, 391 DFF, and 2 BSRAM and reached
209.91 MHz. Both passed the 27 MHz constraint and produced structurally
validated uncompressed Gowin bitstreams. The optimized Windows application,
packaged smoke test, and one-file NSIS installer also pass.

The connected release host exposed the expected WinUSB JTAG Interface 0 and
preserved UART COM15, but its debugger endpoint returned
`ftdi_usb_reset failed`. Studio reported the reconnect procedure and did not
claim an upload or physical capture. A successful on-device capture therefore
remains a separate hardware acceptance step after reconnecting that endpoint.

See [Hardware Analyzer](HARDWARE_ANALYZER.md), the
[v3 architecture](architecture/v3-hardware-intelligence.md), and
[Deployment](DEPLOYMENT.md).
