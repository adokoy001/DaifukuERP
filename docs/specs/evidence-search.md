# Spec: evidence-search（証憑の横断検索。電子帳簿保存法の検索要件）

- 状態: draft
- モジュール: `modules/attachments`（読取 action `attachment.evidence_search` / `attachment.history` を追加）、`apps/web`（`/finance/evidence`） ／ 依存: [attachments](attachments.md)（既存の entity・ダウンロード経路・差替）、partner、[ui-kit](ui-kit.md)（D1）、[list-workbench](list-workbench.md)（C1。URL への条件の保持・選択の決まり・CSV 出力）
- ADR: 不要（module の読取 action と Web 画面だけ。kernel・DSL・kernel port・migration・依存パッケージを変更しない）。従う判断は ADR-0007（権限）、ADR-0013（storage port）、ADR-0018（会社・拠点の境界、CSV の export 再検証）
- 作成: 2026-10-30 ／ 作成者: agent（spec 担当、ブランチ `wip/evidence-search`）。設計の元は [完成度向上の実装計画](../completion-plan.md) E4

## 目的（1段落）

電子取引で受け取った請求書・領収書などの証憑は、電子帳簿保存法により「取引年月日・取引金額・取引先」で、日付と金額は範囲を指定して、任意の 2 項目以上を組み合わせて検索できる状態で保存する必要がある（[日本の制度事実](../domain/japan-tax.md#evidence-search)）。今は証憑を記録画面の添付欄（記録ごと）か汎用一覧 `/e/attachment` で探すしかなく、検索結果から元の伝票や差替の経緯をたどれない。経理担当者と税務調査の対応者が、3 項目の AND で証憑を探し、リンク先の伝票と差替の履歴を確かめ、選んだ証憑をまとめてダウンロードできる専用画面を用意する。新しい書込経路・閲覧経路は作らず、既存の Repository と既存のダウンロード経路を呼び出し側の権限のまま使う。

## 確認した現状（2026-10-30、コードを読んで確認）

設計の前提にした事実。実装時に変わっていたら、この節と受入基準を直す。

1. entity `attachment`（[modules/attachments/src/entities/attachment.ts](../../modules/attachments/src/entities/attachment.ts)）は会社単位で、`txnDate`（date、索引あり）、`amount`（money、索引あり）、`partnerId`（ref partner）、`kind`、`linkedEntity` / `linkedId`、`supersededById`（serverOwned）、`storageKey`（`hidden`。`outputHidden` ではない）、`sha256`（会社内で一意）を持つ。索引は `(tenant_id, company_id, txn_date)`・`(…, amount)`・`(…, partner_id)`・`(…, superseded_by_id)`・`(…, linked_entity, linked_id)`（[migration 0001](../../apps/api/drizzle/migrations/0001_phase1_masters_ledger_attachments.sql)）。role 表は accounting / sales / purchasing が read・create・update、viewer が read、admin は全操作。delete は誰にも無く、admin の削除も `before_delete` フックが拒否する。export は admin だけが持つ。店舗・拠点の方針（`storeAccess` / `siteAccess`）は無いので、全社以外に限定された利用者（`accessScope` が `stores` / `sites`）は `can()` が偽になり読めない。
2. 検索 action `attachment.search`（[actions/search.ts](../../modules/attachments/src/actions/search.ts)、[services/search.ts](../../modules/attachments/src/services/search.ts) `buildSearchDomain`）が既にあり、取引年月日の範囲・取引金額の範囲・取引先・種別の AND を `Repository.list` で返す（最大 500 行、`txnDate` 降順 → `createdAt` 降順）。開始 > 終了、decimal でない金額は ValidationError。出力は attachment の JSON（`storageKey` を含む）。
3. **証憑の行の可視性はリンク先の記録の読取規則を継承していない。** 証憑の get / list / `attachment.search` / `GET /api/attachments/:id/download` は attachment の role 表と tenant・会社（RLS と Repository scope）だけで決まる。リンク先の可視性が効くのは、(a) リンクを書くとき（`attachment.link`、upload、汎用更新の `before_create` / `before_update` で `assertLinkTarget` がリンク先を書く人が読めることを確かめる）と、(b) 記録画面の添付欄 `attachment.for_record`（そのレコードを読めることを先に確かめる）の 2 か所だけ。例: sales は purchase_invoice を読めないが、purchase_invoice にリンクされた証憑の行（ファイル名・金額・取引先・`linkedEntity` / `linkedId`）は一覧・検索・ダウンロードで読める。[権限の文書](../architecture/permissions.md)の表の「audit/添付: 元行の可視性」は、監査と `for_record` には当たるが、証憑の一覧には当たらない。この spec は現状を変えずに保ち（AC-6）、変えるかどうかは未決事項に置く。
4. 差替（`attachment.supersede`、[actions/supersede.ts](../../modules/attachments/src/actions/supersede.ts)）は旧行の `supersededById` に新行を 1 度だけ書き、差替先は「差し替えられていない行」に限る（[services/validate.ts](../../modules/attachments/src/services/validate.ts) `assertSupersedable`）。したがって系列は循環せず、複数の旧行が同じ新行を指す分岐はありうる。理由は監査ログ（`op: 'supersede'`、`action: 'attachment.supersede'`、`after: { supersededById, reason }`）にだけ残り、kernel の `auditTrail(ctx, 'attachment', id)` が attachment の read と行の可視性を確かめてから返す。
5. ダウンロード経路（[apps/api/src/routes/attachments.ts](../../apps/api/src/routes/attachments.ts)）は `Repository.get` で権限と可視性を確かめ、保存キーが tenant の範囲にあることと、保存内容のサイズ・SHA-256 が記録と一致することを確かめてから送る（不一致は 409）。ダウンロードは監査に記録しない。
6. 関連記録（[document-links](document-links.md)、`kernel/src/related.ts`）は `linkedEntity` / `linkedId` を多相リンクとして扱う（レビュー済みの組）。伝票の関連記録パネルに証憑が、証憑の関連記録にリンク先と差替の参照が出る。ただし差替の理由は出ない。
7. Web は記録画面の添付欄（[components/attachments-panel.tsx](../../apps/web/src/components/attachments-panel.tsx)、[api/attachments.ts](../../apps/web/src/api/attachments.ts)）で 1 件ずつダウンロードする（`api/client.ts download` → `lib/download.ts saveBlob`）。zip を作る依存パッケージは無い。会計系の画面の query key は `api/finance.ts financeIdentity()`（tenant・利用者・会社）を含める。

## 受入基準（EARS）

### サーバー（`modules/attachments`）

- AC-1 WHEN `attachment.evidence_search { txnDateFrom?, txnDateTo?, amountFrom?, amountTo?, partnerId?, kind?, superseded?, incomplete?, limit?, offset? }` が attachment の read を持つ要求者から呼ばれた THE SYSTEM SHALL 指定された条件をすべて満たす（AND）証憑を返す。日付と金額は両端を含む範囲で、片側だけの指定と、両端を同じ値にした一致検索ができる。取引先は id の一致、種別は値の一致。条件を 1 つも指定しなければ全件をページ単位で返す。並びは `attachment.search` と同じ（`txnDate` 降順 → `createdAt` 降順。取引年月日が未入力の行は PostgreSQL の既定で先頭に来る）。`limit` は 1〜100（既定 50）、`offset` は 0 以上、出力は `{ items, total, limit, offset }`。action は読取専用（`mutates: false`、`tx: 'none'`、`permission: { entity: 'attachment', op: 'read' }`）で、REST（`POST /actions/attachment.evidence_search`）と MCP には既存の action 経路で出る（専用 route を作らない）。
- AC-2 THE SYSTEM SHALL 取引年月日・取引金額・取引先のうち任意の 2 項目（日付 × 金額、日付 × 取引先、金額 × 取引先）と 3 項目すべての組合せで、それぞれの条件を満たす行だけを返す（国税庁の「いずれの二の記録項目の組合せによっても条件を設定することができる」。[出典](../domain/japan-tax.md#evidence-search)）。
- AC-3 THE SYSTEM SHALL 各行を明示した公開 DTO で返す: 証憑の `id`、`filename`、`contentType`、`size`、`sha256`、`kind`、`txnDate`、`amount`（decimal 文字列）、`partnerId`、`note`、`linkedEntity`、`linkedId`、`supersededById`、`createdAt`、`version`（`storageKey` は含めない）と、`linked`（AC-5）、`supersedes`（この証憑を差替先とする証憑の件数）、`incomplete`（取引年月日・取引金額・取引先のいずれかが未入力なら true）。
- AC-4 THE SYSTEM SHALL `superseded` を `include`（既定。差し替えられた証憑を含む全件）、`exclude`（最新版のみ = `supersededById` が null）、`only`（差し替えられた証憑のみ）として解釈し、`incomplete: true` のときは取引年月日・取引金額・取引先のいずれかが未入力の行だけを返す（他の条件との AND）。`superseded` と `incomplete` は `attachment.search` にも任意の入力として足す（既存の入出力は変えない。条件の組立ては `buildSearchDomain` を共有する）。
- AC-5 THE SYSTEM SHALL 各行の `linked` を、リンク先 entity の読取を要求者の Context のまま行って作る: リンクが無ければ null、あれば `{ entity, id, kind: 'document' | 'entity' | 'line' | 'unknown', readable, title, number, docstatus }`。要求者がリンク先 entity を read でき（`can`）、その行が `Repository.list`（`where: { id: { $in } }`、結果ページのリンク先 entity ごとに 1 回）で見えるときだけ `readable: true` とし、表示名（entity の displayField。要求者にマスクされる field か `outputHidden` の field なら null）、document の番号と状態を入れる。read できない・行が見えない・削除済み・登録されていない entity のときは `readable: false` で `title` / `number` / `docstatus` を null にし、理由を区別しない（存在を漏らさない）。document の明細 entity へのリンクは `kind: 'line'`、registry に無い entity は `kind: 'unknown'` とする。
- AC-6 THE SYSTEM SHALL 証憑の行の可視性を、既存の `attachment.search`・`GET /api/attachment`・ダウンロード経路と同じにする: attachment の role 表の read（accounting / sales / purchasing / viewer / admin）、tenant・会社の境界（RLS と Repository scope）、店舗・拠点の境界（attachment に方針が無いため、全社以外に限定された利用者は読めない）。リンク先の記録の読取規則は証憑の行には加えず（「確認した現状」3）、AC-5 の要約にだけ効かせる。例: sales は purchase_invoice にリンクされた証憑を結果に得るが、その `linked` は `readable: false` で番号を含まない。
- AC-7 WHILE 要求者が会社 A を選んでいる THE SYSTEM SHALL 会社 B の証憑を、条件・取引先名・内容が同じでも返さず、`total` にも数えない。会社 B の取引先の id を `partnerId` に指定した検索は 0 件を返し、エラーで存在を区別しない。`attachment.history` に会社 B の証憑の id を渡すと NotFound を返す。
- AC-8 IF 要求者が attachment の read を持たない（例: `employee`。試験では役割 `nobody`）か、店舗・拠点に限定されている THEN THE SYSTEM SHALL `attachment.evidence_search` と `attachment.history` を PermissionDenied（HTTP 403）で拒否する。
- AC-9 IF 開始日が終了日より後、日付が `YYYY-MM-DD` でないか実在しない、金額が decimal でない、開始金額が終了金額より大きい、`kind` / `superseded` が列挙にない、`limit` が 1〜100 の外、`offset` が負のいずれか THEN THE SYSTEM SHALL ValidationError（HTTP 400）を返し、`details.issues[].path` に該当の入力名を入れる。
- AC-10 WHEN `attachment.history { id }` が attachment の read を持つ要求者から呼ばれた THE SYSTEM SHALL その証憑を含む差替の系列を返す: `supersededById` をたどった新しい版（最新版まで）と、`supersededById` が系列の行を指す古い版（分岐を含めて幅優先）。各行は AC-3 の証憑の項目と、関係（`self` / `newer` / `older`）と、差し替えられた行には監査ログの `attachment.supersede` の記録から得た理由・日時・実行者（`auditTrail` を要求者の Context で読む）を持つ。系列は最新版から古い版の順（同じ深さの分岐は登録日時の新しい順）で最大 50 行とし、超えたら `truncated: true` を返す。action は読取専用（`mutates: false`、`tx: 'none'`）。系列の行は削除されず、どの版も既存のダウンロード経路で取得できる。
- AC-11 THE SYSTEM SHALL 既存の attachment の列と索引だけを使い、migration・entity 定義・kernel・依存パッケージを変更しない（`pnpm db:schema` で差分が出ない）。`attachment.search` の既存の入出力と既存の試験はそのまま通る。

### 画面（`apps/web`、`/finance/evidence`）

- AC-12 THE SYSTEM SHALL `/finance/evidence` を「会計・資金」分野の専用画面「証憑の検索」（Evidence search）として画面検索・分野一覧・コマンドパレットに出し、`attachment.evidence_search` を実行できない利用者には出さない。URL を直接開いた権限の無い利用者には、権限が無いことの説明とホームへの導線を出す。現在位置の「この画面の説明」はマニュアル 02 の「証憑の検索」節を指す（`lib/help.ts`）。
- AC-13 WHEN 利用者が取引年月日の範囲、取引金額の範囲、取引先（参照検索）、種別、差替の表示（すべて / 最新版のみ / 差替済みのみ）、未入力のみ、を入力して「検索」を押した THE SYSTEM SHALL 条件を URL（`?from=&to=&amountFrom=&amountTo=&partnerId=&kind=&superseded=&incomplete=&page=`）に保持して `attachment.evidence_search` を呼び、再読込・戻る・共有した URL で同じ条件と頁を復元する。画面は「指定した条件をすべて満たす証憑」（AND）であることを、適用中の条件の要約と件数で示す。条件を変えたら先頭頁に戻る。条件なしで開いたら全件の先頭頁を出す。金額は decimal 文字列のまま送り、JS の数値に変換しない。
- AC-14 IF 入力欄の値が不正（開始日 > 終了日、実在しない日付、数値でない金額、開始金額 > 終了金額）THEN THE SYSTEM SHALL 検索を実行せず、欄ごとに理由を示し（`aria-invalid` と説明の関連付け）、最初の不正な欄へ焦点を移す。URL に入っていた不正な値は無視し、無視したことを表示する（C1 の `?f=` と同じ扱い）。
- AC-15 THE SYSTEM SHALL 結果を表で示す: 取引年月日、取引金額（会社通貨の桁）、取引先（要求者が読めれば名称、読めなければ id。汎用一覧と同じ）、種別、ファイル名（押すと既存のダウンロード経路で 1 件保存）、リンク先（`readable` なら entity の表示名と番号または表示名・状態の札、`/e/<entity>/<id>` へのリンク。`readable: false` なら「参照できない記録」、`line` / `unknown` はリンクなし）、差替（差し替えられた行は「差替済み」の札と最新版への移動、差替前がある行は「差替前 n 件」）、「履歴」ボタン、証憑の記録へのリンク（`/e/attachment/<id>`）。取引年月日・取引金額・取引先のいずれかが未入力の行には文字で「未入力」の札を付ける（色だけで区別しない）。1 頁 50 件で件数と頁送りを出し、0 件なら条件の見直しを促す空状態を出す。検索の読込失敗は前回の結果を残さず、エラーの詳細（`components/error-details.tsx`）と再試行を出す。
- AC-16 WHEN 利用者が「履歴」を押した THE SYSTEM SHALL kit の `Dialog` に `attachment.history` の系列を新しい順で示す（各版のファイル名・取引年月日・取引金額・登録日時・ダウンロード、差し替えられた版には差替の理由・日時・実行者）。差し替えられた版も削除されずに取得できることを文で示し、`truncated` なら続きがあることを示す。閉じたら焦点を「履歴」ボタンへ戻す。
- AC-17 WHEN 利用者が結果から証憑を選び「選択した証憑を zip でダウンロード」を押した THE SYSTEM SHALL 選んだ各証憑を既存の `GET /api/attachments/:id/download`（要求者の権限と保存内容の照合を 1 件ずつ通る）で 1 件ずつ順に取得し、ブラウザ内で zip（無圧縮の STORE 方式、UTF-8 のファイル名フラグ付き）を作って `evidence_<UTC の YYYYMMDDHHMMSS>.zip` として保存する。zip 内の名前は `<取引年月日 または no-date>_<元のファイル名>`（差し替えられた証憑は先頭に `superseded_`）とし、OS で使えない文字（`/ \ : * ? " < > |` と制御文字）は `_` に置き換え、同じ名前は拡張子の前に ` (2)`、` (3)` を付けて区別する。取得中は進捗（n / N 件）を polite なライブ領域で知らせ、二重実行を防ぎ、「中止」で取得をやめて何も保存しない。
- AC-18 THE SYSTEM SHALL 1 回の zip を 50 件以内、かつ選んだ証憑の記録上の `size` の合計 100 MB（104,857,600 バイト）以内に限る。選択がどちらかを超えたらダウンロードを無効にし、選択の件数・合計サイズと上限を表示する。選択は同じ条件の間は頁をまたいで保持し、条件を変えたら空にする。
- AC-19 IF 一部の証憑の取得に失敗した（403 / 404、保存内容の不一致の 409、通信の失敗、受信サイズが記録の `size` と異なる）THEN THE SYSTEM SHALL 残りの取得を続け、成功した分だけで zip を保存し、失敗したファイル名と理由を一覧で示す。すべて失敗したら zip を保存せず、その旨を示す。
- AC-20 WHEN 利用者が会社を切り替えた、または別の利用者でログインした THE SYSTEM SHALL 前の会社・利用者の結果・選択・履歴を表示に残さない（検索と履歴の query key に `financeIdentity()` を含め、選択は条件と同じ境界で空にする）。
- AC-21 THE SYSTEM SHALL 画面の文言を日本語と英語（`{ ja, en }`）で持ち、390px 幅でページ全体に横スクロールを出さずに検索・選択・ダウンロード・履歴を操作でき（結果の表はその枠の中で横に動いてよい）、結果を表示した状態で axe の serious / critical 違反を出さない（日英 × 1280 / 390px。判定は `apps/web/e2e/a11y-policy.ts` の `judge`）。

## 関係するファイル・インターフェース（名指し）

- `modules/attachments/src/actions/evidence-search.ts`（新規: `attachment.evidence_search`、入出力 schema）、`actions/history.ts`（新規: `attachment.history`）、`services/search.ts`（`SearchCriteria` に `superseded` / `incomplete`、`buildSearchDomain` の拡張）、`services/evidence.ts`（新規: 公開 DTO、`incomplete` 判定、系列の並べ替えと打切りの純粋関数）、`services/linked.ts`（新規: リンク先の要約。kernel の公開 API `registry`・`repo`・`can`・`maskedFields` と `EntityDef` の field 定義だけを使う。`kernel/src/related.ts` の非公開関数は使わない）、`actions/search.ts`（新しい任意入力の受付）、`module.ts`（2 action の登録）、`index.ts`（公開）
- 使う kernel の公開 API: `defineAction`、`repo`（`Repository.list` / `get`）、`registry`（`hasEntity`、`entity`、`allEntities` で明細 entity を判定）、`can`、`maskedFields`、`auditTrail`、`isLocalDate`、`Decimal`、`ValidationError`。kernel の変更は不要。必要になったら ADR を起こす（次の番号は 0030。統合時に調整）
- API: 変更なし（`POST /actions/:name` と `GET /api/attachments/:id/download` を使う）
- Web: `apps/web/src/pages/evidence-page.tsx`（新規）、`apps/web/src/api/evidence.ts`（新規: 検索・履歴の hooks、query key は `['finance', financeIdentity(), 'evidence', …]`）、`apps/web/src/lib/evidence-search.ts`（新規: URL の解釈と直列化、入力の検査、条件の要約、選択の上限、zip 内の名前、失敗の集計。純粋関数）、`apps/web/src/lib/zip.ts`（新規: CRC-32 と STORE 方式の zip。最終の `Blob` は取得した各ファイルの `Blob` と小さなヘッダの配列から組み、全体を 1 つのバッファに複製しない）、`apps/web/src/components/evidence-history-dialog.tsx`・`evidence-download.tsx`（新規）、`apps/web/src/api/client.ts`（`download` に任意の `AbortSignal` を足す）、`apps/web/src/api/types.ts`（DTO の型）、`apps/web/src/router.tsx`（`/finance/evidence`、`validateSearch`）、`apps/web/src/lib/navigation-data.ts`（`workspace: 'finance'`、`module: 'attachment'`、`action: 'attachment.evidence_search'`）、`apps/web/src/lib/help.ts`（`/finance/evidence` → `02-basics.md` の「証憑の検索」）、`apps/web/src/ui/token-usage.test.ts`（`CONVERTED` に追加）。参照検索は既存の `components/fields/ref-field.tsx`、取引先名は既存の `api/queries.ts useRefLabelMaps`
- 試験: `modules/attachments/test/evidence.test.ts`（unit）、`modules/attachments/test/evidence-search.db.test.ts`（DB）、`apps/api/test/evidence-search.db.test.ts`（DB、全 module を登録した API 経由）、`apps/web/src/lib/evidence-search.test.ts`・`apps/web/src/lib/zip.test.ts`（Web unit）、`apps/web/e2e/evidence-search.spec.ts`（ブラウザ）
- 文書: `docs/manual/02-basics.md`（「添付（証憑）」の次に「証憑の検索」節）、`docs/manual/10-limitations.md`（電帳法の扱いの限界）、`docs/manual/09-ai.md`（2 action）、画面の一覧（`docs/manual/00-index.md`、`docs/manual/appendix-n-navigation.md`、`docs/architecture/program-map.md`）、`docs/architecture/permissions.md`（「audit/添付」の行を「確認した現状」3 のとおりに書き直す）、`docs/specs/attachments.md`（関連としてこの spec を挙げる）

## データ・業務ルール（出典）

- 電子取引データの検索要件（取引年月日その他の日付・取引金額・取引先、日付と金額の範囲指定、任意の 2 項目以上の組合せ）、ダウンロードの求めによる緩和、検索機能が不要となる場合（基準期間の売上高 5,000 万円以下、出力書面。2023-12-31 までは 1,000 万円）、猶予措置、適用対象 — [japan-tax.md#evidence-search](../domain/japan-tax.md#evidence-search)（国税庁 電子帳簿保存法一問一答【電子取引関係】令和６年６月 https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/pdf/0024005-113_r603.pdf ほか）。**確認の状態: 2026-10-30 はこの環境から国税庁・e-Gov に到達できず、検索結果の抜粋と 2026-09-10 の研究資料での照合にとどまる（本文・条文の逐語は未確認）。** AC-2 の「任意の 2 項目」の読み方と、原則要件を常に満たす方針（下の判断 6）はこの未確認の事実に依存する。実装時に本文を確認できたら domain の確認日を更新し、できなければ log に未確認と書く。
- 訂正削除履歴（差し替えた証憑を消さず、理由を残す）— 既存の [attachments](attachments.md) AC-5、[japan-tax.md#電子帳簿保存法](../domain/japan-tax.md#電子帳簿保存法)。
- 新しい制度値（税率・閾値など）は扱わない。5,000 万円・1,000 万円の基準はシステムの判定に使わないので、期間付きデータにもしない（判断 6）。
- 金額は decimal 文字列で受け渡し、比較は DB の numeric（ADR-0010）。画面は `lib/decimal.ts` と `lib/format.ts` の規則で表示する。

## 判断（計画が選択を残した点と、その理由）

1. **新しい読取 action を 2 つ足し、`attachment.search` の出力は変えない。** `attachment.search` は MCP・REST の利用者がいる契約で、出力は attachment の JSON（`storageKey` を含む）。リンク先の要約と差替の件数を足すと契約が変わるため、`attachment.evidence_search`（公開 DTO、最大 100 行）を別に置き、条件の組立て（`buildSearchDomain`）だけを共有する。差替の理由は監査ログにしか無いので、系列は必要なときに `attachment.history` で読む（結果の各行で監査を読まない）。
2. **証憑の行の可視性は現状どおり（リンク先の読取規則を継承しない）。** 計画の「添付はリンク先の読取規則を継承する」は、リンクの書込時と記録画面の添付欄には当たるが、一覧・検索・ダウンロードには当たらない（「確認した現状」3）。E4 で狭めると `/e/attachment` と結果が食い違い、行の規則を多相リンクで評価する kernel の変更（ADR が要る）になる。広げも狭めもせず、リンク先の要約（番号・表示名・状態）だけをリンク先の権限で出す（AC-5、AC-6）。変えるかは未決事項 1。
3. **一括ダウンロードはブラウザで zip を作る。サーバーの zip 生成 route は作らない。** 理由: (a) 各ファイルが既存のダウンロード経路を 1 件ずつ通るので、権限・tenant の保存範囲・サイズと SHA-256 の照合がそのまま効き、新しいバイトの読取経路をレビューしなくてよい（計画の原則 1）。(b) サーバーで zip を作るには依存パッケージか手書きの zip が `apps/api` に要り、大きな応答を 1 要求で流す間の失敗処理が増える。(c) 証憑の多くは PDF・JPEG・PNG で既に圧縮されているため、無圧縮の STORE 方式で十分。STORE の zip は CRC-32 とヘッダの組立てだけなので、依存パッケージを足さずに `lib/zip.ts`（百数十行）で書く。欠点は要求数（最大 50）とブラウザのメモリで、上限（判断 4）で抑える。
4. **上限は 50 件かつ合計 100 MB。** 1 ファイルの上限は 20 MB（attachments AC-2）。最終の `Blob` は取得した `Blob` を参照して組むので、ピークのメモリはおおむね選んだファイルの合計（＋CRC 計算中の 1 ファイル分）。100 MB はデスクトップで問題なく、スマートフォンでも多くの端末で扱える大きさとして選んだ。件数 50 は 1 件ずつ順に取得する時間（1 件 0.2〜1 秒で 10〜50 秒）を待てる範囲とした。実測で変える（未決事項 3）。
5. **zip にはファイルだけを入れ、索引の CSV は入れない。** 証憑の一覧を CSV にするのは台帳データの出力で、ADR-0018 により attachment（と取引先名を出すなら partner）の `export` 権限の再検証が要る。export は admin しか持たないため、accounting の zip に索引を入れると権限を迂回する。索引が必要な利用者（税務職員のダウンロードの求めへの対応を含む）は、`/e/attachment` の絞り込み（取引年月日・取引金額・取引先）と CSV 出力（C1、export 権限、監査付き）を使う。zip 内の名前に取引年月日を入れるのは、画面に表示している値で並べ替えやすくするためで、台帳の出力ではない。
6. **会社の規模で検索要件を切り替えない。** 免除の条件（基準期間の売上高、出力書面）は会社の申告の事情でシステムからは判定できず、原則要件を満たす検索を常に出しても害がない。閾値をコードにもデータにも持たないので、期間付きデータの規則（CLAUDE.md 規約 10）の対象にならない。
7. **差替の表示は既定で「すべて」。** 差し替えられた証憑も保存対象のデータで、検索で見つけられる必要がある（訂正削除履歴）。日常の確認向けに「最新版のみ」を選べる。
8. **migration と kernel を変えない。** 3 条件は列ごとの B-tree 索引（会社で先頭を揃えたもの）で PostgreSQL が組み合わせられる見込みで、複合索引は足さない。検証手順 5 で 1 万件の合成データの実行計画と時間を測り、遅ければ別項目にする。並びの NULLS LAST も kernel の変更になるため、取引年月日の無い行が先頭に来る既定のままにする（未入力の証憑が目に付く効果もある）。
9. **ADR は作らない。** module の読取 action と Web 画面だけで、DSL・kernel port・依存・境界の規則を変えないため。実装で kernel の変更が要ると分かったら、ADR-0030（統合時に番号を調整）を起こしてこの spec を直す。
10. **round 4（B2・B3・D3・A4）に依存しない。** B3 の導入チェック（`/meta/health`）に「検索の 3 項目が未入力の証憑の件数」を足すのは、B3 の統合後の候補として未決事項 5 に置く。

## スコープ外（明記）

- タイムスタンプ、OCR による項目の自動入力、JIIMA 認証、スキャナ保存に固有の要件（解像度・入力期間など）、出力書面（紙）の自動作成、会社の規模による要件の判定
- 証憑（`attachment`）以外の電子取引データ（銀行明細、POS の受信データ、構造化された請求データ）と、従業員の領収書（`workforce_receipt`。本人限定の別 entity。[計画](../completion-plan.md) E5）
- 画面からのアップロード・差替・項目の編集（記録画面の添付欄、証憑の記録画面 `/e/attachment/:id`、`attachment.supersede` の action 画面を使う）
- zip 内の索引 CSV とサーバー側の zip 生成（判断 3、5）、ダウンロードの監査記録（未決事項 2）
- 証憑の行の可視性をリンク先の読取規則に従わせる変更（未決事項 1）
- ファイル名・備考の全文検索（既存の `/e/attachment` の検索欄）、並び順の変更、検索条件の保存（C1 の保存ビューは `/e/attachment` で使える）
- 複合索引の追加（判断 8）

## 検証手順（E2E、実行して記録する）

受入基準と試験の段階の対応（試験名に `AC-n` を入れる）:

| AC           | unit                          | DB                                                         | ブラウザ                                       |
| ------------ | ----------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| AC-1, AC-2   |                               | module                                                     | 3 条件で絞る                                   |
| AC-3, AC-4   | module                        | module                                                     |                                                |
| AC-5         | module                        | API                                                        | リンク先の伝票を開く                           |
| AC-6         |                               | API                                                        |                                                |
| AC-7         |                               | module                                                     |                                                |
| AC-8         |                               | module、API（403）                                         | 権限の無い利用者の説明                         |
| AC-9         | module                        | module、API（400）                                         |                                                |
| AC-10        | module                        | module、API（古い版の取得）                                | 履歴の Dialog                                  |
| AC-11        |                               | 既存の attachments の DB 試験、`pnpm db:schema` の差分なし |                                                |
| AC-12〜AC-15 | Web                           |                                                            | 開く・検索・URL の復元・不正な範囲・結果の表示 |
| AC-16        |                               |                                                            | 履歴の Dialog と焦点                           |
| AC-17, AC-19 | Web（zip と名前、失敗の集計） |                                                            | zip の保存、部分失敗                           |
| AC-18, AC-20 | Web                           |                                                            |                                                |
| AC-21        |                               |                                                            | 日英、390px、axe                               |

1. 編集中は `pnpm gate:quick`、コミット前に `TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` を設定して `pnpm gate:light`
2. unit（`modules/attachments/test/evidence.test.ts`）: `buildSearchDomain` の `superseded` / `incomplete` と既存条件の組合せ、範囲と入力の検査（AC-4、AC-9）。公開 DTO に `storageKey` が無いことと `incomplete` の判定（AC-3）。系列の並べ替え・関係・50 行の打切り（AC-10）。リンク先の要約の組立て（マスク・`outputHidden`・明細・未登録で `title` が null、AC-5）
3. DB（`modules/attachments/test/evidence-search.db.test.ts`）: 各条件の単独、任意の 2 項目の 3 通りと 3 項目すべての AND を、条件ごとに一致する集合が異なる合成データで確かめる（AC-1、AC-2）。片側の範囲・両端同値・境界値・未入力の行が範囲検索に出ないこと（AC-1）。`superseded` の 3 値と `incomplete`（AC-4）。v1 → v2 → v3 と分岐（a → c、b → c）の系列、理由・日時・実行者、差し替えられた版のファイルが storage から読めること（AC-10）。会社 B の同一内容・同一条件の証憑が出ず `total` にも入らないこと、会社 B の取引先 id で 0 件、会社 B の id の履歴が NotFound（AC-7）。`nobody` と店舗に限定された Context が PermissionDenied（AC-8）。入力の検査（AC-9）。既存の `attachment.search` の試験がそのまま通ること（AC-11）
4. DB（`apps/api/test/evidence-search.db.test.ts`）: HTTP 経由で 200 / 400 / 403。purchase_invoice にリンクした証憑を accounting と sales で検索し、両方に行が出て、sales の `linked` は `readable: false` で番号が無いこと（AC-5、AC-6）。リンク先の下書き document を admin が削除した後、その証憑の `linked` が `readable: false` になること（その document が削除できなければ、削除できる entity で確かめて理由を log に書く）。履歴に出た古い版を `GET /api/attachments/:id/download` で取得できること（AC-10）
5. 計測（log に記録）: owner 接続の使い捨て DB に 1 会社 1 万件の合成証憑を入れ、3 条件の検索の `EXPLAIN (ANALYZE, BUFFERS)` と所要時間を残す（判断 8）。`pnpm db:schema` を実行して差分が無いことを確かめる（AC-11）
6. Web unit（`apps/web/src/lib/evidence-search.test.ts`、`apps/web/src/lib/zip.test.ts`）: URL の解釈と直列化・不正な値の無視・頁のリセット・金額を文字列のまま扱うこと（AC-13、AC-14）、条件の要約、リンクの行き先（`readable` / `line` / `unknown`）、未入力の札（AC-15）、上限の判定と表示（AC-18）、zip 内の名前（日付・`superseded_`・禁止文字・同名の連番）と失敗の集計（AC-17、AC-19）、query key に `financeIdentity()` が入ること（AC-20）、画面カタログの表示条件と `help.ts` の対応（AC-12）。zip は CRC-32 の既知の値、試験内の最小の読取器でローカルヘッダ・中央ディレクトリ・終端レコード・UTF-8 フラグ・CRC・サイズを確かめる（AC-17）
7. ブラウザ（`apps/web/e2e/evidence-search.spec.ts`、`e2e-run.sh <worktree> <slot> apps/web/e2e/evidence-search.spec.ts --project=chromium --no-deps`）: 合成会社に取引先 2 件、確定した仕入請求書 1 件、条件の異なる証憑を API で登録し、画面検索から開く → 取引年月日の範囲・取引金額の範囲・取引先の 3 条件で 1 件に絞る → リンク先の伝票を開いて番号を確かめる → 戻るで条件が復元される。差替（v1 → v2）の履歴の Dialog と理由、焦点の戻り。2 件を選んで zip をダウンロードし、試験側で zip の項目名と中身の長さを確かめる。1 件のダウンロードを 409 に差し替えて部分失敗の表示と、成功分だけの zip。不正な範囲で検索しないこと。英語表示、390px で横スクロールが無いこと、axe（日英 × 1280 / 390px）。権限の無い利用者の説明（AC-12〜AC-21）
8. 手動（log に記録）: 保存した zip を OS の展開機能か `python3 -m zipfile -l` で開き、日本語のファイル名が化けないことを確かめる
9. マニュアル: `docs/manual/02-basics.md` に「証憑の検索」節（検索の 3 項目と AND、差替の表示と履歴、一括ダウンロードの上限と部分失敗、索引が必要なときは `/e/attachment` の CSV、電帳法への適合は第三者の確認を受けていないこと）。画面の一覧 3 文書と `help.ts` の対応
10. `docs/domain/japan-tax.md#evidence-search` の本文確認（国税庁に到達できる環境で。できなければ log に未確認と書く）
11. `pnpm gate:full`（統合担当が実行）

## 未決事項（利用者の判断待ち。括弧内は推奨の既定）

1. 証憑の行の可視性をリンク先の記録の読取規則に従わせるか（**E4 では変えない**）。今は attachment を読めるロール（例: sales）が、自分では読めない記録（例: 仕入請求書）にリンクされた証憑のファイル名・金額・取引先を読める。リンク先の業務の権限を持たない利用者に見せたくない証憑（人事・給与に関わるものなど）がリンクされうるかは、実装時に role 表で確かめて log に書く。従わせるには、多相リンクを行の規則として評価する kernel の拡張と ADR が要る。F3（権限マトリクスの横断表示）と合わせて検討する。
2. 証憑のダウンロード（1 件・一括）を監査に記録するか（**記録しない**。既存の 1 件のダウンロードも記録していないため、揃えて F3 で扱う）。
3. 一括ダウンロードの上限（**50 件・100 MB**）。スマートフォンで不足や失敗が出たら、端末幅で上限を下げるか、分割して保存する案内を足す。
4. 証憑に「電子取引 / スキャナ保存 / 紙」の区分を持たせるか（**E4 では持たない**）。スキャナ保存は別の要件を持つため、扱うなら別項目。
5. B3 の導入チェックに「検索の 3 項目が未入力の証憑の件数」を足すか（**B3 統合後に足す候補**。この画面の「未入力のみ」で同じ対象を開ける）。
6. 既存の attachment の JSON（upload の応答、REST、`attachment.search`）に `storageKey` が含まれる。`outputHidden` にするか（**E4 の範囲外。改善候補として別に扱う**。既存の試験が出力を前提にしているため、変えるなら試験の意図を確かめて直す）。
