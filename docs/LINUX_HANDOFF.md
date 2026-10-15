# Linux work handoff — 2026-10-14

Paused at the user's request to conserve credits. No release tag, push or publication was performed.

## Saved work and evidence

Ubuntu x86_64 support, Windows-compatible launch dispatch, native PowerShell/toolchain setup, udev guidance, per-user packaged resources, Unix cancellation, native regression tests, `.deb`/AppImage packaging and Ubuntu CI are implemented. Read `LINUX.md` and `LINUX_VALIDATION.md`.

Compact evidence is committed in `docs/evidence/linux/`: actual native screenshots, structured workflow results, six-board timing/bitstream summary, frontend/Python/Rust/Windows compile logs and package checksums. Large packages, bitstreams and additional logs remain local under `build/linux-evidence/` and `/workspace/.tang-linux/`; they are intentionally ignored by Git. Do not assume those ignored files survive a replacement cloud environment; rebuild them using the supported commands.

The final supported `npm run desktop:build` completed successfully. Final package checksums are saved in `docs/evidence/linux/SHA256SUMS`. The `.deb` passed all 17 native workflow checkpoints on Ubuntu 22.04 and 24.04. Final AppImages passed all seven UI checkpoints and headless smoke on 22.04, 24.04 and 26.04. Rust: 72 passed, 2 explicitly ignored; frontend: 57 passed; Python: 37 passed; Windows GNU cross-check and Clippy passed.

## Resume update — 2026-10-15

The final Ubuntu 26.04 installed package now passes all 17 checkpoints. Fresh results, screenshots, timing and experiment evidence are committed in `docs/evidence/linux/`. See `RELEASE_PREPARATION.md` for the next gates and `RELEASE_3.5.0.md` for proposed release notes. The Windows MSVC package workflow is prepared but has not been executed here. No version bump, tag or publication has occurred.

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

Do not tag a dual-platform release until the applicable gates are documented. The current version remains 3.4.1; choose/bump the release version only when preparing that release.
