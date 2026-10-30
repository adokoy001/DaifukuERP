// ui-kit AC-4/AC-5: what the generic list shows when there is nothing to list, and the next step.
import type { ReactNode } from 'react';
import { useLocale } from '../i18n.tsx';
import { S } from '../strings.ts';
import { Button, EmptyState } from '../ui/index.ts';

export interface ListEmptyStateProps {
  entityLabel: string;
  /** Current search text (`?q=`); a non-empty value means "nothing matches". */
  query: string | undefined;
  /** Total across all pages; >0 with an empty page means the page is past the end. */
  total: number;
  /** Renders the create link (router <Link>) with the given text; omitted when the entity cannot be created here. */
  renderCreate?: (text: string) => ReactNode;
  onClearSearch: () => void;
  /** list-workbench: applied filters (0 = none); with `onClearFilters` the state offers to clear them. */
  filterCount?: number;
  onClearFilters?: () => void;
}

export function ListEmptyState({
  entityLabel,
  query,
  total,
  renderCreate,
  onClearSearch,
  filterCount = 0,
  onClearFilters,
}: ListEmptyStateProps) {
  const { t, locale } = useLocale();
  const q = query?.trim() ?? '';
  if (q || filterCount > 0) {
    const parts = [
      q ? (locale === 'ja' ? `「${q}」` : `“${q}”`) : '',
      filterCount > 0 ? (locale === 'ja' ? `絞り込み ${filterCount} 件` : `${filterCount} filter(s)`) : '',
    ].filter(Boolean);
    return (
      <EmptyState
        title={t(S.listNoMatch)}
        description={parts.join(locale === 'ja' ? '・' : ', ')}
        action={
          <>
            {q ? <Button onClick={onClearSearch}>{t(S.clearSearch)}</Button> : null}
            {filterCount > 0 && onClearFilters ? (
              <Button onClick={onClearFilters}>{t({ ja: '絞り込みをクリア', en: 'Clear filters' })}</Button>
            ) : null}
          </>
        }
      />
    );
  }
  if (total > 0) return <EmptyState title={t(S.noRows)} />;
  return (
    <EmptyState
      title={t(S.listEmptyTitle)}
      description={t(renderCreate ? S.listEmptyDescription : S.listEmptyReadOnly)}
      action={renderCreate?.(locale === 'ja' ? `${entityLabel}を登録する` : `Add ${entityLabel}`)}
    />
  );
}
