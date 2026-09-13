import { expect } from 'vitest';

// Country-specific integration is composed in apps, keeping workforce dependent only on its provider port.
// Do not register country modules for unrelated kernel/module suites that intentionally control their registry.
const testPath = expect.getState().testPath?.replaceAll('\\', '/');
const fiscalSuites = [
  '/modules/workforce/test/fiscal.db.test.ts',
  '/modules/workforce/test/fiscal-rule-integrity.db.test.ts',
];
if (testPath && fiscalSuites.some((path) => testPath.endsWith(path))) {
  const { registerJapanPayrollProvider } = await import('@daifuku/l10n-jp');
  registerJapanPayrollProvider();
}
