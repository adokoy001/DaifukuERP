import {
  bootstrapTenant,
  connect,
  runMigrations,
  systemParams,
  withContext,
  type Database,
  type ModuleDef,
} from '@daifuku/kernel';
import { loadRuntime } from '@daifuku/runtime';
import { MIGRATIONS_DIR } from '../db/migrations.ts';
import { backupAndVerify } from './backup.ts';
import { adminPassword, installIdentity, runtimeConfig } from './credentials.ts';
import { privateDirectory, readState, saveState } from './files.ts';
import { buildPlan, inspectTarget, otherConnections } from './inspect.ts';
import { readSecrets } from './options.ts';
import { checkPgTools } from './pg-tools.ts';
import { SetupError, type SetupOptions, type SetupPlan, type SetupState } from './types.ts';

const LOCK_NAME = 'daifuku.setup.v1';
export interface SetupHooks {
  progress?: (phase: string) => void;
  checkpoint?: (phase: string) => Promise<void>;
}
async function checkpoint(options: SetupOptions, state: SetupState, phase: string, hooks: SetupHooks): Promise<void> {
  state.phase = phase;
  await saveState(options.stateDir, state);
  hooks.progress?.(phase);
  await hooks.checkpoint?.(phase);
}
async function bootstrap(
  owner: Database,
  options: SetupOptions,
  state: SetupState,
  password: string,
  modules: readonly ModuleDef[],
  hooks: SetupHooks,
): Promise<void> {
  const identity = state.identity;
  if (!identity) return;
  const boot = await bootstrapTenant(owner, { ...identity, adminPassword: password });
  // A failure after bootstrap commits but before checkpoint must resume the same principal, not replace its password.
  await hooks.checkpoint?.('bootstrap-committed');
  const company =
    await owner.sql`select code, name from companies where id=${boot.companyId} and tenant_id=${identity.tenantId}`;
  if (company[0]?.code !== identity.companyCode || company[0]?.name !== identity.companyName)
    throw new SetupError(
      'BOOTSTRAP_IDENTITY',
      '既存管理者の会社が初回指定と一致しません。設定を更新せず停止しました。',
    );
  Object.assign(identity, { companyId: boot.companyId, userId: boot.userId });
  await checkpoint(options, state, 'bootstrapped', hooks);
  for (const module of modules) {
    if (!module.seed || state.seededModules.includes(module.name)) continue;
    await withContext(owner, systemParams(boot.tenantId, boot.companyId), async (ctx) => module.seed?.(ctx));
    state.seededModules.push(module.name);
    await checkpoint(options, state, `seeded:${module.name}`, hooks);
  }
}
function requirements(options: SetupOptions, plan: SetupPlan): void {
  if (options.confirmTarget !== plan.target.id)
    throw new SetupError('CONFIRM_TARGET', '計画に表示された対象識別子をconfirm-targetで指定してください。');
  if (!options.maintenanceConfirmed)
    throw new SetupError(
      'MAINTENANCE_REQUIRED',
      '全API/MCP/worker・外部書込元を停止し、maintenance-confirmedを指定してください。',
    );
  if (plan.otherConnections)
    throw new SetupError(
      'DATABASE_BUSY',
      '対象DBに他の接続があります。切断・強制終了は行わないので、利用元を停止して再計画してください。',
    );
  if (!plan.noOp && (!plan.restoreTarget || !plan.restoreEmpty))
    throw new SetupError(
      'RESTORE_REQUIRED',
      '変更前に使用する明示の空RESTORE_CHECK_URLが必要です。復元済DBを消去して再利用することはありません。',
    );
}
export async function runSetup(
  options: SetupOptions,
  hooks: SetupHooks = {},
  dir = MIGRATIONS_DIR,
): Promise<SetupPlan> {
  const secrets = await readSecrets(options);
  const plan = await buildPlan(options, dir, secrets);
  if (!options.execute) return plan;
  requirements(options, plan);
  const existing = await readState(options.stateDir);
  if (
    existing &&
    (existing.targetId !== plan.target.id || (existing.phase !== 'complete' && existing.operationMode !== options.mode))
  )
    throw new SetupError('STATE_CHANGED', '計画後にcheckpointの対象またはmodeが変化しました。再計画してください。');
  const identity = options.mode === 'install' ? installIdentity(options, existing) : existing?.identity;
  const owner = connect(secrets.ownerUrl, { max: 1 });
  try {
    if ((await inspectTarget(owner, secrets.ownerUrl)).id !== plan.target.id)
      throw new SetupError('TARGET_CHANGED', '実行接続先が計画したDBと一致しません。再計画してください。');
    const lock = await owner.sql`select pg_try_advisory_lock(hashtextextended(${LOCK_NAME},0)) as acquired`;
    if (!lock[0]?.acquired) throw new SetupError('SETUP_BUSY', 'このDBで別のセットアップが実行中です。');
    if (await otherConnections(owner))
      throw new SetupError('DATABASE_BUSY', '計画後に他の接続が開始されました。利用元を停止して再実行してください。');
    await privateDirectory(options.stateDir);
    const state: SetupState = existing ?? {
      format: 1,
      operationMode: options.mode,
      targetId: plan.target.id,
      ...(identity ? { identity } : {}),
      phase: 'planned',
      seededModules: [],
      backups: [],
    };
    await runtimeConfig(options, secrets, state);
    if (plan.noOp) {
      hooks.progress?.('already-complete');
      return plan;
    }
    state.operationMode = options.mode;
    await saveState(options.stateDir, state);
    const password = options.mode === 'install' ? await adminPassword(options) : '';
    await checkPgTools(plan.target.postgres);
    hooks.progress?.('backup-and-restore-verification');
    state.backups.push(await backupAndVerify(owner, secrets, plan.target, plan.backupDirectory));
    await checkpoint(options, state, 'backup-verified', hooks);
    if (await otherConnections(owner))
      throw new SetupError('DATABASE_BUSY', 'バックアップ中に他の接続が開始されました。対象の移行は開始していません。');
    await owner.sql`set lock_timeout='5s'`;
    await runMigrations(owner, dir);
    await checkpoint(options, state, 'migrated', hooks);
    if (options.mode === 'install') {
      const runtime = await loadRuntime({ schema: true });
      await bootstrap(owner, options, state, password, runtime.modules, hooks);
    }
    state.completedHash = plan.migrationHash;
    await checkpoint(options, state, 'complete', hooks);
    return plan;
  } finally {
    await owner.close();
  }
}
