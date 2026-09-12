import { useLocale } from '../i18n.tsx';
const labels: Record<string, { ja: string; en: string }> = { admin: { ja: '会社管理者', en: 'Company administrator' }, accounting: { ja: '経理', en: 'Accounting' }, sales: { ja: '販売', en: 'Sales' }, purchase: { ja: '購買', en: 'Purchasing' }, inventory: { ja: '在庫', en: 'Inventory' }, viewer: { ja: '閲覧者', en: 'Viewer' }, chain_staff: { ja: '店舗スタッフ', en: 'Store staff' }, chain_manager: { ja: '店長', en: 'Store manager' }, settings: { ja: '会社設定担当', en: 'Company settings' } };
Object.assign(labels, { edge_manager: { ja: '店舗機器の管理', en: 'Store device manager' }, edge_operator: { ja: '店舗機器の操作', en: 'Store device operator' }, workforce_employee: { ja: '従業員（本人）', en: 'Employee (self)' }, workforce_manager: { ja: '拠点の勤怠・申請管理', en: 'Site workforce manager' }, workforce_hr: { ja: '本部の人事・労務', en: 'Headquarters HR' }, workforce_payroll: { ja: '給与担当', en: 'Payroll administrator' } });
export function accessRoleLabel(role: string) { return labels[role] ?? { ja: role, en: role }; }
export function AccessRoleOptions({ options, value, onChange, disabled }: { options: string[]; value: string[]; onChange: (roles: string[]) => void; disabled: boolean }) {
  const { t } = useLocale();
  return <div className="access-role-options">{options.map((role) => <label key={role}><input type="checkbox" disabled={disabled} checked={value.includes(role)} onChange={(e) => onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))} /><span>{labels[role] ? t(labels[role]) : role}</span></label>)}</div>;
}
