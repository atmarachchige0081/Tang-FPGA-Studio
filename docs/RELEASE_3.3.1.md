# Tang FPGA Studio 3.3.1 — installer integration hotfix

Tang FPGA Studio 3.3.1 preserves the complete flexible-project workflow from
3.3.0 and corrects its one-file Windows installer synchronization.

The installer now copies the shared project `AGENTS.md` guide to both places
that need it: the workspace payload delivered to users and the native Rust
source layout that embeds the guide at compile time. A dependency-contract
regression verifies that both copies exist and are identical before a package
is built.

All Studio 3.3 functionality remains unchanged: natural project names,
arbitrary writable save locations, Explorer create and refresh actions,
project-wide find and transactional replace, external-project Git context,
and guarded editing and project switching.
