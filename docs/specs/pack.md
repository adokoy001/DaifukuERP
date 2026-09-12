# Spec: pack（導入テンプレート機構 — definePack と pack:apply）

- 状態: approved ／ 層: kernel（`definePack`）＋ apps/api（登録・適用 CLI・API）＋ packs/example（実証用の最小 pack）／ 依存: kernel-phase15（registerExt、settings、internal）
- ADR: 0013（カスタマイズ層）, 0014（ext 登録）, **0015（本 spec で新設: packs）**
- 作成: 2026-09-11 ／ 作成者: orchestrator

## 目的
業種・顧客ごとの差分を、コアを改変せずに **1 つの宣言（pack）** にまとめ、会社単位で適用できるようにする。Phase 2T の「小売」「不動産」テンプレートはこの機構の上に作る。H3（カスタマイズで吸収できるか）の計測単位でもある: コア差分行数 vs pack 行数。

## 受入基準（EARS）
- AC-1 THE SYSTEM SHALL provide `definePack(cfg)` in kernel (`kernel/src/dsl/pack.ts`) with: `name` (snake_case), `label`, `depends: string[]` (module names that must be registered), `ext?: Record<entityName, FieldMap>` (registered through `registry.registerExt` with `source: pack:<name>` at definition time), `entities?: EntityDef[]` (packs may add small entities; they are registered like module entities and appear in /meta, migrations, CRUD actions), `actions?: ActionDef[]`, `hooks?: () => void` (overrides/hooks/guards), `settings?: Record<settingKey, unknown>` (company setting defaults applied by `apply`; keys must be registered settings — validated by their schema; unknown key → ValidationError at apply), `labels?: Record<entityName, { entity?: Label; fields?: Record<fieldName, Label> }>` (UI label overrides, exposed through /meta: kernel `entityMeta` consults `registry.labelOverrides(entity)`), `menus?: MenuItem[]`, `seed?: (ctx) => Promise<void>` (idempotent masters, e.g. accounts, uoms, tax rates), `sample?: (ctx) => Promise<void>` (demo data; optional; NOT idempotent-required but must be safe to call once), `roles?`.
- AC-2 `registry.registerPack(def)` / `registry.packs()`; `definePack` registers ext/entities/actions/labels immediately (so migrations and /meta see them) and returns the def. Dependency check: every name in `depends` must already be a registered module or pack → else DependencyError with hint listing what is missing.
- AC-3 THE SYSTEM SHALL provide `applyPack(ctx, name, { sample?: boolean })` in kernel (`kernel/src/pack.ts`): (1) applies `settings` via `setSetting` **only for keys the company has not set yet** (does not overwrite an admin's explicit choice — unless `{ force: true }`), (2) runs `seed`, (3) optionally `sample`, (4) records `packs.applied` (registered setting: `{ [packName]: { at: ISO, version: string } }`) so a second apply is a no-op for settings/seed unless `force`. Wrapped in the request transaction. Permission: role `admin` (of the company).
- AC-4 apps/api: (a) `apps/api/src/packs.ts` imports the available packs (`@daifuku/pack-example` for now; retail/real-estate later) after modules and before `registerCrudActions()`; (b) action `pack.apply { name, sample?, force? }` (kernel-provided generic action, permission admin, `mutates: true`) and `pack.list` (returns packs with applied status for the current company) — both exposed to REST/MCP; (c) CLI `pnpm pack:apply <name> [--company <id>] [--sample]` (apps/api/src/db/cli.ts or a new `pack-cli.ts`, using systemContext for the company; default company = the first company of the seeded tenant).
- AC-5 /meta: `entityMeta` label overrides from packs; `extFields` already carry `source`. `AppMeta.packs: { name, label, applied: boolean }[]`.
- AC-6 `packs/example` (`@daifuku/pack-example`, name `example`): the smallest pack that exercises every feature: ext on `partner` (`ext.customer_rank` enum A/B/C, `ext.note2` text searchable), one setting default (`sales.issuer.name` = 'Example Co.' — or another existing registered setting if that one is structured; pick one that is a plain value), one label override (partner entity label → 「得意先/仕入先」), one tiny entity `example_tag` (code, name), one action `example.hello` (returns count of partners with rank A), a `seed` that inserts 3 tags idempotently, a `sample` that inserts 2 partners with ranks. Tests (`packs/example/test/pack.db.test.ts`, DB `daifuku_test_packs`): apply → setting set, tags seeded, second apply no-op (versions unchanged), force re-applies; partner create with bad rank → ValidationError; list where `ext.customer_rank = 'A'`; `/meta` shows label override and extFields with source `pack:example` (via `appMeta(ctx)` directly, no HTTP needed).
- AC-7 dependency-cruiser: packs may depend on kernel, modules, l10n; apps depend on packs; nothing depends on packs except apps (rule `packs-do-not-depend-on-apps` exists; add `only-apps-depend-on-packs`).
- AC-8 Docs: ADR-0015（packs: なぜモジュールと分けるか（層と適用単位）、常時ロード＋会社単位適用という v1 の割り切り、ラベル上書きがグローバルである制限）、`docs/conventions/packs.md`（pack の書き方: 何を pack に書き、何を module に書くか。判断基準: 「他業種でも要るなら module、この業種だけなら pack」）。

## 関係するファイル
- kernel/src/{dsl/pack.ts, pack.ts, registry.ts (packs, labelOverrides), meta.ts (labels, packs), settings.ts (packs.applied), actions/pack.ts (pack.apply/pack.list generic actions), index.ts}; kernel/test/{pack.test.ts, pack.db.test.ts}
- apps/api/src/{packs.ts, modules.ts (import order: modules → l10n → packs → registerCrudActions), db/cli.ts or pack-cli.ts}, package.json script `pack:apply` (root package.json too)
- packs/example/src/{index.ts, pack.ts, entities/example-tag.ts, actions/hello.ts, seed.ts, sample.ts}, packs/example/test/pack.db.test.ts
- .dependency-cruiser.cjs, docs/adr/0015-packs.md, docs/conventions/packs.md, docs/log/2026-09-11-pack.md

## スコープ外
会社ごとのラベル上書き、pack のアンインストール、pack 間の依存解決の順序最適化、UI からの適用画面（Phase 2M でマニュアルに CLI/API 手順を書く）。

## 検証手順
1. `pnpm gate`（本体が統合後に実行）；エージェントは kernel/packs/api の unit＋db テストを自分の DB で実行。
2. `pnpm pack:apply example --sample` を daifuku_dev に対して実行（本体が統合後に確認）→ `/meta` に label とextFields、UI のフォームに「追加項目」。
