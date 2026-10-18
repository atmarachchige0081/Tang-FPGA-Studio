[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(2, 2147483647)][int]$StudioProcessId,
    [ValidateRange(10, 600)][int]$TimeoutSeconds = 120,
    [ValidateRange(2, 60)][int]$AfterCloseSeconds = 10,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\build\process-lifecycle')
)
$ErrorActionPreference = 'Stop'
# Observe only. Do not stop any process, read command lines, or touch hardware.
$processProperties = 'ProcessId', 'ParentProcessId', 'Name', 'CreationDate', 'PrivatePageCount', 'WorkingSetSize'
$root = Get-CimInstance Win32_Process -Property $processProperties -Filter "ProcessId=$StudioProcessId"
if (-not $root) { throw 'Studio is not running with that PID. Start Studio, then retry with its current process ID.' }
$observed = @{}
$observed[$StudioProcessId] = $root.CreationDate
$samples = New-Object System.Collections.Generic.List[object]
$started = [DateTime]::UtcNow
$closedAt = $null
$lastAlive = @()
Write-Host "Monitoring $($root.Name) ($StudioProcessId). Use AI/terminal normally, then save work, finish jobs and close Studio with X. No processes will be killed by this script."
while ($true) {
    $now = [DateTime]::UtcNow
    $all = @(Get-CimInstance Win32_Process -Property $processProperties)
    $owned = @{}
    foreach ($item in $all) {
        $key = [int]$item.ProcessId
        if ($observed.ContainsKey($key) -and $observed[$key] -eq $item.CreationDate) { $owned[$key] = $item }
    }
    # Keep observing already-owned children after the parent closes; creation
    # timestamps prevent PID reuse from attributing unrelated processes to Studio.
    do {
        $added = $false
        foreach ($item in $all) {
            $key = [int]$item.ProcessId
            if (-not $owned.ContainsKey($key) -and $owned.ContainsKey([int]$item.ParentProcessId)) {
                $observed[$key] = $item.CreationDate
                $owned[$key] = $item
                $added = $true
            }
        }
    } while ($added)
    $lastAlive = @($owned.Values | ForEach-Object {
        [pscustomobject]@{
            ProcessId = [int]$_.ProcessId
            ParentProcessId = [int]$_.ParentProcessId
            Name = $_.Name
            CreatedUtc = $_.CreationDate.ToUniversalTime().ToString('o')
            PrivateBytes = [long]$_.PrivatePageCount
            WorkingSetBytes = [long]$_.WorkingSetSize
        }
    })
    if (-not $owned.ContainsKey($StudioProcessId) -and -not $closedAt) { $closedAt = $now }
    $samples.Add([pscustomobject]@{
        TimestampUtc = $now.ToString('o')
        Phase = $(if ($closedAt) { 'after-close' } else { 'running' })
        PrivateBytes = [long](($lastAlive | Measure-Object PrivateBytes -Sum).Sum)
        Processes = $lastAlive
    })
    if ($closedAt -and ($now - $closedAt).TotalSeconds -ge $AfterCloseSeconds) { break }
    if (-not $closedAt -and ($now - $started).TotalSeconds -ge $TimeoutSeconds) { break }
    Start-Sleep -Milliseconds 500
}
$status = if (-not $closedAt) { 'INCOMPLETE: Studio was not closed' } elseif ($lastAlive.Count) { 'FAIL: observed owned processes remain' } else { 'PASS: observed owned process tree exited' }
$report = [pscustomobject]@{
    Status = $status
    StudioProcessId = $StudioProcessId
    PeakObservedPrivateBytes = [long](($samples | Measure-Object PrivateBytes -Maximum).Maximum)
    RemainingProcesses = $lastAlive
    Samples = $samples.ToArray()
    Scope = 'Sampled Windows process tree only. Private bytes measure private commit, not physical RAM. Shared working sets must not be summed as unique RAM. Processes created and detached between samples may not be observed. No command lines or file contents recorded.'
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$reportPath = Join-Path $OutputDirectory 'windows-process-lifecycle.json'
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host $status
Write-Host "Peak observed private commit: $([Math]::Round($report.PeakObservedPrivateBytes / 1MB, 1)) MB"
Write-Host "Report: $reportPath"
if (-not $closedAt) { exit 2 }
if ($lastAlive.Count) { $lastAlive | Format-Table ProcessId, ParentProcessId, Name, PrivateBytes; exit 1 }
exit 0
