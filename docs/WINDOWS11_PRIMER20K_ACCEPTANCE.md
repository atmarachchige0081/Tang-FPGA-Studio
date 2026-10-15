# Windows 11 acceptance: Tang Primer 20K with Dock

Confirmed test host: the user's Windows 11 laptop and Tang Primer 20K with the
Sipeed Dock. This document is a test procedure, not a record of a passing test.
The laptop and its USB devices are not attached to the cloud executor.

## Get the exact candidate

Use a separate local checkout so existing projects and installed releases remain
available. The default branch is named `master`; downloading it does not publish a release:

```powershell
git clone --branch master https://github.com/atmarachchige0081/Tang-FPGA-Studio.git Tang-FPGA-Studio-3.5-validation
cd Tang-FPGA-Studio-3.5-validation
git rev-parse HEAD
```

Record that SHA with all results. Install Node.js 24, stable Rust/MSVC build
prerequisites and WebView2 as described in `INSTALL.md` for source builds. Then:

```powershell
cd studio
npm ci
npm run desktop:doctor
npm run check
npm run desktop:build
cd ..
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-package.ps1
```

Stop at any failed command and preserve its output. The package helper writes
`build/windows-evidence/package-validation.json`; it installs, checks the native
production executable against this checkout, and uninstalls an isolated NSIS
package. It does not test complete one-file workspace provisioning or GUI/USB.
Those remain separate gates, including the external installer-repository build.

## Read-only board preflight

Prepare the pinned Windows tools with `fpga.ps1 setup` if not already installed.
Connect the Dock's JTAG/UART USB port and power/enable the FPGA according to its
board guide. From this checkout:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File fpga.ps1 doctor -Project projects/03_uart_terminal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File fpga.ps1 detect -Project projects/03_uart_terminal
```

Record Windows build, Studio version, tool versions, board/revision, detected
device and serial port. If driver repair is required, Interface 0 is JTAG/WinUSB;
keep Interface 1's FTDI serial driver. Do not replace both interface drivers.
Doctor/detect do not establish successful programming.

## Real acceptance in the installed 3.5.0 application

The automated package helper uninstalls its temporary copy. For the manual GUI
test, install a second isolated copy from the same NSIS package and launch it
with this candidate checkout explicitly selected (PowerShell, repository root):

```powershell
$candidateRoot = (Get-Location).Path
$packages = @(Get-ChildItem studio/src-tauri/target/release/bundle/nsis -Filter '*3.5.0*.exe')
if ($packages.Count -ne 1) { throw 'Expected exactly one 3.5.0 installer.' }
$guiInstall = Join-Path $env:TEMP ('tang-gui-' + [guid]::NewGuid().ToString('N'))
$installed = Start-Process $packages[0].FullName -ArgumentList @('/S', "/D=$guiInstall") -Wait -PassThru
if ($installed.ExitCode) { throw 'Candidate installation failed.' }
Get-FileHash $packages[0].FullName -Algorithm SHA256
Start-Process (Join-Path $guiInstall 'fpga-studio.exe') -ArgumentList @('--workspace', ('"{0}"' -f $candidateRoot))
```

This is the installed production UI, not a Vite preview. Confirm its 3.5.0 version
and preserve its installer hash. It tests NSIS plus an explicit checkout; it
does not substitute for the complete external one-file installer acceptance.
After closing the app, uninstall this copy with
`Start-Process (Join-Path $guiInstall 'uninstall.exe') -ArgumentList '/S' -Wait`.

1. Open the Dock LED/button example. Lint, simulate and build; record timing and
   bitstream SHA-256. Detect JTAG, upload to **SRAM**, and observe all documented
   button/mode/brightness functions in `projects/01_button_led_pwm/README.md`.
2. Open `projects/03_uart_terminal`. Build and upload SRAM. Select Interface 1's
   COM port at **115200, 8-N-1**. Press a user button and require the greeting
   `Tang Primer 20K UART ready` and prompt. Send known bytes and record their
   exact echo, proving transmit and receive. Close competing serial monitors.
3. Follow `HARDWARE_ANALYZER.md`: select surviving probes, save, build an analyzer
   image, upload SRAM, arm and capture a real event. Preserve configuration,
   instrumented image hash and decoded capture. A generated image or successful
   upload alone is not capture evidence. Close the normal UART terminal first.
4. After normal SRAM behavior is confirmed, use the application's **Flash**
   action and its explicit confirmation to perform the persistent-write test.
   Record the image hash, remove/reapply board power, and observe the same
   intended behavior. Do not silently flash as part of setup or preflight.
5. Exercise editor save/reopen, waveform display, reports, model/AI status, job
   cancellation, close/relaunch and the installer/upgrade path. Authenticated AI
   calls require the user's own local sign-in; never put credentials in evidence.

Save results, observed behavior and failures in a dated acceptance record tied to
the candidate SHA. Screenshots/video can support the observations. Hardware
verification records and analyzer captures are project-local under `.fpga-studio/`
and `build/analyzer/`; keep their hashes with the record.

This proves only the tested Windows 11/Dock combination. Linux USB permissions,
programming, UART and captures need a physical Ubuntu test too before claiming
hardware parity there. Other board families retain their separate build/hardware
coverage status.
