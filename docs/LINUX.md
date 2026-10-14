# Ubuntu Linux development and packages

Target: Ubuntu 22.04 and newer LTS releases, **x86_64**. Linux uses the same
Rust/React application, project formats and FPGA build implementation as Windows.
The Linux pipeline explicitly tests Ubuntu 22.04, 24.04 and 26.04. A configured CI job
is not evidence that a particular revision passed it; see the validation report.

## From source

Install Node.js 24 and stable Rust from their official distributions. Then:

```bash
bash scripts/setup-ubuntu.sh
bash scripts/setup-toolchain-linux.sh
cd studio
npm ci
npm run desktop:doctor
npm run desktop
```

The prerequisite script explicitly uses sudo for system packages and configures
Microsoft's signed APT repository if PowerShell 7 (`pwsh`) is missing on 22.04/24.04. On 26.04, where that feed does not yet publish PowerShell, it installs the pinned upstream 7.6.7 portable runtime after verifying its upstream SHA-256. FPGA
commands share the maintained `fpga.ps1` runner with Windows. The Linux OSS CAD
Suite archive is pinned to 2026-07-26 and its upstream SHA-256 is checked before
extraction. It includes Yosys, nextpnr-himbaechel, Apicula, Icarus, Verilator,
GTKWave and openFPGALoader. No Windows executable is used on Linux.
Ubuntu 26.04 renamed the WebDriver test package to `webkitgtk-webdriver`;
22.04/24.04 use `webkit2gtk-driver`.

The toolchain defaults to
`${XDG_DATA_HOME:-$HOME/.local/share}/tang-fpga-studio/toolchains/2026-07-26/oss-cad-suite`.
Set `OSS_CAD_SUITE_ROOT` for a different existing installation. If the install
location is customized with `TANG_TOOLCHAIN_BASE`, also set `OSS_CAD_SUITE_ROOT`.
Desktop launchers must inherit overrides; starting Studio from a terminal is a
simple way to verify them.

## Installable packages

```bash
cd studio
npm run desktop:build
# Outputs: src-tauri/target/release/bundle/deb/ and appimage/
```

Use this desktop build entry point: it enables Tauri's embedded production UI
and finalizes the AppImage. Plain `cargo build --release` is not an equivalent
distribution build and can leave the executable pointing at the development URL.

Build Linux packages on Ubuntu 22.04 to establish the oldest supported glibc
baseline. Do not build a release on a newer distribution and infer 22.04 support.
The Windows entry point and NSIS configuration remain available on Windows.
After a release is published, Linux packages and SHA256SUMS are attached only
after the Ubuntu matrix passes. The existing Windows installer notification
pipeline is preserved. No release/tag is created by development validation.

Install a local `.deb` with `sudo apt install ./Tang*.deb`. Run the prerequisite
script above before FPGA commands: PowerShell is an explicit tool prerequisite,
rather than an unsatisfiable APT dependency on 26.04. AppImages deliberately use
the host GTK/GLib/WebKit desktop libraries to avoid mixing older bundled libraries
with newer system graphics and GIO modules. They require
PowerShell 7, Git, Python 3, WebKitGTK 4.1, GTK 3, libusb and the FPGA tools too; they are
not self-contained FPGA toolchain installers. On Ubuntu 22.04, AppImage mounting
may require `libfuse2`; `--appimage-extract-and-run` avoids FUSE. Ubuntu 24.04 uses
`libfuse2t64` for FUSE 2 compatibility.

Packaged resources include the workspace, templates, board definitions, patterns,
plugins and scripts. First GUI launch seeds a writable, version-specific workspace
under the application's XDG data directory. Existing files are never overwritten.
Use `--workspace /absolute/path` or `FPGA_STUDIO_WORKSPACE` to select an existing
checkout instead. Processes and serial sessions must restart after app shutdown.

## JTAG and UART permissions

Linux uses libusb/udev, not Zadig or WinUSB. Review and install the supplied rules:

```bash
sudo install -m 0644 scripts/60-tang-fpga-studio.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo usermod -aG dialout,plugdev "$USER"
```

Log out and back in, then unplug/reconnect the board. Do not run Studio as root.
For the installed `.deb`, a copy of the rules is in
`/usr/share/doc/tang-fpga-studio/`. The rules cover the FTDI IDs used by the
bundled board profiles; external programmers may require their vendor's rules.
Close competing FPGA programmers before Detect. Do not automatically unload USB
kernel drivers or change permissions globally. UART ports normally appear as
`/dev/ttyUSB*`, `/dev/ttyACM*`, or stable `/dev/serial/by-id/*` paths.

Use Detect, then SRAM upload, then observe the design. Persistent Flash remains
an explicit user action with confirmation. A successful build does not prove USB
access, programming, board behavior or measured logic-analyzer captures.

## Validation

```bash
cd studio && npm run check
cd src-tauri
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cd ../..
python3 -m unittest discover -s ide/tests -v
bash scripts/test-linux-workflows.sh
pwsh -NoProfile -File scripts/test-board-profiles.ps1 -KeepArtifacts
```

The workflow script exercises real lint and self-checking simulation for all
eight CI examples, synthesis/place-and-route/packing with timing assertions,
external paths containing spaces, rejected testbench traversal and safe cleanup.
The native serial regression uses a real OS pseudo-terminal; it is not a physical
UART or JTAG test. Desktop WebDriver validation must use the packaged release UI,
not Vite's browser preview.

For the installed desktop (with `tauri-driver`, WebKitWebDriver, Xvfb and scrot):

```bash
xvfb-run -a -s '-screen 0 1600x1200x24' dbus-run-session -- \
  python3 scripts/test-linux-desktop.py /usr/bin/fpga-studio --output build/linux-evidence/native
APPIMAGE_EXTRACT_AND_RUN=1 xvfb-run -a -s '-screen 0 1600x1200x24' dbus-run-session -- \
  python3 scripts/test-linux-desktop.py '/path/to/Tang FPGA Studio_3.4.1_amd64.AppImage' \
  --ui-only --output build/linux-evidence/appimage
```

The AppImage UI check verifies resource seeding, project save/read, native APIs,
offline source editing and Linux hardware guidance. The full desktop check also
runs real FPGA implementations. Both save screenshots and structured results.

## Features requiring external prerequisites

- Console 60K still needs a compatible **Linux Gowin EDA** installation and any
  required vendor license. Set `GOWIN_EDA_ROOT` to its installation directory.
  This target's integrated open-source analyzer remains unsupported because the
  pinned database lacks GW5AT-60B, as on Windows.
- AI Assistant requires the official Codex CLI in PATH and the user's own local
  authentication. Automated provider fixtures test protocol behavior but do not
  establish successful authenticated service calls.
- Physical JTAG, SRAM/flash programming, UART and on-chip capture need supported
  hardware. They must be tested on a real Ubuntu workstation before declaring
  complete hardware feature parity or publishing a dual-platform release.
