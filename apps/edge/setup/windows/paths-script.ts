// Fixed script only: paths arrive as JSON through stdin, never as shell expressions.
export const pathsScript = String.raw`
function LocalPath([string]$path) {
  if ($path -notmatch '^[A-Za-z]:\\' -or $path -match '[\x00-\x1f"%<>|?*]' -or $path.Substring(2).Contains(':')) { throw 'windows_local_path_required' }
  $full = [IO.Path]::GetFullPath($path)
  foreach ($part in $full.Substring(3).Split('\')) { if ($part -match '[. ]$' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)') { throw 'windows_local_path_required' } }
  $part = $full
  while ($part) {
    if (Test-Path -LiteralPath $part) { if ((Get-Item -LiteralPath $part -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'windows_reparse_path_refused' } }
    $next = [IO.Path]::GetDirectoryName($part); if ($next -eq $part) { break }; $part = $next
  }
  if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($full)).DriveType -ne 'Fixed') { throw 'windows_local_path_required' }
  return $full
}
function CheckPaths($context) {
  foreach ($name in @('installRoot','statePath','releaseDir','nodePath','appPath','configPath','logPath','servicePath')) { [void](LocalPath $context.$name) }
  if ($context.caPath) { [void](LocalPath $context.caPath) }
}
function Administrator {
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'windows_administrator_required' }
  $framework = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release -ErrorAction SilentlyContinue
  if (!$framework -or $framework.Release -lt 528040) { throw 'windows_net_framework_48_required' }
}
function CheckCodeAcl([string]$path) {
  $acl = Get-Acl -LiteralPath (LocalPath $path)
  if (@('S-1-5-18','S-1-5-32-544') -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'windows_code_acl_unsafe' }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow') { continue }
    if (@('S-1-5-18','S-1-5-32-544') -contains $rule.IdentityReference.Value) { continue }
    $writes = [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
    if ($rule.FileSystemRights -band $writes) { throw 'windows_code_acl_unsafe' }
  }
}
function NewAcl([bool]$directory, [bool]$private, [bool]$includeService=$true) {
  if ($directory) { $acl = [Security.AccessControl.DirectorySecurity]::new() } else { $acl = [Security.AccessControl.FileSecurity]::new() }
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  $identities = @('S-1-5-18','S-1-5-32-544'); if ($includeService) { $identities += 'S-1-5-19' }
  foreach ($sid in $identities) {
    $rights = if ($sid -eq 'S-1-5-19' -and !$private) { 'ReadAndExecute' } else { 'FullControl' }
    $inherit = if ($directory) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), $rights, $inherit, 'None', 'Allow'))
  }
  return $acl
}
function ProtectPath([string]$path, [bool]$private) {
  $full = LocalPath $path
  $item = Get-Item -Force -LiteralPath $full
  Set-Acl -LiteralPath $full -AclObject (NewAcl $item.PSIsContainer $private)
}
function Ancestors([string]$path) {
  $part = [IO.Path]::GetDirectoryName((LocalPath $path))
  $allowed = @('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
  $allowed += [Security.Principal.NTAccount]::new('NT SERVICE\TrustedInstaller').Translate([Security.Principal.SecurityIdentifier]).Value
  while ($part) {
    if ([IO.Directory]::Exists($part)) {
      $acl = Get-Acl -LiteralPath $part
      if ($allowed -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'windows_ancestor_acl_unsafe' }
      foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -ne 'Allow' -or $allowed -contains $rule.IdentityReference.Value -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }
        if ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]'DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership') { throw 'windows_ancestor_acl_unsafe' }
      }
    }
    $next = [IO.Path]::GetDirectoryName($part); if ($next -eq $part) { break }; $part = $next
  }
}
function PrepareRoot($context) {
  Administrator; CheckPaths $context; Ancestors $context.installRoot; Ancestors $context.statePath
  if ([IO.Directory]::Exists($context.installRoot)) {
    CheckCodeAcl $context.installRoot
    $children = @(Get-ChildItem -LiteralPath $context.installRoot -Force)
    if (@($children | Where-Object { $_.Name -ne '.setup-lock' }).Count -gt 0) {
      $marker = [IO.Path]::Combine($context.installRoot,'installation.json')
      CheckCodeAcl $marker
      $record = [IO.File]::ReadAllText($marker) | ConvertFrom-Json
      if ($record.kind -ne 'daifuku-edge-installation' -or $record.installationId -ne $context.installationId) { throw 'windows_installation_marker_required' }
    }
  } else {
    if (![IO.Directory]::Exists([IO.Path]::GetDirectoryName($context.installRoot))) { throw 'windows_install_parent_required' }
    [void][IO.Directory]::CreateDirectory($context.installRoot,(NewAcl $true $false))
  }
  $lock = [IO.Path]::Combine($context.installRoot,'.setup-lock')
  [void](LocalPath $lock)
  if (![IO.Directory]::Exists($lock)) { [void][IO.Directory]::CreateDirectory($lock,(NewAcl $true $true $false)) }
  CheckCodeAcl $lock
  Set-Acl -LiteralPath $lock -AclObject (NewAcl $true $true $false)
}
function ProtectTree([string]$path, [bool]$private) {
  [void](LocalPath $path)
  $items = @((Get-Item -LiteralPath $path -Force)) + @(Get-ChildItem -LiteralPath $path -Force -Recurse)
  if ($items.Count -gt 10000) { throw 'windows_install_tree_too_large' }
  foreach ($item in $items) { [void](LocalPath $item.FullName) }
  foreach ($item in $items) { ProtectPath $item.FullName $private }
}
function HashFile([string]$path) {
  $stream = [IO.File]::OpenRead((LocalPath $path)); $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $sha.Dispose() }
}
function WriteAtomic([string]$path, [string]$text) {
  [void](LocalPath $path)
  $temporary = $path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $stream = [IO.FileStream]::new($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    MoveAtomic $temporary $path
    ProtectPath $path $false
  } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
function MoveAtomic([string]$source, [string]$target, [bool]$replace=$true) {
  if (!('EdgeSetupMove' -as [type])) { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EdgeSetupMove { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool MoveFileExW(string source, string destination, uint flags); }' }
  $flags = if ($replace) { 9 } else { 8 }
  if (![EdgeSetupMove]::MoveFileExW($source,$target,$flags)) {
    if (!$replace -and [Runtime.InteropServices.Marshal]::GetLastWin32Error() -in @(80,183)) { throw 'windows_atomic_target_exists' }
    throw 'windows_atomic_replace_failed'
  }
}
function DurableReplace([string]$source, [string]$target, [bool]$replace=$true) {
  $source = LocalPath $source; $target = LocalPath $target
  if ([IO.Path]::GetDirectoryName($source) -ine [IO.Path]::GetDirectoryName($target) -or $source -ieq $target) { throw 'windows_atomic_paths_invalid' }
  $owners = @('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
  foreach ($path in @($source,$target)) {
    if (![IO.File]::Exists($path)) { if ($path -eq $source) { throw 'windows_atomic_source_missing' }; continue }
    $acl = Get-Acl -LiteralPath $path
    if ($owners -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'windows_atomic_acl_unsafe' }
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -eq 'Allow' -and (@($owners) + @('S-1-5-19')) -notcontains $rule.IdentityReference.Value) { throw 'windows_atomic_acl_unsafe' }
    }
  }
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $acl = Get-Acl -LiteralPath $source
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    Set-Acl -LiteralPath $source -AclObject $acl
  }
  MoveAtomic $source $target $replace
}
`;
