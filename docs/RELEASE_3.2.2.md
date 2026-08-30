# Tang FPGA Studio 3.2.2 — cross-version lint compatibility hotfix

Tang FPGA Studio 3.2.2 supersedes 3.2.1 after the public Ubuntu quality gate
found a Verilator-version compatibility issue. Project formats, board routes,
and the 3.2 feature set are unchanged.

## Fixed

The pinned Windows OSS CAD Suite uses Verilator 5.051, which reports the newer
`PROCASSINIT` warning for intentional FPGA power-on initialization. Ubuntu's
stable Verilator is older and rejects that warning name when it appears in an
HDL metacomment.

The source is now version-neutral. Studio passes `-Wno-PROCASSINIT` only to the
known pinned Windows native executable, while older Verilator versions lint the
same HDL without seeing an unsupported warning code. A Python regression checks
that version-specific metacomments are absent from all maintained examples.

## Included 3.2.1 reliability fixes

- native Windows Verilator execution with a validated `VERILATOR_ROOT`;
- bounded frontend test workers and a scheduling-noise-resistant HDL benchmark;
- overflow-safe beginner UART commands and self-checking simulation;
- distinct missing-device, FTDI reset, USB enumeration, and JTAG access advice;
- execution-policy-safe Windows release and stress command wrappers.

## Verification

- 37 Python UI, project, launcher, and compatibility tests;
- 32 frontend tests and optimized production build;
- 50 passing Rust tests plus two artifact-only ignored cases;
- Clippy with warnings denied and Cargo formatting checks;
- genuine lint and simulation for all four maintained HDL projects on Windows;
- Ubuntu Verilator lint and Icarus simulation through the GitHub quality gate;
- production Tauri/NSIS package build and packaged executable launch smoke;
- clean one-file installer build, packaged provider tests, SHA-256 checksum, and
  GitHub build-provenance attestation.

## Hardware boundary

The connected computer still reports USB descriptor error `-12` and exposes no
FTDI/JTAG or COM endpoint. No upload or flash was attempted. Reconnect directly
with a known data-capable cable, confirm Hardware Doctor shows the programmer,
then validate with volatile SRAM before persistent flash.
