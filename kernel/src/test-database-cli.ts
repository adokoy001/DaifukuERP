// `pnpm test:db:templates [-- --drop]` (docs/specs/db-test-startup.md): lists the schema templates that the DB suites
// keep for the configured test database (<db>_tpl_<16 hex>, marked by this harness), or drops them. Reads
// TEST_DATABASE_URL_OWNER / TEST_DATABASE_URL (from the environment or ./.env) and applies the same safety rules as the
// suites; never touches the test database itself, another test database's templates or unmarked databases.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ownTemplates, templateTarget } from './test-database.ts';

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
    out('Lists (or drops) the schema templates of the test database named by TEST_DATABASE_URL_OWNER.');
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
  const templates = await ownTemplates(target, { drop: values.drop });
  for (const template of templates)
    out(
      `${template.name}  ${(template.bytes / MB).toFixed(1)} MB  last used ${template.usedAt.toISOString()}` +
        (template.dropped === undefined ? '' : template.dropped ? '  dropped' : '  kept (in use)'),
    );
  const megabytes = (list: typeof templates) =>
    (list.reduce((sum, template) => sum + template.bytes, 0) / MB).toFixed(1);
  if (!values.drop) {
    out(`${templates.length} template(s) of ${target.database}, ${megabytes(templates)} MB in all.`);
    return 0;
  }
  const dropped = templates.filter((template) => template.dropped);
  out(`Dropped ${dropped.length} of ${templates.length} template(s) of ${target.database} (${megabytes(dropped)} MB).`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
