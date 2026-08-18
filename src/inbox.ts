import { redactSecrets } from "./zapi";

export const WEBHOOK_KINDS = [
  "sent",
  "received",
  "disconnect",
  "connect",
  "status",
  "presence",
] as const;

export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

export const WEBHOOK_PATHS: Record<string, WebhookKind> = {
  "/webhooks/on-message-sent": "sent",
  "/webhooks/on-message-received": "received",
  "/webhooks/on-disconnect": "disconnect",
  "/webhooks/on-connect": "connect",
  "/webhooks/on-message-status-received": "status",
  "/webhooks/on-chat-presence": "presence",
};

export const WEBHOOK_PATH_BY_KIND: Record<WebhookKind, string> = {
  sent: "/webhooks/on-message-sent",
  received: "/webhooks/on-message-received",
  disconnect: "/webhooks/on-disconnect",
  connect: "/webhooks/on-connect",
  status: "/webhooks/on-message-status-received",
  presence: "/webhooks/on-chat-presence",
};

export const HISTORY_LIMIT_CAP = 50;

const META_KEYS = new Set([
  "adContext",
  "broadcast",
  "chatLid",
  "chatName",
  "connectedPhone",
  "error",
  "externalAdReply",
  "forwarded",
  "fromApi",
  "fromMe",
  "ids",
  "instanceId",
  "isEdit",
  "isGroup",
  "isGroupAnnouncement",
  "isNewsletter",
  "isStatusReply",
  "lid",
  "messageExpirationSeconds",
  "messageId",
  "momment",
  "participantLid",
  "participantPhone",
  "phone",
  "phoneDevice",
  "photo",
  "senderLid",
  "senderName",
  "senderPhoto",
  "status",
  "type",
  "waitingMessage",
  "zaapId",
]);

const MESSAGE_KIND_KEYS = [
  "text",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "gif",
  "ptv",
  "location",
  "contact",
  "contacts",
  "reaction",
  "link",
  "buttons",
  "list",
  "poll",
  "product",
  "catalog",
] as const;

export interface InboxEvent {
  id?: number;
  kind: WebhookKind;
  receivedAt: number;
  moment: number;
  messageId: string;
  phone: string;
  chatName: string;
  senderName: string;
  fromMe: boolean | null;
  isGroup: boolean | null;
  isEdit: boolean;
  eventType: string;
  messageKind: string;
  status: string;
  text: string;
  payload: string;
}

export interface ListEventsFilter {
  phone?: string;
  kind?: WebhookKind;
  fromMe?: boolean;
  since?: number;
  tag?: string;
  limit?: number;
}

export interface SearchEventsFilter {
  query: string;
  phone?: string;
  kind?: WebhookKind;
  tag?: string;
  limit?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function isPlaceholderName(value: string): boolean {
  return /^(?:\d+|true|false)$/i.test(value);
}

function senderNameFrom(body: Record<string, unknown>): string {
  const sender = asString(body.senderName).trim();
  if (sender && !isPlaceholderName(sender)) return sender;
  return asString(body.chatName).trim();
}

function messageIdFrom(body: Record<string, unknown>): string {
  const direct = asString(body.messageId);
  if (direct) return direct;
  const ids = body.ids;
  if (Array.isArray(ids)) {
    for (const id of ids) {
      const value = asString(id);
      if (value) return value;
    }
  }
  return asString(body.zaapId);
}

function messageKindFrom(body: Record<string, unknown>): string {
  for (const key of MESSAGE_KIND_KEYS) {
    if (asRecord(body[key])) return key;
  }
  for (const [key, value] of Object.entries(body)) {
    if (META_KEYS.has(key)) continue;
    if (value !== null && typeof value === "object") return key;
  }
  return "";
}

function extractText(kind: WebhookKind, body: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (value: unknown) => {
    const text = asString(value).trim();
    if (text) parts.push(text);
  };

  const nested = (key: string): Record<string, unknown> | null =>
    asRecord(body[key]);

  const text = nested("text");
  if (text) {
    push(text.message);
    push(text.title);
    push(text.description);
    push(text.url);
  }

  for (const key of ["image", "video", "gif", "ptv", "sticker"]) {
    push(nested(key)?.caption);
  }

  const document = nested("document");
  if (document) {
    push(document.caption);
    push(document.fileName);
    push(document.title);
  }

  const audio = nested("audio");
  if (audio) {
    push(audio.caption);
    push(audio.audioUrl ?? audio.url);
  }

  const location = nested("location");
  if (location) {
    push(location.title);
    push(location.address);
    push(location.description);
  }

  const contact = nested("contact");
  if (contact) {
    push(contact.displayName);
    push(contact.phone);
    push(contact.name);
  }

  const reaction = nested("reaction");
  if (reaction) {
    push(reaction.reaction);
    push(reaction.value);
    push(reaction.emoji);
  }

  if (
    kind === "status" ||
    kind === "presence" ||
    kind === "connect" ||
    kind === "disconnect"
  ) {
    push(body.error);
    push(body.status);
    push(nested("presence")?.status);
    push(body.lastSeen);
    push(body.connected);
    push(body.disconnected);
    push(body.reason);
    push(body.message);
  } else {
    push(body.error);
  }

  if (kind === "status" && Array.isArray(body.ids)) {
    push(body.ids.map((id) => asString(id)).filter(Boolean).join(" "));
  }

  return [...new Set(parts)].join(" ");
}

export function normalizeEvent(
  kind: WebhookKind,
  body: Record<string, unknown>,
  receivedAt = Date.now(),
): InboxEvent {
  return {
    kind,
    receivedAt,
    moment: asNumber(body.momment) || asNumber(body.lastSeen) || receivedAt,
    messageId: messageIdFrom(body),
    phone: asString(body.phone),
    chatName: asString(body.chatName),
    senderName: senderNameFrom(body),
    fromMe: asBool(body.fromMe),
    isGroup: asBool(body.isGroup),
    isEdit: asBool(body.isEdit) === true,
    eventType: asString(body.type),
    messageKind: messageKindFrom(body),
    status: asString(body.status),
    text: extractText(kind, body),
    payload: JSON.stringify(body),
  };
}

function boolFlag(value: boolean | null): number | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 20;
  return Math.min(HISTORY_LIMIT_CAP, Math.max(1, Math.trunc(limit)));
}

export function ftsQuery(raw: string): string | null {
  const tokens = raw
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replaceAll('"', "")}"*`).join(" AND ");
}

function mapRow(row: Record<string, unknown>): InboxEvent {
  return {
    id: asNumber(row.id),
    kind: asString(row.kind) as WebhookKind,
    receivedAt: asNumber(row.received_at),
    moment: asNumber(row.moment),
    messageId: asString(row.message_id),
    phone: asString(row.phone),
    chatName: asString(row.chat_name),
    senderName: asString(row.sender_name),
    fromMe: asBool(row.from_me),
    isGroup: asBool(row.is_group),
    isEdit: asBool(row.is_edit) === true,
    eventType: asString(row.event_type),
    messageKind: asString(row.message_kind),
    status: asString(row.status),
    text: asString(row.text),
    payload: asString(row.payload),
  };
}

const SELECT_COLUMNS = `id, kind, received_at, moment, message_id, phone, chat_name,
  sender_name, from_me, is_group, is_edit, event_type, message_kind, status, text, payload`;

export async function insertEvent(
  db: D1Database,
  event: InboxEvent,
): Promise<{ inserted: boolean }> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO events (
        kind, received_at, moment, message_id, phone, chat_name, sender_name,
        from_me, is_group, is_edit, event_type, message_kind, status, text, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.kind,
      event.receivedAt,
      event.moment,
      event.messageId,
      event.phone,
      event.chatName,
      event.senderName,
      boolFlag(event.fromMe),
      boolFlag(event.isGroup),
      event.isEdit ? 1 : 0,
      event.eventType,
      event.messageKind,
      event.status,
      event.text,
      event.payload,
    )
    .run();
  return { inserted: (result.meta.changes ?? 0) > 0 };
}

export async function listEvents(
  db: D1Database,
  filter: ListEventsFilter,
): Promise<InboxEvent[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filter.phone !== undefined) {
    clauses.push("phone = ?");
    values.push(filter.phone);
  }
  if (filter.kind !== undefined) {
    clauses.push("kind = ?");
    values.push(filter.kind);
  }
  if (filter.fromMe !== undefined) {
    clauses.push("from_me = ?");
    values.push(filter.fromMe ? 1 : 0);
  }
  if (filter.since !== undefined) {
    clauses.push("moment >= ?");
    values.push(filter.since);
  }
  if (filter.tag !== undefined && filter.tag !== "") {
    clauses.push(
      `(phone IN (SELECT phone FROM chat_tags WHERE tag = ?)
        OR phone IN (
          SELECT lid FROM chats
          WHERE lid IS NOT NULL AND lid != ''
            AND phone IN (SELECT phone FROM chat_tags WHERE tag = ?)
        ))`,
    );
    values.push(filter.tag, filter.tag);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = clampLimit(filter.limit);
  values.push(limit);

  const { results } = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM events ${where} ORDER BY moment DESC, id DESC LIMIT ?`,
    )
    .bind(...values)
    .all<Record<string, unknown>>();

  return (results ?? []).map(mapRow);
}

export async function getEvent(
  db: D1Database,
  lookup: { id?: number; messageId?: string },
): Promise<InboxEvent[]> {
  if (lookup.id !== undefined) {
    const row = await db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM events WHERE id = ?`)
      .bind(lookup.id)
      .first<Record<string, unknown>>();
    return row ? [mapRow(row)] : [];
  }
  if (lookup.messageId !== undefined && lookup.messageId !== "") {
    const { results } = await db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM events WHERE message_id = ? ORDER BY moment DESC, id DESC LIMIT ?`,
      )
      .bind(lookup.messageId, HISTORY_LIMIT_CAP)
      .all<Record<string, unknown>>();
    return (results ?? []).map(mapRow);
  }
  return [];
}

export async function searchEvents(
  db: D1Database,
  filter: SearchEventsFilter,
): Promise<InboxEvent[]> {
  const match = ftsQuery(filter.query);
  if (!match) return [];

  const clauses = ["events_fts MATCH ?"];
  const values: unknown[] = [match];

  if (filter.phone !== undefined) {
    clauses.push("events.phone = ?");
    values.push(filter.phone);
  }
  if (filter.kind !== undefined) {
    clauses.push("events.kind = ?");
    values.push(filter.kind);
  }
  if (filter.tag !== undefined && filter.tag !== "") {
    clauses.push(
      `(events.phone IN (SELECT phone FROM chat_tags WHERE tag = ?)
        OR events.phone IN (
          SELECT lid FROM chats
          WHERE lid IS NOT NULL AND lid != ''
            AND phone IN (SELECT phone FROM chat_tags WHERE tag = ?)
        ))`,
    );
    values.push(filter.tag, filter.tag);
  }

  const limit = clampLimit(filter.limit);
  values.push(limit);

  const { results } = await db
    .prepare(
      `SELECT events.id, events.kind, events.received_at, events.moment, events.message_id,
              events.phone, events.chat_name, events.sender_name, events.from_me, events.is_group,
              events.is_edit, events.event_type, events.message_kind, events.status, events.text,
              events.payload
       FROM events
       JOIN events_fts ON events_fts.rowid = events.id
       WHERE ${clauses.join(" AND ")}
       ORDER BY events.moment DESC, events.id DESC
       LIMIT ?`,
    )
    .bind(...values)
    .all<Record<string, unknown>>();

  return (results ?? []).map(mapRow);
}

export function eventForClient(event: InboxEvent, env: Env): InboxEvent {
  return {
    ...event,
    payload: redactSecrets(event.payload, env),
    text: redactSecrets(event.text, env),
  };
}
