// Setup health check of the sales module (docs/specs/setup-health.md AC-4): whether the invoice issuer resolves to a
// name of the business (sales.issuer, or company.profile's legal name) and carries a registration number.
import { companyProfileOf, getCompany, label, type HealthCheckDef } from '@daifuku/kernel';
import { resolveIssuer } from './actions/render-invoice-html.ts';

const SALES_TAB = '/settings?tab=sales';
const COMPANY_TAB = '/settings?tab=company';

export const issuerHealthCheck: HealthCheckDef = {
  id: 'sales.issuer',
  label: label('請求書の発行者', 'Invoice issuer'),
  order: 40,
  run: async (ctx) => {
    const company = await getCompany(ctx);
    const resolved = resolveIssuer(company);
    const profile = companyProfileOf(company.settings);
    const fixAt = resolved.source === 'sales.issuer' ? SALES_TAB : COMPANY_TAB;
    if (resolved.invalidIssuer)
      return {
        status: 'warn',
        detail: label(
          '保存されている「請求書の発行者」が定義に合わないため、会社プロフィールから印字しています。販売タブで保存し直してください。',
          'The stored invoice issuer does not match its definition, so the company profile is printed. Save it again on the Sales tab.',
        ),
        href: SALES_TAB,
      };
    if (resolved.source === 'company.profile' && !profile.legalName)
      return {
        status: 'warn',
        detail: label(
          '請求書の発行者も会社プロフィールの正式名称も未設定で、会社名だけが印字されます。',
          'Neither the invoice issuer nor the legal name of the company profile is set; only the company name is printed.',
        ),
        href: COMPANY_TAB,
      };
    if (!resolved.issuer.invoiceRegistrationNo && profile.taxStatus !== 'exempt')
      return {
        status: 'warn',
        detail: label(
          '請求書に登録番号（T+13 桁）が印字されません。適格請求書発行事業者なら登録番号を入れてください（免税事業者なら会社プロフィールで「免税事業者」を選ぶとこの注意は消えます）。',
          'Invoices print no registration number (T + 13 digits). Enter it if the company is a registered issuer (choose "Exempt business" in the company profile if it is exempt).',
        ),
        href: fixAt,
      };
    return {
      status: 'ok',
      detail:
        resolved.source === 'sales.issuer'
          ? label(
              `「請求書の発行者」の ${resolved.issuer.name} を印字します。`,
              `Prints ${resolved.issuer.name} from the invoice issuer setting.`,
            )
          : label(
              `会社プロフィールの ${resolved.issuer.name} を印字します。`,
              `Prints ${resolved.issuer.name} from the company profile.`,
            ),
      href: fixAt,
    };
  },
};
