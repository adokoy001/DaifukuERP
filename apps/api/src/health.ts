// Platform items of the setup health report (docs/specs/setup-health.md AC-6): whether mail delivery and SSO are
// configured (booleans only), how many migrations are pending (counts only, read like the readiness probe) and whether
// the attachment storage is writable. These live in the API because only the API holds this configuration; module
// items come from the kernel registry. Never put a host, URL, secret, connection string or file path in an outcome.
import { constants } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { label, type Database, type HealthCheckDef } from '@daifuku/kernel';
import { expectedMigrations, DEFAULT_MIGRATIONS_DIRECTORY } from './deployment/readiness.ts';
import type { IdentityOptions } from './identity/config.ts';

export interface PlatformHealthOptions {
  /** Owner connection: reads drizzle.__drizzle_migrations, as the readiness probe does. */
  owner: Database;
  identity?: IdentityOptions;
  /** DAIFUKU_STORAGE_DIR of the running API; unset means "not configured". */
  storageDirectory?: string;
  migrationsDirectory?: string;
}

/** Counts only: applied rows that match the release catalog in order, pending ones, and applied rows it does not know. */
export function migrationCounts(
  catalog: readonly { hash: string; when: string }[],
  applied: readonly { hash: string; created_at: string }[],
): { expected: number; applied: number; pending: number; unknown: number } {
  let matched = 0;
  while (
    matched < catalog.length &&
    matched < applied.length &&
    applied[matched]?.hash === catalog[matched]?.hash &&
    applied[matched]?.created_at === catalog[matched]?.when
  )
    matched++;
  return {
    expected: catalog.length,
    applied: applied.length,
    pending: catalog.length - matched,
    unknown: applied.length - matched,
  };
}

/** Writable storage: exists, is a directory and the API may write to it; a missing directory is created on first use. */
export async function storageState(directory: string): Promise<'writable' | 'missing' | 'not-writable'> {
  const path = resolve(directory);
  try {
    const info = await lstat(path);
    if (!info.isDirectory()) return 'not-writable';
    await access(path, constants.W_OK | constants.X_OK);
    return 'writable';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'not-writable';
    try {
      await access(dirname(path), constants.W_OK | constants.X_OK);
      return 'missing';
    } catch {
      return 'not-writable';
    }
  }
}

export function platformHealthChecks(opts: PlatformHealthOptions): HealthCheckDef[] {
  const identity = opts.identity;
  return [
    {
      id: 'system.mail',
      label: label('メール配送（SMTP）', 'Mail delivery (SMTP)'),
      order: 60,
      run: async () =>
        identity?.mailTransport
          ? { status: 'ok', detail: label('設定済みです。', 'Configured.') }
          : {
              status: 'warn',
              detail: label(
                '未設定です。招待メールとメールによるパスワード再設定は使えません（運用者が SMTP を設定します）。',
                'Not configured. Invitation mail and password reset by mail are unavailable (the operator configures SMTP).',
              ),
            },
    },
    {
      id: 'system.oidc',
      label: label('シングルサインオン（OIDC）', 'Single sign-on (OIDC)'),
      order: 61,
      run: async (ctx) =>
        identity?.providers.some((provider) => provider.tenantId === ctx.tenantId)
          ? { status: 'ok', detail: label('この組織に設定済みです。', 'Configured for this organization.') }
          : {
              status: 'ok',
              detail: label(
                '未設定です（メールアドレスとパスワードでログインします）。',
                'Not configured (users sign in with email and password).',
              ),
            },
    },
    {
      id: 'system.migrations',
      label: label('データベースの更新', 'Database migrations'),
      order: 70,
      run: async () => {
        const catalog = await expectedMigrations(opts.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY);
        const [table] = await opts.owner.sql<
          { name: string | null }[]
        >`select to_regclass('drizzle.__drizzle_migrations')::text as name`;
        if (!table?.name)
          return {
            status: 'warn',
            detail: label(
              'データベースに更新の適用記録がありません（setup で作成していない DB）。',
              'The database has no migration record (it was not created by setup).',
            ),
          };
        const applied = await opts.owner.sql<
          { hash: string; created_at: string }[]
        >`select hash, created_at::text from drizzle.__drizzle_migrations order by created_at, id`;
        const counts = migrationCounts(catalog, applied);
        if (counts.pending > 0 || counts.unknown > 0)
          return {
            status: 'fail',
            detail: label(
              `未適用の更新 ${counts.pending} 件、版に無い適用記録 ${counts.unknown} 件があります（全 ${counts.expected} 件）。運用者に pnpm run setup upgrade を依頼してください。`,
              `${counts.pending} pending and ${counts.unknown} unknown migrations (of ${counts.expected}). Ask the operator to run pnpm run setup upgrade.`,
            ),
          };
        return {
          status: 'ok',
          detail: label(`${counts.expected} 件すべて適用済みです。`, `All ${counts.expected} migrations are applied.`),
        };
      },
    },
    {
      id: 'system.storage',
      label: label('添付の保存先', 'Attachment storage'),
      order: 80,
      run: async () => {
        if (!opts.storageDirectory)
          return {
            status: 'warn',
            detail: label('保存先が設定されていません。', 'No storage location is configured.'),
          };
        const state = await storageState(opts.storageDirectory);
        if (state === 'writable') return { status: 'ok', detail: label('書き込めます。', 'Writable.') };
        if (state === 'missing')
          return {
            status: 'ok',
            detail: label(
              'まだ作成されていません（最初の添付で作成されます）。',
              'Not created yet (it is created with the first attachment).',
            ),
          };
        return {
          status: 'fail',
          detail: label(
            '書き込めません。添付を保存できないので、運用者に保存先の権限を確認してもらってください。',
            'Not writable. Attachments cannot be saved; ask the operator to check the storage permissions.',
          ),
        };
      },
    },
  ];
}
