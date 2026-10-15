[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $InstallerRoot,
    [switch] $InstallToolchain
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows is required.' }
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$automation = [IO.Path]::GetFullPath($InstallerRoot)
$version = (Get-Content (Join-Path $repository 'studio/package.json') -Raw | ConvertFrom-Json).version
$output = Join-Path $repository 'build/windows-full-installer-evidence'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$installer = Join-Path $automation "dist/TangPrimerFPGAStudio-Setup-$version.exe"
$installedDirectory = Join-Path $env:ProgramFiles 'Tang Primer FPGA Studio'
$installedApplication = Join-Path $installedDirectory 'fpga-studio.exe'
$workspace = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Tang Primer FPGA Studio'
if (Test-Path -LiteralPath $installedDirectory) { throw 'Use a clean Windows validation runner; an installation already exists.' }
if (Test-Path -LiteralPath $workspace) { throw 'Use a clean Windows validation runner; a Documents workspace already exists.' }
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'The complete candidate installer is missing.' }
$result = [ordered]@{
    status = 'running'
    version = $version
    sourceRevision = (& git -C $repository rev-parse HEAD)
    installerAutomationRevision = (& git -C $automation rev-parse HEAD)
    installerSha256 = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    hardware = 'not exercised; no board attached to hosted runner'
    guiAcceptance = 'pending Windows 11 workstation'
}
function Invoke-RecordedProcess {
    param([string] $Name, [string] $Executable, [string[]] $Arguments, [string] $Directory)
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $Directory -Wait -PassThru `
        -RedirectStandardOutput (Join-Path $output "$Name.stdout.txt") -RedirectStandardError (Join-Path $output "$Name.stderr.txt")
    if ($process.ExitCode -ne 0) { throw "$Name exited $($process.ExitCode); see captured output." }
}
try {
    $tasks = if ($InstallToolchain) { 'desktopicon,toolchain' } else { 'desktopicon' }
    $log = Join-Path $output 'installation.txt'
    $process = Start-Process $installer -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/TASKS=`"$tasks`"", "/LOG=`"$log`"") -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Complete installer exited $($process.ExitCode)." }
    if (-not (Test-Path -LiteralPath $installedApplication -PathType Leaf)) { throw 'Installed application is missing.' }
    if (-not (Test-Path -LiteralPath (Join-Path $workspace 'fpga.ps1') -PathType Leaf)) { throw 'Installer did not provision the Documents workspace.' }
    $binaryVersion = (Get-Item -LiteralPath $installedApplication).VersionInfo.ProductVersion
    if (-not $binaryVersion.StartsWith($version, [StringComparison]::Ordinal)) { throw "Unexpected installed version: $binaryVersion" }
    Invoke-RecordedProcess 'installed-smoke' $installedApplication @('--smoke-test') $workspace
    $result.installedWorkspaceSmoke = 'passed without an explicit --workspace override'

    $shortcuts = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Tang FPGA Studio.lnk'), (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Tang FPGA Studio.lnk'))
    $shortcutPath = $shortcuts | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $shortcutPath) { throw 'Desktop shortcut was not created.' }
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    if ($shortcut.WorkingDirectory.TrimEnd('\') -ne $workspace.TrimEnd('\')) { throw 'Shortcut does not select the writable Documents workspace.' }
    $result.desktopShortcut = 'passed'

    $markerDirectory = Join-Path $workspace 'projects/release-acceptance-user-project'
    New-Item -ItemType Directory -Path $markerDirectory | Out-Null
    $marker = Join-Path $markerDirectory 'preserve.txt'
    $contents = [guid]::NewGuid().ToString('N')
    Set-Content -LiteralPath $marker -Value $contents -NoNewline
    Invoke-RecordedProcess 'prepare-again' 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $installedDirectory 'Prepare-Workspace.ps1')), '-Template', ('"{0}"' -f (Join-Path $installedDirectory 'workspace-template')), '-Destination', ('"{0}"' -f $workspace)) $workspace
    if ((Get-Content -LiteralPath $marker -Raw) -ne $contents) { throw 'Workspace preparation overwrote user project data.' }
    $result.repreparePreservesUserProject = 'passed'

    if ($InstallToolchain) {
        foreach ($action in @('lint', 'sim', 'build')) {
            Invoke-RecordedProcess "fpga-$action" 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $workspace 'fpga.ps1')), $action, '-Project', 'projects/03_uart_terminal') $workspace
        }
        $project = Join-Path $workspace 'projects/03_uart_terminal'
        $bitstream = Join-Path $project 'build/top.fs'
        if ((Get-Item -LiteralPath $bitstream).Length -le 1024) { throw 'Installed Windows FPGA workflow produced no bitstream.' }
        Copy-Item (Join-Path $project 'build/timing.json') (Join-Path $output 'timing.json')
        $result.installedFpgaWorkflows = 'lint, self-checking simulation and bitstream build passed'
        $result.bitstreamSha256 = (Get-FileHash $bitstream -Algorithm SHA256).Hash.ToLowerInvariant()
    } else { $result.installedFpgaWorkflows = 'not exercised; toolchain installation not selected' }

    $uninstaller = Join-Path $installedDirectory 'unins000.exe'
    $process = Start-Process $uninstaller -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Complete uninstaller exited $($process.ExitCode)." }
    if (Test-Path -LiteralPath $installedApplication) { throw 'Uninstall left the application executable behind.' }
    if ((Get-Content -LiteralPath $marker -Raw) -ne $contents) { throw 'Uninstall removed or changed the user project.' }
    $result.uninstallPreservesUserProject = 'passed'
    $result.status = 'passed'
} catch {
    $result.status = 'failed'
    $result.error = $_.Exception.Message
    throw
} finally {
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'validation.json') -Encoding utf8
}
