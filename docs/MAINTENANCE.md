# Maintenance log

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
