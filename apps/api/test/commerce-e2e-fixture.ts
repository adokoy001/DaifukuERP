// Creates only two named synthetic companies inside an explicitly selected prepared E2E database. Never resets.
import { connect, newId } from '@daifuku/kernel';
function fail(): never { throw new Error('Commerce E2E requires an explicitly prepared loopback fixture database and matching synthetic administrator.'); }
async function main() {
 const [tenantId, userId, runId] = process.argv.slice(2); if (process.env.NODE_ENV === 'production' || process.env.E2E_PREPARE !== '1' || !tenantId || !userId || !/^[a-f0-9]{12}$/.test(runId ?? '')) fail();
 const ownerUrl = new URL(process.env.DATABASE_URL_OWNER ?? 'invalid'), appUrl = new URL(process.env.DATABASE_URL ?? 'invalid');
 for (const url of [ownerUrl, appUrl]) if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(daifuku_ci_e2e|daifuku_e2e_test(?:_[a-z0-9]+)?)$/.test(url.pathname) || url.search || url.hash) fail();
 if (ownerUrl.hostname !== appUrl.hostname || ownerUrl.port !== appUrl.port || ownerUrl.pathname !== appUrl.pathname || ownerUrl.username === appUrl.username || appUrl.username !== 'daifuku_app') fail();
 const owner = connect(ownerUrl.href, { max: 1 }), app = connect(appUrl.href, { max: 1 });
 try {
  const [role] = await app.sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`; const [database] = await owner.sql`select pg_get_userbyid(datdba)=current_user as owner from pg_database where datname=current_database()`; if (!database?.owner || !role || role.rolsuper || role.rolbypassrls) fail();
  const [user] = await owner.sql`select tenant_admin,active from users where id=${userId} and tenant_id=${tenantId}`; if (user?.tenant_admin !== 1 || user.active !== 1) fail();
  const companies = await owner.sql.begin(async (sql) => { const rows = []; for (const suffix of ['A','B']) { const code = `CE-${runId}-${suffix}`, name = `Commerce E2E ${runId} ${suffix}`; await sql`insert into companies(id,tenant_id,code,name,currency) values(${newId()},${tenantId},${code},${name},'JPY') on conflict(tenant_id,code) do nothing`; const [row] = await sql`select id,code,name from companies where tenant_id=${tenantId} and code=${code}`; if (!row || row.name !== name) fail(); rows.push(row); } return rows; });
  process.stdout.write(JSON.stringify(companies));
 } finally { await app.close(); await owner.close(); }
}
main().catch(() => { process.stderr.write('Commerce fixture preparation refused or failed. No database reset was performed; do not publish connection settings.\n'); process.exitCode = 1; });
