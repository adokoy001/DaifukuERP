import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['**/test/**/*.test.ts', '**/src/**/*.test.ts'],
          exclude: [
            '**/*.db.test.ts',
            '**/node_modules/**',
            '**/dist/**',
            '**/e2e/**',
            '**/.stryker-tmp/**',
            '**/.runtime/**',
          ],
        },
      },
      {
        test: {
          name: 'db',
          setupFiles: ['./apps/api/test/payroll-provider-setup.ts'],
          include: ['**/*.db.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.stryker-tmp/**', '**/.runtime/**'],
          fileParallelism: false,
          testTimeout: 30000,
          // Each DB suite builds the full schema; allow for migration work on slower local disks.
          hookTimeout: 60000,
        },
      },
    ],
  },
});
