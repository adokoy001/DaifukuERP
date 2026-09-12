import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Settings must be loaded before selecting modules, in every app entry point. */
export function loadDotEnv(start = process.cwd()): string | null {
  let dir = start;
  for (let i = 0; i < 5; i++) {
    const path = resolve(dir, '.env');
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return path;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
