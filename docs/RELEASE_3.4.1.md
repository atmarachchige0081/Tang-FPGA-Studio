# Tang FPGA Studio 3.4.1 — version-label correction

This patch release corrects the title-bar badge that showed `3.3` in the
v3.4.0 application. The badge, welcome screen, and first-launch button now
read their version from the package metadata so future releases stay aligned.

It includes the [v3.4.0 AI assistant and production packaging changes](RELEASE_3.4.0.md),
including the Stop watchdog and stale-turn protection. Each user signs in with
their own Codex account or API key; no developer credentials are packaged.

Open AI Assistant with the robot icon in the left activity bar, **Edit → Open
AI Assistant**, or **Ctrl+Shift+A**.
