import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EdgeError } from './errors.ts';
/** POSIX mode alone does not account for macOS extended ACL permissions. */
export async function assertNoMacAcl(path: string): Promise<void> {
  if (process.platform !== 'darwin') return;
  let text: string;
  try { text = (await promisify(execFile)('/bin/ls', ['-lde', path], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 })).stdout; }
  catch { throw new EdgeError('macos_acl_check_failed'); }
  if (/^\s*\d+: /m.test(text)) throw new EdgeError('private_file_acl_required');
}
/** zsh/system uses a kernel fcntl lock and releases it on process exit. No stale PID takeover.
 * Apple zsh returns generic status 1 for -t 0 contention; a positive bounded timeout returns 2.
 * This only bounds our acquisition wait. An existing owner's lock is never expired or removed.
 * https://github.com/apple-oss-distributions/zsh/blob/main/zsh/Src/Modules/system.c
 */
export const macosLockScript = 'zmodload zsh/system || exit 69; zsystem supports flock || exit 69; zsystem flock -t 0.01 -f edge_lock_fd "$1"; edge_lock_status=$?; if (( edge_lock_status == 2 )); then exit 73; elif (( edge_lock_status != 0 )); then exit 74; fi; print -r -- locked; IFS= read -r edge_input; exit 0';
