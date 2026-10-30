// form-ergonomics AC-10: the keyboard shortcuts of the generic form, opened from the "?" button of the form bar.
import { useState } from 'react';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { IS_MAC, shortcutLabel } from '../lib/form-shortcuts.ts';
import { S } from '../strings.ts';
import { Button, Dialog } from '../ui/index.ts';

/** The rows of the shortcut list (exported for the unit test of the texts). */
export function shortcutRows(mac: boolean): { keys: string; label: Label }[] {
  const mod = mac ? '⌘' : 'Ctrl+';
  return [
    { keys: shortcutLabel('S', mac).text, label: { ja: '保存', en: 'Save' } },
    {
      keys: shortcutLabel('Enter', mac).text,
      label: {
        ja: '確定の確認を開く（未保存の変更があるとき・新規・確定できない記録では保存）',
        en: 'Open the submit confirmation (saves instead when there are unsaved changes, on a new or non-submittable record)',
      },
    },
    {
      keys: 'Enter',
      label: {
        ja: '明細: 次の欄へ。行の最後の欄では次の行、最後の行では行を追加',
        en: 'Lines: next cell; from the last cell to the next row, after the last row a new row',
      },
    },
    { keys: 'Alt+↑ / Alt+↓', label: { ja: '明細: 行を上下に移動', en: 'Lines: move the row up or down' } },
    { keys: `${mod}K`, label: { ja: '画面と記録を検索', en: 'Search screens and records' } },
  ];
}

export function FormShortcutsHelp() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const title = t({ ja: 'キーボード操作', en: 'Keyboard shortcuts' });
  return (
    <>
      <Button
        size="sm"
        className="form-help-button"
        aria-haspopup="dialog"
        aria-label={title}
        title={title}
        data-testid="form-shortcuts"
        onClick={() => setOpen(true)}
      >
        ?
      </Button>
      {open ? (
        <Dialog
          title={title}
          closeLabel={t(S.close)}
          onClose={() => setOpen(false)}
          actions={
            <Button onClick={() => setOpen(false)} data-autofocus>
              {t(S.close)}
            </Button>
          }
        >
          <table className="w-full text-left text-xs" data-testid="form-shortcut-list">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-3">
                  {t({ ja: 'キー', en: 'Keys' })}
                </th>
                <th scope="col" className="py-1">
                  {t({ ja: '動作', en: 'Action' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {shortcutRows(IS_MAC).map((row) => (
                <tr key={row.keys}>
                  <td className="py-1 pr-3 align-top whitespace-nowrap">
                    <kbd className="font-mono">{row.keys}</kbd>
                  </td>
                  <td className="py-1">{t(row.label)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Dialog>
      ) : null}
    </>
  );
}
