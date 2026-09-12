// Occupancy and rent roll shaping (spec AC-1 unit.status, AC-4 real_estate.rent_roll). Pure: no DB, no clock.
// A unit is occupied on a date when a submitted lease (contract with ext.unitId) is signed for it and has not ended before
// that date — a lease starting later counts too (成約済み: the unit is no longer available for letting). The lease shown
// for the unit is the one already in force, else the earliest upcoming one.
import { Decimal, StateError, type LocalDate } from '@daifuku/kernel';
import { isTaxableCategory, rentTaxCategory, type UnitUsage } from './tax-rule.ts';

export const UNIT_STATUSES = ['vacant', 'occupied'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export interface LeaseTerm {
  startDate: LocalDate;
  endDate: LocalDate | null;
}

/** Leases that keep the unit occupied on `date`: not ended before it (endDate null or >= date). */
export function liveLeases<T extends LeaseTerm>(leases: readonly T[], date: LocalDate): T[] {
  return leases.filter((l) => l.endDate === null || l.endDate >= date);
}

/** The lease in force on `date` (latest start on or before it), else the earliest upcoming one, else null. */
export function leaseOn<T extends LeaseTerm>(leases: readonly T[], date: LocalDate): T | null {
  const live = liveLeases(leases, date);
  const current = live.filter((l) => l.startDate <= date).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  if (current.length > 1) throw new StateError('Conflicting leases exist for this unit and reporting date', 'Resolve the overlapping historical leases before rendering a rent roll; no lease is silently hidden.');
  if (current[0]) return current[0];
  const upcoming = [...live].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  return upcoming[0] ?? null;
}

export function unitStatusOn(leases: readonly LeaseTerm[], date: LocalDate): UnitStatus {
  return liveLeases(leases, date).length > 0 ? 'occupied' : 'vacant';
}

export interface RentRollUnit {
  id: string;
  propertyCode: string;
  propertyName: string;
  code: string;
  name: string;
  usage: UnitUsage;
  floorArea: Decimal | null;
  /** The unit's asking rent (shown for vacant units). */
  monthlyRent: Decimal;
}

export interface RentRollLease extends LeaseTerm {
  contractId: string;
  unitId: string;
  partnerId: string;
  partnerName: string;
  /** Monthly contract lines (税抜 amount = quantity × unit price). */
  lines: readonly { amount: Decimal; taxCategory: string }[];
}

export interface RentRollRow extends Record<string, unknown> {
  propertyName: string;
  unitCode: string;
  unitName: string;
  usage: UnitUsage;
  floorArea: string | null;
  monthlyRent: string;
  tenantName: string | null;
  startDate: LocalDate | null;
  endDate: LocalDate | null;
  status: UnitStatus;
  /** The single category of the lease lines, 'mixed' when they differ, the usage default for a vacant unit. */
  taxCategory: string;
  unitId: string;
  contractId: string | null;
  partnerId: string | null;
}

export interface RentRollTotals {
  /** Σ contracted monthly rent of occupied units (税抜). */
  monthlyRent: string;
  taxableRent: string;
  nonTaxableRent: string;
}

function lineCategory(lines: RentRollLease['lines']): string {
  const categories = [...new Set(lines.map((l) => l.taxCategory))];
  if (categories.length === 1 && categories[0] !== undefined) return categories[0];
  return categories.length === 0 ? '' : 'mixed';
}

function rowFor(unit: RentRollUnit, lease: RentRollLease | null): RentRollRow {
  const base = { propertyName: unit.propertyName, unitCode: unit.code, unitName: unit.name, usage: unit.usage, floorArea: unit.floorArea?.toString() ?? null, unitId: unit.id };
  if (lease === null) {
    return { ...base, monthlyRent: unit.monthlyRent.toString(), tenantName: null, startDate: null, endDate: null, status: 'vacant', taxCategory: rentTaxCategory(unit.usage), contractId: null, partnerId: null };
  }
  const rent = Decimal.sum(lease.lines.map((l) => l.amount));
  return {
    ...base,
    monthlyRent: rent.toString(),
    tenantName: lease.partnerName,
    startDate: lease.startDate,
    endDate: lease.endDate,
    status: 'occupied',
    taxCategory: lineCategory(lease.lines),
    contractId: lease.contractId,
    partnerId: lease.partnerId,
  };
}

/** One row per unit (property code, unit code order) as of `asOf`, and the occupied rent split taxable / non-taxable. */
export function rentRoll(units: readonly RentRollUnit[], leases: readonly RentRollLease[], asOf: LocalDate): { rows: RentRollRow[]; totals: RentRollTotals; counts: Record<UnitStatus, number> } {
  const sorted = [...units].sort((a, b) => (a.propertyCode === b.propertyCode ? (a.code < b.code ? -1 : 1) : a.propertyCode < b.propertyCode ? -1 : 1));
  let taxable = Decimal.zero();
  let nonTaxable = Decimal.zero();
  const rows = sorted.map((unit) => {
    const lease = leaseOn(
      leases.filter((l) => l.unitId === unit.id),
      asOf,
    );
    for (const l of lease?.lines ?? []) {
      if (isTaxableCategory(l.taxCategory)) taxable = taxable.plus(l.amount);
      else nonTaxable = nonTaxable.plus(l.amount);
    }
    return rowFor(unit, lease);
  });
  const counts = { vacant: rows.filter((r) => r.status === 'vacant').length, occupied: rows.filter((r) => r.status === 'occupied').length };
  return { rows, totals: { monthlyRent: taxable.plus(nonTaxable).toString(), taxableRent: taxable.toString(), nonTaxableRent: nonTaxable.toString() }, counts };
}
