// AC-14 source access (docs/specs/cash-forecast.md): a scheduled source is included only when the caller reads every
// entity it needs without a row rule and without hidden fields, and payroll also needs export. Pure permission checks
// over the registry (no DB): the probe entity below exercises each rule, the real roles exercise the defaults.
import { defineEntity, f, label, newId, type Context } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import { BankingModule } from '../src/index.ts';
import {
  entityAllows,
  SOURCE_NEEDS_EXPORT,
  SOURCE_READS,
  sourceIncluded,
  sourceStatuses,
} from '../src/cash-sources.ts';
import { CASH_SOURCES, type CashSource } from '../src/contract.ts';

const Probe = defineEntity({
  name: 'cash_source_probe',
  label: label('検査用', 'Probe'),
  fields: {
    owner: f.uuid({}),
    amount: f.money({}),
    secret: f.text({ outputHidden: true }),
  },
  permissions: {
    roles: {
      probe_reader: ['read'],
      probe_exporter: ['read', 'export'],
      probe_limited: ['read', 'export'],
      probe_amounts: ['read', 'export'],
    },
    rowRules: [{ roles: ['probe_limited'], where: { owner: '$ctx.userId' } }],
    fieldGroups: { amounts: { roles: ['probe_amounts', 'probe_exporter'], fields: ['amount'] } },
  },
});

function ctxOf(roles: string[]): Context {
  return {
    roles,
    actor: { type: 'user', id: newId() },
    accessScope: 'all',
    appliedPacks: [],
    tenantId: newId(),
    companyId: newId(),
  } as unknown as Context;
}

describe('AC-14 entity access rules', () => {
  it('AC-14: read without a row rule and with readable fields is required; export only when asked', () => {
    expect(BankingModule.name).toBe('banking');
    expect(entityAllows(ctxOf(['probe_exporter']), Probe, ['owner', 'amount'], true)).toBe(true);
    // no export
    expect(entityAllows(ctxOf(['probe_reader']), Probe, ['owner'], false)).toBe(true);
    expect(entityAllows(ctxOf(['probe_reader']), Probe, ['owner'], true)).toBe(false);
    // a row rule restricts every granted role
    expect(entityAllows(ctxOf(['probe_limited']), Probe, ['owner'], false)).toBe(false);
    // a second, unrestricted grant lifts the row rule (kernel rowFilter semantics)
    expect(entityAllows(ctxOf(['probe_limited', 'probe_exporter']), Probe, ['owner', 'amount'], true)).toBe(true);
    // a masked field group
    expect(entityAllows(ctxOf(['probe_reader']), Probe, ['amount'], false)).toBe(false);
    expect(entityAllows(ctxOf(['probe_amounts']), Probe, ['amount'], true)).toBe(true);
    // an output-hidden field is never readable, even by admin
    expect(entityAllows(ctxOf(['admin']), Probe, ['secret'], false)).toBe(false);
    expect(entityAllows(ctxOf(['admin']), Probe, ['owner', 'amount'], true)).toBe(true);
    // no grant at all
    expect(entityAllows(ctxOf(['sales']), Probe, ['owner'], false)).toBe(false);
  });

  it('AC-14: sourceIncluded asks export for payroll only (a reader without export loses payroll alone)', () => {
    expect([...SOURCE_NEEDS_EXPORT]).toEqual(['payroll']);
    // every source reads the probe, so only the export rule differs between them
    const probeReads = Object.fromEntries(
      CASH_SOURCES.map((source) => [source, [{ entity: Probe.name, fields: ['owner'] }]]),
    ) as Record<CashSource, { entity: string; fields: string[] }[]>;
    const reader = ctxOf(['probe_reader']);
    for (const source of CASH_SOURCES)
      expect([source, sourceIncluded(reader, source, probeReads)]).toEqual([source, source !== 'payroll']);
    for (const source of CASH_SOURCES) expect(sourceIncluded(ctxOf(['probe_exporter']), source, probeReads)).toBe(true);
  });

  it('AC-14: every field a source reads exists on its entity', async () => {
    const { registry } = await import('@daifuku/kernel');
    for (const source of CASH_SOURCES)
      for (const { entity, fields } of SOURCE_READS[source]) {
        expect(registry.hasEntity(entity)).toBe(true);
        const def = registry.entity(entity);
        for (const field of fields) expect(Object.keys(def.columns)).toContain(field);
      }
  });
});

describe('AC-14 sources by role', () => {
  const included = (roles: string[]) =>
    Object.fromEntries(sourceStatuses(ctxOf(roles)).map((s) => [s.source, s.included]));
  it('AC-14: admin sees every source', () => {
    expect(included(['admin'])).toEqual({
      sales_invoice: true,
      contract: true,
      purchase_invoice: true,
      bank_transfer: true,
      payroll: true,
    });
  });
  it('AC-14: accounting alone has no payroll; accounting with workforce_payroll has it', () => {
    expect(included(['accounting'])).toEqual({
      sales_invoice: true,
      contract: true,
      purchase_invoice: true,
      bank_transfer: true,
      payroll: false,
    });
    expect(sourceIncluded(ctxOf(['accounting', 'workforce_payroll']), 'payroll')).toBe(true);
  });
  it('AC-14: payroll read through a row rule (hr, manager, employee) is not enough', () => {
    for (const role of ['workforce_hr', 'workforce_manager', 'workforce_employee'])
      expect(sourceIncluded(ctxOf(['accounting', role]), 'payroll')).toBe(false);
  });
});
