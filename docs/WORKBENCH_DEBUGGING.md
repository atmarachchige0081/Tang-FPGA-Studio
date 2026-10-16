# Workbench refinement and debugging

This update stays at the prepared 3.5.0 version. It is committed to `master` for
workstation testing; no release tag is created.

## Fixes

- **Terminal:** the previous Terminal tab rendered static example text. It now
  hosts xterm with a native pseudo-terminal: Windows PowerShell on Windows 11,
  Bash on Linux. Commands, input, output, Ctrl+C, paste and terminal resizing go
  to the real shell. The shell starts in the active project directory.
  Changing bottom tabs or recovering the panel reconnects to the same shell;
  no command is replayed. Restart explicitly stops the old shell. Shells are
  independent from the FPGA job runner and Codex provider. Up to four project
  sessions can remain open; type `exit` in an unused shell to free its slot.
  Restart affects the current project's shell. Output backpressure bounds the
  rate of native events so output-heavy commands cannot flood the WebView.
- **Panel sizes:** drag the Explorer's right edge, the assistant's left edge, or
  the bottom panel's top edge. Sizes persist locally. Double-click a divider to
  reset it. Focus a divider and use arrow keys (Shift for larger steps), or Home
  to reset. Minimum sizes preserve usable controls; the editor follows resizing.
- **Live edits:** open files synchronize with disk every second and on provider
  events, regardless of whether the assistant is visible. Project discovery
  refreshes without changing the active-project settings or blocking builds.
  Clean buffers follow actual file writes. Pending changes get persistent coloured
  line and gutter indicators until reviewed.
  One unreadable file does not block other open buffers from updating.
  This also covers shell tools whose edits have no Codex file-change event.
  Streaming chat text is not inserted as source code.
- **Agent context:** workspace-relative editor and unsaved-file paths now resolve
  exactly once against the active project, avoiding duplicated nested project
  folders in prompts and approval validation.
- **Conflicts:** unsaved editor text is preserved when a file changes on disk.
  Choose Load disk version or Keep my edits. A deleted file's buffer remains
  open. Saving over a known unresolved disk conflict requires confirmation.
- **Suggestions:** the newest valid cursor request waits for an active inline
  request instead of disappearing. Stale/cancelled requests are discarded.
  Inline generation connects to the current project's provider, checks sign-in,
  uses low reasoning effort and allows up to 30 seconds for generation. A model
  returning a final message without deltas is supported. Suggest/Alt+Backslash
  explicitly requests ghost text; Tab accepts and Esc dismisses it.
- **Offline completion:** Ctrl+Space offers indexed HDL symbols, ports, keywords
  and editable snippets for modules, clocked/combinational blocks, assignments,
  cases and generate loops. This works without an AI account.
- **Polish:** the existing classic dark/light colours remain. Editor context is
  shorter, and terminal clear/copy actions now operate on the terminal itself.
  Agent instructions explicitly complete requested implementations and verify
  them; project boundaries, file review and hardware approvals remain enforced.

## Native file review

The provider-independent Rust journal observes saved project text, including files
that are not open. It compares against the version when tracking began, accumulating
edits until reviewed. The status bar's Changes button opens the project list;
Review changes above a modified editor or a click on its gutter marker opens that
file's before/after diff. Added, modified and deleted files are labelled A/M/D.
Green/blue/red gutter marks identify insertions, replacements and deletions.

The review uses Monaco's read-only diff editor with previous/next navigation and
folded unchanged regions. Mark file reviewed acknowledges only the displayed
revision and never modifies source. A later edit remains pending. The journal
also records editor saves and external tools; it does not infer authorship or
claim every external write came from an AI. No Git repository or provider-specific
diff command is needed.

Snapshots are in memory, bounded to four project journals, 512 text files,
256 KiB per file and 8 MiB of current text per project. Pending diff text is bounded
to 16 MiB per journal. Oversized files trigger a tracking-limit notice. Hidden,
sensitive and build-output files are excluded. App restart begins a new baseline;
this is a review aid, not a persistent backup or version-control replacement.

## Windows local check

Extract the latest master ZIP into a new folder and retain your existing project
folders. With your existing build prerequisites installed:

```powershell
cd studio
npm ci
npm run desktop
```

1. Open a previous project with Ctrl+O. Open Terminal and run `Get-Location`,
   `Write-Output 'terminal works'`, then `1..3 | ForEach-Object { $_ }`. Switch to
   Output and back; the same shell and working directory should remain.
2. Drag all three dividers. Close/reopen Studio and check the saved dimensions.
3. Open an HDL file, then ask the agent to make a small approved edit. Observe
   the changed source and line highlight without reopening the file. Repeat
   with the assistant closed and a change saved from another editor. Use Changes
   to inspect the before/after view, including unopened/new files. Mark a file
   reviewed and verify its indicator clears without changing its source.
4. Type an unsaved local edit, then change that file externally. Verify the
   local text remains and choose how to resolve the conflict.
5. With Codex signed in, enable AI suggestions and use Suggest or Alt+Backslash.
   Wait for the status, accept with Tab, or dismiss with Esc. Verify ordinary
   HDL completions with Ctrl+Space even when AI suggestions are disabled.
6. Repeat the previous AI sign-in while programming check on the Primer 20K Dock.

## Evidence boundaries

Saved logs and inspected screenshots are in `evidence/workbench-refinement/`.
Linux desktop checks use a local Codex protocol fixture, not real account
inference. A real PTY, real keyboard input, real pointer drags and actual file
writes are exercised. No cloud physical-board or Windows ConPTY GUI pass is
claimed. Model latency/quality still depends on the selected account/provider.
The previous Windows sign-in-while-flashing exit needs workstation acceptance.

Verified in this update: 80 frontend tests, 80 native tests (two ignored), release
Clippy, final production frontend/native builds, 24 native desktop checkpoints
with the local protocol fixture and 18 native checkpoints with AI disabled.
See the saved validation manifest and native screenshots for scope and limitations.
