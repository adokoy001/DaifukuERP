export const serviceScript = String.raw`
function ReadService { return Get-CimInstance -ClassName Win32_Service -Filter "Name='DaifukuEdge'" }
function ServiceFiles($context) {
  return @{ exe=[IO.Path]::Combine($context.servicePath,'DaifukuEdge.exe'); xml=[IO.Path]::Combine($context.servicePath,'DaifukuEdge.xml'); owner=[IO.Path]::Combine($context.servicePath,'registration.json') }
}
function UnregisteredDirectory($context) {
  if (![IO.Directory]::Exists($context.servicePath)) { return }
  $items = @(Get-ChildItem -LiteralPath $context.servicePath -Force)
  if ($items.Count -eq 0) { return }
  CheckCodeAcl $context.installRoot; CheckCodeAcl $context.servicePath
  $marker = [IO.Path]::Combine($context.installRoot,'installation.json')
  CheckCodeAcl $marker
  $installation = [IO.File]::ReadAllText($marker) | ConvertFrom-Json
  if ($installation.kind -ne 'daifuku-edge-installation' -or $installation.installationId -ne $context.installationId -or $items.Count -gt 100) { throw 'windows_service_not_owned' }
  foreach ($item in $items) {
    if ($item.PSIsContainer -or $item.Name -notmatch '^registration\.json\.[0-9a-f]{32}\.tmp$') { throw 'windows_service_not_owned' }
    CheckCodeAcl $item.FullName
  }
}
function ReadOwner($context, $files, [bool]$allowPrepared) {
  foreach ($path in @($context.installRoot,$context.servicePath,$files.owner)) { CheckCodeAcl $path }
  $owner = [IO.File]::ReadAllText($files.owner) | ConvertFrom-Json
  if ($owner.format -ne 1 -or $owner.installationId -ne $context.installationId -or $owner.serviceId -ne 'DaifukuEdge') { throw 'windows_service_not_owned' }
  if ($owner.phase -ne 'committed' -and !($allowPrepared -and $owner.phase -eq 'prepared')) { throw 'windows_service_registration_incomplete' }
  if ([IO.File]::Exists($files.exe)) {
    CheckCodeAcl $files.exe
    if ($owner.wrapperHash -ne (HashFile $files.exe)) { throw 'windows_service_config_changed' }
  } elseif ($owner.phase -ne 'prepared' -or !$allowPrepared) { throw 'windows_service_config_changed' }
  if ([IO.File]::Exists($files.xml)) {
    CheckCodeAcl $files.xml
    $hash = HashFile $files.xml
    if ($owner.xmlHash -ne $hash -and !($allowPrepared -and $owner.phase -eq 'prepared' -and $owner.previousXmlHash -eq $hash)) { throw 'windows_service_config_changed' }
  } elseif ($owner.phase -ne 'prepared' -or !$allowPrepared) { throw 'windows_service_config_changed' }
  CheckPaths $owner.context
  foreach ($name in @('installRoot','statePath','servicePath','configPath')) {
    if ((LocalPath $owner.context.$name) -ine (LocalPath $context.$name)) { throw 'windows_service_config_changed' }
  }
  return $owner
}
function VerifyService($context, $service, $files) {
  if ($service.PathName -cne ('"' + $files.exe + '"') -or $service.Description -cne ('Daifuku Edge installation ' + $context.installationId)) { throw 'windows_service_not_owned' }
  try { $sid = [Security.Principal.NTAccount]::new($service.StartName).Translate([Security.Principal.SecurityIdentifier]).Value } catch { throw 'windows_service_account_changed' }
  if ($sid -ne 'S-1-5-19' -or $service.StartMode -ne 'Auto') { throw 'windows_service_account_changed' }
}
function AgentProcessId($context, $service) {
  if (!$service -or $service.State -ne 'Running' -or [long]$service.ProcessId -le 0) { return $null }
  $parentId = [long]$service.ProcessId
  $arguments = '"' + $context.appPath + '" service --config "' + $context.configPath + '" --state "' + $context.statePath + '"'
  $expected = '"' + $context.nodePath + '" ' + $arguments
  try { $children = @(Get-CimInstance -ClassName Win32_Process -Filter ('ParentProcessId=' + $parentId)) } catch { return $null }
  $matches = @($children | Where-Object { $_.ExecutablePath -ieq $context.nodePath -and $_.CommandLine -ceq $expected })
  if ($matches.Count -eq 1 -and [long]$matches[0].ProcessId -gt 0) { return [long]$matches[0].ProcessId }
  return $null
}
function Inspection($context, [string]$expectedXml) {
  CheckPaths $context
  $service = ReadService
  $files = ServiceFiles $context
  $conflicts = @()
  $owned = $false
  if ($service -or [IO.File]::Exists($files.owner)) {
    try {
      $owner = ReadOwner $context $files $true
      if ($service) { VerifyService $context $service $files }
      if ([IO.File]::Exists($files.xml) -and [IO.File]::ReadAllText($files.xml) -cne $expectedXml) { throw 'windows_service_config_changed' }
      $owned = $true
    } catch {
      $reason = $_.Exception.Message
      if ($reason -notmatch '^windows_[a-z_]+$') { $reason = 'windows_service_not_owned' }
      $conflicts += $reason
    }
  } else {
    try { UnregisteredDirectory $context } catch { $conflicts += 'windows_service_not_owned' }
  }
  $result = @{ serviceExists=[bool]$service; serviceRunning=[bool]($service -and $service.State -ne 'Stopped'); serviceOwned=$owned; conflicts=@($conflicts); account=@{name='NT AUTHORITY\LocalService';sid='S-1-5-19'} }
  if ($owned) { $childId = AgentProcessId $context $service; if ($childId) { $result.processId = $childId } }
  return $result
}
function Owned($context, [string]$expectedXml, [bool]$allowPrevious) {
  CheckPaths $context
  $files = ServiceFiles $context
  $owner = ReadOwner $context $files $allowPrevious
  $service = ReadService
  if ($service) { VerifyService $context $service $files }
  if (!$allowPrevious -and [IO.File]::ReadAllText($files.xml) -cne $expectedXml) { throw 'windows_service_config_changed' }
  return @{files=$files; owner=$owner; service=$service}
}
function RunWrapper([string]$executable, [string]$operation) {
  if (@('install','uninstall','start','stopwait') -notcontains $operation) { throw 'windows_service_operation_invalid' }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
  $process.StartInfo.FileName = $executable
  $process.StartInfo.Arguments = $operation
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  try {
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit(45000)) { $process.Kill(); throw 'windows_service_operation_timeout' }
    if ($process.ExitCode -ne 0) { throw 'windows_service_operation_failed' }
  } finally { $process.Dispose() }
}
function WaitService([string]$expected) {
  $until = [DateTime]::UtcNow.AddSeconds(40)
  do {
    $service = ReadService
    if (($expected -eq 'Absent' -and !$service) -or ($service -and $service.State -eq $expected)) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $until)
  throw 'windows_service_operation_timeout'
}
function RegisterService($context, [string]$expectedXml) {
  CheckPaths $context
  $files = ServiceFiles $context
  $source = [IO.Path]::Combine($context.releaseDir,'wrapper','WinSW.NET461.exe')
  CheckCodeAcl $source
  $sourceHash = HashFile $source
  $service = ReadService
  $previousHash = $null
  if ($service -or [IO.File]::Exists($files.owner)) {
    $current = Owned $context $expectedXml $true
    if ($current.service -and $current.service.State -ne 'Stopped') { throw 'windows_service_must_be_stopped' }
    if ($sourceHash -ne $current.owner.wrapperHash) { throw 'windows_wrapper_version_changed' }
    if ([IO.File]::Exists($files.xml)) { $previousHash = HashFile $files.xml }
  } else {
    UnregisteredDirectory $context
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $xmlHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($expectedXml))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
  $record = @{ format=1;serviceId='DaifukuEdge';installationId=$context.installationId;context=$context;xmlHash=$xmlHash;wrapperHash=$sourceHash;phase='prepared';previousXmlHash=$previousHash }
  WriteAtomic $files.owner ($record | ConvertTo-Json -Depth 8 -Compress)
  if (![IO.File]::Exists($files.exe)) { [IO.File]::Copy($source, $files.exe, $false); ProtectPath $files.exe $false }
  WriteAtomic $files.xml $expectedXml
  if (!$service) { RunWrapper $files.exe 'install' }
  VerifyService $context (ReadService) $files
  $record.phase = 'committed'; $record.previousXmlHash = $null
  WriteAtomic $files.owner ($record | ConvertTo-Json -Depth 8 -Compress)
  $result = Inspection $context $expectedXml
  if (!$result.serviceExists -or !$result.serviceOwned -or $result.conflicts.Count -gt 0) { throw 'windows_service_registration_failed' }
}
function ServiceAction($context, [string]$expectedXml, [string]$operation) {
  $current = Owned $context $expectedXml $false
  if (!$current.service) { if ($operation -eq 'uninstall') { return }; throw 'windows_service_missing' }
  if ($operation -eq 'start') { RunWrapper $current.files.exe 'start'; WaitService 'Running'; return }
  if ($current.service.State -ne 'Stopped') { RunWrapper $current.files.exe 'stopwait'; WaitService 'Stopped' }
  if ($operation -eq 'uninstall') { RunWrapper $current.files.exe 'uninstall'; WaitService 'Absent' }
}
`;
