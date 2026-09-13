# Daifuku (大福帳) — agent map

Multi-industry ERP kernel + modules. An experiment in AI-driven large-scale development.
Start with [AI_INDEX.md](AI_INDEX.md) for task-specific reading paths and [architecture](docs/architecture/README.md) for the current design.
This file is a MAP, not a manual. The system of record is `docs/`. Read the doc a task needs; do not paste docs here.

## Layout (dependencies flow downward only; enforced by `pnpm lint:boundaries`)
```
apps/      api (Fastify), web (React), mcp (MCP server), runtime      -> may import everything below
packs/     customization packs (per customer/scenario; small)          -> kernel, modules, l10n
l10n/      country packs (jp first)                                    -> kernel, modules
modules/   core business modules (partner, product, accounting, ...)   -> kernel, other modules (public index only)
kernel/    entity DSL, repository, documents, permissions, audit, numbering, events, actions
docs/      adr/ conventions/ domain/ specs/ log/ metrics/  <- READ THESE, WRITE TO THESE
```

## Commands
- `pnpm install` — workspace install
- `pnpm format` / `pnpm format:check` — format source with pinned Prettier / verify formatting without changes.
- `pnpm gate` — format check + typecheck + lint/boundaries + unit + DB + deployment tests + documentation links + assurance checks. **Must pass before any PR/commit claiming "done".**
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm test:db` (needs Postgres: `DATABASE_URL` in `.env`, see `.env.example`)
- `pnpm db:schema && pnpm db:generate && pnpm db:migrate` — regenerate drizzle schema from the entity registry, generate migration, apply
- `pnpm dev:api`, `pnpm dev:web`
- `pnpm metrics:add -- --feature <slug> --tokens N --minutes N --human-minutes N --rework-lines N` — record a data point (docs/metrics/)

## Non-negotiable rules (each exists because agents got it wrong somewhere; see docs/conventions/)
1. **Entities are declared with the kernel DSL** (`defineEntity` / `defineDocument` / `defineAction`). Never hand-write tables, Zod schemas, routes or MCP tools for an entity — the kernel derives them. If the DSL cannot express something, extend the DSL in `kernel/` and write an ADR.
2. **No permission bypass exists.** Every read/write goes through `Repository` with a `Context`. Do not add `ignorePermissions`-style flags. Need more access? Use a context with the right role (`systemContext()` is for migrations/seeds only).
3. **Money and quantities are `Decimal`**, never JS `number`. DB columns are `numeric`. Lint forbids `parseFloat`.
4. **Documents never get deleted or edited after submit.** Cancel + amend creates a new version. Ledger lines are append-only.
5. **Modules/l10n/packs never import drizzle/postgres/fastify/node:fs** — only kernel ports (`repo`, `ctx.emit`, `registry.override`, `ctx.now`, `newId`). Missing port → add to kernel + ADR (ADR-0013).
6. **Cross-package imports by package name only** (`@daifuku/kernel`, `@daifuku/mod-partner`). Never `../../other-package/src/...`.
7. **Format first; split only when readability or responsibilities improve.** Use the pinned Prettier configuration (120-column target, LF). Files over 1,000 nonblank/noncomment lines and functions over 300 produce review warnings, not failures. Do not split solely to satisfy a line count, compress statements, or add formatter/lint ignores to hide warnings. See [formatting and gate](docs/conventions/lint.md).
8. **Tests are not deleted, skipped or weakened to make gates pass.** If a test is wrong, fix it and say so in the work log.
9. **One feature = one spec (`docs/specs/`) = one branch = one PR = one work-log entry (`docs/log/`).** Spec first (EARS acceptance criteria, out-of-scope, verification steps). Log after (what was decided, what was verified and *how*: review vs. measurement).
10. **Japanese business rules cite their source** in `docs/domain/` (URL + date). Tax rates and legal parameters are data with validity periods, never constants in code.
11. **Claims are calibrated.** "Done" means the gate passed and the verification steps in the spec were executed. Say "not verified" when it is not.

## Where things are
- Architecture decisions: `docs/adr/` (start with 0001–0013; 0013 = hexagonal ports & customization layers)
- Conventions (naming, layers, errors, tests, money/date): `docs/conventions/`
- Domain glossary (ja/en) and Japanese regulatory facts with sources: `docs/domain/`
- Spec template: `docs/specs/_template.md`; work-log template: `docs/log/_template.md`
- Experiment hypotheses and metrics: `docs/experiment.md`, `docs/metrics/`

## Language
Identifiers, code, commits, PR titles: English. Specs, ADR bodies, logs, domain docs: Japanese (technical terms may stay English). UI strings: both (`{ ja, en }`).
