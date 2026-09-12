# 店舗 LAN 機器連携の設計根拠

確認日: 2026-09-12。ここでは資料の規定と Daifuku 側の判断を分ける。実機認証や IPP 機種互換性を資料の閲覧だけで検証済みとはしない。

| 一次資料 | 確認した性質 | 今回の判断 |
| --- | --- | --- |
| [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) | WSS、長時間接続の再認証、入力・接続数制限、秘密を除いたログが必要。 | Native agent の header 認証、通知だけの socket、5秒の credential 再確認、固定上限と無圧縮を採用。ブラウザ Origin を拒否する。 |
| [RFC 9700 OAuth Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html) | access token を URI query に入れず、利用範囲を限定する。rotation では古い資格の再使用を扱う必要がある。 | 人 JWT を流用せず gateway 専用 bearer を hash で保存する。agent が新しい秘密を先に保存し、応答喪失後に session で確認する。 |
| [RFC 8628 Device Authorization Grant](https://www.rfc-editor.org/rfc/rfc8628.html) | 利用者が別端末で承認する登録では、秘密の強度、期限、試行制限、機器の結付けが重要。 | 管理者が拠点/Gateway を選び、step-up 後に短命な単回 token を発行する。独自 pairing 方式であり OAuth Device Grant 準拠とは称さない。 |
| [Microsoft Service Bus: transfers, locks and settlement](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-transfers-locks-settlement) | lease が失われる場合や処理後に完了確認が失敗する場合がある。重複を前提に settlement を設計する。 | 物理出力後の応答喪失は不明状態にする。DB 上の lease/attempt とローカル journal を使い、自動的な再印刷・再払出は行わない。 |

キューに通知を送ったことは、機器が受信したことや実行したことの証明にならない。そのため HTTPS の Job 正本と polling fallback を維持する。物理 exactly-once を保証しないという結論は、これらの資料を機器 I/O へ適用した設計上の推論である。

実装入口: [wire 契約](../../modules/edge-integration/src/contract.ts)、[機器本人性](../../kernel/src/relay-auth.ts)、[業務状態機械](../../modules/edge-integration/src/relay.ts)、[通知 adapter](../../apps/api/src/edge/sockets.ts)。
