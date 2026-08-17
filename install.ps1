# openspec-forge bootstrap (Windows) — downloads the kit and runs the shared install.mjs.
# Usage:  irm https://raw.githubusercontent.com/c0d3beat/openspec-forge/main/install.ps1 | iex
#         (pin a version:  $env:FORGE_REF='v1.0.0'; irm ... | iex )
#requires -Version 5
$ErrorActionPreference = "Stop"

$Repo   = "c0d3beat/openspec-forge"
$Ref    = if ($env:FORGE_REF) { $env:FORGE_REF } else { "main" }
$Target = (Get-Location).Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is required. Install Node >=18 and run 'openspec init' here first."
  exit 1
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("forge-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
$zip = Join-Path $Tmp "kit.zip"

Write-Host "openspec-forge: downloading $Repo@$Ref..."
try { Invoke-WebRequest "https://github.com/$Repo/archive/refs/tags/$Ref.zip" -OutFile $zip -ErrorAction Stop }
catch { Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/$Ref.zip" -OutFile $zip }

Expand-Archive -Path $zip -DestinationPath $Tmp -Force
$src = Get-ChildItem -Path $Tmp -Directory -Filter "openspec-forge-*" | Select-Object -First 1

& node (Join-Path $src.FullName "install.mjs") --dir $Target @args
Remove-Item -Recurse -Force $Tmp
