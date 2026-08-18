import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { syncChatsFromZapi, withChatTags } from "./chats";
import { PUBLIC_ORIGIN } from "./icon";
import {
  eventForClient,
  getEvent,
  HISTORY_LIMIT_CAP,
  listEvents,
  searchEvents,
  WEBHOOK_KINDS,
  WEBHOOK_PATH_BY_KIND,
  type InboxEvent,
  type WebhookKind,
} from "./inbox";
import { requestZapi, ZapiError } from "./zapi";

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

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

async function historyResult(env: Env, events: InboxEvent[]) {
  const tagged = await withChatTags(env.DB, events);
  return jsonResult(
    tagged.map((event) => ({
      ...eventForClient(event, env),
      tags: event.tags,
    })),
  );
}

function webhookUrl(kind: WebhookKind, token: string): string {
  const url = new URL(WEBHOOK_PATH_BY_KIND[kind], `${PUBLIC_ORIGIN}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

const REGISTER_PATHS: Array<{ path: string; kind: WebhookKind }> = [
  { path: "/update-webhook-delivery", kind: "sent" },
  { path: "/update-webhook-received", kind: "received" },
  { path: "/update-webhook-disconnected", kind: "disconnect" },
  { path: "/update-webhook-connected", kind: "connect" },
  { path: "/update-webhook-message-status", kind: "status" },
  { path: "/update-webhook-chat-presence", kind: "presence" },
];

export function registerInboxTools(server: McpServer, env: Env): void {
  server.registerTool(
    "whatsmcp_history_list",
    {
      title: "List inbox history",
      description:
        "List webhook events stored by WhatsMCP (inbound messages, messages sent by this number when notify-sent-by-me is on, delivery, status, presence, connect/disconnect). fromMe distinguishes ours vs theirs. Media messages include mediaUrl (Z-API image/video/audio/document link, expires in ~30 days). tag filters by a chat etiqueta id from GET /chats (string, often numeric). Each row includes the chat's current tags snapshot. Use this to read a conversation. zapi_chats_get does not return message text.",
      inputSchema: z.object({
        phone: z.string().optional(),
        kind: z.enum(WEBHOOK_KINDS).optional(),
        fromMe: z.boolean().optional(),
        since: z.number().optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(HISTORY_LIMIT_CAP).optional(),
      }),
    },
    async ({ phone, kind, fromMe, since, tag, limit }) => {
      const events = await listEvents(env.DB, {
        phone,
        kind,
        fromMe,
        since,
        tag,
        limit,
      });
      return historyResult(env, events);
    },
  );

  server.registerTool(
    "whatsmcp_history_get",
    {
      title: "Get inbox event",
      description:
        "Fetch stored webhook event(s) by row id or Z-API messageId. Provide one of the two.",
      inputSchema: z.object({
        id: z.number().int().positive().optional(),
        messageId: z.string().optional(),
      }),
    },
    async ({ id, messageId }) => {
      if (id === undefined && (messageId === undefined || messageId === "")) {
        return toolError(new Error("Provide id or messageId"));
      }
      const events = await getEvent(env.DB, { id, messageId });
      if (events.length === 0) {
        return toolError(new Error("No matching inbox event"));
      }
      return historyResult(env, events);
    },
  );

  server.registerTool(
    "whatsmcp_history_search",
    {
      title: "Search inbox history",
      description:
        "Full-text search over stored webhook text, chat name, sender, and phone. Optional phone/kind/tag filters. Each row includes the chat's current tags snapshot.",
      inputSchema: z.object({
        query: z.string(),
        phone: z.string().optional(),
        kind: z.enum(WEBHOOK_KINDS).optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(HISTORY_LIMIT_CAP).optional(),
      }),
    },
    async ({ query, phone, kind, tag, limit }) => {
      const events = await searchEvents(env.DB, { query, phone, kind, tag, limit });
      return historyResult(env, events);
    },
  );

  server.registerTool(
    "whatsmcp_chats_sync",
    {
      title: "Sync chat tags",
      description:
        "Page GET /chats and snapshot each chat's optional tags (string etiqueta ids) into D1. Needed before whatsmcp_history_list tag= works for chats that have not received a webhook yet. Resolve id names with zapi_business_get_tags.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return jsonResult(await syncChatsFromZapi(env));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "whatsmcp_register_webhooks",
    {
      title: "Register Z-API webhooks",
      description:
        "Point each Z-API webhook at this Worker's HTTPS routes (with WEBHOOK_AUTH_TOKEN). Enables \"Notificar as enviadas por mim também\" so outbound messages also arrive on /webhooks/on-message-received (fromMe: true). Do not use Z-API update-every-webhooks — that sets one URL for every kind.",
      inputSchema: z.object({}),
    },
    async () => {
      const token = env.WEBHOOK_AUTH_TOKEN;
      if (!token) {
        return toolError(new Error("WEBHOOK_AUTH_TOKEN is not set"));
      }

      try {
        const results: Record<string, unknown> = {};
        for (const { path, kind } of REGISTER_PATHS) {
          results[path] = await requestZapi(env, {
            method: "PUT",
            path,
            body: { value: webhookUrl(kind, token) },
          });
        }
        const receivedUrl = webhookUrl("received", token);
        results["/update-webhook-received-delivery"] = await requestZapi(env, {
          method: "PUT",
          path: "/update-webhook-received-delivery",
          body: { value: receivedUrl },
        });
        results["/update-notify-sent-by-me"] = await requestZapi(env, {
          method: "PUT",
          path: "/update-notify-sent-by-me",
          body: { notifySentByMe: true },
        });
        return jsonResult(results);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
