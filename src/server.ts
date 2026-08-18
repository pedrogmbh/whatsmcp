import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { createMcpHandler } from "agents/mcp/server";
import { ENDPOINTS } from "./generated/endpoints";
import { PUBLIC_ORIGIN, SERVER_ICONS } from "./icon";
import { registerInboxTools } from "./inbox-tools";
import { registerMetaTools } from "./meta-tools";
import { callZapi, ZapiError } from "./zapi";

const validator = new CfWorkerJsonSchemaValidator();

const HANDLER_OPTIONS = {
  route: "/mcp",
  allowedHostnames: ["whatsmcp.unfld.dev", "localhost", "127.0.0.1"],
  corsOptions: false as const,
};

/** Surfaced on initialize. Z-API has no message-history API; Portuguese "Ler" tools mark-as-read. */
export const SERVER_INSTRUCTIONS = `WhatsMCP is a thin Z-API proxy. Z-API does not store WhatsApp message bodies and has no get-messages endpoint.

You can send with zapi_messages_send_*. zapi_chats_get / zapi_chats_get_by_phone_number return chat metadata (name, unread count, lastMessageTime) — not message text. zapi_messages_read_message marks one message as read and needs a messageId; it does not fetch content. zapi_chats_modify_chat action "read" marks a chat as read; it does not return messages.

Inbound replies and messages sent by this number (fromMe: true, when Z-API \"Notificar as enviadas por mim também\" is on) arrive at /webhooks/on-message-received and are stored in D1. Use whatsmcp_history_list, whatsmcp_history_get, or whatsmcp_history_search to reconstruct a conversation. Register the six webhook URLs and enable notify-sent-by-me with whatsmcp_register_webhooks (do not use Z-API update-every-webhooks).`;

/** Postman titles like "Ler mensagens" look like a fetch. Override the UI label only. */
const TOOL_TITLE_OVERRIDES: Record<string, string> = {
  zapi_messages_read_message: "Mark message as read",
  zapi_chats_modify_chat: "Modify chat",
};

const TOOL_DESCRIPTION_PREFIXES: Record<string, string> = {
  zapi_chats_get:
    "Lists chats (name, unread count, lastMessageTime). Does not include message bodies. Z-API does not store message history.\n\n",
  zapi_chats_get_by_phone_number:
    "Returns one chat's metadata. Does not include message bodies.\n\n",
  zapi_messages_read_message:
    "Marks a message as read. Does not return or list message text. Requires a known messageId.\n\n",
  zapi_chats_modify_chat:
    "Mutates a chat (read/unread, archive, pin, mute, clear, delete). Does not return messages.\n\n",
};

function selectedCategories(raw: string | undefined): Set<string> | "all" {
  const parts = (raw ?? "*")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.includes("*")) return "all";
  return new Set(parts);
}

function toolError(error: unknown): {
  isError: true;
  content: [{ type: "text"; text: string }];
} {
  const text =
    error instanceof ZapiError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return { isError: true, content: [{ type: "text", text }] };
}

export function createServer(env: Env): McpServer {
  const server = new McpServer(
    {
      name: "whatsmcp",
      title: "WhatsMCP",
      description: "Z-API WhatsApp MCP server",
      version: "1.0.0",
      websiteUrl: PUBLIC_ORIGIN,
      icons: SERVER_ICONS,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const filter = selectedCategories(env.ZAPI_TOOLSETS);
  const endpoints =
    filter === "all"
      ? ENDPOINTS
      : ENDPOINTS.filter((endpoint) => filter.has(endpoint.category));

  for (const endpoint of endpoints) {
    server.registerTool(
      endpoint.name,
      {
        title: TOOL_TITLE_OVERRIDES[endpoint.name] ?? endpoint.summary,
        description: `${TOOL_DESCRIPTION_PREFIXES[endpoint.name] ?? ""}${endpoint.description}`,
        inputSchema: fromJsonSchema(endpoint.inputSchema, validator),
      },
      async (args) => {
        try {
          const result = await callZapi(
            env,
            endpoint,
            (args ?? {}) as Record<string, unknown>,
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return toolError(error);
        }
      },
    );
  }

  registerMetaTools(server, env);
  registerInboxTools(server, env);
  return server;
}

export function createHandler() {
  const handlers = new WeakMap<Env, ReturnType<typeof createMcpHandler>>();

  return (request: Request, env: Env, ctx: ExecutionContext) => {
    let handler = handlers.get(env);
    if (!handler) {
      handler = createMcpHandler(() => createServer(env), HANDLER_OPTIONS);
      handlers.set(env, handler);
    }
    return handler(request, env, ctx);
  };
}
