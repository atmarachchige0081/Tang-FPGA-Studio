# Linux validation record

Validation dates: 2026-10-14 and 2026-10-15. Base revision: `84e97ee7889e5edc0a26680dfdcd8ff5b03c7591`, with Linux implementation committed as `4b5a1cf`. These are development artifacts, not a tagged release.

## Environment and method

The production executable and packages were built on Ubuntu 22.04 x86_64. Runtime checks use Ubuntu 22.04, 24.04 and 26.04 containers, ordinary users, Xvfb, real WebKitGTK and native Tauri IPC. The embedded production UI runs without Vite. Containers permit WebKit's own process sandbox; no WebKit sandbox-disabling switch is used. This validates userspace behavior, not workstation USB access or a complete desktop distribution.

PowerShell 7.6.7 and checksum-verified OSS CAD Suite 2026-07-26 provide the shared FPGA runner. Ubuntu 26.04 uses the verified upstream portable PowerShell runtime because its Microsoft APT feed does not supply the package.

## Completed checks

| Check | Result |
| --- | --- |
| Frontend | 57 tests passed across 19 files; TypeScript and production build passed |
| Python | 37 tests passed |
| Native Rust, Ubuntu 22.04 | 72 passed, 2 explicitly ignored; formatting and release Clippy with warnings denied passed |
| Dependency audit | No reported vulnerabilities |
| Shared PowerShell runner | Eight examples linted and self-checking simulations passed; full implementation and timing check passed |
| Paths and cleanup | External project path containing spaces, traversal rejection and safe cleanup passed |
| Native Ubuntu 22.04 desktop | Full workflow and editor/hardware screenshots passed |
| Native Ubuntu 24.04 desktop | Full workflow and editor/hardware screenshots passed |
| Native Ubuntu 26.04 desktop | Final installed package passed all 17 checkpoints on 2026-10-15; native screenshots and results committed under `docs/evidence/linux/`. |
| AppImage | Built on 22.04; native UI, resource seeding, project save/read, offline Monaco and hardware guidance passed on 22.04, 24.04 and 26.04 |
| Windows compile | GNU Windows target, release all-targets check passed; this is not MSVC or Windows execution evidence |

The full native desktop test exercises writable packaged resources, boards/patterns/plugins, project creation, save/read, HDL indexing/search, Git discovery, lint, simulation, bitstream/timing reports, waveform/netlist/traceability APIs, analyzer configuration and instrumented bitstream generation, and a measured optimization experiment. Serial enumeration and AI provider status are checked without asserting hardware or authenticated service access. Console 60K lint, simulation, Yosys synthesis and Gowin project generation pass; absent vendor implementation is an expected prerequisite failure.

The two ignored Rust tests are retained fixture-based tests; the native desktop workflow separately exercises real analyzer-build and optimization operations. They are not counted as passing tests.

## Board implementation evidence

All six open-source device families produced nonempty packed bitstreams and met the indicated clock constraint. These are implementation timing estimates, not measured board clocks. Primer Core/Lite share the verified device family; external carrier pins remain user-defined.

| Board family | Achieved MHz | Constraint MHz |
| --- | ---: | ---: |
| Nano 1K | 245.52 | 27 |
| Nano 4K | 245.52 | 27 |
| Nano 9K | 245.52 | 27 |
| Nano 20K | 446.23 | 27 |
| Primer 20K | 427.72 | 27 |
| Console 138K C | 458.51 | 50 |

Raw reports and bitstreams are under `build/linux-evidence/` and `.fpga-studio/board-smoke/`. Native screenshots are `build/linux-evidence/verified-ubuntu22/native-desktop.png` and `build/linux-evidence/verified-ubuntu22/native-linux-hardware.png`; earlier files in `previews/` are explicitly browser previews, not package or hardware evidence. Logs are retained in `build/linux-evidence/logs/`.

## Compatibility issues addressed

- The frontend declared a Windows-only Tauri binary as a direct dependency, preventing normal Linux installation. Tauri's platform-selecting optional dependencies now choose the host binary; the Windows wrapper remains in use on Windows.
- PowerShell paths, executable names, external-project guards and environment setup assumed Windows. The shared runner now selects native Linux tools, preserves Linux filename case and supports spaces without relaxing path validation.
- Installed application resources are read-only. Linux packages seed a writable per-user workspace and preserve existing edits rather than building inside `/usr` or the AppImage mount.
- Windows USB repair advice was inappropriate on Linux. The hardware panel and native errors now explain udev/libusb and dialout; privilege changes remain explicit.
- Cancelling a Linux tool job must also stop its child tools. The runner owns and terminates its Unix process group.
- Mixing bundled Ubuntu 22.04 libraries with newer host GIO/graphics modules broke the AppImage GUI on 26.04 despite a passing headless smoke test. AppImage finalization now retains application resources and uses the host desktop libraries; its native UI is validated separately.
- New Verilator warnings, FUSE-less AppImage builders, a missing `file` packaging prerequisite, Ubuntu 26.04's renamed WebDriver package, and its absent PowerShell APT package were reproduced and addressed.
- Packaged-editor verification encountered a WebKit reload race. The test now waits for the new document and opens the exact RTL path. WebDriver transport resets are handled with read-only retries and uniquely identified IPC result polling; mutating build commands are never replayed.

## Development packages

The reviewed `.deb` and `.AppImage` are copied to `build/linux-evidence/packages/` with `SHA256SUMS`. Verify the exact downloaded files against that manifest; repackaging changes the checksums.

They retain the repository's current 3.4.1 version. Final release artifacts must be rebuilt from the eventual reviewed/tagged revision and receive fresh checksums.

## Remaining release gates

- Run the maintained Windows/MSVC build, installer and desktop regression workflow on Windows for this revision. Cross-compilation does not satisfy this gate.
- On real supported hardware, record JTAG identity, SRAM programming and observed behavior, explicit flash write and power-cycle persistence, UART transmit/receive, and actual on-chip analyzer capture. No USB board is connected to this cloud environment.
- Supply Linux Gowin EDA and any required license for Console 60K place/route and programming evidence.
- Verify authenticated AI operations with the user's own Codex CLI installation and credentials if claiming that integration as release-tested.

Do not create a dual-platform release tag until the applicable gates have recorded results. See [LINUX.md](LINUX.md) for installation and repeatable commands and `.github/workflows/linux.yml` for the Ubuntu CI matrix. A configured workflow is not evidence of a remote CI run.
