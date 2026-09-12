import { win32 } from 'node:path';
import { windowsPath } from './config.ts';
import { runWindowsPayload } from './runner.ts';

/** Caller flushes its exclusive temporary file first; source and target stay in one private directory. */
export async function windowsDurableReplace(source: string, target: string): Promise<void> {
  const from = windowsPath(source), to = windowsPath(target);
  if (from.toLowerCase() === to.toLowerCase() || win32.dirname(from).toLowerCase() !== win32.dirname(to).toLowerCase()) throw new Error('windows_atomic_paths_invalid');
  await runWindowsPayload('durableReplace', { source: from, target: to });
}
/** Publish an inbox entry atomically; an already queued entry is never replaced. */
export async function windowsDurablePublish(source: string, target: string): Promise<void> {
  const from = windowsPath(source), to = windowsPath(target);
  if (from.toLowerCase() === to.toLowerCase() || win32.dirname(from).toLowerCase() !== win32.dirname(to).toLowerCase()) throw new Error('windows_atomic_paths_invalid');
  try { await runWindowsPayload('durablePublish', { source: from, target: to }); }
  catch (error) { if (error instanceof Error && error.message === 'windows_atomic_target_exists') throw Object.assign(error, { code: 'EEXIST' }); throw error; }
}
