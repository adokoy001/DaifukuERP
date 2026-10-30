// docs/specs/inbox.md AC-4/AC-5/AC-7/AC-9: providers are called in parallel and settle independently; one failure
// stays with its provider; the query never refetches on its own. The failure view keeps the server message and the
// technical details, names the provider in its retry button and reads in both languages.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InboxFailure, countLabel } from '../components/inbox-card.tsx';
import { LocaleProvider } from '../i18n.tsx';
import type { InboxProvider } from '../lib/inbox.ts';
import { parseEmployeeSearch, parseWorkforceSearch } from '../lib/workforce.ts';
import { ApiError } from './client.ts';
import { INBOX_QUERY_OPTIONS, loadInbox } from './inbox.ts';

const provider = (action: string): InboxProvider => ({
  action,
  module: action.split('.')[0] ?? '',
  label: { ja: action, en: action },
});

describe('loadInbox (AC-4/AC-5)', () => {
  it('AC-4: starts every provider before any settles and keeps provider order in the outcomes', async () => {
    const started: string[] = [];
    const release: Record<string, () => void> = {};
    const call = (action: string) =>
      new Promise<unknown>((resolve) => {
        started.push(action);
        release[action] = () => resolve({ items: [], from: action });
      });
    const pending = loadInbox([provider('workforce.todo'), provider('banking.todo')], call);
    expect(started).toEqual(['workforce.todo', 'banking.todo']);
    release['banking.todo']?.();
    release['workforce.todo']?.();
    expect(await pending).toEqual([
      { action: 'workforce.todo', ok: true, value: { items: [], from: 'workforce.todo' } },
      { action: 'banking.todo', ok: true, value: { items: [], from: 'banking.todo' } },
    ]);
  });

  it('AC-5: a rejected provider is reported alone; the others still resolve', async () => {
    const error = new ApiError(500, { code: 'INTERNAL', message: 'boom', hint: 'retry' });
    const outcomes = await loadInbox([provider('workforce.todo'), provider('edge.todo')], (action) =>
      action === 'edge.todo' ? Promise.reject(error) : Promise.resolve({ items: [] }),
    );
    expect(outcomes).toEqual([
      { action: 'workforce.todo', ok: true, value: { items: [] } },
      { action: 'edge.todo', ok: false, error },
    ]);
    expect(await loadInbox([], () => Promise.reject(new Error('never called')))).toEqual([]);
  });
});

describe('inbox reads (AC-7)', () => {
  it('AC-7: no polling, no refetch on window focus or reconnect, no automatic retry, nothing cached between mounts', () => {
    expect(INBOX_QUERY_OPTIONS).toEqual({
      staleTime: 0,
      gcTime: 0,
      retry: false,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });
});

const failure = (props: { retrying?: boolean } = {}) =>
  renderToStaticMarkup(
    h(
      LocaleProvider,
      null,
      h(InboxFailure, {
        name: '銀行連携',
        error: new ApiError(500, { code: 'INTERNAL', message: 'boom', hint: 'retry later' }),
        onRetry: () => undefined,
        ...props,
      }),
    ),
  );

describe('inbox presentation (AC-5/AC-9)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC-5: the failure view says it could not be loaded, keeps the server message and details, and offers a retry', () => {
    const markup = failure();
    expect(markup).toContain('取得できませんでした');
    expect(markup).toContain('boom');
    expect(markup).toMatch(/<details class="ui-error-details">.*INTERNAL.*500.*retry later.*<\/details>/);
    expect(markup).not.toMatch(/<details[^>]* open/);
    expect(markup).toContain('aria-label="銀行連携を再試行"');
    expect(markup).not.toContain('role="alert"');
  });

  it('AC-5: while the provider is retried the same button stays, marked busy instead of disappearing', () => {
    const markup = failure({ retrying: true });
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('aria-label="銀行連携を再試行中"');
    expect(markup).toContain('再試行中…');
    expect(markup).toContain('boom');
  });

  it('AC-9: the failure view reads in English when English is selected', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en', setItem: () => undefined });
    const markup = failure();
    expect(markup).toContain('Could not be loaded');
    expect(markup).toContain('Technical details');
    expect(markup).toContain('aria-label="Retry 銀行連携"');
    expect(markup).not.toContain('取得できませんでした');
  });

  it('AC-9: counts read as 件 in Japanese and plain numbers in English', () => {
    expect(countLabel(1234, 'ja')).toBe('1,234件');
    expect(countLabel(1234, 'en')).toBe('1,234');
  });

  it('AC-6: workforce links keep only a valid month and a known tab', () => {
    expect(parseWorkforceSearch({ period: '2026-08', tab: 'payroll' })).toEqual({ period: '2026-08', tab: 'payroll' });
    expect(parseWorkforceSearch({ period: '2026-13', tab: 'admin', other: 'x' })).toEqual({});
  });

  it('AC-6: employee portal links keep only a valid month and a portal tab', () => {
    expect(parseEmployeeSearch({ period: '2026-08', tab: 'expenses' })).toEqual({ period: '2026-08', tab: 'expenses' });
    expect(parseEmployeeSearch({ period: '2026-8', tab: 'payroll_admin', other: 'x' })).toEqual({});
  });
});
