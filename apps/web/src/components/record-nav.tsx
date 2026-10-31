// form-ergonomics AC-9: "previous / next record" on a record opened from the generic list, within the same criteria
// (lib/record-nav.ts). Moving goes through the router, so the unsaved-changes confirmation of the form applies; it
// replaces the history entry, so Back still returns to the list. At a page edge the neighbouring page of the same
// criteria is read first.
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { request, sessionOwner } from '../api/client.ts';
import type { EntityMeta, ListResponse } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { buildListQuery } from '../lib/query.ts';
import {
  adjacentSearch,
  listStateOf,
  recordNavFromState,
  recordNavState,
  recordPosition,
  type RecordNav,
} from '../lib/record-nav.ts';
import { Button } from '../ui/index.ts';
import { useToast } from './toast.tsx';

/** The list position in the current history entry, when it was made for `entity` in this session. */
export function useRecordNav(entity: string): RecordNav | undefined {
  const state = useRouterState({ select: (s) => s.location.state });
  return recordNavFromState(state, entity, sessionOwner());
}

export interface RecordNavControlsProps {
  entity: EntityMeta;
  id: string;
  nav: RecordNav;
}

export function RecordNavControls({ entity, id, nav }: RecordNavControlsProps) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const position = recordPosition(nav, id);
  if (!position) return null;
  const open = (target: string, next: RecordNav) =>
    navigate({
      to: '/e/$entity/$id',
      params: { entity: entity.name, id: target },
      state: (prev) => ({ ...prev, ...recordNavState(next, sessionOwner()) }),
      replace: true,
    });
  const go = async (direction: 'prev' | 'next') => {
    const near = direction === 'prev' ? position.prev : position.next;
    if (near) {
      await open(near, nav);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const search = adjacentSearch(nav.search, direction);
      const page = await request<ListResponse>(
        `/api/${entity.name}?${buildListQuery(listStateOf(entity, search)).toString()}`,
      );
      const ids = page.items.map((row) => row.id);
      const target = direction === 'next' ? ids[0] : ids[ids.length - 1];
      if (!target) {
        toast.push({
          kind: 'info',
          title: t({
            ja: '一覧が変わったため、隣の記録はありません',
            en: 'The list changed; there is no neighbouring record',
          }),
        });
        return;
      }
      await open(target, { entity: nav.entity, ids, search, total: page.total });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const canPrev = position.prev !== undefined || position.prevPage;
  const canNext = position.next !== undefined || position.nextPage;
  return (
    <div
      role="group"
      aria-label={t({ ja: '一覧の中の移動', en: 'Move within the list' })}
      className="record-nav flex items-center gap-1 text-xs text-text-secondary"
      data-testid="record-nav"
    >
      <Button size="sm" disabled={!canPrev || busy} onClick={() => void go('prev')} data-testid="record-prev">
        ← {t({ ja: '前の記録', en: 'Previous record' })}
      </Button>
      <span className="font-mono tabular-nums" data-testid="record-position">
        {locale === 'ja' ? `${position.ordinal} / ${position.total} 件` : `${position.ordinal} of ${position.total}`}
      </span>
      <Button size="sm" disabled={!canNext || busy} onClick={() => void go('next')} data-testid="record-next">
        {t({ ja: '次の記録', en: 'Next record' })} →
      </Button>
    </div>
  );
}
