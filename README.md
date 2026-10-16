# Tang FPGA Studio

**Arduino-style simplicity for FPGA development.**

Pick a Tang board, open an example, and take your design from code to real
hardware in one desktop workspace. Tang FPGA Studio brings editing, simulation,
building and programming together so you can spend more time learning digital
design and making things.

Free and open source. Available for Windows and Ubuntu 22.04 or newer.

[Download](https://github.com/atmarachchige0081/Tang-FPGA-Studio/releases/latest) ·
[Get started](INSTALL.md) · [Linux installation](docs/LINUX.md) ·
[Examples](projects/) · [Report an issue](https://github.com/atmarachchige0081/Tang-FPGA-Studio/issues)

![Tang FPGA Studio with a Verilog project and integrated terminal](docs/images/studio-main.png)

## From your first LED to your own hardware

If you have used Arduino and want to explore FPGAs, Studio gives you a familiar
place to start: choose your board, open a project, edit, build and upload.
You write Verilog or SystemVerilog to describe digital hardware, with examples
and tools that help you understand what your circuit is doing.

Start with a blinking LED, work through buttons and PWM, then build a UART
interface or a serial command console. Each example includes source code,
board constraints and a simulation testbench you can inspect and change.

## One place to work

**Write your design.** Use a source editor with HDL completion, symbol navigation
and diagnostics. Open existing Studio projects, organize files and work in a
compact desktop layout with adjustable panels and dark or light themes.

**See how it behaves.** Run simulations and inspect waveforms before touching
the board. Explore synthesized logic, timing and resource use as your design grows.

**Run it on hardware.** Build a bitstream, upload it to SRAM for testing, or flash
it for use after power-off. JTAG checks, a UART terminal and an on-chip analyzer
help connect the code on screen to the circuit on your desk.

**Get help when you need it.** An optional AI assistant can explain code and help
make changes using project context. Review saved edits in a native before/after
view, respond to approvals and steer the conversation as you work. The editor
and FPGA tools also work without an AI account.

| Review changes before moving on | Work in light or dark |
|---|---|
| ![Saved source changes in the native review view](docs/images/studio-file-review.png) | ![The same native workspace in the light theme](docs/images/studio-main-light.png) |

Screenshots show the native Linux application with a local example project.

## Get started

1. **Install Studio.** On Windows, use the
   [guided one-file installer](https://github.com/atmarachchige0081/Tang-FPGA-Studio-Installer/releases/latest)
   for the app and FPGA toolchain setup. On Ubuntu, choose the `.deb` or AppImage
   from [Studio releases](https://github.com/atmarachchige0081/Tang-FPGA-Studio/releases/latest)
   and follow the [Linux setup guide](docs/LINUX.md).
2. **Choose a board and an example.** Create a project in Studio, or open an
   existing project folder with `Ctrl+O`. The board package supplies the target
   configuration and matching pin constraints.
3. **Simulate, build and upload.** Check the example in simulation, build it,
   then upload to SRAM and try it on your board. Use Flash when you are ready
   to keep the design after power-off.

The [installation guide](INSTALL.md) covers your first connection and driver
setup. The [IDE guide](ide/README.md) explains everyday commands and shortcuts.
FPGA tools are installed separately from the native application packages; the
Windows guided installer offers that setup for you. Check its release version,
since the installer is published through a separate pipeline.

## Supported Tang boards

| Family | Board packages |
|---|---|
| Tang Nano | 1K, 4K, 9K and 20K |
| Tang Primer | 20K with Dock; 20K Core / Lite with user-defined carrier I/O |
| Tang Console | 60K and 138K C revision |

Most targets use the open-source [OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build).
Console 60K requires Gowin EDA for place and route. Always choose the package
that matches your board revision and carrier; see the [board definitions](boards/).
Supported build targets and physical hardware test results are documented
separately in [validation scope](docs/LINUX_VALIDATION.md).

## Learn by building

| Example | What you will explore |
|---|---|
| [Buttons, LEDs and PWM](projects/01_button_led_pwm) | Inputs, debouncing, counters and brightness control |
| [UART terminal](projects/03_uart_terminal) | Serial communication between your FPGA and computer |
| [Serial command console](projects/05_serial_command_console) | A small command interface running in hardware |
| [Hardware intelligence](projects/06_hardware_intelligence) | Inspecting implementation and internal signals |

For assistant setup, see the [AI guide](docs/AI_ASSISTANT.md). For internal
signal capture, see the [analyzer guide](docs/HARDWARE_ANALYZER.md).

## Contribute

Bug reports, documentation improvements, examples and code contributions are
welcome. Start with [Contributing](CONTRIBUTING.md); build and release checks
are described in [Deployment](docs/DEPLOYMENT.md). See the [Changelog](CHANGELOG.md)
for release history and [Security](SECURITY.md) for reporting vulnerabilities.

Tang FPGA Studio is an independent project, licensed under [MIT](LICENSE).
It is not affiliated with Arduino.
