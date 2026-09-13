import { pathsScript } from './paths-script.ts';
import { serviceScript } from './service-script.ts';

export type WindowsSetupOperation =
  | 'inspect'
  | 'administrator'
  | 'prepareRoot'
  | 'prepare'
  | 'protect'
  | 'register'
  | 'start'
  | 'stop'
  | 'uninstall'
  | 'durableReplace'
  | 'durablePublish';
const actions: Record<WindowsSetupOperation, string> = {
  inspect: 'Reply (Inspection $edgeInput.context $edgeInput.xml)',
  administrator: 'Administrator; Reply $null',
  durableReplace: 'DurableReplace $edgeInput.source $edgeInput.target; Reply $null',
  durablePublish: 'DurableReplace $edgeInput.source $edgeInput.target $false; Reply $null',
  prepareRoot: 'PrepareRoot $edgeInput.context; Reply $null',
  prepare: String.raw`
Administrator; CheckPaths $edgeInput.context
$context = $edgeInput.context
$marker = [IO.Path]::Combine($context.installRoot,'installation.json')
if (![IO.File]::Exists($marker)) { throw 'windows_installation_marker_required' }
$installation = [IO.File]::ReadAllText($marker) | ConvertFrom-Json
if ($installation.kind -ne 'daifuku-edge-installation' -or $installation.installationId -ne $context.installationId) { throw 'windows_installation_marker_required' }
$service = ReadService
if ($service) { [void](Owned $context $edgeInput.xml $true) }
foreach ($path in @($context.servicePath,$context.statePath,$context.logPath)) {
  if (![IO.Directory]::Exists($path)) { [void][IO.Directory]::CreateDirectory($path,(NewAcl $true ($path -ne $context.servicePath))) }
}
ProtectPath $context.installRoot $false; ProtectPath $context.servicePath $false
ProtectPath $marker $false; ProtectPath $context.statePath $true; ProtectPath $context.logPath $true
Reply $null
`,
  protect: String.raw`
Administrator; CheckPaths $edgeInput.context
$context = $edgeInput.context
ProtectTree $context.releaseDir $false; ProtectTree $context.servicePath $false
ProtectPath $context.installRoot $false
ProtectPath ([IO.Path]::Combine($context.installRoot,'installation.json')) $false
ProtectPath $context.statePath $true; ProtectPath $context.logPath $true
foreach ($name in @('config.json','pairing.incoming.json')) {
  $path = [IO.Path]::Combine($context.statePath,$name)
  if ([IO.File]::Exists($path)) { ProtectPath $path $true }
}
foreach ($item in Get-ChildItem -LiteralPath $context.statePath -Force -File) {
  if ($item.Name -match '^ca-(api|[0-9a-f-]{36})\.pem$') { ProtectPath $item.FullName $true }
}
Reply $null
`,
  register: 'Administrator; RegisterService $edgeInput.context $edgeInput.xml; Reply $null',
  start: "Administrator; ServiceAction $edgeInput.context $edgeInput.xml 'start'; Reply $null",
  stop: "Administrator; ServiceAction $edgeInput.context $edgeInput.xml 'stop'; Reply $null",
  uninstall: "Administrator; ServiceAction $edgeInput.context $edgeInput.xml 'uninstall'; Reply $null",
};
export function windowsSetupScript(operation: WindowsSetupOperation): string {
  return (
    String.raw`
$ErrorActionPreference = 'Stop'
$env:PSModulePath = [IO.Path]::Combine($PSHOME,'Modules')
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Reply($value) { [Console]::Out.WriteLine((@{ok=$true;value=$value} | ConvertTo-Json -Depth 8 -Compress)) }
` +
    pathsScript +
    serviceScript +
    '\ntry {\n$edgeInput = [Console]::In.ReadLine() | ConvertFrom-Json\n' +
    actions[operation] +
    String.raw`
} catch {
  $code = $_.Exception.Message
  if ($code -notmatch '^windows_[a-z_]{1,64}$') { $code = 'windows_service_operation_failed' }
  [Console]::Out.WriteLine((@{ok=$false;code=$code} | ConvertTo-Json -Compress)); exit 74
}
`
  );
}
