# Windows and Ubuntu release preparation

Prepared version: **3.5.0**, reflecting the added platform. This is a preparation
record, not authorization to publish an unverified release. No tag is created.

## Evidence and remaining gates

| Gate | Status / evidence |
| --- | --- |
| Version metadata and release notes | Aligned at 3.5.0; unpublished |
| Fresh 3.5.0 Linux packages | Built on Ubuntu 22.04; native/AppImage checks passed on 22.04/24.04/26.04; `evidence/release-3.5.0/SHA256SUMS` |
| Ubuntu 22.04/24.04 native installed workflow | Passed 17 checkpoints each; `evidence/release-3.5.0/ubuntu*-results.json` |
| Ubuntu 26.04 final native workflow | Passed all 17 checkpoints on 2026-10-15; `evidence/release-3.5.0/ubuntu26-results.json` |
| AppImage UI on 22.04/24.04/26.04 | Passed seven checkpoints each; `evidence/release-3.5.0/appimage*-results.json` |
| Hosted quality gates | [Passed on validation source 9b6c1e6](https://github.com/atmarachchige0081/Tang-FPGA-Studio/actions/runs/38785858242) |
| Hosted Ubuntu matrix | [Running on validation source 9b6c1e6](https://github.com/atmarachchige0081/Tang-FPGA-Studio/actions/runs/38785858828); local native/package evidence below already passed |
| Six open-source board families | Bitstreams and timing passed; `evidence/release-3.5.0/board-builds.json` |
| Windows MSVC NSIS installation | Passed: [MSVC NSIS install/smoke/uninstall run](https://github.com/atmarachchige0081/Tang-FPGA-Studio/actions/runs/38780505263) for application source `07acdf9` |
| Complete Windows one-file installer | Validation running: [pinned installer build/install/workspace/toolchain/uninstall](https://github.com/atmarachchige0081/Tang-FPGA-Studio/actions/runs/38784739248); not yet counted as passed |
| Windows 11 GUI | Pending user workstation acceptance |
| Physical board acceptance on both platforms | Pending connected hardware; no cloud USB board |
| Console 60K vendor implementation | Pending Linux Gowin EDA/license; synthesis/project generation already tested |
| Authenticated AI calls | Pending user-authenticated Codex CLI if claimed as release-tested |

The Windows package workflow tests the repository's NSIS package with an explicit
checkout workspace. It does not establish external one-file workspace provisioning,
GUI rendering, physical USB behavior or authenticated AI operation. Run it for
the reviewed commit and retain its Actions run URL, artifact and JSON result.
Existing Windows quality gates and the Ubuntu matrix must also pass that commit.

For physical acceptance, record OS/app/toolchain version, exact board package and
revision, JTAG identity, bitstream hash, SRAM observation, explicit flash write and
power-cycle observation, UART bytes in both directions, and a real analyzer
capture. Cover the claimed board matrix and distinguish shared-device Core/Lite
carrier pins from Dock pins. Do not substitute build timing for board behavior.

Local 3.5.0 commit checks: production frontend build, 57 frontend tests, 37 Python
tests, 72 Rust tests (two ignored), formatting, release Clippy, six aligned version
fields and locked Cargo metadata passed. Three stress rounds also passed: 171
frontend and 30 runner test executions. Evidence is
in `evidence/release-3.5.0/`. These checks do not replace fresh native packages or
the external release gates above.

## Candidate and hardware target

The candidate is available on branch `codex/release-3.5.0-validation`; `master`
and release tags are unchanged. The application version/React/Rust source is
`07acdf9`; subsequent validation changes stage Linux resources before Cargo and
verify WebKit navigation without replaying FPGA operations. A clean-source Cargo
check reproduced the missing-resource error and passed after staging.

The confirmed physical target is **Windows 11 + Tang Primer 20K with Dock**.
The laptop is not attached to the cloud executor. Follow
[the Windows/Dock acceptance procedure](WINDOWS11_PRIMER20K_ACCEPTANCE.md) and
record real GUI, JTAG, SRAM/flash, UART and analyzer observations. No physical
hardware pass is claimed by any cloud result.

Fresh local Linux 3.5.0 artifacts are under `build/release-3.5.0/packages/`. Their
checksums differ from the historical 3.4.1 artifacts under `build/linux-evidence/`.

## Final release sequence

1. Close the applicable evidence gaps above and attach run URLs/observations to
   this record. See `LINUX_VALIDATION.md` for current proof and limitations.
2. Verify the prepared 3.5.0 version remains aligned across `studio/package.json`,
   its lockfile root, `studio/src-tauri/Cargo.toml`, the workspace package in
   `Cargo.lock`, and `tauri.conf.json`. Release history and notes are prepared.
3. Build fresh distributions from that reviewed revision: Linux on Ubuntu 22.04
   using `npm run desktop:build`, Windows through MSVC and the maintained installer
   pipeline. Re-run package checks; old 3.4.1 artifact hashes are not new-release hashes.
4. Record SHA-256 manifests, final revision, workflow URLs and platform/board
   acceptance. Review the [release notes](RELEASE_3.5.0.md).
5. Create the agreed tag/release only after those results are recorded. The
   existing Windows installer notification and Ubuntu release workflow then
   produce/publish their platform artifacts; verify both downloads and checksums.

Historical artifacts in `build/linux-evidence/packages/` remain 3.4.1 development
evidence. Use `build/release-3.5.0/packages/` for the newly checked Linux 3.5.0
artifacts. Final tagged builds must still be tied to the reviewed final revision.
