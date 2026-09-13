import { canEditSettings } from '../api/settings.ts';
import type { ActionMeta, AppMeta, EntityMeta, Label, Locale, MenuItem } from '../api/types.ts';
import { reportTitle } from './report.ts';
import { DEDICATED_NAVIGATION, WORKSPACES, workspaceForModule, type DedicatedNavigation } from './navigation-data.ts';
import type { NavigationCatalog, NavigationEntry, NavigationWorkspace } from './navigation-types.ts';
export { WORKSPACES, workspaceForModule } from './navigation-data.ts';
export type { NavigationCatalog, NavigationEntry, NavigationKind, NavigationWorkspace, WorkspaceDefinition, WorkspaceId } from './navigation-types.ts';

const ENTITY_NAME = /^[a-z][a-z0-9_]*$/;
const ACTION_NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const RECORD_PATH = /^\/e\/([a-z][a-z0-9_]*)(?:\/(?:new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/i;

function uniqueLabels(labels: readonly Label[]): Label[] {
  const seen = new Set<string>();
  return labels.filter(label => { const key = JSON.stringify(label); if (seen.has(key)) return false; seen.add(key); return true; });
}
function add(entries: Map<string, NavigationEntry>, entry: NavigationEntry): void {
  const previous = entries.get(entry.href);
  if (!previous) { entries.set(entry.href, { ...entry, aliases: uniqueLabels(entry.aliases) }); return; }
  // Dedicated screens and the first ordered menu keep their canonical names; later labels remain searchable.
  entries.set(entry.href, { ...previous, aliases: uniqueLabels([...previous.aliases, entry.label, ...entry.aliases]) });
}
function allowedDedicated(definition: DedicatedNavigation, meta: AppMeta, tenantAdmin: boolean): boolean {
  if (definition.action && !meta.actions.some(action => action.name === definition.action)) return false;
  if (definition.condition === 'reports') return meta.actions.some(action => ACTION_NAME.test(action.name) && action.resultKind === 'table');
  if (definition.condition === 'settings') return canEditSettings(meta.roles);
  if (definition.condition === 'tenant-admin') return tenantAdmin;
  return true;
}
function dedicatedEntry(definition: DedicatedNavigation, meta: AppMeta): NavigationEntry {
  const moduleLabel = meta.modules.find(module => module.name === definition.module)?.label;
  return { id: definition.href, href: definition.href, label: definition.label, description: definition.description, workspace: definition.workspace, kind: definition.kind ?? 'workspace', featured: true, aliases: moduleLabel ? [moduleLabel] : [], ...(definition.module ? { module: definition.module } : {}) };
}
function recordEntry(entity: EntityMeta, meta: AppMeta, label = entity.label): NavigationEntry {
  const href = `/e/${entity.name}`, moduleLabel = meta.modules.find(module => module.name === entity.module)?.label;
  return { id: href, href, label, description: { ja: `${entity.label.ja}を一覧・検索します。`, en: `Browse and search ${entity.label.en}.` }, workspace: workspaceForModule(entity.module), kind: 'record', featured: false, aliases: [entity.label, ...(moduleLabel ? [moduleLabel] : [])], ...(entity.module ? { module: entity.module } : {}) };
}
function actionEntry(action: ActionMeta, meta: AppMeta, label = reportTitle(action)): NavigationEntry {
  const report = action.resultKind === 'table', href = `/${report ? 'r' : 'a'}/${action.name}`, moduleLabel = meta.modules.find(module => module.name === action.module)?.label;
  return { id: href, href, label, description: action.description, workspace: report ? 'reports' : workspaceForModule(action.module), kind: report ? 'report' : 'action', module: action.module, featured: false, aliases: [reportTitle(action), ...(moduleLabel ? [moduleLabel] : [])] };
}
function menuEntry(item: MenuItem, meta: AppMeta, entities: Map<string, EntityMeta>, actions: Map<string, ActionMeta>, dedicated: Map<string, NavigationEntry>): NavigationEntry | undefined {
  if (item.entity && item.route) return undefined;
  if (item.entity) { const entity = entities.get(item.entity); return entity ? recordEntry(entity, meta, item.label) : undefined; }
  const path = item.route;
  if (!path) return undefined;
  const fixed = dedicated.get(path);
  if (fixed) return { ...fixed, label: item.label };
  const entityMatch = /^\/e\/([a-z][a-z0-9_]*)$/.exec(path), entity = entityMatch?.[1] ? entities.get(entityMatch[1]) : undefined;
  if (entity) return recordEntry(entity, meta, item.label);
  const match = /^\/(r|a)\/([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/.exec(path), action = match?.[2] ? actions.get(match[2]) : undefined;
  if (!action) return undefined;
  if (match?.[1] === 'r') return action.resultKind === 'table' ? actionEntry(action, meta, item.label) : undefined;
  // Keep the generated action page's own visibility contract: internal/generic and pack setup are not forms here.
  return !action.generic && action.resultKind !== 'table' && action.module !== 'pack' ? actionEntry(action, meta, item.label) : undefined;
}

/** Pure presentation catalog. Metadata is already authorized; no network requests or record-count queries occur here. */
export function buildNavigation(meta: AppMeta | undefined, tenantAdmin: boolean): NavigationCatalog {
  if (!meta) return { entries: [], workspaces: [] };
  const lineNames = new Set(meta.entities.flatMap(entity => (entity.lines ?? []).map(line => line.entity)));
  const entities = new Map(meta.entities.filter(entity => ENTITY_NAME.test(entity.name) && entity.ops.includes('read') && !lineNames.has(entity.name)).map(entity => [entity.name, entity]));
  const actions = new Map(meta.actions.filter(action => ACTION_NAME.test(action.name)).map(action => [action.name, action]));
  const entries = new Map<string, NavigationEntry>();
  for (const definition of DEDICATED_NAVIGATION) if (allowedDedicated(definition, meta, tenantAdmin)) add(entries, dedicatedEntry(definition, meta));
  const dedicated = new Map(entries);
  for (const module of meta.modules) for (const item of [...module.menus].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const entry = menuEntry(item, meta, entities, actions, dedicated);
    if (entry) add(entries, entry);
  }
  for (const entity of entities.values()) add(entries, recordEntry(entity, meta));
  for (const action of actions.values()) if (action.resultKind === 'table') add(entries, actionEntry(action, meta));
  const all = [...entries.values()];
  return { entries: all, workspaces: WORKSPACES.map(workspace => ({ ...workspace, entries: all.filter(entry => entry.workspace === workspace.id) })).filter(workspace => workspace.entries.length > 0) };
}

/** NFKC joins width/voicing variants; map katakana to hiragana so Japanese labels can be found with either script. */
function normalize(value: string, locale: Locale): string {
  return value.normalize('NFKC').toLocaleLowerCase(locale === 'ja' ? 'ja-JP' : 'en-US').replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
}
function searchRank(entry: NavigationEntry, terms: string[], locale: Locale): number | undefined {
  const label = normalize(entry.label[locale], locale);
  const other = locale === 'ja' ? 'en' : 'ja';
  const content = normalize([entry.label[locale], entry.label[other], entry.description?.ja ?? '', entry.description?.en ?? '', ...entry.aliases.flatMap(alias => [alias.ja, alias.en]), entry.module ?? '', entry.href].join(' '), locale);
  if (!terms.every(term => content.includes(term))) return undefined;
  return terms.reduce((score, term) => score + (label === term ? 8 : label.startsWith(term) ? 4 : label.includes(term) ? 2 : 0), 0);
}
/** Search every authorized destination. Pagination belongs to the directory UI, never to this reachability catalog. */
export function searchNavigation(catalog: NavigationCatalog, query: string, locale: Locale): NavigationEntry[] {
  const terms = normalize(query, locale).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...catalog.entries];
  const collator = new Intl.Collator(locale === 'ja' ? 'ja-JP' : 'en-US', { numeric: true });
  return catalog.entries.flatMap(entry => { const rank = searchRank(entry, terms, locale); return rank === undefined ? [] : [{ entry, rank }]; })
    .sort((a, b) => b.rank - a.rank || Number(b.entry.featured) - Number(a.entry.featured) || collator.compare(a.entry.label[locale], b.entry.label[locale]) || (a.entry.href < b.entry.href ? -1 : a.entry.href > b.entry.href ? 1 : 0)).map(item => item.entry);
}
/** Only an exact known route or one canonical entity/new/UUID path maps to an entry; prefix lookalikes do not. */
export function findNavigationEntry(catalog: NavigationCatalog, pathname: string): NavigationEntry | undefined {
  const exact = catalog.entries.find(entry => entry.href === pathname);
  if (exact) return exact;
  const entity = RECORD_PATH.exec(pathname)?.[1];
  return entity ? catalog.entries.find(entry => entry.kind === 'record' && entry.href === `/e/${entity}`) : undefined;
}
export function findNavigationWorkspace(catalog: NavigationCatalog, pathname: string): NavigationWorkspace | undefined {
  const direct = /^\/workspaces\/([a-z]+)$/.exec(pathname)?.[1];
  const id = direct ?? findNavigationEntry(catalog, pathname)?.workspace;
  return catalog.workspaces.find(workspace => workspace.id === id);
}
