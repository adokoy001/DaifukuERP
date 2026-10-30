// docs/specs/inbox.md AC-4/AC-5/AC-7: providers are called in parallel and settle independently; one failure stays
// with its provider. The failure view names the provider in its retry button.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InboxFailure, countLabel } from '../components/inbox-card.tsx';
import { LocaleProvider } from '../i18n.tsx';
import type { InboxProvider } from '../lib/inbox.ts';
import { parseWorkforceSearch } from '../lib/workforce.ts';
import { ApiError } from './client.ts';
import { loadInbox } from './inbox.ts';

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

describe('inbox presentation (AC-5/AC-9)', () => {
  it('AC-5: the failure view says it could not be loaded and offers a retry named after the provider', () => {
    const markup = renderToStaticMarkup(
      h(
        LocaleProvider,
        null,
        h(InboxFailure, {
          name: '銀行連携',
          error: new ApiError(500, { code: 'INTERNAL', message: 'boom', hint: 'retry' }),
          onRetry: () => undefined,
        }),
      ),
    );
    expect(markup).toContain('取得できませんでした');
    expect(markup).toContain('aria-label="銀行連携を再試行"');
    expect(markup).toContain('INTERNAL');
    expect(markup).not.toContain('role="alert"');
  });

  it('AC-9: counts read as 件 in Japanese and plain numbers in English', () => {
    expect(countLabel(1234, 'ja')).toBe('1,234件');
    expect(countLabel(1234, 'en')).toBe('1,234');
  });

  it('AC-6: workforce links keep only a valid month and a known tab', () => {
    expect(parseWorkforceSearch({ period: '2026-08', tab: 'payroll' })).toEqual({ period: '2026-08', tab: 'payroll' });
    expect(parseWorkforceSearch({ period: '2026-13', tab: 'admin', other: 'x' })).toEqual({});
  });
});
