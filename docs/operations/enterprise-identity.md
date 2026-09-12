# SSO・二段階認証・本人確認メール

実装契約は [認証仕様](../specs/enterprise-identity.md)、設計理由は [ADR-0022](../adr/0022-identity-challenges-and-delivery.md)、規格と判断根拠は [一次資料](../domain/identity-and-mail-sources.md) を参照してください。

## 導入設定

認証機能は追加設定がない既存環境でもパスワードで利用できます。MFA登録、招待、再設定、SSOには `IDENTITY_ENCRYPTION_KEY` と `PUBLIC_WEB_URL` が必要です。暗号鍵は暗号学的乱数32バイトの標準Base64表現です。秘密管理の仕組みで生成・保管し、ログやGitへ書かないでください。`PUBLIC_WEB_URL` は利用者がアクセスするHTTPSのoriginだけを設定します（例 `https://erp.example.com`）。URLのパス、query、fragment、資格情報は許可しません。

暗号鍵はTOTP秘密と未配信メールの暗号化に使います。DBバックアップと別の安全な場所で鍵もバックアップしてください。鍵を失うと既存認証アプリの検証や未配信メールの復号ができません。初版には複数鍵によるオンライン再暗号化がありません。無計画なキー差替えは行わず、復旧可能なバックアップと認証再登録を含む移行手順を用意してください。

## 組織SSO

`OIDC_PROVIDERS_JSON` に最大10件の静的接続先を設定します。各項目は `id`, `label`, `tenantId`, `issuer`, `clientId`, `clientSecret`, `authorizationEndpoint`, `tokenEndpoint`, `jwksUri` です。issuerはテナントに固有の値を使い、公開メタデータに記載されたendpointとJWKSを運用者が確認して設定します。利用者入力から接続先を追加したり、メールドメインから接続先を自動発見したりしません。

IdP側のredirect URIは `PUBLIC_WEB_URL/auth/oidc/callback` と完全一致させます。Webアプリ用のAuthorization Codeフローとクライアント秘密を設定し、RS256またはES256のID tokenを使ってください。Entraの場合は `/common` を許容するissuer指定ではなく、対象テナントに対応するissuerを指定します。Googleも実際のissuer、client ID、各endpointを公式資料で確認します。

利用者は初回にパスワードでログインし、「アカウント設定」→「組織アカウントを紐付け」で本人確認後にIdPへ移動します。メールアドレスの一致だけでは紐付け・利用者作成・管理者権限付与をしません。紐付け後も会社と業務権限は従来の所属設定が管理します。紐付け変更時は全端末のセッションが失効します。ローカルパスワードは本人確認・復旧用に残してください。SSOだけのアカウントや自動JIT登録は初版の対象外です。

API/IdP間の通信はHTTPS、静的URL、5秒timeout、128 KiB上限、redirect禁止です。HTTPのloopback許可は `NODE_ENV=test` の合成試験専用で、本番には設定しません。公開DNS名の解決先やネットワーク出口の制御は運用環境のegress設定でも管理してください。

## 認証アプリと回復

本人設定から現在のパスワードで再認証し、QRまたは手動キーを認証アプリに登録します。6桁コードを検証するとMFAが有効になり、全端末のセッションが失効します。回復コードは10件を一度だけ表示し、サーバーにはハッシュだけを保存します。別の安全な場所に保管してください。使用済みのコードは再利用できません。

MFA登録済みならパスワードログイン・SSOとも追加確認が必要です。設定変更の本人確認でもパスワードとTOTPまたは未使用回復コードを要求します。回復コード再発行、MFA解除、パスワード変更で既存セッションを失効させます。メールでのパスワード再設定だけではMFAを解除できません。認証アプリ・回復コードをすべて失った場合の本人確認と管理復旧手続き、テナント全員へのMFA強制ポリシーは初版に含まれません。現状のサポート境界を理解して段階導入してください。

MCPは `DAIFUKU_MFA_CODE`（その起動で一度だけ利用するTOTPまたは回復コード）と同じ `IDENTITY_ENCRYPTION_KEY` を使います。MFA登録済み利用者のパスワードだけのMCP起動は拒否されます。認証コードは履歴に残るコマンド引数へ書かず、保護された環境変数で渡してください。

## 招待・再設定とメール配送

管理者は利用者管理の「メールで招待」で本人確認をして招待します。受理前は非アクティブ・非管理者・会社未所属です。受信者が24時間以内にリンクから12〜200文字のパスワードを設定し、その後に管理者が会社と権限を割り当てます。元の未受理アカウントに限って同じメールアドレスで再招待でき、古いリンクは失効します。既存の有効なアカウントは再招待で置き換えられません。

パスワード再設定リンクは30分有効です。同じメールが複数テナントに存在する場合は組織IDを指定してください。受付結果は存在・不在・未配信状態で同じです。リンクは単回利用、パスワード更新時は全セッション失効、MFAは維持します。メール内のtokenはURL fragmentで渡し、Webは表示直後に履歴から除去します。

SMTPには `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE` を設定します。`SMTP_SECURE=true` は接続時TLS（既定465）、falseはSTARTTLS必須（既定587）です。証明書検証は無効にできません。APIはメールをトランザクション内の暗号化outboxへ登録し、直接送信しません。

配送は同じ保護設定を持つ環境で `pnpm --filter @daifuku/api mail:deliver` を明示的に実行します。スケジューラで繰り返し実行して配送待ちを処理してください。未設定の場合は未配信のまま終了コード2です。成功件数・失敗件数だけを表示し、宛先、本文、token、SMTP応答の原文はログへ出しません。招待画面の「配送待ち」は受信完了を意味しません。

workerは2分のlease、固定Message-ID、最大5回の指数間隔で再試行します。SMTPが受理直後に接続切断した場合は再試行で重複配送され得ます（at-least-once）。リンクは同じ単回tokenなので二重受理はできません。成功・期限切れ・試行上限では本文暗号文を削除し、配送状態を残します。通信timeoutはleaseより短い30秒です。エラーは `delivery_failed` / `expired` / `attempt_limit` に分類します。

## 合成検証

通常のDB/unit試験に加え `pnpm test:identity:e2e` が、専用API3109・Web5189・IdP3110と一時証明書のTLS SMTPを起動し、ブラウザからSSO、TOTP、回復コード、招待、再設定まで検証して終了時にプロセスを停止します。実利用者へのメール送信はしません。合成SMTPは `example.com` / `example.test` 宛だけを受理します。

事前に新しい空DBを用意し、`TEST_DATABASE_URL_OWNER`, `TEST_DATABASE_URL`, `E2E_IDENTITY_PREPARE=1` を設定します。許可名は `daifuku_ci_enterprise_e2e` または `daifuku_e2e_test_enterprise` と任意の英数suffix、接続先はloopbackだけです。ownerは当該DB所有者・BYPASSRLS、appは別の `daifuku_app` ロールでsuperuser/BYPASSRLSは禁止です。既存schema・tableがある場合は失敗し、削除・上書きしません。再実行には新しい空DBが必要です。Chromiumはlockfileに対応する `pnpm --filter @daifuku/web exec playwright install chromium`、一時試験証明書の生成にはOpenSSLが必要です。CIでは独立した4番目のjobがこれを実行します。runner は終了・SIGINT/SIGTERM で自分が開始した子サービスを停止し、ブラウザー宛先を `http://localhost:5189`、出力を `apps/web/test-results/identity` に固定します。

## 認証試行と発行の制限

パスワードログイン・step-up・本人パスワード変更は、本人ごとに5分窓で失敗10回までです。API の IP 側予算は目的別に失敗100回までとし、認証成功時はその1試行分だけ返却します。本人情報・会社一覧・公開 provider 一覧の GET は失敗予算を消費しません。共有 NAT の正しい連続ログインや画面の再取得だけで認証を止めない構成です。並行処理では検証中の試行も枠を予約し、失敗が別の成功によって消えることを防ぎます。

MFA は各 challenge の最大5試行に加え、テナントと本人で5分窓10失敗を共有します。新 challenge や MCP 接続を使っても本人側予算は共通です。拒否が続く場合は次の窓まで待ち、現在の認証器または未使用回復コードでやり直します。API と MCP のパスワード失敗予算も共通です。

配送・challenge 作成には別の発行予算があります。メール再設定申請は宛先/テナントで30分3回、IPで30分20回。招待は本人管理者で5分30回、テナント全体で5分100回。OIDC 開始は IP で5分300回です。これらは成功した申請も消費します。HTTP 429 は処理完了ではないため、繰り返し送信せず時間を空けてください。reverse proxy 配下の配備では接続元 IP の扱いも導入受入で確認します。アプリは任意の X-Forwarded-For を信頼していません。
