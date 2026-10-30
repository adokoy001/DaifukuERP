// The issuer block's data (docs/specs/print-templates.md AC-9). `company.profile` -> issuer lives here once; sales'
// resolveIssuer (B2) uses it as its fallback, and the payslip uses it with the registration number left out.
import { companyProfileOf } from '@daifuku/kernel';

export interface PrintIssuer {
  name: string;
  invoiceRegistrationNo?: string;
  postalCode?: string;
  address?: string;
  phone?: string;
  email?: string;
  bankInfo?: string;
}

/** Drops undefined/null keys so optional properties are absent, not undefined (exactOptionalPropertyTypes). */
export function definedProps<T>(o: object): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;
}

/**
 * The issuer from the company's `company.profile` (docs/specs/company-admin.md AC-7): the legal name (else the company
 * name), registration number, postal code, address, phone and email. `registrationNo: false` leaves the number out
 * (payslip: an employer statement, not a tax document). Unset or invalid profiles read as empty.
 */
export function issuerFromCompanyProfile(
  company: { name: string; settings: Readonly<Record<string, unknown>> },
  opts: { registrationNo?: boolean; email?: boolean } = {},
): PrintIssuer {
  const profile = companyProfileOf(company.settings);
  return definedProps<PrintIssuer>({
    name: profile.legalName ?? company.name,
    invoiceRegistrationNo: opts.registrationNo === false ? undefined : profile.invoiceRegistrationNo,
    postalCode: profile.postalCode,
    address: profile.address,
    phone: profile.phone,
    email: opts.email === false ? undefined : profile.email,
  });
}
