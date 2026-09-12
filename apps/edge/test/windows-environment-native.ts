// Read-only reproduction of a PowerShell 7 -> Windows PowerShell 5.1 module collision.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import { promisify } from 'node:util';
import { windowsPowerShellEnvironment } from '../src/windows-environment.ts';
import { windowsScript } from '../src/windows-script.ts';

async function main(): Promise<void> {
  assert.equal(process.platform, 'win32');
  const incompatibleModules = process.argv[2];
  assert.ok(incompatibleModules && win32.isAbsolute(incompatibleModules));
  const executable = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const source = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
  source.PSMODULEPATH = incompatibleModules;
  const legacy = { ...source, PSModulePath: win32.join(win32.dirname(executable), 'Modules') };
  const script = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';try{$null=Get-Acl -LiteralPath 'C:\\ProgramData';[Console]::Out.WriteLine('acl_available')}catch{[Console]::Out.WriteLine('acl_unavailable')}";
  const probe = async (environment: NodeJS.ProcessEnv) => (await promisify(execFile)(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: environment, windowsHide: true })).stdout.trim();
  assert.equal(await probe(legacy), 'acl_unavailable', 'Legacy duplicate-key spawn reproduces the incompatible module failure');
  assert.equal(await probe(windowsPowerShellEnvironment(source)), 'acl_available');
  // Provoke an unexpected native exception containing a synthetic secret; only a stage code escapes.
  const faulted = windowsScript('directory').replace('[Console]::In.ReadLine() | ConvertFrom-Json', '$null').replace('[void](PrivateDirectory $edgeInput.path); Reply $null', "$script:edgeStage='directory_create'; throw 'synthetic-secret-must-not-escape'");
  let stdout = '', stderr = '';
  try { await promisify(execFile)(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(faulted, 'utf16le').toString('base64')], { env: windowsPowerShellEnvironment(source), windowsHide: true, timeout: 10000 }); }
  catch (error) { const output = error as { stdout?: string; stderr?: string }; stdout = output.stdout ?? ''; stderr = output.stderr ?? ''; }
  // The controlled native fault never handles a real payload or a path.
  assert.equal((JSON.parse(stdout) as { code: string }).code, 'windows_private_directory_create_failed');
  assert.equal((stdout + stderr).includes('synthetic-secret-must-not-escape'), false);
  process.stdout.write(`Windows inherited module collision reproduced and fixed; private error redaction PASS (${process.version})\n`);
}
void main().catch((error: unknown) => { process.stderr.write(error instanceof Error ? error.message + '\n' : 'native_environment_failed\n'); process.exitCode = 1; });
