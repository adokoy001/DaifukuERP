import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: [{ find: /^@daifuku\/kernel$/, replacement: fileURLToPath(new URL('../../kernel/src/index.ts', import.meta.url)) }] },
  test: {
    include: ['kernel/test/decimal*.test.ts', 'modules/accounting/test/balance*.test.ts'],
    exclude: ['**/*.db.test.ts', '**/node_modules/**', '**/dist/**', '**/.stryker-tmp/**'],
  },
});
