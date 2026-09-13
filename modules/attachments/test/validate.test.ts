import { StateError, ValidationError } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import {
  assertSupersedable,
  basenameOf,
  buildSearchDomain,
  cleanFormFields,
  MAX_UPLOAD_BYTES,
  normalizeContentType,
  sha256Hex,
  uploadFieldsSchema,
  validateUpload,
} from '../src/index.ts';

const issuesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError)
      return ((e.details as { issues: { path: string }[] }).issues ?? []).map((i) => i.path);
    throw e;
  }
  return [];
};

describe('validateUpload (AC-2)', () => {
  it('normalises the content type and keeps only the basename of the filename', () => {
    expect(normalizeContentType('Text/CSV; charset=utf-8')).toBe('text/csv');
    expect(basenameOf('C:\\Users\\me\\領収書.pdf')).toBe('領収書.pdf');
    expect(basenameOf('/tmp/a/b.png')).toBe('b.png');
    expect(validateUpload({ filename: 'dir/請求書.PDF', contentType: 'application/pdf; x=y', size: 10 })).toEqual({
      filename: '請求書.PDF',
      contentType: 'application/pdf',
      size: 10,
    });
  });

  it('accepts exactly pdf/png/jpeg/csv/xml/txt and rejects everything else by field path', () => {
    for (const ok of [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'text/csv',
      'application/xml',
      'text/xml',
      'text/plain',
    ]) {
      expect(validateUpload({ filename: 'f', contentType: ok, size: 1 }).contentType).toBe(ok);
    }
    for (const bad of ['application/zip', 'image/gif', 'application/octet-stream', 'text/html', '']) {
      expect(issuesOf(() => validateUpload({ filename: 'f', contentType: bad, size: 1 }))).toEqual([
        'file.contentType',
      ]);
    }
  });

  it('enforces the 20 MB limit, non-empty files and a filename', () => {
    expect(validateUpload({ filename: 'f', contentType: 'text/plain', size: MAX_UPLOAD_BYTES }).size).toBe(
      MAX_UPLOAD_BYTES,
    );
    expect(
      issuesOf(() => validateUpload({ filename: 'f', contentType: 'text/plain', size: MAX_UPLOAD_BYTES + 1 })),
    ).toEqual(['file']);
    expect(issuesOf(() => validateUpload({ filename: 'f', contentType: 'text/plain', size: 0 }))).toEqual(['file']);
    expect(issuesOf(() => validateUpload({ filename: '  ', contentType: 'text/plain', size: 1 }))).toEqual([
      'file.filename',
    ]);
    expect(issuesOf(() => validateUpload({ filename: 'x'.repeat(256), contentType: 'text/plain', size: 1 }))).toEqual([
      'file.filename',
    ]);
  });

  it('cleanFormFields drops empty strings and trims; unknown keys are kept for the strict field schema to reject', () => {
    expect(cleanFormFields({ kind: ' receipt ', amount: '', note: undefined, txn_date: '2026-01-01' })).toEqual({
      kind: 'receipt',
      txn_date: '2026-01-01',
    });
    expect(uploadFieldsSchema.safeParse({ kind: 'receipt', txn_date: '2026-01-01' }).success).toBe(false);
    expect(uploadFieldsSchema.safeParse({ kind: 'receipt', txnDate: '2026-01-01', amount: '10' }).success).toBe(true);
  });

  it('sha256Hex matches the known digest of "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('buildSearchDomain (AC-4)', () => {
  it('returns undefined for no criteria and ANDs ranges with equality filters', () => {
    expect(buildSearchDomain({})).toBeUndefined();
    expect(
      buildSearchDomain({
        txnDateFrom: '2026-01-01',
        txnDateTo: '2026-03-31',
        amountFrom: '1000.00',
        amountTo: '2000',
        partnerId: 'p',
        kind: 'receipt',
      }),
    ).toEqual({
      partnerId: 'p',
      kind: 'receipt',
      $and: [
        { txnDate: { $gte: '2026-01-01' } },
        { txnDate: { $lte: '2026-03-31' } },
        { amount: { $gte: '1000' } },
        { amount: { $lte: '2000' } },
      ],
    });
    expect(buildSearchDomain({ amountFrom: '5' })).toEqual({ $and: [{ amount: { $gte: '5' } }] });
  });

  it('rejects inverted ranges and non-decimal amounts naming the field', () => {
    expect(issuesOf(() => buildSearchDomain({ txnDateFrom: '2026-02-01', txnDateTo: '2026-01-01' }))).toEqual([
      'txnDateFrom',
    ]);
    expect(issuesOf(() => buildSearchDomain({ amountFrom: '10', amountTo: '9.99' }))).toEqual(['amountFrom']);
    expect(issuesOf(() => buildSearchDomain({ amountTo: '1,000' }))).toEqual(['amountTo']);
  });
});

describe('assertSupersedable (AC-5)', () => {
  it('allows a current row to be superseded by a current replacement only', () => {
    expect(() =>
      assertSupersedable({ id: 'a', supersededById: null }, { id: 'b', supersededById: null }),
    ).not.toThrow();
    expect(() => assertSupersedable({ id: 'a', supersededById: null }, { id: 'a', supersededById: null })).toThrow(
      ValidationError,
    );
    expect(() => assertSupersedable({ id: 'a', supersededById: 'c' }, { id: 'b', supersededById: null })).toThrow(
      StateError,
    );
    expect(() => assertSupersedable({ id: 'a', supersededById: null }, { id: 'b', supersededById: 'c' })).toThrow(
      StateError,
    );
  });
});
