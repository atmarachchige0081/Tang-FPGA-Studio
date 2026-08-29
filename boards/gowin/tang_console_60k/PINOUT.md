# Tang Console 60K carrier pin reference

The shipped `.cst` intentionally claims only signals used by the starter. Add
peripheral ports deliberately from this verified carrier subset and the
official Sipeed reference project; constraints for top-level ports that do not
exist can stop implementation.

| Interface | FPGA pins | Notes |
|---|---|---|
| 50 MHz oscillator | `V22` | `LVCMOS33` |
| USER / RESET buttons | `AB13`, `AA13` | active-low; **60K uses `LVCMOS15`, bank 1.5 V** |
| DONE / READY LEDs | `G11`, `U12` | active-low, `LVCMOS33` |
| PMOD0 IO0–IO7 | `V18`, `V19`, `G21`, `G22`, `F18`, `E18`, `C22`, `B22` | 3.3 V carrier I/O |
| PMOD1 IO0–IO7 | `W19`, `W20`, `F19`, `F20`, `E22`, `D22`, `E21`, `D21` | 3.3 V carrier I/O |
| microSD clock/cmd/data0–3 | `V15`, `Y16`, `AA15`, `AB15`, `W14`, `W15` | add pull/drive settings from the official example |
| HDMI clock pair | `G15`, `G16` | differential output pair |
| HDMI data pairs 0–2 | `J14/H14`, `J15/H15`, `K17/J17` | differential output pairs |

The onboard BL616 owns JTAG/UART and companion links. Reference designs use
`V14`/`U15` for the default debugger UART/JTAG-select path and `R14`/`P14` for
the monitor path, but companion firmware can change routing. Do not copy a UART
pair without checking the installed BL616 firmware and intended mode.

DDR3, USB3, PCIe, RGB, and the 2×40 headers require the complete Sipeed
schematic/reference constraint and interface-specific electrical/timing work;
they are capabilities of the board, not safe generic GPIO aliases.
