# Tang FPGA Studio 3.1.1 - editor loading hotfix

Tang FPGA Studio 3.1.1 fixes a production packaging defect that could leave an
opened source file on Monaco's **Loading...** screen forever. The filesystem
read completed, but the editor component used its default CDN loader. The
desktop content-security policy correctly blocks remote scripts, so Monaco
could not initialize in the packaged application.

The hotfix configures `@monaco-editor/react` with the installed
`monaco-editor` package and a Vite-bundled editor worker. Editor code now ships
inside the application, starts under the existing security policy, and remains
available offline.

## Scope

- Added one local Monaco loader configuration module.
- Loaded that configuration before the editor component mounts.
- Added a focused regression test for the bundled Monaco instance and worker.
- Bumped application, npm, Cargo, and Tauri metadata to 3.1.1.

This patch does not change FPGA board definitions, generated projects, build
routes, constraints, programming behavior, UART behavior, or hardware drivers.

## Incident note

The relevant editor and security configuration predates v3.1.0; comparison
with v3.0.0 found no editor-code change in the v3.1 feature commit. The defect
was therefore exposed in the v3.1.0 production package, but it was not caused
by the Tang Console feature work. No false regression commit is attributed.

## Verification

- Focused Monaco loader regression test: required to pass.
- Complete frontend type check, production build, and test suite: required to
  pass.
- Rust backend tests and repository release checks: required to pass.
- Production NSIS installer build and packaged file-edit smoke test: required
  before publication.

Physical FPGA hardware is not required for this UI-only hotfix. Existing Tang
Console 60K/138K and other board regression suites remain part of the release
gate; no new hardware-validation claim is made.
