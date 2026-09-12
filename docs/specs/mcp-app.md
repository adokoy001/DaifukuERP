# Spec: apps/mcp（MCP サーバ）

- 状態: approved ／ ADR: 0009 ／ 作成: 2026-09-10

## 目的
registry の全アクションを MCP ツールとして公開し、エージェントが業務操作をできるようにする。監査には actor.type='agent' を残す。

## 受入基準（EARS）
- AC-1 WHEN the server starts (stdio transport) THE SYSTEM SHALL authenticate with env `DAIFUKU_EMAIL`/`DAIFUKU_PASSWORD` (owner DB connection for login only), and use `DAIFUKU_AGENT_ID` (default `mcp-agent`) as actor id with `onBehalfOf` = that user; `DAIFUKU_COMPANY_ID` optional (default user's default company).
- AC-2 THE SYSTEM SHALL list one tool per registered action: name = `toolNameOf(action.name)`, description = `${description.en}\n${description.ja}` plus "mutates: yes/no", inputSchema = JSON Schema from the zod input (`z.toJSONSchema`), and `annotations.readOnlyHint = !mutates`.
- AC-3 WHEN a tool is called THE SYSTEM SHALL run `runAction` inside `withContext` (app DB connection) and return the JSON result as text; DaifukuError → `isError: true` with `{code,message,hint,details}` so the agent can self-correct.
- AC-4 THE SYSTEM SHALL expose resource `daifuku://meta` returning `appMeta(ctx)` as JSON, and `daifuku://entities/{name}` returning entityMeta.
- AC-5 Tests use the SDK's in-memory transport against the test DB: list tools includes `partner_list` and `partner_create`; calling `partner_create` then `partner_list` round-trips; audit rows show actorType 'agent'.

## スコープ外
- 承認ゲート（Phase 4）、HTTP/SSE transport

## 検証手順
`pnpm gate`; `DAIFUKU_EMAIL=admin@example.com DAIFUKU_PASSWORD=password pnpm --filter @daifuku/mcp start` を MCP Inspector か Claude Code の `claude mcp add` で接続し `partner_list` を呼ぶ。
