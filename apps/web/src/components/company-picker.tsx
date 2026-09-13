import { useState } from 'react';
import { getCompanyId, setActiveCompany } from '../api/client.ts';
import { useCompanies } from '../api/templates.ts';
import { useLocale } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import { useToast } from './toast.tsx';

/** Mounted on the template page or an access-denied shell, never over an editable business form. */
export function CompanyPicker({ disabled }: { disabled: boolean }) {
  const { t } = useLocale();
  const companies = useCompanies();
  const toast = useToast();
  const [switching, setSwitching] = useState(false);
  const requested = getCompanyId() ?? companies.data?.companyId;
  const selected = companies.data?.items.some((c) => c.id === requested) ? requested : '';
  const change = (id: string) => {
    if (!companies.data?.items.some((c) => c.id === id) || id === selected) return;
    try {
      setSwitching(true);
      setActiveCompany(id);
      // A fresh page creates a fresh query cache; no prior-company data or in-flight reads survive the switch.
      globalThis.location.assign('/templates');
    } catch (err) {
      setSwitching(false);
      toast.error(err);
    }
  };
  return (
    <div className="company-picker">
      <Icon name="building" />
      <div>
        <label htmlFor="template-company">{t({ ja: '対象の会社', en: 'Selected company' })}</label>
        {companies.isError ? (
          <span role="alert">{t({ ja: '会社一覧を取得できませんでした', en: 'Unable to load companies' })}</span>
        ) : (
          <select
            id="template-company"
            value={selected ?? ''}
            disabled={disabled || switching || !companies.data}
            onChange={(e) => change(e.target.value)}
          >
            {!selected ? <option value="">{t({ ja: '会社を選択', en: 'Select a company' })}</option> : null}
            {companies.data?.items.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
