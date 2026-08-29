[CmdletBinding()]
param(
    [switch] $SkipHdl,
    [switch] $SkipNative
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Invoke-Checked {
    param([Parameter(Mandatory)] [string] $Executable, [string[]] $Arguments = @())
    Write-Host ("> {0} {1}" -f $Executable, ($Arguments -join ' ')) -ForegroundColor DarkGray
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE"
    }
}

Push-Location $workspace
try {
    $requiredFiles = @(
        'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'INSTALL.md',
        'docs\DEPLOYMENT.md', 'docs\RELEASE_3.0.0.md', 'docs\RELEASE_3.1.0.md', 'docs\HARDWARE_ANALYZER.md',
        'docs\images\studio-main-light.png', 'docs\images\studio-release-notes.png',
        'docs\images\studio-traceability.png', 'docs\images\studio-traceability-light.png',
        'docs\images\studio-hardware-analyzer.png', 'docs\images\studio-hardware-analyzer-light.png'
    )
    $missing = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
    if ($missing.Count) {
        throw "Required release files are missing: $($missing -join ', ')"
    }
    foreach ($image in $requiredFiles | Where-Object { $_ -like '*.png' }) {
        if ((Get-Item -LiteralPath $image).Length -lt 10000) {
            throw "Screenshot is unexpectedly small or invalid: $image"
        }
    }

    Invoke-Checked python @('-m', 'compileall', '-q', 'ide')
    Invoke-Checked python @('-m', 'unittest', 'discover', '-s', 'ide\tests', '-v')
    Invoke-Checked python @('ide\fpga_ide.py', '--ui-smoke-test', '--theme', 'dark',
        '--project', 'projects\01_button_led_pwm')
    Invoke-Checked python @('ide\fpga_ide.py', '--ui-smoke-test', '--theme', 'light',
        '--project', 'projects\01_button_led_pwm')
    Invoke-Checked python @('ide\fpga_ide.py', '--theme-stress-test',
        '--project', 'projects\01_button_led_pwm')
    Invoke-Checked python @('ide\fpga_ide.py', '--check', 'projects\_template')
    Invoke-Checked python @('ide\fpga_ide.py', '--check', 'projects\01_button_led_pwm')
    Invoke-Checked python @('ide\fpga_ide.py', '--check', 'projects\03_uart_terminal')
    Invoke-Checked python @('ide\fpga_ide.py', '--check', 'projects\05_serial_command_console')
    Invoke-Checked python @('ide\fpga_ide.py', '--check', 'projects\06_hardware_intelligence')

    $parseFailures = @()
    foreach ($script in Get-ChildItem -Path $workspace -Recurse -Filter '*.ps1' -File) {
        if ($script.FullName -match '[\\/](?:build|\.git|\.fpga-studio)[\\/]') { continue }
        $tokens = $null
        $errors = $null
        [void] [Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref] $tokens, [ref] $errors)
        if ($errors.Count) {
            $parseFailures += $errors | ForEach-Object { "$($script.FullName): $($_.Message)" }
        }
    }
    if ($parseFailures.Count) {
        throw "PowerShell parse failures:`n$($parseFailures -join "`n")"
    }
    [void] (Get-Content -LiteralPath '.vscode\tasks.json' -Raw | ConvertFrom-Json)

    if (-not $SkipHdl) {
        Invoke-Checked powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\fpga.ps1',
            'lint', '-Project', 'projects/01_button_led_pwm')
        Invoke-Checked powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\fpga.ps1',
            'sim', '-Project', 'projects/01_button_led_pwm')
        Invoke-Checked powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\fpga.ps1',
            'lint', '-Project', 'projects/03_uart_terminal')
        Invoke-Checked powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\fpga.ps1',
            'sim', '-Project', 'projects/03_uart_terminal', '-Testbench', 'sim/tb_top.sv', '-TestbenchTop', 'tb_top')
        Invoke-Checked powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\fpga.ps1',
            'lint', '-Project', 'projects/05_serial_command_console')
        Invoke-Checked powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\fpga.ps1',
            'sim', '-Project', 'projects/05_serial_command_console', '-Testbench', 'sim/tb_top.sv', '-TestbenchTop', 'tb_top')
        Invoke-Checked powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\fpga.ps1',
            'lint', '-Project', 'projects/06_hardware_intelligence')
        Invoke-Checked powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\fpga.ps1',
            'sim', '-Project', 'projects/06_hardware_intelligence', '-Testbench', 'sim/tb_top.sv', '-TestbenchTop', 'tb_top')
    }

    if (-not $SkipNative) {
        Invoke-Checked npm @('--prefix', 'studio', 'run', 'check')
        $cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
        if (-not (Test-Path -LiteralPath $cargo -PathType Leaf)) { throw 'Cargo is missing; run npm run desktop:doctor in studio.' }
        Invoke-Checked $cargo @('test', '--manifest-path', 'studio/src-tauri/Cargo.toml', '--lib')
    }

    Invoke-Checked git @('diff', '--check')
    Write-Host 'RELEASE CHECK PASSED' -ForegroundColor Green
} finally {
    Pop-Location
}
