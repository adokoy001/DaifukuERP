# 作業記録: 2026-10-30 証憑の横断検索（E4）

- セッション: 完成度向上計画 E4（workflow の作業項目、worktree `wip/evidence-search`、基準 `4afa6d1`）／ 担当: agent（spec 担当の後の実装担当）／ 対象: [docs/specs/evidence-search.md](../specs/evidence-search.md)
- 計測: tokens=null（未計測）, agent_minutes=約 85（spec 批評の反映 10 分、実装と試験 45 分、ブラウザ・計測・gate の待ち時間 30 分）, human_minutes=0, rework_lines=約 40（DB 試験の差替の順序、型・lint の指摘、試験の型、クリアの不具合）, gate_failures=5（gate:quick 3 回: 作業記録への文書リンクが未作成、eslint 2 件、API の型検査 1 件。gate:light 2 回: `GATE_BASE` 環境変数で基準を渡したため、`scripts/test/gate.test.ts` の AC-9 が起動する子の gate にその変数が漏れて 30 秒で失敗。`--base 4afa6d1` で渡し直して成功）

## 決めたこと（と理由）

- **spec 批評（重大 1・軽微 9・指摘 10）を先に spec へ反映し、別のコミットにした**（`4c0339c`）。採否と理由は spec の「spec 批評への対応」に記録した。重大な指摘（可視性の差を権限の規則の書換えで片付けない）は受け入れ、権限の文書の行は書き換えずに「既知の差（未達）」の注記を足した。`attachment.search` への入力の追加は取り下げた。最新版へのリンクは DTO に `latestId` を足さず、AC-15 を「差替先へ移動 / 履歴を開く」に変えた。明細へのリンクは親の伝票として解決する方を選んだ。
- **証憑の行の可視性は現状どおり（リンク先の読取規則を継承しない）とし、利用者の確認待ちとして残した。** 役割表を確かめた結果: attachment は accounting / sales / purchasing が read・create・update、viewer が read。purchase_invoice は sales に read が無く、payment は sales に `direction: 'pay'` を見せない行の規則がある。したがって sales は仕入請求書や支払に結び付いた証憑のファイル名・金額・取引先を読める（DB 試験で実測）。人事・給与の entity（`workforce_*`）に証憑を結び付けることは書込経路上できる（`assertLinkTarget` は登録済みのどの entity も、書く人が読めれば受け付ける）が、その証憑も attachment を読める役割に見える。閉じるには kernel の行の規則の拡張と ADR が要るため、この項目では変えていない。
- **リンク先の要約は module の `services/linked.ts` で、kernel の公開 API（`registry`・`repo`・`can`・`maskedFields`）だけで作った。** 結果ページのリンク先 entity ごとに `Repository.list({ where: { id: { $in } }, limit: ids.length })` を 1 回。明細は registry の `doc.lines` から親 field を引き、親の field が要求者にマスクされていれば辿らない。`kernel/src/related.ts` の非公開関数は使っていない（似た処理が 2 か所になるが、kernel を変えないため）。
- **差替前の件数は `Repository.aggregate`（`groupBy: ['supersededById']`、`count`）で結果ページ分を 1 回に数えた。**
- **差替の履歴は最新版を根とする木。** 指定した証憑から最新版までの経路は必ず返し（打切りなし、500 段で安全上の上限）、残りを最新版から幅優先で合計 50 行まで足し、返さなかった行があれば `truncated`。差替の理由は監査ログの `action: 'attachment.supersede'` の最新の記録（`auditTrail` の `limit` 500）から取り、無ければ 4 項目とも null。
- **公開 DTO は `Attachment.schemas.json.omit({ storageKey: true }).extend(...)`。** 出力 schema の検査でも `storageKey` は落ちるが、手でも外した。
- **一括ダウンロードはブラウザ内の STORE 方式の zip（`apps/web/src/lib/zip.ts`、依存パッケージなし）。** 各ファイルは既存の `GET /api/attachments/:id/download` を 1 件ずつ通る（権限・保存範囲・サイズと SHA-256 の照合がそのまま効く）。名前は UTF-8 フラグに加えて Info-ZIP Unicode Path 拡張フィールド（0x7075）を付けた。最終の Blob は取得した Blob とヘッダの配列から組み、全体を 1 つのバッファに複製しない。上限は 50 件（C1 の `toggleSelection` の上限として 51 件目を受け付けない）と合計 100 MB（ボタンを無効にする）。
- **検索と履歴の読込は自動で再取得しない**（`refetchInterval` なし、焦点・再接続での再取得なし、`staleTime: 0`）。同じ条件で「検索」を押したときは `refetch` で読み直す。
- **axe はこの画面のブラウザ試験の中で `judge` を使って行い、`A11Y_SCREENS` には足さなかった。** 結果を表示した後と履歴の Dialog を開いた状態を見る必要があるため（試験の規約の「操作後の状態」）。画面 id は `evidence-search`、例外は無い。
- **ADR は書いていない。** kernel・DSL・port・migration・依存パッケージを変えていない（`pnpm db:schema` で差分なしを実測）。
- **round 4（B3）への接続点は HOOK のコメントで残した**（`modules/attachments/src/services/search.ts` の `INCOMPLETE_DOMAIN`）。

## やったこと

- `modules/attachments`: `actions/evidence-search.ts`（`attachment.evidence_search`）、`actions/history.ts`（`attachment.history`）、`services/evidence.ts`（公開 DTO の schema、`incomplete`、差替の木の関係・並べ替え・打切り・監査の記録の選び方）、`services/linked.ts`（リンク先の要約）、`services/search.ts`（`superseded` / `incomplete` と `INCOMPLETE_DOMAIN`。`attachment.search` は渡さない）、`module.ts` / `index.ts`
- `apps/web`: `pages/evidence-page.tsx`、`components/evidence-history-dialog.tsx`、`components/evidence-download.tsx`、`api/evidence.ts`、`lib/evidence-search.ts`、`lib/zip.ts`、`api/client.ts`（`download` に `AbortSignal`）、`router.tsx`（`/finance/evidence`）、`lib/navigation-data.ts`、`lib/help.ts`、`ui/token-usage.test.ts` の `CONVERTED`
- 試験: `modules/attachments/test/evidence.test.ts`（unit 13 件）、`modules/attachments/test/evidence-search.db.test.ts`（DB 16 件）、`apps/api/test/evidence-search.db.test.ts`（DB 4 件）、`apps/web/src/lib/evidence-search.test.ts`（Web unit 14 件）、`apps/web/src/lib/zip.test.ts`（Web unit 4 件）、`apps/web/e2e/evidence-search.spec.ts`（ブラウザ 2 件）。既存の `modules/attachments/test/attachments.db.test.ts` の AC-1 は module の action の一覧を完全一致で確かめているので、足した 2 action を期待値に加えた（試験を弱めたのではなく、manifest の変更に合わせた）。`apps/web/src/lib/help.test.ts` の画面一覧に `/finance/evidence` を足した。
- 文書: マニュアル 02 に「証憑の検索」節（同じ章の「差し替えは管理者が」の誤りも直した）、10 章（電帳法の扱いの範囲、可視性の既知の差、未登録の取引先）、09 章（2 action）、00 章・付録 N（画面の一覧）、`docs/architecture/permissions.md`（既知の差の注記）、`docs/architecture/program-map.md`、`docs/domain/japan-tax.md`（「メタデータ必須」の訂正、一問一答の版）、`docs/specs/attachments.md`（関連）、spec を implemented に

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] unit `modules/attachments`（2 ファイル 21 件、2.4 秒）: 検索条件の組立て（`superseded` 3 値と `incomplete`、既存条件との AND）、`attachment.search` の入力が変わっていないこと、入力の検査（実在しない日付・列挙・`limit` 1〜100・`offset`、開始 > 終了・区切り付きの金額・下限 > 上限）、公開 DTO に `storageKey` が無いこと、`incomplete` の判定（金額 0 は入力ありとみなす）、差替の木の関係（兄弟・古い版・新しい版）・並び・打切り（深い版で経路が残る）、監査の記録の選び方と欠落、リンク先の種類と表示名のマスク・`outputHidden`・明細の親 field のマスク。
- [実測] DB `modules/attachments/test/evidence-search.db.test.ts`（16 件、daifuku_test_e4ev、8.3 秒）: 単独の 3 条件、2 項目の 3 通りと 3 項目の AND（条件ごとに一致する集合が異なる合成データ）、片側の範囲・両端同値・境界・未入力の行が範囲に出ないこと、条件なしの全件・並び（取引年月日が空の行が先頭）・頁、`superseded` と `incomplete`、差替前 2 件の件数、同じ entity（partner）60 件のリンク先が全行 `readable: true`（既定の 50 件で切れない）、削除済み・他社・未登録 entity のリンク先が `readable: false`、v1→v2→v3 の木（両端から）と理由・日時・実行者、分岐（a→c、b→c、a0→a）の関係と並び、監査の差替記録が無い行の null、差替後の汎用更新 3 回の後も理由が取れること、51 段の深い版で 52 行の経路と `truncated`、最新版からの 50 行、他社の同一内容の証憑が出ず `total` にも入らないこと、他社の取引先 id で 0 件、他社の id の履歴が NotFound、`nobody` と店舗限定の Context が PermissionDenied、入力の検査（11 通り）。
- [実測] DB `apps/api/test/evidence-search.db.test.ts`（4 件、全 module と seed、14.7 秒）: 確定した仕入請求書とその明細に結び付けた証憑を admin / accounting / viewer で検索すると番号・確定の状態・開く先（明細は親の伝票）が出て、sales では同じ 2 行が結果に出て `linked` は `readable: false`・番号なし（AC-6 の現状を実測）。下書きの仕入請求書を削除すると `readable: false`。HTTP 403（`nobody`）・400（開始 > 終了、`limit` 500）・404（存在しない id の履歴）。`attachment.supersede` の後、viewer の履歴に古い版と理由が出て、その古い版を `GET /api/attachments/:id/download` で取得できる（200、サイズ一致）。`/meta` に 2 action が出る。
- [実測] 既存の `modules/attachments/test/attachments.db.test.ts`（10 件）が通る（AC-11。action 一覧の期待値の更新のみ）。`pnpm db:schema`: `pendingStatements: 0`、作業ツリーの差分なし（AC-11）。
- [実測] Web unit `evidence-search.test.ts`（14 件）と `zip.test.ts`（4 件）、触った既存の試験（`help.test.ts` 52 件、`ui/token-usage.test.ts`、`navigation*.test.ts`）: URL の解釈と直列化（金額は文字列のまま、手入力の大きな数値は不正扱い）、不正な URL の値の無視と報告、反転した範囲は両端を無視、欄ごとの理由と順序、条件の要約、リンクの行き先（伝票・明細・読めない・未登録）、選択の上限（51 件目を受け付けない）とサイズ上限、zip 内の名前（日付・`no-date`・`superseded_`・禁止文字・末尾の `.` と空白・予約名・255 バイトの切り詰めで拡張子と連番が残る・大文字小文字を区別しない連番）、部分失敗（403・409・通信失敗・サイズ不一致）で残りを続けること、401 と「中止」で何も残さないこと、query key に `financeIdentity()`、画面カタログの表示条件と `help.ts` の章・節。zip は CRC-32 の既知の値（`123456789` → `cbf43926` ほか）、DOS 日時の丸め、試験内の読取器でローカルヘッダ・中央ディレクトリ・終端レコード・UTF-8 フラグ・0x7075・CRC・サイズ・中身を確認。
- [実測] ブラウザ `apps/web/e2e/evidence-search.spec.ts`（slot 47、新しい fixture DB、`--project=chromium --no-deps`、2 件成功、25.6 秒）: 合成会社（`financeFixture`）に確定した仕入請求書と 6 件の証憑（うち v1→v2 の差替）を API で登録 → 画面検索から開く → 条件なしで 6 件 → 取引年月日の範囲 × 取引金額の範囲（`10,000`〜`20000`）× 取引先で 1 件、他の 3 件は出ない、URL に条件 → リンク先「仕入請求書 番号」を開いて番号を確認 → 戻るで入力と結果が復元 → 開始日 > 終了日で検索せず、`aria-invalid`・説明の関連付け・焦点 → 取引先 2 で 3 件、「差替済み」「差替前 1 件」→ 履歴の Dialog（2 版、関係の札、理由「金額の訂正」、削除されない旨）→ 閉じると「履歴」ボタンへ焦点 → 2 件を選んで zip を保存し、試験側で項目名（`2025-05-20_請求書_B社.pdf` など）・サイズ・UTF-8 フラグを確認 → 1 件のダウンロードを 409 に差し替えて、成功分だけの zip と失敗の一覧 → 390px で横はみ出しなし → axe（日英 × 1280 / 390px、Dialog を開いた状態を含む）で serious / critical なし → 英語表示 → 不正な値を含む URL の無視と表示。権限の無い利用者（役割 `settings`）は説明とホームへのリンク。
- [実測] 最終のコード（「条件をクリア」の修正の後）で `evidence-search.spec.ts` をもう一度実行し 2 件成功（slot 47、新しい fixture DB、25.2 秒）。
- [実測] 関係するブラウザ試験（slot 47、新しい fixture DB、`--project=industry --project=chromium`、38 件すべて成功、6.8 分、load average 9〜15）: `evidence-search`（2）、`close-guide`（4、同じ会計・資金の分野と画面検索）、`navigation`（5）、`navigation-assist`（12、画面カタログ・パレット・この画面の説明）、`phase1`（1、記録画面の添付欄。`download` に引数を足したため）、`foundation-ui`（1）、`ui-kit`（10）、依存の `industry-templates`（3）。
- [実測] 計測（検証手順 5、判断 8）: 使い捨て DB（`daifuku_test_e4ev_perf`、計測後に削除）に owner で 1 会社 1 万件の合成証憑（取引先 50、2024〜2025 年、金額 100〜1,000,000）を入れて `ANALYZE`、`daifuku_app` の接続で `app.tenant_id` を設定し（RLS の One-Time Filter が計画に出ることを確認）、`attachment.evidence_search` を accounting で 7 回ずつ実行して、Repository が出した SQL を postgres.js の debug で捕まえて `EXPLAIN (ANALYZE, BUFFERS)` した。action 全体の所要時間の中央値: 条件なし 9.2 ms（件数の `count(*)` は seq scan で 3.2 ms、行は `attachment_txn_date_idx` の逆順走査）、日付 × 金額 6.3 ms（`attachment_txn_date_idx` の bitmap）、日付 × 取引先 4.5 ms、金額 × 取引先 4.9 ms、3 項目 6.1 ms（いずれも `attachment_partner_id_idx`）。差替前の件数は `attachment_superseded_by_id_idx` の index only scan で 0.1 ms 未満。基準の 200 ms を大きく下回るので、索引の追加は不要と判断した（負荷の高い共有コンテナ、load average 7〜9 で計測）。
- [実測] 手動（検証手順 8）: `lib/zip.ts` と `zipEntryNames` で日本語名・同名・切り詰めを含む zip を作り、`python3 -m zipfile -l` / `-t` と Info-ZIP UnZip 6.00（`LC_ALL=C.UTF-8`）の `unzip -l` / `-t` / 展開で、名前が化けずに一覧・展開でき、CRC の検査も通ることを確認。ロケールが C のままだと UnZip は `#U8acb` のような表記にする（UnZip の表示の仕様。展開は UTF-8 ロケールで正しい）。
- [実測] `pnpm gate:light --base 4afa6d1`（daifuku_test_e4ev、1,034 秒＝17.2 分、load average 4〜16）: format・docs・assurance・typecheck・API/Web typecheck・lint・unit 全件（157 ファイル 1,585 件）・DB（選ばれた 43 / 133 ファイル、249 件。attachments の 2 suite と API の evidence-search を含む）・deploy（17 件）すべて成功。その前の 2 回は `GATE_BASE=4afa6d1` の環境変数で実行し、unit の `scripts/test/gate.test.ts` の AC-9（SIGTERM の 2 件）だけが 30 秒の待ちで失敗した。同じ試験を単独で、DB の URL だけを付けると成功し、`GATE_BASE` を付けると失敗することを確かめた（試験が起動する子の gate に親の `GATE_BASE` が引き継がれるためと判断。この変更では scripts を触っていない）。`pnpm gate:quick`（`GATE_BASE=4afa6d1`）は format・docs・assurance・eslint・boundaries・typecheck・API/Web typecheck・関係する unit 32 ファイルが成功（167 秒）。
- [レビュー] modules から drizzle / postgres / fastify / node:fs を import していない（`pnpm lint:boundaries` 成功）。金額は decimal 文字列で受け渡し、画面でも JS の数値に変換していない（範囲の比較は `compareDecimalStrings`）。UI 文言はすべて `{ ja, en }`。新しい画面は kit の部品と意味トークンだけで、`CONVERTED` の検査が通る。
- [未検証] Windows のエクスプローラ・macOS の Finder での zip の展開（この環境に無い。UTF-8 フラグと 0x7075 で備えた）。国税庁の一問一答の本文（`www.nta.go.jp` にこの環境から到達できない。検索結果の抜粋で令和８年７月版の公表を確認しただけ）。スマートフォン実機で 100 MB の zip を作れるか（未決事項 3）。`pnpm gate:full` は統合担当が実行する。

## 見つけた問題と修正（発見経路つき）

- 分岐の DB 試験で、差替先が既に差し替えられた行になる順序で書いていた（a0 → a を a → c の後に実行）— 発見: DB 試験の実測（StateError）、修正: 試験の順序を直した（製品の規則どおり）。
- 「条件をクリア」で、URL に条件が無い状態（下書きだけを編集した状態）では入力欄が空に戻らなかった — 発見: レビュー、修正: 下書きも同時に空にする。
- module の型 `EvidenceItem` の `linked` が開いた記録型の推論で `{}` になり、API の試験の型検査で失敗 — 発見: `typecheck:api`、修正: 足した項目を TypeScript の型で明示。
- 禁止文字の正規表現の制御文字が lint（`no-control-regex`）に掛かった — 発見: eslint、修正: コードポイントで判定。
- `GATE_BASE` の環境変数が `scripts/test/gate.test.ts` の AC-9 の子の gate に漏れて失敗する（試験の隔離の不足。製品の不具合ではない）— 発見: gate:light の実測と単独の再実行、対応: `--base` で渡した。試験側で子の環境から `GATE_BASE` を除くのは A4（gate）の担当範囲なので、統合担当に申し送る。

## 未実施（減らさない。完了したら「済」を付けて残す）

- Windows・macOS の標準機能での zip の展開確認
- 国税庁の一問一答（令和８年７月版）の本文の確認と、問番号・逐語の記録
- `pnpm gate:full`（統合担当）

## 判断待ち（利用者）

- **証憑の行の可視性をリンク先の記録の読取規則に従わせるか**（spec の未決事項 1。権限の文書に既知の差として記録済み）。E4 を完了と扱う前に確認が要る。
- 証憑のダウンロード（1 件・一括）を監査に記録するか（未決事項 2）、一括ダウンロードの上限（未決事項 3）、証憑の区分（未決事項 4）、取引先の自由記述欄（未決事項 7）。

## 次のセッションへ

- B3（導入チェック）の統合後、`INCOMPLETE_DOMAIN` の件数を `/meta/health` に足し、`/finance/evidence?incomplete=1` へ案内する（HOOK のコメントの位置）。
- 改善候補一覧に、可視性の既知の差・`storageKey` の `outputHidden` 化（未決事項 6）・取引先の自由記述欄を登録する（統合担当）。
