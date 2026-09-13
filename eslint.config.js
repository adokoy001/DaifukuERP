// Repo-wide lint. Rules are chosen to give agents fast, actionable feedback (docs/conventions/lint.md).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const MAX_FILE_LINES = 400; // docs/conventions/code-style.md — split files beyond this
const MAX_FN_LINES = 80;

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/.stryker-tmp/**',
      '**/coverage/**',
      '**/drizzle/migrations/**',
      '**/*.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // --- type discipline ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // --- size limits (agents drift into huge files; keep units reviewable) ---
      'max-lines': ['error', { max: MAX_FILE_LINES, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: MAX_FN_LINES, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 4],
      // --- money: never use JS number for amounts (ADR-0010). Use Decimal from @daifuku/kernel ---
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'parseFloat on money/quantities is forbidden (ADR-0010). Use Decimal.from() from @daifuku/kernel.',
        },
        {
          selector: "MemberExpression[object.name='Number'][property.name='parseFloat']",
          message: 'Number.parseFloat is forbidden for money (ADR-0010). Use Decimal.from().',
        },
        {
          selector: "Identifier[name='ignorePermissions']",
          message:
            'There is no permission bypass in this codebase (ADR-0007). Run the operation with a context that has the right role instead.',
        },
        {
          selector: "CallExpression[callee.property.name='skip'][callee.object.name=/^(it|test|describe)$/]",
          message: 'Do not skip tests to make gates pass. Fix the test or delete it with a note in docs/log/.',
        },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'scripts/**'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off', 'no-console': 'off' },
  },
  {
    files: ['**/*.cjs', '**/*.mjs', '**/*.js'],
    languageOptions: {
      globals: {
        module: 'readonly',
        require: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        URL: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
);
