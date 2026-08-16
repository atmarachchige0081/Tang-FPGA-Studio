# Hardware Intelligence laboratory

This project is the FPGA Studio 3.0 guided demonstration. It combines a small
UART protocol, visible state transitions, a heartbeat, PWM, error evidence, and
an intentionally deep registered data path that is useful in every intelligence
view.

The normal UART replies `K` when it receives `P`; unknown bytes receive `?`.
The self-checking simulation verifies that reply, the internal event counter,
and the error flag.

## Guided flow

1. Run **Simulate** and inspect `event_count`, `protocol_state`, `pwm_level`,
   `pwm_out`, `timing_mix`, and `last_command` in the simulation waveform.
2. Run **Build**, then open **Trace**. Select the measured critical path and
   follow its source, cell, net, physical location, and delay segments.
3. Open **Analyzer**. Select `event_count`, `protocol_state`, `pwm_counter`,
   `pwm_out`, `timing_result`, `last_command`, and `error_flag`. Use
   `clk_27mhz`, `uart_rx`, and `uart_tx` for the analyzer clock and transport.
4. Set a compare trigger such as `last_command == 0x50`, save the probes, build
   the analyzer image, and upload it to **SRAM**. Persistent flash is not used.
5. Arm the capture and send `P` from the host. The measured capture appears in
   the same waveform language as simulation.
6. Open **Design Health** to inspect analyzer cost, evidence-backed timing
   recommendations, snapshots, experiment results, and regression thresholds.
7. After testing the board, use **Verify** to record exactly what you observed.

Generated instrumentation lives under `build/analyzer/`; the source in `rtl/`
is never edited by the analyzer or optimizer.
