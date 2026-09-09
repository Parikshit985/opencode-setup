# =============================================================================
# start-office.ps1 - logon launcher for the two office background services
#
#   1) opencode serve           -> http://127.0.0.1:41017
#   2) pixel-agents --port 4748 -> http://127.0.0.1:4748
#                                  (must run with cwd <WORKDIR> — TODO: set $WorkDir below to your working dir)
#
# Idempotent : skips starting any piece whose TCP port is already listening.
# Non-blocking: hidden windows, bounded waits, always exits 0. Safe at logon.
#
# Logs (all under $HOME/.config/opencode/logs — <HOME> placeholder, see TODO below):
#   boot.log            - one status line per action, appended across boots
#   pixel-office.log    - pixel-agents stdout+stderr, overwritten on each start
#   opencode-serve.log  - opencode serve stdout+stderr, appended
# =============================================================================

$ErrorActionPreference = 'Continue'

$ConfigRoot = Join-Path $HOME '.config/opencode'  # TODO: <HOME> placeholder resolved — override if your config lives elsewhere
$LogDir     = Join-Path $ConfigRoot 'logs'
$BootLog    = Join-Path $LogDir 'boot.log'
$OfficeLog  = Join-Path $LogDir 'pixel-office.log'
$ServeLog   = Join-Path $LogDir 'opencode-serve.log'
# TODO: <WORKDIR> placeholder — set to the folder pixel-agents should serve, e.g. "$HOME/Desktop"
$WorkDir    = Join-Path $HOME 'Desktop'

$OpenCodePort = 41017
$OfficePort   = 4748

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Boot {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $BootLog -Value $line -Encoding ASCII
}

function Test-PortListening {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-ForPort {
    param([int]$Port, [int]$Seconds)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortListening -Port $Port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return (Test-PortListening -Port $Port)
}

<#
.SYNOPSIS
    Launch a CLI fully detached and hidden with combined stdout/stderr -> LogFile.
.DESCRIPTION
    Both CLIs here are npm .cmd shims, so they are wrapped in:
        cmd.exe /d /s /c ""<exe>" <args> > "<log>" 2>&1"
    The /s switch plus the extra outer pair of quotes is the reliable way to
    let cmd execute a quoted path while keeping the redirects.
#>
function Start-HiddenCli {
    param(
        [string]$ExePath,
        [string]$ArgLine,
        [string]$LogFile,
        [string]$WorkingDirectory,
        [switch]$Append
    )
    $op = '>'
    if ($Append) { $op = '>>' }
    $q = '"'
    $inner = '{0}{1}{0} {2} {3} {0}{4}{0} 2>&1' -f $q, $ExePath, $ArgLine, $op, $LogFile
    return Start-Process -FilePath "$env:ComSpec" `
        -ArgumentList ('/d /s /c "{0}"' -f $inner) `
        -WindowStyle Hidden -WorkingDirectory $WorkingDirectory -PassThru
}

try {
    Write-Boot '=== start-office begin ==='

    # ---------------------------------------------------------------------
    # 1) pixel-agents office dashboard (port 4748, cwd = Desktop)
    # ---------------------------------------------------------------------
    try {
        if (Test-PortListening -Port $OfficePort) {
            Write-Boot "pixel-agents: port $OfficePort already listening -> skipping"
        }
        else {
            $pa = Get-Command -Name 'pixel-agents.cmd' -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if (-not $pa) {
                Write-Boot "pixel-agents: ERROR - pixel-agents.cmd not found in PATH"
            }
            else {
                Write-Boot ("pixel-agents: starting {0} --port {1} (cwd {2})" -f `
                    $pa.Source, $OfficePort, $WorkDir)
                $proc = Start-HiddenCli -ExePath $pa.Source `
                    -ArgLine "--port $OfficePort" -LogFile $OfficeLog `
                    -WorkingDirectory $WorkDir
                if (Wait-ForPort -Port $OfficePort -Seconds 20) {
                    Write-Boot ("pixel-agents: started ok (launcher pid {0}) -> http://127.0.0.1:{1}" -f `
                        $proc.Id, $OfficePort)
                }
                else {
                    Write-Boot ("pixel-agents: WARNING - port {0} not listening after 20s, see {1}" -f `
                        $OfficePort, $OfficeLog)
                }
            }
        }
    }
    catch {
        Write-Boot "pixel-agents: EXCEPTION - $($_.Exception.Message)"
    }

    # ---------------------------------------------------------------------
    # 2) opencode headless server (127.0.0.1:41017)
    # ---------------------------------------------------------------------
    try {
        if (Test-PortListening -Port $OpenCodePort) {
            Write-Boot "opencode serve: port $OpenCodePort already listening -> skipping"
        }
        else {
            $oc = Get-Command -Name 'opencode.cmd' -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if (-not $oc) {
                Write-Boot "opencode serve: ERROR - opencode.cmd not found in PATH"
            }
            else {
                Write-Boot ("opencode serve: starting {0} serve --hostname 127.0.0.1 --port {1}" -f `
                    $oc.Source, $OpenCodePort)
                $proc = Start-HiddenCli -ExePath $oc.Source `
                    -ArgLine "serve --hostname 127.0.0.1 --port $OpenCodePort" `
                    -LogFile $ServeLog -WorkingDirectory $env:USERPROFILE -Append
                if (Wait-ForPort -Port $OpenCodePort -Seconds 20) {
                    Write-Boot ("opencode serve: started ok (launcher pid {0}) -> http://127.0.0.1:{1}" -f `
                        $proc.Id, $OpenCodePort)
                }
                else {
                    Write-Boot ("opencode serve: WARNING - port {0} not listening after 20s, see {1}" -f `
                        $OpenCodePort, $ServeLog)
                }
            }
        }
    }
    catch {
        Write-Boot "opencode serve: EXCEPTION - $($_.Exception.Message)"
    }

    Write-Boot '=== start-office end ==='
}
catch {
    Write-Boot "start-office: FATAL - $($_.Exception.Message)"
}

exit 0
