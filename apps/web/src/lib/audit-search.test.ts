// docs/specs/access-insight.md AC-19, AC-20: URL <-> conditions, the default last 7 days in Japan, form validation
// (real dates, start after end, the 366-day rule with the same examples as the API, record id), unreadable URL values
// ignored and named, the cursor trail, and the text of result rows (people, AI agents, system / relay, CSV exports,
// record links).
import { describe, expect, it } from 'vitest';
import {
  actorText,
  auditApiQuery,
  auditSearchParams,
  conditionsKey,
  defaultPeriod,
  exportSummary,
  opLabel,
  pageAnnouncement,
  parseAuditSearch,
  periodDays,
  popTrail,
  pushTrail,
  recordHref,
  subjectLabel,
  todayInJapan,
  userOptionText,
  validateAuditForm,
  type AuditConditions,
  type AuditItem,
  type AuditOptions,
} from './audit-search.ts';

/** 2026-10-30 00:30 in Japan = 2026-10-29 15:30 UTC: the Japanese date is already the 30th. */
const NOW = new Date('2026-10-29T15:30:00Z');
const RECORD = '00000000-0000-4000-8000-0000000000aa';
const base: AuditConditions = {
  from: '2026-10-24',
  to: '2026-10-30',
  user: '',
  entity: '',
  op: '',
  record: '',
  scope: 'company',
};
function item(extra: Partial<AuditItem> = {}): AuditItem {
  return {
    id: 'a1',
    at: '2026-10-30T01:00:00.000Z',
    entity: 'partner',
    recordId: RECORD,
    op: 'update',
    action: null,
    actorType: 'user',
    actorId: '00000000-0000-4000-8000-0000000000u1',
    actorName: '営業 花子',
    onBehalfOf: null,
    onBehalfOfName: null,
    requestId: 'req-1',
    before: { name: 'A' },
    after: { name: 'B' },
    ...extra,
  };
}
const options: AuditOptions = {
  scope: 'company',
  users: [],
  subjects: [{ name: 'company_settings', label: { ja: '会社設定', en: 'Company settings' }, kind: 'kernel' }],
  ops: [{ name: 'export', label: { ja: 'CSV 出力', en: 'CSV export' } }],
};

describe('audit search conditions (access-insight AC-19)', () => {
  it('AC-19: the default is the last 7 days in Japan, today included', () => {
    expect(todayInJapan(NOW)).toBe('2026-10-30');
    expect(defaultPeriod(NOW)).toEqual({ from: '2026-10-24', to: '2026-10-30' });
    expect(periodDays('2026-10-24', '2026-10-30')).toBe(7);
    expect(parseAuditSearch({}, NOW, { tenantAdmin: false })).toEqual({ state: base, ignored: [] });
  });

  it('AC-19: the URL round-trips through the conditions and to the API query', () => {
    const raw = {
      from: '2026-10-01',
      to: '2026-10-30',
      user: 'system',
      entity: 'partner',
      op: 'export',
      record: RECORD,
      scope: 'tenant',
      cursor: 'abc_DEF-1',
    };
    const { state, ignored } = parseAuditSearch(raw, NOW, { tenantAdmin: true });
    expect(ignored).toEqual([]);
    expect(auditSearchParams(state)).toEqual(raw);
    expect(new URLSearchParams(auditApiQuery(state))).toEqual(
      new URLSearchParams({
        from: '2026-10-01',
        to: '2026-10-30',
        limit: '50',
        scope: 'tenant',
        userId: 'system',
        entity: 'partner',
        op: 'export',
        recordId: RECORD,
        cursor: 'abc_DEF-1',
      }),
    );
    expect(auditSearchParams(base)).toEqual({ from: '2026-10-24', to: '2026-10-30' });
  });

  it('AC-19: unreadable URL values are ignored and named; scope=tenant only for tenant administrators', () => {
    const bad = parseAuditSearch(
      { from: '2026-02-30', to: '2026-03-01', entity: 'Bad', record: 'x', scope: 'tenant', cursor: 'a b', op: ['x'] },
      NOW,
      { tenantAdmin: false },
    );
    expect(bad.state).toEqual(base);
    expect(bad.ignored.sort()).toEqual(['cursor', 'entity', 'from', 'op', 'record', 'scope', 'to']);
    expect(parseAuditSearch({ from: '2024-01-01', to: '2025-01-01' }, NOW, { tenantAdmin: false }).ignored).toEqual([
      'from',
      'to',
    ]);
    expect(parseAuditSearch({ record: RECORD }, NOW, { tenantAdmin: false }).ignored).toEqual(['record']);
  });

  it('AC-19: form errors per field in screen order, with the same 366-day examples as the API', () => {
    expect(validateAuditForm(base)).toEqual([]);
    expect(validateAuditForm({ ...base, from: '' }).map((e) => e.field)).toEqual(['from']);
    expect(validateAuditForm({ ...base, from: '2026-10-31' })).toMatchObject([
      { field: 'to', message: { ja: '終了日を開始日以降にしてください。' } },
    ]);
    expect(validateAuditForm({ ...base, from: '2024-01-01', to: '2024-12-31' })).toEqual([]);
    expect(validateAuditForm({ ...base, from: '2025-01-01', to: '2026-01-01' })).toEqual([]);
    expect(validateAuditForm({ ...base, from: '2024-01-01', to: '2025-01-01' }).map((e) => e.field)).toEqual(['to']);
    expect(validateAuditForm({ ...base, record: RECORD }).map((e) => e.message.en)).toEqual([
      'Choose a subject before entering a record id.',
    ]);
    expect(validateAuditForm({ ...base, entity: 'partner', record: 'nope' }).map((e) => e.field)).toEqual(['record']);
    expect(validateAuditForm({ ...base, from: 'x', entity: 'partner', record: 'nope' }).map((e) => e.field)).toEqual([
      'from',
      'record',
    ]);
  });

  it('AC-19: the cursor trail goes next, previous and back to the first page; the key ignores the cursor', () => {
    let trail = pushTrail([], undefined);
    trail = pushTrail(trail, 'c2');
    expect(trail).toEqual(['', 'c2']);
    const back = popTrail(trail);
    expect(back).toEqual({ trail: [''], cursor: 'c2' });
    expect(popTrail(back.trail)).toEqual({ trail: [], cursor: undefined });
    expect(conditionsKey(base)).toBe(conditionsKey({ ...base, cursor: 'c9' } as AuditConditions));
    expect(conditionsKey(base)).not.toBe(conditionsKey({ ...base, op: 'export' }));
  });
});

describe('audit result rows (access-insight AC-20)', () => {
  it('AC-20: a person, an AI agent acting for a person, and system / relay / unknown actors', () => {
    expect(actorText(item())).toEqual({ ja: '営業 花子', en: '営業 花子' });
    expect(
      actorText(
        item({ actorType: 'agent', actorId: 'claude', onBehalfOf: 'u1', onBehalfOfName: '管理 太郎', actorName: null }),
      ),
    ).toEqual({ ja: '管理 太郎（AI 代理: claude）', en: '管理 太郎 (AI agent: claude)' });
    expect(actorText(item({ actorType: 'system', actorId: 'system', actorName: null })).ja).toBe('システム: system');
    expect(actorText(item({ actorType: 'relay', actorId: 'gw-1', actorName: null })).en).toBe('Site device: gw-1');
    expect(actorText(item({ actorType: 'machine', actorId: 'key-1', actorName: null })).ja).toBe('machine: key-1');
  });

  it('AC-20: CSV export summary with rows, total, the cut, columns and criteria', () => {
    const exported = item({
      op: 'export',
      action: 'partner.export_rows',
      before: null,
      after: {
        export: {
          rows: 2,
          total: 5,
          truncated: true,
          columns: ['code', 'name'],
          where: { isCustomer: true },
          search: 'abc',
        },
      },
    });
    expect(exportSummary(exported)).toEqual({
      ja: '2 行（全 5 件。上限で打ち切り）・列: code, name・条件: {"isCustomer":true} "abc"',
      en: '2 rows (of 5; cut at the limit) · columns: code, name · criteria: {"isCustomer":true} "abc"',
    });
    expect(exportSummary(item({ op: 'export', after: { export: { rows: 1, total: 1, columns: ['name'] } } }))?.ja).toBe(
      '1 行（全 1 件）・列: name・条件: なし',
    );
    expect(exportSummary(item())).toBeNull();
  });

  it('AC-20: a link to the record form only for readable entities and not for deletions or exports', () => {
    const readable = new Set(['partner']);
    expect(recordHref(item(), readable)).toBe(`/e/partner/${RECORD}`);
    expect(recordHref(item({ op: 'delete' }), readable)).toBeNull();
    expect(recordHref(item({ op: 'export' }), readable)).toBeNull();
    expect(recordHref(item({ entity: 'company_settings' }), readable)).toBeNull();
  });

  it('AC-20: subject and operation labels fall back to the stored names; user options say former and inactive', () => {
    expect(subjectLabel('company_settings', options)).toEqual({ ja: '会社設定', en: 'Company settings' });
    expect(subjectLabel('partner', options, { ja: '取引先', en: 'Partner' }).ja).toBe('取引先');
    expect(subjectLabel('machine_credential', options).ja).toBe('machine_credential');
    expect(opLabel('export', options).ja).toBe('CSV 出力');
    expect(opLabel('use_denied', options).en).toBe('use_denied');
    expect(userOptionText({ id: 'u', name: '営業 花子', active: true, kind: 'former' }).ja).toBe(
      '営業 花子（所属解除済み）',
    );
    expect(userOptionText({ id: 'u', name: 'A', active: false, kind: 'user', email: 'a@example.com' }).en).toBe(
      'A (inactive) <a@example.com>',
    );
    expect(pageAnnouncement(50, true, 2).ja).toBe('2 ページ目: 50 件を表示。続きがあります。');
  });
});
