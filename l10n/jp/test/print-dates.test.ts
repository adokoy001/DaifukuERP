// docs/specs/print-templates.md AC-8: l10n/jp registers `print_layout.era_date` (toWareki), so printed documents can
// write the Japanese era; the shared formatter falls back to Western dates when the conversion fails.
import { registry } from '@daifuku/kernel';
import { formatDocumentDate, PRINT_ERA_DATE_OVERRIDE, type EraDateFn } from '@daifuku/mod-print-layout';
import { describe, expect, it } from 'vitest';
import { registerJapanOverrides } from '../src/module.ts';

const none: EraDateFn = () => '';

describe('print_layout.era_date (AC-8)', () => {
  registerJapanOverrides();
  const era = registry.override<EraDateFn>(PRINT_ERA_DATE_OVERRIDE, none);

  it('AC-8 the override is registered and converts with the l10n/jp era table (元年 included)', () => {
    expect(era).not.toBe(none);
    expect(era('2026-10-30')).toBe('令和8年10月30日');
    expect(era('2019-05-01')).toBe('令和元年5月1日');
    expect(era('2019-04-30')).toBe('平成31年4月30日');
  });

  it('AC-8 the three styles with the registered converter, in ja and en', () => {
    expect(formatDocumentDate('2026-10-30', 'western', 'ja', era)).toBe('2026年10月30日');
    expect(formatDocumentDate('2026-10-30', 'japanese_era', 'ja', era)).toBe('令和8年10月30日');
    expect(formatDocumentDate('2026-10-30', 'both', 'ja', era)).toBe('2026年10月30日（令和8年10月30日）');
    expect(formatDocumentDate('2026-10-30', 'both', 'en', era)).toBe('2026-10-30（令和8年10月30日）');
  });

  it('AC-8 a date before the first era cannot be converted and prints Western', () => {
    expect(formatDocumentDate('1800-01-01', 'japanese_era', 'ja', era)).toBe('1800年1月1日');
  });
});
