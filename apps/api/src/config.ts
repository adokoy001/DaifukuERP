// Environment loading for main.ts and the db CLI. Reads the nearest .env upward from cwd (repo root in practice).
import { loadDotEnv } from '@daifuku/runtime';
export { loadDotEnv } from '@daifuku/runtime';

type Environment = Readonly<Record<string, string | undefined>>;
const LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'];

/** Messages contain setting names and requirements, never supplied values. */
export class ApiConfigError extends Error {
  override name = 'ApiConfigError';
}

export function requireEnv(name: string, env: Environment = process.env): string {
  const v = env[name];
  if (!v) throw new ApiConfigError(`environment variable ${name} is required (see .env.example)`);
  return v;
}

export interface ApiConfig {
  databaseUrl: string;
  databaseUrlOwner: string;
  jwtSecret: string;
  port: number;
  host: string;
  corsOrigins: readonly string[];
}

function corsOrigins(value: string | undefined, production: boolean): readonly string[] {
  if (value === undefined) return production ? [] : [...LOCAL_ORIGINS];
  if (value.trim() === '') return [];
  const origins = value.split(',').map((item) => {
    try {
      const input = item.trim();
      const url = new URL(input);
      if (!['http:', 'https:'].includes(url.protocol) || url.hostname.includes('*') || input.includes('@') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^https?:\/\/[^/?#\\\s]+\/?$/i.test(input)) throw new Error();
      return url.origin;
    } catch {
      throw new ApiConfigError('CORS_ORIGINS must be comma-separated http(s) origins without credentials, paths, queries, fragments, or wildcards');
    }
  });
  return [...new Set(origins)];
}

/** Pure startup validation, before opening database connections or a listening socket. */
export function readApiConfig(env: Environment): ApiConfig {
  const mode = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new ApiConfigError('NODE_ENV must be development, test, or production');
  const host = env.HOST ?? '127.0.0.1';
  if (!host || /[\s\0/\\]/.test(host)) throw new ApiConfigError('HOST must be a nonempty IP address or hostname without whitespace');
  const port = env.PORT ?? '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new ApiConfigError('PORT must be a decimal integer from 1 to 65535');
  const jwtSecret = requireEnv('JWT_SECRET', env);
  const exposed = mode === 'production' || !['127.0.0.1', '::1', 'localhost'].includes(host);
  // Keep the same minimum secret contract as the explicit setup command.
  if (/[\r\n\0]/.test(jwtSecret) || (exposed && (jwtSecret.length < 32 || new Set(jwtSecret).size < 8 || /dev-secret-change-me|^password$|^secret$/i.test(jwtSecret)))) {
    throw new ApiConfigError('JWT_SECRET must contain no newline or NUL; production or non-loopback HOST requires a random secret of at least 32 characters and 8 distinct characters, excluding known development values');
  }
  return {
    databaseUrl: requireEnv('DATABASE_URL', env),
    databaseUrlOwner: requireEnv('DATABASE_URL_OWNER', env),
    jwtSecret,
    port: Number(port),
    host,
    corsOrigins: corsOrigins(env.CORS_ORIGINS, mode === 'production'),
  };
}

export function apiConfig(): ApiConfig {
  loadDotEnv();
  return readApiConfig(process.env);
}

/** Driver errors can embed the connection URL. Only configuration errors have safe messages. */
export function startupErrorMessage(error: unknown): string {
  return error instanceof ApiConfigError ? error.message : 'API startup failed. Verify the database, storage, and listen settings; connection details are not logged.';
}
