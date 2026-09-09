#Requires -Version 5.1
<#
.SYNOPSIS
  Re-point an installed ~/.config/opencode to a different Obsidian vault.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/configure-vault.ps1 -VaultPath 'D:\Notes\AgentMemory'
#>
param([string]$VaultPath = '')
$ErrorActionPreference = 'Stop'
$ConfigDir = Join-Path $HOME '.config/opencode'
if ([string]::IsNullOrWhiteSpace($VaultPath)) {
  $VaultPath = Read-Host "Obsidian vault path [$(Join-Path $HOME 'AgentMemory')]"
  if ([string]::IsNullOrWhiteSpace($VaultPath)) { $VaultPath = Join-Path $HOME 'AgentMemory' }
}
$Cfg = Join-Path $ConfigDir 'opencode.jsonc'
(Get-Content -LiteralPath $Cfg -Raw).Replace('<VAULT_PATH>', $VaultPath) | Set-Content -LiteralPath $Cfg -NoNewline
# Patch installed agent/command/skill copies too (they carry the same placeholder):
Get-ChildItem -LiteralPath $ConfigDir -Recurse -File -Include '*.md' | ForEach-Object {
  $t = Get-Content -LiteralPath $_.FullName -Raw
  if ($t.Contains('<VAULT_PATH>')) { $t.Replace('<VAULT_PATH>', $VaultPath) | Set-Content -LiteralPath $_.FullName -NoNewline }
}
[Environment]::SetEnvironmentVariable('MEMORY_VAULT', $VaultPath, 'User')
$env:MEMORY_VAULT = $VaultPath
Write-Host "Vault set to $VaultPath (opencode.jsonc + MEMORY_VAULT). Restart opencode."
