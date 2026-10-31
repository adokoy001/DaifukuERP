// navigation-assist AC-1/AC-2/AC-8: the command palette. Opened by Ctrl/⌘+K or the top-bar button (router.tsx);
// a combobox over a grouped listbox (WAI-ARIA APG pattern) inside the kit Dialog, which supplies the modal, Escape
// and the focus return to the opener. Candidates: lib/command-palette.ts. Moves go through the router, so the
// unsaved-changes guard still asks before leaving a dirty form.
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { useFavorites, useRecentRecords } from '../api/navigation-assist.ts';
import { useNavigation } from '../api/navigation.ts';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { buildPalette, movePaletteSelection, type PaletteGroup, type PaletteOption } from '../lib/command-palette.ts';
import { WORKSPACES } from '../lib/navigation.ts';
import { recentRecordDetail, recentRecordText } from '../lib/recent-records.ts';
import { S } from '../strings.ts';
import { Dialog } from '../ui/index.ts';
import { Icon } from './icon.tsx';
import './navigation-assist.css';

const GROUP_LABELS: Record<PaletteGroup['id'], Label> = {
  favorites: { ja: 'お気に入り', en: 'Favourites' },
  screens: { ja: '画面', en: 'Screens' },
  records: { ja: '最近開いた記録', en: 'Recent records' },
};
const WORKSPACE_LABELS = new Map(WORKSPACES.map((workspace) => [workspace.id, workspace.label]));

const PALETTE_TITLE: Label = { ja: '画面と記録を開く', en: 'Open a screen or record' };

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { catalog, meta } = useNavigation();
  const recent = useRecentRecords(catalog, meta.data?.entities);
  const favorites = useFavorites(catalog);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const palette = useMemo(
    () => buildPalette({ catalog, query, locale, favorites: favorites.entries, records: recent.items }),
    [catalog, query, locale, favorites.entries, recent.items],
  );
  const { options } = palette;
  const selected = active >= 0 && active < options.length ? active : options.length ? 0 : -1;
  const optionId = (index: number) => `${listId}-option-${index}`;
  useEffect(() => {
    if (selected >= 0) document.getElementById(optionId(selected))?.scrollIntoView?.({ block: 'nearest' });
  });

  const choose = (option: PaletteOption) => {
    // Close first, so focus is back on the page before a guarded move may ask to discard unsaved changes.
    flushSync(onClose);
    if (option.kind === 'screen') void navigate({ to: option.entry.href });
    else void navigate({ to: '/e/$entity/$id', params: { entity: option.record.entity, id: option.record.id } });
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(movePaletteSelection(selected, options.length, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[selected];
      if (option) choose(option);
    }
  };

  let index = -1;
  // The catalog is empty while the screen metadata loads or after it failed: say so instead of "no match".
  const loading = meta.isPending;
  const failed = !loading && meta.isError && !catalog.entries.length;
  const empty: Label = loading
    ? S.loading
    : failed
      ? {
          ja: '画面の一覧を読み込めませんでした。画面を再読み込みしてから開き直してください。',
          en: 'The list of screens could not be loaded. Reload the page and open this again.',
        }
      : query.trim()
        ? {
            ja: '一致する画面や開いた記録がありません。語を減らすか、すべての画面から探してください。',
            en: 'No matching screen or recent record. Use fewer words, or search all screens.',
          }
        : {
            ja: 'お気に入りや最近開いた記録はまだありません。画面名を入力して探してください。',
            en: 'No favourites or recent records yet. Type a screen name to search.',
          };
  const count = options.length
    ? t({ ja: `${options.length} 件の候補`, en: `${options.length} suggestions` })
    : loading || failed
      ? t(empty)
      : t({ ja: '候補はありません', en: 'No suggestions' });
  return (
    <Dialog title={t(PALETTE_TITLE)} onClose={onClose} closeLabel={t(S.close)} className="command-palette">
      <div className="palette-search">
        <Icon name="search" size={17} />
        <input
          type="text"
          role="combobox"
          data-autofocus
          aria-label={t({ ja: '画面名や記録名で検索', en: 'Search by screen or record name' })}
          placeholder={t({ ja: '画面名・記録名・URL', en: 'Screen, record or URL' })}
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={selected >= 0 ? optionId(selected) : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={keyDown}
        />
      </div>
      <span className="sr-only" aria-live="polite">
        {count}
      </span>
      <div
        id={listId}
        role="listbox"
        className="palette-list"
        aria-label={t({ ja: '候補', en: 'Suggestions' })}
        aria-busy={loading || undefined}
        hidden={!options.length}
      >
        {palette.groups.map((group) => (
          <div key={group.id} role="group" aria-labelledby={`${listId}-${group.id}`}>
            <div id={`${listId}-${group.id}`} role="presentation" className="palette-group-label">
              {t(GROUP_LABELS[group.id])}
            </div>
            {group.options.map((option) => {
              index += 1;
              const position = index;
              const detail = option.kind === 'record' ? recentRecordDetail(option.record) : undefined;
              return (
                <div
                  key={option.key}
                  id={optionId(position)}
                  role="option"
                  aria-selected={position === selected}
                  className="palette-option"
                  data-href={
                    option.kind === 'screen' ? option.entry.href : `/e/${option.record.entity}/${option.record.id}`
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => {
                    if (position !== selected) setActive(position);
                  }}
                  onClick={() => choose(option)}
                >
                  <Icon
                    name={option.kind === 'record' ? 'clock' : group.id === 'favorites' ? 'star' : 'arrow'}
                    size={15}
                  />
                  {option.kind === 'screen' ? (
                    <span className="palette-option-text">
                      <span>{t(option.entry.label)}</span>
                      <small>{t(WORKSPACE_LABELS.get(option.entry.workspace))}</small>
                    </span>
                  ) : (
                    <span className="palette-option-text">
                      <span>{recentRecordText(option.record, locale)}</span>
                      {detail ? <small>{t(detail)}</small> : null}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {!options.length ? (
        <div className="palette-empty" data-state={loading ? 'loading' : failed ? 'error' : 'empty'}>
          {t(empty)}
        </div>
      ) : null}
      <div className="palette-footer">
        <span aria-hidden="true">
          {t({ ja: '↑↓ で選択・Enter で開く・Esc で閉じる', en: '↑↓ to move · Enter to open · Esc to close' })}
        </span>
        <Link to="/workspaces" search={query.trim() ? { q: query.trim().slice(0, 120) } : {}} onClick={onClose}>
          {palette.moreScreens
            ? t({
                ja: `ほか ${palette.moreScreens} 画面をすべての画面で見る`,
                en: `See ${palette.moreScreens} more in all screens`,
              })
            : t({ ja: 'すべての画面を探す', en: 'Find a screen' })}
        </Link>
      </div>
    </Dialog>
  );
}
