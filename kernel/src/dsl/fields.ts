// Field builders for the entity DSL (ADR-0002). Types are inferred from the options object,
// so `Infer<typeof Entity>` gives the row type without codegen.
import type { Decimal } from '../decimal.ts';
import type { Label } from '../i18n.ts';
import type { LocalDate } from '../ids.ts';

export type FieldKind = 'text' | 'int' | 'decimal' | 'bool' | 'date' | 'timestamp' | 'enum' | 'ref' | 'json' | 'uuid';

export interface CommonOpts {
  label?: Label;
  description?: Label;
  /** NOT NULL. Defaults to false. */
  required?: boolean;
  /** Unique within tenant (and company when the entity is company-scoped). */
  unique?: boolean;
  index?: boolean;
  /** Cannot be changed after create (enforced by Repository.update). */
  immutable?: boolean;
  /** Hidden from generic UI by default. */
  hidden?: boolean;
  /** Never include in generated public output or audit snapshots, even for admin. Internal repository rows retain it. */
  outputHidden?: boolean;
  /** Only the owning module may supply this field; generic UI renders it read-only. */
  serverOwned?: boolean;
}

export interface TextOpts extends CommonOpts {
  default?: string;
  maxLength?: number;
  pattern?: RegExp;
  /** Normalisation applied before validation. */
  normalize?: 'trim' | 'halfwidth-kana' | 'upper';
  multiline?: boolean;
  /** Ext fields only (registry.registerExt): include in the generic `search` term. Entity fields use `views.search`. */
  searchable?: boolean;
}
export interface IntOpts extends CommonOpts {
  default?: number;
  min?: number;
  max?: number;
}
export interface DecimalOpts extends CommonOpts {
  default?: string;
  /** Display/validation scale. Storage is always numeric(20,6). */
  scale?: number;
  min?: string;
  /** Set by `f.money()`: an amount in the company currency. Without an explicit `scale`, meta derives it from the currency. */
  money?: boolean;
}
export interface BoolOpts extends CommonOpts {
  default?: boolean;
}
export interface DateOpts extends CommonOpts {
  default?: 'today';
}
export interface TimestampOpts extends CommonOpts {
  default?: 'now';
}
export interface EnumOpts<V extends string> extends CommonOpts {
  default?: V;
  labels?: Partial<Record<V, Label>>;
}
export interface RefOpts extends CommonOpts {
  onDelete?: 'restrict' | 'cascade' | 'set null';
  /** Field on the target used for display in generic UI (defaults to target's displayField). */
  displayField?: string;
}
export interface JsonOpts extends CommonOpts {
  default?: unknown;
}
export interface UuidOpts extends CommonOpts {
  default?: 'new';
}

type KindOpts =
  | TextOpts
  | IntOpts
  | DecimalOpts
  | BoolOpts
  | DateOpts
  | TimestampOpts
  | EnumOpts<string>
  | RefOpts
  | JsonOpts
  | UuidOpts;

/**
 * A field definition. `TValue` is the TS value type, `TRequired` whether NOT NULL,
 * `THasDefault` whether inserts may omit it. The phantom `__value` carries the type only.
 */
export interface FieldDef<
  TValue = unknown,
  TRequired extends boolean = boolean,
  THasDefault extends boolean = boolean,
> {
  readonly kind: FieldKind;
  readonly required: TRequired;
  readonly hasDefault: THasDefault;
  readonly opts: KindOpts;
  /** enum values / ref target — kind specific */
  readonly values?: readonly string[];
  readonly ref?: string;
  readonly __value?: TValue;
}

export type AnyField = FieldDef<unknown, boolean, boolean>;
export type FieldMap = Record<string, AnyField>;

type Req<O> = O extends { required: true } ? true : false;
type HasDef<O> = O extends { default: unknown } ? true : false;

function make<V, O extends KindOpts>(
  kind: FieldKind,
  opts: O | undefined,
  extra?: { values?: readonly string[]; ref?: string },
): FieldDef<V, Req<O>, HasDef<O>> {
  const o = (opts ?? {}) as O;
  return {
    kind,
    required: (o.required === true) as Req<O>,
    hasDefault: ('default' in o && o.default !== undefined) as HasDef<O>,
    opts: o,
    ...(extra?.values ? { values: extra.values } : {}),
    ...(extra?.ref ? { ref: extra.ref } : {}),
  };
}

export const f = {
  text<const O extends TextOpts>(opts?: O) {
    return make<string, O>('text', opts);
  },
  int<const O extends IntOpts>(opts?: O) {
    return make<number, O>('int', opts);
  },
  /** Arbitrary-precision decimal (numeric(20,6)). */
  decimal<const O extends DecimalOpts>(opts?: O) {
    return make<Decimal, O>('decimal', opts);
  },
  /** Sugar for money amounts. Scale comes from the currency at display time (meta.ts), unless `scale` is given. */
  money<const O extends DecimalOpts>(opts?: O) {
    return make<Decimal, O>('decimal', { money: true, ...opts } as O);
  },
  quantity<const O extends DecimalOpts>(opts?: O) {
    return make<Decimal, O>('decimal', { scale: 6, ...opts } as O);
  },
  bool<const O extends BoolOpts>(opts?: O) {
    return make<boolean, O>('bool', opts);
  },
  /** Business date, `YYYY-MM-DD`, no timezone. */
  date<const O extends DateOpts>(opts?: O) {
    return make<LocalDate, O>('date', opts);
  },
  /** Event time, timestamptz. */
  timestamp<const O extends TimestampOpts>(opts?: O) {
    return make<Date, O>('timestamp', opts);
  },
  enum<const V extends readonly [string, ...string[]], const O extends EnumOpts<V[number]>>(values: V, opts?: O) {
    return make<V[number], O>('enum', opts, { values });
  },
  /** Reference to another entity (uuid FK). Target must be registered by a module this one depends on. */
  ref<const O extends RefOpts>(entity: string, opts?: O) {
    return make<string, O>('ref', opts, { ref: entity });
  },
  json<T = unknown, const O extends JsonOpts = JsonOpts>(opts?: O) {
    return make<T, O>('json', opts);
  },
  uuid<const O extends UuidOpts>(opts?: O) {
    return make<string, O>('uuid', opts);
  },
};

// ---- type helpers -------------------------------------------------------------------------

export type ValueOf<D> = D extends FieldDef<infer V, boolean, boolean> ? V : never;

type RequiredKeys<F extends FieldMap> = {
  [K in keyof F]: F[K] extends FieldDef<unknown, true, boolean> ? K : never;
}[keyof F];
type OptionalKeys<F extends FieldMap> = Exclude<keyof F, RequiredKeys<F>>;
type InsertRequiredKeys<F extends FieldMap> = {
  [K in keyof F]: F[K] extends FieldDef<unknown, true, false> ? K : never;
}[keyof F];

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Row as read from the repository: required fields are non-null, optional fields may be null. */
export type RowOf<F extends FieldMap> = Simplify<
  { [K in RequiredKeys<F>]: ValueOf<F[K]> } & { [K in OptionalKeys<F>]: ValueOf<F[K]> | null }
>;

/** Decimal fields also accept decimal strings on input (ADR-0010). */
export type InputValueOf<D> = ValueOf<D> extends Decimal ? Decimal | string : ValueOf<D>;

/** Input accepted by create: required-without-default fields must be present. */
export type InsertOf<F extends FieldMap> = Simplify<
  { [K in InsertRequiredKeys<F>]: InputValueOf<F[K]> } & {
    [K in Exclude<keyof F, InsertRequiredKeys<F>>]?: InputValueOf<F[K]> | null;
  }
>;

/** Input accepted by update: everything optional. */
export type UpdateOf<F extends FieldMap> = Simplify<{ [K in keyof F]?: InputValueOf<F[K]> | null }>;
