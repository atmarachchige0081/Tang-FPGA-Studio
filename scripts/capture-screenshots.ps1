[CmdletBinding()]
param(
    [string[]] $Only = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$studio = Join-Path $workspace 'studio'
$outputDirectory = Join-Path $workspace 'docs\images'
$port = 4173
$baseUrl = "http://127.0.0.1:$port"

$edgeCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
)
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $edge) {
    throw 'Microsoft Edge is required to capture the real Studio 3 interface.'
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm.cmd is required. Install Node.js, then run npm install in studio\.'
}

$views = @(
    @{ Capture = 'welcome';       Theme = 'dark';  File = 'studio-main.png' },
    @{ Capture = 'welcome';       Theme = 'light'; File = 'studio-main-light.png' },
    @{ Capture = 'release-notes'; Theme = 'dark';  File = 'studio-release-notes.png' },
    @{ Capture = 'dashboard';     Theme = 'dark';  File = 'studio-insights.png' },
    @{ Capture = 'analysis';      Theme = 'dark';  File = 'studio-analysis.png' },
    @{ Capture = 'verification';  Theme = 'dark';  File = 'studio-verification-center.png' },
    @{ Capture = 'traceability';  Theme = 'dark';  File = 'studio-traceability.png' },
    @{ Capture = 'traceability';  Theme = 'light'; File = 'studio-traceability-light.png' },
    @{ Capture = 'analyzer';      Theme = 'dark';  File = 'studio-hardware-analyzer.png' },
    @{ Capture = 'analyzer';      Theme = 'light'; File = 'studio-hardware-analyzer-light.png' },
    @{ Capture = 'health';        Theme = 'dark';  File = 'studio-design-health.png' },
    @{ Capture = 'analysis';      Theme = 'light'; File = 'studio-analysis-light.png' },
    @{ Capture = 'launcher';      Theme = 'dark';  File = 'studio-command-palette.png' },
    @{ Capture = 'waveform';      Theme = 'dark';  File = 'studio-waveform.png' },
    @{ Capture = 'netlist';       Theme = 'dark';  File = 'studio-netlist-viewer.png' },
    @{ Capture = 'hardware';      Theme = 'dark';  File = 'studio-hardware-setup.png' },
    @{ Capture = 'uart';          Theme = 'dark';  File = 'studio-uart-terminal.png' }
)
if ($Only.Count -gt 0) {
    $views = @($views | Where-Object { $Only -contains $_.Capture })
    if ($views.Count -eq 0) {
        throw "No Studio 3 screenshot matched -Only: $($Only -join ', ')"
    }
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$captureProfileRoot = Join-Path $workspace '.fpga-studio\screenshot-capture'
New-Item -ItemType Directory -Force -Path $captureProfileRoot | Out-Null
$profileDirectory = Join-Path $captureProfileRoot ("run-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profileDirectory | Out-Null
$server = $null

try {
    $server = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', "$port", '--strictPort') -WorkingDirectory $studio -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        if ($server.HasExited) { throw "The Studio preview server exited with code $($server.ExitCode)." }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -TimeoutSec 2
            $ready = $response.StatusCode -eq 200
        } catch {
            $ready = $false
            Start-Sleep -Milliseconds 250
        }
    } until ($ready -or [DateTime]::UtcNow -ge $deadline)
    if (-not $ready) { throw 'Timed out waiting for the Studio 3 preview server.' }

    foreach ($view in $views) {
        $target = Join-Path $outputDirectory $view.File
        $url = "$baseUrl/?capture=$($view.Capture)&theme=$($view.Theme)"
        $viewProfile = Join-Path $profileDirectory ("$($view.Capture)-$($view.Theme)")
        $captureSucceeded = $false
        for ($attempt = 1; $attempt -le 2 -and -not $captureSucceeded; $attempt++) {
            $attemptProfile = "$viewProfile-attempt-$attempt"
            $attemptTarget = Join-Path $outputDirectory (([IO.Path]::GetFileNameWithoutExtension($view.File)) + ".attempt-$attempt.png")
            New-Item -ItemType Directory -Path $attemptProfile | Out-Null
            if (Test-Path -LiteralPath $attemptTarget -PathType Leaf) {
                Remove-Item -LiteralPath $attemptTarget -Force
            }
            $arguments = @(
                '--headless=new',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-background-networking',
                '--no-first-run',
                '--hide-scrollbars',
                '--force-device-scale-factor=1',
                '--window-size=1440,900',
                '--run-all-compositor-stages-before-draw',
                '--virtual-time-budget=3500',
                "--user-data-dir=`"$attemptProfile`"",
                "--screenshot=`"$attemptTarget`"",
                "`"$url`""
            )
            $captureProcess = Start-Process -FilePath $edge -ArgumentList $arguments -WindowStyle Hidden -PassThru
            if (-not $captureProcess.WaitForExit(45000)) {
                Stop-Process -Id $captureProcess.Id -Force -ErrorAction SilentlyContinue
            }
            $captureSucceeded = $captureProcess.HasExited -and $captureProcess.ExitCode -eq 0 -and
                (Test-Path -LiteralPath $attemptTarget -PathType Leaf) -and (Get-Item -LiteralPath $attemptTarget).Length -ge 10KB
            if ($captureSucceeded) {
                Move-Item -LiteralPath $attemptTarget -Destination $target -Force
            } elseif (Test-Path -LiteralPath $attemptTarget -PathType Leaf) {
                Remove-Item -LiteralPath $attemptTarget -Force
            }
            if (-not $captureSucceeded -and $attempt -lt 2) {
                Write-Warning "Retrying Studio 3 '$($view.Capture)' screenshot after Edge did not produce a valid image."
                Start-Sleep -Milliseconds 300
            }
        }
        if (-not $captureSucceeded) {
            throw "Failed to capture a valid Studio 3 '$($view.Capture)' image after two attempts."
        }
        Write-Host "Captured Studio 3 $($view.Capture) [$($view.Theme)]: $target" -ForegroundColor Green
    }
} finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $profileDirectory) {
        $resolvedProfile = [IO.Path]::GetFullPath($profileDirectory)
        $resolvedCaptureRoot = [IO.Path]::GetFullPath($captureProfileRoot).TrimEnd('\') + '\'
        if ($resolvedProfile.StartsWith($resolvedCaptureRoot, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
