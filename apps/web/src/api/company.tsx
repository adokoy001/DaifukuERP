// Company display context (web-polish, web-phase15 AC-4): the currency every money cell/input formats with comes from
// `GET /auth/me` `company.currency` (kernel-phase15). Money fields whose meta carries a `scale` use that instead
// (lib/format.ts decimalMinScale); this context matters for report columns and meta without a scale. One request per
// session, shared through context.
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { currencyOf, currencyScale } from '../lib/currency.ts';
import { request } from './client.ts';
import type { LoginUser } from './types.ts';

export interface MeResponse { user: LoginUser; companyId: string | null; company: { id: string; name: string; currency: string } | null }
export function useMe() { return useQuery({ queryKey: meKey, queryFn: () => request<MeResponse>('/auth/me'), staleTime: 15_000, refetchInterval: 30_000, refetchOnWindowFocus: 'always', retry: false }); }

export const meKey = ['me'] as const;

export interface CompanyDisplay {
  name: string | null;
  /** ISO 4217 code from /auth/me; null while loading or when the request has no company. */
  currency: string | null;
  /** Minimum fraction digits of money on screen (lib/format.ts). */
  currencyScale: number;
}

const UNKNOWN: CompanyDisplay = { name: null, currency: null, currencyScale: currencyScale(null) };

const CompanyContext = createContext<CompanyDisplay>(UNKNOWN);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const value = useMemo<CompanyDisplay>(() => {
    const code = currencyOf(me.data);
    const data = me.data as { company?: { name?: unknown } | null } | undefined;
    const name = typeof data?.company?.name === 'string' ? data.company.name : null;
    return { name, currency: code ?? null, currencyScale: currencyScale(code) };
  }, [me.data]);
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompanyName(): string | null {
  return useContext(CompanyContext).name;
}

/** Outside the provider (tests, login page) no currency is known: minimum 0 digits. */
export function useCurrencyScale(): number {
  return useContext(CompanyContext).currencyScale;
}
