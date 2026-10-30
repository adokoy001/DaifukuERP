// Evidence search screen helpers (docs/specs/evidence-search.md AC-12..AC-20). Browser behaviour:
// e2e/evidence-search.spec.ts; the zip format: zip.test.ts.
import { describe, expect, it } from 'vitest';
import { evidenceHistoryKey, evidenceSearchKey } from '../api/evidence.ts';
import { financeIdentity } from '../api/finance.ts';
import type { ActionMeta, AppMeta } from '../api/types.ts';
import {
  checkDraft,
  classifyFailure,
  collectFiles,
  criteriaFromSearch,
  criteriaKey,
  EMPTY_CRITERIA,
  linkView,
  normalizeAmount,
  parseEvidenceSearch,
  runEvidenceZip,
  safeFilename,
  searchFromCriteria,
  searchInput,
  selectionState,
  summarizeCriteria,
  truncateUtf8,
  withTypeExtension,
  ZIP_MAX_BYTES,
  ZIP_MAX_FILES,
  zipEntryNames,
  zipFilename,
  type EvidenceCriteria,
  type EvidenceItem,
  type LinkedSummary,
} from './evidence-search.ts';
import { helpTopicFor } from './help.ts';
import { toggleSelection, togglePageSelection } from './list-workbench.ts';
import { buildNavigation, findNavigationEntry } from './navigation.ts';

const KINDS = ['invoice_received', 'invoice_issued', 'receipt', 'contract', 'bank_statement', 'other'];
const PARTNER = '0192f0e4-1111-4abc-8def-000000000001';

let seq = 0;
function item(over: Partial<EvidenceItem> = {}): EvidenceItem {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    tenantId: 't',
    companyId: 'c',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    version: 1,
    filename: `file-${seq}.pdf`,
    contentType: 'application/pdf',
    size: 100,
    sha256: 'a'.repeat(64),
    kind: 'receipt',
    txnDate: '2026-10-01',
    amount: '1000',
    partnerId: PARTNER,
    linkedEntity: null,
    linkedId: null,
    note: null,
    supersededById: null,
    linked: null,
    supersedes: 0,
    incomplete: false,
    ...over,
  } as EvidenceItem;
}

describe('URL search and criteria (AC-13, AC-14)', () => {
  it('AC-13 the route keeps known keys as strings; exact numbers from a typed URL become strings, others invalid', () => {
    expect(
      parseEvidenceSearch({
        from: '2026-01-01',
        to: '2026-01-31',
        amountFrom: '1000.50',
        amountTo: 2000,
        partnerId: PARTNER,
        kind: 'receipt',
        superseded: 'exclude',
        incomplete: 1,
        page: 3,
        other: 'x',
      }),
    ).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
      amountFrom: '1000.50',
      amountTo: '2000',
      partnerId: PARTNER,
      kind: 'receipt',
      superseded: 'exclude',
      incomplete: '1',
      page: 3,
    });
    expect(parseEvidenceSearch({ amountFrom: Number('12345678901234567890') }).amountFrom).toBe('invalid-number');
    expect(parseEvidenceSearch({ amountFrom: 12.5 }).amountFrom).toBe('12.5');
    expect(parseEvidenceSearch({ page: 1 })).toEqual({});
    expect(parseEvidenceSearch({ page: '4' })).toEqual({ page: 4 });
    expect(parseEvidenceSearch({ page: 'x', kind: {} })).toEqual({ kind: 'invalid', pageInvalid: true });
    for (const page of [0, -2, 1.5, 1_000_000, 'abc', '0'])
      expect(parseEvidenceSearch({ page }), String(page)).toEqual({ pageInvalid: true });
  });

  it('AC-13 criteria round-trip through the URL; amounts stay strings; the default supersede value is left out', () => {
    const c: EvidenceCriteria = {
      from: '2026-01-01',
      to: '2026-01-31',
      amountFrom: '1000',
      amountTo: '99999999999999999999.99',
      partnerId: PARTNER,
      kind: 'receipt',
      superseded: 'only',
      incomplete: true,
    };
    const url = searchFromCriteria(c);
    expect(url).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
      amountFrom: '1000',
      amountTo: '99999999999999999999.99',
      partnerId: PARTNER,
      kind: 'receipt',
      superseded: 'only',
      incomplete: '1',
    });
    expect(criteriaFromSearch(url, KINDS)).toEqual({ criteria: c, page: 1, ignored: [] });
    expect(searchFromCriteria(EMPTY_CRITERIA)).toEqual({});
    expect(searchFromCriteria(c, 2).page).toBe(2);
    const input = searchInput(c, 3);
    expect(input).toEqual({
      limit: 50,
      offset: 100,
      txnDateFrom: '2026-01-01',
      txnDateTo: '2026-01-31',
      amountFrom: '1000',
      amountTo: '99999999999999999999.99',
      partnerId: PARTNER,
      kind: 'receipt',
      superseded: 'only',
      incomplete: true,
    });
    expect(typeof input.amountTo).toBe('string');
    expect(searchInput(EMPTY_CRITERIA, 1)).toEqual({ limit: 50, offset: 0 });
  });

  it('AC-14 invalid URL values are ignored and reported by field; a reversed range drops both ends', () => {
    const r = criteriaFromSearch(
      {
        from: '2026-02-30',
        amountFrom: '1,000',
        partnerId: 'nope',
        kind: 'selfie',
        superseded: 'latest',
        incomplete: 'yes',
        page: 2,
      },
      KINDS,
    );
    expect(r.criteria).toEqual(EMPTY_CRITERIA);
    expect(r.page).toBe(2);
    expect(r.ignored).toEqual(['from', 'amountFrom', 'partnerId', 'kind', 'superseded', 'incomplete']);
    const reversed = criteriaFromSearch(
      { from: '2026-03-01', to: '2026-01-01', amountFrom: '10', amountTo: '9' },
      KINDS,
    );
    expect(reversed.criteria).toEqual(EMPTY_CRITERIA);
    expect(reversed.ignored).toEqual(['from', 'to', 'amountFrom', 'amountTo']);
    // a page that is not a whole number from 1 is reported with the other ignored values and the first page is shown
    expect(criteriaFromSearch(parseEvidenceSearch({ page: 'abc', kind: 'receipt' }), KINDS)).toEqual({
      criteria: { ...EMPTY_CRITERIA, kind: 'receipt' },
      page: 1,
      ignored: ['page'],
    });
    expect(criteriaFromSearch(parseEvidenceSearch({ page: 0 }), KINDS).ignored).toEqual(['page']);
    // the router spreads this route's validated search over the raw one, so a raw page the validator dropped arrives too
    const merged = (raw: Record<string, unknown>) =>
      ({ ...raw, ...parseEvidenceSearch(raw) }) as unknown as Parameters<typeof criteriaFromSearch>[0];
    for (const page of ['abc', 0, -1, 2.5])
      expect(criteriaFromSearch(merged({ page }), KINDS), String(page)).toMatchObject({ page: 1, ignored: ['page'] });
    expect(criteriaFromSearch(merged({ page: 1 }), KINDS)).toMatchObject({ page: 1, ignored: [] });
    expect(criteriaFromSearch(merged({ page: 7 }), KINDS)).toMatchObject({ page: 7, ignored: [] });
    // an empty value is "not given", not an invalid one
    expect(criteriaFromSearch(merged({ from: '', kind: '' }), KINDS)).toMatchObject({ ignored: [] });
  });

  it('AC-14 the form check gives a reason per field, in form order; separators are removed, nothing becomes a number', () => {
    const bad = checkDraft({
      ...EMPTY_CRITERIA,
      from: '2026-13-01',
      to: '2026-01-31',
      amountFrom: 'abc',
      amountTo: '1,200.50',
    });
    expect(Object.keys(bad.errors)).toEqual(['from', 'amountFrom']);
    expect(bad.errors.from?.ja).toContain('実在する日付');
    expect(bad.errors.amountFrom?.en).toContain('number');
    const order = checkDraft({
      ...EMPTY_CRITERIA,
      from: '2026-02-01',
      to: '2026-01-01',
      amountFrom: '3000',
      amountTo: '2,000',
    });
    expect(Object.keys(order.errors)).toEqual(['from', 'amountFrom']);
    expect(order.errors.from?.ja).toContain('開始日は終了日以前');
    expect(order.errors.amountFrom?.ja).toContain('下限は上限以下');
    const ok = checkDraft({
      ...EMPTY_CRITERIA,
      from: '2026-01-31',
      to: '2026-01-31',
      amountFrom: ' 1,000 ',
      amountTo: '1000.00',
    });
    expect(ok.errors).toEqual({});
    expect(ok.criteria).toMatchObject({ amountFrom: '1000', amountTo: '1000.00' });
    expect(normalizeAmount('1e5')).toBeUndefined();
    expect(normalizeAmount('-12.5')).toBe('-12.5');
  });

  it('AC-13 the summary names every applied criterion; the selection key ignores the page', () => {
    const c: EvidenceCriteria = {
      ...EMPTY_CRITERIA,
      from: '2026-01-01',
      to: '2026-01-31',
      amountFrom: '1000',
      partnerId: PARTNER,
      superseded: 'exclude',
      incomplete: true,
    };
    expect(summarizeCriteria(c, 'ja', { partner: '取引先A' })).toEqual([
      '取引年月日: 2026-01-01〜2026-01-31',
      '取引金額: 1,000〜',
      '取引先: 取引先A',
      '差替: 最新版のみ',
      '検索項目の未入力のみ',
    ]);
    expect(
      summarizeCriteria({ ...EMPTY_CRITERIA, amountFrom: '5000', amountTo: '5000', kind: 'receipt' }, 'en', {
        kind: 'Receipt',
      }),
    ).toEqual(['Amount: 5,000', 'Kind: Receipt']);
    // English ranges use an en dash, or "from" / "up to" for one-sided ranges; never the Japanese wave dash
    expect(summarizeCriteria(c, 'en', { partner: 'Partner A' }).slice(0, 2)).toEqual([
      'Date: 2026-01-01 – 2026-01-31',
      'Amount: from 1,000',
    ]);
    expect(summarizeCriteria({ ...EMPTY_CRITERIA, to: '2026-03-31' }, 'en')).toEqual(['Date: up to 2026-03-31']);
    expect(summarizeCriteria({ ...EMPTY_CRITERIA, to: '2026-03-31' }, 'ja')).toEqual(['取引年月日: 〜2026-03-31']);
    expect(summarizeCriteria(EMPTY_CRITERIA, 'ja')).toEqual([]);
    expect(criteriaKey(c)).toBe(criteriaKey({ ...c }));
    expect(criteriaKey(c)).not.toBe(criteriaKey({ ...c, incomplete: false }));
  });
});

describe('results (AC-15)', () => {
  const label = (entity: string) => ({ purchase_invoice: '仕入請求書', partner: '取引先' })[entity];
  const linked = (over: Partial<LinkedSummary>): LinkedSummary => ({
    entity: 'purchase_invoice',
    id: 'pi',
    kind: 'document',
    readable: true,
    target: { entity: 'purchase_invoice', id: 'pi' },
    title: null,
    number: 'PI-0001',
    docstatus: 1,
    ...over,
  });

  it('AC-15 a readable document links to its record with its number; a line opens its document; unreadable has no link', () => {
    expect(linkView(null, label, 'ja')).toBeNull();
    expect(linkView(linked({}), label, 'ja')).toEqual({
      href: '/e/purchase_invoice/pi',
      text: '仕入請求書 PI-0001',
      viaLine: false,
    });
    expect(linkView(linked({ entity: 'purchase_invoice_line', id: 'line', kind: 'line' }), label, 'ja')).toMatchObject({
      href: '/e/purchase_invoice/pi',
      viaLine: true,
    });
    expect(
      linkView(
        linked({
          entity: 'partner',
          kind: 'entity',
          target: { entity: 'partner', id: 'p' },
          number: null,
          title: '名前',
          docstatus: null,
        }),
        label,
        'en',
      ),
    ).toEqual({ href: '/e/partner/p', text: '取引先 名前', viaLine: false });
    for (const hidden of [
      linked({ readable: false, target: null, number: null, docstatus: null }),
      linked({ entity: 'ghost', kind: 'unknown', readable: false, target: null, number: null, docstatus: null }),
    ]) {
      expect(linkView(hidden, label, 'ja')).toEqual({ text: '参照できない記録', viaLine: false });
      expect(linkView(hidden, label, 'en')?.href).toBeUndefined();
    }
  });
});

describe('selection limits (AC-18)', () => {
  it('AC-18 the 51st row is refused by the list-workbench selection rule; the size cap only disables the download', () => {
    const rows = Array.from({ length: 51 }, () => item());
    let selection: ReadonlyMap<string, EvidenceItem> = new Map();
    for (const row of rows.slice(0, 50))
      selection = toggleSelection(selection, row, true, ZIP_MAX_FILES) as typeof selection;
    expect(selection.size).toBe(50);
    const after = toggleSelection(selection, rows[50] as EvidenceItem, true, ZIP_MAX_FILES);
    expect(after).toBe(selection); // refused: the same map comes back
    expect(togglePageSelection(new Map(), rows, true, ZIP_MAX_FILES).size).toBe(50);
    const full = selectionState([...selection.values()]);
    expect(full).toMatchObject({ count: 50, bytes: 5000, full: true, overSize: false, canDownload: true });
    const big = selectionState([item({ size: ZIP_MAX_BYTES }), item({ size: 1 })]);
    expect(big).toMatchObject({ count: 2, overSize: true, canDownload: false });
    expect(selectionState([item({ size: ZIP_MAX_BYTES })]).canDownload).toBe(true);
    expect(selectionState([]).canDownload).toBe(false);
  });
});

describe('zip entry names (AC-17)', () => {
  it('AC-17 date or no-date prefix, superseded_ first, forbidden characters and trailing dots/spaces replaced, reserved names prefixed', () => {
    expect(
      zipEntryNames([
        item({ txnDate: '2026-01-15', filename: '請求書.pdf' }),
        item({ txnDate: null, filename: 'receipt.png', contentType: 'image/png' }),
        item({ txnDate: '2026-01-15', filename: 'old.pdf', supersededById: 'x' }),
        item({ txnDate: '2026-02-01', filename: 'a/b\\c:d*e?f"g<h>i|j\u0001.pdf' }),
        item({ txnDate: '2026-02-01', filename: 'trailing. ' }),
      ]),
    ).toEqual([
      '2026-01-15_請求書.pdf',
      'no-date_receipt.png',
      'superseded_2026-01-15_old.pdf',
      '2026-02-01_a_b_c_d_e_f_g_h_i_j_.pdf',
      '2026-02-01_trailing__.pdf', // the trailing dot and space replaced, then the content type's extension added
    ]);
    expect(safeFilename('CON')).toBe('_CON');
    expect(safeFilename('nul.txt')).toBe('_nul.txt');
    expect(safeFilename('lpt9.pdf')).toBe('_lpt9.pdf');
    expect(safeFilename('console.pdf')).toBe('console.pdf');
  });

  it('AC-17 C1 controls and invisible bidi / format characters are replaced, so an extension cannot be spoofed', () => {
    expect(safeFilename('a\u0085b\u009fc')).toBe('a_b_c');
    for (const ch of [
      '\u061c',
      '\u200b',
      '\u200e',
      '\u200f',
      '\u202a',
      '\u202e',
      '\u2066',
      '\u2069',
      '\ufeff',
      '\u2028',
    ])
      expect(safeFilename(`x${ch}y.pdf`), ch.codePointAt(0)?.toString(16)).toBe('x_y.pdf');
    const [spoof] = zipEntryNames([item({ txnDate: '2026-01-01', filename: '請求書\u202efdp.exe' })]);
    expect(spoof).toBe('2026-01-01_請求書_fdp.exe.pdf');
    expect([...(spoof ?? '')].some((ch) => /[\p{Cc}\p{Cf}]/u.test(ch))).toBe(false);
    expect(safeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFilename('日本語 ファイル.pdf')).toBe('日本語 ファイル.pdf');
  });

  it('AC-17 the stored content type decides the extension: a name that does not end with it gets it added', () => {
    expect(withTypeExtension('invoice.exe', 'application/pdf')).toBe('invoice.exe.pdf');
    expect(withTypeExtension('scan.PDF', 'application/pdf')).toBe('scan.PDF');
    expect(withTypeExtension('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg');
    expect(withTypeExtension('photo', 'image/jpeg')).toBe('photo.jpg');
    expect(withTypeExtension('data.tsv', 'text/plain')).toBe('data.tsv.txt');
    expect(withTypeExtension('feed.xml', 'text/xml')).toBe('feed.xml');
    expect(withTypeExtension('a.bin', 'application/octet-stream')).toBe('a.bin'); // not an allowed type: unchanged
    expect(withTypeExtension('a.bin', undefined)).toBe('a.bin');
    expect(
      zipEntryNames([
        item({ txnDate: '2026-01-01', filename: 'receipt', contentType: 'image/png' }),
        item({ txnDate: '2026-01-01', filename: 'receipt.png', contentType: 'image/png' }),
      ]),
    ).toEqual(['2026-01-01_receipt.png', '2026-01-01_receipt (2).png']);
  });

  it('AC-17 same names get (2), (3) before the extension, case-insensitively', () => {
    const noType = (filename: string) => ({ txnDate: '2026-01-01', filename, supersededById: null });
    expect(
      zipEntryNames([
        item({ txnDate: '2026-01-01', filename: 'a.pdf' }),
        item({ txnDate: '2026-01-01', filename: 'A.pdf' }),
        item({ txnDate: '2026-01-01', filename: 'a.pdf' }),
        noType('noext'), // no known content type: the name keeps having no extension
        noType('noext'),
      ]),
    ).toEqual([
      '2026-01-01_a.pdf',
      '2026-01-01_A (2).pdf',
      '2026-01-01_a (3).pdf',
      '2026-01-01_noext',
      '2026-01-01_noext (2)',
    ]);
  });

  it('AC-17 names are cut to 255 UTF-8 bytes on a character boundary, keeping the extension and the counter', () => {
    const long = 'あ'.repeat(250) + '.pdf'; // 754 bytes
    const [first, second] = zipEntryNames([
      item({ txnDate: '2026-01-01', filename: long }),
      item({ txnDate: '2026-01-01', filename: long }),
    ]);
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    expect(bytes(first ?? '')).toBeLessThanOrEqual(255);
    expect(first?.endsWith('.pdf')).toBe(true);
    expect(first?.startsWith('2026-01-01_あ')).toBe(true);
    expect(bytes(second ?? '')).toBeLessThanOrEqual(255);
    expect(second?.endsWith(' (2).pdf')).toBe(true);
    expect(truncateUtf8('aあb', 3)).toBe('a');
    expect(truncateUtf8('😀x', 4)).toBe('😀');
    expect(zipFilename(new Date('2026-10-30T01:02:03.456Z'))).toBe('evidence_20261030010203.zip');
  });
});

describe('fetching the selected files (AC-17, AC-19)', () => {
  const blob = (n: number) => new Blob([new Uint8Array(n)]);
  const failing = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

  it('AC-19 failed files are listed and the rest continue; a size different from the record is a failure', async () => {
    const items = [
      item({ size: 3 }),
      item({ size: 3 }),
      item({ size: 3 }),
      item({ size: 3 }),
      item({ size: 3 }),
      item({ size: 3 }),
    ];
    const outcomes: (() => Blob)[] = [
      () => blob(3),
      () => {
        throw failing(403);
      },
      () => {
        throw failing(409);
      },
      () => {
        throw failing(0);
      },
      () => blob(2),
      () => blob(3),
    ];
    const progress: number[] = [];
    const result = await collectFiles(
      items,
      async (it) => (outcomes[items.indexOf(it)] as () => Blob)(),
      new AbortController().signal,
      (done) => progress.push(done),
    );
    expect(result.files.map((f) => f.item.id)).toEqual([items[0]?.id, items[5]?.id]);
    expect(result.failures.map((f) => f.reason)).toEqual(['denied', 'mismatch', 'network', 'size']);
    expect(result).toMatchObject({ aborted: false, unauthorized: false });
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
    expect(classifyFailure(404)).toBe('denied');
    expect(classifyFailure(500)).toBe('other');
    expect(classifyFailure(undefined)).toBe('other');
  });

  it('AC-19 a 401 stops the whole download and keeps nothing; so does "stop"', async () => {
    const items = [item({ size: 1 }), item({ size: 1 }), item({ size: 1 })];
    const calls: string[] = [];
    const unauthorized = await collectFiles(
      items,
      async (it) => {
        calls.push(it.id);
        if (it === items[1]) throw failing(401);
        return blob(1);
      },
      new AbortController().signal,
    );
    expect(unauthorized).toMatchObject({ unauthorized: true, files: [] });
    expect(calls).toHaveLength(2);
    const stop = new AbortController();
    const aborted = await collectFiles(
      items,
      async () => {
        stop.abort();
        return blob(1);
      },
      stop.signal,
    );
    expect(aborted).toMatchObject({ aborted: true, files: [] });
  });

  describe('runEvidenceZip: one press of the download button, start to finish', () => {
    const steps = (over: Partial<Parameters<typeof runEvidenceZip>[1]> = {}) => {
      const saved: { size: number; filename: string }[] = [];
      return {
        saved,
        steps: {
          fetchOne: async (it: EvidenceItem) => blob(it.size),
          build: async (entries: { name: string; data: Blob }[]) => new Blob(entries.map((e) => e.data)),
          save: (zip: Blob, filename: string) => void saved.push({ size: zip.size, filename }),
          now: () => new Date('2026-10-30T01:02:03Z'),
          ...over,
        },
      };
    };

    it('AC-17 saves the zip under the timestamped name and reports the files and failures', async () => {
      const items = [item({ size: 2 }), item({ size: 3 })];
      const { saved, steps: s } = steps({
        fetchOne: async (it) => {
          if (it === items[1]) throw failing(404);
          return blob(it.size);
        },
      });
      const outcome = await runEvidenceZip(items, s, new AbortController().signal);
      expect(outcome).toMatchObject({ kind: 'saved', saved: 1, failures: [{ reason: 'denied' }] });
      expect(saved).toEqual([{ size: 2, filename: 'evidence_20261030010203.zip' }]);
    });

    it('AC-17 AC-19 a zip that cannot be built or saved is a reported failure, never an unhandled rejection', async () => {
      const items = [item({ size: 1 }), item({ size: 1 })];
      const memory = new RangeError('Array buffer allocation failed');
      const { saved, steps: s } = steps({
        build: async () => {
          throw memory;
        },
      });
      await expect(runEvidenceZip(items, s, new AbortController().signal)).resolves.toEqual({
        kind: 'failed',
        error: memory,
        failures: [],
      });
      expect(saved).toEqual([]);
      const blocked = steps({
        save: () => {
          throw new Error('download blocked');
        },
      });
      await expect(runEvidenceZip(items, blocked.steps, new AbortController().signal)).resolves.toMatchObject({
        kind: 'failed',
        error: { message: 'download blocked' },
      });
    });

    it('AC-19 nothing fetched, a 401 and "stop" save nothing', async () => {
      const items = [item({ size: 1 })];
      const none = steps({
        fetchOne: async () => {
          throw failing(403);
        },
      });
      expect(await runEvidenceZip(items, none.steps, new AbortController().signal)).toMatchObject({ kind: 'none' });
      const expired = steps({
        fetchOne: async () => {
          throw failing(401);
        },
      });
      expect(await runEvidenceZip(items, expired.steps, new AbortController().signal)).toEqual({
        kind: 'unauthorized',
      });
      const stop = new AbortController();
      const stopped = steps({
        build: async (entries) => {
          stop.abort();
          return new Blob(entries.map((e) => e.data));
        },
      });
      expect(await runEvidenceZip(items, stopped.steps, stop.signal)).toEqual({ kind: 'aborted' });
      for (const run of [none, expired, stopped]) expect(run.saved).toEqual([]);
    });
  });
});

describe('identity, navigation and help (AC-12, AC-20)', () => {
  it('AC-20 search and history keys carry the finance identity (tenant, user, company)', () => {
    expect(evidenceSearchKey({ limit: 50 })).toEqual(['finance', financeIdentity(), 'evidence', { limit: 50 }]);
    expect(evidenceHistoryKey('x')).toEqual(['finance', financeIdentity(), 'evidence-history', 'x']);
  });

  const action = (name: string): ActionMeta => ({
    name,
    module: name.split('.')[0] ?? '',
    description: { ja: name, en: name },
    generic: false,
    mutates: false,
    resultKind: 'other',
  });
  const meta = (actions: ActionMeta[]): AppMeta => ({ entities: [], actions, modules: [], roles: ['accounting'] });

  it('AC-12 a finance dedicated screen only for callers of attachment.evidence_search, with its manual section', () => {
    expect(findNavigationEntry(buildNavigation(meta([]), false), '/finance/evidence')).toBeUndefined();
    expect(
      findNavigationEntry(buildNavigation(meta([action('attachment.evidence_search')]), false), '/finance/evidence'),
    ).toMatchObject({
      href: '/finance/evidence',
      workspace: 'finance',
      kind: 'workspace',
      featured: true,
      label: { ja: '証憑の検索', en: 'Evidence search' },
    });
    expect(helpTopicFor('/finance/evidence')).toEqual({ chapter: '02-basics.md', section: '証憑の検索' });
  });
});
