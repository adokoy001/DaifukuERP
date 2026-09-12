import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ServiceContext } from '../types.ts';
import { windowsSetupScript, type WindowsSetupOperation } from './script.ts';

export type WindowsRunner = (operation: WindowsSetupOperation, context?: ServiceContext, xml?: string) => Promise<unknown>;
export function encodedWindowsSetup(operation: WindowsSetupOperation): string {
  // Compress only our fixed source to stay below CreateProcess's command-line limit.
  // No context, paths, tokens or caller-supplied text enter this executable expression.
  const packed = gzipSync(Buffer.from(windowsSetupScript(operation), 'utf8')).toString('base64');
  const bootstrap = `$edgeBytes=[Convert]::FromBase64String('${packed}'); $edgeStream=[IO.MemoryStream]::new($edgeBytes,0,$edgeBytes.Length); $edgeGzip=[IO.Compression.GZipStream]::new($edgeStream,[IO.Compression.CompressionMode]::Decompress); $edgeReader=[IO.StreamReader]::new($edgeGzip); try { $edgeSource=$edgeReader.ReadToEnd() } finally { $edgeReader.Dispose() }; & ([ScriptBlock]::Create($edgeSource))`;
  return Buffer.from(bootstrap, 'utf16le').toString('base64');
}
export async function runWindowsPayload(operation: WindowsSetupOperation, input: Record<string, unknown>): Promise<unknown> {
  if (process.platform !== 'win32') throw new Error('windows_platform_required');
  const executable = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = encodedWindowsSetup(operation);
  if (encoded.length > 30000) throw new Error('windows_helper_too_large');
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true,
    env: { ...process.env, PSModulePath: win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') },
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(JSON.stringify(input) + '\n');
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('windows_service_operation_timeout')); }, 100000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('windows_powershell_required')); });
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString('utf8');
      if (output.length > 65536) { child.kill(); reject(new Error('windows_service_output_invalid')); }
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(output) as { ok?: boolean; code?: unknown; value?: unknown };
        if (code === 0 && result.ok === true) { resolve(result.value); return; }
        if (typeof result.code === 'string' && /^windows_[a-z_]{1,64}$/.test(result.code)) { reject(new Error(result.code)); return; }
      } catch { /* Child output is never included in errors or logs. */ }
      reject(new Error('windows_service_operation_failed'));
    });
  });
}
export const runWindowsSetup: WindowsRunner = async (operation, context, xml) => runWindowsPayload(operation, { context, xml });
