# whatsmcp

An [MCP](https://modelcontextprotocol.io) server on Cloudflare Workers that exposes the
[Z-API](https://developer.z-api.io) WhatsApp REST API as tools, served over Streamable HTTP at
`https://whatsmcp.unfld.dev/mcp`.

Tools are generated at build time from `postman.json`, so the tool surface tracks
the collection rather than being hand-maintained. Three meta-tools (`zapi_list_endpoints`,
`zapi_describe_endpoint`, `zapi_request`) are always registered, so no endpoint is ever unreachable
even when the toolset filter narrows what gets exposed.

Z-API does not keep message bodies. This Worker also accepts Z-API webhooks, stores events in
Cloudflare D1, and exposes `whatsmcp_history_list` / `whatsmcp_history_get` /
`whatsmcp_history_search` so clients can read inbound replies. Chat `tags` from
`GET /chats` (optional string etiqueta ids) are snapshotted separately; filter
history with `whatsmcp_history_list` `tag=` after `whatsmcp_chats_sync` or a
webhook on that chat. Image/audio/document/video links from received webhooks
are stored as `mediaUrl` (Z-API hosted, ~30 days; not copied to R2).

## Setup

```bash
bun install
```

Create `.dev.vars` in the repo root (gitignored) with your Z-API credentials:

```ini
MCP_AUTH_TOKEN=...
WEBHOOK_AUTH_TOKEN=...
ZAPI_INSTANCE_ID=...
ZAPI_INSTANCE_TOKEN=...
ZAPI_CLIENT_TOKEN=...
```

`ZAPI_INSTANCE_ID` and `ZAPI_INSTANCE_TOKEN` build the instance base URL; `ZAPI_CLIENT_TOKEN` is sent
as the `Client-Token` header. `MCP_AUTH_TOKEN` is the static bearer token clients must present.
`WEBHOOK_AUTH_TOKEN` is the query token on webhook URLs (`?token=`).

## Local run

```bash
bun run dev
```

Wrangler serves the Worker at `http://localhost:8787`. The MCP endpoint is
`http://127.0.0.1:8787/mcp`. Clients must send one of:

```
Authorization: Bearer <MCP_AUTH_TOKEN>
Authorization: <MCP_AUTH_TOKEN>
```

`GET /health` is public and returns `{ "ok": true, "name": "whatsmcp" }`.
`GET /icon.png` and `GET /icon.svg` are also public (the MCP server advertises them
as its icons).

Webhook ingest (HTTPS only; Z-API will not call local `http://`):

```
POST /webhooks/on-message-sent?token=<WEBHOOK_AUTH_TOKEN>
POST /webhooks/on-message-received?token=<WEBHOOK_AUTH_TOKEN>
POST /webhooks/on-disconnect?token=<WEBHOOK_AUTH_TOKEN>
POST /webhooks/on-connect?token=<WEBHOOK_AUTH_TOKEN>
POST /webhooks/on-message-status-received?token=<WEBHOOK_AUTH_TOKEN>
POST /webhooks/on-chat-presence?token=<WEBHOOK_AUTH_TOKEN>
```

Register those six URLs separately (the `whatsmcp_register_webhooks` tool does this).
Also enable **Notificar as enviadas por mim também** on the received webhook (the register
tool turns this on) so messages you send are stored with `fromMe: true` and show up in
history next to inbound replies.
Do not use Z-API `update-every-webhooks` — it points every event type at one URL.

## Scripts

| Script | What it does |
| --- | --- |
| `bun run generate` | Regenerate `src/generated/endpoints.ts` from the Postman collection |
| `bun run dev` | Run the Worker locally with `wrangler dev` |
| `bun run deploy` | Deploy to Cloudflare |
| `bun run typecheck` | `tsc --noEmit` |
| `bun test` | Run the test suite |
| `bun run cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` + `.dev.vars` |

Rerun `bun run cf-typegen` after changing bindings or vars in `wrangler.jsonc`.

## Configuration

`ZAPI_TOOLSETS` (a plain var in `wrangler.jsonc`, default `*`) selects which Z-API categories
register as tools — for example `instance,messages,groups`. The meta-tools ignore this filter.

## Deploying

Secrets are not stored in `wrangler.jsonc`. Set them once per environment:

```bash
wrangler secret put MCP_AUTH_TOKEN
wrangler secret put WEBHOOK_AUTH_TOKEN
wrangler secret put ZAPI_INSTANCE_ID
wrangler secret put ZAPI_INSTANCE_TOKEN
wrangler secret put ZAPI_CLIENT_TOKEN
wrangler d1 migrations apply whatsmcp --remote
wrangler deploy
```

The `whatsmcp.unfld.dev` custom domain is declared in `wrangler.jsonc` and is provisioned by
Cloudflare on first deploy.

## Connecting a client

```json
{
  "mcpServers": {
    "whatsmcp": {
      "url": "https://whatsmcp.unfld.dev/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

Both `Authorization: Bearer <MCP_AUTH_TOKEN>` and the bare
`Authorization: <MCP_AUTH_TOKEN>` form are accepted. `GET /health` is public
and unauthenticated for uptime checks. The server icon is at
`https://whatsmcp.unfld.dev/icon.png` (SVG at `/icon.svg`).
