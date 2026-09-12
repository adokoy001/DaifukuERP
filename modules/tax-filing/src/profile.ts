// Country packs register a pure formatter through the kernel's named override port.
import { registry, StateError } from '@daifuku/kernel';
import type { AccountingProfile, FilingExport, FilingIssue, FilingPayrollRow, FilingProfileOption, FilingStatement } from './contract.ts';
export const FILING_PROFILE_OVERRIDE = 'tax_filing.country_profiles';
export interface LedgerBalance { accountId: string; code: string; name: string; type: string; opening: string; debit: string; credit: string; closing: string }
export interface FilingSource { kind: 'accounting' | 'payroll'; country: string; currency: string; from: string; to: string; profile: Record<string, unknown>; balances: LedgerBalance[]; payrollRows: FilingPayrollRow[]; issues: FilingIssue[]; totals: Record<string, string | null>; versions: { entity: string; id: string; version: number }[]; records: Record<string, unknown> }
export interface FilingPrepared { statements: FilingStatement[]; payrollRows: FilingPayrollRow[]; issues: FilingIssue[]; totals: Record<string, string | null>; officialImport: boolean; notice: string }
export interface CountryFilingProfile { referenceArtifacts?: readonly { url: string; sha256: string; verifiedOn: string; version: string }[]; option: FilingProfileOption; kind: 'accounting' | 'payroll'; prepare(source: FilingSource): FilingPrepared; export(source: FilingSource, prepared: FilingPrepared): FilingExport['files']; validateProfile?(profile: AccountingProfile): void }
export type FilingProfiles = () => readonly CountryFilingProfile[];
export function filingProfiles(): readonly CountryFilingProfile[] { return registry.override<FilingProfiles>(FILING_PROFILE_OVERRIDE, () => [])(); }
export function filingProfile(code: string): CountryFilingProfile { const found = filingProfiles().find((p) => p.option.code === code); if (!found) throw new StateError('申告準備の国別形式が未登録です', '会社の国別ローカライズと対応形式を確認してください。'); return found; }
