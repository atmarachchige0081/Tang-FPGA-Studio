[CmdletBinding()]
param(
    [ValidateRange(1, 3)]
    [int] $Parallelism = 2,
    [switch] $KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$testRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.fpga-studio\console-matrix')).TrimEnd('\')
if (-not $testRoot.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Console test directory escaped the workspace: $testRoot"
}

$boards = @(
    @{ Id='tang_console_60k'; Device='GW5AT-LV60PG484AC1/I0'; Family='GW5AT-60B'; Backend='gowin-eda'; DeviceName='GW5AT-60B'; DeviceCode='gw5at60b-002'; DeviceVersion='B'; Programmer='tangconsole' },
    @{ Id='tang_console_138k'; Device='GW5AST-LV138PG484AC1/I0'; Family='GW5AST-138C'; Backend='oss-cad-suite'; DeviceName='GW5AST-138C'; DeviceCode='gw5ast138c-007'; DeviceVersion='C'; Programmer='tangmega138k' }
)
$variants = @('minimal', 'led', 'counter', 'clocked', 'reset', 'moderate')

function Get-VariantSource {
    param([Parameter(Mandatory)] [string] $Variant)
    switch ($Variant) {
        'minimal' {
@'
`default_nettype none
module top(input logic clk_50mhz, input logic [1:0] btn_n, output logic [1:0] led_n);
    logic sampled = 1'b0;
    always_ff @(posedge clk_50mhz) sampled <= btn_n[0];
    assign led_n = {~sampled, btn_n[0]};
endmodule
`default_nettype wire
'@
        }
        'led' {
@'
`default_nettype none
module top(input logic clk_50mhz, input logic [1:0] btn_n, output logic [1:0] led_n);
    logic heartbeat = 1'b0;
    always_ff @(posedge clk_50mhz) heartbeat <= ~heartbeat;
    assign led_n = {~heartbeat, btn_n[0]};
endmodule
`default_nettype wire
'@
        }
        'counter' {
@'
`default_nettype none
module top(input logic clk_50mhz, input logic [1:0] btn_n, output logic [1:0] led_n);
    logic [25:0] counter = '0;
    always_ff @(posedge clk_50mhz) counter <= counter + 1'b1;
    assign led_n = {~counter[24], btn_n[0]};
endmodule
`default_nettype wire
'@
        }
        'clocked' {
@'
`default_nettype none
module top(input logic clk_50mhz, input logic [1:0] btn_n, output logic [1:0] led_n);
    logic [31:0] shift = 32'h1;
    always_ff @(posedge clk_50mhz) shift <= {shift[30:0], shift[31] ^ shift[21] ^ btn_n[0]};
    assign led_n = ~shift[1:0];
endmodule
`default_nettype wire
'@
        }
        'reset' {
@'
`default_nettype none
module top(input logic clk_50mhz, input logic [1:0] btn_n, output logic [1:0] led_n);
    logic [25:0] counter = '0;
    always_ff @(posedge clk_50mhz) begin
        if (!btn_n[1]) counter <= '0;
        else counter <= counter + 1'b1;
    end
    assign led_n = {~counter[24], btn_n[0]};
endmodule
`default_nettype wire
'@
        }
        'moderate' {
@'
`default_nettype none
module top(input logic clk_50mhz, input logic [1:0] btn_n, output logic [1:0] led_n);
    logic [31:0] lane [0:15];
    integer i;
    always_ff @(posedge clk_50mhz) begin
        if (!btn_n[1]) begin
            for (i = 0; i < 16; i = i + 1) lane[i] <= i;
        end else begin
            lane[0] <= lane[0] + 32'h9e3779b9 + btn_n[0];
            for (i = 1; i < 16; i = i + 1)
                lane[i] <= {lane[i-1][30:0], lane[i-1][31]} ^ (32'h01010101 * i);
        end
    end
    assign led_n = ~{lane[15][24], lane[7][23]};
endmodule
`default_nettype wire
'@
        }
        default { throw "Unknown Console build variant: $Variant" }
    }
}

function New-ConsoleProject {
    param([hashtable] $Board, [string] $Variant)
    $directory = Join-Path $testRoot "$($Board.Id)_$Variant"
    New-Item -ItemType Directory -Force -Path (Join-Path $directory 'rtl'), (Join-Path $directory 'constraints') | Out-Null
    $config = @"
@{
    ToolchainVersion = '2026-07-26'
    ToolchainRoot = 'C:\fpga-tools\2026-07-26\oss-cad-suite'
    Top = 'top'
    Device = '$($Board.Device)'
    Family = '$($Board.Family)'
    YosysFamily = 'gw5a'
    BuildBackend = '$($Board.Backend)'
    GowinDeviceName = '$($Board.DeviceName)'
    GowinDeviceCode = '$($Board.DeviceCode)'
    GowinDeviceVersion = '$($Board.DeviceVersion)'
    Constraint = 'constraints/console.cst'
    TimingConstraint = 'constraints/console.sdc'
    ClockMHz = 50
    ProgrammerBoard = '$($Board.Programmer)'
    Bitstream = 'build/top.fs'
}
"@
    [IO.File]::WriteAllText((Join-Path $directory 'fpga.config.psd1'), $config, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $directory 'rtl\top.sv'), (Get-VariantSource $Variant), [Text.UTF8Encoding]::new($false))
    Copy-Item -LiteralPath (Join-Path $workspace "boards\gowin\$($Board.Id)\constraints\$($Board.Id).cst") -Destination (Join-Path $directory 'constraints\console.cst')
    Copy-Item -LiteralPath (Join-Path $workspace "boards\gowin\$($Board.Id)\constraints\$($Board.Id).sdc") -Destination (Join-Path $directory 'constraints\console.sdc')
}

if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
foreach ($board in $boards) {
    foreach ($variant in $variants) { New-ConsoleProject $board $variant }
}

$gowinCandidates = @(
    (Get-Command gw_sh -ErrorAction SilentlyContinue | ForEach-Object { $_.Source }),
    $(if ($env:GOWIN_EDA_ROOT) { Join-Path $env:GOWIN_EDA_ROOT 'IDE\bin\gw_sh.exe' }),
    @(Get-Item -Path 'C:\Gowin\Gowin_*\IDE\bin\gw_sh.exe' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
$gowinAvailable = @($gowinCandidates).Count -gt 0

$cases = [Collections.Generic.Queue[hashtable]]::new()
foreach ($board in $boards) {
    foreach ($variant in $variants) { $cases.Enqueue(@{ Board=$board; Variant=$variant }) }
}
$running = @()
$results = @()
try {
    while ($cases.Count -gt 0 -or $running.Count -gt 0) {
        while ($cases.Count -gt 0 -and $running.Count -lt $Parallelism) {
            $case = $cases.Dequeue()
            $relative = ".fpga-studio/console-matrix/$($case.Board.Id)_$($case.Variant)"
            Write-Host "Starting $($case.Board.Id) $($case.Variant)" -ForegroundColor Cyan
            $running += Start-Job -ScriptBlock {
                param($Root, $Project, $Board, $Variant, $VendorAvailable)
                $lines = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'fpga.ps1') build -Project $Project 2>&1)
                $exitCode = $LASTEXITCODE
                if ($Board -eq 'tang_console_60k' -and -not $VendorAvailable) {
                    $absolute = Join-Path $Root $Project
                    $gprj = Join-Path $absolute 'build\gowin\studio.gprj'
                    $tcl = Join-Path $absolute 'build\gowin\build.tcl'
                    $valid = $exitCode -eq 1 -and ($lines -join "`n") -match 'require Gowin EDA Education' -and
                        (Test-Path -LiteralPath $gprj) -and (Test-Path -LiteralPath $tcl) -and
                        (Get-Content -LiteralPath $gprj -Raw) -match 'GW5AT-LV60PG484AC1/I0' -and
                        (Get-Content -LiteralPath $gprj -Raw) -match 'gw5at60b-002' -and
                        (Get-Content -LiteralPath $tcl -Raw) -match 'set_option -bit_compress 0'
                    return [pscustomobject]@{ Board=$Board; Variant=$Variant; Success=$valid; Structural=$true; Message=(($lines | Select-Object -Last 12) -join [Environment]::NewLine) }
                }
                [pscustomobject]@{ Board=$Board; Variant=$Variant; Success=($exitCode -eq 0); Structural=$false; Message=(($lines | Select-Object -Last 12) -join [Environment]::NewLine) }
            } -ArgumentList $workspace, $relative, $case.Board.Id, $case.Variant, $gowinAvailable
        }
        $finished = Wait-Job -Job $running -Any
        $result = @(Receive-Job -Job $finished -Wait | Where-Object { $_.PSObject.Properties.Name -contains 'Success' }) | Select-Object -Last 1
        Remove-Job -Job $finished -Force
        $running = @($running | Where-Object { $_.Id -ne $finished.Id })
        $results += $result
        if (-not $result -or -not $result.Success) {
            $label = if ($result) { "$($result.Board) $($result.Variant): $($result.Message)" } else { 'Worker returned no result' }
            Write-Host "FAILED: $label" -ForegroundColor Red
        } else {
            $kind = if ($result.Structural) { 'synthesis + generated Gowin project' } else { 'full bitstream' }
            Write-Host "PASSED: $($result.Board) $($result.Variant) ($kind)" -ForegroundColor Green
        }
    }
    $failed = @($results | Where-Object { -not $_.Success })
    if ($failed.Count) { throw "$($failed.Count) Console matrix case(s) failed" }
    $full = @($results | Where-Object { -not $_.Structural }).Count
    $structural = @($results | Where-Object { $_.Structural }).Count
    Write-Host "CONSOLE MATRIX PASSED ($full full bitstreams, $structural vendor structural checks)" -ForegroundColor Green
    if (-not $gowinAvailable) {
        Write-Warning 'Gowin EDA was not installed: 60K place/route/bitstream and hardware programming were not performed.'
    }
} finally {
    $running | Stop-Job -ErrorAction SilentlyContinue
    $running | Remove-Job -Force -ErrorAction SilentlyContinue
    if (-not $KeepArtifacts -and (Test-Path -LiteralPath $testRoot)) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
