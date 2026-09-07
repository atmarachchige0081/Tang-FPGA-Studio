# Tang FPGA Studio 3.3.0 — flexible, AI-ready project workflows

Tang FPGA Studio 3.3.0 turns project creation and repository navigation into a
complete desktop workflow while strengthening the file-safety boundary beneath
the editor.

## Highlights

- Name projects naturally with spaces, mixed case, and Unicode instead of a
  required numbered folder convention.
- Choose any writable project destination using the native Windows folder
  picker. The tool runner follows that project root, and generated artifacts
  remain in its local `build/` directory.
- Create files and folders from Explorer, refresh the project tree, and find
  files, symbols, or text across the active project.
- Apply project-wide replacements transactionally; unsaved editor buffers are
  protected and failed writes are rolled back.
- Receive an `AGENTS.md` guide in every template and custom project so AI coding
  tools understand the HDL layout, simulation/build commands, constraints, and
  safe upload/flash workflow.
- Recover from interrupted saves and receive confirmation before switching a
  project or closing with unsaved tabs.

## Hardening

Project traversal now rejects symlink and junction escapes. Board/plugin
manifests, timing and netlist reports, Git status, and HDL analysis are bounded
before parsing. Monaco's JSON, CSS, HTML, and TypeScript workers are routed to
their intended services so language intelligence no longer stalls on a missing
worker method.

## One-file Windows installation

The dedicated installer still performs the required first-machine setup. Its
recommended task downloads the pinned OSS CAD Suite (approximately 1.9 GB) and
the signed Zadig helper, verifies their pinned SHA-256 digests, and validates
Zadig's Akeo Consulting Authenticode signature. The large third-party packages
are not hidden inside the IDE executable.

Zadig does not replace a driver automatically. If JTAG repair is necessary, the
guided flow applies WinUSB only to Interface 0; Interface 1 remains the UART COM
port. Users who deselect the dependency task receive a clear warning that lint,
simulation, build, detection, upload, and flash will remain unavailable.
