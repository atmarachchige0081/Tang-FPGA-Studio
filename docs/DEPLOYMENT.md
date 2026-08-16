# Deployment and operations

## Supported deployment

The supported end-user distribution is the native one-file Windows installer.
It installs the Tauri/Rust application under Program Files and prepares a
writable, version-matched workspace under Documents. A complete repository
checkout remains supported for contributors.

Requirements:

- PowerShell 5.1 or later.
- Microsoft Edge WebView2 (included with current Windows 10/11 and repaired by
  the Tauri installer when necessary).
- A supported Tang Nano or Tang Primer board package; the Primer 20K Dock is
  the maintained hardware/JTAG/UART acceptance target.
- The pinned OSS CAD Suite installed by `./fpga.ps1 setup`.

Installed users launch **Tang FPGA Studio** from the Desktop or Start menu and
do not need Python, Node.js, or Rust. Source contributors need current Node.js
and Rust, then run `npm install` and `npm run desktop` inside `studio`.

## Release gate

Run this before distributing a checkout or publishing a tag:

```powershell
.\scripts\release-check.ps1
.\scripts\stress-test.ps1 -Rounds 3 -Parallelism 2
.\scripts\capture-screenshots.ps1
.\scripts\release-check.ps1 -SkipHdl -SkipNative
git diff --check
```

For a source sandbox that intentionally denies execution or temporary writes
outside the checkout, `stress-test.ps1 -SkipHdlChecks -SkipBoardBuilds` runs the
repeat native/UI/concurrency subset. This is diagnostic only and never replaces
the full default gate used for a release runner.

The release check preserves regression coverage for the legacy companion UI,
parses all PowerShell scripts, validates JSON, runs HDL lint/simulation, builds
the native frontend, and runs the Rust security, parser, and project tests.
The stress runner additionally builds five distinct Tang device families in
parallel, repeats UI and backend suites, and exercises the backend's same-project
job lock. Parallelism is capped at four and defaults to two for laptop safety.
GitHub Actions repeats platform-independent gates for every push and pull
request.

The screenshot script launches the current React Studio 3 frontend in browser
preview mode and captures its real dark/light views with Microsoft Edge. It
must not be replaced with captures from the retired Python companion UI.

## Automatic one-file installer release

Studio 3 releases use the NSIS `.exe` bundle as the maintained one-file
beginner installation path. WiX/MSI is not part of the supported release gate;
adding it would require a separate clean-runner packaging and upgrade test.

The installer repository owns the Windows packaging workflow. On an upstream
Studio release it performs the following controlled sequence:

1. Resolve a semantic `vX.Y.Z` release tag from the public GitHub API.
2. Clone that immutable tag and synchronize only the approved IDE, project,
   command, documentation, and screenshot paths.
3. Commit the synchronized installer sources and create the matching installer
   tag.
4. Build and test the package from that tag on a clean Windows runner.
5. Publish the EXE, SHA-256 checksum, and GitHub/Sigstore build provenance.

`.github/workflows/publish-installer.yml` sends an immediate
`repository_dispatch` when the optional `INSTALLER_REPO_TOKEN` secret is
configured. Use a fine-grained token limited to the installer repository; do
not copy a broad personal CLI token into Actions. The installer also checks the
latest public Studio release hourly, so publication remains automatic without
any cross-repository secret (with up to an hour of delay).

## Runtime data

The application stores project-local state under `.fpga-studio/`:

- `workspace-state.json` remembers the active project using atomic replace and
  a backup file.
- each project's `.fpga-studio/build-history.json` stores local build history.
- each project's `.fpga-studio/hardware-verification.json` stores an explicit
  user observation and the exact bitstream timestamp it applies to; later
  source or bitstream changes make that evidence stale.
- each project's `.fpga-studio/design-graph.json` caches bounded cross-domain
  traceability and is invalidated by source or build fingerprint changes.
- each project's `.fpga-studio/snapshots.json` and `experiments.json` retain
  bounded evidence history and isolated optimization results.
- generated analyzer configuration, HDL, reports, image, and capture files live
  under the project's ignored `build/analyzer/` directory.

Theme and release-note preferences use the WebView profile's local storage.
Native startup failures and panics are appended to
`%LOCALAPPDATA%\Tang FPGA Studio\logs\crash.log` and show a recovery dialog.

This directory is ignored by Git. The application sends no telemetry and does
not require an account or network connection after toolchain setup.

## Recovery

- UI callback errors are logged and reported without terminating the editor.
- Filesystem, Git, board, plugin, HDL, waveform, netlist, and serial work runs
  outside the UI thread.
- Output rendering is bounded, large waveform inputs are capped, dense traces
  are summarized, and netlist edges are limited before layout.
- Rapid double-clicks and concurrent FPGA jobs for the same project are rejected
  without starting duplicate tool processes.
- JTAG programming is stopped after 90 seconds without completion and reports
  a board reconnect procedure.
- A failed theme transition restores the previous palette; corrupt theme
  preferences fall back to dark mode.
- Build artifacts can be recreated with `./fpga.ps1 clean` followed by build.
- Upload uses volatile SRAM and is the preferred hardware validation path.
- Persistent flash is guarded by a confirmation and blocked when smart checks
  contain red errors.
- If programming is interrupted, power-cycle the board, run `detect`, then
  retry SRAM upload before attempting persistent flash.

No software can guarantee immunity from faulty HDL, damaged hardware, driver
failures, or power loss. These controls make failures observable, contained,
and recoverable rather than claiming the system is literally unbreakable.
