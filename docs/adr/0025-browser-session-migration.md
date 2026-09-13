# ADR-0025: ブラウザセッションの段階的な移行

- 状態: accepted（移行方針。Cookie方式は未実装）
- 日付: 2026-09-14
- 関連: [追加レビュー対応](../specs/review-hardening.md)、[認証運用](../operations/enterprise-identity.md)

## 背景

現在Webはタブ内のsessionStorageにJWTを保存し、Authorizationヘッダーで送る。12時間の期限に加えて、APIは各要求でactive/tenant/sessionVersionと権限を再確認する。本人のパスワード変更、再設定、全端末ログアウト等で既存セッションを失効する。ただしXSSが成立した場合、JavaScriptから読めるJWTは持ち出され得る。今回の静的レビューで具体的なXSSを再現したという意味ではない。

ブラウザごとに1つのHttpOnly Cookieへ単純置換すると、別タブで別アカウント・別会社の未保存入力を保持する現在の契約が変わる。Cookieは同一originの別タブにも共有されるため、先にこの契約を設計する必要がある。

## 決定

1. 認証の非同期化・互換移行・負荷上限を先行する。Cookieへの一括置換は同じ改修へ混在させない。
2. 次段階の候補はサーバー管理セッション。ブラウザ秘密はHttpOnly/Secure Cookieへ置き、タブ側には単独では認証できない選択子だけを保持する。別タブのログイン・失効で既存タブの主体が黙って切り替わらないことを必須とする。
3. CookieのSameSite属性だけに依存せず、セッションに結び付いたCSRFトークン、Origin検証、必要に応じFetch Metadataを設計する。ログインCSRF、SSO callback、MFA確定、再設定、添付、401競合、開発用の明示originを含めて検証する。
4. CLI/MCP/機器のBearer経路は用途に合った明示方式として保つ。CookieとBearerの主体が競合した要求の扱いを定義し、曖昧な優先順位を作らない。
5. ログイン時のセッションID更新、個別/全体失効、期限、共有端末からのログアウトをサーバー側の状態とともに検証する。CSPは別の防御層として評価し、CookieだけでXSSの影響がなくなるとは説明しない。

現行Bearerはブラウザがcross-site要求へ自動付与する方式ではないため、現時点のCSRFトークン不在だけを脆弱性と断定しない。運用者に未実装のCookie保護を提供済みと説明しない。

## 根拠・確認日

2026-09-14確認: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)、[HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)。

## 移行の受入条件

同じブラウザの別タブ・別アカウント・別会社・未保存入力を含む実画面テスト、SSO/MFA/メール再設定の結合テスト、CSRF拒否と許可要求、期限切れと個別/全端末失効の試験が揃うまでは方式を切り替えない。
