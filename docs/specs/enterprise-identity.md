# 外部認証・MFA・招待とメール配送

状態: 実装済み・統合受入済み（[検証記録](../log/2026-09-12-enterprise-operations.md)）。2026-09-12。親仕様: [enterprise-operations](enterprise-operations.md)。認証情報は既存 users と sessionVersion に接続し、業務権限/会社所属を外部 email から導出しない。

## 受入基準

- ID1: OIDC login/link は静的に許可した tenant/provider/issuer と固定 redirect URI だけを使用する。Authorization Code + S256 PKCE + state + nonce + browserNonce の hash により開始ブラウザーへ結び付け、10分の単回 transaction、署名/JWKS/iss/aud/azp/exp/iat/nonce を検査する。issuer+sub の既存紐付けだけがログイン可能。本人 password + 有効なら MFA の step-up 後だけ紐付け、email による JIT/権限追加をしない。
- ID2: TOTP は RFC 6238 SHA1/6桁/30秒、前後1 step、最終使用 step をロックして再利用を拒否する。暗号化された登録途中の secret を期限付き challenge に保管し、確認後だけ有効にする。recovery code は暗号学的乱数の hash のみ保管し、競合しても1回だけ使える。登録/解除/回復コード再発行は全セッションを失効させる。
- ID3: password/SSO の第一要素成功後、MFA 有効なら5分の challenge のみ発行し、検証前は通常 JWT を発行しない。attempts は失敗 transaction を rollback しても失われない構造とし、IP/目的/identity ごとの DB rate limit も使用する。MCP も有効な MFA session のみ受け付ける。
- ID4: password reset は存在・非存在・無効・曖昧 tenant に同一応答と最低処理時間を返す。32 byte token は hash/期限30分/単回/現在 sessionVersion と照合し、成功時に全セッションを失効する。MFA は解除しない。
- ID5: 招待は tenant admin の step-up を確認して作成し、初期 user は無効・tenant admin 権限なし・会社所属なしにする。本人は24時間の token と12..200文字 password で有効化する。会社/拠点/業務権限は既存所属管理で別途付与する。既存 user の招待経由乗っ取り/再活性化をしない。
- ID6: メールは同一 DB transaction で専用 outbox に暗号化 enqueue する。token/宛先/本文をログへ出さない。SMTP未設定は送信成功扱いにせず、配送CLIが期限、lease、最大attempts、再試行日時を検査し、確定した SMTP 受理後だけ delivered にする。曖昧な切断/プロセス障害は重複配送の可能性を明示し、固定 Message-ID と単回tokenで影響を限定する。
- ID7: MFAやSSO設定は会社未所属/古い選択でも tenant 本人として操作できる。認証設定の監査には操作種別と結果だけを残し、secret/token/code/password/外部claimは保存しない。
- ID8: 認証の失敗予算は目的と IP/identity ごとに予約し、検証成功時はその試行分だけ返す。成功ログインや本人/provider情報の取得で失敗予算を使い切らず、同じ NAT の通常利用を相互遮断しない。並行する成功が別の失敗を消さず、MFA は新 challenge を取得しても本人単位の失敗上限を回避できない。メール申請・招待・OIDC開始の発行予算は失敗予算と分離して保持する。

## HTTP契約（Web担当向け）

通常ログイン成功は既存 `{token,user}`。MFAが必要な場合は `{mfaRequired:true,challengeToken,expiresIn:300}` を返す。`POST /auth/mfa/verify {challengeToken,code}` は TOTP または回復コードを検証して `{token,user}`。

| URL | 入力 | 成功 |
| --- | --- | --- |
| GET /auth/security | なし、本人JWT | `{mfaEnabled,recoveryCodesRemaining,identities:[{providerId,issuer}],configured}` |
| POST /auth/step-up | `{currentPassword,code?}`、本人JWT | `{stepUpToken,expiresIn:300}` |
| POST /auth/mfa/setup | `{stepUpToken}` | `{setupToken,secret,otpauthUri,expiresIn:600}` |
| POST /auth/mfa/confirm | `{setupToken,code}` | `{ok:true,recoveryCodes:[string]}`、全セッション失効 |
| POST /auth/mfa/disable | `{stepUpToken}` | `{ok:true}`、全セッション失効 |
| POST /auth/mfa/recovery-codes | `{stepUpToken}` | `{ok:true,recoveryCodes:[string]}`、全セッション失効 |
| GET /auth/oidc/providers | なし、公開 | `{items:[{id,label}]}` |
| POST /auth/oidc/start | `{providerId,browserNonce}`、公開 | `{authorizationUrl}` |
| POST /auth/oidc/link | `{providerId,browserNonce,stepUpToken}`、本人JWT | `{authorizationUrl}` |
| POST /auth/oidc/complete | `{providerId,state,code,browserNonce}`、公開 | loginは通常ログインと同じ、linkは `{linked:true}`（全セッション失効） |
| POST /auth/oidc/unlink | `{providerId,stepUpToken}`、本人JWT | `{ok:true}`、全セッション失効 |
| POST /auth/password-reset/request | `{email,tenantId?}`、公開 | 常に `{ok:true}`、配送有無は返さない |
| POST /auth/password-reset/complete | `{token,newPassword}`、公開 | `{ok:true}`、自動ログインなし |
| POST /auth/invitations | `{email,name,stepUpToken}`、tenant admin JWT | `{ok:true,userId,delivery:'queued'|'unconfigured'}`、tokenは返さない |
| POST /auth/invitations/accept | `{token,newPassword}`、公開 | `{ok:true}`、自動ログインなし |

browserNonce は Web が開始毎に32 byte乱数を作り sessionStorage に保存し、SSO callback の URL query を即座に history.replaceState で除去した後 POST する。SSO callback は設定済み Web origin の `/auth/oidc/callback`。メールリンクは固定 Web origin の `/reset-password#token=...` と `/accept-invitation#token=...`。fragmentを読んだ後消し、再設定tokenを外部referrerに渡さない。

## 設定と境界

`IDENTITY_ENCRYPTION_KEY` は32 byteのbase64鍵、`PUBLIC_WEB_URL` は固定Web origin。OIDCは `OIDC_PROVIDERS_JSON` に `{id,label,tenantId,issuer,clientId,clientSecret,authorizationEndpoint,tokenEndpoint,jwksUri}` を最大10件設定する。任意discovery URLは受け付けず、端点は HTTPS の静的設定、redirectは固定 origin から構築する。開発のloopback HTTPは明示 test-only adapter に限定。SMTPはTLS必須、credentialsはenvのみ。passwordを除去するSSO-only modeは初版では提供せず、SSO紐付け後も既存passwordによる本人再認証・回復経路を保持する。TOTPはphishing-resistant MFAではない。

検証は合成tenant・ローカルOIDC/JWKS/SMTP adapterで行い、実 IdP/実メールへ接続・送信しない。外部事業者の実アカウント受入は運用者の設定後に別途行う。
