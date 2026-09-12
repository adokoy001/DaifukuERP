import { companies, isUuid, type ApplyPackOptions, type Database } from '@daifuku/kernel';
import { eq } from 'drizzle-orm';
import { findDemoIdentity } from './demo-identity.ts';

const USAGE = 'usage: pnpm pack:apply <name> [--company <companyId>] [--sample] [--force]';

export interface PackCliArgs {
  name: string;
  companyId: string | undefined;
  opts: ApplyPackOptions;
}

export function parsePackArgs(argv: readonly string[]): PackCliArgs {
  const args = argv.filter((a) => a !== '--');
  let name: string | undefined;
  let companyId: string | undefined;
  const opts: ApplyPackOptions = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--sample') opts.sample = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--company') {
      const value = args[++i];
      if (companyId !== undefined || value === undefined || !isUuid(value)) throw new Error(`--company requires one company id (uuid). ${USAGE}`);
      companyId = value;
    } else if (a !== undefined && !a.startsWith('--') && name === undefined) name = a;
    else throw new Error(`unexpected argument "${a ?? ''}". ${USAGE}`);
  }
  if (!name) throw new Error(USAGE);
  return { name, companyId, opts };
}

export async function resolvePackCompany(owner: Database, companyId: string | undefined): Promise<{ tenantId: string; companyId: string }> {
  if (companyId !== undefined) {
    if (!isUuid(companyId)) throw new Error('--company requires a company id (uuid).');
    const found = (await owner.drizzle.select({ id: companies.id, tenantId: companies.tenantId }).from(companies).where(eq(companies.id, companyId)).limit(1))[0];
    if (!found) throw new Error(`company ${companyId} not found`);
    return { tenantId: found.tenantId, companyId: found.id };
  }
  const demo = await findDemoIdentity(owner);
  if (!demo) throw new Error('Demo company not found: pass --company <id> for an existing company, or initialize a separate demo database.');
  return { tenantId: demo.tenantId, companyId: demo.companyId };
}
