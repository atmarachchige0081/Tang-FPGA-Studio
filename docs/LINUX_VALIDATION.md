# Validation scope

The release workflows retain logs, test results, packages and generated FPGA
artifacts in GitHub Actions rather than committing them to the source tree.

- [Quality gates](https://github.com/atmarachchige0081/Tang-FPGA-Studio/actions/workflows/quality-gates.yml): frontend, Rust, Python, PowerShell and HDL checks.
- [Ubuntu native application](https://github.com/atmarachchige0081/Tang-FPGA-Studio/actions/workflows/linux.yml): Ubuntu 22.04, 24.04 and 26.04, native packages, WebDriver UI checks and FPGA build workflows.
- [Windows package validation](https://github.com/atmarachchige0081/Tang-FPGA-Studio/actions/workflows/windows-package.yml): MSVC build, NSIS installation, application smoke test and uninstallation.

Select the run for the release tag or its exact commit. A successful build on
one platform does not establish runtime compatibility on another.

The native UI checks exercise editor saves, a real shell, panel resizing,
external-file synchronization, unsaved conflicts and before/after file review.
Optional AI-fixture checks use a local protocol fixture, not a real account or
model. Authenticated AI behavior requires a user's own account.

Cloud runners do not have a Tang board attached. JTAG detection, SRAM upload,
persistent flash, UART traffic and analyzer captures require a separate physical
board test. The maintainer reported successful detection and flashing on a
Windows 11 laptop with a Tang Primer 20K Dock during development; this does not
certify every board, OS or release artifact. Console 60K vendor place/route
also requires the separately installed Gowin EDA tools.

See [Linux setup](LINUX.md), [Windows acceptance steps](WINDOWS11_PRIMER20K_ACCEPTANCE.md)
and [workbench troubleshooting](WORKBENCH_DEBUGGING.md).
