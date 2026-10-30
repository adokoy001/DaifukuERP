# 作業記録: 2026-10-29 設定定義の表示属性と設定画面の再構成（B1）

- セッション: 完成度向上計画 B1（workflow の作業項目、worktree `wip/settings-console`、基点 `ebc7574`）／ 担当: agent ／ 対象: [docs/specs/settings-console.md](../specs/settings-console.md)
- 計測: tokens=null（未計測）, agent_minutes=約120, human_minutes=0, rework_lines=約60（e2e のロケーター変更、依存循環の解消、チェックボックスの必須印、リセット可否の追加）, gate_failures=2（gate:quick の eslint 1 件・依存境界 1 件。どちらも修正後に成功）

## 決めたこと（と理由）

- **表示属性は `SettingDef` に持たせ、登録時に検査する（[ADR-0027](../adr/0027-setting-presentation.md)）。** zod の `title` / `description` は単一文字列で `{ ja, en }` を持てない。画面側にラベル表を持つと module を足すたびに Web を変えることになる。検査は `kernel/src/setting-presentation.ts` の `checkSettingDef` で、property 名と enum 値は API が返すのと同じ `z.toJSONSchema(..., { io: 'input' })` から読む（zod の包みの違いで画面と検査が食い違わないように）。
- **registry と表示属性の型の循環を避けた。** `setting-presentation.ts` は `SettingDef` を import せず、読む部分だけの構造型 `SettingPresentation` を持つ（dependency-cruiser の `no-circular` が type import でも検出したため）。
- **単一値の設定には `fields` の代わりに定義直下の `widget` / `valueLabels`。** spec の AC-2 は単一値への `fields` を禁じるが、`inventory.default_warehouse`（倉庫）や `contract.default_proration`（選択肢）にも表示属性が要る。計画にあった widget の `checkbox` / `select` は schema の型で決まるので持たない。
- **enum 値のラベル（`valueLabels`）を足した。** 目的の「日本語の選択肢で迷わず」に必要（`half_up` / `down` / `up` が生の値で出ていた）。AC-13 の走査にも含めた。
- **各定義に `default` を足した。** 既定値の表示に要る。値は各 module が `getSetting` に渡していた fallback 定数そのもの。`SettingDef.default` の旧コメント（applyPack が既定値と等しい保存値を置き換える）は実装（`applySettings` は保存値を一切上書きしない）と食い違っていたので直した。挙動は変わらない。
- **単一値の設定を JSON 入力から 1 つの入力にした。** boolean はチェックボックス（常に true/false が出るので必須印を付けない）、enum は選択肢、整数は数値の欄。record（`packs.applied`）だけ JSON 入力のまま。
- **勘定科目・倉庫の選択欄は利用者自身の権限で `GET /api/<entity>` を読む。** 新しい読取経路を作らない（計画の原則 1）。`settings` ロールだけの利用者は勘定科目の read 権限が無いので、コードの直接入力に戻る（ブラウザ試験で 403 を返して確認）。保存値が一覧に無いときは値を残したまま「（見つかりません）」と警告する。一覧は 500 件まで（API の上限）。
- **DELETE の監査 op は `delete`。** 変更前 `{ key: 値 }`、変更後 `{ key: null }`。会社行を `FOR UPDATE` で読んでから `settings - key` で消す。保存値が無ければ何もしない（監査も無し）。
- **履歴は `company_settings` の監査のうち、key を変更前・変更後の snapshot に持つ行。** `setSetting` / `deleteSetting` に加え、pack 適用・l10n seed の書込みも同じ形なので含まれる。操作者は同じ tenant の利用者の `name` だけを添える（メールは返さない）。
- **権限検査は kernel の 1 関数（`assertSettingsAccess`）に寄せた。** `setSetting` / `deleteSetting` / `settingHistory` が同じ境界（admin か `settings`、かつ `accessScope` が `all`）になり、route を経ない呼出しでも同じ。
- **`packs.applied` には「既定に戻す」を出さない。** 消すと会社の全テンプレートのフック・画面が無効になる（`withContext` が `packs.applied` から `appliedPacks` を作る）。規則は「既定値の宣言が無い JSON 入力の設定には出さない」（`canReset`）。JSON 編集は従来どおり残した。読取専用の属性は B4 の `setup.progress` と合わせて検討（spec の未決事項）。
- **リセット後の焦点はカードの「保存」。** 「既定に戻す」ボタンが消えるため kit の `Dialog` は開いた要素へ焦点を戻せない（ui.md の決まりどおり画面側で決める）。
- **pack の設定は「業界」タブにまとめた**（spec の未決事項の初版どおり）。
- **ADR-0013 の L1 に追記**し、pack 規約に「pack 自身の設定は fields / valueLabels / default を書く」を足した。

## やったこと

- kernel: `setting-presentation.ts`（新規）、`registry.ts`（`SettingDef` の拡張、`registerSetting` で検査）、`settings.ts`（`deleteSetting`、`settingHistory`、`assertSettingsAccess`）、`index.ts`
- api: `routes/settings.ts`（`toOut` に category / order / fields / widget / valueLabels / defaultValue / isDefault、`DELETE /meta/settings/:key`、`GET /meta/settings/:key/audit`）
- modules / packs: tax・sales・purchase・payment・inventory・contract・industry-operations、example・retail・real-estate の設定定義に表示属性と `default`。説明文から英語の property 名の列挙（`receivable=売掛金` など）を除いた
- web: `lib/settings-console.ts`（新規。タブ・並び・フォームの形・既定値と履歴の文・`canReset`）、`lib/schema.ts`（`fields` の反映）、`components/setting-card.tsx`・`setting-code-field.tsx`（新規）、`pages/settings-page.tsx`（Tabs と `?tab=`）、`router.tsx`（`validateSearch`）、`api/settings.ts`・`api/types.ts`、`ui/token-usage.test.ts` の `CONVERTED` に 2 ファイル
- tests: `kernel/test/setting-presentation.test.ts`、`apps/runtime/test/setting-labels.test.ts`、`apps/web/src/lib/settings-console.test.ts`、`apps/api/test/settings-console.db.test.ts`、`apps/web/e2e/settings-console.spec.ts`
- 文書: ADR-0027（新規）、ADR-0013 追記、マニュアル 03（設定画面の説明・表・発行者の手順を日本語の細目名に、英語細目名の注意を削除、スクリーンショット `img/03-settings.png` を会計タブで撮り直し）、`docs/conventions/ui.md`（Tabs の注記、「会社設定の画面」節）、`docs/conventions/packs.md`、spec（implemented、実装で変えた点）

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 単体（新規）: `kernel/test/setting-presentation.test.ts` 25 件（AC-1〜AC-3）、`apps/runtime/test/setting-labels.test.ts` 4 件（AC-13。全 module と全 16 pack を `loadRuntime({ schema: true })` で読み込み、26 設定を走査、6.6 秒）、`apps/web/src/lib/settings-console.test.ts` 14 件（AC-8〜AC-12）。既存の `lib/schema.test.ts`・`ui/token-usage.test.ts` も成功。
- [実測] 登録時の検査が全設定を通ることを、全 pack を読み込んで registry を列挙するスクリプトで確認（26 設定、分類・既定値・shape を目視）。
- [実測] DB: `apps/api/test/settings-console.db.test.ts` 14 件成功（15.9 秒、`daifuku_test_w5`）。GET の新属性、PUT 後の `isDefault: false`、DELETE の監査（op `delete`、変更前と null）と保存値なしでの無変更、未宣言 key の 404、履歴の順序・操作者名・20 件の上限、sales ロールと拠点限定（admin + settings）の 403、kernel の `deleteSetting` / `settingHistory` を店舗限定・sales の Context で直接呼んで拒否、401、OpenAPI。
- [実測] `pnpm gate:quick --base ebc7574` 成功（92 秒。unit は関連 62/134 ファイル）。1 回目は eslint（テストの非 null 表明）、2 回目は依存境界（registry ↔ setting-presentation の循環）で失敗し、修正した。
- [実測] `pnpm gate:light --base ebc7574` 成功（17.3 分。kernel の変更で DB を全件に昇格: 117 ファイル 715 件 882.9 秒、unit 134 ファイル 1,254 件 53.9 秒、format:check・docs・台帳・typecheck（root / api / web）・lint（警告 4 件は既存ファイルの関数行数）・test:deploy も成功）。実行中にブラウザ試験を並行して走らせたため、DB の時間は単独実行より長い可能性がある。
- [実測] ブラウザ（`e2e-run.sh … 2`、隔離 fixture DB）: `settings-console.spec.ts` 4 件成功（`--no-deps`、約 22 秒）。タブは設定がある分類だけで kernel の順、`?tab=` の保持と読込、不明な値で先頭、roving tabindex、← → で移動と選択・端で反対側へ、Home / End、Tab でパネルへ。売上転記の勘定科目を既定値表示から「4100 雑収入」に変えて保存、API で保存値を確認、存在しないコード 9999 の警告と `aria-invalid`、履歴（変わった細目だけ、初回は「未設定 →」）、既定に戻す（Esc で取りやめ・焦点が開いた要素へ戻る、実行後は焦点が保存へ、API で保存値なし、履歴の先頭が「既定に戻す」）。チェックボックス・倉庫の選択・端数処理と日割りの選択肢ラベル・住所の textarea・登録番号の説明、科目一覧が 403 のときのコード入力、英語表示のラベル。390px で横はみ出しなし（タブ一覧は内側でスクロール）、ダイアログが画面内。
- [実測] ブラウザ（最終状態）: `settings-console.spec.ts`・`ui-kit.spec.ts`（設定画面の骨格・失敗表示を含む 10 件）・`navigation.spec.ts`（5 件）を industry project 込みで実行し 22 件すべて成功（2.0 分）。navigation は業界会社に依存するため、`--no-deps` で走らせた途中の回では AC-3/10 が業界会社の不在で失敗した（今回の変更と無関係。依存込みで成功）。
- [レビュー] スクリーンショット（390px の販売タブ・リセットのダイアログ、1280px の会計タブ・履歴）を目視。
- [未検証] `pnpm gate:full`（統合担当が実行）。ブラウザ試験の全件（82 + 本件 4 件）は未実行で、実行したのは上記 3 spec。
- [未検証] 無効タブを飛ばすキーボード操作のブラウザでの確認（無効タブを持つ画面が無い。`nextTabIndex` の unit のみ）。
- [未検証] A2 の axe 検査（並行作業）での設定画面の結果。
- [未検証] 勘定科目が 500 件を超える会社の選択欄、モバイル実機。

## 見つけた問題と修正（発見経路つき）

- マニュアル 03 の端数処理の単位に「delivery_note 納品書ごとも選べる」とあったが、schema は `invoice` だけ — 発見: レビュー（設定定義と照合）、修正: マニュアルを「納品書ごとは未対応」に。
- `SettingDef.default` のコメントが applyPack の実装と食い違っていた — 発見: レビュー、修正: コメントを実装に合わせた。
- e2e: 必須印 `*` がラベルの文字に含まれ `getByLabel(exact)` が一致しない、単一値ではカードの group と入力欄が同じ名前になる — 発見: E2E、修正: コード選択欄の `*` を `aria-hidden`、select に `required`、ロケーターを role + name に。
- 単一値の boolean に必須印が出てチェックボックスの名前に `*` が混ざる — 発見: E2E の想定確認、修正: boolean の単一値は必須にしない。
- registry ↔ setting-presentation の型 import の循環 — 発見: gate:quick（依存境界）、修正: 構造型。

## 未実施（減らさない。完了したら「済」を付けて残す）

- `docs/STATUS.md` / `PLAN.md` / `docs/completion-plan.md` / `docs/improvement-candidates.md` の更新（統合担当）
- `pnpm metrics:add`（統合担当がまとめて記録）
- `pnpm gate:full` とブラウザ試験の全件（統合担当）

## 判断待ち（利用者）

- pack の設定を「業界」タブにまとめるか、pack ごとのタブにするか（初版はまとめた）。
- `settings` ロールに勘定科目・倉庫の read を足して選択欄を使えるようにするか（現状はコード入力に戻る。権限の変更なので本件では行っていない）。
- `packs.applied` のような記録用の設定を読取専用にする表示属性を設けるか（B4 の `setup.progress` と合わせて）。

## 次のセッションへ

- B2 は `company.profile` を `category: 'company'`（key の先頭が `company` なら省略可）と全細目の `fields` 付きで登録し、ADR-0027 に節を足す。B4 の `setup.progress` も同様（`category: 'system'`）。
- 新しい設定を足すと `apps/runtime/test/setting-labels.test.ts` が日英ラベルと enum ラベルの不足を落とす。
