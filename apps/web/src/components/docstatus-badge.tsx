// AC-5: docstatus badge (下書き / 確定 / 取消).
import { useLocale } from '../i18n.tsx';
import { docstatusLabel } from '../lib/format.ts';

const CLASS: Record<0 | 1 | 2, string> = {
  0: 'bg-neutral-200 text-neutral-800',
  1: 'bg-emerald-100 text-emerald-800',
  2: 'bg-red-100 text-red-800',
};

export function DocstatusBadge({ docstatus }: { docstatus: unknown }) {
  const { t } = useLocale();
  const ds: 0 | 1 | 2 = docstatus === 1 || docstatus === 2 ? docstatus : 0;
  return (
    <span data-testid="docstatus" data-docstatus={ds} className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${CLASS[ds]}`}>
      {t(docstatusLabel(ds))}
    </span>
  );
}
