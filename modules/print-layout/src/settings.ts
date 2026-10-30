// Company setting `print_layout.date_style` and the era override (docs/specs/print-templates.md AC-8, D-2, D-4).
// print-layout is a library without defineModule: the modules that print call ensurePrintLayoutSettings() from their
// hooks (idempotent, like kernel's ensureCompanyProfileSetting), so the setting exists whenever one of them is loaded.
import { getSetting, label, registry, type Context, type Label, type Locale, type SettingDef } from '@daifuku/kernel';
import { z } from 'zod';
import { DATE_STYLES, formatDocumentDate, type DateStyle, type EraDateFn } from './format.ts';

export const PRINT_DATE_STYLE_KEY = 'print_layout.date_style';
export const printDateStyleSchema = z.enum(DATE_STYLES);
/** Same as the l10n/jp invoice today (western with the era in brackets). */
export const PRINT_DATE_STYLE_DEFAULT: DateStyle = 'both';

export const PRINT_DATE_STYLE_SETTING: SettingDef<DateStyle> = {
  key: PRINT_DATE_STYLE_KEY,
  label: label('帳票の日付表記', 'Date style on printed documents'),
  description: label(
    '見積書・注文書・納品書・領収書・支払通知書・合計請求書・給与明細の日付の書き方。和暦は日本ローカライズがあるときだけ使われ、無ければ西暦になる。売上請求書の表記は変わらない',
    'How quotations, purchase orders, delivery notes, receipts, payment notices, statements and payslips write dates. The Japanese era needs the Japan localisation (otherwise Western dates). Sales invoices are not affected',
  ),
  schema: printDateStyleSchema,
  default: PRINT_DATE_STYLE_DEFAULT,
  category: 'company',
  order: 20,
  valueLabels: {
    western: label('西暦（2026年10月30日）', 'Western (2026-10-30)'),
    japanese_era: label('和暦（令和8年10月30日）', 'Japanese era (令和8年10月30日)'),
    both: label('西暦と和暦の併記', 'Western with the Japanese era'),
  },
};

/** Declares `print_layout.date_style` once (idempotent; safe after registry.reset). Called from module hooks. */
export function ensurePrintLayoutSettings(): void {
  if (!registry.hasSetting(PRINT_DATE_STYLE_KEY)) registry.registerSetting(PRINT_DATE_STYLE_SETTING);
}

/** Override point (ADR-0008): Gregorian `YYYY-MM-DD` -> Japanese era text. l10n/jp registers `toWareki`. */
export const PRINT_ERA_DATE_OVERRIDE = 'print_layout.era_date';

const noEra: EraDateFn = () => '';

/** What a document renderer needs besides its data: the locale, label lookup and the company's date notation. */
export interface PrintTools {
  locale: Locale;
  dateStyle: DateStyle;
  t(l: Label): string;
  date(d: string): string;
}

/** Pure: tools for a locale, date style and (optional) era converter. Renderer tests build them with this. */
export function printTools(locale: Locale, dateStyle: DateStyle, era?: EraDateFn): PrintTools {
  return {
    locale,
    dateStyle,
    t: (l) => l[locale],
    date: (d) => formatDocumentDate(d, dateStyle, locale, era),
  };
}

/** The only impure part: reads the company setting and the era override for the caller's context. */
export async function loadPrintTools(ctx: Context): Promise<PrintTools> {
  const dateStyle = await getSetting(ctx, PRINT_DATE_STYLE_KEY, printDateStyleSchema, PRINT_DATE_STYLE_DEFAULT);
  return printTools(ctx.locale, dateStyle, registry.override<EraDateFn>(PRINT_ERA_DATE_OVERRIDE, noEra));
}
