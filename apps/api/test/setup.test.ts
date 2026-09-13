import { chmod, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { checkHistory } from '../src/setup/catalog.ts';
import { identityInput, runtimeConfig, serializeEnv, validatePassword } from '../src/setup/credentials.ts';
import { privateFile, writeExclusive } from '../src/setup/files.ts';
import { connection, parseOptions, readSecrets } from '../src/setup/options.ts';
import { safeFailure, SetupError, type SetupOptions } from '../src/setup/types.ts';

const args = ['install', '--env', '/private/input.env', '--state-dir', '/private/operations'];
const validUrl = 'postgres://owner:Strong-DatabaseSecret9!@127.0.0.1:5432/erp';
const appUrl = validUrl.replace('owner:', 'daifuku_app:').replace('Strong-DatabaseSecret9!', 'Different-AppSecret9!');
describe('safe-setup validation', () => {
  it('AC-1 defaults to read-only plan and rejects reset/unknown arguments', () => {
    expect(parseOptions(args).execute).toBe(false);
    expect(() => parseOptions(['reset', ...args.slice(1)])).toThrow();
    expect(() => parseOptions([...args, '--password', 'NeverUseArgumentSecrets9!'])).toThrow();
  });
  it('AC-2 requires localhost unless explicitly selected and refuses demo database credentials', () => {
    expect(connection(validUrl, false).hostname).toBe('127.0.0.1');
    expect(() => connection(validUrl.replace('127.0.0.1', 'db.example.test'), false)).toThrowError(SetupError);
    expect(() => connection(validUrl.replace('Strong-DatabaseSecret9!', 'owner'), false)).toThrowError(SetupError);
    expect(() => connection(`${validUrl}?host=other`, false)).toThrowError(SetupError);
    expect(() => connection(validUrl.replace('127.0.0.1', 'db.example.test'), true)).toThrowError(SetupError);
    expect(connection(`${validUrl.replace('127.0.0.1', 'db.example.test')}?sslmode=verify-full`, true).hostname).toBe(
      'db.example.test',
    );
  });
  it('AC-3 rejects edited, reordered and future migration histories', () => {
    const files = [
      { idx: 0, tag: '0000_init', when: 100, hash: 'a' },
      { idx: 1, tag: '0001_next', when: 200, hash: 'b' },
    ];
    expect(() => checkHistory([{ hash: 'a', created_at: '100' }], files)).not.toThrow();
    for (const rows of [
      [{ hash: 'edited', created_at: '100' }],
      [{ hash: 'b', created_at: '200' }],
      [{ hash: 'a', created_at: '999' }],
    ])
      expect(() => checkHistory(rows, files)).toThrowError(SetupError);
    expect(() => checkHistory([{ hash: 'a', created_at: '100' }], [])).toThrowError(SetupError);
  });
  it('AC-5 requires an explicit production identity and strong admin password', () => {
    expect(() => identityInput(parseOptions(args))).toThrowError(SetupError);
    expect(() => validatePassword('password')).toThrowError(SetupError);
    expect(() => validatePassword('aaaaaaaaaaaaaaaaaaaa')).toThrowError(SetupError);
    expect(() => validatePassword('Correct-HorseSetup9!')).not.toThrow();
    const options: SetupOptions = {
      ...parseOptions(args),
      tenantName: '会社',
      companyCode: 'CO',
      companyName: '会社',
      adminEmail: 'admin@example.com',
      adminName: '管理者',
    };
    expect(() => identityInput(options)).toThrowError(SetupError);
  });
  it('AC-5/6 refuses public secret files, symlinks, and overwriting existing configuration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'daifuku-setup-unit-'));
    const path = join(dir, 'private');
    await writeExclusive(path, 'private-value');
    await expect(writeExclusive(path, 'replacement')).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('private-value');
    await symlink(path, join(dir, 'alias'));
    await expect(privateFile(join(dir, 'alias'))).rejects.toThrow();
    await chmod(path, 0o644);
    await expect(privateFile(path)).rejects.toThrowError(SetupError);
  });
  it('AC-5/6 keeps source env unchanged, rejects weak JWT and mismatched target URLs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'daifuku-setup-env-'));
    const path = join(dir, 'input.env');
    const body = `DATABASE_URL_OWNER=${validUrl}\nDATABASE_URL=${appUrl}\n`;
    await writeFile(path, body, { mode: 0o600 });
    const options = { ...parseOptions(args), envFile: path };
    expect((await readSecrets(options)).ownerUrl).toBe(validUrl);
    expect(await readFile(path, 'utf8')).toBe(body);
    await writeFile(path, `${body}JWT_SECRET=dev-secret-change-me\n`);
    await expect(readSecrets(options)).rejects.toThrowError(SetupError);
    await writeFile(path, body.replace('Different-AppSecret9!', 'Strong-DatabaseSecret9!'));
    await expect(readSecrets(options)).rejects.toMatchObject({ code: 'SHARED_DB_SECRET' });
    await writeFile(path, body.replace('/erp\n', '/other\n'));
    await expect(readSecrets(options)).rejects.toThrowError(SetupError);
  });
  it('AC-7 never emits raw connection/password errors', () => {
    const secret = 'Bearer-Private-Credential9!';
    expect(safeFailure(new Error(`${validUrl} ${secret}`))).not.toContain(secret);
    expect(safeFailure({ code: 'ECONNREFUSED', message: validUrl })).not.toContain(validUrl);
    expect(safeFailure(new SetupError('MAINTENANCE_REQUIRED', '停止を確認してください'))).toContain(
      'MAINTENANCE_REQUIRED',
    );
  });
  it('AC-5 preserves quotes, hash and literal backslashes through Node env encoding', () => {
    for (const secret of [
      'Abcd1234-Strong"SecretWithQuotes9!',
      "Abcd1234-Strong'SecretWithQuotes9!",
      'Abcd1234-Strong\\nSecret#Hash9!',
      'Abcd1234-Strong`Secret9!',
    ]) {
      expect(parseEnv(serializeEnv({ JWT_SECRET: secret })).JWT_SECRET).toBe(secret);
    }
  });
  it('AC-6 refuses an incomplete runtime env without replacing or regenerating its secret', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'daifuku-setup-incomplete-'));
    const body = `DATABASE_URL_OWNER=${validUrl}\nDATABASE_URL=${appUrl}\n`;
    const path = join(dir, 'runtime.env');
    await writeExclusive(path, body);
    const options = {
      ...parseOptions(args),
      stateDir: dir,
      tenantName: 'Tenant',
      companyCode: 'CO',
      companyName: 'Company',
      adminName: 'Admin',
      adminEmail: 'a@example.test',
    };
    await expect(
      runtimeConfig(
        options,
        { ownerUrl: validUrl, appUrl },
        {
          format: 1,
          operationMode: 'install',
          targetId: 'test',
          identity: { tenantId: 'test', ...identityInput(options) },
          phase: 'planned',
          seededModules: [],
          backups: [],
        },
      ),
    ).rejects.toMatchObject({ code: 'RUNTIME_CONFIG_INVALID' });
    expect(await privateFile(path)).toBe(body);
  });
});
