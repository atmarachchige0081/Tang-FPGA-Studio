# Install Tang FPGA Studio on Windows

This guide starts with a normal Windows computer and ends with a verified
design running on a Tang Primer 20K Dock. No previous FPGA, Verilog, Git, or
terminal experience is required.

> **Supported setup:** Windows 10 or Windows 11, 64-bit, with a Sipeed Tang
> Primer 20K core board installed in the Dock carrier. The Lite carrier needs
> an external programmer and a different pin file, so it is not the beginner
> path described here.

> **Other supported Tang boards:** Studio 3 also includes build/programmer
> packages for Tang Nano 1K, 4K, 9K, and 20K plus Primer Core and Lite. Their
> USB/debugger behavior and I/O differ, so complete this Dock walkthrough only
> when you own the Dock. In the New Project Wizard, choose your actual board;
> it will show only compatible templates and will never apply the Dock Zadig
> procedure automatically to a different USB layout.

## What you will accomplish

By the end, you will have:

1. installed the native Tang FPGA Studio application;
2. prepared a writable FPGA workspace;
3. installed the complete open-source FPGA toolchain;
4. simulated the first project and viewed its waveforms;
5. connected and detected the Tang Primer 20K safely;
6. built an FPGA bitstream; and
7. uploaded the first program to SRAM and controlled the Dock LEDs.

The first full setup requires an internet connection and can take a while
because the FPGA toolchain is large. Keep several gigabytes of free disk space.

## Before you begin

### Hardware checklist

- Tang Primer 20K core board (`GW2A-LV18PG256C8/I7`)
- Tang Primer 20K **Dock** carrier board
- USB-C cable that supports **data**, not a charge-only cable
- A direct USB port on the computer; avoid a hub for the first setup

Do not connect or disconnect the core board from the Dock while USB power is
connected. Seat the core board fully in the Dock before powering it.

### Software checklist

| Software | Required? | Why it is used |
|---|---:|---|
| Windows PowerShell | Yes | Runs every setup, simulation, build, and programming command. Windows 10/11 already includes it. |
| Tang FPGA Studio installer | Recommended | Installs the native application, workspace, shortcuts, and pinned toolchain without development dependencies. |
| Git | Recommended | Downloads the repository and makes future updates easy. A ZIP download also works. |
| Visual Studio Code | Optional | Provides another code editor and ready-made FPGA tasks. The included desktop Studio works without it. |
| OSS CAD Suite | Yes | Contains Yosys, nextpnr, Project Apicula, openFPGALoader, Icarus Verilog, Verilator, GTKWave, and other FPGA tools. The repository installs it for you. |
| Zadig | Only for Dock JTAG on Windows | Changes only the Dock's JTAG USB interface to WinUSB. The repository downloads and verifies it for you. |

Installer users do **not** need WSL, Python, Node.js, Rust, `pip install`, a
virtual environment, Gowin EDA, or a paid license for this workflow.

## A note about commands

Commands in this guide go into **Windows PowerShell**.

1. Press the Windows key.
2. Type `PowerShell`.
3. Open **Windows PowerShell**.

You will see a line beginning with `PS`, for example:

```text
PS C:\Users\Alex>
```

Do not type the `PS C:\Users\Alex>` part. Type only the commands shown inside
the code boxes, then press Enter.

## Step 1 — Check PowerShell

Run:

```powershell
$PSVersionTable.PSVersion
```

The first number under `Major` should be `5` or greater. Windows 10 and 11
normally include PowerShell 5.1, which is supported.

If Windows says scripts are disabled later, allow scripts only inside the
current PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

This temporary setting disappears when that PowerShell window is closed. Do
not change the machine-wide execution policy for this project.

## Step 2 — Install the one-file Windows application

1. Open the [latest installer release](https://github.com/atmarachchige0081/Tang-FPGA-Studio-Installer/releases/latest).
2. Download `TangPrimerFPGAStudio-Setup-X.Y.Z.exe`.
3. Double-click it and keep **Install or verify the pinned FPGA toolchain** and
   **Create a desktop shortcut** selected.
4. Finish setup, then double-click **Tang FPGA Studio** on the Desktop.

Setup creates a writable workspace at
`Documents\Tang Primer FPGA Studio` and never overwrites existing user projects.
The first setup downloads roughly 1.9 GB of FPGA tools, so it needs internet
access and several gigabytes of free space. Windows may show **Unknown
publisher** until the project obtains a commercial Authenticode certificate;
the release page provides a SHA-256 checksum and signed GitHub provenance.

If you installed this way, Git and VS Code in Steps 3–5 are optional. To use
the PowerShell commands later, open PowerShell and run:

```powershell
Set-Location "$env:USERPROFILE\Documents\Tang Primer FPGA Studio"
```

## Step 3 — Install Git (recommended)

Git is the easiest way to download this project and receive future updates.

### Option A: install using one command

Run PowerShell normally, not as Administrator:

```powershell
winget install --id Git.Git -e --source winget
```

### Option B: use the installer

Download Git from the [official Git for Windows page](https://git-scm.com/install/windows),
run the installer, and keep its default beginner-friendly options.

After either option, close PowerShell, open it again, and run:

```powershell
git --version
```

Any recent `git version 2.x.x` result is acceptable.

### If you do not want Git

You can use the ZIP method in Step 5. A GitHub account is not required because
the repository is public.

## Step 4 — Install Visual Studio Code (optional)

Skip this step if you want to use only Tang FPGA Studio.

1. Download the **User Setup** installer from the
   [official VS Code Windows guide](https://code.visualstudio.com/docs/setup/windows).
2. Run the installer with its default options.
3. Close and reopen PowerShell.
4. Verify it:

```powershell
code --version
```

The FPGA setup later attempts to install the repository's recommended Verilog
extension automatically when the `code` command is available.

## Step 5 — Optional source checkout

Skip this step when you used the one-file installer. Developers and users who
prefer a portable source checkout can choose one of the following methods.

### Method A: clone with Git (recommended)

Move to your Desktop, clone the public repository, and enter its folder:

```powershell
Set-Location "$env:USERPROFILE\Desktop"
git clone https://github.com/atmarachchige0081/Tang-FPGA-Studio.git
Set-Location .\Tang-FPGA-Studio
```

GitHub's [cloning guide](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository)
explains that cloning makes a complete local copy of the repository.

### Method B: download a ZIP without Git

1. Open the [Tang FPGA Studio repository](https://github.com/atmarachchige0081/Tang-FPGA-Studio).
2. Select the green **Code** button.
3. Select **Download ZIP**.
4. In File Explorer, right-click the downloaded ZIP and select **Extract All**.
5. Open the extracted folder.
6. Click the File Explorer address bar, type `powershell`, and press Enter.

The new PowerShell window should already be inside the extracted folder.

### Confirm that you are in the correct folder

Run:

```powershell
Test-Path .\fpga.ps1
Test-Path .\boards
```

Both commands must print `True`. If either prints `False`, use `Set-Location`
to enter the folder that directly contains `README.md`, `fpga.ps1`, `boards`,
`studio`, and `projects`.

## Step 6 — Install the complete FPGA toolchain

The recommended installer performs this step automatically. If you used a
source checkout, or want to repair/verify the pinned installation, run this
command from the workspace root:

```powershell
.\fpga.ps1 setup
```

If PowerShell reports that scripts are disabled, run this once in the same
window and repeat the setup command:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\fpga.ps1 setup
```

The setup performs these actions automatically:

1. downloads the pinned Windows x64 OSS CAD Suite;
2. verifies the download with its pinned SHA-256 checksum;
3. extracts it to `C:\fpga-tools\2026-07-26\oss-cad-suite`;
4. downloads Zadig 2.9 for the optional JTAG driver step;
5. verifies Zadig's checksum and Akeo Consulting digital signature; and
6. installs the recommended VS Code Verilog extension when VS Code is found.

OSS CAD Suite includes the individual dependencies:

- **Yosys** — turns synthesizable Verilog/SystemVerilog into digital logic;
- **nextpnr-himbaechel** — places and routes that logic for the Gowin FPGA;
- **Project Apicula / gowin_pack** — creates the Tang `.fs` bitstream;
- **openFPGALoader** — detects and programs the board;
- **Icarus Verilog (`iverilog` and `vvp`)** — runs simulations;
- **Verilator** — checks RTL for mistakes and unsafe constructs; and
- **GTKWave** — displays simulation waveforms.

Installing them as one pinned suite avoids incompatible tool versions. The
official [OSS CAD Suite instructions](https://github.com/YosysHQ/oss-cad-suite-build)
also recommend a Windows installation path without spaces; this repository
uses `C:\fpga-tools` for that reason.

Expected final messages include:

```text
Installed OSS CAD Suite ...
Signed JTAG driver helper ready ...
Run '.\fpga.ps1 doctor' to validate the installation.
```

Running setup again is safe. It reuses the verified installation.

## Step 7 — Verify all installed tools

The FPGA does not need to be connected for the software part of this check.

```powershell
.\fpga.ps1 doctor -Project projects/01_button_led_pwm
```

Look under **Tools**. You should see version information for:

- Yosys
- nextpnr-himbaechel
- openFPGALoader
- Icarus Verilog
- Verilator

A warning that no JTAG probe is visible is normal before the board is
connected. A message saying the toolchain is missing is not normal; repeat
Step 6 and read the first red error rather than only the last line.

## Step 8 — Run your first simulation

Simulation checks the design on the computer before any hardware is involved.
The included first project has an automatic self-checking testbench.

Run:

```powershell
.\fpga.ps1 sim -Project projects/01_button_led_pwm
```

The important success lines are:

```text
PASS: synchronization, debounce, modes, speed, brightness, and direction verified
Simulation passed; waveform: build/waves.vcd
```

The generated waveform is saved at:

```text
projects\01_button_led_pwm\build\waves.vcd
```

If the command prints `PASS`, you have already compiled and executed your first
SystemVerilog design in simulation.

## Step 9 — Open and play the waveforms

Run one command:

```powershell
.\fpga.ps1 wave -Project projects/01_button_led_pwm
```

This reruns the simulation, opens GTKWave, loads the prepared signal list, and
shows the complete timeline. In GTKWave:

1. use the mouse wheel or toolbar magnifiers to zoom;
2. drag the bottom scrollbar to move through time;
3. select a signal to inspect its changing value; and
4. close GTKWave when finished.

For the combined lint, simulation, and waveform workflow, use:

```powershell
.\fpga.ps1 debug -Project projects/01_button_led_pwm
```

## Step 10 — Open the beginner desktop Studio

If you used the installer, double-click **Tang FPGA Studio** on the Desktop or
open it from the Start menu. It automatically opens the writable workspace in
Documents and does not require an online account or send telemetry.

Source contributors can run the native application with:

```powershell
Set-Location .\studio
npm install
npm run desktop
```

Node.js and Rust are development requirements only; installer users do not need
them. If the source command says Cargo is missing, run `npm run desktop:doctor`
and reopen the terminal once.

Inside the Studio:

1. confirm that `projects/01_button_led_pwm` is the active project;
2. open `rtl/top.sv` from **Project files**;
3. use **Simulate** to repeat Step 8;
4. use **Waveform** to repeat Step 9;
5. read the beginner-friendly message in the **Output** panel; and
6. switch dark/light mode with `Ctrl+Shift+L`, or press `Ctrl+K` to search all
   actions.

Where beginners put code:

| Folder | What belongs there |
|---|---|
| `rtl/` | Synthesizable Verilog/SystemVerilog that will become hardware |
| `sim/` | Testbenches and waveform layouts used only on the computer |
| `constraints/` | Connections between top-level signal names and physical FPGA pins |
| `build/` | Generated output; do not put source code here |

## Step 11 — Connect the Tang Primer 20K safely

1. Close the Studio for the moment so the first hardware diagnosis is easy to
   read in PowerShell.
2. Disconnect USB power from the Dock.
3. Confirm the Tang Primer 20K core is fully seated in the Dock.
4. Put Dock DIP switch **1 DOWN** to enable the FPGA core.
5. Connect the Dock USB-C port marked **JTAG/UART** directly to the computer
   using a data-capable cable.
6. Wait a few seconds for Windows to enumerate both USB interfaces.

Sipeed's [official Primer 20K documentation](https://wiki.sipeed.com/hardware/en/tang/tang-primer-20k/primer-20k.html)
confirms that Dock switch 1 must enable the core before the debugger can use
it.

Run the diagnosis again:

```powershell
.\fpga.ps1 doctor -Project projects/01_button_led_pwm
```

The Dock exposes two independent USB functions. This distinction is critical:

| USB function | Identity | Required Windows driver | Purpose |
|---|---|---|---|
| Converter **A** | Interface 0 / `MI_00` | **WinUSB** | JTAG detection and FPGA programming |
| Converter **B** | Interface 1 / `MI_01` | FTDI serial/VCP driver | UART COM port |

Do not choose an interface based only on a vague “Interface 1” or “Interface
2” label. Verify **Converter A / Interface 0 / MI_00** for JTAG. Never replace
the driver for Converter B / MI_01 during this setup.

Changing the Windows driver for Converter A does not rewrite or damage the
FPGA. It only changes how Windows applications access that one USB interface.

## Step 12 — Configure the JTAG driver if Doctor requests it

Skip this step if Doctor already scans the programmer without an access error.

If Doctor says that JTAG interface A is not using WinUSB, run:

```powershell
.\fpga.ps1 driver
```

The command first checks that the correct `MI_00` interface is connected and
that the downloaded Zadig executable has a valid Akeo Consulting signature.
Zadig then opens and may request Administrator approval.

In Zadig:

1. select **Options > List All Devices**;
2. select **USB Serial Converter A**;
3. confirm its identity is Interface 0 / `MI_00`;
4. select **WinUSB** as the new driver;
5. select **Replace Driver** or **Install Driver**; and
6. wait for the successful installation message, then close Zadig.

**Stop if you selected Converter B or `MI_01`.** That interface must retain its
FTDI serial driver so it can appear as a COM port. Zadig's official site
explains that it installs generic drivers such as WinUSB and that its signed
executable requires no traditional installation: [zadig.akeo.ie](https://zadig.akeo.ie/).

Unplug the Dock, reconnect it, and run:

```powershell
.\fpga.ps1 doctor -Project projects/01_button_led_pwm
```

## Step 13 — Detect the FPGA

Run:

```powershell
.\fpga.ps1 detect -Project projects/01_button_led_pwm
```

Success means openFPGALoader lists a device in the JTAG chain without a USB
permission/access error. Do not continue to programming if detection fails.

## Step 14 — Build your first hardware program

Run:

```powershell
.\fpga.ps1 build -Project projects/01_button_led_pwm
```

This performs synthesis, Gowin placement/routing, timing checks, and bitstream
packing. A successful build ends with a message similar to:

```text
Build complete: ...\projects\01_button_led_pwm\build\top.fs (... bytes)
Reports: build/yosys.log and build/timing.json
```

The hardware program is:

```text
projects\01_button_led_pwm\build\top.fs
```

## Step 15 — Upload the first program to SRAM

SRAM is the safest first hardware test because it is temporary. The design
disappears when the board loses power.

Because Step 14 already built the bitstream, upload it without rebuilding:

```powershell
.\fpga.ps1 upload -NoBuild -Project projects/01_button_led_pwm
```

Expected final message:

```text
Uploaded to FPGA SRAM. This image is lost when power is removed.
```

The Dock's six user LEDs should now animate. Try the five buttons:

| Button | Result |
|---|---|
| BTN0 | Select the next LED mode |
| BTN1 | Increase animation speed |
| BTN2 | Decrease animation speed |
| BTN3 | Increase manual PWM brightness |
| BTN4 | Reverse chase direction |

The four modes are binary counting, a chasing LED, manual PWM brightness, and
automatic breathing. You have now run your first FPGA program on real hardware.

## Step 16 — Optional persistent flash

Do this only after simulation, detection, build, and SRAM upload all succeed.
Persistent flash makes the design start again after power is removed.

```powershell
.\fpga.ps1 flash -NoBuild -Project projects/01_button_led_pwm
```

Expected final message:

```text
Programmed and verified persistent flash.
```

| Command | Storage | Survives power-off? | Beginner use |
|---|---|---:|---|
| `upload` | FPGA SRAM | No | Normal edit/test loop; use this first |
| `flash` | External configuration flash | Yes | Only after the SRAM behavior is correct |

## The shortest daily workflow

After the one-time installation, open PowerShell in the repository and use:

```powershell
.\fpga.ps1 sim -Project projects/01_button_led_pwm
.\fpga.ps1 lint -Project projects/01_button_led_pwm
.\fpga.ps1 build -Project projects/01_button_led_pwm
.\fpga.ps1 upload -NoBuild -Project projects/01_button_led_pwm
```

Or launch the graphical workspace:

1. double-click **Tang FPGA Studio** on the Desktop;
2. choose `01_button_led_pwm` in the project selector; and
3. use Simulate, Build, then SRAM from the toolbar.

## Troubleshooting checkpoints

### The Desktop shortcut does not open

- Start **Tang FPGA Studio** from the Windows Start menu once.
- Repair the application from **Settings → Apps → Installed apps**.
- Source contributors should run `npm run desktop:doctor` inside `studio`.
- Startup failures are recorded in
  `%LOCALAPPDATA%\Tang FPGA Studio\logs\crash.log`.

### PowerShell says the script cannot be loaded

Run this in the current PowerShell window, then retry the command:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### Setup reports a download or checksum error

- Confirm the internet connection is stable.
- Confirm there is free space on drive `C:`.
- Run `.\fpga.ps1 setup` again. The installer validates cached downloads and
  replaces a file whose checksum is wrong.
- Do not download similarly named toolchain executables from unofficial sites.

### Simulation fails

- Confirm `Test-Path .\fpga.ps1` prints `True`.
- Run `.\fpga.ps1 doctor -Project projects/01_button_led_pwm`.
- Read the first error from the simulation output.
- Restore unintentional edits with a fresh Git clone or ZIP extraction.

### GTKWave does not open

First confirm simulation passes, then run:

```powershell
.\fpga.ps1 wave -Project projects/01_button_led_pwm
```

The command should create `projects\01_button_led_pwm\build\waves.vcd` before
opening GTKWave.

### No JTAG probe is found

Check these in order:

1. the core board is firmly seated;
2. Dock DIP switch 1 is DOWN;
3. the cable is connected to the JTAG/UART USB-C port;
4. the cable supports data;
5. the Dock is connected directly rather than through a hub;
6. Converter A / Interface 0 / `MI_00` uses WinUSB; and
7. `.\fpga.ps1 detect -Project projects/01_button_led_pwm` is retried after
   unplugging and reconnecting USB.

If Windows never exposes the programmer, follow Sipeed's
[official BL702 debugger update guide](https://wiki.sipeed.com/hardware/en/tang/common-doc/update_debugger.html).
Firmware updating is intentionally not automated because it requires placing
the debugger into a special boot mode and choosing the correct attached device.

### A COM port disappeared after using Zadig

Converter B / `MI_01` may have been changed accidentally. Do not change more
drivers at random. In Windows Device Manager, identify the B / `MI_01`
interface and restore its FTDI USB serial/VCP driver, then reconnect the Dock.
Converter A / `MI_00` should remain WinUSB.

### Build succeeds but upload cannot open the USB device

The FPGA tools are working; the problem is the Windows JTAG driver. Repeat
Steps 11–13 and change only Converter A / `MI_00` to WinUSB.

If the output says `usb bulk write failed` or the programmer times out, do not
change drivers again. Unplug the board USB cable, wait three seconds, reconnect
it, run Detect JTAG, and retry SRAM. Studio stops a non-responsive programmer
after 90 seconds and keeps the editor responsive.

If an older checkout reports `FsParser: checksum data is truncated`, rebuild
with the current Studio before uploading. Current builds use an uncompressed,
structurally validated Gowin FS file that is compatible with the pinned
openFPGALoader.

### Upload succeeds but the LEDs do not animate

- Confirm this is the Dock carrier, not the Lite carrier.
- Confirm DIP switch 1 is DOWN.
- Confirm the active project is `projects/01_button_led_pwm`.
- Power-cycle the Dock and upload to SRAM again.

## Updating later

If you cloned with Git and have not modified tracked repository files:

```powershell
git pull
.\fpga.ps1 setup
```

The second command safely checks whether the pinned toolchain for that version
is already installed.

## Next learning step

Open the [Project 01 guide](projects/01_button_led_pwm/README.md), then study
these files in order:

1. [`rtl/top.sv`](projects/01_button_led_pwm/rtl/top.sv) — how modules connect;
2. [`rtl/input_synchronizer.sv`](projects/01_button_led_pwm/rtl/input_synchronizer.sv) — safe asynchronous input handling;
3. [`rtl/button_debouncer.sv`](projects/01_button_led_pwm/rtl/button_debouncer.sv) — stable button events;
4. [`rtl/led_mode_controller.sv`](projects/01_button_led_pwm/rtl/led_mode_controller.sv) — counters, state, PWM, and modes; and
5. [`sim/tb_top.sv`](projects/01_button_led_pwm/sim/tb_top.sv) — how the automatic verification works.

Press `Ctrl+K` in Tang FPGA Studio and search for the Pattern Library when you
are ready to browse the categorized HDL examples and create your own modules.
