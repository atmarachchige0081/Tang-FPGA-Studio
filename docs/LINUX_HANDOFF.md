# Linux work handoff — 2026-10-14

Paused at the user's request to conserve credits. No release tag, push or publication was performed.

## Saved work and evidence

Ubuntu x86_64 support, Windows-compatible launch dispatch, native PowerShell/toolchain setup, udev guidance, per-user packaged resources, Unix cancellation, native regression tests, `.deb`/AppImage packaging and Ubuntu CI are implemented. Read `LINUX.md` and `LINUX_VALIDATION.md`.

Compact evidence is committed in `docs/evidence/linux/`: actual native screenshots, structured workflow results, six-board timing/bitstream summary, frontend/Python/Rust/Windows compile logs and package checksums. Large packages, bitstreams and additional logs remain local under `build/linux-evidence/` and `/workspace/.tang-linux/`; they are intentionally ignored by Git. Do not assume those ignored files survive a replacement cloud environment; rebuild them using the supported commands.

The final supported `npm run desktop:build` completed successfully. Final package checksums are saved in `docs/evidence/linux/SHA256SUMS`. The `.deb` passed all 17 native workflow checkpoints on Ubuntu 22.04 and 24.04. Final AppImages passed all seven UI checkpoints and headless smoke on 22.04, 24.04 and 26.04. Rust: 72 passed, 2 explicitly ignored; frontend: 57 passed; Python: 37 passed; Windows GNU cross-check and Clippy passed.

## Resume update — 2026-10-15

The final Ubuntu 26.04 installed package now passes all 17 checkpoints. Fresh results, screenshots, timing and experiment evidence are committed in `docs/evidence/linux/`. See `RELEASE_PREPARATION.md` for the next gates and `RELEASE_3.5.0.md` for proposed release notes. The Windows MSVC package workflow is prepared but has not been executed here. No version bump, tag or publication has occurred.

## Local release commit preparation — 2026-10-15

At the user’s request, version metadata, release history and the application’s first-launch notes are aligned at **3.5.0**. No publication or tag is authorized by that local commit. Saved binary evidence remains for the prior 3.4.1 development packages; fresh 3.5.0 packages must be built and validated before release.

## Original first task (completed on resume)

Finish the **final Ubuntu 26.04 full `.deb` run**. An earlier build passed all 17 checkpoints, but the final rebuilt artifact reached 10 checkpoints, including analyzer instrumentation/build, before this pause. Optimization, Console 60K prerequisite checks and the final screenshots must finish in a fresh run. The running driver group was stopped at pause; do not count the partial JSON as a complete pass.

Use a **new output directory and log filename for every attempt**. Reusing a filename before a stopped parent exits can mix old tracebacks into the new log. The helper now guards native IPC with unique browser-side tokens and retries delivery without starting native operations twice; read-only WebDriver queries also retry transport resets. Required assertions remain enabled.

Existing containers: `tang-ubuntu22` is the build SDK; `tang-ubuntu22-ui`, `tang-ubuntu24-ui`, `tang-ubuntu26-ui` are ordinary-user UI environments with WebKit's sandbox available. User names are `tang` on 22, `ubuntu` on 24/26. Cargo/toolchain directories are `/workspace/.tang-linux/{cargo,rustup,target}` and `/workspace/.tang-linux/toolchains/2026-07-26/oss-cad-suite`.

Example resume command from the repository:

```bash
docker exec -u ubuntu -e HOME=/home/ubuntu \
  -e OSS_CAD_SUITE_ROOT=/workspace/.tang-linux/toolchains/2026-07-26/oss-cad-suite \
  -e PATH=/workspace/.tang-linux/cargo/bin:/usr/local/bin:/usr/bin:/bin \
  tang-ubuntu26-ui xvfb-run -a -s '-screen 0 1600x1200x24' dbus-run-session -- \
  python3 scripts/test-linux-desktop.py /usr/bin/fpga-studio \
  --output build/linux-evidence/ubuntu26-resume
```

Build packages through **`npm run desktop:build`**, not plain `cargo build --release`: Tauri's production UI feature and AppImage finalization are required. A plain-Cargo rebuild was caught pointing at localhost and replaced by the supported production build. The test explicitly verifies the production URL (`tauri://localhost`).

The AppImage deliberately uses host desktop libraries. Bundling old GLib/GTK alongside newer host GIO/graphics modules broke the GUI on 26.04 despite passing headless smoke; `studio/scripts/finalize-linux-appimage.mjs` fixes this. Both package formats still require the documented PowerShell/FPGA prerequisites.

## Release gates after software validation

- Real Windows/MSVC installer and runtime regression execution. GNU cross-compilation alone is insufficient.
- Physical Tang-board JTAG, SRAM/flash plus observed behavior/power cycle, UART and analyzer capture. No USB board is attached here.
- Linux Gowin EDA/license for Console 60K place/route; current evidence covers lint, simulation, Yosys and vendor-project generation.
- Authenticated AI integration if claiming it as release-tested; no user credentials were supplied.

Do not tag a dual-platform release until the applicable gates are documented. The prepared version is 3.5.0; no release tag has been created.

## Fresh 3.5.0 evidence — 2026-10-15

Fresh production `.deb` and AppImage packages are built and checked. All three Ubuntu versions (22.04, 24.04 and 26.04) passed 17 installed native checkpoints and seven AppImage UI checkpoints plus headless smoke. See `docs/evidence/release-3.5.0/` for current results, screenshots and SHA-256 manifest; the earlier `evidence/linux/` artifacts are historical 3.4.1 evidence. Local packages remain under `build/release-3.5.0/packages/`.

Fresh Rust tests passed 72 with two intentionally ignored; formatting and release Clippy passed. Six board implementation families produced bitstreams and timing. Three stress rounds passed (171 frontend test executions and 30 runner test executions). Windows MSVC NSIS install/smoke/uninstall passed in Actions run 38780505263. Updated quality gates passed in run 38785858242.

Validation branches have been pushed without changing master or creating a tag. Ubuntu matrix run 38787507635 (source 962d2ef) and complete external Windows installer run 38784739248 are being checked. The prior Ubuntu UI run exposed test isolation hiding the default toolchain; the harness fix passed a fresh 17-checkpoint native run without an explicit toolchain override. Physical target confirmed by the user: Windows 11 laptop with Tang Primer 20K and Sipeed Dock. No connection to that laptop or physical hardware results exist here; follow `WINDOWS11_PRIMER20K_ACCEPTANCE.md`.

## Workbench and assistant follow-up

User-reported Windows 11 / Primer 20K Dock detection and flashing succeeded before
the workbench update. The earlier Ubuntu hosted matrix 38787507635 succeeded;
complete Windows installer run 38784739248 was cancelled, so it is not a pass.
New work is documented in `AGENT_AND_PROJECT_RECOVERY.md` and current evidence
under `docs/evidence/agent-reliability/`. Recheck authenticated assistant behavior
and AI sign-in while programming on the user's Windows workstation before tagging.
