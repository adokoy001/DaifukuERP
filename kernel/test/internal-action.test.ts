// docs/specs/kernel-phase15.md C (AC-8): `internal: true` actions stay callable in-process but are not listed for apps.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runAction } from '../src/actions/run.ts';
import type { Context, Db } from '../src/context.ts';
import { makeContext } from '../src/db/client.ts';
import { defineAction } from '../src/dsl/action.ts';
import { label } from '../src/i18n.ts';
import { appMeta } from '../src/meta.ts';
import { registry } from '../src/registry.ts';
import { echoAction } from './fixtures/entities.ts';

const applyThing = defineAction({
  name: 'test_internal.apply_thing',
  description: label('内部用: 他モジュールが呼ぶ', 'Internal: called by another module'),
  input: z.object({ n: z.number().int() }),
  output: z.object({ doubled: z.number().int(), actor: z.string() }),
  permission: 'authenticated',
  tx: 'none',
  internal: true,
  handler: async (ctx, { n }) => ({ doubled: n * 2, actor: ctx.actor.id }),
});

const ctx: Context = makeContext({} as unknown as Db, { tenantId: '00000000-0000-0000-0000-000000000001', companyId: null, actor: { type: 'user', id: 'u-1' }, roles: ['admin'] });

describe('internal actions (AC-8)', () => {
  it('AC-8 the flag defaults to false and is kept on the definition', () => {
    expect(applyThing.internal).toBe(true);
    expect(echoAction.internal).toBe(false);
    expect(registry.action('test_internal.apply_thing').internal).toBe(true);
  });

  it('AC-8 registry.actions() leaves internal actions out; includeInternal / allActions keep them', () => {
    const exposed = registry.actions().map((a) => a.name);
    expect(exposed).toContain('test.echo');
    expect(exposed).not.toContain('test_internal.apply_thing');
    expect(registry.actions({ includeInternal: true }).map((a) => a.name)).toContain('test_internal.apply_thing');
    expect(registry.allActions().map((a) => a.name)).toContain('test_internal.apply_thing');
    expect(registry.actions({ includeInternal: true })).toHaveLength(registry.allActions().length);
  });

  it('AC-8 /meta (appMeta) omits internal actions', () => {
    const names = appMeta(ctx).actions.map((a) => a.name);
    expect(names).toContain('test.echo');
    expect(names).not.toContain('test_internal.apply_thing');
  });

  it('AC-8 runAction still runs an internal action in-process, with input/output validation', async () => {
    await expect(runAction(ctx, 'test_internal.apply_thing', { n: 21 })).resolves.toEqual({ doubled: 42, actor: 'u-1' });
    await expect(runAction(ctx, 'test_internal.apply_thing', { n: 'x' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
