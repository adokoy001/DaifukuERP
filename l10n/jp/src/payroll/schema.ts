import { z } from 'zod';
import { Decimal, ValidationError } from '@daifuku/kernel';
import type { PayrollRuleBundle } from '@daifuku/mod-workforce';

const amount = z.number().int().nonnegative();
const positiveAmount = amount.positive();
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
const positiveDecimal = decimal.refine((value) => Decimal.from(value).gt(0));
const date = z.iso.date();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const year = z.number().int().min(1900).max(9999);
const period = (value: z.ZodType<string>) =>
  z.strictObject({ from: value, to: value }).refine((range) => range.from <= range.to);
const upperAmount = z.tuple([amount, amount]);
const monthlySalary = z.strictObject({ to: amount.nullable(), rate: decimal, fixed: amount });
const monthlyTax = z.strictObject({ to: amount.nullable(), rate: decimal, offset: amount });
const annualTax = z.strictObject({ to: amount, rate: decimal, offset: amount });

export const payrollParametersSchema = z.strictObject({
  legacySnapshotSchema: z.literal(1).optional(),
  insurance: z.strictObject({
    nursingAgeFrom: amount,
    nursingAgeToExclusive: positiveAmount,
    healthAgeToExclusive: positiveAmount,
    pensionAgeToExclusive: positiveAmount,
    employeePercentDivisor: positiveDecimal,
    roundingThreshold: decimal.refine((value) => Decimal.from(value).lt(1)),
  }),
  life: z.strictObject({
    secondBandMultiple: positiveDecimal,
    thirdBandMultiple: positiveDecimal,
    secondDivisor: positiveDecimal,
    thirdDivisor: positiveDecimal,
    secondOffsetDivisor: positiveDecimal,
    capMultiple: positiveDecimal,
  }),
  oldEarthquakeDivisor: positiveDecimal,
  rounding: z.strictObject({
    insurance: z.literal('fraction-strictly-above-threshold-v1'),
    monthlySalary: z.literal('ceil-yen-v1'),
    monthlyTax: z.literal('half-up-unit-v1'),
    annualSalary: z.literal('floor-yen-v1'),
    annualIncomeAdjustment: z.literal('ceil-yen-v1'),
    annualDeductions: z.literal('ceil-yen-v1'),
    annualTaxableIncome: z.literal('floor-unit-v1'),
    annualTax: z.literal('floor-unit-v1'),
  }),
});

export const payrollManifestSchema = z.strictObject({
  manifestSchema: z.literal(1),
  packageCode: z.string().min(1),
  revision: positiveAmount,
  country: z.literal('JP'),
  currency: z.literal('JPY'),
  regime: z.literal('regular-ko-year-end'),
  taxYear: year,
  dataSchema: z.literal('jp-payroll-data-v1'),
  algorithmVersion: z.literal('jp-regular-v1'),
  parameters: payrollParametersSchema,
  applicability: z.strictObject({
    paymentDates: period(date),
    insuranceMonths: period(month),
    wageCutoffDates: period(date),
    adjustmentDates: period(date),
    yearEndFactsOn: date,
    requiredFinalPaymentFrom: date,
  }),
  supersedesPackageCode: z.string().min(1).optional(),
});

export const payrollDataSchema = z.strictObject({
  code: z.string().min(1),
  taxYear: year,
  currency: z.literal('JPY'),
  verifiedOn: date,
  monthlyTax: z.strictObject({
    from: date,
    to: date,
    method: z.literal('ko-electronic-exception'),
    dependent: amount,
    salary: z.array(monthlySalary).min(1),
    basic: z.array(upperAmount).min(1),
    tax: z.array(monthlyTax).min(1),
    taxRoundUnit: positiveAmount,
  }),
  annualTax: z.strictObject({
    year,
    applicableFrom: date,
    regularAdjustmentThrough: date,
    salaryLimit: positiveAmount,
    salaryClassUnit: positiveAmount,
    salary: z
      .array(z.strictObject({ to: amount, rate: decimal, offset: z.number().int(), classed: z.boolean() }))
      .min(1),
    basic: z.array(upperAmount).min(1),
    tax: z.array(annualTax).min(1),
    incomeAdjustment: z.strictObject({ above: amount, cap: amount, rate: decimal }),
    taxableRoundUnit: positiveAmount,
    taxRoundUnit: positiveAmount,
    reconstructionFactor: positiveDecimal,
  }),
  deductions: z.strictObject({
    year,
    dependentIncomeLimit: amount,
    dependentMinimumAge: amount,
    specificAgeFrom: amount,
    specificAgeTo: amount,
    elderlyAge: amount,
    childLifeAgeLimit: amount,
    spouseTaxpayerBands: z.array(amount).min(1),
    spouseOrdinary: z.array(amount).min(1),
    spouseElderly: z.array(amount).min(1),
    spouseSpecial: z.array(z.tuple([amount, amount]).rest(amount)).min(1),
    relativeOrdinary: amount,
    relativeSpecific: amount,
    relativeElderly: amount,
    relativeCohabitingElderly: amount,
    relativeSpecial: z.array(upperAmount).min(1),
    disability: z.strictObject({ none: amount, ordinary: amount, special: amount, cohabiting_special: amount }),
    widow: amount,
    singleParent: amount,
    singleIncomeLimit: amount,
    student: amount,
    studentIncomeLimit: amount,
    studentNonWorkLimit: amount,
    life: z.strictObject({
      oldUnit: positiveAmount,
      modernUnit: positiveAmount,
      childUnit: positiveAmount,
      modernCombinedCap: amount,
      childCombinedCap: amount,
      totalCap: amount,
    }),
    earthquake: z.strictObject({ cap: amount, oldFirst: amount, oldSecond: amount, oldOffset: amount, oldCap: amount }),
  }),
  monthlyMethod: z.string().min(1),
  annualMethod: z.string().min(1),
  monthlyValidFrom: date,
  monthlyValidTo: date,
  annualApplicableFrom: date,
  health: z.array(z.strictObject({ from: month, to: month, percentages: z.array(decimal).length(47) })).min(1),
  nursing: z.array(z.strictObject({ from: month, to: month, percent: decimal })).min(1),
  childSupportFrom: month,
  childSupportPercent: decimal,
  pensionPercent: decimal,
  employment: z
    .array(z.strictObject({ from: date, to: date, general: decimal, agriculture_sake: decimal, construction: decimal }))
    .min(1),
  healthGrades: z.array(positiveDecimal).min(1),
  pensionGrades: z.array(positiveDecimal).min(1),
  insuranceRounding: z.string().min(1),
  monthlyTaxRounding: z.string().min(1),
  annualTaxRounding: z.string().min(1),
});

export type JapanPayrollData = z.infer<typeof payrollDataSchema>;
export type JapanPayrollParameters = z.infer<typeof payrollParametersSchema>;
export type JapanPayrollManifest = z.infer<typeof payrollManifestSchema>;
export interface JapanPayrollRules {
  data: JapanPayrollData;
  manifest: JapanPayrollManifest;
}

function invalid(message: string): never {
  throw new ValidationError('Invalid Japan payroll rules bundle', [{ path: 'rules', message }]);
}

function ascending(values: readonly number[], name: string): void {
  if (values.some((value, index) => index > 0 && value <= (values[index - 1] ?? value)))
    invalid(`${name} must be strictly ordered.`);
}

function orderedBands(rows: readonly { to: number | null }[], name: string, openEnded = false): void {
  if (rows.some((row, index) => row.to === null && index !== rows.length - 1))
    invalid(`${name} has an early unbounded band.`);
  if (openEnded && rows.at(-1)?.to !== null) invalid(`${name} needs a final unbounded band.`);
  ascending(
    rows.flatMap((row) => (row.to === null ? [] : [row.to])),
    name,
  );
}

function nextPeriod(value: string): string {
  const isMonth = value.length === 7;
  const d = new Date(`${isMonth ? `${value}-01` : value}T12:00:00Z`);
  if (isMonth) d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, isMonth ? 7 : 10);
}

function coverage(
  rows: readonly { from: string; to: string }[],
  range: { from: string; to: string },
  name: string,
): void {
  if (
    rows[0]?.from !== range.from ||
    rows.at(-1)?.to !== range.to ||
    rows.some(
      (row, index) => row.from > row.to || (index > 0 && nextPeriod(rows[index - 1]?.to ?? row.to) !== row.from),
    )
  )
    invalid(`${name} must cover its declared period without overlaps or gaps.`);
}

/** Parse the caller's payload; validation never substitutes the shipped catalog data. */
export function parseJapanPayrollRules(bundle: PayrollRuleBundle): JapanPayrollRules {
  const parsedData = payrollDataSchema.safeParse(bundle.data);
  const parsedManifest = payrollManifestSchema.safeParse(bundle.manifest);
  if (!parsedData.success || !parsedManifest.success)
    invalid('Unsupported schema, algorithm, rounding profile or malformed parameters.');
  const data = parsedData.data,
    manifest = parsedManifest.data,
    range = manifest.applicability;
  if (
    bundle.code !== data.code ||
    bundle.code !== manifest.packageCode ||
    bundle.taxYear !== data.taxYear ||
    bundle.taxYear !== manifest.taxYear ||
    bundle.taxYear !== data.annualTax.year ||
    bundle.taxYear !== data.deductions.year ||
    bundle.verifiedOn !== data.verifiedOn ||
    !z.array(z.url()).min(1).safeParse(bundle.sources).success
  )
    invalid('The payload identity, tax year, verification date and sources must agree.');
  if (
    data.monthlyTax.from !== range.paymentDates.from ||
    data.monthlyValidFrom !== range.paymentDates.from ||
    data.monthlyTax.to !== range.paymentDates.to ||
    data.monthlyValidTo !== range.paymentDates.to ||
    data.annualApplicableFrom !== range.adjustmentDates.from ||
    data.annualTax.applicableFrom !== range.adjustmentDates.from ||
    data.annualTax.regularAdjustmentThrough !== range.adjustmentDates.to ||
    range.yearEndFactsOn.slice(0, 4) !== String(bundle.taxYear) ||
    range.requiredFinalPaymentFrom < range.paymentDates.from ||
    range.requiredFinalPaymentFrom > range.paymentDates.to
  )
    invalid('Data periods and the manifest applicability must agree.');
  coverage(data.health, range.insuranceMonths, 'Health insurance');
  coverage(data.nursing, range.insuranceMonths, 'Nursing insurance');
  coverage(data.employment, range.wageCutoffDates, 'Employment insurance');
  orderedBands(data.monthlyTax.salary, 'Monthly salary', true);
  orderedBands(data.monthlyTax.tax, 'Monthly tax', true);
  orderedBands(data.annualTax.salary, 'Annual salary');
  orderedBands(data.annualTax.tax, 'Annual tax');
  for (const [name, rows] of [
    ['Monthly basic', data.monthlyTax.basic],
    ['Annual basic', data.annualTax.basic],
    ['Spouse special', data.deductions.spouseSpecial],
    ['Relative special', data.deductions.relativeSpecial],
  ] as const)
    ascending(
      rows.map((row) => row[0]),
      name,
    );
  ascending(data.deductions.spouseTaxpayerBands, 'Spouse income');
  for (const grades of [data.healthGrades, data.pensionGrades]) {
    if (grades.some((grade, index) => index > 0 && Decimal.from(grade).lte(grades[index - 1] ?? grade)))
      invalid('Insurance grades must be strictly ordered.');
  }
  if (
    data.annualTax.salary.at(-1)?.to !== data.annualTax.salaryLimit ||
    data.annualTax.incomeAdjustment.cap < data.annualTax.incomeAdjustment.above ||
    data.deductions.spouseOrdinary.length !== data.deductions.spouseTaxpayerBands.length ||
    data.deductions.spouseElderly.length !== data.deductions.spouseTaxpayerBands.length ||
    data.deductions.spouseSpecial.some((row) => row.length !== data.deductions.spouseTaxpayerBands.length + 1) ||
    manifest.parameters.insurance.nursingAgeFrom >= manifest.parameters.insurance.nursingAgeToExclusive ||
    Decimal.from(manifest.parameters.life.secondBandMultiple).gte(manifest.parameters.life.thirdBandMultiple)
  )
    invalid('The table dimensions and parameter bounds are inconsistent.');
  return { data, manifest };
}
