# ADR-0031: entity も明細（`lines`）を持てる。凍結は document だけに残す

- 状態: 採択
- 日付: 2026-10-30
- 関連: [エンティティ DSL](0002-declarative-entity-dsl.md)、[document の状態](0006-docstatus-lifecycle.md)、[ポートとカスタマイズ層](0013-hexagonal-ports.md)、[明細の hook](0014-ext-fields-internal-actions-lines-hook.md)、[基盤の不変条件](0016-foundation-invariants.md)、[受入基準](../specs/recurring-journals.md)（定期仕訳 AC-1〜AC-3、AC-7）
- 番号: 同じ round の opening-balances（B6）が 0030 を使うため 0031 とした。統合時に衝突したら統合担当が振り直す。

## 背景

定期仕訳のテンプレート（`recurring_journal`）は、`isActive` で止め、いつでも直せるマスタ（entity）でありながら、仕訳と同じ形の明細（勘定科目・借方/貸方・取引先・税区分）を持つ。kernel の明細（`lines`）は `defineDocument` 専用で、entity は明細を持てなかった。

採らなかった案:

- **document にする**: 金額を直すたびに取消 → 訂正が要り、訂正版は id が変わるので、回の重複防止を版をまたいで引き継ぐ仕組み（系列 id）が別に要る。
- **明細を別 entity にして 1 行ずつ作る**: ヘッダと明細が別の保存になり、汎用フォームで明細を編集できない。親のロックと版、500 行の上限、`after_lines_saved` も使えない。
- **json field**: 汎用フォームが JSON の入力欄になり、勘定科目の参照整合性も失う。

## 決定

1. **DSL**: `lines?: { entity, parentField }[]` を `DocumentConfig` から `EntityConfig` へ移す（`DocumentConfig` は継承で従来どおり書ける）。kernel は `entity.doc?.lines` ではなく `entity.config.lines` を読む（`lineSpecs`、`lockParents`、`assertAggregateLimit`、`hasLines`、`EntityMeta.lines`、関連記録、CSV 取込の対象外判定）。明細 entity の `parentField` が親への `ref` でなければ、従来どおり定義の解決時に `Error`（文言は `entity <name>` / `document <name>`）。
2. **共有するもの**: 置換保存（`saveLines`）、汎用の作成・更新・取得の `lines`（REST・MCP・`<entity>.create` / `update` / `get`）、明細の書込みで親を先にロックして親の版を上げること、親 1 件あたり 500 行、保存ごとに 1 回の `after_lines_saved`、明細の参照を親の参照として扱う関連記録（C2）、明細 entity を CSV 取込（B5）の対象にしないこと。
3. **document だけに残すもの**: 下書きでない親の明細の凍結（`saveLines` の draft 検査、`lockParents` の submitted / cancelled 検査）と、submit / amend の明細処理（`document.ts`）。entity の親は docstatus を持たないので凍結しない。
4. **権限**: entity の明細を変えるには親の update が要る。`saveLines` は従来どおり親を `update` で読み、明細 entity への直接の書込み（`<line>.create` / `update` / `delete`）も、親が entity なら作成を含めて親を op `update` でロックする。document の親は従来どおり明細の作成で op `create` を使う（下書きを作る権限で明細を足せる）。親の create だけを持つロールは、既存の entity の親に明細を足せない。
5. **ヘッダと明細を 1 回で送る更新**: 汎用の更新が `lines` を持つとき、`crud.ts` はヘッダの `Repository.update` の間も集約に置換中の印（`markReplacing`）を付ける。親の `before_update` hook は `isSavingLines(ctx, entity, id)` が true ならヘッダだけの規則を検査し、明細に依存する規則は新しい明細が保存された後の `after_lines_saved` に任せる。`lines` の無い更新では false のままで、hook は保存済みの明細に対して検査できる。この印を読む既存の hook はすべて明細側の hook で（`modules/*/src/hooks/lines.ts` などを確認）、ヘッダの更新中に明細の hook は動かないので、document の振る舞いは変わらない。

## 結果

- 良い点: マスタ（定期仕訳、将来のレシピのようなもの）が document と同じ明細の仕組みと汎用画面（明細グリッド・複製）を使える。DSL の外に明細の保存を書かない。
- 注意: entity の明細は凍結されないので、履歴に効く値を守る必要がある entity は、その module の hook で守る（定期仕訳は按分の生成開始後に明細の行・勘定科目・金額の変更を拒否する。recurring-journals AC-8）。
- 注意: 汎用フォームの明細グリッドは、要求者が親を更新できない場合だけ読取専用になる。entity 固有の読取専用（按分の生成開始後）は web 側の小さな関数（`apps/web/src/lib/recurring.ts` の `recurringLineLock`）で理由とともに示し、サーバー側の拒否が正となる。
- 影響を受けない: document の明細の API・画面・凍結・submit / amend、明細の hook（ADR-0014）。

## 検証

- unit: `kernel/test/entity-lines.test.ts`（entity の `hasLines`、作成・更新の入力と出力の `lines`、`EntityMeta.lines`、`parentField` の誤りの `Error`、明細 entity の取込対象外）。
- DB: `kernel/test/entity-lines.db.test.ts`（置換保存と取得、親の版、500 行、`after_lines_saved` 1 回、凍結しないこと、親の update が無いときの `saveLines` と直接の create / update / delete の拒否、`lines` つき更新の `before_update` で `isSavingLines` が true、document は確定後に凍結）。定期仕訳の組み合わせは `modules/accounting/test/recurring.db.test.ts`（定額 → 按分と明細の削減を 1 回で送る更新）。
