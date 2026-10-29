// ui-kit AC-4/AC-5: the generic list's empty body explains the state and offers the next step.
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocaleProvider } from '../i18n.tsx';
import { ListEmptyState, type ListEmptyStateProps } from './list-empty-state.tsx';

const render = (element: ReactElement) => renderToStaticMarkup(h(LocaleProvider, null, element));
const base: ListEmptyStateProps = { entityLabel: '取引先', query: undefined, total: 0, onClearSearch: () => undefined };
const createLink = (text: string) => h('a', { href: '/e/partner/new' }, text);

describe('ui-kit AC-4: no records yet', () => {
  it('AC-4: explains the empty list and offers the create link when the entity can be created', () => {
    const markup = render(h(ListEmptyState, { ...base, renderCreate: createLink }));
    expect(markup).toContain('data-testid="empty-state"');
    expect(markup).toContain('まだ記録がありません');
    expect(markup).toContain('最初の記録を登録すると、ここに一覧で表示されます。');
    expect(markup).toContain('<a href="/e/partner/new">取引先を登録する</a>');
    // The create link must not be confused with the header's "+ 新規" link (tests select /新規/).
    expect(markup).not.toContain('新規');
  });

  it('AC-4: without create permission it explains where records come from and offers no link', () => {
    const markup = render(h(ListEmptyState, base));
    expect(markup).toContain('この画面から登録できる記録はありません。');
    expect(markup).not.toContain('<a ');
  });

  it('AC-4: a page past the end of a non-empty list does not claim the list is empty', () => {
    const markup = render(h(ListEmptyState, { ...base, total: 12, renderCreate: createLink }));
    expect(markup).toContain('該当するデータがありません');
    expect(markup).not.toContain('まだ記録がありません');
    expect(markup).not.toContain('<a ');
  });
});

describe('ui-kit AC-5: nothing matches the search', () => {
  it('AC-5: shows the search text and a clear-search button instead of the create link', () => {
    const markup = render(h(ListEmptyState, { ...base, query: '  E2E商事 ', renderCreate: createLink }));
    expect(markup).toContain('検索条件に一致する記録はありません');
    expect(markup).toContain('「E2E商事」');
    expect(markup).toContain('<button type="button" class="btn">検索をクリア</button>');
    expect(markup).not.toContain('<a ');
  });
});
