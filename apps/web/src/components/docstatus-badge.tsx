// AC-5: docstatus badge (下書き / 確定 / 取消), on the UI kit Badge.
import { useLocale } from '../i18n.tsx';
import { docstatusLabel } from '../lib/format.ts';
import { Badge, type BadgeTone } from '../ui/index.ts';

const TONE: Record<0 | 1 | 2, BadgeTone> = { 0: 'neutral', 1: 'success', 2: 'danger' };

export function DocstatusBadge({ docstatus }: { docstatus: unknown }) {
  const { t } = useLocale();
  const ds: 0 | 1 | 2 = docstatus === 1 || docstatus === 2 ? docstatus : 0;
  return (
    <Badge tone={TONE[ds]} data-testid="docstatus" data-docstatus={ds}>
      {t(docstatusLabel(ds))}
    </Badge>
  );
}
