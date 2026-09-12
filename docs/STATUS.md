# 現在地（2026-09-13 エッジサービス導入）

公開先は [adokoy001/DaifukuERP](https://github.com/adokoy001/DaifukuERP)、ライセンスはMIT。会計・商取引・在庫・契約、会社/店舗運営とBIに加え、従業員基盤と15業界のテンプレートを実装しました。ソース公開と業務アプリのインターネット配信は別に扱います。

## 店舗機器とクラウド/オンプレ共通配備

[エッジサービス仕様](specs/edge-installers.md)により、Windows/Linux/macOSのサービス導入・更新・登録解除、Node同梱の5対象配布物、OS別の排他/秘密ファイル保護、未登録時の待機を追加しています。[操作](manual/edge-service-setup.md)と[構造](architecture/edge-services.md)を入口にしてください。実OSサービスCIの受入結果は[作業記録](log/2026-09-13-edge-installers.md)へ記録します。

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

医療/介護の制度請求、製造BOM/原価、予約・配車の全面自動化、受発注/分納、ロット/シリアル、多通貨、汎用業務イベントの外部配送worker、実運用負荷・導入先ネットワークでのTLS受入は次の独立仕様です。合成データによる同一origin/別origin TLS配備試験は前回の受入記録に含みます。今回のメール配送CLIは認証用outboxに限定します。

MIT/第三者帰属、起動設定、公開範囲は [公開準備記録](log/2026-09-12-public-release.md) と [SECURITY](../SECURITY.md) を引き継ぎます。元の私的な開発履歴は公開せず、精査したソースから公開履歴を作ります。
