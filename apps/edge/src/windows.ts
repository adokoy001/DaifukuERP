import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { EdgeError } from './errors.ts';
import { windowsScript, type WindowsOperation } from './windows-script.ts';
import { windowsPowerShellEnvironment } from './windows-environment.ts';
export function windowsHelper(operation: WindowsOperation, input: Record<string, unknown>) {
  const executable = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsScript(operation), 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true, env: windowsPowerShellEnvironment() });
  child.stdin.on('error', () => undefined); child.stdin.write(JSON.stringify(input) + '\n'); return child;
}
export async function windowsIo(operation: Exclude<WindowsOperation, 'lock'>, input: Record<string, unknown>): Promise<unknown> {
  const child = windowsHelper(operation, input); child.stdin.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new EdgeError('windows_private_io_timeout')); }, 20000);
    child.on('error', () => { clearTimeout(timer); reject(new EdgeError('windows_powershell_required')); });
    child.stdout.on('data', (data: Buffer) => { size += data.length; if (size > 12000000) { child.kill(); reject(new EdgeError('invalid_state_file')); } else chunks.push(data); });
    child.once('close', (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { ok?: boolean; code?: unknown; value?: unknown };
        if (result.ok === true && code === 0) { resolve(result.value); return; }
        if (result.code === 'ENOENT') { reject(Object.assign(new EdgeError('state_file_missing'), { code: 'ENOENT' })); return; }
        if (typeof result.code === 'string' && /^[a-z_]{1,64}$/.test(result.code)) { reject(new EdgeError(result.code)); return; }
      } catch { /* Never disclose helper output: it can contain a private JSON document. */ }
      reject(new EdgeError('windows_private_io_failed'));
    });
  });
}
