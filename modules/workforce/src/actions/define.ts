import { defineAction, label, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import { commandResult } from '../contract.ts';
export function workflowAction<I extends z.ZodType>(name: string, description: string, input: I, roles: readonly string[], handler: (ctx: Context, input: z.output<I>) => Promise<z.infer<typeof commandResult>>, siteAccess = true) {
  return defineAction({ name: `workforce.${name}`, description: label(description, name.replaceAll('_', ' ')), input, output: commandResult, permission: { roles }, siteAccess, handler });
}
