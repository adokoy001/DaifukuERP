// docs/specs/evidence-search.md: the pure parts of attachment.evidence_search / attachment.history — the search domain
// with the supersede and "search keys missing" filters (AC-4), input validation (AC-9), the public row schema (AC-3), the
// supersede tree (AC-10) and the link summary helpers (AC-5). DB behaviour is in evidence-search.db.test.ts.
import { defineDocument, defineEntity, f, label, newId, ValidationError } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import {
  buildSearchDomain,
  evidenceItemSchema,
  evidenceSearchInput,
  historyItemSchema,
  INCOMPLETE_DOMAIN,
  isIncomplete,
  searchAction,
} from '../src/index.ts';
import { evidenceSearchAction } from '../src/actions/evidence-search.ts';
import { historyAction } from '../src/actions/history.ts';
import {
  compareHistory,
  NO_SUPERSEDE_RECORD,
  relationOf,
  supersedeRecordOf,
  takeLevel,
  withoutStorageKey,
  type TreeNode,
} from '../src/services/evidence.ts';
import { describeRow, fieldsReadable, lineParents, linkKindOf, unreadable } from '../src/services/linked.ts';

// Test-only entities for the link summary: a document with a line entity, and a plain entity whose display field is
// masked for some roles and one whose display field is output-hidden.
const EvDoc = defineDocument({
  name: 'ev_unit_doc',
  label: label('証憑テスト伝票', 'Evidence test document'),
  naming: { type: 'sequence', prefix: 'EV-' },
  fields: { title: f.text() },
  displayField: 'title',
  lines: [{ entity: 'ev_unit_doc_line', parentField: 'docId' }],
  permissions: { roles: { clerk: ['read', 'create', 'update', 'submit'] } },
});
const EvLine = defineEntity({
  name: 'ev_unit_doc_line',
  label: label('証憑テスト明細', 'Evidence test line'),
  fields: { docId: f.ref('ev_unit_doc', { required: true }), memo: f.text() },
  displayField: 'memo',
  permissions: {
    roles: { clerk: ['read'], outsider: ['read'] },
    fieldGroups: { parent: { fields: ['docId'], roles: ['clerk'] } },
  },
});
const EvMasked = defineEntity({
  name: 'ev_unit_masked',
  label: label('証憑テスト秘匿', 'Evidence test masked'),
  fields: { name: f.text(), secret: f.text({ outputHidden: true }) },
  displayField: 'name',
  permissions: {
    roles: { clerk: ['read'], viewer: ['read'] },
    fieldGroups: { names: { fields: ['name'], roles: ['clerk'] } },
  },
});
const EvHidden = defineEntity({
  name: 'ev_unit_hidden',
  label: label('証憑テスト非公開', 'Evidence test hidden'),
  fields: { secret: f.text({ outputHidden: true }) },
  displayField: 'secret',
  permissions: { roles: { clerk: ['read'] } },
});

describe('evidence search domain (AC-4)', () => {
  it('AC-4 superseded include/exclude/only and incomplete combine with the existing criteria (AND)', () => {
    expect(buildSearchDomain({ superseded: 'include' })).toBeUndefined();
    expect(buildSearchDomain({ superseded: 'exclude' })).toEqual({ supersededById: null });
    expect(buildSearchDomain({ superseded: 'only' })).toEqual({ supersededById: { $ne: null } });
    expect(buildSearchDomain({ incomplete: true })).toEqual({ $and: [INCOMPLETE_DOMAIN] });
    expect(buildSearchDomain({ incomplete: false })).toBeUndefined();
    expect(INCOMPLETE_DOMAIN).toEqual({ $or: [{ txnDate: null }, { amount: null }, { partnerId: null }] });
    const partnerId = newId();
    expect(
      buildSearchDomain({
        txnDateFrom: '2026-01-01',
        txnDateTo: '2026-01-31',
        amountFrom: '1000.0',
        partnerId,
        kind: 'receipt',
        superseded: 'exclude',
        incomplete: true,
      }),
    ).toEqual({
      partnerId,
      kind: 'receipt',
      supersededById: null,
      $and: [
        { txnDate: { $gte: '2026-01-01' } },
        { txnDate: { $lte: '2026-01-31' } },
        { amount: { $gte: '1000' } },
        INCOMPLETE_DOMAIN,
      ],
    });
  });

  it('AC-11 attachment.search does not accept the new criteria (its input is unchanged)', () => {
    const parsed = searchAction.input.parse({ superseded: 'only', incomplete: true, partnerId: newId() }) as Record<
      string,
      unknown
    >;
    expect(parsed.superseded).toBeUndefined();
    expect(parsed.incomplete).toBeUndefined();
    expect(Object.keys((searchAction.input as unknown as { shape: object }).shape).sort()).toEqual(
      ['amountFrom', 'amountTo', 'kind', 'limit', 'offset', 'partnerId', 'txnDateFrom', 'txnDateTo'].sort(),
    );
  });
});

describe('evidence search input (AC-1, AC-9)', () => {
  const issuePath = (input: unknown) => {
    const r = evidenceSearchInput.safeParse(input);
    return r.success ? null : r.error.issues.map((i) => i.path.join('.'));
  };

  it('AC-9 rejects malformed dates, enums, limits and offsets naming the input', () => {
    expect(issuePath({ txnDateFrom: '2026-02-30' })).toEqual(['txnDateFrom']);
    expect(issuePath({ txnDateTo: '2026/01/01' })).toEqual(['txnDateTo']);
    expect(issuePath({ kind: 'selfie' })).toEqual(['kind']);
    expect(issuePath({ superseded: 'latest' })).toEqual(['superseded']);
    expect(issuePath({ incomplete: 'yes' })).toEqual(['incomplete']);
    expect(issuePath({ limit: 0 })).toEqual(['limit']);
    expect(issuePath({ limit: 101 })).toEqual(['limit']);
    expect(issuePath({ offset: -1 })).toEqual(['offset']);
    expect(issuePath({ partnerId: 'x' })).toEqual(['partnerId']);
    expect(issuePath({ limit: 100, offset: 0, incomplete: false, superseded: 'only' })).toBeNull();
  });

  it('AC-9 from > to and non-decimal or reversed amounts are ValidationErrors with the input name as path', () => {
    const fail = (q: Parameters<typeof buildSearchDomain>[0]) => {
      try {
        buildSearchDomain(q);
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        return (e as ValidationError).details;
      }
      return null;
    };
    expect(fail({ txnDateFrom: '2026-02-01', txnDateTo: '2026-01-31' })).toMatchObject({
      issues: [{ path: 'txnDateFrom' }],
    });
    expect(fail({ amountFrom: '1,000' })).toMatchObject({ issues: [{ path: 'amountFrom' }] });
    expect(fail({ amountTo: 'abc' })).toMatchObject({ issues: [{ path: 'amountTo' }] });
    expect(fail({ amountFrom: '200', amountTo: '100' })).toMatchObject({ issues: [{ path: 'amountFrom' }] });
    // the same value at both ends is an exact match, not an error
    expect(
      fail({ txnDateFrom: '2026-01-31', txnDateTo: '2026-01-31', amountFrom: '100', amountTo: '100.00' }),
    ).toBeNull();
  });

  it('AC-1 the actions are read-only, run outside a transaction and need attachment read', () => {
    for (const action of [evidenceSearchAction, historyAction]) {
      expect(action.mutates).toBe(false);
      expect(action.tx).toBe('none');
      expect(action.permission).toEqual({ entity: 'attachment', op: 'read' });
    }
    expect(evidenceSearchAction.name).toBe('attachment.evidence_search');
    expect(historyAction.name).toBe('attachment.history');
  });
});

describe('public row (AC-3)', () => {
  const row = {
    id: newId(),
    tenantId: newId(),
    companyId: newId(),
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    createdBy: null,
    updatedBy: null,
    version: 1,
    storageKey: 'tenant/secret-key',
    filename: 'a.pdf',
    contentType: 'application/pdf',
    size: 10,
    sha256: 'a'.repeat(64),
    kind: 'receipt',
    txnDate: '2026-10-01',
    amount: '1000',
    partnerId: newId(),
    linkedEntity: null,
    linkedId: null,
    note: null,
    supersededById: null,
    ext: null,
  };

  it('AC-3 the item schema is derived from the entity schema without storageKey and adds linked/supersedes/incomplete', () => {
    const shape = Object.keys(evidenceItemSchema.shape);
    expect(shape).not.toContain('storageKey');
    expect(shape).toEqual(
      expect.arrayContaining(['filename', 'txnDate', 'amount', 'partnerId', 'supersededById', 'version']),
    );
    expect(shape).toEqual(expect.arrayContaining(['linked', 'supersedes', 'incomplete']));
    expect(Object.keys(historyItemSchema.shape)).not.toContain('storageKey');
    const parsed = evidenceItemSchema.parse({ ...row, linked: null, supersedes: 2, incomplete: false });
    expect(parsed).not.toHaveProperty('storageKey');
    expect(withoutStorageKey(row)).not.toHaveProperty('storageKey');
    expect(withoutStorageKey(row)).toMatchObject({ filename: 'a.pdf', amount: '1000' });
  });

  it('AC-3 incomplete is true when 取引年月日, 取引金額 or 取引先 is empty', () => {
    expect(isIncomplete(row)).toBe(false);
    expect(isIncomplete({ ...row, txnDate: null })).toBe(true);
    expect(isIncomplete({ ...row, amount: null })).toBe(true);
    expect(isIncomplete({ ...row, partnerId: null })).toBe(true);
    expect(isIncomplete({ ...row, amount: '0' })).toBe(false); // zero is a value, not a missing key
  });
});

describe('supersede tree (AC-10)', () => {
  const node = (id: string, supersededById: string | null, depth: number, createdAt = '2026-10-01T00:00:00.000Z') =>
    ({ id, supersededById, depth, createdAt }) satisfies TreeNode;

  it('AC-10 relations: self, newer on the path to the latest, older below self, sibling elsewhere', () => {
    // latest c; b -> c and a -> c (siblings); a0 -> a; requested: a
    const nodes = [node('c', null, 0), node('b', 'c', 1), node('a', 'c', 1), node('a0', 'a', 2), node('b0', 'b', 2)];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const newer = new Set(['c']);
    const rel = Object.fromEntries(nodes.map((n) => [n.id, relationOf(n, 'a', newer, byId)]));
    expect(rel).toEqual({ c: 'newer', b: 'sibling', a: 'self', a0: 'older', b0: 'sibling' });
    // requested: the latest; everything else is older
    const fromLatest = Object.fromEntries(nodes.map((n) => [n.id, relationOf(n, 'c', new Set(), byId)]));
    expect(fromLatest).toEqual({ c: 'self', b: 'older', a: 'older', a0: 'older', b0: 'older' });
  });

  it('AC-10 order: latest first, then by depth; same depth newest registration first, then id', () => {
    const nodes = [
      node('x', 'c', 1, '2026-10-02T00:00:00.000Z'),
      node('c', null, 0),
      node('y', 'c', 1, '2026-10-03T00:00:00.000Z'),
      node('z2', 'y', 2, '2026-10-01T00:00:00.000Z'),
      node('z1', 'y', 2, '2026-10-01T00:00:00.000Z'),
    ];
    expect([...nodes].sort(compareHistory).map((n) => n.id)).toEqual(['c', 'y', 'x', 'z1', 'z2']);
  });

  it('AC-10 a level fills the budget, keeps the always-kept path without counting it twice and reports what it left out', () => {
    const kept = new Map<string, TreeNode>([
      ['c', node('c', null, 0)],
      ['self', node('self', 'c', 1)],
    ]);
    const children = [node('self', 'c', 1), node('s1', 'c', 1), node('s2', 'c', 1), node('s3', 'c', 1)];
    const level = takeLevel(children, kept, 4);
    expect(level).toEqual({ next: ['self', 's1', 's2'], skipped: true });
    expect([...kept.keys()]).toEqual(['c', 'self', 's1', 's2']);
    // a deep requested row: its path is longer than the budget; nothing else is added but the path stays
    const deep = new Map<string, TreeNode>(Array.from({ length: 52 }, (_, i) => [`v${i}`, node(`v${i}`, null, i)]));
    const more = takeLevel([node('v1', 'v0', 1), node('other', 'v0', 1)], deep, Math.max(50, deep.size));
    expect(more).toEqual({ next: ['v1'], skipped: true });
    expect(deep.size).toBe(52);
  });

  it('AC-10 the supersede record is the newest attachment.supersede entry; none recorded gives nulls', () => {
    const at = new Date('2026-10-05T01:02:03.000Z');
    type Entry = Parameters<typeof supersedeRecordOf>[0][number];
    const entries: Entry[] = [
      {
        action: null,
        actorType: 'user',
        actorId: 'u-2',
        at: new Date('2026-10-06T00:00:00Z'),
        after: { note: 'x' },
      },
      {
        action: 'attachment.supersede',
        actorType: 'agent',
        actorId: 'a-1',
        at,
        after: { supersededById: 'n', reason: '金額誤り' },
      },
      {
        action: 'attachment.supersede',
        actorType: 'user',
        actorId: 'old',
        at: new Date('2026-10-01T00:00:00Z'),
        after: {},
      },
    ];
    expect(supersedeRecordOf(entries)).toEqual({
      reason: '金額誤り',
      at: '2026-10-05T01:02:03.000Z',
      actorType: 'agent',
      actorId: 'a-1',
    });
    expect(supersedeRecordOf([entries[0] as Entry])).toEqual(NO_SUPERSEDE_RECORD);
    expect(supersedeRecordOf([])).toEqual({ reason: null, at: null, actorType: null, actorId: null });
    expect(supersedeRecordOf([{ ...(entries[1] as Entry), after: null }]).reason).toBeNull();
  });
});

describe('link summary helpers (AC-5)', () => {
  it('AC-5 kinds: a document, its line, a plain entity and an unregistered name', () => {
    const parents = lineParents();
    expect(parents.get(EvLine.name)).toEqual({ parent: EvDoc, parentField: 'docId' });
    expect(linkKindOf(EvDoc.name, parents)).toBe('document');
    expect(linkKindOf(EvLine.name, parents)).toBe('line');
    expect(linkKindOf(EvMasked.name, parents)).toBe('entity');
    expect(linkKindOf('no_such_entity', parents)).toBe('unknown');
    expect(unreadable('no_such_entity', 'x', 'unknown')).toEqual({
      entity: 'no_such_entity',
      id: 'x',
      kind: 'unknown',
      readable: false,
      target: null,
      title: null,
      number: null,
      docstatus: null,
    });
  });

  it('AC-5 the title is null when the display field is masked for the caller or output-hidden; documents carry number and status', () => {
    expect(describeRow({ roles: ['clerk'] }, EvMasked, { name: '名前' })).toEqual({
      title: '名前',
      number: null,
      docstatus: null,
    });
    expect(describeRow({ roles: ['viewer'] }, EvMasked, { name: '名前' }).title).toBeNull();
    expect(describeRow({ roles: ['clerk'] }, EvHidden, { secret: 's' }).title).toBeNull();
    expect(describeRow({ roles: ['clerk'] }, EvDoc, { title: 'T', number: 'EV-1', docstatus: 1 })).toEqual({
      title: 'T',
      number: 'EV-1',
      docstatus: 1,
    });
    expect(describeRow({ roles: ['clerk'] }, EvDoc, { title: '', number: null, docstatus: 0 })).toEqual({
      title: null,
      number: null,
      docstatus: 0,
    });
    // the line's parent field is masked for `outsider`, so a line link cannot be followed to its document
    expect(fieldsReadable({ roles: ['clerk'] }, EvLine, ['docId'])).toBe(true);
    expect(fieldsReadable({ roles: ['outsider'] }, EvLine, ['docId'])).toBe(false);
    expect(fieldsReadable({ roles: ['clerk'] }, EvMasked, ['secret'])).toBe(false);
  });
});
