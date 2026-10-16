# Roadmap after 3.5.0

Our goal is Arduino-style simplicity for FPGA development: a newcomer can install
Studio, run an example on a supported Tang board, understand a failure and return
to their project without help from the maintainer.

This is a proposed backlog, not a delivery-date promise. Unchecked tasks have not
been accepted as complete. Some capabilities already exist in 3.5.0; tasks below
ask us to verify, strengthen or fix them rather than build a second implementation.
A release can ship fewer tasks when its acceptance criteria are met. A serious
regression takes priority over the version sequence.

## Working rules

- Prioritize lost work, incorrect programming, freezes and broken installation.
- Keep the Tang beginner workflow as the supported product scope. Do not claim
  suitability for essential aircraft functions or other safety-critical uses.
- Require a reproducible example for each reported defect and an appropriate
  regression check for its underlying cause. Do not inflate test counts with
  checks that merely repeat implementation details.
- Separate software results from physical-board observations and real-account AI
  results. Record skipped and untested cases explicitly.
- Keep logs, recordings and large reports in CI artifacts or issue attachments,
  not in the source tree. Never include credentials or private projects.
- Use opt-in feedback. Do not introduce background telemetry to measure adoption.
- Avoid new AI providers, board families and major subsystems during this cycle.

## 3.5.1 — Protect work and finish the reliability pass

**Outcome:** ordinary editing, AI activity and programming can coexist without
losing work or requiring a full application restart after a recoverable failure.

### Editing and project integrity

- [ ] R101 · P0 · Reproduce the reported AI sign-in while programming scenario on
  Windows 11 with a Primer 20K Dock. Record process exits, responsiveness and the
  programming result; do not deliberately interrupt a persistent flash operation.
- [ ] R102 · P0 · Exercise unsaved files during project switching, window closing,
  external modification and external deletion. Fix every silent-discard path.
- [ ] R103 · P0 · Test disk-full, read-only, disconnected-folder and interrupted-save
  conditions in disposable projects. Preserve the original file and actionable error.
- [ ] R104 · P0 · Review session recovery after an unexpected process exit. Define
  what is recoverable, implement missing draft recovery if needed, and verify the
  restored text before claiming recovery support.
- [ ] R105 · P1 · Verify recent-project reopening with spaces, Unicode names, moved
  folders, unavailable drives and portable project metadata on both platforms.

### Processes, terminal and AI

- [ ] R106 · P0 · Run a concurrency matrix: editing plus build, simulation plus AI,
  programming plus login, and terminal output plus file review. Fix deadlocks and
  UI stalls with recorded reproduction steps.
- [ ] R107 · P0 · Force individual terminal, serial and AI process failures in test
  sessions. Recover the affected component while preserving editor buffers and
  unrelated active work. Never replay a hardware write automatically.
- [ ] R108 · P1 · Verify terminal startup, working directory, multiline input, paste,
  Ctrl+C, resize, exit and restart in Windows PowerShell and Linux Bash.
- [ ] R109 · P1 · Test assistant reconnection, account state and project isolation
  with a real account. Keep this evidence separate from protocol fixtures.
- [ ] R110 · P0 · Exercise simultaneous approvals, long details, cancellation and
  provider disconnects. Every request must be answerable at supported display sizes.
- [ ] R111 · P1 · Repeat file-review open/close, file selection and live-update cycles
  to detect Monaco lifecycle errors and accumulating memory use.
- [ ] R112 · P1 · Make user-facing recovery errors concise. Put technical details
  behind an explicit details/copy action and provide a redacted support report.

**Acceptance:** no unresolved reproducible lost-work or unsafe automatic-replay
bug in this matrix. Complete a documented two-hour mixed-workflow session on
Windows 11 and Ubuntu 22.04 or newer, with no unexpected app exit, stuck approval
or unrecoverable terminal freeze. This is a release gate, not a claim that crashes
are impossible. Keep hardware-specific and account-specific results identifiable.

## 3.5.2 — Make the first successful project repeatable

**Outcome:** a beginner can get from a clean installation to a working board
example using the published instructions.

### Installation and onboarding

- [ ] B201 · P0 · Install the published Windows packages on a clean Windows 11
  machine and verify app launch, workspace creation and toolchain setup.
- [ ] B202 · P0 · Repeat clean-install checks for the published Ubuntu baseline
  packages on 22.04, 24.04 and 26.04, including required libraries and PowerShell.
- [ ] B203 · P0 · Test interrupted downloads, checksum failures, unavailable tools
  and incomplete setup. Provide a safe retry with a clear explanation.
- [ ] B204 · P1 · Confirm installed/source paths with spaces and Unicode work;
  distinguish genuine toolchain path restrictions from application defects.
- [ ] B205 · P1 · Audit the contributor instructions against the current native
  Tauri application. Clearly distinguish maintained native development from the
  older Python interface and remove obsolete primary setup instructions.
- [ ] B206 · P1 · Run the first-launch workflow without an AI account. Every basic
  editing, simulation, build and programming action must remain accessible.

### First-board experience

- [ ] B207 · P0 · Walk through Primer 20K Dock USB connection, core-enable switch,
  JTAG detection and Windows Interface 0 / UART Interface 1 handling with a newcomer.
- [ ] B208 · P0 · Verify Linux USB permissions and serial-group guidance from a
  normal user account, including when a new login is required.
- [ ] B209 · P1 · Make missing board, missing driver/permission, missing tool and
  failed design build distinguishable. Each message must suggest a relevant next step.
- [ ] B210 · P0 · Validate one complete LED example: create, simulate, build, upload
  to SRAM and observe the expected behavior on the named board revision.
- [ ] B211 · P1 · Validate the UART lesson end to end, including port selection,
  disconnect/reconnect and wrong-port or busy-port errors.
- [ ] B212 · P1 · Test upgrading from 3.5.0 and uninstalling with an existing project.
  Preserve user projects and document which settings remain.

**Acceptance:** recruit five independent beginners who have not helped build the
app. At least four complete the documented first-project workflow without live
maintainer intervention. Record platform, board, elapsed time and blocking steps
with consent; mark results unavailable until the sessions actually happen.
Publish the tested installation and hardware scope, including any exclusions.

## 3.5.3 — Make everyday use predictable

**Outcome:** returning users can edit, diagnose failures and continue their
projects comfortably without learning hidden application behavior.

### Editor and workspace

- [ ] W301 · P1 · Test representative Verilog/SystemVerilog completion, module-port
  completion, definitions and references against small multi-file projects.
- [ ] W302 · P1 · Explain the difference between local HDL completion and optional
  AI inline suggestions. Test explicit request, stale responses, acceptance and dismissal.
- [ ] W303 · P0 · Confirm saved edits from editor, terminal and AI tools appear in
  open buffers and native review. Preserve unsaved conflicts and avoid claiming AI authorship.
- [ ] W304 · P1 · Review search and replace with Unicode, generated files and
  multiple files; preview affected files before destructive bulk operations.
- [ ] W305 · P1 · Verify keyboard navigation, visible focus, shortcuts and primary
  actions at 1366×768 and Windows 100%, 150% and 200% display scaling.
- [ ] W306 · P1 · Check panel minimum sizes, saved layout, reset behavior and
  project switching in both themes. Keep essential controls reachable.

### Diagnostics and day-to-day tools

- [ ] W307 · P1 · Collect common beginner build failures and verify that diagnostics
  identify the file/location and explain a useful next action in plain language.
- [ ] W308 · P1 · Verify stale build results are visibly distinguished from results
  for current saved source. Do not present an old success as current verification.
- [ ] W309 · P1 · Test build cancellation, immediate restart and a failed tool's
  cleanup. Check for orphan processes and locked files after completion.
- [ ] W310 · P1 · Test serial reconnect, sustained traffic and port contention.
  Bound output without freezing controls or concealing dropped data.
- [ ] W311 · P1 · Measure project-open, search and indexing responsiveness on named
  small and medium projects and documented hardware. Set budgets from that baseline.
- [ ] W312 · P2 · Conduct a consistency pass over labels, buttons, tooltips and
  error dialogs. Capture and inspect actual native screenshots in both themes.

**Acceptance:** complete repeated edit–simulate–build–upload sessions with a
multi-file project on Windows and Ubuntu. Publish measured performance and
remaining limits. Resolve all blockers found in keyboard/scaling checks and
complete user reviews of diagnostics before calling this a usability release.

## 3.5.4 — Prove that people choose to keep using it

**Outcome:** decide what to invest in next using independent repeat usage and
a maintainable release process, rather than adding features by intuition.

### Independent use and product decisions

- [ ] V401 · P1 · Recruit ten opt-in users from the intended Tang hobbyist,
  beginner and educator audience. Include Windows and Ubuntu users.
- [ ] V402 · P1 · Observe their first real project without coaching. Record where
  they leave Studio, need external tools or become blocked.
- [ ] V403 · P1 · Ask participants to return to the same project over two weeks.
  Record actual return usage and reasons for stopping; do not infer adoption from downloads.
- [ ] V404 · P1 · Investigate each abandonment or serious frustration report and
  prioritize reproducible workflow failures ahead of cosmetic preferences.
- [ ] V405 · P2 · Validate the README and installation path with newcomers. Ask
  what they believe Studio supports before installation and correct misleading copy.
- [ ] V406 · P1 · Write a short public findings summary using consented, anonymous
  observations. Include negative results and changes made because of them.

### Sustainable maintenance and releases

- [ ] V407 · P0 · Exercise release download/checksum verification, source/tag
  association and rollback instructions using a disposable test release.
- [ ] V408 · P1 · Define defect severity, a minimal bug-report template and support
  boundaries. Ask for versions, reproduction steps and redacted diagnostics.
- [ ] V409 · P1 · Have someone other than the primary maintainer build Studio from
  the contributor guide and fix every undocumented prerequisite they encounter.
- [ ] V410 · P1 · Review dependency updates, security reporting and package
  provenance. Assign a realistic recurring maintenance routine.
- [ ] V411 · P1 · Define the regression matrix required for a patch, a UI change,
  a toolchain update and a new board. Keep routine checks proportional to risk.
- [ ] V412 · P1 · Choose the next development direction from evidence: strengthen
  the Tang beginner workflow, improve a demonstrated advanced workflow, or narrow
  the product. Defer additional providers/devices until a concrete user need justifies them.

**Acceptance:** complete the observation period and publish its findings. A
proposed positive signal is at least six of ten participants returning voluntarily
on three separate days; report the result even if it misses that target. A missed
product signal is a reason to reassess priorities, not to hide results or prevent
necessary bug-fix releases. Another contributor must reproduce setup successfully.

## Definition of done for every task

A task is complete when its intended behavior has been demonstrated on the
relevant platform, useful evidence is linked from its issue or release record,
known limits are recorded and the change has been reviewed. For a defect, retain
a regression check where one meaningfully detects the cause. Hardware and real
AI-account tasks require those actual dependencies; fixtures cannot close them.
