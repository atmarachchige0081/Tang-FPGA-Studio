# Maintenance log

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
