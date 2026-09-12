// applyPack (ADR-0015): applies a registered pack to the context's company — setting defaults (only keys the company has
// not set), the idempotent seed, optionally the sample data — and records it in the company setting `packs.applied`.
// Runs in the caller's transaction (request / CLI withContext), so a failing seed rolls everything back.
import { z } from 'zod';
import { isAdmin, type Context } from './context.ts';
import { DaifukuError, PermissionDenied, ValidationError, type ValidationIssue } from './errors.ts';
import { label } from './i18n.ts';
import type { PackDef } from './dsl/defs.ts';
import { registry, type SettingDef } from './registry.ts';
import { findCompany, getCompany, setSetting } from './settings.ts';
import { packApplicationContext, refreshPackScope } from './pack-scope.ts';
import { withLock } from './transactions.ts';

export const PACKS_APPLIED_KEY = 'packs.applied';

export const appliedPackSchema = z.object({
  /** ISO time settings/seed were (last) applied. */
  at: z.string(),
  /** Pack version at that time. */
  version: z.string(),
  /** ISO time the sample data ran, when it did. */
  sampledAt: z.string().optional(),
});
export const appliedPacksSchema = z.record(z.string(), appliedPackSchema);
export type AppliedPack = z.output<typeof appliedPackSchema>;
export type AppliedPacks = z.output<typeof appliedPacksSchema>;

const PACKS_APPLIED_SETTING: SettingDef<AppliedPacks> = {
  key: PACKS_APPLIED_KEY,
  label: label('適用済みパック', 'Applied packs'),
  description: label('pack:apply が記録する（パック名 → 適用日時・バージョン）。エントリを消すと次の適用で設定と seed が再実行される', 'Written by pack:apply (pack name -> applied at, version). Removing an entry makes the next apply run settings and seed again'),
  schema: appliedPacksSchema,
};

/** Declares `packs.applied` once (idempotent; also after registry.reset in tests). */
export function ensurePackSettings(): void {
  if (!registry.hasSetting(PACKS_APPLIED_KEY)) registry.registerSetting(PACKS_APPLIED_SETTING);
}

/** `packs.applied` from raw company settings; an invalid stored value reads as nothing applied. */
export function appliedPacksOf(settings: Readonly<Record<string, unknown>>): AppliedPacks {
  const parsed = appliedPacksSchema.safeParse(settings[PACKS_APPLIED_KEY] ?? {});
  return parsed.success ? parsed.data : {};
}

/** Applied packs of the context's company ({} when the context has no company). */
export async function readAppliedPacks(ctx: Context): Promise<AppliedPacks> {
  const company = await findCompany(ctx);
  return company ? appliedPacksOf(company.settings) : {};
}

export interface ApplyPackOptions {
  /** Also run the pack's sample data (once per company unless `force`). */
  sample?: boolean;
  /** Re-run settings (overwriting company values), seed and sample even when already applied. */
  force?: boolean;
}

export interface ApplyPackResult {
  name: string;
  version: string;
  /** The pack was already recorded for this company before this call. */
  alreadyApplied: boolean;
  /** Setting keys written / left alone because the company already had a value (or the pack was already applied). */
  settings: { written: string[]; kept: string[] };
  seeded: boolean;
  sampled: boolean;
  /** The company's `packs.applied` entry after the call. */
  record: AppliedPack;
}

function packNotFound(name: string): DaifukuError {
  const known = registry.packs().map((p) => p.name);
  return new DaifukuError('NOT_FOUND', `pack "${name}" is not registered`, `Known packs: ${known.join(', ') || '(none)'}. List them with the pack.list action; apps load packs in their packs.ts.`, { pack: name, known }, 404);
}

/** Every default must be a registered setting whose schema accepts the value; checked before anything is written. */
function checkedSettings(pack: PackDef): { def: SettingDef; value: unknown }[] {
  const issues: ValidationIssue[] = [];
  const out: { def: SettingDef; value: unknown }[] = [];
  for (const [key, value] of Object.entries(pack.settings ?? {})) {
    if (!registry.hasSetting(key)) {
      issues.push({ path: `settings.${key}`, message: 'not a registered setting' });
      continue;
    }
    const def = registry.setting(key);
    const parsed = def.schema.safeParse(value);
    if (parsed.success) out.push({ def, value });
    else for (const i of parsed.error.issues) issues.push({ path: ['settings', key, ...i.path.map(String)].join('.'), message: i.message });
  }
  if (issues.length > 0) {
    throw new ValidationError(`pack "${pack.name}": invalid setting defaults`, issues, 'Pack setting keys must be declared with registry.registerSetting (by a module in depends or the pack hooks) and match their schema.');
  }
  return out;
}

async function applySettings(ctx: Context, pack: PackDef, stored: Readonly<Record<string, unknown>>, force: boolean): Promise<ApplyPackResult['settings']> {
  const result: ApplyPackResult['settings'] = { written: [], kept: [] };
  for (const { def, value } of checkedSettings(pack)) {
    // A value alone cannot tell whether the admin explicitly selected the module default. Preserve all stored values.
    if (!force && stored[def.key] !== undefined) {
      result.kept.push(def.key);
      continue;
    }
    await setSetting(ctx, def.key, def.schema, value);
    result.written.push(def.key);
  }
  return result;
}

/**
 * Applies pack `name` to the context's company (admin only). First apply: setting defaults for unset keys, seed, sample
 * when asked, then `packs.applied[name] = { at, version }`. Later applies skip settings and seed (no writes) unless
 * `force`; `sample` still runs once if it never ran for the company.
 */
export async function applyPack(ctx: Context, name: string, opts: ApplyPackOptions = {}): Promise<ApplyPackResult> {
  return withLock(ctx, 'packs.apply', () => performApplyPack(ctx, name, opts));
}

async function performApplyPack(ctx: Context, name: string, opts: ApplyPackOptions): Promise<ApplyPackResult> {
  if (!isAdmin(ctx) || (ctx.accessScope && ctx.accessScope !== 'all')) throw new PermissionDenied(`pack:${name}`, 'apply', ctx.roles);
  const pack = registry.pack(name);
  if (!pack) throw packNotFound(name);
  ensurePackSettings();
  const force = opts.force === true;
  const company = await getCompany(ctx);
  const applied = appliedPacksOf(company.settings);
  refreshPackScope(ctx, Object.keys(applied));
  const previous = applied[name];
  const now = ctx.now().toISOString();
  const runBase = force || !previous;
  const settings = runBase ? await applySettings(ctx, pack, company.settings, force) : { written: [], kept: Object.keys(pack.settings ?? {}) };
  const applying = packApplicationContext(ctx, name);
  if (runBase) await pack.seed?.(applying);
  const runSample = opts.sample === true && pack.sample !== undefined && (force || previous?.sampledAt === undefined);
  if (runSample) await pack.sample?.(applying);
  const base = runBase || !previous ? { at: now, version: pack.version } : { at: previous.at, version: previous.version };
  const sampledAt = runSample ? now : previous?.sampledAt;
  const record: AppliedPack = sampledAt === undefined ? base : { ...base, sampledAt };
  if (runBase || runSample) {
    const def = registry.setting(PACKS_APPLIED_KEY);
    await setSetting(ctx, PACKS_APPLIED_KEY, def.schema, { ...appliedPacksOf((await getCompany(ctx)).settings), [name]: record });
  }
  refreshPackScope(ctx, [...new Set([...Object.keys(applied), name])]);
  return { name, version: pack.version, alreadyApplied: previous !== undefined, settings, seeded: runBase && pack.seed !== undefined, sampled: runSample, record };
}
