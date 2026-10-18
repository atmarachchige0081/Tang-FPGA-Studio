# Maintenance log

## 2026-10-18 — Windows QA feedback and pending startup recovery guard

**Workflow/evidence:** reviewed the supplied Windows native-runner QA report,
runner result assembly, Problems rendering, UART template and shell selection.
The report establishes build/simulation and connected JTAG detection in that
session, not upload, UART, flash or circuit operation. The disconnected Detect
result had an actionable failureMessage but no diagnostics. The implementation
confirmed that only text containing error/warning became diagnostics, while an
empty Problems panel claimed no problems. The UART template also copied fixed
example-folder commands into newly named projects.

**Changes:** failed native jobs now receive a fileless error containing their
failure explanation when no error diagnostic already exists. Preserve warnings,
existing source diagnostics, exit codes and hardware safeguards. Add native
regressions for absent probes, warning preservation, deduplication and success.
Add a frontend rendering regression for fileless failures. Make UART README
commands explicitly use the active workspace-relative project path, retaining
quoted paths and GUI verification steps. Document PowerShell search fallbacks:
Windows already uses powershell.exe; rg and Windows pwsh are not requirements.
Optional Python acceleration warnings remain visible and are not build failures.

**Pending earlier startup work:** preserve and finish the source-graph preflight
for development/build/doctor. The earlier supplied Vite log showed unresolved
application imports; it did not prove a native production crash or establish why
those local files were inaccessible. The guard reports missing source files and
safe fresh-folder recovery before Vite runs. It never overwrites projects.
Four Node regressions cover complete/missing imports, paths with spaces and the
nonzero CLI result. No dependencies or package versions change.

**Verification:** production frontend build and TypeScript checking passed;
the existing 134-test suite and four startup tests passed. The final combined
frontend run passed 135 tests across 33 files, including the added Problems
rendering regression; incremental TypeScript checking also passed. Chromium
rendered the real interface with an injected fileless failure; the explanation
appears under ERROR without the clean-project message, and no browser exceptions
occurred. Screenshot inspected at `build/qa-feedback/detect-failure.png` (ignored
artifact). This browser fixture does not run the native job runner.

**Limits/follow-up:** this cloud image has no cargo/rustc or native Tauri build
prerequisites; the added Rust regressions and Windows build remain unrun here.
No hardware was programmed. On Windows run `cargo test --manifest-path
studio/src-tauri/Cargo.toml runner::tests`, rebuild Studio, disconnect the board
and run Detect: Output and Problems should explain the missing programmer.
Reconnect and repeat Detect. Next useful task: authenticated AI read/explain
plus approval recovery on Windows, without concurrent hardware programming.

## 2026-10-18 — Twenty verified defects; end-of-day maintenance

Baseline: `5b27af7`. Reviewed the prior maintenance cycle, current workflows and
applicable instructions. The user explicitly requested twenty distinct fixes.
The count below does not reuse the preceding ten or count multiple symptoms of
one issue separately. All reproduction checks use real application logic with
controlled bridge I/O; no FPGA workflows or physical programming are run.

| ID | How the defect was found | Cause and fix | Regression |
| --- | --- | --- | --- |
| C01 | Persist separate conversations for `/home/user/FPGA` and `/home/user/fpga`: the second replaces the first. | Project keys lowercased every path and reduced it to 32 bits. Store full normalized identity, folding case only for Windows paths. | `persistence.test.ts`: case-distinct Linux projects; Windows separator/case and legacy-selection controls. |
| C02 | Select text in one tab, switch files: AI context still contains the first file's selection/cursor. | Tab activation retained file-specific context. Clear selection/cursor when the active file changes or closes. | `workbench.test.ts`: cross-tab selection isolation. |
| C03 | Set a new workspace after viewing diagnostics/Git: the old project's state remains. | Workspace reset omitted project metadata. Clear build, board, Git and diagnostics while preserving the running-job safeguard. | `workbench.test.ts`: stale project metadata reset. |
| C04 | Search once, change the query, immediately Replace all: replacement uses old match results for its dirty-file preflight. | Results/button stayed active during the next search. Clear obsolete results and block replacement while loading. | `Sidebar.test.tsx`: replacement cannot run against stale results. |
| C05 | Request an HDL index, switch project, resolve the old index last: the new project gets the old symbols. | Sidebar index loading lacked effect-lifetime checks. Ignore late success/failure after cleanup. | `Sidebar.test.tsx`: delayed old index cannot replace the new index. |
| C06 | Navigate to an already-open unsaved file whose disk copy is gone: navigation throws instead of using the buffer. | Navigation always reread disk. Activate the existing buffer and use its contents without I/O. | `navigation-safety.test.ts`: deleted disk file with an open unsaved buffer. |
| C07 | Open a diagnostic `file:///work/My%20Labs/...` link: the generated path contains `%20` and a duplicated root. | Ad-hoc URI stripping lost POSIX absolute-path semantics and never decoded escapes. Parse/decode file URIs before root mapping. | `navigation-path.test.ts`: POSIX and Windows escaped file URIs. |
| C08 | Pass `/work/fpga/...` while the active POSIX root is `/work/FPGA`: it is incorrectly treated as inside the workspace. | Root matching lowercased POSIX paths. Use platform-appropriate comparison and reject absolute paths outside the active root. | `navigation-path.test.ts`: case-distinct POSIX root rejected; Windows case remains supported. |
| C09 | Render a scalar whose first sample is at time 50 in a window starting at 0: its future value appears at time 0. | Rendering initialized from a future sample. Keep the pre-sample interval unknown until the first transition. | `waveform.test.ts`: exact unknown-to-high trace. |
| C10 | Index `logic [7:0] counter` and `input wire [WIDTH-1:0] data`: vector symbols are missing or misidentified. | Active-buffer declaration matching did not consume packed dimensions. Match dimensions before the identifier. | `hdl-intelligence.test.ts`: packed-vector symbol discovery. |
| C11 | Parse Primer 20K device `GW2A-LV18PG256C8/I7`: package becomes PG256C and speed grade loses C. | An optional package letter greedily consumed the grade prefix. Distinguish real package suffixes from the following C/I grade. | `hdl-intelligence.test.ts`: PG256/C8 plus QN88P and PG484A compatibility controls. |
| C12 | Deliver an old turn's delayed message delta while a new turn is running in the same thread: obsolete text enters the new conversation state. | Event reduction checked completion IDs but not other explicit turn IDs. Reject events belonging to another active turn. | `state.test.ts`: stale-turn delta leaves current state unchanged. |
| C13 | Start account refresh, switch projects, reject the old refresh: the new panel shows the previous project's error. | Background refresh failure handlers lacked the success path's generation checks. Scope account errors and history-clear failures to their generation. | `AiPanel.test.tsx`: delayed old account error stays out of the new project. |
| C14 | With probes A=0, B=1, bus=2 and a trigger on B, remove A: the trigger silently moves to bus. | Probe IDs were renumbered without remapping trigger clauses. Remap old IDs to the surviving signal identities before serialization. | `analyzer-safety.test.tsx`: saved trigger still targets B after removing A. |
| C15 | Change an edge-trigger clause from a one-bit probe to a bus: config retains unsupported rising/falling mode. | Channel selection changed the ID only. Convert edge operation to compare when the new channel is wider than one bit. | `analyzer-safety.test.tsx`: bus selection saves a valid compare clause. |
| C16 | Start saving analyzer config: editable fields remain enabled and can be overwritten by the submitted save response. | Only action buttons were locked. Disable the editable configuration fieldset and refresh while busy/running; handlers also reject edits while locked. | `analyzer-safety.test.tsx`: clock input is disabled during pending save; browser confirms unlock after completion. |
| C17 | Start opening a project, change to another workspace, finish the old open: the newer workspace is replaced. | Project loading committed captured results after I/O without scope validation. Guard each await and final commit with workspace lifetime. | `OpenProjectDialog.test.tsx`: delayed project open cannot replace the newer workspace. |
| C18 | Recognize a project successfully, then repeat recognition and fail: Open project remains enabled for the old hidden candidate. | Recognition cleared displayed results but retained selected path. Clear both together before recognizing. | `OpenProjectDialog.test.tsx`: recognition failure leaves no actionable old selection. |
| C19 | Queue terminal input behind a pending write, dispose the panel, complete the write: queued text still reaches the old shell. | Disposal was checked when input arrived, not when queued I/O ran. Check lifetime and session identity immediately before each native write. | `TerminalPane.test.tsx`: queued input is not replayed after disposal. |
| C20 | Click a Traceability source row: it opens the file but never reaches the source line. | It emitted an event with no listener; the initial editor mount also needs to consume pending navigation. Use the shared navigation path and consume pending requests when Monaco mounts. | `analyzer-safety.test.tsx` and real-browser cursor/navigation verification. |

**Evidence:** ten core regressions failed in a baseline run, five project/search/
AI regressions failed in another, and terminal/analyzer/source-link regressions
failed independently (probe-removal fixture corrected before its behavioral
failure was counted). After fixes, 80 focused tests across 12 files passed.
The browser regression additionally exposed pending navigation being missed on
cold Monaco mount; it failed before the mount handoff fix and now reaches source
line 6 with the pending request consumed. `scripts/test-analyzer-navigation.py`
passed with no browser exceptions; it also verifies the saved trigger's signal
identity and locked/unlocked configuration fields. Screenshots inspected at
`build/maintenance-twenty/analyzer-saving.png` and `traceability-source.png`.
Final `npm --prefix studio run check` passed: TypeScript checking, production
build and 134 tests across 32 files. Python regression script compilation and
`git diff --check` passed. Generated screenshots/reports remain untracked.

**Compatibility:** no boards, programmer aliases, commands, dependencies or
approval boundaries changed. Windows legacy active-thread selection is retained
and removed correctly by New conversation. Legacy POSIX active-thread pointers
cannot safely distinguish case-colliding owners and are ignored; saved provider
history and account credentials are retained. Existing settings remain intact.

**Limits:** native Windows execution, authenticated Codex file reads and physical
boards were not exercised. The terminal scheduling test substitutes the xterm
input source; the browser uses real React and Monaco with simulated config
persistence. The provider-side `aborted` read report remains
unresolved; these fixes do not claim to repair it. No hardware writes or tags.

**Real-user check:** in a disposable analyzer config on Windows, trigger on the
second probe, remove the first, and verify the trigger stays on the same signal.
Save configuration only; hardware programming is unnecessary for this check.

**Next task:** authenticated Windows Codex read-failure reproduction, followed by
remaining asynchronous analysis-view refresh races. Stop after this verified cycle.

## 2026-10-18 — Ten verified defects in document and AI workflows

Scope: existing navigation, save, discard confirmation, file synchronization and
AI conversation handling. Reviewed this log, the release comparison and the
relevant implementations first. No root AGENTS.md exists; projects/AGENTS.md
applies to HDL projects, which this cycle does not change. The user explicitly
requested ten fixes for this cycle. Baseline: `1c4822c`.

Each row records a distinct failing regression, its cause and the corresponding
fix. Deferred promises reproduce asynchronous ordering deterministically; bridge
calls are mocked, while React, Zustand and the application handlers are real.

| ID | Problem and how it was found | Root cause and fix | Regression evidence |
| --- | --- | --- | --- |
| B01 | Start opening a source location, switch projects, then finish the read: old content opens in the new project. | Navigation used captured store actions without validating the workspace after I/O. A subscribed workspace guard invalidates late results, including switching away and back. | `navigation-safety.test.ts`: pending previous-project read; ordinary navigation remains functional. |
| B02 | Open 65 tabs and advance multiple polling intervals: tab 65 is never requested. | Every poll took the same first 64 tabs. Rotate bounded batches through all tabs, retaining the native request size limit and cached versions. | `file-sync.test.tsx`: the 65th path must appear in subsequent requests. |
| B03 | Start a file refresh, close/reopen that path, then finish the old read: reopened content is replaced. | Responses tracked only paths, not the open-file lifetime. Track close generations, clear cached versions on close and ignore obsolete responses. | `file-sync.test.tsx`: same-path reopen retains its new buffer; existing concurrent-typing conflict test still passes. |
| B04 | Save in project A, switch to project B with the same file path, then complete A's write: B's saved baseline is changed. | Save acknowledgement called the live store's markSaved using only the path. Extracted the unchanged persistence sequence into a tested helper, then guarded acknowledgement by workspace/file lifetime. | `save-file.test.ts`: cross-project acknowledgement fails before the guard; successful concurrent typing stays dirty and failed writes stay unsaved. App.save now calls this helper. |
| B05 | Open a discard prompt, type newer text while the answer is pending, then approve: the old answer authorizes discarding newer edits. | Confirmation returned the answer without checking its snapshot. Compare tracked content/baselines and workspace lifetime after approval; cancel with an actionable output message if changed. | `documents.test.ts`: edits made after the prompt prevent discard; clean navigation and explicit cancellation controls remain. |
| B06 | Start an AI turn, open history and select a saved conversation: the panel resumes another thread while work is active. | History lacked the running-turn guard used for New conversation. Guard the handler and disable history entries during active work. | `AiPanel.test.tsx`: selecting history during a running turn must not call aiThreadResume. |
| B07 | Begin loading saved AI history, change project, then finish the read: old messages enter the new project's panel. | History awaits lacked the generation checks used by the send/connect paths. Check after each await, including errors/finalization, and update the active thread only for the current generation. | `AiPanel.test.tsx`: delayed old history must not render STALE_HISTORY in the new project. |
| B08 | Send the first prompt with thread creation pending: New conversation remains enabled and can clear state underneath that operation. | New checked only running, which is false until creation/start finishes. Include busy and the operation lock in handler/control guards. | `AiPanel.test.tsx`: New is disabled while aiThreadStart is unresolved. |
| B09 | Stream a partial assistant message, then deliver the complete final message: only partial text remains visible. | Completion cleared the streaming flag but ignored final text for existing messages. Use the authoritative completed text when supplied, preserving deltas if absent. | `state.test.ts`: final full answer replaces a partial streamed fragment. |
| B10 | Deliver a provider error with willRetry=true: the panel declares the turn stopped and clears approvals although Codex will continue. | Every error was terminal. Preserve live turn/approval state for explicit retries and log the diagnostic to Output; final errors still stop and expose their nested error.message. | `state.test.ts`: retry preserves turn and approvals; final authentication error still stops with its actual message. |

**Before/after evidence:** six initial document/state regressions failed in one
run, the isolated original save sequence failed its cross-project test, and all
three corrected AI lifecycle regressions failed with behavioral assertions before
their fixes. The focused post-fix run passed 37 tests across six files.
`npm --prefix studio run check` passed: production build, TypeScript checking and
109 tests across 30 files. `git diff --check` passed. A real Chromium application
check with simulated provider requests/events verified pending-thread New
protection, running-turn history protection, retry continuity and authoritative
final-answer rendering, with no browser exceptions. Inspected screenshots at
`build/maintenance-ten/pending-thread.png`, `running-history.png` and
`completed-answer.png` (generated evidence, not tracked source).

**Limits:** these tests do not authenticate to Codex, run native Windows dialogs
or exercise a physical board. No hardware programming, flash writes, dependency
upgrades or release tags. B06–B10 fix independently reproduced AI defects; they do
not establish or claim to repair the user's provider-side aborted file reads.

**Real-user checks:** on Windows, type while saving, switch projects during a
source read, and verify no old-project buffer appears. In AI, start a prompt and
confirm New/history switching is blocked until it finishes; completed answers
should show full text. Use a disposable project for concurrency checks.

**Next priority:** reproduce the authenticated Windows Codex aborted-read failure
with the actual provider executable/version and a fresh conversation. Continue
native save/file-sync concurrency verification after that.

## 2026-10-18 — Terminal teardown, resizing and native confirmations

- **Workflow:** open/switch the terminal, resize the window/panel, and confirm
  destructive actions. Reviewed recent changes and the preceding maintenance log.
- **Evidence:** a real Chromium/React/xterm regression reproduced the reported
  `Cannot read properties of undefined (reading 'dimensions')` repeatedly across
  25 panel-switch/resize cycles. Stack traces identified a delayed xterm viewport
  callback reading a renderer after disposal, including StrictMode cleanup.
  The terminal also performed layout-changing fitting synchronously inside
  ResizeObserver delivery, a feedback-loop risk matching the reported warning.
- **Confirmation cause:** the installed dialog 2.7.3 initialization script makes
  `window.confirm` asynchronous and invokes the removed `dialog|confirm` command.
  Synchronous boolean checks could interpret its Promise as approval. Only file-
  open permission was granted; supported confirmations require message permission.
- **Changes:** all application confirmation callers now await a shared helper
  using the supported native API, with browser fallback. Dialog failure cancels
  the action and reports an actionable output error. Existing confirmation wording
  and safeguards remain. Replace all rechecks scope/dirty buffers after approval;
  save/restart retain locks during the prompt. Minimal message permission added.
  Terminal fitting is scheduled outside observer delivery, deduplicated by size,
  and cancelled on teardown. A pinned, source-checked, idempotent xterm workaround
  prevents disposed viewport synchronization; install/dev/build hooks apply it.
- **Verification:** native IPC tests exercise the real JavaScript dialog API with
  mocked IPC, checking `dialog|message` and both answers. Focused tests cover pending
  approval, cancellation and dialog failure. The previous replacement race test
  now explicitly waits for native replacement to start before simulating typing,
  preserving its intended regression after asynchronous approval was introduced.
  `scripts/test-terminal-lifecycle.py` exercises real React/xterm with simulated
  PTY I/O; all 25 cycles passed with no browser errors and resize calls recorded.
  Typed input reached the simulated PTY; cancelling Restart left the shell intact.
  Screenshot inspected at `build/terminal-safety/terminal.png`; generated evidence
  remains untracked. Full frontend check passed: type checking, production build
  and 95 tests across 28 files. Patch application/repeat verification and Python
  compilation passed; `git diff --check` passed.
- **Limits:** the exact ResizeObserver warning did not reproduce locally; its
  terminal feedback path was removed without filtering global errors. Native
  Windows dialogs/PTY and physical hardware were not exercised. No hardware or
  shell commands were executed by the browser fixture; no dependency upgrades,
  release tags or UI redesign.
- **Real-user check:** on Windows, open the terminal, resize it and switch panels
  repeatedly. Press Restart and Cancel: the existing shell must remain. Modify a
  file, close it and Cancel: its text must remain, without dialog errors.
- **New report / next priority:** user reports an AI explanation prompt preceded
  an app restart. Supplied Windows log shows successful compilation, bulk frontend
  source-change notifications and native restart on `app-icon.svg` change; no AI
  exception or native panic is included. Inspected request error handling and
  Assistant boundary: neither deliberately restarts Vite/the app. Existing
  explanation/streaming regression passes with preview provider; authenticated
  Windows cause remains unconfirmed pending project path, approval/edit history
  and crash/error lines. Do not attribute this to a provider or change watchers
  without evidence. Native Windows confirmation/terminal check remains required;
  save/file-sync ordering remains the subsequent maintenance priority.

## 2026-10-18 — Replace all preserves concurrent editor work

- **Workflow:** project search → Replace all while typing or switching projects.
  Reviewed the previous maintenance entry, unsaved-work protections and current
  search/store synchronization. Crash-draft recovery (R104) remains a separate
  feature; this cycle fixes an existing data-loss path.
- **Evidence:** deferred-I/O regression reproduced four failures before the fix:
  text typed during replacement or its follow-up read was overwritten, and a late
  read could replace a same-path buffer in another workspace or project. Clean
  refresh and the existing dirty-file refusal passed as controls.
- **Cause and fix:** replacement used captured tabs and unconditional buffer
  reloads after asynchronous I/O. It now uses live tabs and the existing conflict-
  preserving synchronization. Project/workspace and panel-lifetime guards reject
  obsolete reads, including switching away and back. Search refresh uses the
  latest query; output identifies the operation's project. Confirmation and
  refusal to replace already-dirty matching files remain intact.
- **Verification:** all nine focused Sidebar regressions passed, covering both
  typing races, clean refresh, dirty refusal, workspace/project changes, returning
  to the original project, panel unmount and changed queries. `npm --prefix studio
  run check` passed: 89 tests across 27 files, type checking and production build.
  A real Chromium/Monaco keyboard check with simulated delayed filesystem I/O
  preserved typed text and displayed the existing conflict choices without browser
  exceptions. Inspected `build/replacement-safety/preserved-unsaved-edits.png`;
  generated evidence is kept outside tracked source. `git diff --check` passed.
- **Limits:** filesystem calls were controlled in the regression/browser checks;
  native Windows execution and physical hardware were not tested. No programming
  or flash writes were performed. No UI redesign or dependency changes.
- **Real-user check:** in a disposable project, run Replace all and immediately
  type in a matching open file. Confirm new typing survives; if a conflict appears,
  use Keep my edits and verify the buffer before saving.
- **Next priority:** inspect asynchronous save/file-sync ordering and failure
  reporting for another reproducible data-loss or misleading-success path.

## 2026-10-18 — Suggestions after closing file review

- **Workflow:** open a project, inspect a file diff, close review and request
  completions in the surviving editor. Reviewed the workbench debugging notes,
  recent release fixes and unfinished reproduction from the previous session;
  no dedicated maintenance log existed.
- **Evidence:** the real Chromium regression reproduced `InstantiationService
  has been disposed` with unpatched Monaco 0.56.0 after closing a rendered diff.
  Ordinary editor disposal passed the control case.
- **Cause and fix:** Monaco's global hover factory retained an editor-owned
  instantiation service. A version-checked local workaround uses the window-lived
  root service instead. Install/dev/build hooks apply it consistently, clear stale
  generated Vite cache on first application, and reject unexpected source changes.
  Dependency versions, visual design and application safeguards are unchanged.
- **Verification:** see the focused browser regression in
  `scripts/test-monaco-lifecycle.py` and the completion-after-review checkpoint
  added to `scripts/test-linux-desktop.py`. Unpatched browser test failed with
  the reported exception; patched development and production tests each passed
  20 suggestion/acceptance cycles with no browser errors. `npm run check` passed
  (production build, type checking and 80 frontend tests). Patch application and
  repeat verification passed; Python test scripts compile. Production browser
  screenshot inspected at `build/monaco-lifecycle/production/diff.png` (isolated
  editor fixture, not a full native-app screenshot). Native CI checkpoint added
  but not executed locally.
- **Limits:** browser tests exercise real Monaco with a deterministic local
  completion provider, not authenticated AI. Native Windows/package checks and
  physical-board behavior are not asserted by this local maintenance cycle.
  No hardware programming or flash writes were performed.
- **Next priority:** investigate unsaved-draft recovery after an unexpected exit
  (R104), first checking what recovery is already implemented. Real-user check:
  close a file review, press Ctrl+Space, accept a completion, then repeat after
  switching projects and confirm existing unsaved text remains intact.
