// Rule-set contract (docs/specs/fixed-assets.md AC-2, AC-10, AC-23, AC-35): schema, company checks, rate selection by
// acquisition date, method restrictions, memorandum values and the confirmation record.
import { describe, expect, it } from 'vitest';
import {
  checkRules,
  confirmationState,
  defaultPropertyTaxClass,
  depreciationRuleSetSchema,
  memorandumFor,
  methodAllowed,
  selectRate,
} from '../src/index.ts';
import { TEST_RULES } from './fixture-rules.ts';

const JP = { country: 'JP', currency: 'JPY' };

describe('rule set (AC-10)', () => {
  it('AC-10: the test rule set passes the schema and is usable for a JP/JPY company', () => {
    expect(depreciationRuleSetSchema.safeParse(TEST_RULES).success).toBe(true);
    expect(checkRules(TEST_RULES, JP).ok).toBe(true);
  });
  it('AC-10: missing, invalid, other-country and other-currency rules are refused with a reason', () => {
    expect(checkRules(null, JP)).toMatchObject({ ok: false, reason: 'rules_missing' });
    expect(checkRules({ ...TEST_RULES, rateTables: [] }, JP)).toMatchObject({ ok: false, reason: 'rules_invalid' });
    expect(
      checkRules(
        {
          ...TEST_RULES,
          rateTables: [
            {
              ...TEST_RULES.rateTables[0],
              rows: [{ usefulLife: 5, rate: '0,2', revisedRate: null, guaranteeRate: null }],
            },
          ],
        },
        JP,
      ),
    ).toMatchObject({ ok: false, reason: 'rules_invalid' });
    expect(checkRules(TEST_RULES, { country: 'US', currency: 'JPY' })).toMatchObject({
      ok: false,
      reason: 'rules_country',
    });
    expect(checkRules(TEST_RULES, { country: 'JP', currency: 'USD' })).toMatchObject({
      ok: false,
      reason: 'rules_currency',
    });
  });
});

describe('rate selection (AC-2)', () => {
  it('AC-2 (c): rates by method, useful life and acquisition window', () => {
    expect(selectRate(TEST_RULES, 'straight_line', 5, '2026-01-01')?.rate.toString()).toBe('0.2');
    expect(selectRate(TEST_RULES, 'declining_200', 10, '2012-04-01')?.guaranteeRate?.toString()).toBe('0.06552');
    expect(selectRate(TEST_RULES, 'declining_200', 10, '2012-03-31')).toBeNull();
    expect(selectRate(TEST_RULES, 'straight_line', 5, '2007-03-31')).toBeNull();
    expect(selectRate(TEST_RULES, 'straight_line', 7, '2026-01-01')).toBeNull();
  });
  it('AC-2 (d): building, later building equipment / structures and software are straight line only', () => {
    expect(methodAllowed(TEST_RULES, 'building', 'declining_200', '2026-01-01')).toBe(false);
    expect(methodAllowed(TEST_RULES, 'building_equipment', 'declining_200', '2016-04-01')).toBe(false);
    expect(methodAllowed(TEST_RULES, 'building_equipment', 'declining_200', '2016-03-31')).toBe(true);
    expect(methodAllowed(TEST_RULES, 'software', 'declining_200', '2026-01-01')).toBe(false);
    expect(methodAllowed(TEST_RULES, 'tools_furniture', 'declining_200', '2026-01-01')).toBe(true);
  });
  it('AC-8: memorandum 1 for tangible, 0 for intangible; property-tax class defaults (AC-1)', () => {
    expect(memorandumFor(TEST_RULES, 'tools_furniture', '2026-01-01')?.toString()).toBe('1');
    expect(memorandumFor(TEST_RULES, 'software', '2026-01-01')?.toString()).toBe('0');
    expect(memorandumFor(TEST_RULES, 'software', '2007-03-31')).toBeNull();
    expect(defaultPropertyTaxClass(TEST_RULES, 'vehicle')).toBe('excluded');
    expect(defaultPropertyTaxClass(TEST_RULES, 'tools_furniture')).toBe('tools');
  });
});

describe('confirmation record (AC-35)', () => {
  it('AC-35: usable when the pack verified it, or when the company recorded the current id with a date', () => {
    expect(confirmationState(TEST_RULES, { ruleSetId: '', confirmedOn: '' })).toEqual({
      confirmedOn: null,
      usable: false,
    });
    expect(confirmationState(TEST_RULES, { ruleSetId: 'other', confirmedOn: '2026-10-30' }).usable).toBe(false);
    expect(confirmationState(TEST_RULES, { ruleSetId: TEST_RULES.id, confirmedOn: '2026-10-30' })).toEqual({
      confirmedOn: '2026-10-30',
      usable: true,
    });
    expect(
      confirmationState({ ...TEST_RULES, verifiedOn: '2026-11-01' }, { ruleSetId: '', confirmedOn: '' }).usable,
    ).toBe(true);
  });
});
