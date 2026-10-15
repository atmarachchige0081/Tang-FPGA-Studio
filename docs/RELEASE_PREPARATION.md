# Windows and Ubuntu release preparation

Prepared version: **3.5.0**, reflecting the added platform. This is a preparation
record, not authorization to publish an unverified release. No tag is created.

## Evidence and remaining gates

| Gate | Status / evidence |
| Version metadata and release notes | Aligned at 3.5.0; unpublished |
| Fresh 3.5.0 distribution packages | Pending rebuild and validation; saved artifacts are 3.4.1 |
| --- | --- |
| Ubuntu 22.04/24.04 native installed workflow | Passed 17 checkpoints each; `evidence/linux/verified-ubuntu*-results.json` |
| Ubuntu 26.04 final native workflow | Passed all 17 checkpoints on 2026-10-15; `evidence/linux/verified-ubuntu26-results.json` |
| AppImage UI on 22.04/24.04/26.04 | Passed seven checkpoints each; `evidence/linux/verified-appimage*-results.json` |
| Six open-source board families | Bitstreams and timing passed; `evidence/linux/board-builds.json` |
| Windows MSVC NSIS installation | New `Windows MSVC package validation` workflow prepared; not run here |
| Windows GUI and complete one-file installer | Pending real Windows execution and external installer-repository evidence |
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
tests, six aligned version fields and locked Cargo metadata passed. Evidence is
in `evidence/release-3.5.0/`. These checks do not replace fresh native packages or
the external release gates above.

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

Until fresh 3.5.0 package builds and checks are complete, local packages in
`build/linux-evidence/packages/` remain development 3.4.1 artifacts.
