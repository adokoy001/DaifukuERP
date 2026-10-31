// docs/specs/setup-health.md AC-7/AC-8 (pure parts): the registration port refuses malformed or duplicate checks,
// the response order is by `order` then registration, and only in-app paths pass as links.
import { afterEach, describe, expect, it } from 'vitest';
import {
  healthChecks,
  isHealthHref,
  KERNEL_HEALTH_CHECKS,
  label,
  registry,
  type HealthCheckDef,
} from '../src/index.ts';

const check = (id: string, order?: number): HealthCheckDef => ({
  id,
  label: label(`検査 ${id}`, `Check ${id}`),
  ...(order === undefined ? {} : { order }),
  run: async () => ({ status: 'ok', detail: label('ok', 'ok') }),
});

afterEach(() => registry.reset());

describe('setup-health AC-7: registry.registerHealthCheck', () => {
  it('AC-7: registers once per id; ids look like <module>.<name>; labels need ja and en', () => {
    registry.registerHealthCheck(check('probe.first'));
    expect(registry.healthChecks().map((c) => c.id)).toEqual(['probe.first']);
    expect(() => registry.registerHealthCheck(check('probe.first'))).toThrow(/already registered/);
    expect(() => registry.registerHealthCheck(check('NoDot'))).toThrow(/<module>.<name>/);
    expect(() => registry.registerHealthCheck({ ...check('probe.label'), label: { ja: '', en: 'x' } })).toThrow(
      /ja and en/,
    );
    expect(() => registry.registerHealthCheck({ ...check('probe.order'), order: 1.5 })).toThrow(/integer/);
  });

  it('AC-7: kernel checks come first by order; extra checks after registered ones at the same order', () => {
    registry.registerHealthCheck(check('probe.late'));
    registry.registerHealthCheck(check('probe.early', 5));
    const ids = healthChecks([check('probe.extra'), check('probe.extra_early', 5)]).map((c) => c.id);
    expect(ids).toEqual([
      'probe.early',
      'probe.extra_early',
      ...KERNEL_HEALTH_CHECKS.map((c) => c.id),
      'probe.late',
      'probe.extra',
    ]);
    expect(KERNEL_HEALTH_CHECKS.map((c) => c.id)).toEqual(['company.profile', 'system.outbox']);
  });

  it('AC-7: registry.reset forgets registered checks', () => {
    registry.registerHealthCheck(check('probe.reset'));
    registry.reset();
    expect(registry.healthChecks()).toEqual([]);
  });
});

describe('setup-health AC-8: in-app links only', () => {
  it.each([
    ['/settings?tab=company', true],
    ['/a/accounting.open_fiscal_year', true],
    ['/e/tax_rate', true],
    ['/finance/close', true],
    ['https://evil.example.com', false],
    ['//evil.example.com/x', false],
    ['/e/../admin', false],
    ['javascript:alert(1)', false],
    ['settings', false],
    ['/a b', false],
    ['/' + 'x'.repeat(200), false],
    [42, false],
  ])('AC-8: %j -> %s', (href, ok) => {
    expect(isHealthHref(href)).toBe(ok);
  });
});
