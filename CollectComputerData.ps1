# =====================================================================
#  Computer Inventory Collector
#  Run via CollectComputerData.bat (do not run this .ps1 by itself unless
#  you know how to bypass PowerShell's execution policy).
#
#  What it does, in order:
#   1. Reads, automatically:
#        - Computer name, logged-in Windows username
#        - MAC address, local IP, connection type (Ethernet/WiFi)
#        - Windows edition + build (10/11/etc), system manufacturer/model
#        - CPU model, total RAM, total/free disk space (C: drive)
#        - Enabled local user accounts on this PC
#        - Date of the most recently installed Windows update
#   2. Asks the operator for: user's name, department, PC/Laptop,
#      printer name, printer IP, and a remark.
#   3. Tries to re-send any earlier entries that failed to upload
#      (stored in the PendingUploads folder next to this script).
#   4. Logs in to PocketBase and uploads the new record.
#   5. If ANYTHING about the network/server step fails, the record is
#      saved to PendingUploads instead of being discarded, so no data
#      is ever lost. It retries automatically the next time this
#      script is run (on this same PC).
#
#  This script does not install anything, does not change any Windows
#  setting, and does not touch any other files on the PC. Every piece
#  of automatic detection is wrapped so that if ONE item can't be read
#  (e.g. an older PC missing a particular command), it is recorded as
#  "Unknown" rather than stopping the whole script.
# =====================================================================

$ErrorActionPreference = "Continue"
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$PendingDir = Join-Path $ScriptDir "PendingUploads"
if (-not (Test-Path $PendingDir)) {
    New-Item -ItemType Directory -Path $PendingDir | Out-Null
}

# ---------------------- CONFIG: loaded from Config.ps1 ------------------
$ConfigFile = Join-Path $ScriptDir "Config.ps1"
if (-not (Test-Path $ConfigFile)) {
    Write-Host "ERROR: Config.ps1 was not found in this folder. Keep it next to this script." -ForegroundColor Red
    exit 1
}
. $ConfigFile
if ([string]::IsNullOrWhiteSpace($ServicePassword) -or $ServicePassword -eq "PUT_PASSWORD_HERE") {
    Write-Host "ERROR: Set the real password in Config.ps1 (ServicePassword is still a placeholder)." -ForegroundColor Red
    exit 1
}
# -----------------------------------------------------------------------

# ----------------------------- Helpers ---------------------------------

function Read-RequiredText {
    param([string]$Prompt)
    do {
        $val = Read-Host $Prompt
    } while ([string]::IsNullOrWhiteSpace($val))
    return $val.Trim()
}

function Read-OptionalText {
    param([string]$Prompt)
    $val = Read-Host $Prompt
    if ($null -eq $val) { return "" }
    return $val.Trim()
}

function Read-OptionalIP {
    param([string]$Prompt)
    while ($true) {
        $val = Read-Host $Prompt
        if ([string]::IsNullOrWhiteSpace($val)) { return "" }
        if ($val -match '^\d{1,3}(\.\d{1,3}){3}$') { return $val.Trim() }
        Write-Host "  That doesn't look like a valid IP (example: 192.168.5.50). Leave blank to skip." -ForegroundColor Yellow
    }
}

function Read-MenuChoice {
    param(
        [string]$Title,
        [string[]]$Options
    )
    Write-Host ""
    Write-Host $Title -ForegroundColor Cyan
    for ($i = 0; $i -lt $Options.Count; $i++) {
        Write-Host ("  [{0}] {1}" -f ($i + 1), $Options[$i])
    }
    while ($true) {
        $sel = Read-Host "Enter choice number"
        if ($sel -match '^\d+$' -and [int]$sel -ge 1 -and [int]$sel -le $Options.Count) {
            return $Options[[int]$sel - 1]
        }
        Write-Host "  Invalid choice, try again." -ForegroundColor Yellow
    }
}

function Get-PrimaryNetworkInfo {
    # Preferred method (Windows 8 / Server 2012 and newer)
    try {
        $configs = Get-NetIPConfiguration -ErrorAction Stop | Where-Object {
            $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up'
        }
        $primary = $configs | Select-Object -First 1
        if (-not $primary) {
            $primary = Get-NetIPConfiguration -ErrorAction Stop |
                Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4Address } |
                Select-Object -First 1
        }
        if ($primary) {
            $adapter = Get-NetAdapter -InterfaceIndex $primary.InterfaceIndex -ErrorAction Stop
            $mac = $adapter.MacAddress
            $ip  = ($primary.IPv4Address | Select-Object -First 1).IPAddress
            $connType = "Ethernet"
            if ($adapter.PhysicalMediaType -match "802\.11" -or $adapter.Name -match "Wi-?Fi|Wireless") {
                $connType = "WiFi"
            }
            return [PSCustomObject]@{
                MacAddress     = $mac
                IPAddress      = $ip
                ConnectionType = $connType
            }
        }
    } catch { }

    # Legacy fallback (works on older Windows via WMI/CIM)
    try {
        $nic = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled = True" -ErrorAction Stop |
            Select-Object -First 1
        $adapter = Get-CimInstance Win32_NetworkAdapter -Filter "Index = $($nic.Index)" -ErrorAction Stop
        $connType = if ($adapter.Name -match "Wireless|Wi-?Fi|802\.11") { "WiFi" } else { "Ethernet" }
        return [PSCustomObject]@{
            MacAddress     = $nic.MACAddress
            IPAddress      = ($nic.IPAddress | Select-Object -First 1)
            ConnectionType = $connType
        }
    } catch { }

    return [PSCustomObject]@{
        MacAddress     = "UNKNOWN"
        IPAddress      = "UNKNOWN"
        ConnectionType = "UNKNOWN"
    }
}

function Get-ComputerDetails {
    # Every item below is fetched independently, so one missing/unsupported
    # WMI class never blocks the rest - it just falls back to "Unknown".
    $result = [ordered]@{
        OSName             = "Unknown"
        SystemModel        = "Unknown"
        CPU                = "Unknown"
        RAMGB              = "Unknown"
        DiskTotalGB        = "Unknown"
        DiskFreeGB         = "Unknown"
        LocalUserAccounts  = "Unknown"
        LastUpdate         = "Unknown"
    }

    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        $result.OSName = "$($os.Caption.Trim()) (Build $($os.BuildNumber))"
    } catch { }

    try {
        $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
        $result.SystemModel = ("$($cs.Manufacturer) $($cs.Model)").Trim()
        $result.RAMGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1).ToString()
    } catch { }

    try {
        $proc = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
        $result.CPU = ($proc.Name -replace '\s+', ' ').Trim()
    } catch { }

    try {
        $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction Stop
        if (-not $disk) {
            $disk = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction Stop | Select-Object -First 1
        }
        if ($disk) {
            $result.DiskTotalGB = [math]::Round($disk.Size / 1GB, 1).ToString()
            $result.DiskFreeGB  = [math]::Round($disk.FreeSpace / 1GB, 1).ToString()
        }
    } catch { }

    try {
        $users = Get-LocalUser -ErrorAction Stop | Where-Object { $_.Enabled } | Select-Object -ExpandProperty Name
        if ($users) { $result.LocalUserAccounts = ($users -join ", ") }
    } catch {
        try {
            # Fallback for systems without the LocalAccounts module: parse "net user"
            $raw = net user
            $names = @()
            $inList = $false
            foreach ($line in $raw) {
                if ($line -match '^-+$') { $inList = -not $inList; continue }
                if ($inList -and $line.Trim() -ne "") {
                    $names += ($line -split '\s{2,}') | Where-Object { $_.Trim() -ne "" }
                }
            }
            if ($names.Count -gt 0) { $result.LocalUserAccounts = ($names -join ", ") }
        } catch { }
    }

    try {
        $hotfix = Get-HotFix -ErrorAction Stop | Where-Object { $_.InstalledOn } |
            Sort-Object InstalledOn -Descending | Select-Object -First 1
        if ($hotfix) { $result.LastUpdate = $hotfix.InstalledOn.ToString("yyyy-MM-dd") }
    } catch { }

    return [PSCustomObject]$result
}

function Get-PocketBaseToken {
    param([string]$PlainPassword)
    $body = @{ identity = $ServiceEmail; password = $PlainPassword } | ConvertTo-Json
    $uri  = "$PocketBaseUrl/api/collections/$AuthCollection/auth-with-password"
    $resp = Invoke-RestMethod -Uri $uri -Method Post -Body $body -ContentType "application/json" -ErrorAction Stop
    return $resp.token
}

function Send-Record {
    param([string]$Token, [string]$JsonBody)
    $uri = "$PocketBaseUrl/api/collections/$DataCollection/records"
    $headers = @{ Authorization = $Token }   # PocketBase expects the raw token, no "Bearer " prefix
    Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $JsonBody -ContentType "application/json" -ErrorAction Stop | Out-Null
}

# ------------------------- 1. Gather system info ------------------------

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host " Computer Inventory Collector" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

$netInfo      = Get-PrimaryNetworkInfo
$sysDetails   = Get-ComputerDetails
$computerName = $env:COMPUTERNAME
$winUser      = $env:USERNAME

Write-Host ""
Write-Host "Detected automatically:"
Write-Host "  Computer Name    : $computerName"
Write-Host "  Windows Login    : $winUser"
Write-Host "  MAC Address      : $($netInfo.MacAddress)"
Write-Host "  Local IP         : $($netInfo.IPAddress)"
Write-Host "  Connection Type  : $($netInfo.ConnectionType)"
Write-Host "  OS               : $($sysDetails.OSName)"
Write-Host "  System Model     : $($sysDetails.SystemModel)"
Write-Host "  CPU              : $($sysDetails.CPU)"
Write-Host "  RAM (GB)         : $($sysDetails.RAMGB)"
Write-Host "  Disk Total (GB)  : $($sysDetails.DiskTotalGB)"
Write-Host "  Disk Free (GB)   : $($sysDetails.DiskFreeGB)"
Write-Host "  Local Users      : $($sysDetails.LocalUserAccounts)"
Write-Host "  Last Update      : $($sysDetails.LastUpdate)"

# ------------------------- 2. Ask the operator --------------------------

$UserName = Read-RequiredText -Prompt "`nEnter the User's Name (person who uses this PC)"

$departments = @(
    "Faculty","Accounts","PA","Establishment","Protocol","Computer Section",
    "Estate","CoE","S & S","Trg1","Trg4","TRPC","Others (type new)"
)
$deptChoice = Read-MenuChoice -Title "Select Department:" -Options $departments
if ($deptChoice -eq "Others (type new)") {
    $Department = Read-RequiredText -Prompt "Enter the new department name"
} else {
    $Department = $deptChoice
}

$deviceType = Read-MenuChoice -Title "Select Device Type:" -Options @("PC","Laptop")

$PrinterName = Read-OptionalText -Prompt "`nEnter Printer Name (leave blank if none)"
$PrinterIP   = Read-OptionalIP   -Prompt "Enter Printer IP (leave blank if none)"

$Remark = Read-OptionalText -Prompt "`nAny remark? (optional, press Enter to skip)"

# ------------------------- 3. Build the record ---------------------------

$record = [ordered]@{
    user_name            = $UserName
    department           = $Department
    computer_name        = $computerName
    windows_username     = $winUser
    device_type          = $deviceType
    os_name              = $sysDetails.OSName
    system_model         = $sysDetails.SystemModel
    cpu                  = $sysDetails.CPU
    ram_gb               = $sysDetails.RAMGB
    disk_total_gb        = $sysDetails.DiskTotalGB
    disk_free_gb         = $sysDetails.DiskFreeGB
    local_user_accounts  = $sysDetails.LocalUserAccounts
    last_update          = $sysDetails.LastUpdate
    mac_address          = $netInfo.MacAddress
    ip_address           = $netInfo.IPAddress
    connection_type      = $netInfo.ConnectionType
    printer_name         = $PrinterName
    printer_ip           = $PrinterIP
    remark               = $Remark
}
$jsonBody = $record | ConvertTo-Json

Write-Host ""
Write-Host "-----------------------------------------------"
Write-Host "Summary:"
$record.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-20}: {1}" -f $_.Key, $_.Value) }
Write-Host "-----------------------------------------------"

# ------------------------- 4. Auth + send + flush queue -------------------

$token = $null
try {
    Write-Host "`nConnecting to PocketBase..."
    $token = Get-PocketBaseToken -PlainPassword $ServicePassword
    Write-Host "Login OK." -ForegroundColor Green
} catch {
    Write-Host "Could not log in to PocketBase: $($_.Exception.Message)" -ForegroundColor Red
}

# Try to flush any previously queued (failed) entries first
if ($token) {
    $pending = Get-ChildItem -Path $PendingDir -Filter "*.json" -ErrorAction SilentlyContinue
    if ($pending) {
        Write-Host "`nFound $($pending.Count) queued entr$(if($pending.Count -eq 1){'y'}else{'ies'}) from earlier - retrying..."
        foreach ($file in $pending) {
            try {
                $oldJson = Get-Content -Path $file.FullName -Raw
                Send-Record -Token $token -JsonBody $oldJson
                Remove-Item -Path $file.FullName -Force
                Write-Host "  Sent and cleared: $($file.Name)" -ForegroundColor Green
            } catch {
                Write-Host "  Still failing, left queued: $($file.Name)" -ForegroundColor Yellow
            }
        }
    }
}

# Now send (or queue) THIS record
$sentOk = $false
if ($token) {
    try {
        Send-Record -Token $token -JsonBody $jsonBody
        $sentOk = $true
    } catch {
        Write-Host "Upload failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

if ($sentOk) {
    Write-Host "`nRecord uploaded successfully. Thank you!" -ForegroundColor Green
    exit 0
} else {
    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $queueFile = Join-Path $PendingDir "$($computerName)_$stamp.json"
    Set-Content -Path $queueFile -Value $jsonBody -Encoding UTF8
    Write-Host "`nCould not reach PocketBase right now." -ForegroundColor Yellow
    Write-Host "Your entry was saved locally at:" -ForegroundColor Yellow
    Write-Host "  $queueFile" -ForegroundColor Yellow
    Write-Host "It will be sent automatically next time this script runs with network access." -ForegroundColor Yellow
    exit 1
}
