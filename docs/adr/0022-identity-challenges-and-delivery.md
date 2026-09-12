# ADR-0022: 認証challengeとメール配送の分離

日付: 2026-09-12。状態: accepted。仕様: [enterprise-identity](../specs/enterprise-identity.md)。

認証は tenant が未確定なログインから始まるため、既存 users/principal と同じ kernel-owned system table と専用認証portで扱う。業務entity/permissionを迂回する汎用portは作らない。challenge、MFA factor、OIDC link、mail outbox はtenant RLS付きで、user参照には複合tenant FKを使う。匿名lookup/rate limit/配送のowner接続は認証システム内部だけで利用し、業務moduleへ渡さない。

challengeは32 byte乱数のSHA256 hash、purpose、expiry、attempts、consumedAtを持つ。失敗attemptを先行commitし、検証失敗のrollbackで回数が戻らないようにする。成功時の消費、秘密/回復コード変更、sessionVersion、監査は一つのtransactionで保存する。user行とchallenge/factorの行ロックで二重利用を防ぐ。通常sessionは現在のuser/sessionVersion/MFAを再検証し、MFA challengeは通常JWTとして使えない。

TOTP秘密・OIDC transaction・メール宛先と本文は32 byte鍵によるAES-256-GCMで暗号化しtenant/user/purposeをAADへ入れる。回復コードとメールtokenはhashで照合する。外部署名の検証はjose、SMTPはnodemailerへ委譲し、署名algorithm/issuer/audience/期限/nonceを絞る。静的IdP endpoint以外へのdiscoveryやredirect追随をしない。emailをuser紐付けや権限の根拠にしない。

SMTP outboxは行claim/lease/attempt上限と指数的遅延を持ち、未設定は配信成功にならない。SMTP応答消失時はexactly-onceを保証できないので固定Message-IDと単回tokenを使う。配送成功または期限切れ時は暗号化本文を除去する。配送ログは分類だけに限定する。

SSO-only password除去、パスキー、SMS、IdP側のMFA claim信頼、テナント全員へのMFA強制は初版の範囲外。全利用者が個別にMFAを有効化でき、紛失時は回復コードを利用する。管理者も通常のMFA回復を使い、password resetで第二要素を消さない。

## 統合試験からの認証予算の修正

全認証 URL の共通 IP quota と成功ログインの累積で、同じ NAT の通常利用と反復ログインが遮断されることを再現した。読取 GET を試行から外し、失敗予算とメール/SSO開始/招待の発行予算を分離する。検証前に DB の条件付き upsert で枠を予約し、成功した予約の1件だけを同じ windowStart の行から引く。失敗や検証中の枠は残し、拒否時は増加させない。別の並行失敗を成功時に全消去せず、古い窓の成功で次窓の失敗を消さない。MFA は challenge 単位に加えて tenant/user 単位で失敗を共有し、API と MCP の第一/第二要素の予算を共通化する。業務 transaction を保持したまま owner pool の別接続を待たず、予約は検証 transaction の開始前に行う。
