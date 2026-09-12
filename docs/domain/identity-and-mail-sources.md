# 認証・メール設計の一次資料

確認日: 2026-09-12。実装の契約は [enterprise-identity](../specs/enterprise-identity.md)。

| 資料 | 設計に使う点 |
| --- | --- |
| [OpenID Connect Core 1.0 §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation) | 署名、issuer、audience/azp、期限、nonceの検証 |
| [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) | code verifierとS256 challengeでcode横取りを防ぐ |
| [RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238) | time-based OTP、秘密の保護、受理時間窓と単回利用 |
| [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) | 列挙防止、乱数token、期限、単回、固定URL、セッション失効 |
| [OWASP MFA](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) | MFA変更時の本人再認証、回復経路、試行制限 |
| [Microsoft Entra OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc) | tenant固有issuerでのcode flow設定。common issuerへの曖昧な代替をしない |
| [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect) | 事前登録redirect、state/nonce、subをidentityとして使用 |
| [Auth0 User Account Linking](https://auth0.com/docs/manage-users/user-accounts/user-account-linking) | 先行製品の本人確認付きlinkフロー。email一致を権限継承根拠にしない |

SMTPは相手サーバーの受理と最終到達を区別する。ネットワーク切断時に厳密exactly-onceを保証できないため、同じmessage ID・単回token・lease/attempt上限で安全に再試行し、画面・ログで配送完了を過大に主張しない。
