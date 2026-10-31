// Country depreciation rules (docs/specs/fixed-assets.md AC-10, AC-23, AC-35; D2, D11). The module owns the contract
// and the override point; a country pack (l10n/jp) registers the dated statutory data. Rates are decimal strings with
// the acquisition-date window they apply to, never constants in code (CLAUDE.md rule 10, ADR-0011).
import {
  Decimal,
  StateError,
  getCompany,
  getSetting,
  isLocalDate,
  registry,
  type Context,
  type LocalDate,
} from '@daifuku/kernel';
import { z } from 'zod';
import { RULES_CONFIRMATION_DEFAULT, RULES_CONFIRMATION_KEY, rulesConfirmationSchema } from './settings.ts';

/** Override point a country pack registers (`() => DepreciationRuleSet | null`). */
export const FIXED_ASSET_RULES_OVERRIDE = 'fixed_assets.depreciation_rules' as const;
export type FixedAssetRulesOverrideKey = typeof FIXED_ASSET_RULES_OVERRIDE;

export const ASSET_CLASSES = [
  'building',
  'building_equipment',
  'structure',
  'machinery',
  'vehicle',
  'tools_furniture',
  'software',
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const DEPRECIATION_METHODS = ['straight_line', 'declining_200'] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export const PROPERTY_TAX_CLASSES = [
  'structure',
  'machinery',
  'vessel',
  'aircraft',
  'vehicle',
  'tools',
  'excluded',
] as const;
export type PropertyTaxClass = (typeof PROPERTY_TAX_CLASSES)[number];

export const ASSET_KINDS = ['tangible', 'intangible'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Intangible assets (software) have no memorandum value in Japan; the kind selects the memorandum row. */
export function assetKindOf(assetClass: AssetClass): AssetKind {
  return assetClass === 'software' ? 'intangible' : 'tangible';
}

const decimalString = z.string().refine((v) => Decimal.isDecimalString(v), 'must be a decimal string');
const localDate = z.string().refine((v) => isLocalDate(v), 'must be YYYY-MM-DD');
const labelSchema = z.object({ ja: z.string().min(1), en: z.string().min(1) });

const rateRowSchema = z.object({
  usefulLife: z.number().int().min(1).max(100),
  rate: decimalString,
  /** 改定償却率 (declining balance only; null when the table has none, e.g. 2 years). */
  revisedRate: decimalString.nullable(),
  /** 保証率 (declining balance only). */
  guaranteeRate: decimalString.nullable(),
});

const rateTableSchema = z.object({
  method: z.enum(DEPRECIATION_METHODS),
  acquiredFrom: localDate,
  acquiredTo: localDate.nullable(),
  /** Where the rows come from (e.g. 耐用年数省令 別表第八). */
  source: z.string().min(1),
  rows: z.array(rateRowSchema).min(1),
});

const memorandumSchema = z.object({
  kind: z.enum(ASSET_KINDS),
  acquiredFrom: localDate,
  acquiredTo: localDate.nullable(),
  amount: decimalString,
  source: z.string().min(1),
});

const methodRestrictionSchema = z.object({
  assetClass: z.enum(ASSET_CLASSES),
  acquiredFrom: localDate,
  acquiredTo: localDate.nullable(),
  methods: z.array(z.enum(DEPRECIATION_METHODS)).min(1),
  source: z.string().min(1),
});

const usefulLifeExampleSchema = z.object({
  label: labelSchema,
  assetClass: z.enum(ASSET_CLASSES),
  usefulLife: z.number().int().min(1).max(100),
  table: z.string().min(1),
});

const propertyTaxSchema = z.object({
  /** 賦課期日 (month/day of the assessment date). */
  assessmentMonth: z.number().int().min(1).max(12),
  assessmentDay: z.number().int().min(1).max(31),
  classes: z
    .array(
      z.object({ code: z.enum(PROPERTY_TAX_CLASSES), number: z.number().int().min(0).max(99), label: labelSchema }),
    )
    .min(1),
  defaultClass: z.object(
    Object.fromEntries(ASSET_CLASSES.map((c) => [c, z.enum(PROPERTY_TAX_CLASSES)])) as Record<
      AssetClass,
      z.ZodEnum<{ [K in PropertyTaxClass]: K }>
    >,
  ),
  source: z.string().min(1),
});

export const depreciationRuleSetSchema = z.object({
  id: z.string().min(1).max(100),
  country: z.string().length(2),
  currency: z.string().length(3),
  /** Date the values were compared with the primary sources; null while unverified (AC-35 then stops postings). */
  verifiedOn: localDate.nullable(),
  sources: z.array(z.url()).min(1),
  memorandum: z.array(memorandumSchema).min(1),
  rateTables: z.array(rateTableSchema).min(1),
  methodRestrictions: z.array(methodRestrictionSchema),
  usefulLifeExamples: z.array(usefulLifeExampleSchema),
  propertyTax: propertyTaxSchema,
});

export type DepreciationRuleSet = z.output<typeof depreciationRuleSetSchema>;
export type DepreciationRulesFn = () => DepreciationRuleSet | null;
export type RateRow = z.output<typeof rateRowSchema>;

/** Decimal form of one useful-life row of a rate table. */
export interface Rate {
  usefulLife: number;
  rate: Decimal;
  revisedRate: Decimal | null;
  guaranteeRate: Decimal | null;
}

export const RULES_HINT =
  'Install the country pack for this company (for Japan, @daifuku/l10n-jp registers fixed_assets.depreciation_rules).';

/** The registered rule set, unchecked against the company (null when no pack registered one). */
export function registeredRules(): unknown {
  return registry.override<() => unknown>(FIXED_ASSET_RULES_OVERRIDE, () => null)();
}

/** Parsed rules or the reason they cannot be used for this company (AC-10). */
export type RulesLookup = { ok: true; rules: DepreciationRuleSet } | { ok: false; reason: string; message: string };

export function checkRules(raw: unknown, company: { country: string; currency: string }): RulesLookup {
  if (raw === null || raw === undefined)
    return { ok: false, reason: 'rules_missing', message: 'no depreciation rule set is registered' };
  const parsed = depreciationRuleSetSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, reason: 'rules_invalid', message: 'the registered depreciation rule set is invalid' };
  if (parsed.data.country !== company.country)
    return {
      ok: false,
      reason: 'rules_country',
      message: `the depreciation rules are for ${parsed.data.country}, the company is in ${company.country}`,
    };
  if (parsed.data.currency !== company.currency)
    return {
      ok: false,
      reason: 'rules_currency',
      message: `the depreciation rules are in ${parsed.data.currency}, the company uses ${company.currency}`,
    };
  return { ok: true, rules: parsed.data };
}

/** AC-10: the company's rules, or INVALID_STATE with the reason and the country-pack hint. */
export async function loadRules(ctx: Context): Promise<DepreciationRuleSet> {
  const company = await getCompany(ctx);
  const found = checkRules(registeredRules(), company);
  if (!found.ok) throw new StateError(found.message, RULES_HINT, { reason: found.reason });
  return found.rules;
}

export interface RulesConfirmationState {
  /** The company's recorded confirmation date for the current rule set, or null. */
  confirmedOn: LocalDate | null;
  /** True when postings may use the rules: verified by the pack, or confirmed by the company (AC-35). */
  usable: boolean;
}

export function confirmationState(
  rules: Pick<DepreciationRuleSet, 'id' | 'verifiedOn'>,
  confirmation: { ruleSetId: string; confirmedOn: string },
): RulesConfirmationState {
  const confirmedOn =
    confirmation.ruleSetId === rules.id && isLocalDate(confirmation.confirmedOn) ? confirmation.confirmedOn : null;
  return { confirmedOn, usable: rules.verifiedOn !== null || confirmedOn !== null };
}

export async function rulesConfirmation(ctx: Context, rules: DepreciationRuleSet): Promise<RulesConfirmationState> {
  const recorded = await getSetting(ctx, RULES_CONFIRMATION_KEY, rulesConfirmationSchema, RULES_CONFIRMATION_DEFAULT);
  return confirmationState(rules, recorded);
}

/**
 * AC-35: what a confirmation covers — every legal parameter a posting uses: the rate tables and the acquisition dates
 * they apply to, the memorandum values and their dates, the method restrictions, and the module's rounding (amounts cut
 * down to the yen; its primary source is open, spec Q6).
 */
export const RULES_UNVERIFIED_HINT =
  'Compare every parameter returned by fixed_assets.depreciation_rules with the primary sources — the rate tables and the acquisition dates they apply to (耐用年数省令 別表第八・第十), the memorandum values and their dates (法人税法施行令 第61条), the method restrictions (施行令 第48条の2) — and accept the rounding (yearly, monthly and disposal amounts cut down to the yen), then record the rule set id and the date in setting fixed_assets.rules_confirmation, or install a country pack whose rules are verified.';

/** AC-35: postings refuse rules that are neither verified by the pack nor confirmed by the company. */
export async function assertRulesUsable(ctx: Context, rules: DepreciationRuleSet): Promise<void> {
  const state = await rulesConfirmation(ctx, rules);
  if (!state.usable)
    throw new StateError(
      `depreciation rule set ${rules.id} is not verified against the primary sources`,
      RULES_UNVERIFIED_HINT,
      { reason: 'rules_unverified', ruleSetId: rules.id },
    );
}

const inWindow = (date: LocalDate, from: LocalDate, to: LocalDate | null): boolean =>
  from <= date && (to === null || date <= to);

/** AC-2 (c): the rate row for a method, useful life and acquisition date, or null when the rules have none. */
export function selectRate(
  rules: Pick<DepreciationRuleSet, 'rateTables'>,
  method: DepreciationMethod,
  usefulLife: number,
  acquisitionDate: LocalDate,
): Rate | null {
  const table = rules.rateTables.find(
    (t) => t.method === method && inWindow(acquisitionDate, t.acquiredFrom, t.acquiredTo),
  );
  const row = table?.rows.find((r) => r.usefulLife === usefulLife);
  if (!row) return null;
  return {
    usefulLife: row.usefulLife,
    rate: Decimal.from(row.rate),
    revisedRate: row.revisedRate === null ? null : Decimal.from(row.revisedRate),
    guaranteeRate: row.guaranteeRate === null ? null : Decimal.from(row.guaranteeRate),
  };
}

/** AC-8: the memorandum value for the asset kind on the acquisition date, or null when the rules have none. */
export function memorandumFor(
  rules: Pick<DepreciationRuleSet, 'memorandum'>,
  assetClass: AssetClass,
  acquisitionDate: LocalDate,
): Decimal | null {
  const kind = assetKindOf(assetClass);
  const row = rules.memorandum.find((m) => m.kind === kind && inWindow(acquisitionDate, m.acquiredFrom, m.acquiredTo));
  return row ? Decimal.from(row.amount) : null;
}

/** AC-2 (d): false when a restriction for the asset class on the acquisition date excludes the method. */
export function methodAllowed(
  rules: Pick<DepreciationRuleSet, 'methodRestrictions'>,
  assetClass: AssetClass,
  method: DepreciationMethod,
  acquisitionDate: LocalDate,
): boolean {
  return rules.methodRestrictions
    .filter((r) => r.assetClass === assetClass && inWindow(acquisitionDate, r.acquiredFrom, r.acquiredTo))
    .every((r) => r.methods.includes(method));
}

/** AC-1: the default property-tax class of an asset class. */
export function defaultPropertyTaxClass(
  rules: Pick<DepreciationRuleSet, 'propertyTax'>,
  assetClass: AssetClass,
): PropertyTaxClass {
  return rules.propertyTax.defaultClass[assetClass];
}
