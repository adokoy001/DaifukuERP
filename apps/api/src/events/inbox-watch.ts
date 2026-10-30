// Inbox checks of one tenant (docs/specs/event-delivery.md AC-16, AC-23). The user's permissions are reloaded through
// the owner connection exactly like API authentication (loadPrincipal, resolveCompanyAccess); the inbox is counted in
// the user's own read-only Context and the observation is written in the user's own read-write Context. A user who is
// inactive or lost the company has the watch removed (system context) without an event. Watches of a company whose
// inbox mail switch is off are not returned by the claim (they are advanced without counting; kernel claimInboxWatches).
import {
  claimInboxWatches,
  loadPrincipal,
  PermissionDenied,
  recordInboxObservation,
  removeInboxWatch,
  resolveCompanyAccess,
  safeDiagnosticFields,
  summarizeInbox,
  systemParams,
  withContext,
  type ContextParams,
  type Database,
  type Logger,
  type Principal,
} from '@daifuku/kernel';

export interface InboxCheckResult {
  checked: number;
  changed: number;
  removed: number;
  discarded: number;
}

/** The user's access in the company, or null when the user is inactive, elsewhere, or no longer a member. */
async function companyAccess(owner: Database, tenantId: string, userId: string, companyId: string) {
  try {
    // loadPrincipal resolves the default company too, so a lost membership can surface from either call.
    const principal = await loadPrincipal(owner, userId);
    if (!principal || principal.tenantId !== tenantId) return null;
    return await resolveCompanyAccess(owner, principal, companyId);
  } catch (error) {
    if (error instanceof PermissionDenied) return null;
    throw error;
  }
}

function userParams(
  tenantId: string,
  companyId: string,
  access: Principal,
  now: () => Date,
  log: Logger,
): ContextParams {
  return {
    tenantId,
    companyId,
    actor: { type: 'user', id: access.userId },
    roles: access.roles,
    tenantAdmin: access.tenantAdmin,
    accessScope: access.accessScope,
    storeIds: access.storeIds,
    siteIds: access.siteIds,
    sessionVersion: access.sessionVersion,
    now,
    log,
  };
}

export async function checkInboxWatches(
  owner: Database,
  app: Database,
  tenantId: string,
  opts: { now: () => Date; intervalMinutes: number; log: Logger; signal?: AbortSignal },
): Promise<InboxCheckResult> {
  const result: InboxCheckResult = { checked: 0, changed: 0, removed: 0, discarded: 0 };
  const watches = await claimInboxWatches(app, tenantId, { now: opts.now(), intervalMinutes: opts.intervalMinutes });
  for (const watch of watches) {
    if (opts.signal?.aborted) break;
    result.checked++;
    const access = await companyAccess(owner, tenantId, watch.userId, watch.companyId);
    if (!access) {
      await withContext(app, systemParams(tenantId, null), (ctx) =>
        removeInboxWatch(ctx, watch.companyId, watch.userId),
      );
      result.removed++;
      continue;
    }
    const params = userParams(tenantId, watch.companyId, access, opts.now, opts.log);
    let summary;
    try {
      summary = await withContext(app, params, summarizeInbox, { readOnlySnapshot: true });
    } catch (error) {
      // A failing provider discards this observation: no event, the record is unchanged (AC-16).
      result.discarded++;
      opts.log.warn('inbox check discarded', { tenantId, ...safeDiagnosticFields(error) });
      continue;
    }
    const outcome = await withContext(app, params, (ctx) => recordInboxObservation(ctx, summary));
    if (outcome === 'changed') result.changed++;
  }
  return result;
}
