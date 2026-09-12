// Zod (input side) -> JSON Schema for MCP tool inputSchema, with a safe fallback (ADR-0009).
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { safeErrorDiagnostics, type Logger } from '@daifuku/kernel';
import { z } from 'zod';

export type ToolInputSchema = Tool['inputSchema'];

/** What an agent may send when the zod input cannot be described: any object. */
export const FALLBACK_INPUT_SCHEMA: ToolInputSchema = { type: 'object' };

type JsonSchema = z.core.JSONSchema.BaseSchema;

function isEmptySchema(s: unknown): boolean {
  return typeof s === 'object' && s !== null && Object.keys(s).length === 0;
}

/**
 * Adjusts nodes zod cannot represent for JSON transport:
 * - `z.custom(...)` members of a union (the kernel's Decimal input is `string | Decimal`) are dropped,
 *   because only the JSON-representable alternatives can arrive over MCP;
 * - `z.date()` / `z.coerce.date()` inputs are ISO 8601 strings on the wire.
 */
function override(ctx: { zodSchema: z.core.$ZodTypes; jsonSchema: JsonSchema }): void {
  const def = ctx.zodSchema._zod.def;
  const json = ctx.jsonSchema;
  if (def.type === 'date') {
    json.type = 'string';
    json.format = 'date-time';
    return;
  }
  if (def.type === 'union' && Array.isArray(json.anyOf)) {
    const kept = json.anyOf.filter((m) => !isEmptySchema(m));
    if (kept.length > 0 && kept.length < json.anyOf.length) json.anyOf = kept;
  }
}

function isObjectSchema(s: JsonSchema): s is JsonSchema & { type: 'object' } {
  return s.type === 'object';
}

/** Converts an action's zod input to the MCP tool input schema. Never throws; logs and falls back instead. */
export function toolInputSchema(actionName: string, input: z.ZodType, log: Logger): ToolInputSchema {
  try {
    const json = z.toJSONSchema(input, { io: 'input', unrepresentable: 'any', override });
    if (!isObjectSchema(json)) {
      log.warn('action input is not an object schema; exposing a permissive tool schema', { action: actionName, type: String(json.type) });
      return FALLBACK_INPUT_SCHEMA;
    }
    // Clients that compile inputSchema with a draft-07 validator reject an unknown `$schema` id.
    const { $schema: _omitted, ...rest } = json;
    return rest as ToolInputSchema;
  } catch (e) {
    log.warn('cannot convert action input to JSON Schema; exposing a permissive tool schema', { action: actionName, ...safeErrorDiagnostics(e) });
    return FALLBACK_INPUT_SCHEMA;
  }
}
