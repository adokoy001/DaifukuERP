// list-workbench AC-5: name and save the current filters, sort, search and columns; open or delete saved views (kit
// Dialog). Views live in this browser only, per user, tenant, company and entity (lib/list-views.ts).
import { useId, useState } from 'react';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { MAX_SAVED_VIEWS, type SavedListView } from '../lib/list-views.ts';
import { S } from '../strings.ts';
import { Button, Dialog } from '../ui/index.ts';

const W = {
  title: { ja: '保存ビュー', en: 'Saved views' },
  description: {
    ja: '現在の絞り込み・並べ替え・検索語・列に名前を付けて保存します。保存先はこのブラウザで、利用者・会社ごとです。',
    en: 'Save the current filters, sort, search and columns under a name. Stored in this browser for you and this company.',
  },
  name: { ja: 'ビューの名前', en: 'View name' },
  sameName: { ja: '同じ名前のビューは上書きします。', en: 'A view with the same name is replaced.' },
  save: { ja: '現在の条件を保存', en: 'Save current view' },
  open: { ja: '呼び出す', en: 'Open' },
  remove: { ja: '削除', en: 'Delete' },
  none: { ja: '保存したビューはまだありません。', en: 'No saved views yet.' },
  back: { ja: '閉じる', en: 'Close' },
  full: { ja: `保存できるのは ${MAX_SAVED_VIEWS} 件までです。`, en: `Up to ${MAX_SAVED_VIEWS} views can be saved.` },
} satisfies Record<string, Label>;

interface Props {
  views: readonly SavedListView[];
  busy: boolean;
  /** Already-translated storage failure, shown under the form. */
  error?: string;
  onSave: (name: string) => void;
  onOpen: (view: SavedListView) => void;
  onDelete: (view: SavedListView) => void;
  onClose: () => void;
}

export function ListViewsDialog({ views, busy, error, onSave, onOpen, onDelete, onClose }: Props) {
  const { t, locale } = useLocale();
  const nameId = useId();
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const replaces = views.some((v) => v.name.trim() === trimmed);
  const full = views.length >= MAX_SAVED_VIEWS && !replaces;
  return (
    <Dialog
      title={t(W.title)}
      description={t(W.description)}
      closeLabel={t(S.close)}
      onClose={onClose}
      className="list-views-dialog"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && !busy && !full) onSave(trimmed);
      }}
      actions={
        <Button onClick={onClose} data-autofocus>
          {t(W.back)}
        </Button>
      }
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-xs font-semibold text-text-secondary">
          {t(W.name)}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={nameId}
            className="input min-w-0 flex-1"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={`${nameId}-hint`}
          />
          <Button type="submit" variant="primary" disabled={!trimmed || busy || full}>
            {t(W.save)}
          </Button>
        </div>
        <p id={`${nameId}-hint`}>{t(full ? W.full : W.sameName)}</p>
        {error ? (
          <p className="ui-field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {views.length === 0 ? (
        <p>{t(W.none)}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2" data-testid="saved-views">
          {views.map((view) => (
            <li key={view.id} className="flex flex-wrap items-center gap-2" data-view={view.name}>
              <span className="min-w-0 flex-1 text-sm font-semibold text-text">
                {view.name}
                <span className="ml-2 font-normal text-text-muted text-xs">
                  {new Date(view.updatedAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-GB')}
                </span>
              </span>
              <Button size="sm" onClick={() => onOpen(view)} aria-label={`${t(W.open)}: ${view.name}`}>
                {t(W.open)}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onDelete(view)}
                aria-label={`${t(W.remove)}: ${view.name}`}
              >
                {t(W.remove)}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
