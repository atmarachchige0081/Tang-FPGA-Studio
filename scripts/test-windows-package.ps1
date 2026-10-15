[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Run this package validation on Windows; Linux cross-compilation is insufficient.'
}
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = Join-Path $repository 'build/windows-evidence'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$installers = @(Get-ChildItem (Join-Path $repository 'studio/src-tauri/target/release/bundle/nsis') -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw 'Expected exactly one freshly built NSIS installer.' }
$installer = $installers[0]
$destination = Join-Path ([IO.Path]::GetTempPath()) ('tang-package-' + [guid]::NewGuid().ToString('N'))
$result = [ordered]@{
    status = 'running'
    revision = (& git -C $repository rev-parse HEAD)
    installer = $installer.Name
    sha256 = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    workspace = 'repository checkout supplied explicitly; external one-file workspace provisioning is a separate gate'
    guiAcceptance = 'not exercised'
    hardwareAcceptance = 'not exercised'
}
try {
    # NSIS requires /D as the last argument, without embedded quotation marks.
    $process = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$destination") -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Installer exited $($process.ExitCode)." }
    $application = Join-Path $destination 'fpga-studio.exe'
    if (-not (Test-Path -LiteralPath $application -PathType Leaf)) { throw 'Installed executable was not found.' }
    $process = Start-Process -FilePath $application -ArgumentList @('--smoke-test', '--workspace', ('"{0}"' -f $repository)) -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Installed native smoke test exited $($process.ExitCode)." }
    $result.installedSmoke = 'passed'
    $uninstaller = Join-Path $destination 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'Installed uninstaller was not found.' }
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Uninstaller exited $($process.ExitCode)." }
    for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $application); $attempt++) {
        Start-Sleep -Milliseconds 200
    }
    if (Test-Path -LiteralPath $application) { throw 'Uninstall left the installed application executable behind.' }
    $result.uninstall = 'passed'
    $result.status = 'passed'
} catch {
    $result.status = 'failed'
    $result.error = $_.Exception.Message
    throw
} finally {
    $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output 'package-validation.json') -Encoding utf8
}
