# Assistant, editor and project updates

These changes are prepared for 3.5.0. They do not constitute a tagged release.

## Use the assistant

Connect and sign in once. Studio remembers the connection preference; Codex keeps
credentials in its own local credential store. Opening another project reconnects
the provider to that project without signing the account out. Conversations are
selected separately for each workspace/project. Use History to reopen older chats.

Approval buttons stay outside collapsed command/diff details in a separate review
area. Failed responses leave the request available to resolve. Commands and hardware
writes still require individual approval. File-edit permission is saved only after
an approval succeeds.

While the agent works, type a correction and choose **Send follow-up** (or Enter).
Studio uses Codex `turn/steer` with the expected active turn ID. It does not start a
second turn or silently turn a failed follow-up into a new request. Stop remains
available separately.

## Inline editor suggestions

Open a Verilog/SystemVerilog file and enable **AI suggestions** in the editor bar.
The assistant must already be connected and signed in to this project. The toggle
is off by default. Nearby code is sent to the connected account when enabled;
normal account usage charges/limits apply.

Ghost text appears after a typing pause. **Tab** accepts it, **Esc** dismisses it,
and **Alt+Backslash** requests a suggestion. Monaco retains normal undo/redo.
Suggestions do not save files or program hardware. Only bounded nearby code is
sent; changed buffers/cursors/projects invalidate old responses. There is at most
one inline request at a time, with bounded waiting and output.

Inline requests use separate ephemeral read-only Codex threads, disable the shell
and web search, and reject tool/approval requests. Their messages and approvals
never enter the chat conversation.

## Open an existing project

Use **File → Open project folder…**, **Ctrl+O**, or **Open project…** on the welcome
screen. Choose a project folder or its containing workspace. Studio recognizes:

- `fpga.project.json` (schema 1 or 2) together with `fpga.config.psd1` for projects
  created by Studio. This portable metadata already accompanies new projects.
- `fpga.config.psd1` alone for older configured projects.

A parent folder can show several recognized projects. Select one and open it.
Projects may live outside the application/workspace folder. Existing files are
not copied, overwritten or executed by recognition. Recent projects and the
active selection are saved in workspace settings.

A generic folder containing only HDL is not enough to identify its board, target
or pin mapping. It needs a Studio build configuration before it can be opened as
a runnable project; automatic import of arbitrary vendor project formats is not
part of this change. Unknown/corrupt metadata produces an error instead of guessing.

## Recovery and hardware safety

The menu, navigation, sidebar, toolbar, active view/editor, output panel, assistant,
status bar and dialogs have independent React error boundaries. A failed region
gets one automatic retry after 800 ms; a persistent failure shows a manual retry.
Other regions remain mounted. Editor buffers live in the workbench store and are
not cleared by view recovery. Assistant messages survive panel remounting in memory; unresolved requests are
also restored from the native provider. Restarting a view never repeats a native command.

Unexpected asynchronous UI errors appear in a dismissible notice and Output.
Normal Monaco cancellation of superseded requests does not trigger an error notice.
Release notes no longer open automatically. Welcome-screen release advertising
and lesson-duration estimates are removed. The classic dark/light workbench uses
flat surfaces, square controls and larger text. Screenshot review caught and fixed
clipping when the assistant reduced the available workspace width.

Release Rust builds now unwind instead of aborting the process on any panic.
Blocking native workers catch panics and return a task error; the existing native
panic hook records diagnostics. A recovered connection lock can be reused. Native
job tracking prevents closing the window while a build/hardware job is active;
modified editor files also prevent accidental window closure.

Hardware operations are never automatically retried. AI reconnection does not
restart a programmer process. These measures cover identified application failure
paths; operating-system termination, power failure and native WebView faults still
require separate diagnosis and cannot be guaranteed recoverable.

## Verification

See `docs/evidence/agent-reliability/` for saved test/build results: 68 frontend
tests, 75 native tests (two ignored), release Clippy, production builds, five
Chromium layout screenshots and 15 native desktop/protocol fixture checkpoints.
Windows 11 with Primer 20K Dock programming success was reported by the user before these changes.
The original unexpected exit (AI sign-in while flashing) has not been reproduced
with attached hardware in the cloud. Repeat that combination on the workstation
and retain any crash log from `%LOCALAPPDATA%\Tang FPGA Studio\logs\crash.log`.
Real authenticated inline generation/account persistence requires the user's own
local Codex account; mock transport tests and protocol-schema checks do not replace
that acceptance test.

The optional `scripts/test-ui-layout.py` checks production frontend layouts using
Chromium and a demo provider (Python Playwright required). Serve the built
`studio/dist` on local port 1420 first. These are layout fixtures, not authenticated
AI evidence. `scripts/test-linux-desktop.py --ai-fixture` additionally exercises
the native protocol with `scripts/fixtures` first on PATH; it explicitly refuses a
real provider. The fixture executes no shell or FPGA commands and uses no account.

## Windows source checkout acceptance

Download the latest `master` ZIP and extract it into a new folder. Keep existing
project folders. With the existing Node/Rust/Windows build prerequisites installed,
open PowerShell in the extracted repository and run:

```powershell
cd studio
npm ci
npm run desktop
```

Use Ctrl+O to open the previous project folder. Check assistant sign-in, switch
projects and confirm the account stays signed in. Test a command approval with
long output, a follow-up during a running turn, and inline suggestions (Tab/Esc).
Then repeat AI sign-in while programming the Primer 20K Dock, retaining logs if
anything fails. View recovery never authorizes or repeats a hardware write.

Production JavaScript debug maps are omitted by default, reducing the measured
frontend assets from 58.8 MB to 14.6 MB. For a diagnostic build, set
`FPGA_STUDIO_SOURCEMAPS=1` before the frontend build.
