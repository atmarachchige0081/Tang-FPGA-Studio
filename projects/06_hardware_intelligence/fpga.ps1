# Keep this wrapper unchanged when copying the template to another project.
$workspaceCommand = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\fpga.ps1'))
& $workspaceCommand @args -Project $PSScriptRoot
