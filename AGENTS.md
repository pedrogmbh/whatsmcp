# whatsmcp

MCP server on Cloudflare Workers. It exposes the [Z-API](https://developer.z-api.io) WhatsApp REST API as tools over Streamable HTTP at `https://whatsmcp.unfld.dev/mcp`, and stores inbound webhook events in D1 so agents can read history.

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
| `bunx wrangler d1 migrations apply whatsmcp --local` | Apply D1 migrations to local SQLite |
| `bun run deploy` | Production deploy (prefer CI on `main`) |

Rerun `cf-typegen` after changing bindings or vars. Rerun `generate` after changing `postman.json` or `scripts/generate-endpoints.ts`.

## Layout

```
src/index.ts                 Worker fetch: /health, /icon.*, /webhooks/*, /mcp + auth
src/server.ts                McpServer, tool registration, handler cache
src/meta-tools.ts            zapi_list_endpoints, zapi_describe_endpoint, zapi_request
src/inbox-tools.ts           whatsmcp_history_* + whatsmcp_chats_sync + whatsmcp_register_webhooks
src/inbox.ts                 Normalize Z-API payloads; D1 insert/list/search
src/chats.ts                 Snapshot GET /chats tags; filter history by etiqueta
src/webhooks.ts              POST /webhooks/* ingest; background chat refresh
src/zapi.ts                  Instance-relative Z-API client (secrets redacted)
src/auth.ts                  Bearer MCP token; webhook ?token=
src/icon.ts                  Public icon URLs + MCP server icons
src/generated/endpoints.ts   Generated EndpointDef[] — do not hand-edit
scripts/generate-endpoints.ts  Postman → endpoints.ts
migrations/                  D1 SQL migrations
postman.json                 Source of truth for Z-API tool names and params
wrangler.jsonc               Worker config, custom domain, ZAPI_TOOLSETS, D1
.dev.vars                    Local secrets (gitignored)
```

Request flow: `index.ts` → public health/icons → webhook ingest → D1, or auth on `/mcp` → generated tools + meta-tools + inbox tools → `callZapi` / `requestZapi` / D1.

## Environment

Local values go in `.dev.vars`. Production secrets are Wrangler secrets, never `wrangler.jsonc`.

| Name | Kind | Role |
| --- | --- | --- |
| `MCP_AUTH_TOKEN` | secret | Client bearer (or raw `Authorization`) |
| `WEBHOOK_AUTH_TOKEN` | secret | Query `?token=` on webhook URLs |
| `ZAPI_INSTANCE_ID` | secret | Instance path segment |
| `ZAPI_INSTANCE_TOKEN` | secret | Instance path segment |
| `ZAPI_CLIENT_TOKEN` | secret | `Client-Token` header |
| `ZAPI_TOOLSETS` | var | Comma-separated categories, or `*` |
| `DB` | D1 | Inbox events + chat tag snapshots (`whatsmcp`) |

`ZAPI_INSTANCE_ID` + `ZAPI_INSTANCE_TOKEN` build the instance base URL. Meta-tools and inbox tools ignore `ZAPI_TOOLSETS`.

## Tools

- Generated tools: one per non-Partners Postman request (`zapi_<category>_…`). Title is the Portuguese `summary` unless overridden.
- Always registered: `zapi_list_endpoints`, `zapi_describe_endpoint`, `zapi_request` (escape hatch; path must start with `/`, no `..`, no absolute URLs).
- First-party inbox tools (not generated): `whatsmcp_history_list`, `whatsmcp_history_get`, `whatsmcp_history_search`, `whatsmcp_chats_sync`, `whatsmcp_register_webhooks`.
- Categories: `instance`, `mobile`, `messages`, `privacy`, `contacts`, `chats`, `calls`, `groups`, `communities`, `newsletter`, `status`, `queue`, `business`, `webhooks`.
- Generator asserts 162 endpoints and per-category counts. Update those constants when the collection changes on purpose. Partners stay excluded (billable instance creation).
- Do not add hand-written Z-API tools. Change the generator or `postman.json`, then regenerate. Inbox tools are the exception — they are not Z-API wrappers.

## Inbox and webhooks

Z-API does not store message bodies. Inbound text arrives only via HTTPS POST webhooks.

Routes (query `?token=<WEBHOOK_AUTH_TOKEN>` required):

- `POST /webhooks/on-message-sent`
- `POST /webhooks/on-message-received`
- `POST /webhooks/on-disconnect`
- `POST /webhooks/on-connect`
- `POST /webhooks/on-message-status-received`
- `POST /webhooks/on-chat-presence`

Register each URL separately with `whatsmcp_register_webhooks` or the matching `zapi_webhooks_update_webhook_*` tool. That helper also enables Z-API **Notificar as enviadas por mim também** (`PUT /update-notify-sent-by-me` + `update-webhook-received-delivery`) so outbound messages hit `/webhooks/on-message-received` with `fromMe: true` and are stored like inbound. Do not use Z-API `update-every-webhooks` (one URL for every kind). Z-API requires HTTPS; `wrangler dev` is HTTP, so point production or a tunnel at these routes.

Do not drop `fromMe` received events — they are the conversation side the agent sent.

Events live in D1 `events` (indexed + FTS). Media URLs from Z-API expire in 30 days; v1 does not copy them to R2.

`GET /chats` and `GET /chats/{phone}` may include an optional `tags` array of string ids (WhatsApp Business etiquetas / filter indexes; often numeric strings). A chat can have many tags; they live in `chat_tags` (one row per id). Official docs omit `tags`; live responses include it. Webhooks do not. Snapshot chats in `chats` + `chat_tags` (not stamped on each event). `chats.lid` is the WhatsApp LID (`27741764198600@lid` stored without the suffix) — presence webhooks often send that as `phone`. Filter with `whatsmcp_history_list` `tag=`. Call `whatsmcp_chats_sync` to page `/chats`, or wait for a received/sent webhook (background `GET /chats/{phone}`). Do not snapshot presence/connect phones. Resolve names with `zapi_business_get_tags`.

## MCP metadata

Set on `new McpServer()` in `src/server.ts`:

- `name`: `whatsmcp` (programmatic id)
- `title`: `WhatsMCP` (UI label; clients may still show the local config key)
- `description`, `version`, `websiteUrl`, `icons` (public `/icon.png` and `/icon.svg`)
- `instructions`: Z-API has no get-messages; use `whatsmcp_history_*`; Portuguese "Ler" tools mark-as-read

`GET /health` is public and returns `{ "ok": true, "name": "whatsmcp" }`. Icons are public. `/mcp` and `/webhooks/*` are not.

A few generated titles are overridden in `src/server.ts` (`zapi_messages_read_message` → "Mark message as read", `zapi_chats_modify_chat` → "Modify chat") so agents do not treat them as a message list.

## Auth

`/mcp` accepts `Authorization: Bearer <MCP_AUTH_TOKEN>` and `Authorization: <MCP_AUTH_TOKEN>`. Comparison is timing-safe. Missing token → 401 + `WWW-Authenticate: Bearer`. If `MCP_AUTH_TOKEN` is unset, every `/mcp` request is unauthorized.

Webhook routes use `?token=<WEBHOOK_AUTH_TOKEN>` only. If that secret is unset, every webhook is unauthorized.

## Testing

`bun test`. Colocate `*.test.ts` next to the module. Worker tests construct a fake `Env` + `ExecutionContext` and call `worker.fetch`. Inbox tests use `src/memory-d1.ts` (bun:sqlite). Do not log or assert raw Z-API secrets.

## Deploy

- Live origin: `https://whatsmcp.unfld.dev` (custom domain in `wrangler.jsonc`).
- CI (`.github/workflows/deploy.yml`) applies D1 migrations, uploads a Worker version, then deploys it (`versions upload` + `versions deploy`). Do not switch CI back to `wrangler deploy` — that token cannot attach the zone custom domain (error 10000).
- PNG icons need the Wrangler `Data` rule in `wrangler.jsonc`.
- Production needs `WEBHOOK_AUTH_TOKEN` as a Wrangler secret and D1 edit on the deploy token.

## Style

- TypeScript, strict, `verbatimModuleSyntax`.
- Prefer small modules and existing helpers (`toolError`, `requestZapi`, `redactSecrets`).
- No new runtime deps unless the Worker or MCP SDK requires them.
- Keep README, AGENTS.md, and CLAUDE.md aligned when commands, env, or routes change.
