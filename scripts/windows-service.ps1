[CmdletBinding()]
param(
    [ValidateSet('Install', 'Start', 'Run', 'Open', 'Status', 'Stop', 'Uninstall')]
    [string]$Action = 'Start',
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$projectRoot = Split-Path -Parent $PSScriptRoot
$entryPath = Join-Path $projectRoot 'src\index.js'
$runtimeDir = Join-Path $projectRoot '.runtime'
$statePath = Join-Path $runtimeDir 'service.json'
$stdoutPath = Join-Path $runtimeDir 'service.stdout.log'
$stderrPath = Join-Path $runtimeDir 'service.stderr.log'
$launcherLog = Join-Path $runtimeDir 'launcher.log'
$hasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $projectId = ([BitConverter]::ToString($hasher.ComputeHash(
        [Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant())
    ))).Replace('-', '').Substring(0, 12)
} finally {
    $hasher.Dispose()
}
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir "Research Pulse ($projectId).lnk"
$taskName = "Research Pulse ($projectId)"
$launchTask = $false

function Write-LauncherLog([string]$Message) {
    Add-Content -LiteralPath $launcherLog -Encoding UTF8 -Value ("{0:o} {1}: {2}" -f [DateTime]::Now, $Action, $Message)
}

function Get-AppTask {
    # A direct lookup avoids CIM enumerating every system task on each check,
    # which can itself take tens of seconds when this task is absent.
    $scheduler = $null
    $folder = $null
    $registeredTask = $null
    try {
        $scheduler = New-Object -ComObject Schedule.Service
        $scheduler.Connect()
        $folder = $scheduler.GetFolder('\')
        $registeredTask = $folder.GetTask($taskName)
        [xml]$definition = $registeredTask.Xml
        $triggers = @($definition.Task.Triggers.ChildNodes | Where-Object { $_.NodeType -eq 'Element' })
        return [pscustomobject]@{
            TaskName = $taskName
            State = @('Unknown', 'Disabled', 'Queued', 'Ready', 'Running')[$registeredTask.State]
            LastRunTime = $registeredTask.LastRunTime
            LastTaskResult = $registeredTask.LastTaskResult
            TriggerTypes = @($triggers | ForEach-Object { $_.LocalName })
            RepetitionIntervals = @($triggers | ForEach-Object { $_.Repetition.Interval } | Where-Object { $_ })
            RestartCount = [int]$definition.Task.Settings.RestartOnFailure.Count
            Launcher = [string]$definition.Task.Actions.Exec.Command
        }
    } catch {
        $lookupError = $_.Exception
        while ($null -ne $lookupError.InnerException) { $lookupError = $lookupError.InnerException }
        if (($lookupError.HResult -band 0xFFFF) -in @(2, 3, 0x130F)) { return $null }
        throw
    } finally {
        foreach ($comObject in @($registeredTask, $folder, $scheduler)) {
            if ($null -ne $comObject) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($comObject) }
        }
    }
}

function Register-AppTask {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $silentLauncher = Join-Path $PSScriptRoot 'windows-service-launcher.vbs'
    if (-not (Test-Path -LiteralPath $silentLauncher -PathType Leaf)) { throw 'Silent startup helper is missing.' }
    $taskAction = New-ScheduledTaskAction `
        -Execute (Join-Path $env:SystemRoot 'System32\wscript.exe') `
        -Argument ('//B //Nologo "' + $silentLauncher + '" "' + $script:NodePath + '"') `
        -WorkingDirectory $projectRoot
    $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
    $logonTrigger.Delay = 'PT5S'
    # Start once per sign-in. No recurring health check or automatic relaunch.
    $principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $taskAction `
        -Trigger $logonTrigger -Principal $principal -Settings $settings `
        -Description 'Research Pulse: start the local server silently once at sign-in; no periodic checks.' -Force | Out-Null
}

function Get-ManagedProcess {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    try {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if (-not $state.pid -or -not $state.startTicks -or $state.entryPath -ne $entryPath) { return $null }
        $managedProcess = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
        if ($null -eq $managedProcess) { return $null }
        # Check creation time and executable as well as PID: Windows reuses PIDs.
        if ($managedProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.startTicks -or
            $managedProcess.Path -ne $state.nodePath) { return $null }
        return $managedProcess
    } catch {
        # Reboots can leave stale/partial state or reuse the PID for a protected
        # process. Never block recovery or kill a process we cannot identify.
        return $null
    }
}

function Get-AppHealth {
    try {
        # Use a direct loopback request, including on machines with a system proxy.
        $request = [System.Net.WebRequest]::Create("http://127.0.0.1:$script:appPort/api/health")
        $request.Proxy = $null
        $request.Timeout = 1500
        $request.ReadWriteTimeout = 1500
        $response = $request.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            try { $health = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        } finally {
            $response.Close()
        }
        if ($health.ok -eq $true -and $health.service -eq 'arxiv-quant-tracker') { return $health }
    } catch {
        return $null
    }
    return $null
}

function Initialize-AppConfig {
    if (-not $script:NodePath) {
        $script:NodePath = (Get-Command node.exe -ErrorAction Stop).Source
    }
    $script:NodePath = (Resolve-Path -LiteralPath $script:NodePath).Path
    Push-Location -LiteralPath $projectRoot
    try {
        $configJson = & $script:NodePath (Join-Path $PSScriptRoot 'service-config.js')
        if ($LASTEXITCODE -ne 0) { throw 'Could not load app configuration. Run npm install first.' }
        $script:appPort = ($configJson | ConvertFrom-Json).port
        if ($script:appPort -lt 1 -or $script:appPort -gt 65535 -or
            [math]::Truncate($script:appPort) -ne $script:appPort) {
            throw 'PORT must be an integer between 1 and 65535.'
        }
        $script:appUrl = "http://localhost:$script:appPort/"
    } finally {
        Pop-Location
    }
}

function Start-App {
    $managedProcess = Get-ManagedProcess
    $health = Get-AppHealth
    if ($null -ne $managedProcess) {
        if ($health.pid -eq $managedProcess.Id) {
            Write-Output "Already running: $script:appUrl (PID $($managedProcess.Id))"
            return
        }
        throw 'The managed process is running but not ready on the configured port. Check the logs, or stop it before restarting.'
    }
    if ($null -ne $health) {
        throw 'An unmanaged Research Pulse process is already running. Stop its npm start terminal first, then retry. No process was stopped.'
    }
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if ($listeners | Where-Object { $_.Port -eq $script:appPort }) {
        throw "Port $script:appPort is occupied by another process. Change PORT in .env or close that process. No process was stopped."
    }

    # Start-Process treats these filesystem parameters as wildcard paths.
    $process = Start-Process -FilePath $script:NodePath -ArgumentList ('"' + $entryPath + '"') `
        -WorkingDirectory ([WildcardPattern]::Escape($projectRoot)) -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput ([WildcardPattern]::Escape($stdoutPath)) `
        -RedirectStandardError ([WildcardPattern]::Escape($stderrPath))
    try {
        @{
            pid = $process.Id
            startTicks = $process.StartTime.ToUniversalTime().Ticks.ToString()
            nodePath = $script:NodePath
            entryPath = $entryPath
        } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        do {
            $process.Refresh()
            if ($process.HasExited) { throw "Server exited. See $stderrPath" }
            $health = Get-AppHealth
            if ($health.pid -eq $process.Id) {
                Write-LauncherLog "Server ready (PID $($process.Id)) at $script:appUrl"
                Write-Output "Running in background: $script:appUrl (PID $($process.Id))"
                return
            }
            Start-Sleep -Milliseconds 300
        } while ([DateTime]::UtcNow -lt $deadline)
        throw "Server did not become ready within 90 seconds. See $stderrPath"
    } catch {
        if (-not $process.HasExited) { Stop-Process -InputObject $process -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Stop-App {
    $managedProcess = Get-ManagedProcess
    if ($null -ne $managedProcess) {
        Stop-Process -InputObject $managedProcess
        if (-not $managedProcess.WaitForExit(5000)) { throw 'The managed process did not stop.' }
        Write-Output "Stopped managed process $($managedProcess.Id)."
    } else {
        Write-Output 'No managed process is running. Other Node processes were not touched.'
    }
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

$mutex = New-Object System.Threading.Mutex($false, "Local\ResearchPulse-$projectId")
$hasLock = $false
try {
    if (-not (Test-Path -LiteralPath $runtimeDir)) {
        New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    }
    try { $hasLock = $mutex.WaitOne(30000) } catch [System.Threading.AbandonedMutexException] { $hasLock = $true }
    if (-not $hasLock) { throw 'Another service command is busy. Please retry shortly.' }

    switch ($Action) {
        'Run' {
            Write-LauncherLog 'Login task started the silent launcher.'
            Initialize-AppConfig
            Start-App | Out-Null
            Write-LauncherLog 'Startup complete; launcher is exiting and Node continues in the background.'
        }
        'Install' {
            Initialize-AppConfig
            Register-AppTask
            # Only migrate after registration succeeds. Keep the old shortcut on failure.
            # Preserve a healthy server when replacing the old repeating task.
            if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
            $launchTask = $true
            Write-LauncherLog "Registered current-user task: $taskName"
        }
        { $_ -in 'Start', 'Open' } {
            Initialize-AppConfig
            if ($null -ne (Get-AppTask)) {
                Enable-ScheduledTask -TaskName $taskName | Out-Null
                $managedProcess = Get-ManagedProcess
                $health = Get-AppHealth
                if ($null -ne $managedProcess -and $health.pid -eq $managedProcess.Id) {
                    Write-Output "Already running: $script:appUrl (PID $($managedProcess.Id))"
                } else {
                    $launchTask = $true
                }
            } else {
                Start-App
            }
        }
        'Status' {
            Initialize-AppConfig
            $managedProcess = Get-ManagedProcess
            $health = Get-AppHealth
            $appTask = Get-AppTask
            [pscustomobject]@{
                url = $script:appUrl
                autoStartInstalled = ($null -ne $appTask) -or (Test-Path -LiteralPath $shortcutPath)
                autoStartEnabled = ($null -ne $appTask -and $appTask.State -ne 'Disabled')
                autoStartMethod = if ($null -ne $appTask) { 'Task Scheduler' } elseif (Test-Path -LiteralPath $shortcutPath) { 'Legacy startup shortcut (no recovery)' } else { 'None' }
                scheduledTask = $taskName
                taskState = if ($null -ne $appTask) { [string]$appTask.State } else { $null }
                lastTaskRun = if ($null -ne $appTask) { $appTask.LastRunTime.ToString('o') } else { $null }
                lastTaskResult = $appTask.LastTaskResult
                autoStartTriggers = @($appTask.TriggerTypes)
                repetitionIntervals = @($appTask.RepetitionIntervals)
                restartCount = $appTask.RestartCount
                launcher = $appTask.Launcher
                healthy = $null -ne $health
                managed = $null -ne $managedProcess
                pid = if ($null -ne $managedProcess) { $managedProcess.Id } else { $health.pid }
                logs = $runtimeDir
            } | ConvertTo-Json
        }
        { $_ -in 'Stop', 'Uninstall' } {
            if ($null -ne (Get-AppTask)) {
                # Disable first so a simultaneous sign-in cannot undo an intentional stop.
                Disable-ScheduledTask -TaskName $taskName | Out-Null
                Stop-ScheduledTask -TaskName $taskName
            }
            if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
            Stop-App
            if ($Action -eq 'Uninstall') {
                if ($null -ne (Get-AppTask)) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
                Write-Output 'Auto-start removed. Project files, cached papers and settings were kept.'
            } else {
                Write-Output 'Service and auto-start paused. Use Start or Open to enable them again.'
            }
        }
    }
} catch {
    $message = $_.Exception.Message
    Add-Content -LiteralPath $launcherLog -Encoding UTF8 -Value ("{0:o} {1}: {2}" -f [DateTime]::Now, $Action, $message) -ErrorAction SilentlyContinue
    Write-Error $message -ErrorAction Continue
    exit 1
} finally {
    if ($hasLock) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}

# Never hold the launch mutex while waiting for the one-shot startup task.
try {
    if ($launchTask) {
        Start-ScheduledTask -TaskName $taskName
        $deadline = [DateTime]::UtcNow.AddSeconds(100)
        do {
            $health = Get-AppHealth
            $managedProcess = Get-ManagedProcess
            if ($null -ne $health -and $null -ne $managedProcess -and $health.pid -eq $managedProcess.Id) { break }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($null -eq $health -or $null -eq $managedProcess -or $health.pid -ne $managedProcess.Id) {
            throw "The scheduled task did not make the server ready. See $launcherLog"
        }
        Write-Output "Running via Task Scheduler: $script:appUrl (PID $($managedProcess.Id))"
    }
    if ($Action -eq 'Open') { Start-Process $script:appUrl }
} catch {
    Write-LauncherLog $_.Exception.Message
    Write-Error $_.Exception.Message -ErrorAction Continue
    exit 1
}
