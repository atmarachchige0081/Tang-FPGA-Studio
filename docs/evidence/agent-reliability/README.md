# Workbench verification

Frontend production build and 68 tests passed. Native release tests passed
(75 passed, two intentionally ignored), and release Clippy passed. The native
log includes the earlier production build before the final frontend-only
cancellation filter and source-map change; `production-build.txt` records the
final embedded frontend build.

`layout-results.json` and `retro-*.png` are Chromium layout fixtures with a demo
provider. They establish rendering and approval button visibility only.
`native-results.json` and `native-*.png` exercise the actual native Linux app
with an explicitly local, unauthenticated Codex protocol fixture. The fixture
executes no FPGA or shell commands. Ghost text, Tab acceptance, explicit Save,
reconnect, steering and tool refusal are exercised.

No Windows hardware, real authenticated AI inference or reproduction of the
reported Windows exit is claimed. Older Linux package artifacts precede this
workbench update. No release tag was created.

One final desktop attempt lost the WebDriver HTTP connection during folder
selection. It was stopped and rerun in a fresh isolated workspace; see
`webdriver-incomplete-attempt.txt`. No hardware action was involved.
