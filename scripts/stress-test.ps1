[CmdletBinding()]
param(
    [ValidateRange(1, 10)]
    [int] $Rounds = 3,
    [ValidateRange(1, 4)]
    [int] $Parallelism = 2,
    [switch] $SkipBoardBuilds,
    [switch] $SkipHdlChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
if (-not (Test-Path -LiteralPath $cargo -PathType Leaf)) { throw 'Cargo was not found. Run npm run desktop:doctor inside studio.' }

function Invoke-Checked {
    param([string] $Name, [scriptblock] $Action)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    Write-Host "[stress] $Name" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
    Write-Host ("[pass] {0} ({1:N1}s)" -f $Name, $watch.Elapsed.TotalSeconds) -ForegroundColor Green
}

Push-Location $workspace
try {
    Invoke-Checked 'Frontend production build' { Push-Location studio; try { & npm.cmd run build } finally { Pop-Location } }
    Invoke-Checked 'Frontend behavior suite' { Push-Location studio; try { & npm.cmd test } finally { Pop-Location } }
    Invoke-Checked 'Rust security and concurrency suite' { & $cargo test --manifest-path studio/src-tauri/Cargo.toml --lib }
    if (-not $SkipHdlChecks) {
        Invoke-Checked 'Serial console lint' { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\fpga.ps1 lint -Project projects/05_serial_command_console }
        Invoke-Checked 'Serial console simulation' { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\fpga.ps1 sim -Project projects/05_serial_command_console }
        Invoke-Checked 'Hardware Intelligence lint' { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\fpga.ps1 lint -Project projects/06_hardware_intelligence }
        Invoke-Checked 'Hardware Intelligence simulation' { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\fpga.ps1 sim -Project projects/06_hardware_intelligence }
    }
    if (-not $SkipBoardBuilds -and -not $SkipHdlChecks) {
        Invoke-Checked 'Parallel board-family builds' { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-board-profiles.ps1 -Parallelism $Parallelism }
    }
    for ($round = 1; $round -le $Rounds; $round++) {
        Invoke-Checked "Repeat UI/store suite $round/$Rounds" { Push-Location studio; try { & npm.cmd test } finally { Pop-Location } }
        Invoke-Checked "Repeat backend concurrency suite $round/$Rounds" { & $cargo test --manifest-path studio/src-tauri/Cargo.toml --lib runner::tests }
    }
    Invoke-Checked 'Whitespace and patch integrity' { & git diff --check }
    Write-Host "STRESS TEST PASSED: $Rounds repeat rounds, max parallelism $Parallelism" -ForegroundColor Green
} finally {
    Pop-Location
}
