// Pack CLI (docs/specs/pack.md AC-4c; ADR-0015): `pnpm pack:apply <name> [--company <id>] [--sample] [--force]`.
// Applies a loaded pack (apps/api/src/packs.ts) to one company in the system context. Without --company: the exact DEMO company
// of the demo tenant created by `pnpm db:reset`. The owner connection only resolves the company; the apply itself runs on
// the app connection (RLS) like the pack.apply action.
import { applyPack, connect, systemParams, withContext } from '@daifuku/kernel';
import '../modules.ts';
import { loadDotEnv, requireEnv } from '../config.ts';
import { parsePackArgs, resolvePackCompany, type PackCliArgs } from './pack-options.ts';

async function main(): Promise<void> {
  let args: PackCliArgs;
  try {
    args = parsePackArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
  const { name, companyId, opts } = args;
  loadDotEnv();
  const owner = connect(requireEnv('DATABASE_URL_OWNER'), { max: 1 });
  const app = connect(requireEnv('DATABASE_URL'), { max: 1 });
  try {
    const target = await resolvePackCompany(owner, companyId);
    const result = await withContext(app, systemParams(target.tenantId, target.companyId), (ctx) => applyPack(ctx, name, opts));
    process.stdout.write(`${JSON.stringify({ tenantId: target.tenantId, companyId: target.companyId, ...result }, null, 2)}\n`);
  } finally {
    await app.close();
    await owner.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
