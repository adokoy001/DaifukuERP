// Fixed PowerShell/.NET code. Paths and private payloads arrive only through stdin JSON.
const common = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
$script:edgeStage = 'input'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$edgeCurrentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$edgeAllowed = @($edgeCurrentSid, 'S-1-5-18', 'S-1-5-32-544')
function PrivateAcl($security) {
  if ($edgeAllowed -notcontains $security.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'private_file_permissions_required' }
  $rules = @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -eq 0) { throw 'private_file_permissions_required' }
  foreach ($rule in $rules) { if ($rule.AccessControlType -eq 'Allow' -and $edgeAllowed -notcontains $rule.IdentityReference.Value) { throw 'private_file_permissions_required' } }
}
function SafeParentAcl($security) {
  $trusted = @($edgeAllowed) + @('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  if ($trusted -notcontains $security.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'unsafe_parent_permissions' }
  foreach ($rule in $security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and !($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and $trusted -notcontains $rule.IdentityReference.Value -and ([int64]$rule.FileSystemRights -band 0x100d0040)) { throw 'unsafe_parent_permissions' }
  }
}
function LocalPath([string]$path) {
  $script:edgeStage = 'path'
  if ($path -notmatch '^[A-Za-z]:\\' -or $path.Substring(2).Contains(':')) { throw 'local_state_path_required' }
  $full = [IO.Path]::GetFullPath($path)
  $part = $full
  while ($part) {
    if (Test-Path -LiteralPath $part) { $item = Get-Item -Force -LiteralPath $part; if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'unsafe_state_path' }; if ($part -ne $full) { $script:edgeStage = 'parent_acl'; SafeParentAcl (Get-Acl -LiteralPath $part) } }
    $next = [IO.Path]::GetDirectoryName($part); if ($next -eq $part) { break }; $part = $next
  }
  if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($full)).DriveType -ne 'Fixed') { throw 'local_state_path_required' }
  return $full
}
function PrivateDirectory([string]$path) {
  $full = LocalPath $path
  if (!(Test-Path -LiteralPath $full)) {
    $parent = [IO.Path]::GetDirectoryName($full)
    if (![IO.Directory]::Exists($parent)) { throw 'private_parent_required' }
    $script:edgeStage = 'directory_create'
    $security = [Security.AccessControl.DirectorySecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner([Security.Principal.SecurityIdentifier]::new($edgeCurrentSid))
    foreach ($sid in $edgeAllowed | Select-Object -Unique) { $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')) }
    [void][IO.Directory]::CreateDirectory($full, $security)
  }
  if (![IO.Directory]::Exists($full)) { throw 'unsafe_state_directory' }
  $script:edgeStage = 'directory_acl'
  PrivateAcl (Get-Acl -LiteralPath $full)
  return $full
}
function PrivateFile([string]$path) {
  $full = LocalPath $path
  [void](PrivateDirectory ([IO.Path]::GetDirectoryName($full)))
  if (!(Test-Path -LiteralPath $full)) { throw 'ENOENT' }
  if (![IO.File]::Exists($full)) { throw 'invalid_state_file' }
  $script:edgeStage = 'file_acl'
  PrivateAcl (Get-Acl -LiteralPath $full)
  return $full
}
function Reply($value) { [Console]::Out.WriteLine((@{ok=$true;value=$value} | ConvertTo-Json -Depth 8 -Compress)) }
`;
const actions = {
  directory: String.raw`[void](PrivateDirectory $edgeInput.path); Reply $null`,
  read: String.raw`
$full = PrivateFile $edgeInput.path
$script:edgeStage = 'read'
$stream = [IO.FileStream]::new($full, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
  PrivateAcl ($stream.GetAccessControl())
  if ($stream.Length -gt $edgeInput.maxBytes) { throw 'invalid_state_file' }
  $reader = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false, $true), $false)
  try { Reply ($reader.ReadToEnd()) } finally { $reader.Dispose() }
} finally { $stream.Dispose() }
`,
  write: String.raw`
$full = LocalPath $edgeInput.path
$parent = PrivateDirectory ([IO.Path]::GetDirectoryName($full))
if (Test-Path -LiteralPath $full) { [void](PrivateFile $full) }
$temporary = [IO.Path]::Combine($parent, '.' + [IO.Path]::GetFileName($full) + '.' + [Guid]::NewGuid().ToString() + '.tmp')
$bytes = [Convert]::FromBase64String($edgeInput.bytes)
if ($bytes.Length -gt $edgeInput.maxBytes) { throw 'journal_capacity_exceeded' }
try {
  $script:edgeStage = 'write'
  $stream = [IO.FileStream]::new($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
  try { PrivateAcl ($stream.GetAccessControl()); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EdgeMove { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool MoveFileExW(string source, string destination, uint flags); }'
  if (![EdgeMove]::MoveFileExW($temporary, $full, 9)) { throw 'private_atomic_replace_failed' }
  Reply $null
} finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
`,
  move: String.raw`
$source = PrivateFile $edgeInput.path
$destination = LocalPath $edgeInput.destination
if ([IO.Path]::GetDirectoryName($source) -ne [IO.Path]::GetDirectoryName($destination)) { throw 'private_parent_required' }
if (Test-Path -LiteralPath $destination) { throw 'private_file_exists' }
$script:edgeStage = 'move'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EdgeMove { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool MoveFileExW(string source, string destination, uint flags); }'
if (![EdgeMove]::MoveFileExW($source, $destination, 8)) { throw 'private_atomic_replace_failed' }
Reply $null
`,
  remove: String.raw`$full = PrivateFile $edgeInput.path; $script:edgeStage = 'remove'; [IO.File]::Delete($full); Reply $null`,
  lock: String.raw`
$full = LocalPath $edgeInput.path
[void](PrivateDirectory ([IO.Path]::GetDirectoryName($full)))
if (Test-Path -LiteralPath $full) { [void](PrivateFile $full) }
$script:edgeStage = 'lock'
try { $stream = [IO.FileStream]::new($full, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch [IO.IOException] { if (($_.Exception.HResult -band 65535) -eq 32) { exit 73 }; throw }
try { PrivateAcl ($stream.GetAccessControl()); [Console]::Out.WriteLine('locked'); [void][Console]::In.ReadToEnd() } finally { $stream.Dispose() }
`,
} as const;
export type WindowsOperation = keyof typeof actions;
export function windowsScript(operation: WindowsOperation): string {
  return common + String.raw`
try { $edgeInput = [Console]::In.ReadLine() | ConvertFrom-Json
` + actions[operation] + String.raw`
} catch {
  $code = $_.Exception.Message
  if ($code -notmatch '^(ENOENT|private_file_permissions_required|local_state_path_required|unsafe_state_path|private_parent_required|unsafe_state_directory|invalid_state_file|journal_capacity_exceeded|private_atomic_replace_failed|unsafe_parent_permissions|private_file_exists)$') {
    $stage = $script:edgeStage
    if (@('input','path','parent_acl','directory_create','directory_acl','file_acl','read','write','move','remove','lock') -notcontains $stage) { $stage = 'io' }
    $code = 'windows_private_' + $stage + '_failed'
  }
  [Console]::Out.WriteLine((@{ok=$false;code=$code} | ConvertTo-Json -Compress)); exit 74
}
`;
}
