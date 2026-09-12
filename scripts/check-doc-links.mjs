// Keep the human/AI architecture map navigable as source files move.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'docs/architecture');
const documents = ['AI_INDEX.md', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'PLAN.md', 'docs/STATUS.md', 'docs/HANDOFF.md', 'docs/domain/japan-workforce.md', 'docs/domain/industry-catalog.md', 'docs/specs/quality-foundation.md', 'docs/operations/account-security.md', 'docs/quality-roadmap.md', 'docs/specs/workforce-platform.md', 'docs/specs/workforce-backend-contract.md', 'docs/specs/industry-catalog.md', 'docs/manual/00-index.md', 'docs/manual/10-limitations.md', 'docs/manual/appendix-f-workforce.md', 'docs/manual/appendix-g-industry-catalog.md', ...readdirSync(directory).filter((name) => name.endsWith('.md')).map((name) => `docs/architecture/${name}`)];
let checked = 0;
const failures = [];
for (const document of documents) {
  const source = readFileSync(resolve(root, document), 'utf8');
  for (const match of source.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
    const link = (match[1] ?? match[2] ?? '').split('#')[0];
    if (!link || /^[a-z]+:/i.test(link)) continue;
    const target = resolve(dirname(resolve(root, document)), decodeURIComponent(link));
    const path = relative(root, target);
    if (path.startsWith('..') || !existsSync(target) || !(statSync(target).isFile() || statSync(target).isDirectory())) failures.push(`${document}: ${link}`);
    checked += 1;
  }
}
if (failures.length) { process.stderr.write(`Broken documentation links:\n${failures.join('\n')}\n`); process.exitCode = 1; }
else process.stdout.write(`Documentation links: ${documents.length} documents, ${checked} local targets verified.\n`);
