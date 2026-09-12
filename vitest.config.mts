import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['**/test/**/*.test.ts', '**/src/**/*.test.ts'],
          exclude: ['**/*.db.test.ts', '**/node_modules/**', '**/dist/**', '**/e2e/**'],
        },
      },
      {
        test: {
          name: 'db',
          include: ['**/*.db.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          fileParallelism: false,
          testTimeout: 30000,
          // Each DB suite builds the full schema; allow for migration work on slower local disks.
          hookTimeout: 60000,
        },
      },
    ],
  },
});
