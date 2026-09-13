// PV-SCOPE-01 / AC-4: private synthetic DSL declarations; no sharedRead or cross-company reporting.
import {
  appMeta,
  defineEntity,
  defineModule,
  definePack,
  entityMeta,
  f,
  label,
  registry,
  repo,
  type Context,
  type ContextParams,
} from '../src/index.ts';
const roles = { observer: ['read', 'create', 'update'] as const };
export const ScopeSite = defineEntity({
  name: 'pv_scope_site',
  label: label('検査拠点', 'Probe site'),
  fields: { name: f.text({ required: true }) },
  permissions: { roles },
  siteAccess: { kind: 'store', field: 'id' },
});
export const ScopeWork = defineEntity({
  name: 'pv_scope_work',
  label: label('検査作業', 'Probe work'),
  fields: {
    siteId: f.ref(ScopeSite.name, { required: true }),
    name: f.text({ required: true }),
    category: f.enum(['a', 'b'], { required: true }),
    amount: f.money({ required: true }),
    secret: f.text(),
  },
  permissions: { roles, fieldGroups: { confidential: { fields: ['secret'], roles: ['admin'] } } },
  views: { search: ['name'] },
  siteAccess: { kind: 'store', field: 'siteId' },
});
export const ScopeChild = defineEntity({
  name: 'pv_scope_child',
  label: label('検査子行', 'Probe child'),
  fields: { workId: f.ref(ScopeWork.name, { required: true }), name: f.text({ required: true }) },
  permissions: { roles },
  views: { search: ['name'] },
  siteAccess: { kind: 'parent', field: 'workId', entity: ScopeWork.name },
});
defineModule({
  name: 'pv_scope',
  label: label('検証', 'Verification'),
  depends: [],
  entities: [ScopeSite, ScopeWork, ScopeChild],
});
export const scopePack = definePack({
  name: 'pv_scope_pack',
  label: label('検査拡張', 'Probe pack'),
  depends: ['pv_scope'],
  ext: { pv_scope_work: { requiredTag: f.text({ required: true }), computedTag: f.text() } },
  labels: { pv_scope_work: { entity: label('適用会社のみ', 'Applied company only') } },
  hooks: () =>
    registry.registerHook(ScopeWork.name, 'before_validate', (_ctx, { row }) => {
      row.ext = { ...((row.ext ?? {}) as Record<string, unknown>), computedTag: 'applied-only' };
    }),
});
export const observerAt = (siteId: string): Partial<ContextParams> => ({
  roles: ['observer'],
  accessScope: 'sites',
  siteIds: [siteId],
  storeIds: [],
});
export async function observe(ctx: Context) {
  const work = repo(ctx, ScopeWork),
    child = repo(ctx, ScopeChild);
  return {
    list: await work.list({ orderBy: [{ field: 'name' }, { field: 'id' }] }),
    page: await work.list({ orderBy: [{ field: 'name' }, { field: 'id' }], limit: 1, offset: 1 }),
    count: await work.count(),
    matching: await work.count({ $or: [{ category: 'a' }, { amount: { $gte: '20', $lte: '100' } }] }),
    aggregate: await work.aggregate({
      groupBy: ['category'],
      metrics: { total: { sum: 'amount' }, n: { count: true } },
      orderBy: [{ field: 'category' }],
    }),
    search: await work.list({ search: 'needle', orderBy: [{ field: 'name' }, { field: 'id' }] }),
    child: await child.list({ search: 'needle', orderBy: [{ field: 'name' }, { field: 'id' }] }),
    metadata: appMeta(ctx),
    entityMetadata: entityMeta(ctx, ScopeWork),
  };
}
