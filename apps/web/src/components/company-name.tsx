import { useCompanyName } from '../api/company.tsx';
import { useLocale } from '../i18n.tsx';

export function CompanyName() {
  const name = useCompanyName();
  const { t } = useLocale();
  return (
    <span className="company-name" title={name ?? undefined}>
      {name ?? t({ ja: '大福帳 / ワークスペース', en: 'Daifuku / Workspace' })}
    </span>
  );
}
