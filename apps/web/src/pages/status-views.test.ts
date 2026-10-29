// ui-kit AC-7/AC-8: LoadingView is a skeleton with a screen-reader text; MetaError puts the human sentence first and
// folds the technical details away.
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { LocaleProvider } from '../i18n.tsx';
import { LoadingView, MetaError } from './status-views.tsx';

const render = (element: ReactElement) => renderToStaticMarkup(h(LocaleProvider, null, element));
const failure = new ApiError(503, {
  code: 'INTERNAL',
  message: 'Synthetic refresh failure',
  hint: 'Retry the read.',
});

describe('ui-kit AC-7: LoadingView', () => {
  it('AC-7: busy skeleton with hidden placeholders and a visually hidden loading text', () => {
    const markup = render(h(LoadingView));
    expect(markup).toMatch(/^<div class="ui-loading" aria-busy="true" data-testid="loading-view">/);
    expect(markup).toContain('<span class="sr-only">読み込み中…</span>');
    expect(markup).toContain('class="ui-skeleton ui-skeleton-title"');
    expect(markup).not.toMatch(/role="(status|alert)"/);
  });
});

describe('ui-kit AC-8: MetaError', () => {
  const markup = render(h(MetaError, { error: failure, retry: () => undefined }));

  it('AC-8: one alert; title, explanation and server message come before the technical details', () => {
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    const order = [
      '読み込みに失敗しました',
      '一時的な問題が発生した可能性があります',
      'Synthetic refresh failure',
      '<details',
      '>再試行</button>',
    ].map((text) => markup.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('AC-8: code, HTTP status and hint stay available inside a closed <details>', () => {
    const details = /<details class="ui-error-details">([\s\S]*)<\/details>/.exec(markup)?.[1] ?? '';
    expect(markup).not.toMatch(/<details[^>]* open/);
    expect(details).toContain('<summary>技術情報</summary>');
    expect(details).toContain('<dd class="code">INTERNAL</dd>');
    expect(details).toContain('<dd class="code">503</dd>');
    expect(details).toContain('<dd>Retry the read.</dd>');
  });

  it('AC-8: a plain Error shows its message without an empty technical section', () => {
    const plain = render(h(MetaError, { error: new Error('boom'), retry: () => undefined }));
    expect(plain).toContain('boom');
    expect(plain).not.toContain('<details');
    expect(plain).toContain('<button type="button" class="btn">再試行</button>');
  });
});
