// TodoResult: the output shape of `<module>.todo` inbox providers (docs/conventions/ui.md "やること受信箱").
// A provider counts through its own Repository reads in the caller's context, so role, company, site/store and
// self boundaries stay where they already are; this file only fixes the wire shape. Zero counts are dropped and
// `href` must be an in-app path (the web inbox re-checks it against the authorized screen catalog).
import { z } from 'zod';
import type { Label } from './i18n.ts';

const labelSchema = z.object({ ja: z.string().min(1), en: z.string().min(1) });

export const TODO_SEVERITIES = ['info', 'warn'] as const;
export type TodoSeverity = (typeof TODO_SEVERITIES)[number];

/** In-app path, optionally with a query: starts with one `/`, no scheme, no `//` host, no backslash or whitespace. */
export const TODO_HREF = /^\/(?![/\\])[^\s\\]*$/;

export const todoItem = z.object({
  /** Stable within the provider (snake_case); the UI uses `<action>:<key>` as its identity. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: labelSchema,
  count: z.number().int().positive(),
  href: z.string().max(500).regex(TODO_HREF),
  severity: z.enum(TODO_SEVERITIES),
});

/** Provider input: always the empty object (the caller's context decides what is counted). */
export const todoInput = z.object({}).strict();
export const todoResult = z.object({ items: z.array(todoItem) });

export type TodoItem = z.infer<typeof todoItem>;
export type TodoResult = z.infer<typeof todoResult>;
export interface TodoCandidate {
  key: string;
  label: Label;
  count: number;
  href: string;
  severity: TodoSeverity;
}

/** The provider result with every zero (or skipped) count removed, in the given order. */
export function todoItems(candidates: readonly (TodoCandidate | null | undefined)[]): TodoResult {
  return { items: candidates.filter((c): c is TodoCandidate => !!c && c.count > 0).map((c) => ({ ...c })) };
}
