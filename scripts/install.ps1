#Requires -Version 5.1
<#
.SYNOPSIS
  Windows installer: clone -> portable opencode setup (~/.config/opencode).
.DESCRIPTION
  Checks node >=20, installs opencode-ai globally, copies repo files into
  $HOME/.config/opencode with <VAULT_PATH>/<HOME>/<OBSIDIAN_EXE>/<MIROFISH_DIR>
  substitution, runs npm install for MCP servers, prompts for VAULT_PATH.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install.ps1
#>
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$ConfigDir = Join-Path $HOME '.config/opencode'

function Test-Node {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { throw 'node not found on PATH. Install Node.js 20+ from https://nodejs.org, then re-run.' }
  $v = (& node --version) -replace '^v',''
  $major = [int]($v.Split('.')[0])
  if ($major -lt 20) { throw "node $v found, but >=20 required. Upgrade Node.js, then re-run." }
  Write-Host "node $v ok ($($n.Source))"
}

Write-Host '== opencode-setup Windows install =='
Test-Node

$ObsidianDefault = Join-Path $env:LOCALAPPDATA 'Obsidian/Obsidian.exe'
$VaultDefault = Join-Path $HOME 'AgentMemory'
$Vault = Read-Host "Obsidian vault path [$VaultDefault]"
if ([string]::IsNullOrWhiteSpace($Vault)) { $Vault = $VaultDefault }
$ObsidianExe = Read-Host "Obsidian.exe path [$ObsidianDefault]"
if ([string]::IsNullOrWhiteSpace($ObsidianExe)) { $ObsidianExe = $ObsidianDefault }
$MiroDefault = Join-Path $HOME 'MiroFish'
$MiroDir = Read-Host "MiroFish dir (optional, Enter to skip) [$MiroDefault]"

Write-Host "Installing opencode-ai globally (npm i -g opencode-ai)..."
& npm i -g opencode-ai

Write-Host "Copying files to $ConfigDir ..."
$Dirs = @('agent','command','skill','skills','plugin','mcp','templates','startup','scripts')
foreach ($d in $Dirs) {
  $src = Join-Path $RepoRoot $d
  if (Test-Path -LiteralPath $src) {
    $dst = Join-Path $ConfigDir $d
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
  }
}
Copy-Item -LiteralPath (Join-Path $RepoRoot 'opencode.jsonc.example') -Destination (Join-Path $ConfigDir 'opencode.jsonc') -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'package.json.example') -Destination (Join-Path $ConfigDir 'package.json') -Force
if (Test-Path -LiteralPath (Join-Path $RepoRoot '.env.example')) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot '.env.example') -Destination (Join-Path $ConfigDir '.env.example') -Force
}

Write-Host 'Substituting placeholders (<VAULT_PATH>, <HOME>, <OBSIDIAN_EXE>, <MIROFISH_DIR>)...'
$HomeFwd = ($HOME -replace '\\','/')
$VaultFwd = ($Vault -replace '\\','/')
$ObsFwd = ($ObsidianExe -replace '\\','/')
$Files = Get-ChildItem -LiteralPath $ConfigDir -Recurse -File -Include 'opencode.jsonc','*.md','*.js','*.ps1','*.sh','*.cmd','.env.example'
foreach ($f in $Files) {
  $t = Get-Content -LiteralPath $f.FullName -Raw
  $t = $t.Replace('<VAULT_PATH>', $Vault).Replace('<VAULT_PATH>', $VaultFwd)
  # opencode.jsonc uses forward slashes; md/js tolerate either. Apply plain first:
  $t = $t.Replace('<HOME>', $HOME).Replace('<OBSIDIAN_EXE>', $ObsidianExe).Replace('<MIROFISH_DIR>', $MiroDir)
  Set-Content -LiteralPath $f.FullName -Value $t -NoNewline
}
# Normalize opencode.jsonc paths to forward slashes (opencode prefers them):
$Cfg = Join-Path $ConfigDir 'opencode.jsonc'
$ct = Get-Content -LiteralPath $Cfg -Raw
$ct = $ct.Replace($HOME, $HomeFwd).Replace($Vault, $VaultFwd).Replace($ObsidianExe, $ObsFwd)
Set-Content -LiteralPath $Cfg -Value $ct -NoNewline

Write-Host 'npm install: mcp/orchestrator ...'
Push-Location (Join-Path $ConfigDir 'mcp/orchestrator'); & npm install; Pop-Location
Write-Host 'npm install: mcp/mirofish (optional) ...'
Push-Location (Join-Path $ConfigDir 'mcp/mirofish'); & npm install; Pop-Location
Write-Host 'npm install: config root (plugin deps) ...'
Push-Location $ConfigDir; & npm install; Pop-Location

[Environment]::SetEnvironmentVariable('MEMORY_VAULT', $Vault, 'User')
[Environment]::SetEnvironmentVariable('OBSIDIAN_EXE', $ObsidianExe, 'User')
$env:MEMORY_VAULT = $Vault
$env:OBSIDIAN_EXE = $ObsidianExe

Write-Host ''
Write-Host 'Done. Next:'
Write-Host '  1. Start the Obsidian app and open your vault.'
Write-Host "  2. Restart opencode, then verify: opencode mcp list  (expect orchestrator; mirofish optional)"
Write-Host '  3. In opencode, run the config_status tool (orchestrator MCP).'
Write-Host '  4. Optional: set MIROFISH_BACKEND_DIR in your env if you use /mirofish + /research.'
