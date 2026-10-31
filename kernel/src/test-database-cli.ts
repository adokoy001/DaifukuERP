// `pnpm test:db:templates [-- --drop]` (docs/specs/db-test-startup.md): lists the schema templates that the DB suites
// keep for the configured test database (<db>_tpl_<16 hex>, marked by this harness), or drops them. It also lists the
// shard databases of `pnpm gate:light` (docs/specs/light-tier-speed.md AC-7) with their own templates, and `--drop`
// drops those templates and then each shard database whose templates are all gone. Shard databases are recognised by
// name and owner only (<db>_shard_2 .. <db>_shard_8 of a daifuku_test[_suffix] / daifuku_ci_test database, owned by the
// connecting role): a test database cannot carry a marker comment. Shard templates are found by name and marker even
// when their shard database is gone. Reads TEST_DATABASE_URL_OWNER / TEST_DATABASE_URL (from the environment or
// ./.env) and applies the same safety rules as the suites; never touches the test database itself, another test
// database's templates or shards, or other unmarked databases.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ownShards, ownTemplates, templateTarget, type OwnTemplate } from './test-database.ts';

const MB = 1024 * 1024;

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    // pnpm passes the `--` of `pnpm test:db:templates -- --drop` through.
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: { drop: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false } },
  });
  const out = (line: string) => process.stdout.write(`${line}\n`);
  if (values.help) {
    out('Usage: pnpm test:db:templates [-- --drop]');
    out('Lists (or drops) the schema templates of the test database named by TEST_DATABASE_URL_OWNER, and the');
    out('pnpm gate:light shard databases <db>_shard_2 .. <db>_shard_8 (by name and owner) with their templates.');
    return 0;
  }
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const ownerUrl = process.env.TEST_DATABASE_URL_OWNER;
  const appUrl = process.env.TEST_DATABASE_URL;
  if (!ownerUrl || !appUrl) {
    process.stderr.write('Set TEST_DATABASE_URL_OWNER and TEST_DATABASE_URL to the test database (CONTRIBUTING.md).\n');
    return 2;
  }
  const target = templateTarget(ownerUrl, appUrl, process.env, { ignoreMode: true });
  if (!target.ok) {
    process.stderr.write(`No schema templates can belong to this test database: ${target.reason}.\n`);
    return 2;
  }
  const megabytes = (list: readonly { bytes: number }[]) =>
    (list.reduce((sum, entry) => sum + entry.bytes, 0) / MB).toFixed(1);
  const state = (dropped: boolean | undefined) =>
    dropped === undefined ? '' : dropped ? '  dropped' : '  kept (in use)';
  const report = (database: string, templates: OwnTemplate[]) => {
    for (const template of templates)
      out(
        `${template.name}  ${(template.bytes / MB).toFixed(1)} MB  last used ${template.usedAt.toISOString()}` +
          state(template.dropped),
      );
    if (!values.drop) out(`${templates.length} template(s) of ${database}, ${megabytes(templates)} MB in all.`);
    else {
      const dropped = templates.filter((template) => template.dropped);
      out(`Dropped ${dropped.length} of ${templates.length} template(s) of ${database} (${megabytes(dropped)} MB).`);
    }
  };
  report(target.database, await ownTemplates(target, { drop: values.drop }));
  const shards = await ownShards(target, { drop: values.drop });
  for (const shard of shards)
    report(shard.exists ? shard.name : `${shard.name} (shard database no longer exists)`, shard.templates);
  const existing = shards.filter((shard) => shard.exists);
  for (const shard of existing)
    out(
      `${shard.name}  ${(shard.bytes / MB).toFixed(1)} MB  shard database` +
        (shard.dropped === undefined ? '' : shard.dropped ? '  dropped' : `  kept (${shard.kept ?? 'in use'})`),
    );
  if (!values.drop)
    out(`${existing.length} shard database(s) of ${target.database}, ${megabytes(existing)} MB in all.`);
  else {
    const dropped = existing.filter((shard) => shard.dropped);
    out(
      `Dropped ${dropped.length} of ${existing.length} shard database(s) of ${target.database} (${megabytes(dropped)} MB).`,
    );
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
