# Tang FPGA Studio 3.5.0 — draft release notes

**Unreleased proposal.** Current application/package metadata remains 3.4.1.
Do not publish this draft as evidence of completed hardware or Windows acceptance.
See [release preparation](RELEASE_PREPARATION.md) for the remaining gates.

This release proposes Ubuntu 22.04, 24.04 and 26.04 x86_64 support alongside
Windows, using the same React/Rust workspace and PowerShell FPGA runner.

- Native `.deb` and AppImage distributions, writable per-user workspaces and
  offline source editing from the embedded production UI.
- Native Linux FPGA tools with a pinned, checksum-verified OSS CAD Suite;
  PowerShell 7 setup and platform-aware executable/path handling.
- Linux hardware guidance using udev/libusb and dialout for serial access.
  Windows retains its existing driver helper and build entry point.
- Unix job cancellation terminates owned child tools; portable path validation
  rejects traversal and Windows drive paths supplied on Linux.
- Automated Ubuntu application/package checks and a Windows MSVC NSIS
  install/smoke/uninstall workflow.

AppImages use the host GTK/WebKit stack. Both Linux formats require the
[documented prerequisites](LINUX.md); they do not include the full FPGA toolchain.
Console 60K place/route requires compatible Gowin EDA. AI service calls require
the user's own Codex CLI authentication.

The [validation record](LINUX_VALIDATION.md) separates implementation/build
results from physical JTAG, flash, UART and analyzer-capture evidence.
