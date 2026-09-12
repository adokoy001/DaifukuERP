// Derives Zod schemas (insert / update / json output) from an entity definition (ADR-0002).
import { z } from 'zod';
import { Decimal } from '../decimal.ts';
import type { AnyField, FieldMap } from '../dsl/fields.ts';
import type { DecimalOpts, IntOpts, TextOpts } from '../dsl/fields.ts';
import { isLocalDate } from '../ids.ts';
import { normalizeText } from '../normalize.ts';

export interface EntitySchemas {
  /** Validates create input. Decimal fields accept strings and yield Decimal. */
  insert: z.ZodObject<Record<string, z.ZodType>>;
  /** Validates update input. All optional; required fields cannot be set to null. */
  update: z.ZodObject<Record<string, z.ZodType>>;
  /** JSON shape returned by the API (Decimal -> string, Date -> ISO string). Used for OpenAPI/MCP. */
  json: z.ZodObject<Record<string, z.ZodType>>;
  /** Per-field input schema (value only, nullability not applied). */
  fieldInput: Record<string, z.ZodType>;
}

const decimalInput = (opts: DecimalOpts) =>
  z
    .union([z.string(), z.custom<Decimal>((v) => v instanceof Decimal, 'expected Decimal')])
    .transform((v, ctx) => {
      try {
        const d = Decimal.from(v);
        const scale = opts.scale ?? 6;
        if (!d.roundDown(Math.min(scale, 6)).eq(d) || d.abs().gte('100000000000000')) {
          ctx.addIssue({ code: 'custom', message: `must fit numeric(20,6) with at most ${Math.min(scale, 6)} fractional digits` });
          return z.NEVER;
        }
        if (opts.min !== undefined && d.lt(opts.min)) {
          ctx.addIssue({ code: 'custom', message: `must be >= ${opts.min}` });
          return z.NEVER;
        }
        return d;
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : 'invalid decimal' });
        return z.NEVER;
      }
    });

/** Value schema of one field (no nullability); also used for registered ext keys (ext.ts). */
export function fieldInputSchema(fd: AnyField): z.ZodType {
  switch (fd.kind) {
    case 'text': {
      const o = fd.opts as TextOpts;
      let s = z.string();
      if (o.maxLength) s = s.max(o.maxLength);
      if (o.pattern) s = s.regex(o.pattern);
      return o.normalize ? z.preprocess((v) => (typeof v === 'string' ? normalizeText(o.normalize, v) : v), s) : s;
    }
    case 'int': {
      const o = fd.opts as IntOpts;
      let n = z.number().int();
      if (o.min !== undefined) n = n.min(o.min);
      if (o.max !== undefined) n = n.max(o.max);
      return n;
    }
    case 'decimal':
      return decimalInput(fd.opts as DecimalOpts);
    case 'bool':
      return z.boolean();
    case 'date':
      return z.string().refine(isLocalDate, 'must be YYYY-MM-DD');
    case 'timestamp':
      return z.coerce.date();
    case 'enum':
      return z.enum((fd.values ?? []) as [string, ...string[]]);
    case 'ref':
    case 'uuid':
      return z.uuid();
    case 'json':
      return z.unknown();
  }
}

function fieldJsonSchema(fd: AnyField): z.ZodType {
  switch (fd.kind) {
    case 'decimal':
      return z.string();
    case 'timestamp':
      return z.string();
    case 'int':
      return z.number().int();
    case 'bool':
      return z.boolean();
    case 'enum':
      return z.enum((fd.values ?? []) as [string, ...string[]]);
    case 'ref':
    case 'uuid':
      return z.uuid();
    case 'json':
      return z.unknown();
    default:
      return z.string();
  }
}

const extSchema = z.record(z.string(), z.unknown());

export function buildSchemas(fields: FieldMap, opts: { ext: boolean; document: boolean; maskable?: ReadonlySet<string> }): EntitySchemas {
  const insert: Record<string, z.ZodType> = {};
  const update: Record<string, z.ZodType> = {};
  const json: Record<string, z.ZodType> = {
    id: z.uuid(),
    tenantId: z.uuid(),
    companyId: z.uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.uuid().nullable(),
    updatedBy: z.uuid().nullable(),
    version: z.number().int(),
  };
  const fieldInput: Record<string, z.ZodType> = {};
  for (const [name, fd] of Object.entries(fields)) {
    const base = fieldInputSchema(fd);
    fieldInput[name] = base;
    // Fields in a fieldGroup may be masked (omitted) for some roles, so the output schema marks them optional.
    const maskable = opts.maskable?.has(name) ?? false;
    if (fd.required) {
      insert[name] = fd.hasDefault ? base.optional() : base;
      update[name] = base.optional();
      json[name] = maskable ? fieldJsonSchema(fd).optional() : fieldJsonSchema(fd);
    } else {
      insert[name] = base.nullable().optional();
      update[name] = base.nullable().optional();
      json[name] = maskable ? fieldJsonSchema(fd).nullable().optional() : fieldJsonSchema(fd).nullable();
    }
    if (fd.opts.outputHidden) delete json[name];
  }
  if (opts.ext) {
    insert.ext = extSchema.optional();
    update.ext = extSchema.optional();
    json.ext = extSchema.nullable();
  }
  if (opts.document) {
    json.docstatus = z.union([z.literal(0), z.literal(1), z.literal(2)]);
    json.number = z.string().nullable();
    json.amendedFrom = z.uuid().nullable();
  }
  return { insert: z.object(insert).strict(), update: z.object(update).strict(), json: z.object(json), fieldInput };
}
