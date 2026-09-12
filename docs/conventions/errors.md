# エラー設計

kernel は `DaifukuError`（`code`, `message`（人向け、英語）, `hint`（次に何をすべきか）, `details`）を基底にする。

| クラス | code | HTTP | いつ |
|---|---|---|---|
| ValidationError | VALIDATION | 400 | Zod 失敗、業務検証失敗（`details.issues[]`） |
| PermissionDenied | PERMISSION_DENIED | 403 | 操作・行・フィールド権限 |
| NotFound | NOT_FOUND | 404 | id 不存在（権限で見えない場合も NotFound、存在を漏らさない） |
| Conflict | CONFLICT | 409 | 楽観ロック（version 不一致）、一意制約 |
| StateError | INVALID_STATE | 409 | docstatus 遷移不正、締め済み期間 |
| DependencyError | HAS_DEPENDENTS | 409 | cancel 時に依存文書あり（`details.dependents[]`） |

API/MCP は `{ error: { code, message, hint, details } }` で返す。エージェント向けに `hint` は必須。
