# whatsmcp

Stateless MCP server on Cloudflare Workers. It exposes the [Z-API](https://developer.z-api.io) WhatsApp REST API as tools over Streamable HTTP at `https://whatsmcp.unfld.dev/mcp`.

Use Bun (`bun`, `bunx`, `bun test`). Do not use Node, npm, pnpm, yarn, vite, jest, or express.

## Commands

| Command | Purpose |
| --- | --- |
| `bun install` | Install dependencies |
| `bun test` | Run the suite (`bun:test`) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run generate` | Rebuild `src/generated/endpoints.ts` from `postman.json` |
| `bun run cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` + `.dev.vars` |
| `bun run dev` | Local Worker (`wrangler dev`, MCP at `http://127.0.0.1:8787/mcp`) |
| `bun run deploy` | Production deploy (prefer CI on `main`) |

Rerun `cf-typegen` after changing bindings or vars. Rerun `generate` after changing `postman.json` or `scripts/generate-endpoints.ts`.

## Layout

```
src/index.ts                 Worker fetch: /health, /icon.*, /mcp + auth
src/server.ts                McpServer, tool registration, handler cache
src/meta-tools.ts            zapi_list_endpoints, zapi_describe_endpoint, zapi_request
src/zapi.ts                  Instance-relative Z-API client (secrets redacted)
src/auth.ts                  Bearer or raw Authorization token
src/icon.ts                  Public icon URLs + MCP server icons
src/generated/endpoints.ts   Generated EndpointDef[] — do not hand-edit
scripts/generate-endpoints.ts  Postman → endpoints.ts
postman.json                 Source of truth for tool names and params
wrangler.jsonc               Worker config, custom domain, ZAPI_TOOLSETS
.dev.vars                    Local secrets (gitignored)
```

Request flow: `index.ts` → auth on `/mcp` → `createMcpHandler` → generated tools + meta-tools → `callZapi` / `requestZapi` → `https://api.z-api.io/instances/<id>/token/<token>…`.

## Environment

Local values go in `.dev.vars`. Production secrets are Wrangler secrets, never `wrangler.jsonc`.

| Name | Kind | Role |
| --- | --- | --- |
| `MCP_AUTH_TOKEN` | secret | Client bearer (or raw `Authorization`) |
| `ZAPI_INSTANCE_ID` | secret | Instance path segment |
| `ZAPI_INSTANCE_TOKEN` | secret | Instance path segment |
| `ZAPI_CLIENT_TOKEN` | secret | `Client-Token` header |
| `ZAPI_TOOLSETS` | var | Comma-separated categories, or `*` |

`ZAPI_INSTANCE_ID` + `ZAPI_INSTANCE_TOKEN` build the instance base URL. Meta-tools ignore `ZAPI_TOOLSETS`.

## Tools

- Generated tools: one per non-Partners Postman request (`zapi_<category>_…`). Title is the Portuguese `summary`.
- Always registered: `zapi_list_endpoints`, `zapi_describe_endpoint`, `zapi_request` (escape hatch; path must start with `/`, no `..`, no absolute URLs).
- Categories: `instance`, `mobile`, `messages`, `privacy`, `contacts`, `chats`, `calls`, `groups`, `communities`, `newsletter`, `status`, `queue`, `business`, `webhooks`.
- Generator asserts 162 endpoints and per-category counts. Update those constants when the collection changes on purpose. Partners stay excluded (billable instance creation).
- Do not add hand-written Z-API tools. Change the generator or `postman.json`, then regenerate.

## MCP metadata

Set on `new McpServer()` in `src/server.ts`:

- `name`: `whatsmcp` (programmatic id)
- `title`: `WhatsMCP` (UI label; clients may still show the local config key)
- `description`, `version`, `websiteUrl`, `icons` (public `/icon.png` and `/icon.svg`)

`GET /health` is public and returns `{ "ok": true, "name": "whatsmcp" }`. Icons are public. `/mcp` is not.

## Auth

Accepts `Authorization: Bearer <MCP_AUTH_TOKEN>` and `Authorization: <MCP_AUTH_TOKEN>`. Comparison is timing-safe. Missing token → 401 + `WWW-Authenticate: Bearer`. If `MCP_AUTH_TOKEN` is unset, every `/mcp` request is unauthorized.

## Testing

`bun test`. Colocate `*.test.ts` next to the module. Worker tests construct a fake `Env` + `ExecutionContext` and call `worker.fetch`. Do not log or assert raw Z-API secrets.

## Deploy

- Live origin: `https://whatsmcp.unfld.dev` (custom domain in `wrangler.jsonc`).
- CI (`.github/workflows/deploy.yml`) uploads a Worker version then deploys it (`versions upload` + `versions deploy`). Do not switch CI back to `wrangler deploy` — that token cannot attach the zone custom domain (error 10000).
- PNG icons need the Wrangler `Data` rule in `wrangler.jsonc`.

## Style

- TypeScript, strict, `verbatimModuleSyntax`.
- Prefer small modules and existing helpers (`toolError`, `requestZapi`, `redactSecrets`).
- No new runtime deps unless the Worker or MCP SDK requires them.
- Keep README, AGENTS.md, and CLAUDE.md aligned when commands, env, or routes change.
