# エラー設計

呼出元が対処できる失敗は `DaifukuError`（`code`, `message`（人向け、英語）, `hint`（次に何をすべきか）, `details`）を基底にする。クラスは発生する場所ではなく、呼出元へ約束する契約で選ぶ。

## 選び方

| 失敗の性質 | 選択 | 実例 |
| --- | --- | --- |
| 業務・入力・権限により、操作や値の修正を求める | `DaifukuError` の適切な派生クラス | 入庫数量が0以下 → `ValidationError`、締め済み期間 → `StateError` |
| 開発者が修正すべき定義の誤り・内部不変条件違反 | `Error` | `defineEntity` の不正な名前、コードが参照する未登録entity、内部書込み権限の未登録 |
| 既に仕様が定める構造化エラー | 既存のクラス・code・hintを維持 | `registerExt` / `definePack` の不足依存 → `DependencyError`、登録競合 → `Conflict` |

定義時にも拡張登録の呼出元が原因を判断する契約がある。[拡張仕様](../specs/kernel-phase15.md)と[pack仕様](../specs/pack.md)の例外を、発生時点だけを理由に `Error` へ変更しない。逆に、内部実装の誤りを入力不正に見せるために `ValidationError` へ変換しない。既存の `throw new Error` の一括置換や、plain `Error` を一律に禁じるlintは導入しない。

実装例は[DSL定義の検査](../../kernel/src/dsl/entity.ts)と[移動平均の数量検証](../../modules/inventory/src/services/moving-average.ts)。非自明な失敗の理由は、必要に応じて[責務ヘッダ](source-headers.md)や局所コメントへ残す。

## 公開する業務エラー

| クラス | code | HTTP | いつ |
|---|---|---|---|
| ValidationError | VALIDATION | 400 | Zod 失敗、業務検証失敗（`details.issues[]`） |
| PermissionDenied | PERMISSION_DENIED | 403 | 操作・行・フィールド権限 |
| NotFound | NOT_FOUND | 404 | id 不存在（権限で見えない場合も NotFound、存在を漏らさない） |
| Conflict | CONFLICT | 409 | 楽観ロック（version 不一致）、一意制約 |
| StateError | INVALID_STATE | 409 | docstatus 遷移不正、締め済み期間 |
| DependencyError | HAS_DEPENDENTS | 409 | cancel 時に依存文書あり（`details.dependents[]`） |

API/MCP は `{ error: { code, message, hint, details } }` で返す。エージェント向けに `hint` は必須。

## 未知のエラーと診断

`DaifukuError` のmessage・hint・detailsは呼出元へ渡るため、秘密・SQL・内部パス・生の例外を含めない。想定した外部失敗を変換する場合も、公開する情報を明示的に選ぶ。

未知の `Error` やDB例外は[共通変換](../../kernel/src/errors.ts)とAPI/MCPの境界で扱う。既知の一意制約違反は安全な `CONFLICT`、その他は一般化した `INTERNAL` 応答とし、元のmessage・cause・stackを返さない。診断にも元の例外をそのまま記録せず、既存の `safeErrorDiagnostics` とrequest idを使う。
