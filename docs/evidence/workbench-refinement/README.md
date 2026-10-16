# Workbench refinement evidence

The final frontend checks pass 80 tests in 26 files, including synchronization,
conflicts, suggestions, resizing and read-only review. The final production
frontend build is recorded separately because a final visual style change followed
the combined check. Native release tests pass 80 tests (two intentionally ignored),
and release Clippy passes with warnings denied.

`layout-fixture-review-*.png` show the real change-review component with synthetic
text in Chromium. They are layout checks, not native file-tracking evidence.
The native desktop screenshots/results exercise the actual application, native
file journal, shell PTY, keyboard input, pointer resizing and filesystem writes.
Codex protocol checks use a clearly labelled local fixture with no account,
network inference or hardware commands.

No Windows ConPTY GUI, physical board or real authenticated AI model pass is
claimed here. The prior Windows exit while signing in during flashing still
needs workstation acceptance. No release tag is created. Older deb/AppImage
artifacts predate this source update.

An initial final run stopped during OS-focused screenshot capture under Xvfb
(X_GetGeometry; no focused window). It did not establish a complete pass. The
harness now uses WebDriver viewport capture; the retained attempt log distinguishes
that capture failure from the subsequent complete run.

The first no-AI run lost the WebDriver HTTP connection while typing into the
terminal after interrupt. The harness does not retry potentially delivered input;
that attempt is retained separately and the complete test is rerun in a fresh
isolated workspace.

A second no-AI attempt asserted the new file list before the periodic frontend
refresh. The assertion now waits for that exact visible file (and still fails
if it never appears). Its timing failure is retained separately.

Final native acceptance passed all 24 checkpoints with the local protocol fixture
and all 18 checkpoints with AI disabled. Both use the same final production binary.
