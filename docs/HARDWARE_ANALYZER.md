# Hardware Analyzer

FPGA Studio 3.0 includes a local, open-source on-chip analyzer for supported
Gowin/Tang projects. It instruments the exact post-synthesis user netlist,
builds a separate image, uploads that image only to volatile SRAM, and returns
captured samples through a board UART. The normal source files and normal
`build/top.fs` are not changed.

## Beginner workflow

1. Run **Build** once. This creates the normal bitstream and the IO-pad-free
   synthesized design used for probe discovery.
2. Open **Analyzer**, press **Refresh**, and search the synthesized hierarchy.
3. Select 1–16 signals up to 128 total bits. Oversized or optimized-away
   signals remain unavailable instead of being guessed.
4. Choose the implemented clock, 64–4096 samples, pre-trigger depth, analyzer
   UART pins, baud rate, and zero or more trigger clauses. Trigger clauses are
   combined with AND.
5. Press **Save probes**, then **Build analyzer**. Studio generates files only
   under `build/analyzer/` and reports the measured LUT/FF/RAM and Fmax cost.
6. Press **Upload SRAM**. This image disappears on power-off; persistent flash
   is never used by the analyzer workflow.
7. Select the board UART COM port, press **Arm & capture**, and cause the event.
   The result is labelled measured and shown in the integrated waveform view.
8. Upload the normal project again, or power-cycle the board, to restore the
   non-instrumented design.

The analyzer transport temporarily owns its selected RX/TX top-level ports in
the instrumented image. Do not run the project's normal UART terminal on those
same pins during a capture.

## Trigger and storage model

- level high or low;
- rising or falling edge;
- vector equality and inequality;
- multiple conditions combined with AND;
- circular pre-trigger storage followed by the configured post-trigger window;
- 64, 128, 256, 512, 1024, 2048, or 4096 samples.

Configuration validation occurs before any build. Missing clocks or transport
ports, illegal synthesized names, excessive channel width, invalid depths,
impossible trigger values, stale synthesis artifacts, and conflicting port use
produce an actionable error without modifying the project.

## Evidence and cost

Before implementation, Studio labels analyzer cost as an estimate. After a
successful analyzer place-and-route, it compares normal and instrumented
reports and labels the LUT, FF, block RAM, and Fmax deltas as measured. A
successful JTAG upload proves transport/programming only; a waveform becomes
hardware evidence only after valid capture bytes are decoded.

## Files and recovery

User configuration is stored in `.fpga-studio/analyzer.json`. Generated HDL,
linked netlists, timing reports, bitstreams, and captures stay under
`build/analyzer/`. Both locations are project-local and ignored by Git; build
outputs are reproducible from the saved configuration and baseline synthesis.

If JTAG reports an FTDI reset or bit-bang error, unplug and reconnect the board,
close other programmer applications, run **Detect JTAG**, and retry SRAM. On a
Primer Dock, Interface 0 should use WinUSB and Interface 1 should remain the
FTDI UART driver. FPGA Studio never changes either driver automatically.

Analyzer support depends on the selected board exposing a usable UART pair and
on the selected probes surviving synthesis. Designs that consume nearly all
logic/RAM or fail timing may not fit with instrumentation; Studio reports this
as an analyzer-image failure and leaves the normal image usable.
