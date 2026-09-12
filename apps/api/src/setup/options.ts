import { parseArgs, parseEnv } from 'node:util';
import { isAbsolute } from 'node:path';
import { privateFile } from './files.ts';
import { SetupError, type SetupOptions, type SetupSecrets } from './types.ts';

export function parseOptions(args: string[]): SetupOptions {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    env: { type: 'string' }, 'state-dir': { type: 'string' }, execute: { type: 'boolean', default: false }, 'confirm-target': { type: 'string' }, 'maintenance-confirmed': { type: 'boolean', default: false }, 'allow-remote': { type: 'boolean', default: false },
    'tenant-name': { type: 'string' }, 'company-code': { type: 'string' }, 'company-name': { type: 'string' }, 'admin-email': { type: 'string' }, 'admin-name': { type: 'string' }, 'admin-password-file': { type: 'string' }, 'generate-admin-password': { type: 'boolean', default: false },
  } });
  const mode = positionals[0] ?? 'install';
  if (!['install', 'upgrade'].includes(mode) || positionals.length > 1 || !values.env || !values['state-dir']) throw new SetupError('USAGE', 'pnpm run setup install|upgrade --env /abs/private.env --state-dir /abs/operations（既定は計画のみ）');
  if (!isAbsolute(values.env) || !isAbsolute(values['state-dir'])) throw new SetupError('PATH', 'envとstate-dirは絶対パスで指定してください。');
  return { mode: mode as SetupOptions['mode'], envFile: values.env, stateDir: values['state-dir'], execute: values.execute, confirmTarget: values['confirm-target'], maintenanceConfirmed: values['maintenance-confirmed'], allowRemote: values['allow-remote'], tenantName: values['tenant-name'], companyCode: values['company-code'], companyName: values['company-name'], adminEmail: values['admin-email'], adminName: values['admin-name'], adminPasswordFile: values['admin-password-file'], generateAdminPassword: values['generate-admin-password'] };
}
export function connection(url: string, allowRemote: boolean): URL {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new SetupError('URL', 'PostgreSQL接続設定の形式を確認してください。'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.password || parsed.pathname.length < 2) throw new SetupError('URL', 'ホスト・DB名・role・passwordを持つPostgreSQL URLが必要です。');
  const password = decodeURIComponent(parsed.password);
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9\s]/].filter((pattern) => pattern.test(password)).length;
  if (password.length < 16 || classes < 3 || /[\r\n\0]/.test(password)) throw new SetupError('DB_SECRET', 'DBのpasswordは16文字以上・英大/小/数字/記号の3種類以上とし、改行・NULを含めないでください。');
  if (!allowRemote && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new SetupError('REMOTE', '既定はlocalhostだけです。遠隔DBは接続先を確認してallow-remoteを明示してください。');
  if ([...parsed.searchParams.keys()].some((key) => key !== 'sslmode') || parsed.searchParams.getAll('sslmode').length > 1 || parsed.hash) throw new SetupError('URL_OPTIONS', '接続URLの追加optionはsslmodeだけを許可します。host・role・DBの別指定は使用できません。');
  const ssl = parsed.searchParams.get('sslmode');
  if (ssl && !['disable', 'require', 'verify-full'].includes(ssl)) throw new SetupError('URL_SSL', 'sslmodeはdisable/require/verify-fullから指定してください。');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && ssl !== 'verify-full') throw new SetupError('REMOTE_TLS', '遠隔DBにはsslmode=verify-fullと、Node/PostgreSQL双方が信頼する証明書が必要です。');
  return parsed;
}
export function validateJwt(secret: string): void {
  if (secret.length < 32 || new Set(secret).size < 8 || /[\r\n\0]/.test(secret) || /dev-secret-change-me|^password$|^secret$/i.test(secret)) throw new SetupError('WEAK_SECRET', 'JWT_SECRETは既知の開発値以外、改行を含まない32文字以上のランダムな値にしてください。');
}
export async function readSecrets(options: SetupOptions): Promise<SetupSecrets> {
  const env = parseEnv(await privateFile(options.envFile));
  if (!env.DATABASE_URL_OWNER || !env.DATABASE_URL) throw new SetupError('ENV', 'DATABASE_URL_OWNERとDATABASE_URLが必要です。');
  const owner = connection(env.DATABASE_URL_OWNER, options.allowRemote), app = connection(env.DATABASE_URL, options.allowRemote);
  if (owner.hostname !== app.hostname || (owner.port || '5432') !== (app.port || '5432') || owner.pathname !== app.pathname || owner.username === app.username) throw new SetupError('TARGET_MISMATCH', 'owner/appは同じホスト・port・DBの別roleでなければなりません。');
  if (decodeURIComponent(owner.password) === decodeURIComponent(app.password)) throw new SetupError('SHARED_DB_SECRET', 'owner/appは異なるpasswordを使用してください。appの秘密でownerへ接続できる設定は拒否します。');
  if (env.RESTORE_CHECK_URL) connection(env.RESTORE_CHECK_URL, options.allowRemote);
  if (env.JWT_SECRET) validateJwt(env.JWT_SECRET);
  if (options.mode === 'upgrade' && !env.JWT_SECRET) throw new SetupError('EXISTING_SECRET_REQUIRED', '更新には既存JWT_SECRETを含む保護envを指定してください。新しい認証秘密へ置換しません。');
  return { ownerUrl: env.DATABASE_URL_OWNER, appUrl: env.DATABASE_URL, restoreUrl: env.RESTORE_CHECK_URL, jwtSecret: env.JWT_SECRET };
}
