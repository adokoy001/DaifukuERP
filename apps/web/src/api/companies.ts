// Company administration (docs/specs/company-admin.md AC-1..AC-5, AC-9): GET/POST/PATCH /admin/companies. The API
// checks the tenant administrator on every call; a created or renamed company also refreshes the company picker.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client.ts';
import { meKey } from './company.tsx';

export interface AdminCompany {
  id: string;
  code: string;
  name: string;
  country: string;
  currency: string;
  createdAt: string;
  member: boolean;
}
export interface CreatedCompany extends Omit<AdminCompany, 'member'> {
  seededModules: string[];
}
export interface CompanyInput {
  code: string;
  name: string;
  country: string;
  currency: string;
}

export const adminCompaniesKey = ['admin-companies'] as const;
/** The company picker's query (api/templates.ts useCompanies). */
const pickerKey = ['companies'] as const;

export function useAdminCompanies(enabled: boolean) {
  return useQuery({
    queryKey: adminCompaniesKey,
    queryFn: () => request<{ items: AdminCompany[] }>('/admin/companies'),
    enabled,
    retry: false,
  });
}

function useRefreshCompanies() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: adminCompaniesKey }),
      qc.invalidateQueries({ queryKey: pickerKey }),
      qc.invalidateQueries({ queryKey: meKey }),
    ]);
}

export function useCreateCompany() {
  const refresh = useRefreshCompanies();
  return useMutation({
    mutationFn: (input: CompanyInput) => request<CreatedCompany>('/admin/companies', { method: 'POST', body: input }),
    onSuccess: refresh,
  });
}

export function useUpdateCompany() {
  const refresh = useRefreshCompanies();
  return useMutation({
    mutationFn: (input: { id: string; name: string; country: string }) =>
      request<Omit<AdminCompany, 'member'>>('/admin/companies/' + encodeURIComponent(input.id), {
        method: 'PATCH',
        body: { name: input.name, country: input.country },
      }),
    onSuccess: refresh,
  });
}
