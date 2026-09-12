import type { ReactNode } from 'react';
import { useLocale } from '../i18n.tsx';
export type FiscalLabel = { ja: string; en: string };
export function FiscalMoneyField({ name, label, value = '0' }: { name: string; label: FiscalLabel; value?: string }) {
  const { t } = useLocale(); return <label>{t(label)}<input className="input" name={name} defaultValue={value} inputMode="numeric" pattern="[0-9]{1,12}" required aria-description={t({ ja: '円単位の整数。該当なしは0。', en: 'Whole yen. Enter 0 if not applicable.' })} /></label>;
}
export function FiscalCheck({ name, label, checked = false, required = false }: { name: string; label: FiscalLabel; checked?: boolean; required?: boolean }) {
  const { t } = useLocale(); return <label className="workforce-checkbox"><input type="checkbox" name={name} defaultChecked={checked} required={required} />{t(label)}</label>;
}
export function FiscalSection({ title, children }: { title: FiscalLabel; children: ReactNode }) {
  const { t } = useLocale(); return <section className="fiscal-form-section"><h3>{t(title)}</h3><div className="workforce-form-fields">{children}</div></section>;
}
export const disabilityOptions = [{ value: 'none', label: { ja: '該当なし', en: 'None' } }, { value: 'ordinary', label: { ja: '一般障害者', en: 'Disability' } }, { value: 'special', label: { ja: '特別障害者', en: 'Special disability' } }, { value: 'cohabiting_special', label: { ja: '同居特別障害者', en: 'Cohabiting special disability' } }];
export function DisabilityField({ name, value = 'none', taxpayer = false }: { name: string; value?: string; taxpayer?: boolean }) {
  const { t } = useLocale(); return <label>{t({ ja: '障害者区分', en: 'Disability category' })}<select className="input" name={name} defaultValue={value}>{disabilityOptions.filter((option) => !taxpayer || option.value !== 'cohabiting_special').map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>;
}
