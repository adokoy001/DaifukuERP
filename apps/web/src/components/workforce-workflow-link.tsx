import { Link } from '@tanstack/react-router';
import { useMeta } from '../api/queries.ts';
import { useLocale } from '../i18n.tsx';
import { isWorkforceManaged } from '../lib/workforce-entity.ts';
export function WorkforceWorkflowLink({ entity }: { entity: string }) {
  const { t } = useLocale(),
    meta = useMeta();
  if (!isWorkforceManaged(entity)) return null;
  const actions = meta.data?.actions ?? [],
    manager = actions.some((a) => a.name === 'workforce.management_portal'),
    employee = actions.some((a) => a.name === 'workforce.my_portal');
  return (
    <div className="workforce-notice">
      <p>
        {t({
          ja: '従業員の登録・打刻・申請・承認・給与確定は、専用の業務画面から操作します。',
          en: 'Use the workforce pages to register employees, clock time, request, approve and confirm payroll.',
        })}
      </p>
      {manager ? (
        <Link className="btn" to="/workforce">
          {t({ ja: '従業員・勤怠管理を開く', en: 'Open workforce management' })}
        </Link>
      ) : employee ? (
        <Link className="btn" to="/me">
          {t({ ja: '自分の勤怠・申請を開く', en: 'Open my workday' })}
        </Link>
      ) : null}
    </div>
  );
}
