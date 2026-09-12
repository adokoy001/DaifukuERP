# 作業記録: 2026-09-12 クラウド/オンプレ配備と店舗機器

- 対象: [統合仕様](../specs/deployment-edge.md)。基点: 公開main `af365a3`、branch `feat/deployment-edge`。
- 認証/業務/通知、店舗agent、共通配布を分担し、Web・移行・公開と統合した。公開mainから独立worktreeと専用PostgreSQL16 clusterを作成し、元の私的なアプリや利用者DBを変更しない。
- 計測: tokens=null、agent_minutes=null、human_minutes=null、rework_lines=null。未計測値を推定しない。

## 実装と設計判断

同じLinux/Node22配布物を、クラウドVMの公開TLSとオンプレの組織所有FQDN/信頼CAへ配置する。Webは同一originの `/api` を使うため、配備先の変更で再ビルドしない。releaseはmanifestで内容・permission・linkを検査し、設定/DB/添付を分ける。計画は無変更で、実行も新しいprofile資材だけを生成し、OSのserviceやCaddyを自動設置しない。

店舗agentは外向きのWSS通知とHTTPS取得・報告を用いる。人間JWTを渡さず、kernelのrelay principalをtenant/company/gateway/siteへ固定する。接続中も資格情報を再検査し、汎用CRUD/MCPや人間roleへの昇格を拒否する。接続/入力/送信待ちを制限し、送信待ち4 KiB超過時もHTTPSのpollingで回復できる。

業務jobは冪等キーと入力hash、排他的claim、初回だけのstart許可、lease、耐久journalで制御する。開始後に物理結果が不明なら再投入せず、同一機器の後続を止めて根拠付き手動確認へ進む。IPP受付と印刷完了は分け、job-idが分かる場合は照会だけで回復する。物理exactly-onceは保証しない。釣銭は明示されたsimulatorのみで、実現金や会計伝票を操作しない。

画面 `/operations/devices` で中継/機器登録、MFA付きpairing、失効、依頼、取消、要確認解決を扱う。会社/拠点/role変更は15秒の再取得で反映し、参照失敗503なら入力を保持、権限喪失なら開いたformや接続コードを破棄する。機器情報は「最終観測時の報告」とし、観測日時と受信日時を分ける。

## 検証

全 `pnpm gate` は終了コード0。型・Lint・依存境界（1,031 modules / 5,110 dependencies、違反0）、単体84ファイル635件、DB97ファイル589件、配布補助5件、文書リンクが成功した。DB全体の実測は871.48秒。最終レビューでagentの観測時刻とWSS送信待ち上限を修正した後、追加5件を含む全単体85ファイル640件・型/Lint・該当実API回帰も成功した。最終の依存境界は1,033 modules / 5,118 dependencies、違反0。

- 通常ブラウザー45件すべて成功（業界3件と従来業務、新規店舗連携3件、10.1分）。続いてrole降格と担当店舗変更の2件を追加し、新規店舗連携5件をまとめて成功（1.3分）。通信応答喪失で実際のサーバー保存を起こしても再試行が同じUUID/本文になり、jobが1件だけであることを検証した。
- 専用空DB・合成OIDC/JWKS・検証付きTLS SMTPの認証ブラウザー3件成功（1.3分）。新しいMFA試験は不正パスワードからの回復、コード再発行、実relay pair、画面から失効して機器session401まで確認する。URL/localStorageに接続コードを残さない。
- 旧0012のMFA/session/会社/拠点を保つ移行試験、追加6表の強制RLS/外部会社FK/idempotent移行を確認した。生成した `0013_deployment_edge.sql` とsnapshotを保存した。
- 安全setup受入成功: 無変更計画、初期導入、意図的中断/再開、旧0008の実データを0013へ更新、別DBへの実復元、失敗migrationのrollback/再開、使用済み復元先の拒否。
- agentの実API/TLS/WSS/DB試験4件で、通知→HTTPS→模擬実行→結果、通知断のpolling、資格情報失効、start/完了応答喪失と再起動を確認。IPPは合成応答で受付/完了/不明と照会回復を検査し、実機適合とは区別した。
- 同じ候補bundleを実Caddy 2.11.4の2つのorigin/profileに配置し、テストCA検証付きTLS、SPA deep link、API prefix、転送元headerの置換、WSS Upgrade、接続中のsocketを含む停止と配布物不変を確認した。上流の合成HTTP/WS試験と、別の同梱実API起動/専用DB移行/health・ready200/SIGTERM成功を区別して記録した。
- API/Web/agentの個別型検査、Web production build、node_modulesなしで起動できるedge bundleを検証。外部依存を再解決せずfrozen graphを配布する。32 workspaceのfrozen installを確認した。
- マニュアル21章43画像を単一HTMLへ再生成した（6,151 KB）。新しい画面は390px日本語/1440px英語を実ブラウザーで確認した。生成HTMLも390pxで横はみ出し無し・全anchor有効を確認した。
- `pnpm audit --json`: high/critical 0、moderate 1。前版同様のdrizzle-kit経由esbuild0.18.20（GHSA-67mh-4wv8-2f99）が残る。serve機能の問題で、既存CLIの変換用途に対する非互換overrideは行わない。脆弱性ゼロとは表明しない。
- 公開前レビューでWeb binaryの帰属全文不足を発見し、main/workerの実入力、Tailwind CSS、既存FeatherのLICENSE/NOTICEを同梱するよう修正した。実Web buildと欠落拒否を含む配布補助試験は最終8件成功。API/DBの未使用依存はWeb通知へ混ぜず、内部入力一覧は相対pathだけで収集し最終releaseから除く。

## 発見と修正

- 公開の所属管理APIが新しいedge roleをsite限定として受理しなかった。公開role定義とworkforce_siteのread範囲を整え、fixtureで迂回せず画面試験で確認した。
- 状態event取得時の内部rowをstrict DTOへspreadして500になった。公開fieldの明示投影に修正し、結果報告後のboardを実APIで検証した。
- 7日以上古いevent、失効attemptや手動解決済みの完了報告が永続再送に残った。所属を確認したうえで限定理由の明示ACKを返し、agentはその理由だけを受理する。任意の409を成功扱いしない。
- 完了ACKが2日後に届くと観測日時が新しくなる。result保存時刻を維持し、同一process/再起動双方で修正前に失敗する回帰と実APIの時刻一致を確認した。
- pongを返しながら通知を消費しないsocketの送信容量が明示制限されていなかった。4 KiBと送信直前の再検査を追加し、非排出・非同期中の増加・正常通知を検証した。
- 画面の全体meta cacheが無期限で、管理者から操作担当への変更後もformやpairing情報が残り得た。中継画面固有の権限再取得と現在の可視行に結び付け、公開APIによる降格・店舗変更を実測した。
- 同梱runtimeがkernelの公開indexから使うdrizzle-kitを欠いていた。kernelの実行依存へ移し、pnpm deployによるsemver再解決を固定済みgraphコピーへ変更。全moduleの本番runtime起動を確認した。
- readinessを単なる疎通からowner/app実DB本人性・migration hash・私有添付領域へ強化した。cloud/onprem hostnameは認証のFQDN契約と一致させ、IP表現や.local等を拒否する。
- 個別API型検査で既存test helperのunknown payload/制御フローとPromise.withResolversが露呈した。Fastifyの入力型、named never function、ES2023互換Promiseへ修正した。Squareのserver導出列は明示したtest fixture型注釈とし、runtimeの期待値は変更しない。
- 全DB台本の登録module完全一致リストへ新しい `edge` を登録順どおり追加した。既存のseed・会計金額・税・残高検証をすべて維持している。

## 公開と残る境界

9つの新規外部packageはMITで、全体の帰属一覧とstandalone edge/Web bundleの実同梱依存通知を更新した。Node/OS/Caddy/PostgreSQL/util-linuxは同梱しない。秘密設定・資格情報・バックアップ・私的review資料を公開対象へ含めない。正式配布物は公開するclean commitから改めて生成・検証する。

物理クラウドVM、本番systemdのinstall/start、公開ACME/顧客CA、実店舗WAN/プリンター/釣銭機、USB/serial/vendor SDK、大規模負荷・HA・コンテナ運用は今回の受入外。ERP自体が閉じたNAT内の場合は店舗からのHTTPS経路が別途必要。その他機器はローカルdriverと能力契約を追加する拡張点を使い、クラウドから任意LAN宛先やコマンドを渡さない。
