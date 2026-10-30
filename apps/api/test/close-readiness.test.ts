// docs/specs/close-guide.md AC-6 / AC-7 safety invariant over the full registry (every module and pack, no DB).
// close_readiness leaves out what its caller cannot read (AC-7), so `ready` is only safe while every document whose
// drafts block the close is fully countable by each role allowed to run the check: readable, not narrowed by a row
// rule, and with its business date and docstatus unmasked. A later change to those role tables must fail here
// instead of quietly letting the guide report "ready" over drafts it cannot see. Counting: close-readiness.db.test.ts.
import '../src/modules.ts';
import { can, maskedFields, registry } from '@daifuku/kernel';
import { closeDateField, isBlockingDraft } from '@daifuku/mod-accounting';
import { describe, expect, it } from 'vitest';

describe('close guide: blocking drafts stay countable (AC-6, AC-7)', () => {
  it('every blocking document is readable, row-unrestricted and unmasked for the roles that can run the check', () => {
    const permission = registry.action('accounting.close_readiness').permission;
    const roles = permission !== 'authenticated' && 'roles' in permission ? permission.roles : [];
    expect([...roles].sort()).toEqual(['accounting', 'admin']);
    const blocking = registry
      .allEntities()
      .filter(
        (e) => e.kind === 'document' && closeDateField(e.config.fields) && isBlockingDraft(e.name, e.config.fields),
      );
    expect(blocking.map((e) => e.name)).toEqual(
      expect.arrayContaining(['journal_entry', 'sales_invoice', 'purchase_invoice', 'payment']),
    );
    for (const role of roles.filter((r) => r !== 'admin'))
      for (const entity of blocking) {
        const where = `${role} on ${entity.name}`;
        const pack = entity.module !== undefined && registry.hasPack(entity.module) ? [entity.module] : [];
        const ctx = { roles: [role], appliedPacks: pack };
        expect(can(ctx, entity, 'read'), where).toBe(true);
        const rules = entity.config.permissions.rowRules ?? [];
        expect(
          rules.filter((rule) => rule.roles.includes(role)),
          where,
        ).toEqual([]);
        const masked = maskedFields(ctx, entity);
        for (const field of [closeDateField(entity.config.fields) ?? '', 'docstatus']) {
          expect(masked.has(field), `${where}.${field} masked`).toBe(false);
          expect(entity.config.fields[field]?.opts.outputHidden ?? false, `${where}.${field} hidden`).toBe(false);
        }
      }
  });
});
