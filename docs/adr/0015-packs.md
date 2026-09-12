# ADR-0015: 業種・顧客の差分は pack（definePack）にまとめる。定義は常時ロード、適用は会社単位

- 状態: 採択（2026-09-11、docs/specs/pack.md）／ 確信度: 中
- 関連: ADR-0001（モジュラーモノリス）、0003（JSONB `ext`）、0008（拡張機構）、0009（アクション自動公開）、0013（ポートとカスタマイズ 4 層）、0014（ext 登録）

## 文脈
- Phase 2T で「小売」「不動産」の導入テンプレートを作る。ADR-0013 の L4（パック）はディレクトリ（`packs/`）と依存方向だけが決まっていて、「何を 1 つの pack と呼び、どう会社に入れるか」が無かった。
- ADR-0014 で ext をコードで登録できるようになったが、ext・小さなエンティティ・設定の既定値・ラベル・初期データがばらばらの API で、導入の単位（「この会社に小売テンプレートを入れた」）が記録されない。
- 実験仮説 H3（カスタマイズで吸収できるか）は「コア差分行数 vs pack 行数」で測る。そのためには pack が 1 パッケージ・1 宣言で閉じている必要がある。

## 決定
1. **pack は module と別の層**（`packs/<p>`、パッケージ名 `@daifuku/pack-<p>`）。
   - 依存してよいのは kernel・modules・l10n。packs を import してよいのは apps だけ（dependency-cruiser `only-apps-depend-on-packs`。kernel/modules/l10n からは既存の層ルールでも落ちる）。例外として、`depends` に書いた別の pack はパッケージ名で import してよい。
   - module との違いは「層」と「適用単位」。module は業種を問わず要る業務で、seed は `db:reset` で全社に入る。pack はその業種・顧客だけの差分で、会社ごとに明示的に適用する（`pack:apply`）。コア（modules）は pack を知らない。
2. **`definePack(cfg)`（`kernel/src/dsl/pack.ts`）** は `defineModule` と同じく import 時に登録する。`name`（snake_case。module と同じ名前空間、`pack` は予約）、`label`、`version`（既定 `0.0.0`）、`depends`、`ext`（`registry.registerExt(entity, fields, { source: 'pack:<name>' })`）、`entities`（所有を記録。テーブル・/meta・汎用 CRUD はエンティティと同じ経路）、`actions`（`<name>.` 接頭辞）、`hooks`、`settings`（既定値）、`labels`、`menus`、`seed`、`sample`、`roles`。
   - **全部通るまで何も登録しない**: 名前・アクション接頭辞・ラベル対象の項目名 → `ValidationError`。`depends` の未登録、ext/labels の対象エンティティが未登録または `depends`（推移閉包）から辿れない module に属する → `DependencyError`（hint に不足名）。名前の重複・他 manifest が所有するエンティティ・ext キーの重複・ラベルの重複 → `Conflict`。ext は複数エンティティにまたがっても事前に全部検査してから登録する。
   - `settings` のキーは定義時には検査しない（pack 自身の `hooks` や後から読み込まれる module が宣言することがあるため）。適用時に検査する（3.）。
3. **`applyPack(ctx, name, { sample?, force? })`（`kernel/src/pack.ts`）** は呼び出し側のトランザクション（リクエスト / CLI の `withContext`）で動く。seed が失敗すれば設定の書き込みも巻き戻る。
   - 権限: 会社コンテキストの `admin` だけ（`settings` ロールでは不可。seed がマスタを書くため）。会社が無いコンテキスト → `NotFound`、未登録 pack → `NOT_FOUND`（hint に読み込み済み pack 一覧）。
   - 初回: (1) `settings` を全キー検証（未登録キー・schema 不一致は `ValidationError`、何も書かない）→ 会社が**まだ持っていないキーだけ** `setSetting`（監査あり）、(2) `seed`、(3) `sample: true` なら `sample`、(4) `packs.applied[name] = { at, version, sampledAt? }` を記録。
   - 2 回目以降（記録あり）: 設定と seed は何もしない（書き込みゼロ。監査行も増えない）。`sample: true` で sample が未実行ならそれだけ実行して `sampledAt` を足す。`force: true` は設定を上書きし（管理者の選択も戻す）、seed と sample を再実行し、`at`/`version` を更新する。
   - `version` が変わっても force なしでは再適用しない（spec どおり）。`pack.list` の `version` と `appliedVersion` の差で分かる。
4. **`packs.applied` は通常の会社設定**（kernel が `registerPackActions` / `applyPack` で `registerSetting` する）。`/meta/settings` に出るので、管理者がエントリを消せば次の適用で設定と seed が再実行される。壊れた値は「未適用」として読む。
5. **常時ロード＋会社単位適用（v1 の割り切り）**: apps は読み込んだ pack の定義をプロセス全体（全テナント・全会社）に登録する。会社単位なのは設定・seed・sample と適用記録だけ。
   - ext フィールド・pack エンティティ・アクション・フック・メニュー・ラベル上書きは、未適用の会社にも見える／効く。
   - したがって pack は必須（`required`）の ext を足さない（未適用の会社の作成・更新が VALIDATION になる）。会社によって挙動を変えたいフックは `readAppliedPacks(ctx)` で自分が適用済みか確かめる。
6. **ラベル上書きはグローバル**: `registry.labelOverrides(entity)` を `entityMeta`（エンティティ名・項目名）が参照する。2 つの pack が同じエンティティ名／同じ項目のラベルを上書きすると定義時 `Conflict`（黙って後勝ちにしない）。module のメニュー名・汎用 CRUD アクションの説明文は変えない。ext 項目のラベルは ext 定義に書く（上書き対象外）。
7. **/meta**: `AppMeta.packs: { name, label, applied }[]`。`applied` は `MetaOptions.appliedPacks` から（apps/api の `/meta` は `appliedPacksOf(company.settings)` を渡す）。pack のメニューとエンティティのグループ化のため、`AppMeta.modules` の後ろに pack も同じ形で並べる。
8. **apps の配線**: import 順は modules → l10n → packs（`apps/api/src/packs.ts`、`apps/mcp/src/modules.ts`）→ `registerPackActions()`（`pack.apply` admin・mutates、`pack.list` authenticated・読み取り）→ `registerCrudActions()`。CLI `pnpm pack:apply <name> [--company <id>] [--sample] [--force]`（既定の会社は `db:reset` のデモテナントの最初の会社。owner 接続は会社の解決だけ、適用は app 接続＋`systemParams`）。`db:reset` の `seedAll` は pack を適用しない。

## 帰結
+ 業種テンプレートが 1 パッケージ・1 宣言になり、H3 の「pack 行数」をパッケージ単位で測れる。
+ 適用は冪等で、2 回目は書き込みゼロ。管理者が変えた設定は force なしでは上書きされない。適用記録が会社設定と監査に残る。
+ pack の追加項目・エンティティ・アクションは既存の経路（Repository 検証、/meta、OpenAPI、MCP）にそのまま乗る。専用の API は `pack.apply` / `pack.list` の 2 つだけ。
− 未適用の会社にも pack の項目・メニュー・ラベルが見える。複数業種の pack を同じプロセスで読み込むと、同じエンティティのラベルを上書きできない（Conflict）。テナント／会社ごとの有効化は別途（DB 定義からの流し込みか、プロセス分割）。
− pack のエンティティはマイグレーションに入るので、pack を足すたびにマイグレーション生成が要る（未適用の会社にも空テーブルができる）。
− アンインストール・ダウングレード・version 変更時の自動再適用は無い。
− `packs.applied` が汎用設定画面に JSON のまま出る（編集できてしまう。記録を消して再適用するための逃げ道でもある）。
− kernel のポートが増えた（`definePack`、`applyPack`、`readAppliedPacks`、`registerPackActions`、`registry.labelOverrides`）。ADR-0013 の「ポート数が 15 を超えたら再検討」の閾値を超えつつある。

## 最強の反論
- **pack は「会社で有効化できる module」に過ぎず、層を分けるのは過剰。module に `optional: true` を付ければ済む。** → 層を分けないと、コア module が業種 pack の型や関数を import し始めても lint で止められない（「他業種でも要るものがいつの間にか小売 pack に依存」）。H3 の計測でもコア差分と pack 差分を機械的に分けられなくなる。
- **常時ロードでは会社単位のカスタマイズと言えない。適用した会社だけに ext・フック・ラベルを効かせるべき。** → 会社ごとにスキーマ（zod・JSONB 検証・/meta）を変えると、Repository・権限・キャッシュ（extVersion）がすべて会社をキーに持つ必要があり、v1 の規模に見合わない。v1 は「データ面は会社単位、定義面はプロセス単位」と明示し、会社差のあるフックだけ `readAppliedPacks` で分岐させる。複数業種を 1 プロセスで本当に混在させる段階で再検討する。
