# Tang FPGA Studio 3.1 — Tang Console support

Tang FPGA Studio 3.1 adds the Sipeed Tang Console 60K and current C-revision
Tang Console 138K as complete board packages, not UI aliases. Board selection
now carries the exact part, device/revision, oscillator, electrical constraints,
timing constraint, build backend, and programmer alias from project creation
through reopen, build, and programming.

## Hardware configuration

| Target | FPGA and Gowin device | Clock | Buttons | LEDs | Programmer | Build route |
|---|---|---:|---|---|---|---|
| Tang Console 60K | `GW5AT-LV60PG484AC1/I0`, `GW5AT-60B`, PG484A, revision B | `V22`, 50 MHz | `AB13`/`AA13`, active-low, `LVCMOS15` | `G11`/`U12`, active-low, `LVCMOS33` | `tangconsole`, BL616 | Gowin EDA |
| Tang Console 138K | `GW5AST-LV138PG484AC1/I0`, `GW5AST-138C`, PG484A, revision C | `V22`, 50 MHz | `AB13`/`AA13`, active-low, `LVCMOS33` | `G11`/`U12`, active-low, `LVCMOS33` | `tangmega138k`, BL616 | Pinned OSS CAD Suite |

The two packages are intentionally independent. In particular, the button-bank
voltage differs, and Gowin documents a B-to-C silicon change for 138K devices.
The C-revision profile must not be silently used for an older B-revision SOM.

Hardware facts were cross-checked against Sipeed's
[Tang Console documentation](https://wiki.sipeed.com/hardware/en/tang/tang-console/mega-console.html),
[IDE/device table](https://wiki.sipeed.com/hardware/en/tang/common-doc/get_started/install-the-ide.html),
[Tang Mega 60K documentation](https://wiki.sipeed.com/hardware/en/tang/tang-mega-60k/mega-60k.html),
[Tang Mega 138K documentation](https://wiki.sipeed.com/hardware/en/tang/tang-mega-138k/mega-138k.html),
and Sipeed's official
[60K](https://github.com/sipeed/TangMega-60K-example) and
[138K](https://github.com/sipeed/TangMega-138K-example) reference projects.
Carrier pin/electrical mappings were independently compared with the open
[NanoApple2 Console constraints](https://github.com/MiSTle-Dev/NanoApple2) and
[SNESTang Console constraints](https://github.com/nand2mario/snestang).

## Beginner workflow

1. Open **New FPGA project**.
2. Select **Tang Console LED and buttons**.
3. Choose **Sipeed Tang Console 60K** or **Sipeed Tang Console 138K**.
4. Run **Simulate** to verify the lesson without hardware.
5. Run **Build**. Studio chooses the recorded backend and shows a focused
   Gowin EDA prerequisite if a 60K user has not installed it.
6. Connect the board's MCU/JTAG-UART port, run **Detect**, then use **SRAM** for
   volatile testing before persistent flash.

The generated project contains only its Console `.cst` and `.sdc`; no Primer
constraint remains. Closing/reopening reads the unchanged board ID from
`fpga.project.json`.

## Toolchain boundary

The v3.1 pinned OSS CAD Suite contains Yosys `gw5a` support and a full
`GW5AST-138C` nextpnr/Apicula database, but it does not contain a `GW5AT-60B`
database. Console 60K therefore generates and runs a Gowin EDA version-5
project using `gw_sh`, with SystemVerilog 2017, explicit `GW5AT-60B` /
`gw5at60b-002`, and uncompressed bitstreams compatible with Studio's safety
checks. Sipeed requires Gowin EDA Education 1.9.11.03 or newer for this device.

## Validation evidence

- Board registry/device/revision/constraint/programmer tests: passed.
- Project generation and stale-constraint removal for both boards: passed.
- Console starter self-checking simulation: passed.
- Full parallel bitstream smoke build for Console 138K plus five existing
  device families: passed.
- Six-design Console 138K build matrix: passed with real synthesis,
  place-and-route, packing, and bitstream validation.
- Six-design Console 60K Yosys and generated Gowin `.gprj`/Tcl matrix: passed.
- Frontend type check, production build, and UI tests: see the tagged release
  workflow and release notes.

Gowin EDA is not installed on the release machine, and no physical Tang Console
was available. Consequently, 60K place-and-route/bitstream generation and live
Console JTAG/SRAM/flash/I/O behavior were not performed and are not claimed.
The previously connected Primer 20K is a different target and cannot validate
Console hardware.
