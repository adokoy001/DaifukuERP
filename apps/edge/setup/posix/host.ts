import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}
export interface FileInfo {
  kind: 'file' | 'directory' | 'link' | 'other';
  uid: number;
  gid: number;
  mode: number;
  links: number;
}
export interface PosixHost {
  platform: 'linux' | 'darwin';
  uid(): number;
  run(command: string, args: string[]): Promise<CommandResult>;
  stat(path: string): Promise<FileInfo | null>;
  read(path: string): Promise<string>;
  write(path: string, content: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string, mode: number): Promise<void>;
  list(path: string): Promise<string[]>;
  chmod(path: string, mode: number): Promise<void>;
  chown(path: string, uid: number, gid: number): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}
export function nativeHost(platform: 'linux' | 'darwin'): PosixHost {
  return {
    platform,
    uid: () => (process.platform === platform ? (process.getuid?.() ?? -1) : -1),
    run: (command, args) =>
      new Promise((resolve, reject) => {
        execFile(
          command,
          args,
          {
            encoding: 'utf8',
            timeout: 45000,
            maxBuffer: 1024 * 1024,
            env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C' },
          },
          (error, stdout, stderr) => {
            if (error && typeof error.code !== 'number') {
              reject(new Error('Required service manager command could not be executed.'));
              return;
            }
            resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
          },
        );
      }),
    stat: async (path) => {
      try {
        const s = await fs.lstat(path);
        return {
          kind: s.isSymbolicLink() ? 'link' : s.isFile() ? 'file' : s.isDirectory() ? 'directory' : 'other',
          uid: s.uid,
          gid: s.gid,
          mode: s.mode & 0o7777,
          links: s.nlink,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    read: (path) => fs.readFile(path, 'utf8'),
    write: (path, content, mode) => fs.writeFile(path, content, { flag: 'wx', mode }),
    rename: fs.rename,
    remove: fs.unlink,
    mkdir: (path, mode) => fs.mkdir(path, { mode }),
    list: fs.readdir,
    chmod: fs.chmod,
    chown: fs.chown,
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
}
export async function command(host: PosixHost, executable: string, args: string[]): Promise<string> {
  const result = await host.run(executable, args);
  if (result.code !== 0) throw new Error('Service manager operation failed: ' + executable.split('/').at(-1));
  return result.stdout;
}
