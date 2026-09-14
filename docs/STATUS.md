# 現在地（2026-09-14 追加レビューへの対応）

公開先は [adokoy001/DaifukuERP](https://github.com/adokoy001/DaifukuERP)、ライセンスはMIT。会計・商取引・在庫・契約、会社/店舗運営とBIに加え、従業員基盤と15業界のテンプレートを実装しました。ソース公開と業務アプリのインターネット配信は別に扱います。

## 配信保護と転記処理の仕上げ

[仕上げ仕様](specs/release-finishing.md)では、cloud/onpremのCaddy生成へCSPと関連ヘッダーを追加し、印刷のinline handlerを外部scriptへ移した。仕訳転記の勘定分類をフェーズごとにまとめて読み、明細の権限・参照整合性・更新・監査を保つ。20明細の実SQLは338→320回、書込48回は同じであり、全ての行処理を定数回にしたわけではない。setupの上限を認証契約の200文字へ揃え、DB更新前の拒否を確認した。実NULを含むソース2件は実行時の文字列を保つ明示エスケープへ直した。

検証方法と残る受入は [作業記録](log/2026-09-14-release-finishing.md) と対象PRのChecksを参照する。配備済みCaddyやAWSの試用DBはこの変更では更新しない。初めて試す領域を本部・店舗・従業員業務としてREADMEに示し、多業種へ拡張する目的は維持する。第三者が新規pack追加を手順だけで完走した実績はまだなく、[引継ぎ記録の条件](architecture/extension-guide.md#引継ぎを確認する記録)を明記した。

## 認証・検索・配布の補強

[追加レビュー仕様](specs/review-hardening.md)に基づき、非同期scryptと旧形式の互換移行、計算負荷の上限、JANの宣言的な完全一致索引、分析画面の重要な非同期操作の回帰試験、[ビルド済みAPI](architecture/compiled-api.md)を追加した。索引はRLSを維持した実行計画を確認し、内部計算列とスコープ付きB-treeを採用する。[0016の導入条件](adr/0026-ext-equality-indexes.md)と[新ハッシュの復旧条件](operations/enterprise-identity.md)を更新手順と合わせて確認する。

Cookie認証への切替は未実装で、別タブのアカウント・会社・未保存入力を保つ[移行方針](adr/0025-browser-session-migration.md)を記録した。検証状況は[作業記録](log/2026-09-14-review-hardening.md)を参照する。ソースへの実装とAWS試用環境への反映は区別し、この追加レビュー対応ではAWSを更新しない。

## ソースの可読性と給与制度版

[一貫性調整](specs/source-consistency.md)では個別の変数宣言をlintで保ち、基盤5列をnative booleanへ移行する。エラー規約は業務の構造化エラーと内部の定義ミスを区別し、文書状態を名前付き定数へ揃え、非自明な処理には短い責務ヘッダを使う。既存データを保持する0017の更新条件は [setup](operations/setup.md#基盤のboolean移行)、検証範囲は [作業記録](log/2026-09-14-source-consistency.md)と対象PRのChecksを参照する。AWSへの反映はこのソース変更に含めない。

[整形仕様](specs/readable-source.md) に沿い、Prettierを120文字目安で導入した。ファイル1,000行・関数300行は警告とし、行数だけのための分割や圧縮を求めない。純整形を別コミットにし、blameの除外履歴を残した。全gate・ブラウザー69件の成功と長行の実測は [整形記録](log/2026-09-13-readable-source.md) に、公開CIの成功は [PR #11](https://github.com/adokoy001/DaifukuERP/pull/11) に記録した。

[給与制度版仕様](specs/payroll-rule-versions.md) は、期間付きJSONと国別算定器、会社別の出典確認・導入、旧記録を保つ追加migrationを実装し、統合受入を完了した。月次の支払日・保険月・賃金締日と年調実施日を区別し、未対応年度を前年で代用しない。全gate（単体1,003件・DB668件・配備13件）、通常ブラウザー72件と追加障害ケース1件が成功した。旧実装の12表45行からの更新・別DB復元と旧下書き3件の確定、CSVの完全一致も確認した。詳しい範囲と検証状況は [給与制度版の記録](log/2026-09-13-payroll-rule-versions.md)、[設計](architecture/payroll-automation.md)、[操作](manual/appendix-i-fiscal-and-work-systems.md) にまとめる。収録済みの法定値は2026年の既存対応範囲に限る。

## AWS の独立試用

[専用 CloudFormation](../deploy/aws/README.md) と [運用手順](operations/aws-trial.md) を追加しました。同一AWS account内で、既存ゲームとVPC・EC2・DB・IAM・保存先を分け、未使用FQDNへ公開しています。共有するのはaccountとDNS zoneであり、別account相当の分離ではありません。実接続先・秘密・AWSの生出力は私有領域で管理します。

公開済み `69e5846` の固定bundleをNode22/PostgreSQL16/Caddyへ導入し、公開HTTPS、ブラウザ15項目、再起動後13項目、保存した取引先と添付の再取得、S3保全と別DBへの131表の復元照合を確認しました。通常gateは単体819件・DB639件・配備13件が通過。範囲と制約は [実測記録](log/2026-09-13-aws-trial.md) を参照してください。

単一ホストの試用構成です。日次backupと7日後の一回停止を設定しましたが、期限の発火・全行値比較・別ホストへの完全復旧・HA/負荷試験・実外部サービス接続は未実施です。シフト画面のヒーロー部分に低コントラストが残ることも実測記録へ分けて記載しています。

## 商流・銀行・申告準備（前回の統合受入）

[統合仕様](specs/commerce-finance.md) に沿って3つのmodule、専用Web画面、国内の出力profileを追加しています。移行 `0014_commerce_finance.sql` は19表の追加です。`l10n/jp` は既存固定版の `iconv-lite` を直接依存にも指定しました。構造は [commerce-finance](architecture/commerce-finance.md)、操作は [付録L](manual/appendix-l-commerce-bank-filing.md) が入口です。

| 分野 | 実装した範囲 | 含まないもの |
| --- | --- | --- |
| 商流 | JPY物品の見積・受発注、分納・分割請求、明細残数、在庫/請求の重複防止、原資料と一体の取消 | 役務・多通貨・単位換算・返品専用工程、入荷時の未請求債務、原価差額配賦 |
| 銀行 | 指定UTF-8 CSVの事前確認と取込、照合候補、確認消込/解除、確認済み振込バッチのCSV/全銀120バイト出力 | 実銀行API、資金移動、自動確定消込、銀行側の受理/実行/取消 |
| 申告準備 | 締め済み税抜帳簿の一般商工業HOT010 Ver.3.0 BS/PL、2026年給与の独自確認資料、別担当確認と根拠再検査 | 法人税申告書全体、法定納付税額、給与の公式375/eLTAX出力、電子申告/納税 |

全gate（単体793件・DB623件・配備8件・型/Lint/依存境界・文書リンク）、通常ブラウザー55件と追加競合3件、認証専用3件、API/Web型検査、Web build、既存データを保つ0014移行と導入/更新/復元が成功しました。測定範囲は [作業記録](log/2026-09-13-commerce-finance.md) を参照してください。実銀行およびe-Tax/eLTAX実環境への取込・送信は未検証です。

## 業務条件と検証根拠

[仕様](specs/practical-verification.md)に基づき、商流/銀行/申告の生成操作列、他社/権限外拠点データとの比較、独立したシフト全探索、Decimal/会計の整数参照、対象を限定したmutation、エッジのTLA+有限モデルと実装トレースを追加しました。[13条件の台帳](verification/invariants.md)が前提・試験・失効契機を結び、通常gateで参照切れを検査します。[設計と再現方法](architecture/practical-verification.md)、[実測記録](log/2026-09-13-practical-verification.md)が入口です。

製品の業務契約やUIは変更せず、検査で見逃す条件を補強しています。生成・有限探索の範囲を超えた制度適合や実機のexactly-onceは主張しません。mutationとTLCは別CIで実行し、起動失敗や意図と異なる反例を成功として扱いません。

今回のローカルgateは単体819件・DB639件・配布補助8件と型/lint/依存境界/文書検査が成功。147変異をすべて実テスト失敗で検出し、TLCは512,373状態と全14チェックが成功しました。API/Web型検査とWeb/edge buildも通過しています。対象commitのCIと、既存依存のmoderate 1件の利用経路・再確認条件は[作業記録](log/2026-09-13-practical-verification.md)を参照してください。

## 店舗機器とクラウド/オンプレ共通配備

[エッジサービス仕様](specs/edge-installers.md)により、Windows/Linux/macOSのサービス導入・更新・登録解除、Node同梱の5対象配布物、OS別の排他/秘密ファイル保護、未登録時の待機を追加しました。Windows x64、Linux x64/arm64、macOS Intel/Apple Siliconの5環境で実サービスの導入・停止/開始・更新・登録解除が成功しています。[操作](manual/edge-service-setup.md)と[構造](architecture/edge-services.md)を入口にしてください。測定範囲とCIの証拠は[作業記録](log/2026-09-13-edge-installers.md)に記録しています。

[統合仕様](specs/deployment-edge.md) に基づき、同じ版付きLinux配布物とCaddy/systemd参照構成、店舗LANから外向きに接続する中継agentを追加しました。WSSは仕事の存在だけを通知し、本体・結果・状態はHTTPSで取得/報告します。店舗側の受信port開放は不要ですが、ERPのHTTPS入口への到達経路は必要です。

会社/拠点に限定した機器資格情報、MFAを含む接続コード発行・失効、冪等な依頼、lease、耐久journal、開始後に結果不明となった処理の手動解決を実装しています。初版のadapterはIPPテキスト印刷/状態照会と明示された模擬機器です。実釣銭機のvendor protocol、実機適合、業務伝票への自動転記、導入先の本番ネットワーク・機器を含むservice運用は別途受入します。OSサービスそのものの導入試験は今回の5対象CIへ追加しています。

全gate（型/Lint/依存境界、単体635件、DB589件、配布補助5件、文書リンク）成功後、最終レビュー後の全単体640件・配布補助8件と画面権限再取得も確認しました。通常ブラウザー45件、追加の役割/店舗変更2件、認証専用3件、0008→0013更新と別DB復元、同一候補bundleの2つのTLS profileを検証済みです。最終集計と限定事項は [作業記録](log/2026-09-12-deployment-edge.md) に記載しています。

操作は [店舗機器マニュアル](manual/appendix-j-store-devices.md)、設置は [共通配備](operations/deployment.md) と [中継agent](operations/edge-agent.md)、設計は [ADR-0023](adr/0023-outbound-relay-principal-and-fencing.md) を参照してください。

## 企業運営拡張（前回の受入記録）

[統合仕様](specs/enterprise-operations.md) と [構造](architecture/enterprise-operations.md) に沿い、認証・メール、POS、連結精算、FC精算、給与税保険/年末調整、勤務制度を実装しています。全体の型/Lint/依存境界、単体592件・DB568件、文書リンクが成功しました。通常ブラウザー42件と専用認証2件、既存データを保つ移行、0008から0012への更新・別DB実復元・失敗再開も成功しています。検証方法と対象外は [作業記録](log/2026-09-12-enterprise-operations.md) に記載しています。

| 分野 | 実装した範囲 | 主な対象外 |
| --- | --- | --- |
| 認証 | 静的OIDCの本人紐付け、TOTPと単回回復コード、step-up、招待/再設定とTLS SMTP outbox | 自動JIT、SSO-only、全員MFA強制、全回復手段紛失時の管理復旧 |
| POS | Square署名通知、merchant/location確認、決済/返金の仮勘定仕訳、重複/逆順/失敗再試行/取消 | 商品・税率・在庫推定、未受信イベントのpolling、実加盟店受入 |
| 連結 | 同一tenant/JPYの管理用精算表、全会社の再認可、完全mapping、説明付き消去・調整、最新締め済み資料で確定 | 法定開示、支配判定、資本連結/持分法/のれん/税効果/外貨 |
| FC | 期間付き契約、確認売上、Decimal料率+定額、既存請求/入出金と一体の取消 | 月途中按分、相手会社への両側記帳、全オープンアカウント相殺 |
| 給与・年調 | 2026年月額甲欄、確認済み本人条件の税/保険算定、2026年調申告・受理・算定・確定・精算記録 | 賞与/乙欄/非居住者、住民税賦課、行政・銀行送信、特殊な年途中年調 |
| 勤務制度 | 通常、暦月1か月変形、1〜3暦月フレックス、開始前所定と合意確認、給与/シフトへの適用 | 1年変形/裁量/44時間特例、途中入退社・制度移行、日跨ぎ給与、不足賃金の推定控除 |

認証の暗号・試行制限・既存API/MCP・配送の回帰を全gateで確認しました。合成IdP・検証付きTLS SMTPからの実配送を含む専用ブラウザー2件、390pxの本人設定、専用runnerの外部URL/非空DB拒否、起動/正常終了/中断時の子・孫process停止も確認しています。Entra/Google実アカウント、Square実加盟店、実SMTP事業者への本番接続は未検証です。

操作は [認証・POS・連結・FC](manual/appendix-h-enterprise-operations.md) と [給与・年調・勤務制度](manual/appendix-i-fiscal-and-work-systems.md)、環境設定は [認証とメール](operations/enterprise-identity.md) を参照してください。

## 社員管理・シフト推薦

[社員・シフト仕様](specs/employee-shift-planner.md) に基づき、社員の検索・勤務条件/スキル、スマホの週次希望、拠点別の必要人数、ブラウザー内推薦、手修正・固定、欠員説明、下書き・確認公開・改訂/取消を追加しました。[操作ガイド](operations/shift-planning.md) と [アーキテクチャ](architecture/shift-planning.md)、[ADR-0020](adr/0020-browser-shift-planning.md) を入口にしてください。

推薦はseed付き貪欲初期解と焼きなまし法をWeb Workerで実行し、サーバーでも最新資料と同じ制約を再検査します。1拠点100人・月曜7日・42枠の上限があり、夜勤/拠点応援/需要予測は対象外です。移行`0011_auto.sql`は4表の追加で、通常更新の行ロックを見直し、社員/拠点更新と公開のdeadlockを解消しました。外部ライブラリの追加はなく、API試験向けの既存workspace型依存のみ明示しました。

## 品質改善

[品質改善仕様](specs/quality-foundation.md) に基づき、本人パスワード変更/全端末ログアウト、API/MCPのエラー秘匿、参照候補の誤選択防止、一時的な再取得失敗時の入力保持、日跨ぎ勤務/全日有給の整合性、履歴を失う異動の拒否、日時/複合範囲検索を改善しました。操作は [本人設定](operations/account-security.md)、今後の優先順位は [品質改善計画](quality-roadmap.md) にまとめています。スキーマと依存ライブラリの変更はありません。

## 従業員基盤・15業界

- [AI_INDEX](../AI_INDEX.md) と [アーキテクチャ](architecture/README.md): プログラム構成、データ処理、権限、拡張、移行/検証、文書管理をMarkdownで共有。
- 従業員・拠点・会社の分担: サーバー時刻の打刻、訂正、勤怠承認、有給付与/申請/残数/取消、経費/領収書/精算、給与の計算/確定/取消と本人明細。
- スマホ本人画面 `/me` と本部/拠点画面 `/workforce`。現行所属に基づくREST/MCP/集計/証憑の境界、自己承認拒否、原資料と確定期間の保護。
- 15業界: 小売、不動産賃貸、電器店、農家、飲食チェーン、卸売、製造、建設、物流、宿泊、診療所、介護、教育、専門サービス、美容。追加10業界の固有項目と完了条件、開始/完了/請求/入金/取消の業務台本を含む。
- `0010_workforce_platform.sql`: 24業務表と会社所属site_idsを追加し、既存表・列を保持。

## 既存公開版の検証履歴

社員・シフト追加の全gateは単体521件（Web153件を含む）・DB504件、型/Lint/依存境界・文書リンクすべて成功。Web型/build、ブラウザー37件、旧0010の社員/勤怠/有給保持と0011追加、setupでの0008→0011更新・別DB復元・失敗再開も成功しました。[シフトの作業記録](log/2026-09-12-employee-shift-planner.md) に再現方法と測定を記載しています。GitHub上の実行状況は下記Actionsで確認します。


前回の品質改善で実施した `pnpm gate` は型・Lint/依存境界、単体480件（Web141件を含む）、DB480件、主要文書リンクがすべて通過しました。Web型/build、既存を含むブラウザー32件、導入/旧版0008から0010への更新/別DB実復元/失敗再開も成功しています。追加の回帰は単体12件・DB33件・ブラウザー11件です。詳細は [品質改善の作業記録](log/2026-09-12-quality-foundation.md) を参照してください。従業員基盤の初回検証は [前回記録](log/2026-09-12-workforce-platform.md) に残しています。

初回MIT公開は `61d064d8fe92` で完了し、[初回CI全3ジョブ](https://github.com/adokoy001/DaifukuERP/actions/runs/34677925318) が成功しました。以後はこの公開履歴を基にPRで改修します。現在の公開先は [main](https://github.com/adokoy001/DaifukuERP/tree/main)、対象commitの結果は [Actions](https://github.com/adokoy001/DaifukuERP/actions) で確認します。GitHubの非公開脆弱性報告も有効化済みです。


## 導入・開発の入口

導入は [README](../README.md)、変更と試験は [CONTRIBUTING](../CONTRIBUTING.md)、再開は [HANDOFF](HANDOFF.md) を使います。操作は [従業員/スマホ](manual/appendix-f-workforce.md)、[15業界](manual/appendix-g-industry-catalog.md)、[運営/権限/BI](manual/appendix-e-operations-control.md)、管理対象への導入は [安全なセットアップ](operations/setup.md) を参照してください。

## 現在の対象と次の課題

現在追加した企業機能の対象は上表と各仕様に限定します。従来の外部確認控除方式も残り、自動税保険算定済みの給与とは区別します。年休資格や年5日取得義務を残高だけで認定せず、過去の事実を現在値で埋めません。有給付与履歴や有効な確定明細を持つ従業員の拠点異動は、履歴の整合を守るため引き続き拒否します。

医療/介護の制度請求、製造BOM/原価、予約・配車の全面自動化、ロット/シリアル、多通貨、汎用業務イベントの外部配送worker、実運用負荷・導入先ネットワークでのTLS受入は次の独立仕様です。受発注/分納は上記の商流仕様の範囲で実装済みです。合成データによる同一origin/別origin TLS配備試験は前回の受入記録に含みます。今回のメール配送CLIは認証用outboxに限定します。

MIT/第三者帰属、起動設定、公開範囲は [公開準備記録](log/2026-09-12-public-release.md) と [SECURITY](../SECURITY.md) を引き継ぎます。元の私的な開発履歴は公開せず、精査したソースから公開履歴を作ります。
