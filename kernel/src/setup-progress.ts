// The kernel-owned company setting `setup.progress` (docs/specs/setup-wizard.md AC-6, AC-11, AC-15; ADR-0027 §8): the
// setup wizard's record of steps an administrator confirmed (`completed`) or skipped with a reason. It is an auxiliary
// record only: whether a step is done is decided from real data (GET /meta/setup-status), never from this value. It is
// written through the ordinary PUT /meta/settings/setup.progress (no new write path) by company admins only
// (`writeRoles: ['admin']`, like GET /meta/setup-status); the settings console shows it read-only with a link to /setup
// (`managedBy`).
import { z } from 'zod';
import { label } from './i18n.ts';
import { registry, type SettingDef } from './registry.ts';

export const SETUP_PROGRESS_KEY = 'setup.progress';

/** The wizard's steps in display order. Stable ids: the property names of setup.progress, `?step=` and the tests. */
export const SETUP_STEP_IDS = [
  'company_profile',
  'fiscal_year',
  'chart_of_accounts',
  'tax',
  'invoice_issuer',
  'inventory',
  'industry_template',
  'users',
  'workforce',
] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

const isoDateTime = z.iso.datetime({ offset: true });

/**
 * One step's record: confirmed while done, or skipped with a reason (1-200 characters after trimming). Both are strict,
 * so a `completed` record carrying a reason (or any unknown key) is refused instead of being stored silently.
 */
export const setupStepRecordSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('completed'), at: isoDateTime }),
  z.strictObject({ state: z.literal('skipped'), at: isoDateTime, reason: z.string().trim().min(1).max(200) }),
]);
export type SetupStepRecord = z.output<typeof setupStepRecordSchema>;

const stepShape = Object.fromEntries(SETUP_STEP_IDS.map((id) => [id, setupStepRecordSchema.optional()])) as Record<
  SetupStepId,
  z.ZodOptional<typeof setupStepRecordSchema>
>;

/** Every property optional; unknown top-level keys are dropped on save (zod's default strip). */
export const setupProgressSchema = z.object({ ...stepShape, updatedAt: isoDateTime.optional() });
export type SetupProgress = z.output<typeof setupProgressSchema>;

const STEP_LABELS: Record<SetupStepId, ReturnType<typeof label>> = {
  company_profile: label('会社情報', 'Company profile'),
  fiscal_year: label('会計年度', 'Fiscal year'),
  chart_of_accounts: label('勘定科目の確認', 'Chart of accounts'),
  tax: label('税率と端数処理', 'Tax rates and rounding'),
  invoice_issuer: label('請求書の発行者', 'Invoice issuer'),
  inventory: label('在庫の扱い', 'Inventory'),
  industry_template: label('業界テンプレート', 'Industry template'),
  users: label('利用者', 'Users'),
  workforce: label('勤怠・給与', 'Work and pay'),
};

export const SETUP_PROGRESS_SETTING: SettingDef<SetupProgress> = {
  key: SETUP_PROGRESS_KEY,
  label: label('セットアップの進捗', 'Setup progress'),
  description: label(
    'セットアップ画面で確認した段階とスキップした段階（理由）の記録。完了かどうかは実際のデータで判定し、この記録では決めない',
    'Which setup steps an administrator confirmed or skipped (with the reason). Whether a step is done is decided from the actual data, not from this record',
  ),
  schema: setupProgressSchema,
  category: 'system',
  fields: {
    ...Object.fromEntries(SETUP_STEP_IDS.map((id) => [id, { label: STEP_LABELS[id] }])),
    updatedAt: { label: label('記録の更新時刻', 'Record updated at') },
  },
  managedBy: { href: '/setup', label: label('セットアップ', 'Setup') },
  // The wizard is for company admins (GET /meta/setup-status refuses others); the `settings` role may read the record but
  // not skip steps or remove the admins' skip reasons (setup-wizard decision 5).
  writeRoles: ['admin'],
};

/** Declares `setup.progress` once (idempotent; also after registry.reset in tests). apps/runtime calls it. */
export function ensureSetupProgressSetting(): void {
  if (!registry.hasSetting(SETUP_PROGRESS_KEY)) registry.registerSetting(SETUP_PROGRESS_SETTING);
}

/** The record in raw company settings; unset or invalid reads as no record (`{}`) so status derivation never stops. */
export function setupProgressOf(settings: Readonly<Record<string, unknown>>): SetupProgress {
  const raw = settings[SETUP_PROGRESS_KEY];
  if (raw === undefined) return {};
  const parsed = setupProgressSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}
