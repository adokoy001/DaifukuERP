// AC-2: zod input -> MCP inputSchema, including the fallback for schemas JSON Schema cannot express.
import { Decimal, type Logger } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FALLBACK_INPUT_SCHEMA, toolInputSchema } from '../src/schema.ts';

function recorder(): { log: Logger; warnings: string[] } {
  const warnings: string[] = [];
  return { warnings, log: { info: () => undefined, warn: (m) => void warnings.push(m), error: () => undefined } };
}

describe('toolInputSchema (AC-2)', () => {
  it('AC-2 converts a plain object schema and drops the $schema marker', () => {
    const { log, warnings } = recorder();
    const out = toolInputSchema('x.y', z.object({ id: z.uuid(), n: z.number().int().optional() }), log);
    expect(out.type).toBe('object');
    expect(out.$schema).toBeUndefined();
    expect(out.required).toEqual(['id']);
    expect(out.properties?.id).toMatchObject({ type: 'string', format: 'uuid' });
    expect(warnings).toEqual([]);
  });

  it('AC-2 the kernel Decimal input (string | Decimal with transform) is exposed as a string', () => {
    const { log, warnings } = recorder();
    const decimalInput = z.union([z.string(), z.custom<Decimal>((v) => v instanceof Decimal)]).transform((v) => Decimal.from(v));
    const out = toolInputSchema('x.y', z.object({ amount: decimalInput, opt: decimalInput.nullable().optional() }), log);
    expect(out.properties?.amount).toEqual({ type: 'string' });
    expect(out.properties?.opt).toEqual({ type: ['string', 'null'] });
    expect(warnings).toEqual([]);
  });

  it('AC-2 coerced dates are ISO date-time strings on the wire', () => {
    const { log } = recorder();
    const out = toolInputSchema('x.y', z.object({ at: z.coerce.date() }), log);
    expect(out.properties?.at).toEqual({ type: 'string', format: 'date-time' });
  });

  it('AC-2 a non-object input falls back to a permissive object schema and logs the action', () => {
    const { log, warnings } = recorder();
    expect(toolInputSchema('x.scalar', z.string(), log)).toEqual(FALLBACK_INPUT_SCHEMA);
    expect(warnings).toHaveLength(1);
  });

  it('AC-2 a standalone custom type is exposed as "any" rather than failing the whole tool list', () => {
    const { log, warnings } = recorder();
    const out = toolInputSchema('x.custom', z.object({ blob: z.custom<Uint8Array>((v) => v instanceof Uint8Array) }), log);
    expect(out.type).toBe('object');
    expect(out.properties?.blob).toEqual({});
    expect(warnings).toEqual([]);
  });
});
