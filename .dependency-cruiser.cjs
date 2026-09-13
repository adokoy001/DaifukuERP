/**
 * Architecture boundaries (ADR-0001, ADR-0008). Dependencies flow one way:
 *   apps -> packs -> l10n -> modules -> kernel
 * Cross-package imports must go through the target package's public index
 * (import by name: `@daifuku/<pkg>`), never into another package's src/ internals.
 * Violations fail `pnpm lint:boundaries`. Messages are written for agents: each says what to do instead.
 */
const PKG = '(kernel|modules/[^/]+|l10n/[^/]+|packs/[^/]+|apps/[^/]+)';

function layerRule(name, fromRe, toRe, comment) {
  return {
    name,
    severity: 'error',
    comment,
    from: { path: fromRe },
    to: { path: toRe, pathNot: '^node_modules/' },
  };
}

module.exports = {
  forbidden: [
    layerRule(
      'kernel-depends-on-nothing-above',
      '^kernel/',
      '^(modules|l10n|packs|apps)/',
      'kernel must not depend on modules/l10n/packs/apps. Move the shared piece into kernel, or invert the dependency with a hook/event.',
    ),
    layerRule(
      'modules-depend-only-on-kernel-and-modules',
      '^modules/[^/]+/',
      '^(l10n|packs|apps)/',
      'A core module may depend only on kernel and other core modules. Country/industry specifics belong in l10n/ or packs/ and plug in via hooks.',
    ),
    layerRule(
      'l10n-depends-only-on-kernel-and-modules',
      '^l10n/[^/]+/',
      '^(packs|apps)/',
      'l10n packages may depend on kernel and modules only.',
    ),
    layerRule(
      'packs-do-not-depend-on-apps',
      '^packs/[^/]+/',
      '^apps/',
      'packs must not import apps. Expose what you need through the kernel registry.',
    ),
    {
      name: 'only-apps-depend-on-packs',
      severity: 'error',
      comment:
        'Only apps load packs (apps/api/src/packs.ts, apps/mcp/src/modules.ts; ADR-0015). A pack may import another pack it lists in depends (by package name). If core code needs something from a pack, it belongs in a module; plug the pack in via hooks/overrides instead.',
      from: { pathNot: '^(apps|packs)/' },
      to: { path: '^packs/' },
    },
    {
      name: 'modules-use-kernel-ports-only',
      severity: 'error',
      comment:
        'Business modules, l10n and packs must not import persistence/HTTP libraries directly (ADR-0013). Use kernel ports: repo(), ctx.emit(), registry.override/registerHook, ctx.now(), newId(). If a port is missing, add it to kernel with an ADR.',
      from: { path: '^(modules|l10n|packs)/[^/]+/src/' },
      // matches both resolved pnpm paths (node_modules/.pnpm/<pkg>@x/node_modules/<pkg>/...) and unresolved specifiers
      to: { path: '(^|/)(drizzle-orm|drizzle-kit|postgres|pg|fastify|@fastify/[^/]+|undici|axios|node-fetch)(/|$)' },
    },
    {
      name: 'modules-no-node-io',
      severity: 'error',
      comment:
        'Business modules must not touch the filesystem/network/process directly (ADR-0013). Ask kernel for a port (storage/http) instead.',
      from: { path: '^(modules|l10n|packs)/[^/]+/src/' },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?(fs|fs/promises|net|http|https|child_process|worker_threads|dns|tls)$',
      },
    },
    {
      name: 'no-cross-package-internals',
      severity: 'error',
      comment:
        "Import other packages by name (@daifuku/<pkg>), which resolves to their src/index.ts. Do not reach into another package's internals. If you need something that is not exported, export it from that package's index deliberately. Listed contract subpaths are explicit browser-safe wire contracts; workforce/scheduling is the pure shared planning engine.",
      from: { path: `^(${PKG}/)` },
      to: {
        path: `^${PKG}/`,
        pathNot: [
          '^$1',
          '^node_modules/',
          '/src/index\\.ts$',
          '^kernel/src/testing\\.ts$',
          '^modules/workforce/src/contract\\.ts$',
          '^modules/workforce/src/shift-contract\\.ts$',
          '^modules/workforce/src/fiscal-contract\\.ts$',
          '^modules/workforce/src/work-system-contract\\.ts$',
          '^modules/(group-accounting|franchise|pos-integration|edge-integration|trade|banking|tax-filing)/src/contract\\.ts$',
          '^modules/workforce/src/scheduling/index\\.ts$',
        ],
      },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment:
        'Import cannot be resolved (typo, or a package that is not a dependency of this workspace package — agents sometimes hallucinate package names). Add it to the package.json of THIS package or fix the path.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular (runtime) dependency. Break the cycle by moving shared types down a layer or by emitting an event instead of calling. Type-only cycles are allowed.',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Orphan file: nothing imports it. Delete it or wire it in.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)(index|vitest\\.config|drizzle\\.config|vite\\.config)\\.(ts|mts|cjs|mjs)$',
          '\\.test\\.ts$',
          '\\.spec\\.ts$',
          '(^|/)main\\.tsx?$',
          '(^|/)scripts/',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['(^|/)dist/', '\\.turbo', 'drizzle/migrations'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
