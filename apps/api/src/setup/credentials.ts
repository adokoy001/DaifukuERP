import { randomBytes } from 'node:crypto';
import { emitKeypressEvents } from 'node:readline';
import { isAbsolute, join } from 'node:path';
import { parseEnv } from 'node:util';
import { newId } from '@daifuku/kernel';
import { exists, privateFile, writeExclusive } from './files.ts';
import { SetupError, type Identity, type SetupOptions, type SetupSecrets, type SetupState } from './types.ts';
import { validateJwt } from './options.ts';

export function identityInput(options: SetupOptions): Omit<Identity, 'tenantId'> {
  const { tenantName, companyCode, companyName, adminEmail, adminName } = options;
  if (
    ![tenantName, companyCode, companyName, adminEmail, adminName].every(
      (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200,
    )
  )
    throw new SetupError(
      'ADMIN_REQUIRED',
      '初回はtenant-name/company-code/company-name/admin-email/admin-nameを明示してください。',
    );
  if (
    !/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(companyCode ?? '') ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail ?? '') ||
    adminEmail?.toLowerCase() === 'admin@example.com'
  )
    throw new SetupError(
      'ADMIN_IDENTITY',
      '会社コードと実際の管理者emailを指定してください。既知のdemo管理者は本番導入に使えません。',
    );
  return {
    tenantName: String(tenantName),
    companyCode: String(companyCode),
    companyName: String(companyName),
    adminEmail: String(adminEmail).toLowerCase(),
    adminName: String(adminName),
  };
}
export function installIdentity(options: SetupOptions, state?: SetupState): Identity {
  const input = identityInput(options);
  if (state?.identity) {
    if (Object.entries(input).some(([key, value]) => state.identity?.[key as keyof Identity] !== value))
      throw new SetupError(
        'IDENTITY_CHANGED',
        '初回のtenant/company/admin指定と一致しません。既存管理者を上書きしません。',
      );
    return state.identity;
  }
  return { tenantId: newId(), ...input };
}
export function validatePassword(password: string): void {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9\s]/].filter((pattern) => pattern.test(password)).length;
  if (
    password.length < 16 ||
    password.length > 256 ||
    classes < 3 ||
    /[\r\n\0]/.test(password) ||
    /^(password|admin|owner|app|dev-secret-change-me)/i.test(password)
  )
    throw new SetupError(
      'ADMIN_PASSWORD',
      '管理者passwordは16〜256文字、英大/小/数字/記号のうち3種類以上で指定してください。既知の開発値は拒否します。',
    );
}
function hiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new SetupError(
      'PASSWORD_INPUT',
      '非対話実行ではadmin-password-fileまたはgenerate-admin-passwordを指定してください。',
    );
  process.stderr.write('初回管理者のpassword（非表示）: ');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.off('keypress', keypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
    };
    const keypress = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        finish();
        reject(new SetupError('CANCELLED', 'password入力を中止しました。'));
      } else if (key.name === 'return' || key.name === 'enter') {
        finish();
        resolve(value);
      } else if (key.name === 'backspace') value = value.slice(0, -1);
      else if (text && !key.ctrl && value.length < 257) value += text;
    };
    process.stdin.on('keypress', keypress);
  });
}
export async function adminPassword(options: SetupOptions): Promise<string> {
  if (options.adminPasswordFile && options.generateAdminPassword)
    throw new SetupError('PASSWORD_OPTIONS', 'password-fileとgenerate-admin-passwordは同時指定できません。');
  let password: string;
  if (options.adminPasswordFile) password = (await privateFile(options.adminPasswordFile)).replace(/\r?\n$/, '');
  else if (options.generateAdminPassword) {
    const path = join(options.stateDir, 'initial-admin-password.txt');
    if (!(await exists(path))) await writeExclusive(path, `D!${randomBytes(32).toString('base64url')}9a\n`);
    password = (await privateFile(path)).trimEnd();
  } else password = await hiddenPassword();
  validatePassword(password);
  return password;
}
/** dotenv is not JSON: select a representation only after verifying Node's exact round trip. */
export function serializeEnv(values: Record<string, string>): string {
  return `${Object.entries(values)
    .map(([key, value]) => {
      const encoded = [`'${value}'`, `"${value}"`, `\`${value}\``, value].find(
        (candidate) => parseEnv(`${key}=${candidate}\n`)[key] === value,
      );
      if (encoded === undefined || /[\r\n\0]/.test(value))
        throw new SetupError(
          'ENV_ENCODING',
          '設定値をenvファイルに完全に保存できません。改行を含めず、秘密はbase64url等の表現を使用してください。',
        );
      return `${key}=${encoded}`;
    })
    .join('\n')}\n`;
}
export async function runtimeConfig(options: SetupOptions, secrets: SetupSecrets, state: SetupState): Promise<void> {
  if (!state.identity) return; // An upgrade uses the supplied existing configuration unchanged.
  const path = join(options.stateDir, 'runtime.env');
  if (await exists(path)) {
    const stored = parseEnv(await privateFile(path));
    if (
      !stored.JWT_SECRET ||
      stored.NODE_ENV !== 'production' ||
      !stored.HOST ||
      !Number.isInteger(Number(stored.PORT)) ||
      Number(stored.PORT) < 1 ||
      Number(stored.PORT) > 65535 ||
      !stored.DAIFUKU_STORAGE_DIR ||
      !isAbsolute(stored.DAIFUKU_STORAGE_DIR) ||
      !stored.DAIFUKU_PACKS
    )
      throw new SetupError(
        'RUNTIME_CONFIG_INVALID',
        '保存済runtime.envの必須設定が欠けているか不正です。元の保管済み設定を確認し、自動上書きせず復元してください。',
      );
    validateJwt(stored.JWT_SECRET);
    if (
      stored.DATABASE_URL_OWNER !== secrets.ownerUrl ||
      stored.DATABASE_URL !== secrets.appUrl ||
      (secrets.jwtSecret && stored.JWT_SECRET !== secrets.jwtSecret)
    )
      throw new SetupError(
        'RUNTIME_CONFIG_CHANGED',
        '保存済runtime.envと接続・認証設定が異なります。自動上書きしません。',
      );
    return;
  }
  if (state.phase === 'complete')
    throw new SetupError(
      'RUNTIME_CONFIG_MISSING',
      '完了済導入のruntime.envがありません。保管済みコピーを復元してください。JWTを再生成しません。',
    );
  const env = {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: '3000',
    DATABASE_URL_OWNER: secrets.ownerUrl,
    DATABASE_URL: secrets.appUrl,
    JWT_SECRET: secrets.jwtSecret ?? randomBytes(48).toString('base64url'),
    DAIFUKU_STORAGE_DIR: join(options.stateDir, 'evidence'),
    DAIFUKU_PACKS: 'all',
  };
  await writeExclusive(path, serializeEnv(env));
}
