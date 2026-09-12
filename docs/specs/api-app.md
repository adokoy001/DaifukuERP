# Spec: apps/api（HTTP API）

- 状態: approved ／ ADR: 0004, 0007, 0009 ／ 作成: 2026-09-10

## 目的
kernel の registry から REST/OpenAPI を自動生成する薄いサーバ。業務ロジックを書かない。

## 受入基準（EARS）
- AC-1 WHEN `POST /auth/login {email,password}` succeeds THE SYSTEM SHALL return `{ token, user: {id,name,email,roles,tenantId,defaultCompanyId} }` (JWT, 12h). Invalid credentials → 401 with the standard error body.
- AC-2 WHEN a request carries `Authorization: Bearer <jwt>` THE SYSTEM SHALL build a Context with actor.type='user', roles from the user record (re-loaded per request), companyId from header `x-company-id` else the user's defaultCompanyId. Missing/invalid token → 401.
- AC-3 WHEN `GET /meta` THE SYSTEM SHALL return `appMeta(ctx)`; `GET /meta/entities/:name` → `entityMeta`.
- AC-4 WHEN `POST /actions/:name` with a JSON body THE SYSTEM SHALL run `runAction` inside `withContext` and return its output; errors map to `{ error: { code, message, hint, details } }` with the DaifukuError http status; unknown action → 404.
- AC-5 THE SYSTEM SHALL expose REST sugar over the generic actions: `GET /api/:entity?search=&limit=&offset=&orderBy=field:asc&where=<json>` → list; `GET /api/:entity/:id`; `POST /api/:entity`; `PATCH /api/:entity/:id` (body `{patch, expectedVersion?}` or the patch itself); `DELETE /api/:entity/:id`; `POST /api/:entity/:id/submit|cancel|amend`; `GET /api/:entity/:id/audit` → audit trail.
- AC-6 THE SYSTEM SHALL serve OpenAPI 3 at `/openapi.json` (generated from action zod schemas) and Swagger UI at `/docs`.
- AC-7 WHEN an agent calls with header `x-agent-id: <id>` in addition to a user token THE SYSTEM SHALL set actor `{type:'agent', id, onBehalfOf: userId}`.
- AC-8 THE SYSTEM SHALL log one JSON line per request with requestId, method, url, status, ms, actor.
- AC-9 `pnpm db:generate` writes a new SQL migration (drizzle journal format) when the registry differs from the last snapshot; `pnpm db:migrate` applies pending migrations then `enforcePolicies`; `pnpm db:reset` drops, migrates, bootstraps the dev tenant (admin@example.com / password, company "DEMO") and runs every module's `seed`.
- AC-10 Integration tests (fastify `inject`, test DB) cover AC-1..7.

## スコープ外
- OIDC、レート制限、CSRF（Phase 1 以降）

## 検証手順
`pnpm gate`; `pnpm db:reset && pnpm dev:api` → `curl -s localhost:3000/openapi.json | jq .paths | head`; login → `GET /api/partner`.
