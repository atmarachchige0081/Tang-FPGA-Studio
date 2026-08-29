[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('help', 'setup', 'driver', 'doctor', 'lint', 'sim', 'wave', 'debug', 'build', 'upload', 'flash', 'detect', 'serial', 'clean', 'analyzer-build', 'analyzer-upload', 'experiment')]
    [string] $Command = 'help',

    [string] $Project = '.',
    [string] $Port,
    [ValidateRange(300, 4000000)]
    [int] $Baud = 115200,
    [string] $Testbench,
    [ValidatePattern('^[A-Za-z_]\w*$')]
    [string] $TestbenchTop = 'tb_top',
    [string] $WaveLayout,
    [switch] $NoBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$WorkspaceRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$projectCandidate = if ([IO.Path]::IsPathRooted($Project)) {
    $Project
} else {
    Join-Path $WorkspaceRoot $Project
}
$ProjectRoot = [IO.Path]::GetFullPath($projectCandidate).TrimEnd('\')
if ($ProjectRoot -ne $WorkspaceRoot -and
    -not $ProjectRoot.StartsWith($WorkspaceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Project must be inside the workspace: $ProjectRoot"
}
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project directory does not exist: $ProjectRoot"
}
$ConfigPath = Join-Path $ProjectRoot 'fpga.config.psd1'
if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Project configuration is missing: $ConfigPath"
}
$Config = Import-PowerShellDataFile -LiteralPath $ConfigPath
$BuildDir = Join-Path $ProjectRoot 'build'

function Write-Usage {
    @'
Tang Primer 20K FPGA commands

  .\fpga.ps1 setup                 Install the pinned OSS CAD Suite
  .\fpga.ps1 driver                Open the JTAG-only WinUSB installer
  .\fpga.ps1 doctor                Check tools and attached USB devices
  .\fpga.ps1 lint                  Lint all RTL with Verilator
  .\fpga.ps1 sim                   Run the self-checking Icarus simulation
  .\fpga.ps1 wave                  Simulate and open GTKWave
  .\fpga.ps1 debug                 Lint, simulate, then open GTKWave
  .\fpga.ps1 build                 Synthesize, place/route, and pack top.fs
  .\fpga.ps1 upload                Build and load SRAM (volatile)
  .\fpga.ps1 flash                 Build and program flash (persistent)
  .\fpga.ps1 detect                Detect the JTAG chain
  .\fpga.ps1 analyzer-build        Build saved, non-destructive analyzer instrumentation
  .\fpga.ps1 analyzer-upload       Build and load the analyzer image into SRAM only
  .\fpga.ps1 experiment            Run a saved optimization experiment
  .\fpga.ps1 serial -Port COM5     Open the UART monitor (Ctrl+C to exit)
  .\fpga.ps1 clean                 Remove generated build files

Add -NoBuild to upload/flash to reuse build/top.fs.
Use -Testbench sim/tb_name.sv -TestbenchTop tb_name to select one testbench.
Use -WaveLayout sim/name.gtkw with wave/debug to select a GTKWave layout.
Use -Project projects/<folder> to run a project from the workspace root.
'@ | Write-Host
}

function Initialize-Toolchain {
    $toolchainRoot = if ($env:OSS_CAD_SUITE_ROOT) {
        $env:OSS_CAD_SUITE_ROOT
    } else {
        $Config.ToolchainRoot
    }

    $environmentScript = Join-Path $toolchainRoot 'environment.ps1'
    if (-not (Test-Path -LiteralPath $environmentScript)) {
        throw "OSS CAD Suite is not installed at '$toolchainRoot'. Run '.\fpga.ps1 setup'."
    }

    # The upstream environment script only initializes YOSYSHQ_ROOT when it is
    # unset, so set it explicitly when a caller selects an override.
    $env:YOSYSHQ_ROOT = "$($toolchainRoot.TrimEnd('\'))\"
    . $environmentScript

    # Yosys/ABC on Windows still splits some temporary paths at spaces. Keep
    # its scratch directory beside the toolchain, outside the spaced user path.
    $toolBase = Split-Path -Parent (Split-Path -Parent $toolchainRoot)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $projectHash = ([BitConverter]::ToString(
            $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($ProjectRoot))
        )).Replace('-', '').Substring(0, 16).ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
    # Parallel builds must never share ABC/Yosys scratch files. The hashed
    # folder also avoids the spaces in user project paths that Windows ABC
    # cannot reliably parse.
    $fpgaTemp = Join-Path $toolBase "tmp\project-$projectHash"
    New-Item -ItemType Directory -Force -Path $fpgaTemp | Out-Null
    $env:TEMP = $fpgaTemp
    $env:TMP = $fpgaTemp
}

function Invoke-NativeTool {
    param(
        [Parameter(Mandatory)] [string] $Executable,
        [Parameter()] [string[]] $ArgumentList = @()
    )

    $displayArgs = $ArgumentList | ForEach-Object {
        if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    }
    Write-Host ("> {0} {1}" -f $Executable, ($displayArgs -join ' ')) -ForegroundColor DarkGray
    & $Executable @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE."
    }
}

function Get-ProjectBuildBackend {
    if ($Config.ContainsKey('BuildBackend') -and $Config.BuildBackend) {
        return [string]$Config.BuildBackend
    }
    'oss-cad-suite'
}

function Get-GowinShell {
    $candidates = @()
    if ($env:GOWIN_EDA_ROOT) {
        $candidates += @(
            (Join-Path $env:GOWIN_EDA_ROOT 'IDE\bin\gw_sh.exe'),
            (Join-Path $env:GOWIN_EDA_ROOT 'bin\gw_sh.exe')
        )
    }
    $command = Get-Command 'gw_sh' -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $candidates += @(Get-Item -Path 'C:\Gowin\Gowin_*\IDE\bin\gw_sh.exe' -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName })
    $shell = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
        Select-Object -First 1
    if (-not $shell) {
        throw "Tang Console 60K builds require Gowin EDA Education 1.9.11.03 or newer because the pinned open-source device database does not include GW5AT-60B. Install Gowin EDA, then set GOWIN_EDA_ROOT to the folder that contains IDE\bin\gw_sh.exe. Lint and simulation remain available without Gowin EDA."
    }
    $shell
}

function Get-RelativeProjectPath {
    param([Parameter(Mandatory)] [string] $Path)
    # Windows PowerShell 5.1 uses .NET Framework, which predates
    # [IO.Path]::GetRelativePath(). All project sources are required to live
    # below the workspace, so a validated prefix removal is sufficient.
    $rootPrefix = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\') + '\'
    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the project: $fullPath"
    }
    $fullPath.Substring($rootPrefix.Length).Replace('\', '/')
}

function Get-RtlSources {
    $rtlRoot = Join-Path $ProjectRoot 'rtl'
    $sources = @(Get-ChildItem -LiteralPath $rtlRoot -Recurse -File |
        Where-Object { $_.Extension -in @('.v', '.sv') } |
        Sort-Object FullName)
    if ($sources.Count -eq 0) {
        throw "No Verilog/SystemVerilog sources were found under '$rtlRoot'."
    }
    $sources
}

function New-BuildDirectory {
    New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
}

function Invoke-YosysSynthesis {
    $sourceLines = Get-RtlSources | ForEach-Object {
        $relative = Get-RelativeProjectPath $_.FullName
        "read_verilog -sv `"$relative`""
    }
    $yosysScript = @(
        '# Generated by fpga.ps1; edit fpga.config.psd1 and rtl/ instead.'
        $sourceLines
        "synth_gowin -top $($Config.Top) -family $($Config.YosysFamily) -json build/top.json"
        '# Preserve a second, IO-pad-free user netlist for non-destructive Logic Analyzer linking.'
        'design -reset'
        $sourceLines
        "synth_gowin -top $($Config.Top) -family $($Config.YosysFamily) -noiopads -json build/analyzer_user.json"
        'stat'
    ) -join [Environment]::NewLine
    [IO.File]::WriteAllText(
        (Join-Path $BuildDir 'synth.ys'),
        $yosysScript + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )
    Invoke-NativeTool 'yosys' @('-q', '-l', 'build/yosys.log', '-s', 'build/synth.ys')
}

function Invoke-GowinEdaBuild {
    foreach ($required in @('GowinDeviceName', 'GowinDeviceCode', 'GowinDeviceVersion')) {
        if (-not $Config.ContainsKey($required) -or -not $Config[$required]) {
            throw "Gowin EDA build configuration is missing '$required'. Re-select the board in a v3.1 project."
        }
    }
    $vendorDirectory = Join-Path $BuildDir 'gowin'
    if (Test-Path -LiteralPath $vendorDirectory) {
        $resolvedBuild = [IO.Path]::GetFullPath($BuildDir).TrimEnd('\')
        $resolvedVendor = [IO.Path]::GetFullPath($vendorDirectory).TrimEnd('\')
        if (-not $resolvedVendor.StartsWith($resolvedBuild + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to replace a Gowin build path outside the project build folder: $resolvedVendor"
        }
        Remove-Item -LiteralPath $vendorDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $vendorDirectory | Out-Null

    $fileEntries = @(Get-RtlSources | ForEach-Object {
        $relative = '../../' + (Get-RelativeProjectPath $_.FullName)
        $escaped = [Security.SecurityElement]::Escape($relative)
        "        <File path=`"$escaped`" type=`"file.verilog`" enable=`"1`"/>"
    })
    $constraintPath = Join-Path $ProjectRoot $Config.Constraint
    if (-not (Test-Path -LiteralPath $constraintPath -PathType Leaf)) {
        throw "Constraint file is missing: $constraintPath"
    }
    $constraintRelative = [Security.SecurityElement]::Escape('../../' + $Config.Constraint.Replace('\', '/'))
    $fileEntries += "        <File path=`"$constraintRelative`" type=`"file.cst`" enable=`"1`"/>"
    if ($Config.ContainsKey('TimingConstraint') -and $Config.TimingConstraint) {
        $timingPath = Join-Path $ProjectRoot $Config.TimingConstraint
        if (-not (Test-Path -LiteralPath $timingPath -PathType Leaf)) {
            throw "Timing constraint file is missing: $timingPath"
        }
        $timingRelative = [Security.SecurityElement]::Escape('../../' + $Config.TimingConstraint.Replace('\', '/'))
        $fileEntries += "        <File path=`"$timingRelative`" type=`"file.sdc`" enable=`"1`"/>"
    }
    $projectXml = @(
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<!DOCTYPE gowin-fpga-project>'
        '<Project>'
        '    <Template>FPGA</Template>'
        '    <Version>5</Version>'
        "    <Device name=`"$($Config.GowinDeviceName)`" pn=`"$($Config.Device)`">$($Config.GowinDeviceCode)</Device>"
        '    <FileList>'
        $fileEntries
        '    </FileList>'
        '</Project>'
    ) -join [Environment]::NewLine
    [IO.File]::WriteAllText(
        (Join-Path $vendorDirectory 'studio.gprj'),
        $projectXml + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )
    $buildTcl = @(
        'set script_dir [file dirname [file normalize [info script]]]'
        'open_project [file join $script_dir studio.gprj]'
        'set_option -verilog_std sysv2017'
        "set_option -top_module $($Config.Top)"
        'set_option -output_base_name top'
        'set_option -bit_compress 0'
        'set_option -gen_text_timing_rpt 1'
        'run all'
    ) -join [Environment]::NewLine
    [IO.File]::WriteAllText(
        (Join-Path $vendorDirectory 'build.tcl'),
        $buildTcl + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )
    $gowinShell = Get-GowinShell
    Invoke-NativeTool $gowinShell @('build/gowin/build.tcl')
    $generated = Get-ChildItem -LiteralPath $vendorDirectory -Recurse -File -Filter 'top.fs' |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $generated) {
        throw "Gowin EDA completed without producing top.fs. Inspect build/gowin for the synthesis and place-and-route reports."
    }
    Copy-Item -LiteralPath $generated.FullName -Destination (Join-Path $ProjectRoot $Config.Bitstream) -Force
}

function Invoke-Lint {
    New-BuildDirectory
    $sources = @(Get-RtlSources | ForEach-Object { Get-RelativeProjectPath $_.FullName })
    Invoke-NativeTool 'verilator' (@(
        '--lint-only', '--timing', '-Wall', '-Wno-DECLFILENAME',
        '--top-module', $Config.Top
    ) + $sources)
    Write-Host 'RTL lint passed.' -ForegroundColor Green
}

function Invoke-Simulation {
    New-BuildDirectory
    $rtl = @(Get-RtlSources | ForEach-Object { Get-RelativeProjectPath $_.FullName })
    $testbenches = @(
        if ($Testbench) {
            $candidate = [IO.Path]::GetFullPath((Join-Path $ProjectRoot $Testbench))
            $simulationRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'sim')).TrimEnd('\') + '\'
            if (-not $candidate.StartsWith($simulationRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Selected testbench must be under sim/: $Testbench"
            }
            if (-not (Test-Path -LiteralPath $candidate -PathType Leaf) -or
                [IO.Path]::GetExtension($candidate) -notin @('.v', '.sv')) {
                throw "Selected testbench does not exist or is not Verilog/SystemVerilog: $Testbench"
            }
            Get-RelativeProjectPath $candidate
        } else {
            Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'sim') -Recurse -File |
                Where-Object { $_.Extension -in @('.v', '.sv') } |
                Sort-Object FullName |
                ForEach-Object { Get-RelativeProjectPath $_.FullName }
        }
    )
    if ($testbenches.Count -eq 0) {
        throw 'No simulation testbench was found under sim/.'
    }

    $simulationOutput = "build/$TestbenchTop.vvp"
    Invoke-NativeTool 'iverilog' (@('-g2012', '-Wall', '-s', $TestbenchTop, '-o', $simulationOutput) + $rtl + $testbenches)
    Invoke-NativeTool 'vvp' @($simulationOutput)
    Write-Host 'Simulation passed; waveform: build/waves.vcd' -ForegroundColor Green
}

function Open-Waveform {
    $waveform = Join-Path $BuildDir 'waves.vcd'
    if (-not (Test-Path -LiteralPath $waveform)) {
        Invoke-Simulation
    }
    $saveRelative = if ($WaveLayout) { $WaveLayout } else { 'sim\waves.gtkw' }
    $saveFile = [IO.Path]::GetFullPath((Join-Path $ProjectRoot $saveRelative))
    $simulationRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'sim')).TrimEnd('\') + '\'
    if (-not $saveFile.StartsWith($simulationRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Wave layout must be under sim/: $saveRelative"
    }
    $gtkwaveArgs = @('--dump', ('"' + $waveform + '"'))
    if (Test-Path -LiteralPath $saveFile) {
        $gtkwaveArgs += @('--save', ('"' + $saveFile + '"'))
    }
    Start-Process -FilePath (Get-Command 'gtkwave').Source `
        -ArgumentList $gtkwaveArgs -WorkingDirectory $ProjectRoot | Out-Null
    if (Test-Path -LiteralPath $saveFile) {
        Write-Host 'GTKWave opened with the project signal layout and complete simulation timeline.' -ForegroundColor Green
    } else {
        Write-Host 'GTKWave opened. You can also open build/waves.vcd directly in VS Code.' -ForegroundColor Green
    }
}

function Invoke-Build {
    New-BuildDirectory
    $constraintPath = Join-Path $ProjectRoot $Config.Constraint
    if (-not (Test-Path -LiteralPath $constraintPath)) {
        throw "Constraint file is missing: $constraintPath"
    }

    Invoke-YosysSynthesis
    if ((Get-ProjectBuildBackend) -eq 'gowin-eda') {
        Invoke-GowinEdaBuild
        Assert-Bitstream -Path $Config.Bitstream
        $bitstream = Get-Item -LiteralPath (Join-Path $ProjectRoot $Config.Bitstream)
        Write-Host ("Gowin EDA build complete: {0} ({1:N0} bytes)" -f $bitstream.FullName, $bitstream.Length) -ForegroundColor Green
        Write-Host 'Reports: build/yosys.log and build/gowin/impl/'
        return
    }
    Invoke-NativeTool 'nextpnr-himbaechel' @(
        '--json', 'build/top.json',
        '--write', 'build/top_pnr.json',
        '--device', $Config.Device,
        '--vopt', "family=$($Config.Family)",
        '--vopt', "cst=$($Config.Constraint.Replace('\', '/'))",
        '--freq', [string]$Config.ClockMHz,
        '--report', 'build/timing.json',
        '--detailed-timing-report'
    )
    Invoke-NativeTool 'gowin_pack' @(
        '-d', $Config.Family,
        '-o', $Config.Bitstream,
        'build/top_pnr.json'
    )

    Assert-Bitstream -Path $Config.Bitstream
    $bitstream = Get-Item -LiteralPath (Join-Path $ProjectRoot $Config.Bitstream)
    Write-Host ("Build complete: {0} ({1:N0} bytes)" -f $bitstream.FullName, $bitstream.Length) -ForegroundColor Green
    Write-Host 'Reports: build/yosys.log and build/timing.json'
}

function Assert-Bitstream {
    param([Parameter()] [string] $Path = $Config.Bitstream)
    $bitstream = if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $ProjectRoot $Path }
    if (-not (Test-Path -LiteralPath $bitstream)) {
        throw "Bitstream is missing: $bitstream. Build the selected design before programming."
    }
    $item = Get-Item -LiteralPath $bitstream
    if ($item.Length -lt 1024) {
        throw "Bitstream is unexpectedly small ($($item.Length) bytes). Rebuild before programming."
    }
    $lines = [IO.File]::ReadAllLines($item.FullName)
    if ($lines.Count -lt 10) {
        throw 'Bitstream has no complete Gowin FS header. Rebuild before programming.'
    }
    $control = $lines | Where-Object { $_.StartsWith('00010000') } | Select-Object -First 1
    if (-not $control -or $control.Length -ne 64) {
        throw 'Bitstream has no valid Gowin control header. Rebuild before programming.'
    }
    $compressionBit = $control[$control.Length - 1 - 13]
    if ($compressionBit -eq '1') {
        throw 'Compressed Gowin FS files are blocked because this openFPGALoader build cannot safely parse their checksum. Rebuild with the updated FPGA Studio.'
    }
    foreach ($line in $lines) {
        if (-not $line -or ($line.Length % 8) -ne 0 -or $line -notmatch '^[01]+$') {
            throw 'Bitstream contains a truncated or invalid Gowin FS line. Rebuild before programming.'
        }
    }
}

function Invoke-AnalyzerBuild {
    if ((Get-ProjectBuildBackend) -eq 'gowin-eda') {
        throw 'The integrated Logic Analyzer place-and-route requires an OSS device database. GW5AT-60B is not present in the pinned database; use Gowin GAO for Tang Console 60K hardware capture.'
    }
    $analyzerDirectory = Join-Path $BuildDir 'analyzer'
    $scriptPath = Join-Path $analyzerDirectory 'synth.ys'
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        throw 'No generated Logic Analyzer design exists. Save the analyzer configuration in FPGA Studio first.'
    }
    $constraintPath = Join-Path $ProjectRoot $Config.Constraint
    if (-not (Test-Path -LiteralPath $constraintPath -PathType Leaf)) {
        throw "Constraint file is missing: $constraintPath"
    }

    Invoke-NativeTool 'yosys' @('-q', '-l', 'build/analyzer/yosys.log', '-s', 'build/analyzer/synth.ys')
    Invoke-NativeTool 'nextpnr-himbaechel' @(
        '--json', 'build/analyzer/top.json',
        '--write', 'build/analyzer/top_pnr.json',
        '--device', $Config.Device,
        '--vopt', "family=$($Config.Family)",
        '--vopt', "cst=$($Config.Constraint.Replace('\', '/'))",
        '--freq', [string]$Config.ClockMHz,
        '--report', 'build/analyzer/timing.json',
        '--detailed-timing-report'
    )
    Invoke-NativeTool 'gowin_pack' @(
        '-d', $Config.Family,
        '-o', 'build/analyzer/top.fs',
        'build/analyzer/top_pnr.json'
    )
    Assert-Bitstream -Path 'build/analyzer/top.fs'
    $bitstream = Get-Item -LiteralPath (Join-Path $ProjectRoot 'build/analyzer/top.fs')
    Write-Host ("Instrumented build complete: {0} ({1:N0} bytes)" -f $bitstream.FullName, $bitstream.Length) -ForegroundColor Green
    Write-Host 'The original RTL was not changed. Compare build/timing.json with build/analyzer/timing.json for measured impact.'
}

function Invoke-AnalyzerUpload {
    if (-not $NoBuild) { Invoke-AnalyzerBuild }
    Assert-Bitstream -Path 'build/analyzer/top.fs'
    Invoke-NativeTool 'openFPGALoader' @('-b', $Config.ProgrammerBoard, '-m', 'build/analyzer/top.fs')
    Write-Host 'Logic Analyzer loaded into FPGA SRAM. Persistent flash was not changed.' -ForegroundColor Green
}

function Invoke-Experiment {
    $experimentScript = Join-Path $BuildDir 'experiment/synth.ys'
    if (-not (Test-Path -LiteralPath $experimentScript -PathType Leaf)) {
        throw 'No optimization experiment is prepared. Create one from Design Health first.'
    }
    $experimentDirectory = Join-Path $BuildDir 'experiment'
    New-Item -ItemType Directory -Force -Path $experimentDirectory | Out-Null
    Invoke-NativeTool 'yosys' @('-q', '-l', 'build/experiment/yosys.log', '-s', 'build/experiment/synth.ys')
    $pnrArguments = @(
        '--json', 'build/experiment/top.json',
        '--write', 'build/experiment/top_pnr.json',
        '--device', $Config.Device,
        '--vopt', "family=$($Config.Family)",
        '--vopt', "cst=$($Config.Constraint.Replace('\', '/'))",
        '--freq', [string]$Config.ClockMHz,
        '--report', 'build/experiment/timing.json',
        '--detailed-timing-report'
    )
    $metadataPath = Join-Path $ProjectRoot '.fpga-studio/current-experiment.json'
    if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        $experiment = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
        if ($experiment.kind -eq 'placement-seed') {
            $seedOption = @($experiment.options | Where-Object { $_ -match '^--seed=([0-9]+)$' }) | Select-Object -First 1
            if (-not $seedOption) { throw 'Placement experiment metadata has no valid numeric seed.' }
            $seed = [regex]::Match($seedOption, '^--seed=([0-9]+)$').Groups[1].Value
            $pnrArguments += @('--seed', $seed)
        }
    }
    Invoke-NativeTool 'nextpnr-himbaechel' $pnrArguments
    Write-Host 'Optimization experiment complete. The baseline artifacts and user RTL were not changed.' -ForegroundColor Green
}

function Invoke-Upload {
    if (-not $NoBuild) { Invoke-Build }
    Assert-Bitstream -Path $Config.Bitstream
    Invoke-NativeTool 'openFPGALoader' @('-b', $Config.ProgrammerBoard, '-m', $Config.Bitstream)
    Write-Host 'Uploaded to FPGA SRAM. This image is lost when power is removed.' -ForegroundColor Green
}

function Invoke-Flash {
    if (-not $NoBuild) { Invoke-Build }
    Assert-Bitstream -Path $Config.Bitstream
    Invoke-NativeTool 'openFPGALoader' @('-b', $Config.ProgrammerBoard, '-f', '--verify', $Config.Bitstream)
    Write-Host 'Programmed and verified persistent flash.' -ForegroundColor Green
}

function Invoke-Detect {
    $savedErrorPreference = $ErrorActionPreference
    try {
        # Capture the programmer's USB diagnosis so a direct command receives
        # the same concise recovery advice as the desktop console.
        $ErrorActionPreference = 'Continue'
        $detectOutput = @(& openFPGALoader -b $Config.ProgrammerBoard --detect 2>&1)
        $detectExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorPreference
    }
    $detectOutput | ForEach-Object { Write-Host $_ }
    if ($detectExitCode -eq 0) { return }

    $diagnosis = $detectOutput -join "`n"
    if ($diagnosis -match 'ftdi_usb_reset|FTDI reset|configure bitbang') {
        throw 'JTAG Interface 0 is connected but its FTDI endpoint could not reset. Unplug the board USB cable, wait five seconds, reconnect it, close other FPGA programmer tools, then run Detect JTAG again. Do not replace the driver: Interface 0 already uses WinUSB.'
    }
    if ($diagnosis -match 'unable to open ftdi device|usb_open') {
        throw 'Windows can see the JTAG adapter but openFPGALoader cannot claim Interface 0. Close other programmer tools, reconnect the board, and retry. On supported dual-interface Tang debuggers only Interface 0 uses WinUSB; leave Interface 1 as the UART driver.'
    }
    throw "JTAG detection failed. Reconnect the board, confirm the selected board profile, and retry (openFPGALoader exit code $detectExitCode)."
}

function Open-JtagDriverInstaller {
    if (-not (Test-Path -LiteralPath $Config.DriverTool)) {
        throw "The signed driver helper is missing at '$($Config.DriverTool)'. Run '.\fpga.ps1 setup' first."
    }

    $jtagInterface = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -like 'USB\VID_0403&PID_6010&MI_00\*' } |
        Select-Object -First 1
    if (-not $jtagInterface) {
        throw 'Tang Primer 20K JTAG interface MI_00 is not connected. Connect the Dock JTAG/UART USB-C port first.'
    }

    $signature = Get-AuthenticodeSignature -FilePath $Config.DriverTool
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Akeo Consulting') {
        throw "Refusing to launch $($Config.DriverTool): its Akeo Consulting signature is not valid."
    }

    Write-Host 'Zadig will open and request administrator approval.' -ForegroundColor Cyan
    Write-Host '  1. Choose Options > List All Devices.'
    Write-Host '  2. Select JTAG Debugger or USB Serial Converter A (Interface 0 / MI_00).'
    Write-Host '  3. Select WinUSB, then click Replace Driver.'
    Write-Host 'Do NOT change Converter B / MI_01; it provides the UART COM port.' -ForegroundColor Yellow
    Start-Process -FilePath $Config.DriverTool
    Write-Host "After Zadig finishes, run '.\fpga.ps1 detect'." -ForegroundColor Green
}

function Invoke-Doctor {
    Write-Host 'Project' -ForegroundColor Cyan
    Write-Host "  Root:       $ProjectRoot"
    Write-Host "  Device:     $($Config.Device)"
    Write-Host "  Constraints: $($Config.Constraint)"
    Write-Host "  Toolchain:  $env:YOSYSHQ_ROOT"
    Write-Host "  Build route: $(Get-ProjectBuildBackend)"

    Write-Host "`nTools" -ForegroundColor Cyan
    & yosys -V
    & nextpnr-himbaechel --version
    & openFPGALoader --version
    & iverilog -V 2>&1 | Select-Object -First 1
    & verilator --version
    if ((Get-ProjectBuildBackend) -eq 'gowin-eda') {
        $gowinShell = Get-GowinShell
        Write-Host "  Gowin EDA:  $gowinShell"
    }

    Write-Host "`nUSB programmer scan" -ForegroundColor Cyan
    $savedErrorPreference = $ErrorActionPreference
    try {
        # openFPGALoader reports inaccessible USB devices on stderr. Capture the
        # diagnostic without PowerShell 5.1 turning it into a terminating error.
        $ErrorActionPreference = 'Continue'
        $scanOutput = @(& openFPGALoader --scan-usb 2>&1)
        $scanExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $savedErrorPreference
    }
    $scanOutput | ForEach-Object { Write-Host $_ }
    if ($scanExitCode -ne 0) {
        Write-Warning 'USB scan returned an error. Check the debugger USB cable/driver.'
    } elseif ($scanOutput -match "can't open device") {
        Write-Warning "The Dock is connected, but JTAG interface A is not using WinUSB. Run '.\fpga.ps1 driver'."
    } elseif ($scanOutput.Count -le 1) {
        Write-Warning 'No JTAG probe is currently visible. Connect the Dock JTAG/UART USB-C port.'
    }

    Write-Host "`nWindows serial ports" -ForegroundColor Cyan
    $portDevices = @(Get-CimInstance Win32_PnPEntity |
        Where-Object { $_.Name -match '\(COM\d+\)' } |
        Sort-Object Name)
    if ($portDevices.Count -eq 0) {
        Write-Host '  No COM ports detected.'
    } else {
        $portDevices | ForEach-Object { Write-Host "  $($_.Name)" }
    }

    Write-Host "`nBoard checks" -ForegroundColor Cyan
    Write-Host "  Target programmer alias: $($Config.ProgrammerBoard)"
    Write-Host '  Use the board port marked JTAG/UART or MCU, connect directly without a hub, and keep the FPGA/SOM enabled.'
    Write-Host '  If no programmer appears, update the board-specific Sipeed debugger firmware and check its Windows driver.'
}

function Open-SerialMonitor {
    if (-not $Port) {
        $ports = @([System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object)
        if ($ports.Count -eq 1) {
            $script:Port = $ports[0]
        } elseif ($ports.Count -eq 0) {
            throw "No COM port was detected. Connect the Dock UART and pass '-Port COMx'."
        } else {
            throw "More than one COM port exists ($($ports -join ', ')). Pass '-Port COMx'."
        }
    }

    $serial = [System.IO.Ports.SerialPort]::new($Port, $Baud, 'None', 8, 'One')
    $serial.ReadTimeout = 200
    try {
        $serial.Open()
        Write-Host "Listening on $Port at $Baud baud. Press Ctrl+C to stop." -ForegroundColor Green
        while ($true) {
            try {
                $text = $serial.ReadExisting()
                if ($text) { Write-Host -NoNewline $text }
                Start-Sleep -Milliseconds 20
            } catch [System.TimeoutException] {
                # Normal while waiting for UART data.
            }
        }
    } finally {
        if ($serial.IsOpen) { $serial.Close() }
        $serial.Dispose()
    }
}

function Clear-BuildDirectory {
    if (-not (Test-Path -LiteralPath $BuildDir)) {
        Write-Host 'Nothing to clean.'
        return
    }
    $resolvedProject = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $resolvedBuild = [IO.Path]::GetFullPath($BuildDir).TrimEnd('\')
    if (-not $resolvedBuild.StartsWith($resolvedProject + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a build path outside the project: $resolvedBuild"
    }
    Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
    Write-Host "Removed $resolvedBuild"
}

Push-Location $ProjectRoot
try {
    if ($Command -eq 'help') {
        Write-Usage
        return
    }
    if ($Command -eq 'setup') {
        & (Join-Path $WorkspaceRoot 'scripts/setup-toolchain.ps1')
        return
    }
    if ($Command -eq 'driver') {
        Open-JtagDriverInstaller
        return
    }
    if ($Command -eq 'clean') {
        Clear-BuildDirectory
        return
    }

    Initialize-Toolchain
    switch ($Command) {
        'doctor' { Invoke-Doctor }
        'lint'   { Invoke-Lint }
        'sim'    { Invoke-Simulation }
        'wave'   { Invoke-Simulation; Open-Waveform }
        'debug'  { Invoke-Lint; Invoke-Simulation; Open-Waveform }
        'build'  { Invoke-Build }
        'upload' { Invoke-Upload }
        'flash'  { Invoke-Flash }
        'detect' { Invoke-Detect }
        'serial' { Open-SerialMonitor }
        'analyzer-build'  { Invoke-AnalyzerBuild }
        'analyzer-upload' { Invoke-AnalyzerUpload }
        'experiment'      { Invoke-Experiment }
    }
} catch {
    Write-Host "`nFPGA Studio could not complete '$Command'." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    exit 1
} finally {
    Pop-Location
}
