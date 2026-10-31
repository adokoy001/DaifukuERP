// GET /meta/setup-status (docs/specs/setup-wizard.md AC-5, AC-13..AC-16; ADR-0027 §8): the nine steps of the setup
// wizard and whether each is done, decided from real data — the stable setup-health items (B3) plus a few simple
// conditions computed here (`setup.*`). `setup.progress` only adds the administrator's confirmations and skips. The
// step list lives in the API because it spans several modules' check ids and entities (the kernel knows no module,
// ADR-0013). Everything runs with the caller's Context (admin, company-wide) inside a read-only transaction.
import {
  activeCompanyMemberCount,
  appliedPacksOf,
  DaifukuError,
  getCompany,
  isAdmin,
  label,
  NotFound,
  PermissionDenied,
  registry,
  repo,
  runHealthChecks,
  safeErrorDiagnostics,
  setupProgressOf,
  withSavepoint,
  type Context,
  type HealthStatus,
  type Label,
  type SetupProgress,
  type SetupStepId,
} from '@daifuku/kernel';

export type SetupStepStatus = 'done' | 'todo' | 'skipped';

/** One condition a step is judged by: a setup-health item, or a `setup.*` condition of the same shape. */
export interface SetupCheck {
  id: string;
  status: HealthStatus;
  label: Label;
  detail: Label;
  href?: string;
}

export interface SetupStep {
  id: SetupStepId;
  order: number;
  label: Label;
  optional: boolean;
  status: SetupStepStatus;
  /** The skip record's reason and time, whenever one exists (also on a step that is done by now). */
  reason?: string;
  skippedAt?: string;
  /** When an administrator confirmed the step ("confirm and next"); the status never depends on it. */
  completedAt?: string;
  /** Confirmed earlier but its conditions no longer hold. */
  regressed: boolean;
  checks: SetupCheck[];
}

export interface SetupSummary {
  /** Counts of the required (non-optional) steps. */
  required: number;
  done: number;
  skipped: number;
  remaining: number;
  /** The first required step still `todo`, or null. */
  nextStep: SetupStepId | null;
  /** Steps (optional ones too, skipped or not) with a `fail` check: documents cannot be submitted. */
  attention: SetupStepId[];
}

export interface SetupStatus {
  checkedAt: string;
  steps: SetupStep[];
  summary: SetupSummary;
  /** The stored setup.progress as its schema reads it ({} when invalid); the wizard merges its change into this. */
  progress: SetupProgress;
}

interface SetupStepDef {
  id: SetupStepId;
  label: Label;
  optional: boolean;
  /** Ids of the checks that must all be `ok`. */
  checks: readonly string[];
}

/** The steps in display order (AC-1). Check ids are B3's stable health ids or this file's `setup.*` conditions. */
export const SETUP_STEPS: readonly SetupStepDef[] = [
  {
    id: 'company_profile',
    label: label('会社情報', 'Company profile'),
    optional: false,
    checks: ['company.profile'],
  },
  {
    id: 'fiscal_year',
    label: label('会計年度', 'Fiscal year'),
    optional: false,
    checks: ['accounting.fiscal_period'],
  },
  {
    id: 'chart_of_accounts',
    label: label('勘定科目の確認', 'Chart of accounts'),
    optional: false,
    checks: ['setup.chart_of_accounts'],
  },
  {
    id: 'tax',
    label: label('税率と端数処理', 'Tax rates and rounding'),
    optional: false,
    checks: ['tax.standard_rate'],
  },
  {
    id: 'invoice_issuer',
    label: label('請求書の発行者', 'Invoice issuer'),
    optional: false,
    checks: ['sales.issuer'],
  },
  { id: 'inventory', label: label('在庫の扱い', 'Inventory'), optional: false, checks: ['inventory.stock_settings'] },
  {
    id: 'industry_template',
    label: label('業界テンプレート', 'Industry template'),
    optional: false,
    checks: ['setup.industry_template'],
  },
  { id: 'users', label: label('利用者', 'Users'), optional: false, checks: ['setup.users'] },
  { id: 'workforce', label: label('勤怠・給与', 'Work and pay'), optional: true, checks: ['setup.workforce_policy'] },
];

/** Labels of every check a step uses, for an item that is missing from the results (AC-16). */
const CHECK_LABELS: Readonly<Record<string, Label>> = {
  'company.profile': label('会社プロフィール', 'Company profile'),
  'accounting.fiscal_period': label('今日を含む会計期間', 'Fiscal period for today'),
  'tax.standard_rate': label('標準税率', 'Standard tax rate'),
  'sales.issuer': label('請求書の発行者', 'Invoice issuer'),
  'inventory.stock_settings': label('在庫の設定', 'Inventory settings'),
  'setup.chart_of_accounts': label('勘定科目と消費税の科目', 'Accounts and consumption tax accounts'),
  'setup.industry_template': label('業界テンプレートの適用', 'Industry template applied'),
  'setup.users': label('この会社の利用者', 'Users of this company'),
  'setup.workforce_policy': label('勤怠・給与の制度', 'Work and pay policy'),
};

const NOT_CHECKED = label(
  '点検できませんでした。時間をおいて再点検してください。',
  'This item could not be checked. Try again later.',
);

function missingCheck(id: string): SetupCheck {
  return { id, status: 'warn', label: CHECK_LABELS[id] ?? label(id, id), detail: NOT_CHECKED };
}

/**
 * Pure derivation (AC-5, AC-15, AC-16): a step is `done` when every check is `ok`; otherwise `skipped` when the record
 * says so, else `todo`. A missing check counts as not met. `omit` drops steps this runtime cannot judge (step 9 without
 * the workforce module); their records stay in `progress`.
 */
export function deriveSetupStatus(input: {
  checkedAt: string;
  items: readonly SetupCheck[];
  progress: SetupProgress;
  omit?: readonly SetupStepId[];
}): SetupStatus {
  const byId = new Map(input.items.map((item) => [item.id, item]));
  const steps: SetupStep[] = [];
  SETUP_STEPS.forEach((def, index) => {
    if (input.omit?.includes(def.id)) return;
    const checks = def.checks.map((id) => byId.get(id) ?? missingCheck(id));
    const met = checks.every((check) => check.status === 'ok');
    const record = input.progress[def.id];
    const step: SetupStep = {
      id: def.id,
      order: index + 1,
      label: def.label,
      optional: def.optional,
      status: met ? 'done' : record?.state === 'skipped' ? 'skipped' : 'todo',
      regressed: record?.state === 'completed' && !met,
      checks,
    };
    if (record?.state === 'skipped') {
      step.reason = record.reason;
      step.skippedAt = record.at;
    }
    if (record?.state === 'completed') step.completedAt = record.at;
    steps.push(step);
  });
  const required = steps.filter((step) => !step.optional);
  return {
    checkedAt: input.checkedAt,
    steps,
    summary: {
      required: required.length,
      done: required.filter((step) => step.status === 'done').length,
      skipped: required.filter((step) => step.status === 'skipped').length,
      remaining: required.filter((step) => step.status === 'todo').length,
      nextStep: required.find((step) => step.status === 'todo')?.id ?? null,
      attention: steps.filter((step) => step.checks.some((check) => check.status === 'fail')).map((step) => step.id),
    },
    progress: input.progress,
  };
}

type Condition = Omit<SetupCheck, 'id' | 'label'>;

async function chartOfAccounts(ctx: Context): Promise<Condition> {
  const accounts = repo(ctx, registry.entity('account'));
  const active = await accounts.count({ isActive: true });
  const output = await accounts.count({ isActive: true, taxRole: 'output_tax' });
  const input = await accounts.count({ isActive: true, taxRole: 'input_tax' });
  const href = '/e/account';
  if (active === 0)
    return {
      status: 'warn',
      detail: label('有効な勘定科目がありません。', 'There are no active accounts.'),
      href,
    };
  if (output === 0 || input === 0)
    return {
      status: 'warn',
      detail: label(
        `仮受消費税（output_tax）と仮払消費税（input_tax）の役割を持つ有効な科目がそれぞれ要ります（仮受 ${output} 件、仮払 ${input} 件）。`,
        `Active accounts with the output tax and input tax roles are both needed (output ${output}, input ${input}).`,
      ),
      href,
    };
  return {
    status: 'ok',
    detail: label(
      `有効な勘定科目 ${active} 件（仮受消費税 ${output} 件、仮払消費税 ${input} 件）`,
      `${active} active accounts (output tax ${output}, input tax ${input})`,
    ),
    href,
  };
}

/** `example` is the extension sample, not one of the industries (docs/domain/industry-catalog.md). */
export const NON_INDUSTRY_PACKS: readonly string[] = ['example'];

async function industryTemplate(ctx: Context): Promise<Condition> {
  const applied = Object.keys(appliedPacksOf((await getCompany(ctx)).settings))
    .filter((name) => !NON_INDUSTRY_PACKS.includes(name))
    .sort();
  if (applied.length === 0)
    return {
      status: 'warn',
      detail: label(
        '業界テンプレートが適用されていません（見本の example は数えません）。使わない場合はスキップしてください。',
        'No industry template is applied (the example template does not count). Skip this step if you use none.',
      ),
      href: '/templates',
    };
  return {
    status: 'ok',
    detail: label(`適用済み: ${applied.join(', ')}`, `Applied: ${applied.join(', ')}`),
    href: '/templates',
  };
}

async function companyUsers(ctx: Context): Promise<Condition> {
  const members = await activeCompanyMemberCount(ctx);
  if (members < 2)
    return {
      status: 'warn',
      detail: label(
        `この会社の有効な利用者は ${members} 人です（2 人以上で完了。1 人で使う場合はスキップしてください）。`,
        `This company has ${members} active user(s) (2 or more completes this step; skip it if you work alone).`,
      ),
      href: '/admin/users',
    };
  return {
    status: 'ok',
    detail: label(`この会社の有効な利用者: ${members} 人`, `Active users of this company: ${members}`),
    href: '/admin/users',
  };
}

const WORKFORCE_POLICY_ENTITY = 'workforce_pay_policy';

async function workforcePolicy(ctx: Context): Promise<Condition> {
  const policies = await repo(ctx, registry.entity(WORKFORCE_POLICY_ENTITY)).count();
  if (policies === 0)
    return {
      status: 'warn',
      detail: label(
        '勤怠・給与の制度がありません（任意の段階です）。',
        'There is no work and pay policy (optional step).',
      ),
      href: '/workforce',
    };
  return {
    status: 'ok',
    detail: label(`勤怠・給与の制度: ${policies} 件`, `Work and pay policies: ${policies}`),
    href: '/workforce',
  };
}

/** The `setup.*` conditions; each runs only when its entity is registered in this runtime. */
const CONDITIONS: readonly { id: string; entity?: string; run: (ctx: Context) => Promise<Condition> }[] = [
  { id: 'setup.chart_of_accounts', entity: 'account', run: chartOfAccounts },
  { id: 'setup.industry_template', run: industryTemplate },
  { id: 'setup.users', run: companyUsers },
  { id: 'setup.workforce_policy', entity: WORKFORCE_POLICY_ENTITY, run: workforcePolicy },
];

/**
 * Runs one condition in a savepoint (AC-16). A failure becomes "could not be checked"; the log gets the check id and
 * request id with the code, and for a non-Daifuku error only safeErrorDiagnostics (never its message), like setup-health.
 */
async function runCondition(ctx: Context, condition: (typeof CONDITIONS)[number]): Promise<SetupCheck> {
  const checkLabel = CHECK_LABELS[condition.id] ?? label(condition.id, condition.id);
  try {
    const outcome = await withSavepoint(ctx, (inner) => condition.run(inner));
    return { id: condition.id, label: checkLabel, ...outcome };
  } catch (error) {
    ctx.log.warn('setup condition failed', {
      id: condition.id,
      requestId: ctx.requestId,
      ...(error instanceof DaifukuError
        ? { code: error.code, message: error.message }
        : { code: 'INTERNAL', ...safeErrorDiagnostics(error) }),
    });
    return { id: condition.id, status: 'warn', label: checkLabel, detail: NOT_CHECKED };
  }
}

/** Admin of the company with company-wide access (AC-8); a store/site-limited admin membership is refused. */
export function assertSetupAccess(ctx: Context): void {
  if (!isAdmin(ctx) || (ctx.accessScope && ctx.accessScope !== 'all'))
    throw new PermissionDenied('setup_status', 'read', ctx.roles);
}

/** Collects every check with the caller's Context: the kernel/module health items (no platform `extra`) and `setup.*`. */
export async function collectSetupFacts(
  ctx: Context,
): Promise<{ checkedAt: string; items: SetupCheck[]; progress: SetupProgress; omit: SetupStepId[] }> {
  const health = await runHealthChecks(ctx);
  const items: SetupCheck[] = [...health.items];
  for (const condition of CONDITIONS)
    if (!condition.entity || registry.hasEntity(condition.entity)) items.push(await runCondition(ctx, condition));
  const progress = setupProgressOf((await getCompany(ctx)).settings);
  const omit: SetupStepId[] = registry.hasEntity(WORKFORCE_POLICY_ENTITY) ? [] : ['workforce'];
  return { checkedAt: health.checkedAt, items, progress, omit };
}

/** GET /meta/setup-status for the context's company (AC-5, AC-13): admin only, a company must be selected. */
export async function setupStatus(ctx: Context): Promise<SetupStatus> {
  assertSetupAccess(ctx);
  if (!ctx.companyId) throw new NotFound('company', 'null');
  return deriveSetupStatus(await collectSetupFacts(ctx));
}
