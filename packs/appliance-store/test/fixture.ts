import {
  registerCrudActions,
  registerPackActions,
  registry,
  repo,
  runAction,
  type Context,
  type ContextParams,
  type Infer,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { ApplianceService } from '../src/index.ts';

registerCrudActions();
registerPackActions();
export const DATE = '2026-12-10';
export type Row = Record<string, unknown> & { id: string; version: number };

export async function setup() {
  const db = await freshDb();
  const run = <T>(fn: (ctx: Context) => Promise<T>, params: Partial<ContextParams> = {}) =>
    db.run({ now: () => new Date(`${DATE}T03:00:00Z`), ...params }, fn);
  const act = <T = Row>(name: string, input: unknown, params: Partial<ContextParams> = {}) =>
    run((ctx) => runAction(ctx, name, input), params) as Promise<T>;
  try {
    await run(async (ctx) => {
      for (const module of registry.allModules()) await module.seed?.(ctx);
    });
    await act('pack.apply', { name: 'appliance_store', sample: true });
  } catch (error) {
    await db.close();
    throw error;
  }
  const sample = async (kind: 'repair' | 'installation' = 'repair'): Promise<Infer<typeof ApplianceService>> => {
    const result = await run((ctx) =>
      repo(ctx, ApplianceService).list({ where: { reference: `APP-DEMO-${kind.toUpperCase()}` }, limit: 1 }),
    );
    if (!result.items[0]) throw new Error('Sample job missing');
    return result.items[0];
  };
  const complete = async (kind: 'repair' | 'installation' = 'repair') => {
    const job = await sample(kind);
    const started = await act('appliance_store.start_service', { serviceId: job.id, expectedVersion: job.version });
    return act('appliance_store.complete_service', {
      serviceId: job.id,
      expectedVersion: started.version,
      completedDate: DATE,
      workReport: '点検・調整・試運転を実施し正常動作を確認。',
    });
  };
  return { db, run, act, sample, complete };
}

export type Fixture = Awaited<ReturnType<typeof setup>>;
export type { TestDb };
