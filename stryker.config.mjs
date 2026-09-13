// Whole source files keep the scope stable when lines move. No production source is edited in place.
export default {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  mutate: ['kernel/src/decimal.ts', 'modules/accounting/src/services/balance.ts'],
  // Fresh CLI processes avoid false survivors observed with Vitest 5's in-process runner.
  testRunner: 'command',
  commandRunner: { command: 'pnpm exec vitest run --config verification/mutation/vitest.config.mts' },
  coverageAnalysis: 'off',
  concurrency: 2,
  // Fresh CLI compilation and shrinking need headroom when DB/TLC checks share the host.
  // Any remaining timeout still fails the evidence checker; it is never accepted as a kill.
  timeoutMS: 30000,
  timeoutFactor: 3,
  reporters: ['clear-text', 'json', 'html'],
  jsonReporter: { fileName: 'coverage/mutation/mutation.json' },
  htmlReporter: { fileName: 'coverage/mutation/index.html' },
  incremental: false,
  // No reviewed equivalent survivors in this scope. Timeouts are rejected by the report checker too.
  thresholds: { high: 100, low: 100, break: 100 },
  ignorePatterns: [
    '**/.env',
    '**/.env.*',
    '**/dist/**',
    '**/.runtime/**',
    '**/.local/**',
    '**/test-results/**',
    '**/playwright-report/**',
    '.cache/**',
  ],
};
