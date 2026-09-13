import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { writeExclusive } from './files.ts';
import { connection } from './options.ts';
import { SetupError } from './types.ts';

function command(name: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(name, args, { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60 * 1000 });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 8192) stdout += chunk.toString();
    });
    // PostgreSQL stderr can include server-provided details. Never forward it to terminal/logs.
    child.stderr.resume();
    child.on('error', () =>
      reject(
        new SetupError(
          'PG_TOOL',
          `${name}を起動できません。PostgreSQLと同じmajor版のclient toolsをPATHに設定してください。`,
        ),
      ),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(
            new SetupError(
              'PG_TOOL_FAILED',
              `${name}が失敗しました。接続、空の復元先、toolsの版、空き容量を確認してください。`,
            ),
          ),
    );
  });
}
export async function checkPgTools(serverVersion: number): Promise<void> {
  for (const name of ['pg_dump', 'pg_restore']) {
    const version = await command(name, ['--version'], process.env);
    const major = /PostgreSQL\)\s+(\d+)/.exec(version)?.[1];
    if (Number(major) !== Math.floor(serverVersion / 10000))
      throw new SetupError('PG_TOOL_VERSION', `${name}は接続先PostgreSQLと同じmajor版を使用してください。`);
  }
}
export async function pgTool(
  name: 'pg_dump' | 'pg_restore',
  url: string,
  args: string[],
  privateDir: string,
): Promise<void> {
  const parsed = connection(url, true);
  const escape = (text: string) => text.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const port = parsed.port || '5432';
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const username = decodeURIComponent(parsed.username);
  if ([host, database, username].some((value) => /[\r\n\0]/.test(value)))
    throw new SetupError('PGPASS_VALUE', '接続先の識別子に改行・NULを使用できません。');
  const passFile = join(privateDir, `.pgpass-${randomBytes(12).toString('hex')}`);
  await writeExclusive(
    passFile,
    `${[host, port, database, username, decodeURIComponent(parsed.password)].map(escape).join(':')}\n`,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(PG|DATABASE|TEST_DATABASE|JWT_SECRET)/.test(key)),
  );
  Object.assign(env, {
    PGHOST: host,
    PGPORT: port,
    PGDATABASE: database,
    PGUSER: username,
    PGPASSFILE: passFile,
    PGCONNECT_TIMEOUT: '10',
    ...(parsed.searchParams.get('sslmode') ? { PGSSLMODE: parsed.searchParams.get('sslmode') ?? '' } : {}),
  });
  try {
    await command(name, args, env);
  } finally {
    await unlink(passFile);
  }
}
