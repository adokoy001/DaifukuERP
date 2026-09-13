import { win32 } from 'node:path';

/** Node keeps only the first case-insensitive key on Windows; remove every spelling first. */
export function windowsPowerShellEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(source).filter(([name]) => name.toLowerCase() !== 'psmodulepath'),
  );
  const systemRoot = Object.entries(source).find(([name]) => name.toLowerCase() === 'systemroot')?.[1] ?? 'C:\\Windows';
  environment.PSModulePath = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  return environment;
}
