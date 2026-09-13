// Read-only SCM simulation: this never installs or operates a Windows service.
// Run on Windows: pnpm exec tsx apps/edge/test/windows-service-native.ts
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { pathsScript } from '../setup/windows/paths-script.ts';
import { serviceScript } from '../setup/windows/service-script.ts';
import { windowsSetupScript } from '../setup/windows/script.ts';
import { windowsPowerShellEnvironment } from '../src/windows-environment.ts';

const tests = String.raw`
$ErrorActionPreference='Stop'
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$ProgressPreference='SilentlyContinue'
function CheckCodeAcl([string]$path) { if (!(Test-Path -LiteralPath $path)) { throw 'windows_service_not_owned' }; [void](LocalPath $path) }
function ProtectPath([string]$path,[bool]$private) { }
function ReadService { return $script:edgeService }
function Get-CimInstance([string]$ClassName,[string]$Filter) {
  if ($ClassName -ne 'Win32_Process' -or $Filter -ne 'ParentProcessId=100') { throw 'unexpected_cim_query' }
  return $script:edgeChildren
}
function RunWrapper([string]$exe,[string]$operation) {
  $script:edgeOperations += $operation
  if ($operation -eq 'install') { $script:edgeService=@{PathName=('"'+$exe+'"'); Description=('Daifuku Edge installation '+$context.installationId); StartName='NT AUTHORITY\LocalService'; StartMode='Auto'; State='Stopped'} }
  if ($operation -eq 'start') { $script:edgeService.State='Running' }
  if ($operation -eq 'stopwait') { $script:edgeService.State='Stopped' }
  if ($operation -eq 'uninstall') { $script:edgeService=$null }
}
function WaitService([string]$expected) { }
function Assert([bool]$condition,[string]$label) { if (!$condition) { throw ('assertion_failed_'+$label) } }
function Reject([scriptblock]$operation,[string]$message) {
  try { & $operation; throw 'expected_rejection' } catch { if ($_.Exception.Message -ne $message) { throw } }
}
$root=[IO.Path]::Combine([IO.Path]::GetTempPath(),'daifuku-windows-test-'+[Guid]::NewGuid().ToString('N'))
$script:edgeService=$null; $script:edgeOperations=@()
try {
  $codeAcl=NewAcl $true $false
  $privateAcl=NewAcl $true $true
  $lockAcl=NewAcl $true $true $false
  Assert ($codeAcl.AreAccessRulesProtected -and $privateAcl.AreAccessRulesProtected -and $lockAcl.AreAccessRulesProtected) 'inheritance_protected'
  $codeRules=@($codeAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  $privateRules=@($privateAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  $lockRules=@($lockAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  Assert ($codeRules.Count -eq 3 -and $privateRules.Count -eq 3 -and $lockRules.Count -eq 2) 'acl_sid_counts'
  $localCode=@($codeRules|Where-Object {$_.IdentityReference.Value -eq 'S-1-5-19'})
  $localPrivate=@($privateRules|Where-Object {$_.IdentityReference.Value -eq 'S-1-5-19'})
  Assert ($localCode.Count -eq 1 -and !($localCode[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write)) 'service_cannot_write_code'
  Assert ($localPrivate.Count -eq 1 -and ($localPrivate[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write)) 'service_can_write_state'
  Ancestors 'C:\Program Files\DaifukuEdge'
  [void][IO.Directory]::CreateDirectory($root)
  $context=@{installationId='ae79484c-7253-449b-970a-7715043529e8';installRoot=($root+'\install');statePath=($root+'\state');servicePath=($root+'\install\service');releaseDir=($root+'\install\releases\one');configPath=($root+'\state\config.json');logPath=($root+'\state\logs');nodePath=($root+'\install\releases\one\runtime\node.exe');appPath=($root+'\install\releases\one\app\edge.mjs')}
  foreach ($path in @($context.installRoot,$context.servicePath,($context.releaseDir+'\wrapper'),$context.statePath)) { [void][IO.Directory]::CreateDirectory($path) }
  [IO.File]::WriteAllText(($context.releaseDir+'\wrapper\WinSW.NET461.exe'),'synthetic-wrapper')
  [IO.File]::WriteAllText(($context.statePath+'\journal.json'),'preserved-journal')
  $xml='<service>synthetic immutable config one</service>'
  $initial=Inspection $context $xml
  Assert (!$initial.serviceExists -and !$initial.serviceOwned -and $edgeOperations.Count -eq 0) 'plan_is_read_only'
  [IO.File]::WriteAllText(($context.installRoot+'\installation.json'),(@{kind='daifuku-edge-installation';installationId=$context.installationId}|ConvertTo-Json))
  $orphan=$context.servicePath+'\registration.json.0123456789abcdef0123456789abcdef.tmp'
  [IO.File]::WriteAllText($orphan,'interrupted synthetic owner write')
  Assert ((Inspection $context $xml).conflicts.Count -eq 0) 'own_interrupted_first_registration_resumable'
  RegisterService $context $xml
  Assert ([IO.File]::Exists($orphan)) 'orphan_evidence_retained'
  Assert (Inspection $context $xml).serviceOwned 'registered_owned'
  $files=ServiceFiles $context
  $servicePath=$edgeService.PathName
  $script:edgeService.PathName='"C:\Windows\other.exe"'
  Reject { ServiceAction $context $xml 'stop' } 'windows_service_not_owned'
  Assert ($edgeOperations.Count -eq 1) 'foreign_service_untouched'
  $script:edgeService.PathName=$servicePath
  $script:edgeService.StartName='LocalSystem'
  Reject { ServiceAction $context $xml 'start' } 'windows_service_account_changed'
  $script:edgeService.StartName='NT AUTHORITY\LocalService'
  [IO.File]::WriteAllText($files.xml,'tampered')
  Reject { ServiceAction $context $xml 'uninstall' } 'windows_service_config_changed'
  [IO.File]::WriteAllText($files.xml,$xml)
  ServiceAction $context $xml 'start'
  $script:edgeService.ProcessId=100
  $command='"'+$context.nodePath+'" "'+$context.appPath+'" service --config "'+$context.configPath+'" --state "'+$context.statePath+'"'
  $script:edgeChildren=@(@{ProcessId=101;ExecutablePath=$context.nodePath;CommandLine=$command})
  Assert ((Inspection $context $xml).processId -eq 101) 'identifies_real_agent_child'
  $script:edgeChildren=@(@{ProcessId=102;ExecutablePath=$context.nodePath;CommandLine=($command+' --unexpected')})
  Assert (!(Inspection $context $xml).processId) 'rejects_changed_child_arguments'
  $script:edgeChildren=@(@{ProcessId=101;ExecutablePath=$context.nodePath;CommandLine=$command},@{ProcessId=102;ExecutablePath=$context.nodePath;CommandLine=$command})
  Assert (!(Inspection $context $xml).processId) 'rejects_ambiguous_agent_children'
  Reject { RegisterService $context '<service>two</service>' } 'windows_service_must_be_stopped'
  ServiceAction $context $xml 'stop'
  $owner=[IO.File]::ReadAllText($files.owner)|ConvertFrom-Json
  $owner.phase='prepared'; $owner.previousXmlHash=$owner.xmlHash; $owner.xmlHash=('0'*64)
  [IO.File]::WriteAllText($files.owner,($owner|ConvertTo-Json -Depth 8))
  Assert (Inspection $context $xml).serviceOwned 'prepared_old_configuration_inspectable'
  Reject { ServiceAction $context $xml 'start' } 'windows_service_registration_incomplete'
  $next='<service>synthetic immutable config two</service>'
  RegisterService $context $next
  Assert (Inspection $context $next).serviceOwned 'prepared_update_resumed'
  [IO.File]::WriteAllText(($context.releaseDir+'\wrapper\WinSW.NET461.exe'),'different-wrapper')
  Reject { RegisterService $context $next } 'windows_wrapper_version_changed'
  ServiceAction $context $next 'uninstall'
  Assert (!$edgeService -and [IO.File]::ReadAllText(($context.statePath+'\journal.json')) -eq 'preserved-journal' -and [IO.File]::Exists($files.owner)) 'uninstall_retains_state_and_registration_history'
  [Console]::Out.WriteLine('Windows SCM ownership/resume simulation PASS (no real service operations)')
} finally {
  $resolved=[IO.Path]::GetFullPath($root)
  if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('daifuku-windows-test-')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
`;
const scripts = [
  'inspect',
  'administrator',
  'prepareRoot',
  'prepare',
  'protect',
  'register',
  'start',
  'stop',
  'uninstall',
  'durableReplace',
  'durablePublish',
].map((operation) => windowsSetupScript(operation as Parameters<typeof windowsSetupScript>[0]));
const syntax =
  '\n$edgeScripts=[Console]::In.ReadToEnd()|ConvertFrom-Json;foreach($source in $edgeScripts){$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if($errors.Count -gt 0){throw "helper_syntax_invalid"}}\n';
const packed = gzipSync(
  Buffer.from("$ProgressPreference='SilentlyContinue'\n" + pathsScript + serviceScript + syntax + tests),
).toString('base64');
const script = `$s=[IO.MemoryStream]::new([Convert]::FromBase64String('${packed}'));$r=[IO.StreamReader]::new([IO.Compression.GZipStream]::new($s,[IO.Compression.CompressionMode]::Decompress));try{$code=$r.ReadToEnd()}finally{$r.Dispose()};&([ScriptBlock]::Create($code))`;
const executable =
  process.platform === 'win32'
    ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    : '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const child = spawn(
  executable,
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  {
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: false,
    windowsHide: true,
    env: windowsPowerShellEnvironment(),
  },
);
child.stdin.end(JSON.stringify(scripts));
child.on('error', () => {
  process.exitCode = 1;
});
child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
