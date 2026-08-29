[CmdletBinding()]
param(
    [ValidateRange(1, 4)]
    [int] $Parallelism = 2,
    [switch] $KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$testRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.fpga-studio\board-smoke')).TrimEnd('\')
if (-not $testRoot.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Board smoke directory escaped the workspace: $testRoot"
}

$profiles = @(
    @{ Id='tang_nano_1k'; Device='GW1NZ-LV1QN48C6/I5'; Family='GW1NZ-1'; Yosys='gw1n'; Programmer='tangnano1k'; ClockName='clk_27mhz'; ClockMHz=27; Clock='47'; Led='9' },
    @{ Id='tang_nano_4k'; Device='GW1NSR-LV4CQN48PC6/I5'; Family='GW1NS-4'; Yosys='gw1n'; Programmer='tangnano4k'; ClockName='clk_27mhz'; ClockMHz=27; Clock='45'; Led='10' },
    @{ Id='tang_nano_9k'; Device='GW1NR-LV9QN88PC6/I5'; Family='GW1N-9C'; Yosys='gw1n'; Programmer='tangnano9k'; ClockName='clk_27mhz'; ClockMHz=27; Clock='52'; Led='10' },
    @{ Id='tang_nano_20k'; Device='GW2AR-LV18QN88C8/I7'; Family='GW2A-18C'; Yosys='gw2a'; Programmer='tangnano20k'; ClockName='clk_27mhz'; ClockMHz=27; Clock='4'; Led='15' },
    @{ Id='tang_primer_20k'; Device='GW2A-LV18PG256C8/I7'; Family='GW2A-18'; Yosys='gw2a'; Programmer='tangprimer20k'; ClockName='clk_27mhz'; ClockMHz=27; Clock='H11'; Led='L16' },
    @{ Id='tang_console_138k'; Device='GW5AST-LV138PG484AC1/I0'; Family='GW5AST-138C'; Yosys='gw5a'; Programmer='tangmega138k'; ClockName='clk_50mhz'; ClockMHz=50; Clock='V22'; Led='G11' }
)

function New-SmokeProject {
    param([hashtable] $Profile)
    $directory = Join-Path $testRoot $Profile.Id
    New-Item -ItemType Directory -Force -Path (Join-Path $directory 'rtl'), (Join-Path $directory 'constraints') | Out-Null
    $configText = @"
@{
    ToolchainVersion = '2026-07-26'
    ToolchainRoot = 'C:\fpga-tools\2026-07-26\oss-cad-suite'
    Top = 'top'
    Device = '$($Profile.Device)'
    Family = '$($Profile.Family)'
    YosysFamily = '$($Profile.Yosys)'
    BuildBackend = 'oss-cad-suite'
    Constraint = 'constraints/smoke.cst'
    ClockMHz = $($Profile.ClockMHz)
    ProgrammerBoard = '$($Profile.Programmer)'
    Bitstream = 'build/top.fs'
}
"@
    [IO.File]::WriteAllText((Join-Path $directory 'fpga.config.psd1'), $configText, [Text.UTF8Encoding]::new($false))
    $sourceText = @"
``default_nettype none
module top(input logic $($Profile.ClockName), output logic led_n);
    logic [23:0] counter = '0;
    always_ff @(posedge $($Profile.ClockName)) counter <= counter + 1'b1;
    assign led_n = ~counter[23];
endmodule
``default_nettype wire
"@
    [IO.File]::WriteAllText((Join-Path $directory 'rtl\top.sv'), $sourceText, [Text.UTF8Encoding]::new($false))
    @"
IO_LOC "$($Profile.ClockName)" $($Profile.Clock);
IO_PORT "$($Profile.ClockName)" IO_TYPE=LVCMOS33 PULL_MODE=UP;
IO_LOC "led_n" $($Profile.Led);
IO_PORT "led_n" IO_TYPE=LVCMOS33 DRIVE=8;
"@ | Set-Content -LiteralPath (Join-Path $directory 'constraints\smoke.cst') -Encoding ASCII
}

if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
$profiles | ForEach-Object { New-SmokeProject $_ }

$pending = [Collections.Generic.Queue[hashtable]]::new()
$profiles | ForEach-Object { $pending.Enqueue($_) }
$running = @()
$failures = @()
try {
    while ($pending.Count -gt 0 -or $running.Count -gt 0) {
        while ($pending.Count -gt 0 -and $running.Count -lt $Parallelism) {
            $profile = $pending.Dequeue()
            $relative = ".fpga-studio/board-smoke/$($profile.Id)"
            Write-Host "Starting board build: $($profile.Id)" -ForegroundColor Cyan
            $job = Start-Job -ScriptBlock {
                param($Root, $Project, $Id)
                try {
                    $lines = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'fpga.ps1') build -Project $Project 2>&1)
                    if ($LASTEXITCODE -ne 0) { throw ($lines -join [Environment]::NewLine) }
                    [pscustomobject]@{ Board=$Id; Success=$true; Message=($lines | Select-Object -Last 1) }
                } catch {
                    [pscustomobject]@{ Board=$Id; Success=$false; Message=$_.Exception.Message }
                }
            } -ArgumentList $workspace, $relative, $profile.Id
            $running += $job
        }
        $finished = Wait-Job -Job $running -Any
        $result = @(Receive-Job -Job $finished -Wait | Where-Object { $_.PSObject.Properties.Name -contains 'Success' }) | Select-Object -Last 1
        Remove-Job -Job $finished -Force
        $running = @($running | Where-Object { $_.Id -ne $finished.Id })
        if (-not $result -or -not $result.Success) {
            $message = if ($result) { $result.Message } else { 'Worker returned no result' }
            $failures += "$($result.Board): $message"
            Write-Host "FAILED: $message" -ForegroundColor Red
        } else {
            Write-Host "PASSED: $($result.Board)" -ForegroundColor Green
        }
    }
    if ($failures.Count) { throw "Board profile smoke failures:`n$($failures -join "`n")" }
    Write-Host "BOARD PROFILE SMOKE PASSED ($($profiles.Count) device families, parallelism $Parallelism)" -ForegroundColor Green
} finally {
    $running | Stop-Job -ErrorAction SilentlyContinue
    $running | Remove-Job -Force -ErrorAction SilentlyContinue
    if (-not $KeepArtifacts -and (Test-Path -LiteralPath $testRoot)) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
