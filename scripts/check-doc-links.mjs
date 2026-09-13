// Keep the human/AI architecture map navigable as source files move.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'docs/architecture');
const documents = [
  ...new Set([
    'AI_INDEX.md',
    'CLAUDE.md',
    'README.md',
    'CONTRIBUTING.md',
    'PLAN.md',
    'docs/STATUS.md',
    'docs/HANDOFF.md',
    'docs/domain/japan-workforce.md',
    'docs/domain/industry-catalog.md',
    'docs/specs/employee-shift-planner.md',
    'docs/adr/0020-browser-shift-planning.md',
    'docs/operations/shift-planning.md',
    'docs/specs/quality-foundation.md',
    'docs/operations/account-security.md',
    'docs/quality-roadmap.md',
    'docs/specs/workforce-platform.md',
    'docs/specs/workforce-backend-contract.md',
    'docs/specs/industry-catalog.md',
    'docs/manual/00-index.md',
    'docs/manual/10-limitations.md',
    'docs/manual/appendix-f-workforce.md',
    'docs/manual/appendix-g-industry-catalog.md',
    ...readdirSync(directory)
      .filter((name) => name.endsWith('.md'))
      .map((name) => `docs/architecture/${name}`),
    'docs/specs/enterprise-operations.md',
    'docs/specs/enterprise-identity.md',
    'docs/specs/enterprise-commerce.md',
    'docs/specs/enterprise-payroll.md',
    'docs/domain/identity-and-mail-sources.md',
    'docs/domain/pos-group-accounting.md',
    'docs/domain/japan-payroll-automation.md',
    'docs/operations/enterprise-identity.md',
    'docs/specs/deployment-edge.md',
    'docs/domain/edge-relay-security.md',
    'docs/adr/0023-outbound-relay-principal-and-fencing.md',
    'docs/operations/deployment.md',
    'docs/operations/edge-agent.md',
    'docs/log/2026-09-12-deployment-edge.md',
    'apps/edge/README.md',
    '.github/ci/README.md',
    ...readdirSync(resolve(root, 'docs/manual'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => `docs/manual/${name}`),
  ]),
];
documents.push(
  'docs/specs/edge-installers.md',
  'docs/domain/edge-service-installation.md',
  'docs/domain/edge-service-security.md',
  'docs/log/2026-09-13-edge-installers.md',
);
documents.push(
  'docs/specs/commerce-finance.md',
  'docs/specs/trade-workflow.md',
  'docs/specs/bank-integration.md',
  'docs/specs/tax-filing-preparation.md',
  'docs/domain/trade-workflow.md',
  'docs/domain/japan-bank-integration.md',
  'docs/domain/japan-tax-filing.md',
  'docs/log/2026-09-13-commerce-finance.md',
);
documents.push(
  'docs/specs/practical-verification.md',
  'docs/verification/invariants.md',
  'docs/log/2026-09-13-practical-verification.md',
  'docs/conventions/testing.md',
  'verification/mutation/README.md',
  'verification/edge/README.md',
  'verification/edge/RESULTS.md',
);
documents.push('docs/specs/navigation-workspaces.md', 'docs/log/2026-09-13-navigation-workspaces.md');
documents.push(
  'docs/specs/readable-source.md',
  'docs/log/2026-09-13-readable-source.md',
  'docs/conventions/lint.md',
  'docs/conventions/code-style.md',
);
documents.push(
  'docs/specs/payroll-rule-versions.md',
  'docs/adr/0024-payroll-rule-releases.md',
  'docs/log/2026-09-13-payroll-rule-versions.md',
  'docs/specs/l10n-jp.md',
);
let checked = 0;
const failures = [];
for (const document of documents) {
  const source = readFileSync(resolve(root, document), 'utf8');
  for (const match of source.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
    const link = (match[1] ?? match[2] ?? '').split('#')[0];
    if (!link || /^[a-z]+:/i.test(link)) continue;
    const target = resolve(dirname(resolve(root, document)), decodeURIComponent(link));
    const path = relative(root, target);
    if (path.startsWith('..') || !existsSync(target) || !(statSync(target).isFile() || statSync(target).isDirectory()))
      failures.push(`${document}: ${link}`);
    checked += 1;
  }
}
if (failures.length) {
  process.stderr.write(`Broken documentation links:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
} else process.stdout.write(`Documentation links: ${documents.length} documents, ${checked} local targets verified.\n`);
