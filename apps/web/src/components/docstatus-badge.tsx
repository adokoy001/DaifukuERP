// AC-5: docstatus badge (下書き / 確定 / 取消), on the UI kit Badge.
import { useLocale } from '../i18n.tsx';
import { docstatusLabel } from '../lib/format.ts';
import { Badge, type BadgeTone } from '../ui/index.ts';

const TONE: Record<0 | 1 | 2, BadgeTone> = { 0: 'neutral', 1: 'success', 2: 'danger' };

/** `testId` defaults to `docstatus` (the record page's own status); other places pass their own to keep that one unique. */
export function DocstatusBadge({ docstatus, testId = 'docstatus' }: { docstatus: unknown; testId?: string }) {
  const { t } = useLocale();
  const ds: 0 | 1 | 2 = docstatus === 1 || docstatus === 2 ? docstatus : 0;
  return (
    <Badge tone={TONE[ds]} data-testid={testId} data-docstatus={ds}>
      {t(docstatusLabel(ds))}
    </Badge>
  );
}
