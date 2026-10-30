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
3. **証憑の行の可視性はリンク先の記録の読取規則を継承していない。** 証憑の get / list / `attachment.search` / `GET /api/attachments/:id/download` は attachment の role 表と tenant・会社（RLS と Repository scope）だけで決まる。リンク先の可視性が効くのは、(a) リンクを書くとき（`attachment.link`、upload、汎用更新の `before_create` / `before_update` で `assertLinkTarget` がリンク先を書く人が読めることを確かめる）と、(b) 記録画面の添付欄 `attachment.for_record`（そのレコードを読めることを先に確かめる）の 2 か所だけ。例: sales は purchase_invoice を読めないが、purchase_invoice にリンクされた証憑の行（ファイル名・金額・取引先・`linkedEntity` / `linkedId`）は一覧・検索・ダウンロードで読める（viewer は purchase_invoice を読めるので当たらない。payment の `direction: 'pay'` を sales に見せない行の規則も証憑の行には効かない）。[権限の文書](../architecture/permissions.md)の表の「audit/添付: 元行の可視性」は、監査と `for_record` には当たるが、証憑の一覧には当たらない。**これは文書に書かれた規則とコードの差で、意図した設計として書き換えない。** この spec は現状を変えずに保つ（AC-6）が、それは利用者の確認を待つ判断であり（未決事項 1）、権限の文書には「既知の差（未達）」として記録する。E4 の横断検索と一括ダウンロードはこの差を使いやすくするため、マニュアルの新しい節と制限事項にも書く。
4. Repository の `list` は `limit` を省くと 50 行、最大 500 行（`kernel/src/repository/query.ts` の `DEFAULT_LIMIT` / `MAX_LIMIT`）。`$in` の参照で `limit` を省くと 51 件目以降が黙って欠ける。`aggregate` は `groupBy` と `count` で件数を数えられる（同じ可視性）。
5. 差替の検査（`assertSupersedable`）は a → c と b → c の両方を許すので、系列は最新版を根とする木になる（循環はしない）。差し替えられた行も汎用更新（備考など）はできるので、監査ログの件数は増えうる。`auditTrail` の既定の `limit` は 100（最大 500）。差替の監査が無い行（移行データなど）もありうる。
6. 差替（`attachment.supersede`、[actions/supersede.ts](../../modules/attachments/src/actions/supersede.ts)）は旧行の `supersededById` に新行を 1 度だけ書き、差替先は「差し替えられていない行」に限る（[services/validate.ts](../../modules/attachments/src/services/validate.ts) `assertSupersedable`）。したがって系列は循環せず、複数の旧行が同じ新行を指す分岐はありうる。理由は監査ログ（`op: 'supersede'`、`action: 'attachment.supersede'`、`after: { supersededById, reason }`）にだけ残り、kernel の `auditTrail(ctx, 'attachment', id)` が attachment の read と行の可視性を確かめてから返す。
7. ダウンロード経路（[apps/api/src/routes/attachments.ts](../../apps/api/src/routes/attachments.ts)）は `Repository.get` で権限と可視性を確かめ、保存キーが tenant の範囲にあることと、保存内容のサイズ・SHA-256 が記録と一致することを確かめてから送る（不一致は 409）。ダウンロードは監査に記録しない。
8. 関連記録（[document-links](document-links.md)、`kernel/src/related.ts`）は `linkedEntity` / `linkedId` を多相リンクとして扱う（レビュー済みの組）。伝票の関連記録パネルに証憑が、証憑の関連記録にリンク先と差替の参照が出る。ただし差替の理由は出ない。
9. Web は記録画面の添付欄（[components/attachments-panel.tsx](../../apps/web/src/components/attachments-panel.tsx)、[api/attachments.ts](../../apps/web/src/api/attachments.ts)）で 1 件ずつダウンロードする（`api/client.ts download` → `lib/download.ts saveBlob`）。zip を作る依存パッケージは無い。会計系の画面の query key は `api/finance.ts financeIdentity()`（tenant・利用者・会社）を含める。

## 受入基準（EARS）

### サーバー（`modules/attachments`）

- AC-1 WHEN `attachment.evidence_search { txnDateFrom?, txnDateTo?, amountFrom?, amountTo?, partnerId?, kind?, superseded?, incomplete?, limit?, offset? }` が attachment の read を持つ要求者から呼ばれた THE SYSTEM SHALL 指定された条件をすべて満たす（AND）証憑を返す。日付と金額は両端を含む範囲で、片側だけの指定と、両端を同じ値にした一致検索ができる。取引先は id の一致、種別は値の一致。条件を 1 つも指定しなければ全件をページ単位で返す。並びは `attachment.search` と同じ（`txnDate` 降順 → `createdAt` 降順。取引年月日が未入力の行は PostgreSQL の既定で先頭に来る）。`limit` は 1〜100（既定 50）、`offset` は 0 以上、出力は `{ items, total, limit, offset }`。`incomplete` は真偽値で、`true` のときだけ絞り込み、`false` または省略は絞り込まない（AC-4）。action は読取専用（`mutates: false`、`tx: 'none'`、`permission: { entity: 'attachment', op: 'read' }`）で、REST（`POST /actions/attachment.evidence_search`）と MCP には既存の action 経路で出る（専用 route を作らない）。
- AC-2 THE SYSTEM SHALL 取引年月日・取引金額・取引先のうち任意の 2 項目（日付 × 金額、日付 × 取引先、金額 × 取引先）と 3 項目すべての組合せで、それぞれの条件を満たす行だけを返す（国税庁の「いずれの二の記録項目の組合せによっても条件を設定することができる」。[出典](../domain/japan-tax.md#evidence-search)）。
- AC-3 THE SYSTEM SHALL 各行を entity の schema から導いた公開 DTO で返す: `Attachment.schemas.json.omit({ storageKey: true }).extend({ linked, supersedes, incomplete })`（attachment に項目が増えたら DTO にも意図して流れる。`storageKey` は含めない。`amount` は decimal 文字列）。`linked` は AC-5、`supersedes` はこの証憑を差替先とする証憑の件数（結果ページの id について `Repository.aggregate({ where: { supersededById: { $in: pageIds } }, groupBy: ['supersededById'], metrics: { n: { count: true } } })` で 1 回に数える）、`incomplete` は取引年月日・取引金額・取引先のいずれかが未入力なら true。
- AC-4 THE SYSTEM SHALL `superseded` を `include`（既定。差し替えられた証憑を含む全件）、`exclude`（最新版のみ = `supersededById` が null）、`only`（差し替えられた証憑のみ）として解釈し、`incomplete: true` のときは取引年月日・取引金額・取引先のいずれかが未入力の行だけを返す（他の条件との AND。`false` と省略は絞り込まない）。条件の組立ては `buildSearchDomain` を共有し、`attachment.search` の入力・出力・action の説明は変えない（新しい条件は `attachment.evidence_search` だけが受け付ける）。
- AC-5 THE SYSTEM SHALL 各行の `linked` を、リンク先 entity の読取を要求者の Context のまま行って作る: リンクが無ければ null、あれば `{ entity, id, kind: 'document' | 'entity' | 'line' | 'unknown', readable, target, title, number, docstatus }`。`entity` / `id` は保存されたリンクそのもの、`target`（`{ entity, id }`）は画面で開く記録。要求者がリンク先 entity を read でき（`can`）、その行が `Repository.list`（`where: { id: { $in } }`、`limit: ids.length`（最大 100）、結果ページのリンク先 entity ごとに 1 回）で見えるときだけ `readable: true` とし、`target` と表示名（entity の displayField。要求者にマスクされる field か `outputHidden` の field なら null）、document の番号と状態を入れる。read できない・行が見えない・削除済み・登録されていない entity のときは `readable: false` で `target` / `title` / `number` / `docstatus` を null にし、理由を区別しない（存在を漏らさない）。document の明細 entity（registry の `doc.lines`）へのリンクは `kind: 'line'` とし、明細の行を同じ方法で読み、その親 field（`parentField`。要求者がマスクされていれば読めない扱い）から親の伝票を同じ方法で読んで、`target` と番号・状態・表示名を親の伝票のものにする（C2 の関連記録が明細へのリンクを伝票として扱うのと同じ）。明細・親のどちらかが読めなければ `readable: false`。registry に無い entity は `kind: 'unknown'`。
- AC-6 THE SYSTEM SHALL 証憑の行の可視性を、既存の `attachment.search`・`GET /api/attachment`・ダウンロード経路と同じにする: attachment の role 表の read（accounting / sales / purchasing / viewer / admin）、tenant・会社の境界（RLS と Repository scope）、店舗・拠点の境界（attachment に方針が無いため、全社以外に限定された利用者は読めない）。リンク先の記録の読取規則は証憑の行には加えず（「確認した現状」3）、AC-5 の要約にだけ効かせる。例: sales は purchase_invoice にリンクされた証憑を結果に得るが、その `linked` は `readable: false` で番号を含まない。**この基準は利用者の確認を待つ判断（未決事項 1）で、権限の文書の規則「audit/添付: 元行の可視性」を満たしていない既知の差として記録する。** 確認の結果、差を閉じることになったら、多相リンクを行の規則として評価する kernel の拡張と ADR（次の番号）を別の spec で起こし、この AC を書き換える。
- AC-7 WHILE 要求者が会社 A を選んでいる THE SYSTEM SHALL 会社 B の証憑を、条件・取引先名・内容が同じでも返さず、`total` にも数えない。会社 B の取引先の id を `partnerId` に指定した検索は 0 件を返し、エラーで存在を区別しない。`attachment.history` に会社 B の証憑の id を渡すと NotFound を返す。
- AC-8 IF 要求者が attachment の read を持たない（例: `employee`。試験では役割 `nobody`）か、店舗・拠点に限定されている THEN THE SYSTEM SHALL `attachment.evidence_search` と `attachment.history` を PermissionDenied（HTTP 403）で拒否する。
- AC-9 IF 開始日が終了日より後、日付が `YYYY-MM-DD` でないか実在しない、金額が decimal でない、開始金額が終了金額より大きい、`kind` / `superseded` が列挙にない、`limit` が 1〜100 の外、`offset` が負のいずれか THEN THE SYSTEM SHALL ValidationError（HTTP 400）を返し、`details.issues[].path` に該当の入力名を入れる。
- AC-10 WHEN `attachment.history { id }` が attachment の read を持つ要求者から呼ばれた THE SYSTEM SHALL その証憑を含む差替の木を返す。木の根は最新版（`supersededById` をたどった先の、差し替えられていない行）で、各行の子はその行を差替先とする行。各行の関係は、`self`（指定した証憑）、`newer`（指定した証憑から最新版までの経路上の行）、`older`（`supersededById` をたどると指定した証憑に着く行）、`sibling`（それ以外。別の古い版から同じ新しい版へ差し替えた分岐など）。返す行は、まず `self` と `newer` の経路全体（打ち切らない。経路の探索は 500 段を上限とし、超えたら `truncated: true`）、次に最新版から幅優先で残りを、合計 50 行に達するまで足す。木に返さなかった行があれば `truncated: true`。並びは最新版からの深さの浅い順、同じ深さは登録日時の新しい順、さらに id 順。各行は AC-3 の証憑の項目（`linked` と `supersedes` を除く）と、関係、最新版からの深さと、差し替えられた行には差替の記録 `{ reason, at, actorType, actorId }` を持つ。差替の記録は `auditTrail(ctx, 'attachment', id, 500)` を要求者の Context で読み、`action` が `attachment.supersede` の最新の記録から取る。見つからなければ 4 項目とも null（画面は「記録なし」）。読取はすべて Repository（`find`、`list` は `limit` を明示）と `auditTrail`。action は読取専用（`mutates: false`、`tx: 'none'`）。系列の行は削除されず、どの版も既存のダウンロード経路で取得できる。
- AC-11 THE SYSTEM SHALL 既存の attachment の列と索引だけを使い、migration・entity 定義・kernel・依存パッケージを変更しない（`pnpm db:schema` で差分が出ない）。`attachment.search` の既存の入出力と既存の試験はそのまま通る。

### 画面（`apps/web`、`/finance/evidence`）

- AC-12 THE SYSTEM SHALL `/finance/evidence` を「会計・資金」分野の専用画面「証憑の検索」（Evidence search）として画面検索・分野一覧・コマンドパレットに出し、`attachment.evidence_search` を実行できない利用者には出さない。URL を直接開いた権限の無い利用者には、権限が無いことの説明とホームへの導線を出す。現在位置の「この画面の説明」はマニュアル 02 の「証憑の検索」節を指す（`lib/help.ts`）。
- AC-13 WHEN 利用者が取引年月日の範囲、取引金額の範囲、取引先（参照検索）、種別、差替の表示（すべて / 最新版のみ / 差替済みのみ）、未入力のみ、を入力して「検索」を押した THE SYSTEM SHALL 条件を URL（`?from=&to=&amountFrom=&amountTo=&partnerId=&kind=&superseded=&incomplete=&page=`）に保持して `attachment.evidence_search` を呼び、再読込・戻る・共有した URL で同じ条件と頁を復元する。画面は「指定した条件をすべて満たす証憑」（AND）であることを、適用中の条件の要約と件数で示す。条件を変えたら先頭頁に戻る。条件なしで開いたら全件の先頭頁を出す。金額は decimal 文字列のまま送り、JS の数値に変換しない。URL の `incomplete` は `1` だけを有効とし、それ以外は不正な値として扱う（AC-14）。検索と履歴の読込は自動では再取得しない（`refetchInterval` も窓の焦点での再取得も無し、`staleTime: 0`）。再取得は「検索」を押したとき（同じ条件でも読み直す）と頁を移ったときだけ。
- AC-14 IF 入力欄の値が不正（開始日 > 終了日、実在しない日付、数値でない金額、開始金額 > 終了金額）THEN THE SYSTEM SHALL 検索を実行せず、欄ごとに理由を示し（`aria-invalid` と説明の関連付け）、最初の不正な欄へ焦点を移す。URL に入っていた不正な値は無視し、無視したことを表示する（C1 の `?f=` と同じ扱い）。
- AC-15 THE SYSTEM SHALL 結果を表で示す: 取引年月日、取引金額（会社通貨の桁）、取引先（要求者が読めれば名称、読めなければ id。汎用一覧と同じ）、種別、ファイル名（押すと既存のダウンロード経路で 1 件保存）、リンク先（`readable` なら entity の表示名と番号または表示名・状態の札、`target` の `/e/<entity>/<id>` へのリンク。明細へのリンクは親の伝票へ移動し「明細から」と添える。`readable: false` なら「参照できない記録」、`unknown` はリンクなし）、差替（差し替えられた行は「差替済み」の札と差替先（`supersededById`）の記録 `/e/attachment/<id>` への移動。最新版への移動は「履歴」で行う。差替前がある行は「差替前 n 件」）、「履歴」ボタン、証憑の記録へのリンク（`/e/attachment/<id>`）。取引年月日・取引金額・取引先のいずれかが未入力の行には文字で「未入力」の札を付ける（色だけで区別しない）。1 頁 50 件で件数と頁送りを出し、0 件なら条件の見直しを促す空状態を出す。検索の読込失敗は前回の結果を残さず、エラーの詳細（`components/error-details.tsx`）と再試行を出す。
- AC-16 WHEN 利用者が「履歴」を押した THE SYSTEM SHALL kit の `Dialog` に `attachment.history` の木を AC-10 の並びで示す（各版の関係の札（この証憑・新しい版・古い版・別の分岐）、ファイル名・取引年月日・取引金額・登録日時・ダウンロード、差し替えられた版には差替の理由・日時・実行者）。実行者は監査ログの欄（`components/audit-panel.tsx`）と同じ `actorType:短縮 id` で示す（利用者名の読取は多くの役割に権限が無いため）。差替の記録が無い版は「記録なし」と示す。差し替えられた版も削除されずに取得できることを文で示し、`truncated` なら続きがあることを示す。閉じたら焦点を「履歴」ボタンへ戻す。
- AC-17 WHEN 利用者が結果から証憑を選び「選択した証憑を zip でダウンロード」を押した THE SYSTEM SHALL 選んだ各証憑を既存の `GET /api/attachments/:id/download`（要求者の権限と保存内容の照合を 1 件ずつ通る）で 1 件ずつ順に取得し、ブラウザ内で zip（無圧縮の STORE 方式、UTF-8 のファイル名フラグ付き）を作って `evidence_<UTC の YYYYMMDDHHMMSS>.zip` として保存する。zip 内の名前は `<取引年月日 または no-date>_<元のファイル名>`（差し替えられた証憑は先頭に `superseded_`）とし、OS で使えない文字（`/ \ : * ? " < > |` と制御文字）は `_` に置き換え、末尾の `.` と空白も `_` に置き換え、Windows の予約名（拡張子の前が `CON` `PRN` `AUX` `NUL` `COM1`〜`COM9` `LPT1`〜`LPT9`、大文字小文字を問わない）は先頭に `_` を付ける。各名前は UTF-8 で 255 バイト以内とし、超える分は拡張子を残して拡張子の前を文字の境界で切り詰める。同じ名前は拡張子の前に ` (2)`、` (3)` を付けて区別する（連番を付けても 255 バイト以内に収める）。各項目には UTF-8 の名前フラグ（汎用ビット 11）と Info-ZIP Unicode Path 拡張フィールド（0x7075）を付け、更新日時（DOS 形式）は証憑の登録日時（ブラウザの地方時。1980〜2107 年に丸める）とする。取得中は進捗（n / N 件）を polite なライブ領域で知らせ、二重実行を防ぎ、「中止」で取得をやめて何も保存しない。
- AC-18 THE SYSTEM SHALL 1 回の zip を 50 件以内、かつ選んだ証憑の記録上の `size` の合計 100 MB（104,857,600 バイト）以内に限る。件数は C1 の選択の決まり（`lib/list-workbench.ts` の `toggleSelection` / `togglePageSelection`、上限 50）で 51 件目以降の選択を受け付けず、受け付けなかったことを示す。合計サイズが 100 MB を超えたらダウンロードを無効にする。選択の件数・合計サイズと上限を常に表示する。選択は同じ条件の間は頁をまたいで保持し、条件を変えたら空にする。
- AC-19 IF 一部の証憑の取得に失敗した（403 / 404、保存内容の不一致の 409、通信の失敗、受信サイズが記録の `size` と異なる）THEN THE SYSTEM SHALL 残りの取得を続け、成功した分だけで zip を保存し、失敗したファイル名と理由を一覧で示す。すべて失敗したら zip を保存せず、その旨を示す。取得が 401（ログインの期限切れ）を返したら、残りの取得をやめて何も保存しない（`api/client.ts` がセッションを消してログイン画面へ移る）。
- AC-20 WHEN 利用者が会社を切り替えた、または別の利用者でログインした THE SYSTEM SHALL 前の会社・利用者の結果・選択・履歴を表示に残さない（検索と履歴の query key に `financeIdentity()` を含め、選択は条件と同じ境界で空にする）。
- AC-21 THE SYSTEM SHALL 画面の文言を日本語と英語（`{ ja, en }`）で持ち、390px 幅でページ全体に横スクロールを出さずに検索・選択・ダウンロード・履歴を操作でき（結果の表はその枠の中で横に動いてよい）、結果を表示した状態で axe の serious / critical 違反を出さない（日英 × 1280 / 390px。判定は `apps/web/e2e/a11y-policy.ts` の `judge`、例外は `a11y-exceptions.json`（この画面の例外は無い）、画面 id は `evidence-search`）。検査は結果を表示した後の状態が要るため、[試験の規約](../conventions/testing.md)の「操作後の状態は、必要になった画面の試験で `AxeBuilder` を同じ規則（`judge`）で呼ぶ」に従ってこの画面のブラウザ試験で行い、初期表示だけを見る `A11Y_SCREENS` には足さない。

## 関係するファイル・インターフェース（名指し）

- `modules/attachments/src/actions/evidence-search.ts`（新規: `attachment.evidence_search`、入出力 schema）、`actions/history.ts`（新規: `attachment.history`）、`services/search.ts`（`SearchCriteria` に `superseded` / `incomplete`、`buildSearchDomain` の拡張。`attachment.search` は新しい条件を渡さない）、`services/evidence.ts`（新規: 公開 DTO の schema `Attachment.schemas.json.omit({ storageKey: true }).extend(...)`、`incomplete` 判定、差替の木の関係・並べ替え・打切りの純粋関数）、`services/linked.ts`（新規: リンク先の要約。kernel の公開 API `registry`・`repo`・`can`・`maskedFields` と `EntityDef` の field 定義だけを使う。`kernel/src/related.ts` の非公開関数は使わない）、`module.ts`（2 action の登録）、`index.ts`（公開）
- 使う kernel の公開 API: `defineAction`、`repo`（`Repository.list` / `get`）、`registry`（`hasEntity`、`entity`、`allEntities` で明細 entity を判定）、`can`、`maskedFields`、`auditTrail`、`isLocalDate`、`Decimal`、`ValidationError`。kernel の変更は不要。必要になったら ADR を起こす（次の番号は 0030。統合時に調整）
- API: 変更なし（`POST /actions/:name` と `GET /api/attachments/:id/download` を使う）
- Web: `apps/web/src/pages/evidence-page.tsx`（新規）、`apps/web/src/api/evidence.ts`（新規: 検索・履歴の hooks、query key は `['finance', financeIdentity(), 'evidence', …]`）、`apps/web/src/lib/evidence-search.ts`（新規: URL の解釈と直列化、入力の検査、条件の要約、選択の上限、zip 内の名前、失敗の集計。純粋関数）、`apps/web/src/lib/zip.ts`（新規: CRC-32 と STORE 方式の zip。最終の `Blob` は取得した各ファイルの `Blob` と小さなヘッダの配列から組み、全体を 1 つのバッファに複製しない）、`apps/web/src/components/evidence-history-dialog.tsx`・`evidence-download.tsx`（新規）、`apps/web/src/api/client.ts`（`download` に任意の `AbortSignal` を足す）、`apps/web/src/api/types.ts`（DTO の型）、`apps/web/src/router.tsx`（`/finance/evidence`、`validateSearch`）、`apps/web/src/lib/navigation-data.ts`（`workspace: 'finance'`、`module: 'attachment'`、`action: 'attachment.evidence_search'`）、`apps/web/src/lib/help.ts`（`/finance/evidence` → `02-basics.md` の「証憑の検索」）、`apps/web/src/ui/token-usage.test.ts`（`CONVERTED` に追加）。参照検索は既存の `components/fields/ref-field.tsx`、取引先名は既存の `api/queries.ts useRefLabelMaps`
- 試験: `modules/attachments/test/evidence.test.ts`（unit）、`modules/attachments/test/evidence-search.db.test.ts`（DB）、`apps/api/test/evidence-search.db.test.ts`（DB、全 module を登録した API 経由）、`apps/web/src/lib/evidence-search.test.ts`・`apps/web/src/lib/zip.test.ts`（Web unit）、`apps/web/e2e/evidence-search.spec.ts`（ブラウザ）
- 文書: `docs/manual/02-basics.md`（「添付（証憑）」の次に「証憑の検索」節。同じ章の「差し替えは管理者が」の誤り（差替は attachment の update を持つ経理・営業・購買と管理者が行える）も直す）、`docs/manual/10-limitations.md`（電帳法の扱いの限界、証憑の行の可視性の既知の差、取引先を登録していない証憑）、`docs/manual/09-ai.md`（2 action）、画面の一覧（`docs/manual/00-index.md`、`docs/manual/appendix-n-navigation.md`、`docs/architecture/program-map.md`）、`docs/architecture/permissions.md`（「audit/添付」の行は書き換えず、表の下に「既知の差（未達）」の注記を足す: 証憑の list / get / `attachment.search` / `attachment.evidence_search` / ダウンロード / `/finance/evidence` はリンク先の可視性を継承しない。未決事項 1、F3、改善候補への参照）、`docs/domain/japan-tax.md`（「メタデータ必須」を「適合に必要だが入力は強制しない。未入力は `incomplete`」に直し、検索要件の出典を整理）、`docs/specs/attachments.md`（関連としてこの spec を挙げる）

## データ・業務ルール（出典）

- 電子取引データの検索要件（取引年月日その他の日付・取引金額・取引先、日付と金額の範囲指定、任意の 2 項目以上の組合せ）— [japan-tax.md#evidence-search](../domain/japan-tax.md#evidence-search)。主な出典は国税庁 電子帳簿保存法一問一答【電子取引関係】令和７年６月 https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/pdf/03-6.pdf （2026-09-10 に研究資料 [research/04](../../research/04-domain-scope-japan.md) B2 で確認済）。2026-10-30 の検索で令和８年７月版 https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/pdf/0026007-006_05.pdf の公表を確かめた（検索結果の抜粋のみ。本文は未取得）。ダウンロードの求めによる緩和、検索機能が不要となる場合（基準期間の売上高 5,000 万円以下、出力書面。2023-12-31 までは 1,000 万円）、猶予措置は検索結果の抜粋でのみ確認した事実として扱う。**AC-2 はこれらの緩和の事実に依存しない**（原則要件を常に満たす検索を出すため。判断 6）。**確認の状態: 2026-10-30 もこの環境から国税庁・e-Gov に到達できず、本文・条文の逐語は未確認。**
- 検索の 3 項目が入っていない証憑: attachment の `txnDate` / `amount` / `partnerId` は任意項目で（[attachments](attachments.md) AC-1）、入力は強制しない。取引年月日・取引金額・取引先のどれかが空の行は `incomplete` で、その行は検索要件を満たさない（日付や金額の範囲検索、取引先の検索に出ない）。取引先は partner に登録した記録の id でだけ検索でき、未登録の相手（タクシー、コンビニなど）の領収書は取引先を登録してから入力する。「未入力のみ」の条件はこうした行を見つけて直すためにある。取引先の自由記述の欄は entity の変更になるため、後の候補とする（未決事項 7）。マニュアルと制限事項にも書く。
- 訂正削除履歴（差し替えた証憑を消さず、理由を残す）— 既存の [attachments](attachments.md) AC-5、[japan-tax.md#電子帳簿保存法](../domain/japan-tax.md#電子帳簿保存法)。
- 新しい制度値（税率・閾値など）は扱わない。5,000 万円・1,000 万円の基準はシステムの判定に使わないので、期間付きデータにもしない（判断 6）。
- 金額は decimal 文字列で受け渡し、比較は DB の numeric（ADR-0010）。画面は `lib/decimal.ts` と `lib/format.ts` の規則で表示する。

## 判断（計画が選択を残した点と、その理由）

1. **新しい読取 action を 2 つ足し、`attachment.search` の出力は変えない。** `attachment.search` は MCP・REST の利用者がいる契約で、出力は attachment の JSON（`storageKey` を含む）。リンク先の要約と差替の件数を足すと契約が変わるため、`attachment.evidence_search`（公開 DTO、最大 100 行）を別に置き、条件の組立て（`buildSearchDomain`）だけを共有する。差替の理由は監査ログにしか無いので、系列は必要なときに `attachment.history` で読む（結果の各行で監査を読まない）。
2. **証憑の行の可視性は現状どおり（リンク先の読取規則を継承しない）。ただし利用者の確認を待つ判断とし、既知の差として記録する。** 計画の「添付はリンク先の読取規則を継承する」は、リンクの書込時と記録画面の添付欄には当たるが、一覧・検索・ダウンロードには当たらない（「確認した現状」3）。E4 で狭めると `/e/attachment` と結果が食い違い、行の規則を多相リンクで評価する kernel の変更（ADR が要る）になる。広げも狭めもせず、リンク先の要約（番号・表示名・状態）だけをリンク先の権限で出す（AC-5、AC-6）。権限の文書の規則は書き換えず、表の下に「既知の差（未達）」として、差のある入口（list / get / `attachment.search` / `attachment.evidence_search` / ダウンロード / この画面）を挙げる。E4 を完了とする前に利用者の確認が要る（統合担当への申し送り）。閉じる場合は別の spec と ADR で kernel を拡張する（未決事項 1）。
3. **一括ダウンロードはブラウザで zip を作る。サーバーの zip 生成 route は作らない。** 理由: (a) 各ファイルが既存のダウンロード経路を 1 件ずつ通るので、権限・tenant の保存範囲・サイズと SHA-256 の照合がそのまま効き、新しいバイトの読取経路をレビューしなくてよい（計画の原則 1）。(b) サーバーで zip を作るには依存パッケージか手書きの zip が `apps/api` に要り、大きな応答を 1 要求で流す間の失敗処理が増える。(c) 証憑の多くは PDF・JPEG・PNG で既に圧縮されているため、無圧縮の STORE 方式で十分。STORE の zip は CRC-32 とヘッダの組立てだけなので、依存パッケージを足さずに `lib/zip.ts`（百数十行）で書く。欠点は要求数（最大 50）とブラウザのメモリで、上限（判断 4）で抑える。
4. **上限は 50 件かつ合計 100 MB。** 1 ファイルの上限は 20 MB（attachments AC-2）。最終の `Blob` は取得した `Blob` を参照して組むので、ピークのメモリはおおむね選んだファイルの合計（＋CRC 計算中の 1 ファイル分）。100 MB はデスクトップで問題なく、スマートフォンでも多くの端末で扱える大きさとして選んだ。件数 50 は 1 件ずつ順に取得する時間（1 件 0.2〜1 秒で 10〜50 秒）を待てる範囲とした。実測で変える（未決事項 3）。
5. **zip にはファイルだけを入れ、索引の CSV は入れない。** 証憑の一覧を CSV にするのは台帳データの出力で、ADR-0018 により attachment（と取引先名を出すなら partner）の `export` 権限の再検証が要る。export は admin しか持たないため、accounting の zip に索引を入れると権限を迂回する。索引が必要な利用者（税務職員のダウンロードの求めへの対応を含む）は、`/e/attachment` の絞り込み（取引年月日・取引金額・取引先）と CSV 出力（C1、export 権限、監査付き）を使う。zip 内の名前に取引年月日を入れるのは、画面に表示している値で並べ替えやすくするためで、台帳の出力ではない。
6. **会社の規模で検索要件を切り替えない。** 免除の条件（基準期間の売上高、出力書面）は会社の申告の事情でシステムからは判定できず、原則要件を満たす検索を常に出しても害がない。閾値をコードにもデータにも持たないので、期間付きデータの規則（CLAUDE.md 規約 10）の対象にならない。
7. **差替の表示は既定で「すべて」。** 差し替えられた証憑も保存対象のデータで、検索で見つけられる必要がある（訂正削除履歴）。日常の確認向けに「最新版のみ」を選べる。
8. **migration と kernel を変えない。** 3 条件は列ごとの B-tree 索引（会社で先頭を揃えたもの）で PostgreSQL が組み合わせられる見込みで、複合索引は足さない。検証手順 5 で 1 万件の合成データの実行計画と時間を、アプリの接続（`daifuku_app`、RLS が効く）で Repository が出す SQL のまま測る。基準: 2 項目の組合せ 3 通り・3 項目・条件なしの各 1 頁が、件数の `count(*)` を含めて 200 ms 以下。超えたら結果を log に残し、索引の追加を改善候補として統合担当に申し送る（この項目では足さない）。並びの NULLS LAST も kernel の変更になるため、取引年月日の無い行が先頭に来る既定のままにする（未入力の証憑が目に付く効果もある）。
9. **ADR は作らない。** module の読取 action と Web 画面だけで、DSL・kernel port・依存・境界の規則を変えないため。実装で kernel の変更が要ると分かったら、ADR-0030（統合時に番号を調整）を起こしてこの spec を直す。
10. **round 4（B2・B3・D3・A4）に依存しない。** B3 の導入チェック（`/meta/health`）に「検索の 3 項目が未入力の証憑の件数」を足すのは、B3 の統合後の候補として未決事項 5 に置く。
11. **差替の履歴は最新版を根とする木として返す。** 差替は分岐（a → c と b → c）を許すため、一本の列として「新しい / 古い」だけでは関係を表せない。指定した証憑と最新版までの経路は必ず返し（どの版から開いても最新版へたどれる）、残りを幅優先で 50 行まで足す。差替の理由・日時・実行者は監査ログにしかないので、`attachment.supersede` の記録を探し、無ければ「記録なし」とする。
12. **明細へのリンクは親の伝票として示す。** 書込の経路（`assertLinkTarget`）は登録済みのどの entity も受け付けるので、明細の行へのリンクも作れる。C2 の関連記録と同じく親の伝票を開く先にする。
13. **件数の上限は C1 の選択の決まりをそのまま使う。** 51 件目は選べず、合計サイズの上限だけがボタンを無効にする。上限を超えた選択からの部分的なダウンロードという中間の状態を作らないため。

### spec 批評への対応（2026-10-30、実装担当）

- 可視性の差を規則の書換えで片付けない（重大）: 受け入れた。AC-6 は利用者の確認を待つ判断とし、権限の文書の行は書き換えずに「既知の差（未達）」を注記、マニュアル（新しい節と 10 章）にも書き、統合担当に申し送る（判断 2、未決事項 1）。
- `$in` と件数と履歴の上限: 受け入れた。`limit: ids.length`、`aggregate` による差替前の件数、履歴の各読取の `limit` を明記し（AC-3、AC-5、AC-10）、同じ entity のリンク先が 50 件を超える頁と差替前 2 件以上の DB 試験を足す。
- 履歴の分岐・深い版・監査の欠落: 受け入れた。木として定義し直した（AC-10、判断 11）。兄弟・深い版・監査の無い行の unit と DB 試験を足す。
- 最新版へのリンク: AC-15 を「差替先の記録へ移動 / 履歴を開く」に変えた（DTO に `latestId` は足さない。最新版は履歴で示す）。
- 明細へのリンク: 親の伝票として解決する方を選んだ（AC-5、判断 12）。
- 取引先が未登録・項目が空の証憑: 受け入れた（データ・業務ルール、未決事項 7）。
- DTO を手で列挙しない: 受け入れた（AC-3）。unit 試験で `storageKey` が無いことを確かめる。
- 実行計画の測り方と基準: 受け入れた（判断 8、検証手順 5）。
- 出典の版: 受け入れた。令和７年６月版を主な出典にし、令和８年７月版の公表を確認した（本文は未取得）。
- `incomplete: false` の意味: `false` と省略は絞り込まない、と定めた（AC-1、AC-4、AC-13）。
- 選択の上限の振舞い: C1 の関数を使う（AC-18、判断 13）。
- `attachment.search` への入力の追加: 取り下げた（AC-4）。
- zip 内の名前: 255 バイト、末尾の `.` と空白、予約名、DOS 日時、0x7075 を定めた（AC-17）。Windows のエクスプローラでの確認はこの環境で行えないため、log に未検証と書く。
- 401: 受け入れた（AC-19）。Web unit 試験を足す。
- axe の置き場所: 試験の規約の「操作後の状態」に当たるため、この画面のブラウザ試験に置く理由を AC-21 に書いた。
- 再取得の方針: 受け入れた（AC-13）。
- 実行者の表示: 監査ログの欄と同じ表示にした（AC-16）。
- マニュアル 02 の差替の権限の誤り: 受け入れた。同じ変更で直す。

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
| AC-5         | module                        | module（上限）、API（伝票・明細・権限）                    | リンク先の伝票を開く                           |
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
2. unit（`modules/attachments/test/evidence.test.ts`）: `buildSearchDomain` の `superseded` / `incomplete` と既存条件の組合せ、範囲と入力の検査（AC-4、AC-9）。公開 DTO に `storageKey` が無いことと `incomplete` の判定（AC-3）。差替の木の関係（`self` / `newer` / `older` / `sibling`）・並べ替え・50 行の打切り・深い版でも `self` と最新版までの経路が残ること・監査の記録の選び方と欠落（AC-10）。リンク先の要約の組立て（マスク・`outputHidden`・明細から親の伝票・未登録で `title` が null、AC-5）
3. DB（`modules/attachments/test/evidence-search.db.test.ts`）: 各条件の単独、任意の 2 項目の 3 通りと 3 項目すべての AND を、条件ごとに一致する集合が異なる合成データで確かめる（AC-1、AC-2）。片側の範囲・両端同値・境界値・未入力の行が範囲検索に出ないこと（AC-1）。`superseded` の 3 値と `incomplete`（AC-4）。v1 → v2 → v3 と分岐（a → c、b → c）の木と各関係、理由・日時・実行者、監査の記録が無い行（試験で監査を書かずに差し替えた行）は null、51 段の深い版で `self` と最新版までの経路が残り `truncated`、差し替えられた版のファイルが storage から読めること（AC-10）。同じ entity（partner）のリンク先が 50 件を超える頁（60 件）で全行が `readable: true`、差替前 2 件の `supersedes`（AC-3、AC-5）。会社 B の同一内容・同一条件の証憑が出ず `total` にも入らないこと、会社 B の取引先 id で 0 件、会社 B の id の履歴が NotFound（AC-7）。`nobody` と店舗に限定された Context が PermissionDenied（AC-8）。入力の検査（AC-9）。既存の `attachment.search` の試験がそのまま通ること（AC-11）
4. DB（`apps/api/test/evidence-search.db.test.ts`）: HTTP 経由で 200 / 400 / 403。purchase_invoice にリンクした証憑を accounting と sales で検索し、両方に行が出て、sales の `linked` は `readable: false` で番号が無いこと（AC-5、AC-6）。リンク先の下書き document を admin が削除した後、その証憑の `linked` が `readable: false` になること（その document が削除できなければ、削除できる entity で確かめて理由を log に書く）。履歴に出た古い版を `GET /api/attachments/:id/download` で取得できること（AC-10）
5. 計測（log に記録）: 使い捨て DB に owner 接続で 1 会社 1 万件の合成証憑を入れ、`daifuku_app` の接続で `app.tenant_id` を設定して（RLS が効く状態）、Repository が出す SQL（scope、`ORDER BY txn_date DESC, created_at DESC, id ASC`、`LIMIT 50`、件数の `count(*)`）の `EXPLAIN (ANALYZE, BUFFERS)` と所要時間を、2 項目の組合せ 3 通り・3 項目・条件なしについて残す。基準は各 200 ms 以下（判断 8）。`pnpm db:schema` を実行して差分が無いことを確かめる（AC-11）
6. Web unit（`apps/web/src/lib/evidence-search.test.ts`、`apps/web/src/lib/zip.test.ts`）: URL の解釈と直列化・不正な値の無視・頁のリセット・金額を文字列のまま扱うこと（AC-13、AC-14）、条件の要約、リンクの行き先（`readable` / `line` / `unknown`）、未入力の札（AC-15）、上限の判定と表示（AC-18）、zip 内の名前（日付・`superseded_`・禁止文字・末尾の `.` と空白・予約名・255 バイトの切り詰め・同名の連番）と失敗の集計、401 で中断して保存しないこと（AC-17、AC-19）、選択の上限 50 件で 51 件目を受け付けないこととサイズ上限でボタンが無効になること（AC-18）、query key に `financeIdentity()` が入ること（AC-20）、画面カタログの表示条件と `help.ts` の対応（AC-12）。zip は CRC-32 の既知の値、試験内の最小の読取器でローカルヘッダ・中央ディレクトリ・終端レコード・UTF-8 フラグ・0x7075 拡張フィールド・DOS 日時・CRC・サイズを確かめる（AC-17）
7. ブラウザ（`apps/web/e2e/evidence-search.spec.ts`、`e2e-run.sh <worktree> <slot> apps/web/e2e/evidence-search.spec.ts --project=chromium --no-deps`）: 合成会社に取引先 2 件、確定した仕入請求書 1 件、条件の異なる証憑を API で登録し、画面検索から開く → 取引年月日の範囲・取引金額の範囲・取引先の 3 条件で 1 件に絞る → リンク先の伝票を開いて番号を確かめる → 戻るで条件が復元される。差替（v1 → v2）の履歴の Dialog と理由、焦点の戻り。2 件を選んで zip をダウンロードし、試験側で zip の項目名と中身の長さを確かめる。1 件のダウンロードを 409 に差し替えて部分失敗の表示と、成功分だけの zip。不正な範囲で検索しないこと。英語表示、390px で横スクロールが無いこと、axe（日英 × 1280 / 390px）。権限の無い利用者の説明（AC-12〜AC-21）
8. 手動（log に記録）: 保存した zip を `python3 -m zipfile -l` と Info-ZIP の `unzip -l`（あれば）で開き、日本語のファイル名が化けないことを確かめる。Windows のエクスプローラでの確認はこの環境では行えないため未検証と書く（UTF-8 フラグと 0x7075 で備える）
9. マニュアル: `docs/manual/02-basics.md` に「証憑の検索」節（検索の 3 項目と AND、取引先を登録していない・項目が空の証憑は検索要件を満たさず「未入力のみ」で直すこと、差替の表示と履歴、一括ダウンロードの上限と部分失敗、索引が必要なときは `/e/attachment` の CSV、証憑の行の可視性の既知の差、電帳法への適合は第三者の確認を受けていないこと）。同じ章の差替の権限の誤りを直す。`10-limitations.md` に同じ制限を書く。画面の一覧 3 文書と `help.ts` の対応
10. `docs/domain/japan-tax.md#evidence-search` の本文確認（国税庁に到達できる環境で。できなければ log に未確認と書く）。令和８年版以降の一問一答が公表されていないかを確かめ、確認日を更新する
11. `pnpm gate:full`（統合担当が実行）

## 未決事項（利用者の判断待ち。括弧内は推奨の既定）

1. 証憑の行の可視性をリンク先の記録の読取規則に従わせるか（**E4 では変えない**）。今は attachment を読めるロール（例: sales）が、自分では読めない記録（例: 仕入請求書）にリンクされた証憑のファイル名・金額・取引先を読める。リンク先の業務の権限を持たない利用者に見せたくない証憑（人事・給与に関わるものなど）がリンクされうるかは、実装時に role 表で確かめて log に書く。従わせるには、多相リンクを行の規則として評価する kernel の拡張と ADR が要る。F3（権限マトリクスの横断表示）と合わせて検討する。**E4 を完了とする前に利用者の確認が要る**（権限の文書には「既知の差（未達）」として注記し、統合担当に申し送る）。
2. 証憑のダウンロード（1 件・一括）を監査に記録するか（**記録しない**。既存の 1 件のダウンロードも記録していないため、揃えて F3 で扱う）。
3. 一括ダウンロードの上限（**50 件・100 MB**）。スマートフォンで不足や失敗が出たら、端末幅で上限を下げるか、分割して保存する案内を足す。
4. 証憑に「電子取引 / スキャナ保存 / 紙」の区分を持たせるか（**E4 では持たない**）。スキャナ保存は別の要件を持つため、扱うなら別項目。
5. B3 の導入チェックに「検索の 3 項目が未入力の証憑の件数」を足すか（**B3 統合後に足す候補**。この画面の「未入力のみ」で同じ対象を開ける）。
6. 既存の attachment の JSON（upload の応答、REST、`attachment.search`）に `storageKey` が含まれる。`outputHidden` にするか（**E4 の範囲外。改善候補として別に扱う**。既存の試験が出力を前提にしているため、変えるなら試験の意図を確かめて直す）。
7. 取引先を自由記述でも持つか（**E4 では持たない**）。partner に登録しない相手（タクシー、コンビニなど）の領収書を取引先で検索できるようにするには、attachment に自由記述の取引先の欄を足す entity の変更と migration が要る。それまでは取引先を partner に登録して入力する（「データ・業務ルール」）。
