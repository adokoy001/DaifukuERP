# レイヤと依存の規約

```
apps/api      Fastify。kernel の registry からルートを自動生成。モジュールを import してマウントするだけ。業務ロジックを書かない。
apps/web      React。/e/:entity の汎用一覧・フォームはメタデータ駆動。専用画面は modules/<m>/ui/ から登録（Phase 1 以降）。
apps/mcp      MCP サーバ。registry のアクションを tool として公開。
apps/worker   outbox 配信、定期ジョブ。
packs/<p>     業種パック。defineEntity/registerHook/registerOverride のみでコアに接続。
l10n/<cc>     国パック。同上＋テンプレートデータ。
modules/<m>   コア業務モジュール。src/index.ts が公開 API。他モジュールへは @daifuku/mod-<m> で。
kernel        DSL・Repository・Document・Permission・Audit・Numbering・Events・Actions・Decimal・i18n。
```

## モジュールの中身（固定）
```
modules/<m>/
  package.json            name: @daifuku/mod-<m>
  src/index.ts            公開 API（module manifest の export、他モジュールが使ってよい型・関数）
  src/module.ts           defineModule({ name, depends, entities, actions, hooks, seeds, menus })
  src/entities/*.ts       defineEntity / defineDocument（1ファイル1エンティティ）
  src/actions/*.ts        defineAction（1ファイル1〜数アクション）
  src/hooks/*.ts          自モジュール／依存先のフック
  src/services/*.ts       純粋な業務ロジック（DB に触らない関数。テストしやすさ優先）
  src/seeds/*.ts          初期データ
  test/*.test.ts          unit / property
  test/*.db.test.ts       Postgres 実 DB テスト（pnpm test:db）
  test/golden/*.json      golden files
```

## 禁止
- モジュール／l10n／packs が `drizzle-orm`・`postgres`・`fastify`・`node:fs` 等を直接 import（ADR-0013、lint で落ちる）。永続化は `repo()`、イベントは `ctx.emit()`、差し替えは `registry.override()`。足りないポートは kernel に追加して ADR を書く。
- モジュールが他モジュールの `src/` 内部を import（lint で落ちる）。
- apps に業務ロジック。
- kernel に業務用語（partner, invoice…）。kernel は「エンティティ」「ドキュメント」までしか知らない。
