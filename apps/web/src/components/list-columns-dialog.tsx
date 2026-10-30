// list-workbench AC-4: choose and order the generic list's columns (kit Dialog). "Reset" returns to views.list.
import { useState } from 'react';
import type { FieldMeta, Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { moveColumn } from '../lib/list-views.ts';
import { S } from '../strings.ts';
import { Button, Dialog } from '../ui/index.ts';

const W = {
  title: { ja: '表示する列', en: 'Columns' },
  description: {
    ja: 'チェックした列を上から順に表示します。この設定はこのブラウザに、利用者・会社ごとに保存されます。',
    en: 'Checked columns are shown in this order. Saved in this browser for you and this company.',
  },
  up: { ja: '上へ', en: 'Move up' },
  down: { ja: '下へ', en: 'Move down' },
  reset: { ja: '既定に戻す', en: 'Reset to default' },
  apply: { ja: '適用', en: 'Apply' },
  back: { ja: '戻る', en: 'Go back' },
  none: { ja: '1 列以上を選んでください。', en: 'Choose at least one column.' },
} satisfies Record<string, Label>;

interface Props {
  candidates: readonly FieldMeta[];
  /** Visible column names in order. */
  current: readonly string[];
  onApply: (names: string[]) => void;
  onReset: () => void;
  onClose: () => void;
}

export function ListColumnsDialog({ candidates, current, onApply, onReset, onClose }: Props) {
  const { t } = useLocale();
  const [order, setOrder] = useState<string[]>(() => [
    ...current.filter((n) => candidates.some((f) => f.name === n)),
    ...candidates.map((f) => f.name).filter((n) => !current.includes(n)),
  ]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(current));
  const labelOf = (name: string) => t(candidates.find((f) => f.name === name)?.label, name);
  const picked = order.filter((n) => checked.has(n));
  return (
    <Dialog
      title={t(W.title)}
      description={t(W.description)}
      closeLabel={t(S.close)}
      onClose={onClose}
      className="list-columns-dialog"
      onSubmit={(e) => {
        e.preventDefault();
        if (picked.length) onApply(picked);
      }}
      actions={
        <>
          <Button onClick={onReset}>{t(W.reset)}</Button>
          <Button onClick={onClose} data-autofocus>
            {t(W.back)}
          </Button>
          <Button type="submit" variant="primary" disabled={picked.length === 0}>
            {t(W.apply)}
          </Button>
        </>
      }
    >
      <ul className="flex max-h-[50dvh] flex-col gap-1 overflow-auto" data-testid="column-options">
        {order.map((name, index) => (
          <li key={name} className="flex items-center gap-2" data-column={name}>
            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="ui-row-check"
                checked={checked.has(name)}
                onChange={(e) =>
                  setChecked((s) => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(name);
                    else next.delete(name);
                    return next;
                  })
                }
              />
              <span className="min-w-0 truncate">{labelOf(name)}</span>
            </label>
            <Button
              size="sm"
              aria-label={`${t(W.up)}: ${labelOf(name)}`}
              disabled={index === 0}
              onClick={() => setOrder((o) => moveColumn(o, index, -1))}
            >
              ↑
            </Button>
            <Button
              size="sm"
              aria-label={`${t(W.down)}: ${labelOf(name)}`}
              disabled={index === order.length - 1}
              onClick={() => setOrder((o) => moveColumn(o, index, 1))}
            >
              ↓
            </Button>
          </li>
        ))}
      </ul>
      {picked.length === 0 ? <p className="ui-field-error">{t(W.none)}</p> : null}
    </Dialog>
  );
}
