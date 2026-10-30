# 完成度を高めるための改善・拡張候補

更新: 2026-10-29。対象は `main` の `431dda5`（PR #16 統合後）。現在の実装範囲は [STATUS](STATUS.md)、品質の優先順位は [品質改善の計画](quality-roadmap.md)、開発方針は [PLAN](../PLAN.md) を正本にする。

この文書は「次に何を作ると完成度が上がるか」の候補一覧であり、日程や対応範囲を約束するものではない。採用した候補の作業単位・順序・設計は [完成度向上の実装計画](completion-plan.md) にまとめている。候補を採用するときは、[spec](specs/_template.md) → 実装 → [作業記録](log/_template.md) の単位（CLAUDE.md 規約9）に分け、既存の不変条件（権限バイパスなし、Decimal、確定伝票の不変、module から DB 直結なし）を緩めない。

## 調べ方と現状の要約

ソースと文書を読んで判断した。測定や利用者調査は行っていない。主に読んだのは、Web の [router](../apps/web/src/router.tsx)・[画面カタログ](../apps/web/src/lib/navigation-data.ts)・[汎用一覧](../apps/web/src/pages/entity-list-page.tsx)・[汎用フォーム](../apps/web/src/pages/entity-form-page.tsx)・[伝票操作](../apps/web/src/components/doc-actions.tsx)・[設定画面](../apps/web/src/pages/settings-page.tsx)・[テンプレート画面](../apps/web/src/pages/templates-page.tsx)・[ホーム](../apps/web/src/pages/home-page.tsx)、API の [setup CLI](../apps/api/src/setup/cli.ts)・[管理 API](../apps/api/src/routes/access-admin.ts)、kernel の [bootstrap](../kernel/src/auth.ts)・[registry](../kernel/src/registry.ts)・[events](../kernel/src/events.ts)・[document](../kernel/src/document.ts)、マニュアルの [初期設定](manual/03-setup.md)・[制限事項](manual/10-limitations.md)、[調査ノート04](../research/04-domain-scope-japan.md) である。

強みは明確である。DSL から派生する汎用画面と REST/MCP、14 の専用画面、15 業界 pack、監査・採番・楽観ロック、別 DB 実復元付きの安全な setup、生成検査や mutation を含む検証基盤が揃っている。一方で、専門機能の厚みに比べて次の 2 点が薄い。

1. **導入の最初の 1 時間**。初回の会社・管理者は CLI でしか作れず、2 社目以降を追加する画面も API もない。初期設定は key 別のカードに分かれ、細目名は英語のまま、順序の案内がない。
2. **毎日の一覧・伝票画面の生産性**。汎用一覧は検索・並べ替え・ページ送りだけで、絞り込み・列選択・CSV・一括操作がない。伝票の複製、関連伝票の一覧、モジュール横断の「やること」受信箱、業務通知もない。

以下、1〜5 章が候補、6 章が優先順位、7 章が進め方の注意である。各候補に「現状の根拠」と「使える足場」を付け、推測は【推測】と記す。

## 1. 導入・初期設定（セットアップウィザード）

| 現状 | 根拠 |
| --- | --- |
| テナント・最初の会社・管理者は `pnpm run setup install` の引数でだけ作る | [setup options](../apps/api/src/setup/options.ts)、[bootstrap](../kernel/src/auth.ts) |
| 2 社目以降を追加する画面・API がない（デモ会社は開発用 seed のみ） | [管理 API](../apps/api/src/routes/access-admin.ts) に会社作成なし、[industry-demos](../apps/api/src/db/industry-demos.ts) |
| 会社の住所・電話・決算月などは `companies.settings` の JSON に散在し、会社の正式な列は code/name/country/currency のみ | [settings port](../kernel/src/settings.ts) |
| 設定画面は module が登録した key ごとのカードで、順序や完了状態の案内がない。JSON Schema の `title` が単一文字列のため細目名は英語 | [設定画面](../apps/web/src/pages/settings-page.tsx)、[schema 変換](../apps/web/src/lib/schema.ts)、[マニュアル 03](manual/03-setup.md) |
| 会計年度の作成は `accounting.open_fiscal_year` を汎用アクション画面から呼ぶ。勤怠の初期制度は専用ボタン、業界テンプレートは別画面 | [open-fiscal-year](../modules/accounting/src/actions/open-fiscal-year.ts)、[WorkforceInitialize](../apps/web/src/components/workforce-initialize.tsx)、[テンプレート画面](../apps/web/src/pages/templates-page.tsx) |
| マスタ・期首残高の CSV 取込がない（CSV 取込は銀行明細のみ） | [banking imports](../modules/banking/src/imports.ts) |

### 1-1. 初回セットアップウィザード（画面）（済: 2026-10-30、[setup-wizard](specs/setup-wizard.md)）

管理者が初めてログインしたとき、または「設定・管理」から任意に開ける段階式の画面を追加する。各ステップは既存の action と設定 API を呼ぶだけにし、新しい権限経路を作らない。

1. 会社情報: 名称・住所・電話・登録番号（T+13 桁）・課税/免税・税込/税抜経理・決算月。
2. 会計年度: 決算月から `accounting.open_fiscal_year` の開始日を提案して作成。
3. 勘定科目: 既定の中小企業向け科目表をそのまま使うか、後で編集するかを選ぶ。
4. 税率と端数処理: 既定値を表示し、`tax.roundingUnit` などを確認。
5. 請求書の発行者情報: 現在の `請求書の発行者` 設定を日本語ラベルで入力。
6. 在庫の扱い: 在庫を使わない業種（士業・デザイン事務所など）では「自動入出庫」を `false` にする。マニュアル 03 で注意されている落とし穴を UI で防ぐ。
7. 業界テンプレート: 適用とサンプル投入（既存のテンプレート画面を埋め込む）。
8. 利用者: 招待メール（SMTP 設定済みのとき）か直接作成。
9. 勤怠・給与: 従業員機能を使う会社だけ `workforce.initialize_policy` を実行。

進捗は company setting（例: `setup.wizard`）に保存して中断・再開できるようにし、ホームに「未完了のセットアップ」チェックリストを出す。完了判定は「保存した」ではなく「会計期間が開いている」「発行者名が入っている」のような実データの条件にする。

### 1-2. 会社の追加・編集画面と会社プロフィールの正式化（済: 2026-10-30、[company-admin](specs/company-admin.md)）

テナント管理者が会社を追加・編集できる画面と API を追加する。連結精算・FC 精算・会社切替があるのに会社追加の経路が CLI にもないのは、複数会社の利用者にとって最初の壁になる。あわせて、住所・電話・登録番号・決算月・代表者のような会社プロフィールを `companies` の列か専用 setting の 1 か所に正式化し、請求書・申告資料・給与資料が同じ出典を参照するようにする。会社の追加は所属・ロール・監査と一体で、[ADR-0018](adr/0018-company-and-store-access.md) の境界に従う。

### 1-3. 設定画面の再構成（済: 2026-10-30、[settings-console](specs/settings-console.md)）

- 分類タブ（会計・消費税・販売・購買・在庫・契約・従業員・業界）と、module が宣言する表示順。
- `SettingDef` に細目ラベルの `{ ja, en }` を渡せるようにし、英語の `Mode` / `Revenue` 表示をなくす（DSL の拡張なので短い ADR を付ける）。
- 科目コードの文字列入力を `account` の参照ピッカーに、`true/false` 入力をチェックボックスにする。
- 変更履歴（誰がいつ何から何へ）を監査から表示し、「この設定が影響する画面」へのリンクを添える。

### 1-4. 導入チェック（ヘルスチェック）画面（済: 2026-10-30、[setup-health](specs/setup-health.md)。バックアップ時刻の確認は未実施）

`setup inspect` 相当の点検を管理者画面に出す。例: 今日を含む会計期間が開いているか、税率の有効期間が今日を覆うか、発行者情報が未設定か、SMTP/OIDC の設定状態、未適用の移行、バックアップの最終日時、添付保存先の空き。警告は原因と直す画面へのリンクを持つ。

### 1-5. マスタ・期首残高の CSV 取込（済: 2026-10-30、マスタは [csv-import](specs/csv-import.md)、期首残高は [opening-balances](specs/opening-balances.md)）

取引先・品目・勘定科目・倉庫・従業員と、期首残高（開始仕訳、売掛・買掛の未消込残高、在庫の初期数量）を CSV で取り込む。列定義と検証は DSL（必須・型・pattern・ref）から導出し、「事前確認（dry run）→ 行ごとの結果 → 実行」の 3 段にする。取込は `Repository` を通し、金額は `Decimal` のまま扱い、既存行の上書き可否を明示する。銀行明細取込の事前確認 UI が流用できる。他システムからの移行で最初に必要になる機能であり、15 業界のサンプルより先に実データで試せるようになる。

### 1-6. pack の雛形生成と導入手順の自己完結（雛形は済: 2026-10-30、[pack-scaffold](specs/pack-scaffold.md)。第三者完走の記録は未実施）

STATUS が述べるとおり、第三者が手順だけで新規 pack を完走した実績はまだない。`pnpm pack:new <name>` で `packs/example` を基に package.json・tsconfig・entity・action・seed・test の雛形を生成し、[拡張手順](architecture/extension-guide.md) の引継ぎ記録の条件を満たしやすくする。

## 2. 業務画面（毎日の使い勝手）

| 現状 | 根拠 |
| --- | --- |
| 汎用一覧は全文検索・列ヘッダ並べ替え・ページ送りのみ。状態・期間・取引先・金額の絞り込み、列選択、保存ビュー、CSV、一括操作がない | [汎用一覧](../apps/web/src/pages/entity-list-page.tsx)、[DataTable](../apps/web/src/components/data-table.tsx) |
| 伝票操作は確定・取消・改訂・削除のみ。複製、前後レコード移動、共通ショートカットがない | [伝票操作](../apps/web/src/components/doc-actions.tsx)、[フォーム](../apps/web/src/components/record-form.tsx) |
| 承認待ちは `/workforce` の「確認待ち」タブと店舗日次報告に分かれ、横断の受信箱・通知がない | [workforce-page](../apps/web/src/pages/workforce-page.tsx)、[operations-page](../apps/web/src/pages/operations-page.tsx) |
| （済: 2026-10-30、[print-templates](specs/print-templates.md)）汎用の印刷は `sales.render_invoice_html` の適格請求書だけ。見積書・納品書・注文書・領収書・支払明細・合計請求書の帳票がない | [print-button](../apps/web/src/components/print-button.tsx) |
| ホームは module 別の伝票件数と導線。役割別の「今日やること」はない | [ホーム](../apps/web/src/pages/home-page.tsx) |
| PWA manifest・オフライン打刻・ダークモードはない | `apps/web/public` に manifest なし |

### 2-1. 一覧の強化（済: 2026-10-30、[list-workbench](specs/list-workbench.md)）

- 絞り込み: 伝票状態、日付範囲、取引先、金額範囲、担当拠点。REST の `where` と `orderBy` は既にあるので、UI と URL 状態（`?where=`）の追加で済む。
- 列の選択と順序、保存ビュー（本人用と会社共有）。`views.list` を既定にし、保存先は本人設定か company setting。
- 合計行（金額列の合計、件数）。表示中ページだけでなく条件全体の合計は集計 API（`aggregate.ts`）を使う。
- CSV 出力。レポートの [`canExport` と再認可](../apps/web/src/components/report-export.tsx) をそのまま踏襲し、一覧でも権限と列マスクを守る。
- 一括確定・一括取消。選択した下書きを 1 件ずつ action に通し、成功・失敗を行ごとに表示する（権限や依存の失敗を握りつぶさない）。

### 2-2. 伝票フォームの生産性（済: 2026-10-30、[document-links](specs/document-links.md)・[form-ergonomics](specs/form-ergonomics.md)）

- 複製: 確定済み伝票を下書きとしてコピー。`document.ts` の `STRIP_ON_COPY` と改訂処理が足場になる。
- 関連伝票パネル: この伝票から生まれた仕訳・入出庫・消込・請求、訂正元/訂正先を 1 か所に。`findDependents` と各 module の `journalEntryId` 参照を使う。
- クイック操作: 売上請求書から「入金を記録」、仕入請求書から「支払を記録」、見積から「受注へ」など、次の伝票へ値を引き継いで開く（trade は実装済みなので、他の伝票へ広げる）。
- 共通ショートカット（保存・確定・明細行追加）、前後レコード移動、一覧の絞り込み条件を保ったまま戻る。
- 入力途中の下書きを端末内に保持（既存の「一時障害時の入力保持」の延長）。

### 2-3. 「やること」受信箱（Inbox）（済: 2026-10-30、[inbox](specs/inbox.md)）

各 module が「自分宛ての未処理」を返す action（例: `*.todo`）を公開し、ホームと専用画面で集約する。対象は、承認待ちの勤怠訂正・有給・経費、店舗日次報告の差戻し/承認、シフト希望の未提出、期限超過の請求、未消込入金、照合待ちの銀行明細、結果不明の機器ジョブ、確定待ちの給与。件数と「開く」だけで始め、通知は後段（4-5）に回す。権限は既存の read 権限で評価し、受信箱が新しい閲覧経路にならないようにする。

### 2-4. 役割別ホーム（済: 2026-10-30、[role-home](specs/role-home.md)）

経理（売掛・買掛・資金残高・今月の締め状況）、店長（今日の売上・勤怠・シフト・未提出）、従業員（`/me` への導線）で初期表示を変える。既存の [analytics データセット](../apps/api/src/analytics/catalog.ts) と operations snapshot を再利用し、新しい集計は作らない。

### 2-5. 月次締めガイド（済: 2026-10-30、[close-guide](specs/close-guide.md)）

[06 月次](manual/06-monthly.md) の手順（未確定の下書き確認 → 消込 → 試算表 → 消費税集計表 → 年齢表 → 在庫評価 → 期間締め）をチェックリスト画面にする。各ステップに未処理件数（下書きの伝票、未消込の入金、未転記の原資料、未提出の店舗）と、該当一覧へのリンクを出し、すべて 0 になってから `accounting.close_period` を押せるようにする。再開期間の理由と許可された訂正日の案内も同じ画面に置く。

### 2-6. 帳票の拡充とテンプレート（共通化と 7 種の追加は済: 2026-10-30、[print-templates](specs/print-templates.md)。会社ロゴ・振込先・適格返還請求書・前回繰越は未実施）

見積書・注文書・納品書・領収書・支払通知書・給与明細（印刷用）・適格返還請求書・合計請求書（取引先の締め日で期間内の請求をまとめる）。`render_*_html` の規約を module 共通にし、会社ロゴ・文言・振込先を company 設定から差し込む。和暦表示は表示層で切り替える（[日本の制度事実](domain/japan-tax.md)）。

### 2-7. モバイルと PWA

`/me` は 390px で検証済みなので、店長の承認・日次報告・シフト確認をモバイルで完結させる導線と、PWA manifest・ホーム画面追加・オフライン時の打刻キュー（再送時はサーバー時刻の規則を維持）を検討する。打刻の真正性（サーバー時刻）を崩さない範囲に限る。

## 3. UI/UX（画面の品質）

| 現状 | 根拠 |
| --- | --- |
| 汎用画面（一覧・フォーム・設定・アクション・状態表示）は Tailwind ユーティリティの直書き、専用画面は 13 本・6,469 行の手書き CSS。色は hex 直書きが多く、画面幅の分岐点は 12 種類ある | `apps/web/src/*.css`、[設定画面](../apps/web/src/pages/settings-page.tsx) |
| `<html lang="ja">` が英語表示でも固定 | [index.html](../apps/web/index.html)、[i18n](../apps/web/src/i18n.tsx) |
| 読込中は文字だけ、一覧の再取得中は半透明。0 件は「該当なし」の 1 行で、次の操作への導線がない | [状態表示](../apps/web/src/pages/status-views.tsx)、[DataTable](../apps/web/src/components/data-table.tsx) |
| エラー表示は `code: message — hint` の順で技術者向け。成功トーストに次の操作へのリンクがない | [トースト](../apps/web/src/components/toast.tsx) |
| 確認ダイアログは native `<dialog>` で焦点管理が良いが、Workforce / Commerce / Control の 3 系統のダイアログが並存する | `apps/web/src/components/*-dialog.tsx` |
| フォームは項目の平坦な並びで、節・タブ・エラー要約・必須マーク・保存や確定のショートカットがない。明細グリッドのキー操作は Enter のみ | [フォーム](../apps/web/src/components/record-form.tsx)、[明細グリッド](../apps/web/src/components/line-grid.tsx) |
| aria 属性は 160 か所以上で使われ、スキップリンクと経路変更時の焦点移動はあるが、自動検査（axe）は無い | [router](../apps/web/src/router.tsx)、`apps/web/e2e` |
| `/me` と一部の専用画面は 390px を検証済み。汎用一覧・フォームは広い画面を前提にしている | `apps/web/e2e` の viewport 指定 |
| 画面内ヘルプ、最近開いた記録、お気に入り、コマンドパレットがない（全画面検索はある） | [サイドバー](../apps/web/src/components/sidebar.tsx)、[画面カタログ](../apps/web/src/lib/navigation.ts) |

### 3-1. UI キットと意味トークン（済: 2026-10-29、[ui-kit](specs/ui-kit.md)。専用画面の CSS は触った画面から移行）

`apps/web/src/ui/` に PageHeader・Toolbar・Card・EmptyState・Skeleton・Button・Badge・Tabs・Dialog・FormSection・DataTableShell の小さな部品を置き、`styles.css` の `@theme` に `--surface` / `--border` / `--text` / `--accent` / `--danger` などの意味トークンを足す。分岐点は 480 / 768 / 1024 / 1280 の 4 つに寄せる。汎用画面から置き換え、専用画面は触った順に合わせる。ダークモードは対象外だが、トークン化で後から足せる形にする。

### 3-2. ナビゲーション補助（済: 2026-10-30、[navigation-assist](specs/navigation-assist.md)）

`Ctrl/⌘+K` のコマンドパレット（既存の正規化検索を再利用）、最近開いた記録とお気に入り（利用者・tenant・会社ごとに端末内保存）、`ScreenTrail` からの「この画面の説明」（ルート → マニュアル章の対応表）。

### 3-3. フォームの操作性（済: 2026-10-30、[form-ergonomics](specs/form-ergonomics.md)）

`views.form` にラベル付きグループを許し、節またはタブで表示する。保存失敗時はフォーム上部に要約（項目へのリンク）を出し、最初の不正項目へ焦点を移す。`Ctrl/⌘+S` 保存、`Ctrl/⌘+Enter` で確定確認、明細の Enter で次セル・末尾で行追加、`Alt+↑/↓` で行移動。狭い画面では保存・確定を下部の固定バーに置く。未保存入力の端末内退避と復元、一覧の条件を保った「前へ / 次へ」。

### 3-4. 状態表示と文言（汎用画面の空・読込・エラーは済。成功トーストの次操作と 3 系統ダイアログの統一は未実施）

空状態には説明と主操作（新規・取込・サンプル）を置く。読込は骨格表示にする。エラーは「何が起きたか」を先に、`code` と `hint` は折りたたみに。成功トーストには「開く」などの次の操作を添える。3 系統のダイアログは `Dialog` に段階的に寄せる。

### 3-5. アクセシビリティとモバイル（axe の自動検査は済: 2026-10-30、[e2e-a11y](specs/e2e-a11y.md)）

`@axe-core/playwright` で主要 8 画面を日英 × デスクトップ / 390px で検査し、serious 以上の違反で失敗させる（既知の例外は理由付きで登録）。タップ対象は 44px 以上、`lang` 属性の同期、汎用一覧・フォームの 390px 対応（横スクロールの表、下部操作バー）。

### 3-6. 今回は対象外にしたもの

ダークモード（トークン化後に検討）、アイコンセットの刷新、全面的な再デザイン、スクリーンショット回帰（CI のフォント差で不安定になるため、axe と既存のロール基準の試験で代替）。

## 4. 機能面の穴（汎用 ERP として一般的だが未実装）

[調査ノート04](../research/04-domain-scope-japan.md) の汎用コア一覧と現在の module 一覧を突き合わせた。

| 領域 | 現状 | 候補 | 使える足場 |
| --- | --- | --- | --- |
| 固定資産（済: 2026-10-30、[fixed-assets](specs/fixed-assets.md)。率表の照合は判断待ち） | 資産台帳・減価償却なし | 資産台帳、定額/定率、月割、除却・売却、償却仕訳の自動生成、償却資産申告の準備資料 | 期間付き制度データの扱い（ADR-0011/0024）、`post_from_source` |
| 定期仕訳（済: 2026-10-30、[recurring-journals](specs/recurring-journals.md)） | 契約請求の予定はあるが、仕訳側の定期仕訳・按分なし | 家賃・減価償却・前払費用の按分を期日に下書き生成し、確認して確定 | `contract.schedule` の考え方 |
| 予算・部門 | 予算なし。部門などの分析軸は pack の ext キーに依存 | 部門・プロジェクトの共通軸、科目×期間×部門の予算、予実レポート | [postingDimensions](../modules/accounting/src/dimensions.ts) |
| 資金繰り・支払予定（済: 2026-10-30、[cash-forecast](specs/cash-forecast.md)。督促状は未実施） | 年齢表と未消込残高はある | 入金予定・支払予定（契約請求、給与、振込バッチ、支払サイト）を統合した資金繰り表、督促状 | `sales.ar_aging` / `purchase.ap_aging`、銀行振込予約 |
| 経費精算の一般化（済: 2026-10-30、[expense-settlement](specs/expense-settlement.md)） | 従業員経費と領収書はある | 法人カード・仮払・立替の精算、支払と仕訳までの一貫処理 | workforce expense、payment |
| 証憑（電帳法）の横断検索（実装済み、行の読取規則は判断待ち: [evidence-search](specs/evidence-search.md)） | `attachment` に取引日・金額・取引先の列と索引がある | 取引日範囲×金額範囲×取引先の複合検索、差替履歴の表示、一括ダウンロード、伝票との相互リンク | [attachment](../modules/attachments/src/entities/attachment.ts)、範囲検索（quality-foundation） |
| インボイス制度 | 経過措置の控除率は実装済み（`transitional-credit.ts`）。登録番号の実在照合なし | 公表サイト Web-API/全件データとの照合（任意・オフライン可）、適格返還請求書 | [日本の制度事実](domain/japan-tax.md) |
| デジタルインボイス | JP PINT/Peppol なし | 認定プロバイダー向け JP PINT 出力（アクセスポイント運用は対象外） | 調査ノート B5 |
| 在庫 | 移動平均、固定単位、ロットなし | ロット/期限、単位換算、FIFO 評価の選択 | [在庫 domain](domain/inventory.md) |
| 商流 | 物品・JPY・税抜 | 役務の見積/受注、返品専用工程、入荷時の未請求債務 | trade / purchase |
| 販売前段 | 見積から開始 | 見込み客・商談・活動履歴の軽量 CRM | partner、trade quotation |
| プロジェクト収支 | 専門サービス pack の案件単位 | 汎用の案件原価集計（工数・経費・外注）と請求方式（時間/固定/マイルストーン） | industry-operations factory |
| 給与 | 2026 年月額甲欄・通常年調 | 賞与、乙欄、住民税特別徴収、退職精算、2027 年版の制度データ | [給与制度版](specs/payroll-rule-versions.md) |
| 多通貨 | JPY 固定 | 外貨建て請求・為替差損益（優先度は低いが、設計上の前提を文書化） | `currencyScale`、`currency` 列 |

## 5. 管理・運用・拡張性

| 領域 | 現状 | 候補 |
| --- | --- | --- |
| 権限（権限マトリクスは済: 2026-10-30、[access-insight](specs/access-insight.md)。実行時のカスタムロールは未実施） | ロールは module が宣言し、entity ごとに role×op を固定。実行時のカスタムロールなし | 権限マトリクス閲覧画面（誰が何をできるか）、ロールの雛形（経理・店長・従業員）、所属一覧の CSV |
| 監査（横断検索は済: 2026-10-30、[access-insight](specs/access-insight.md)） | レコード単位の監査パネルと管理操作の監査一覧 | 期間・利用者・entity・操作種別で横断検索する監査画面、設定変更の履歴 |
| 外部システム用資格情報（済: 2026-10-30、[machine-credentials](specs/machine-credentials.md)） | 人の JWT と機器用資格情報のみ。API キー/サービスアカウントなし | 期限・権限範囲付きの機械用トークン（MCP/連携用）、失効、監査。ADR-0023 の機械認可の考え方を一般化 |
| 業務イベントの配送（済: 2026-10-30、[event-delivery](specs/event-delivery.md)） | transactional outbox はあるが業務 module の購読者は 0。メール配送は認証用に限定 | 汎用の配送 worker（メール・Webhook・ブラウザ通知）、再試行と失敗の可視化、2-3 の受信箱と接続 |
| 運用 | バックアップ・復元は CLI、監視は導入先 | 管理画面でのバックアップ状態・移行状態・outbox 滞留の表示、1-4 と統合 |
| 個人情報 | 従業員・本人条件の列マスクはある | 退職者データの保持期間と匿名化、アクセスログの本人開示 |

## 6. 優先順位の提案

価値（利用者に起きる問題の大きさ）× 実装コスト × 既存の足場の有無で並べた。第 0 波で検証基盤と画面の土台を整え、第 1 波は「導入の壁」を下げ、第 2 波は「毎日の画面」を速くし、第 3 波以降で機能の穴を埋める。作業単位と順序は [完成度向上の実装計画](completion-plan.md) が正本。

| 波 | 候補 | 主な理由 | 依存・注意 |
| --- | --- | --- | --- |
| 0 | 3 段階の回帰テスト（[仕様](specs/test-tiers.md)）、3-1 UI キットと意味トークン、3-5 アクセシビリティ自動検査 | 以後の全作業を速く安全にし、全画面に効く土台を先に置く | 汎用画面から置き換える |
| 1 | 1-2 会社の追加・編集、1-3 設定画面の再構成、1-1 セットアップウィザード | 現状は CLI なしに 2 社目を作れず、初期設定の順序も分からない。既存 action の組合せで作れる | SettingDef のラベル拡張に短い ADR |
| 1 | 1-5 マスタ・期首残高 CSV 取込 | 実データで試す最初の関門。15 業界のサンプルより先に必要 | dry run、Decimal、Repository 経由 |
| 1 | 1-4 導入チェック | 設定漏れを運用前に見つける。ウィザードの完了判定を共用 | `setup inspect` の Web 化 |
| 2 | 2-1 一覧の絞り込み・保存ビュー・CSV・一括操作 | 毎日の操作回数を直接減らす。API は既にある | 列マスクと再認可を維持 |
| 2 | 2-3 受信箱、2-5 月次締めガイド | 承認漏れ・締め漏れを防ぐ。既存の集計で作れる | 新しい閲覧経路にしない |
| 2 | 3-2 ナビゲーション補助、3-3 フォームの操作性、3-4 状態表示と文言 | 毎日の画面の手数と迷いを減らす | UI キットの上に載せる |
| 2 | 2-2 複製・関連伝票・クイック操作、2-6 帳票 | 伝票 1 件あたりの手数と紙の運用を減らす | 帳票テンプレートの会社別設定 |
| 3 | 固定資産、定期仕訳、資金繰り、証憑横断検索、経費精算の一般化 | 中小企業の月次・決算で必ず要る | spec ごとに一次資料と出典 |
| 3 | 5 章の業務イベント配送と API キー | 受信箱の通知化と外部連携の前提 | 配送の冪等性、失効 |
| 4 | ロット・単位換算・FIFO、CRM、プロジェクト収支、JP PINT、多通貨、給与の賞与/乙欄/住民税 | 価値は業種・規模に依存するので、要望のある pack から | それぞれ独立した仕様と受入環境 |

## 7. 進め方の注意

- ウィザード・受信箱・締めガイドは「既存 action の呼び出し順を案内する画面」に徹し、`Repository` と `Context` を迂回する近道を作らない。画面で隠すだけの権限制御にしない。
- 設定の細目ラベル、一覧の保存ビュー、印刷テンプレートの共通規約など DSL/registry の拡張は、`kernel/` に実装して ADR を書く（規約1）。
- CSV 取込・一括操作は 1 行ずつ結果を返し、部分成功を明示する。確定済み伝票の直接更新は行わない（規約4）。
- 日本の制度（固定資産の償却、返還請求書、住民税など）は `docs/domain/` に出典と確認日を置き、値は期間付きデータにする（規約10）。
- 各候補は spec の EARS 受入基準と検証手順を先に書き、実装後の log で「何をどう検証したか」を残す（規約9・11）。UI 変更はブラウザ試験（390px を含む）を既存の E2E に追加する。
- 文書は [文書の管理方法](architecture/documentation-contract.md) に従い、採用した候補は STATUS と PLAN に移し、この一覧からは削除する。

## 8. 実装で残った判断待ち（2026-10-30）

これまでの実装で、仕様の範囲外として決めずに残した点。詳細は各 spec の未決事項にある。

| 項目 | 判断待ちの点 | 出典 |
| --- | --- | --- |
| 設定画面 | `settings` ロールに勘定科目・倉庫の読取を与えてコード選択を使えるようにするか。`packs.applied` などの記録用設定に読取専用の表示属性を足すか。pack の設定を pack ごとのタブに分けるか | [settings-console](specs/settings-console.md) |
| CSV 取込 | MCP に取込を出し続けるか（現状は dry-run を先に行うよう案内）。追加項目（ext）の取込、空欄で値を消す指定、kernel の検証文言の日本語化 | [csv-import](specs/csv-import.md) |
| 一覧 | 一括取消で訂正日を指定できるようにするか。CSV に id・コード列を出すか（取込との往復用）。出力の監査を見る画面（F3 で扱う想定） | [list-workbench](specs/list-workbench.md) |
| 複製 | 今日を既定とする日付以外を空にする規則でよいか。`<x>Entity`/`<x>Id` の関連規約を ADR にするか | [document-links](specs/document-links.md) |
| 締めガイド | 注意項目（未消込・未照合）を会社設定で阻止項目にするか。`accounting.close_period` 自体が阻止項目の残りを拒否するか。在庫期間の締めと未転記の原資料を項目に足すか | [close-guide](specs/close-guide.md) |
| 受信箱 | 大きな会社での応答時間（未計測）。役割別ホーム（C6）での置き場所 | [inbox](specs/inbox.md) |
| ナビゲーション | 個人データの台帳を名前の接頭辞で判定する規則を DSL の属性にするか（ADR 要）。「最近」の消去操作、サイドバーでの位置 | [navigation-assist](specs/navigation-assist.md) |
| アクセシビリティ | moderate / minor の違反をいつ失敗にするか。ダイアログ・390px のメニュー・明細ありの伝票など操作後の状態を検査するか。axe の判定保留（グラデーション上の文字など）の目視確認 | [e2e-a11y](specs/e2e-a11y.md) |
| DB 試験 | 試験 DB ごとに約 0.7 GB のテンプレート（上限 80）を許容するか。in-place 再作成の経路でも名前に `test` を要求するか | [db-test-startup](specs/db-test-startup.md) |
| 会社管理 | 作成時に業界テンプレートを選ばせるか（現状は作成後にテンプレート画面、B4 で案内）。新会社にもサンプルの取引先・品目を入れるか（現状は setup の最初の会社と同じ）。作成後に自動で切り替えるか（現状は切替ボタン） | [company-admin](specs/company-admin.md) |
| 導入チェック | 会計期間の先読み 30 日を会社設定にするか。バックアップ最終時刻を確認するか（setup が時刻だけのファイルを書く案）。settings ロールだけの利用者に会計期間・在庫の項目をどう見せるか（現状は「権限なし」の注意）。`system.migrations` が要求経路で owner 接続を使う例外を app role への SELECT 付与で置き換えるか | [setup-health](specs/setup-health.md) |
| フォーム | 狭い画面のタブ（計画時の spec は目次）と `Ctrl+Enter` の新しい意味でよいか。行削除のショートカットを置くなら衝突しないキーを決める | [form-ergonomics](specs/form-ergonomics.md) |
| 期首残高 | 経理だけの利用者に売掛金・買掛金・在庫の取込を許すか（現状は不可。管理者が行うか一時的に役割を足す）。売掛・買掛の 1 ファイル 200 行でよいか（請求書 1 件約 0.15 秒の転記を速くすれば上げられる）。締めガイドに期首残高仮勘定の残高の検査を、申告の科目対応に 3900 を足すか。導入チェックに仮勘定の残高を警告として出すか（`accounting.opening_balance_status` で読める）。小売パックの最初の月次締めで期首の在庫額を前回の締めとみなすか | [opening-balances](specs/opening-balances.md) |
| 定期仕訳 | 1 回ごとの再生成・飛ばし、締めガイドの未生成の期日、複数行の按分、洗替（翌月の戻し）を足すか（いずれも現状は無し）。期日での自動生成を F1 の worker から `generateRecurring` を呼ぶ形にするか。消費税法基本通達 11-3-1 などの本文は未確認 | [recurring-journals](specs/recurring-journals.md) |
| 証憑の検索 | **証憑の行・履歴・ダウンロードをリンク先の記録の読取規則に従わせるか**（現状は従わない。閉じるには kernel の行規則の拡張と ADR が要る。F3 と関係）。ダウンロードを監査するか（推奨は F3 で扱う）。一括 50 件・100 MB の上限がスマートフォンで妥当か（実機は未計測）。既存の添付の出力から `storageKey` を隠すか、取引先の自由記述欄を足すか、導入チェックに 3 項目の欠けた証憑の件数を出すか | [evidence-search](specs/evidence-search.md) |
| 役割別ホーム | chain_staff に店舗の表示を、管理者だけの利用者に経理の表示を出すか。人事・給与・営業の表示を足すか（いずれも現状は無し）。大きな会社でのホームの読取量（キャッシュや要約の読取。ADR 要） | [role-home](specs/role-home.md) |
| セットアップウィザード | ホームのカードを「表示しない」操作を置くか（現状は理由付きのスキップ）。勤怠・給与の段階を使う会社だけに出すか。`packs.applied` にも `managedBy` を付けるか。設定の PUT に版の検査を足すか。seed が作る暦年の会計年度を決算月に合わせて置き換える手段（短い初年度など）。確認だけの段階を確認するまで未完了にするか。期首残高の取込（B6）への導線と「通常の入出庫より先に期首在庫を取り込む」案内を足すか（現状はスコープ外）。店舗・拠点に限った admin では `/meta/setup-status` が 403 でカードが出ない（spec の想定）。`/setup` を共通の axe 検査の画面一覧に入れるか | [setup-wizard](specs/setup-wizard.md) |
| 帳票 | 領収書の記載事項と印紙税の注意（国税庁の一次資料を確認してから）。給与明細の法定の文言。売上請求書も `print_layout.date_style` に従うか。合計請求書の前回請求額・入金額・繰越（期首残高を含む）。API の言語が画面の言語ではなくブラウザの Accept-Language に従う点（全体の課題） | [print-templates](specs/print-templates.md) |
| pack 雛形 | ルートに `pnpm pack:new` を足すか。ext の対象を取引先以外にも広げるか。第三者が雛形から完走した記録（未実施） | [pack-scaffold](specs/pack-scaffold.md) |
| API キー | 利用者の直接作成とテナント管理者の付与にも step-up を求めるか。多要素認証の無い最小構成でキーの発行を許すか。キーをパスワード変更・全セッション失効でも残すか、キーごとの要求回数の上限、期限の通知（現状は一覧の「残り N 日」だけ） | [machine-credentials](specs/machine-credentials.md) |
| 業務イベントの配送 | worker を既定 off のままにするか、再試行の回数と間隔（8 回・約 2 時間）、署名鍵の暗号鍵を本人確認と共有してよいか、独自の署名形式でよいか、配送済みの保持 30 日、受信箱のメールを増えたときだけにするか、settings ロールが送信先を編集できる範囲、個人情報を載せる場合の第三者提供の法的整理。CLAUDE.md 規約 2 に配送 worker の systemParams 利用を明記するか | [event-delivery](specs/event-delivery.md) |
| 権限マトリクス・監査の検索 | MCP の検索ツール、会社をまたぐ検索、検索結果の CSV、利用者ごとの実効権限、`audit_log_at_idx` の削除、settings ロールに検索を許すか、レポートの CSV 出力の監査。監査の行に API キーの名前を出すか（テナント管理者だけが鍵を読めるため権限の設計が要る） | [access-insight](specs/access-insight.md) |
| 資金繰り表 | CSV が現状のロールでは管理者だけ（経理に請求書・契約の export が無い）。給与の支払の仕訳が支払日以前に転記されると二重に数える点（給与と仕訳の結び付けが要る）。経費精算・固定資産・定期仕訳の資金への影響を足すか。共通の axe 検査の画面一覧に入れるか | [cash-forecast](specs/cash-forecast.md) |
| 経費精算 | 帳簿のみ保存・少額特例・経過措置の書類・仕入税額控除の時期の一次資料での確認（国税庁・e-Gov に接続できる環境で）。従業員と取引先の対応、経費区分と科目の対応、従業員からの仮払申請、法人カードの引落し、領収書の税額との 1 円差、証憑の読取規則を精算書の読取に合わせるか、取り消した相手科目付き入出金の訂正を元で拒否するか（kernel の before_amend が要る） | [expense-settlement](specs/expense-settlement.md) |
| 固定資産 | **率表・備忘価額・償却方法の制限・円未満切捨てを一次資料で照合するために国税庁・e-Gov への接続を許すか、会社ごとの確認記録で運用するか**。500 件を超える償却、台帳と帳簿の照合レポート、少額資産・特別償却、締めガイドの項目、除却年の償却の任意化、資産の課税売上の表し方 | [fixed-assets](specs/fixed-assets.md) |
| 型検査の範囲 | ルートの `pnpm typecheck` は module の試験ファイルを含まない。module の tsconfig で検査すると試験ファイルに型の誤りがある（2026-10-30 時点で sales 1・purchase 1・accounting 1・trade 2・banking 3。実行時の試験は成功）。gate に含めるか、誤りを直すか | 第6波の統合時の確認 |
| gate:light | 目標 6 分を負荷平均が CPU 数以下のときの値と読むか、見直すか。full の DB も分割するか（現状は CI と同じ直列）。shard DB が主試験 DB とテンプレートを共有するか。8 CPU 以上での既定の分割数 | [light-tier-speed](specs/light-tier-speed.md) |
