# Installs the skills pack into Claude Code's project locations:
#   claude-code-skills/claude-code-skills/<skill>/  ->  stdrd/.claude/skills/<skill>/
#   claude-code-skills/claude-code-skills/CLAUDE.md ->  stdrd/CLAUDE.md
# Usage (from anywhere):  powershell -File F:\projects\whatsapp-automation\stdrd\claude-code-skills\sync-skills.ps1
$ErrorActionPreference = 'Stop'
$pack = Join-Path $PSScriptRoot 'claude-code-skills'
$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $root '.claude\skills'

New-Item -ItemType Directory -Force $dest | Out-Null

# Remove installed skills that no longer exist in the pack.
Get-ChildItem $dest -Directory | Where-Object { -not (Test-Path (Join-Path $pack $_.Name)) } | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force
    Write-Host "removed  $($_.Name)"
}

Get-ChildItem $pack -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'SKILL.md') } | ForEach-Object {
    $target = Join-Path $dest $_.Name
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    Copy-Item $_.FullName $target -Recurse
    Write-Host "installed $($_.Name)"
}

Copy-Item (Join-Path $pack 'CLAUDE.md') (Join-Path $root 'CLAUDE.md') -Force
Write-Host "installed CLAUDE.md -> $root\CLAUDE.md"
