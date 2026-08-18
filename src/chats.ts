import { requestZapi } from "./zapi";

export interface ChatSnapshot {
  phone: string;
  lid: string;
  name: string;
  tags: string[];
  unread: number | null;
  pinned: boolean | null;
  archived: boolean | null;
  muted: boolean | null;
  isSpam: boolean | null;
  isGroup: boolean | null;
  updatedAt: number;
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

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function flag(value: boolean | null): number | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

export function parseLid(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw) return "";
  return raw.replace(/@lid$/i, "");
}

function tagId(value: unknown): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return asString(record.id || record.tag).trim();
  }
  return asString(value).trim();
}

/** Z-API `tags` is an optional array of string (or numeric) filter ids. */
export function parseTags(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string" && value.includes(",")
      ? value.split(",")
      : [];
  const tags: string[] = [];
  for (const item of items) {
    const id = tagId(item);
    if (id) tags.push(id);
  }
  return [...new Set(tags)];
}

export function isZapiErrorBody(raw: Record<string, unknown>): boolean {
  if (raw.error !== undefined && raw.error !== null && raw.error !== "") {
    return true;
  }
  if (raw.statusCode !== undefined && raw.statusCode !== null) return true;
  const message = asString(raw.message).toLowerCase();
  return message.includes("phone not exists") || message.includes("not found");
}

export function isUsefulChat(chat: ChatSnapshot): boolean {
  return Boolean(
    chat.name ||
      chat.lid ||
      chat.tags.length > 0 ||
      chat.unread !== null ||
      chat.pinned !== null ||
      chat.archived !== null ||
      chat.muted !== null ||
      chat.isSpam !== null ||
      chat.isGroup !== null,
  );
}

export function parseChatSnapshot(
  raw: Record<string, unknown>,
  updatedAt = Date.now(),
): ChatSnapshot | null {
  if (isZapiErrorBody(raw)) return null;
  const phone = asString(raw.phone).trim();
  if (!phone || phone === "0") return null;
  return {
    phone,
    lid: parseLid(raw.lid) || parseLid(raw.chatLid),
    name: asString(raw.name) || asString(raw.chatName),
    tags: parseTags(raw.tags),
    unread: asNumber(raw.messagesUnread) ?? asNumber(raw.unread),
    pinned: asBool(raw.pinned),
    archived: asBool(raw.archived),
    muted: asBool(raw.isMuted),
    isSpam: asBool(raw.isMarkedSpam),
    isGroup: asBool(raw.isGroup),
    updatedAt,
  };
}

export function chatSnapshotFromResponse(
  raw: unknown,
  fallbackPhone?: string,
  updatedAt = Date.now(),
): ChatSnapshot | null {
  const record = Array.isArray(raw) ? asRecord(raw[0]) : asRecord(raw);
  if (!record || isZapiErrorBody(record)) return null;
  if (!asString(record.phone) && fallbackPhone) record.phone = fallbackPhone;
  const snapshot = parseChatSnapshot(record, updatedAt);
  if (!snapshot || !isUsefulChat(snapshot)) return null;
  return snapshot;
}

export async function upsertChatSnapshot(
  db: D1Database,
  chat: ChatSnapshot,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chats (
        phone, lid, name, unread, pinned, archived, muted, is_spam, is_group, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        lid = COALESCE(NULLIF(excluded.lid, ''), chats.lid),
        name = excluded.name,
        unread = excluded.unread,
        pinned = excluded.pinned,
        archived = excluded.archived,
        muted = excluded.muted,
        is_spam = excluded.is_spam,
        is_group = excluded.is_group,
        updated_at = excluded.updated_at`,
    )
    .bind(
      chat.phone,
      chat.lid,
      chat.name,
      chat.unread,
      flag(chat.pinned),
      flag(chat.archived),
      flag(chat.muted),
      flag(chat.isSpam),
      flag(chat.isGroup),
      chat.updatedAt,
    )
    .run();

  await db.prepare("DELETE FROM chat_tags WHERE phone = ?").bind(chat.phone).run();
  for (const tag of chat.tags) {
    await db
      .prepare("INSERT INTO chat_tags (phone, tag) VALUES (?, ?)")
      .bind(chat.phone, tag)
      .run();
  }
}

export async function withChatTags<T extends { phone: string }>(
  db: D1Database,
  rows: T[],
): Promise<Array<T & { tags: string[] }>> {
  const map = await tagsByPhones(
    db,
    rows.map((row) => row.phone),
  );
  return rows.map((row) => ({ ...row, tags: map.get(row.phone) ?? [] }));
}

export async function tagsByPhones(
  db: D1Database,
  phones: string[],
): Promise<Map<string, string[]>> {
  const unique = [...new Set(phones.filter(Boolean))];
  const map = new Map<string, string[]>();
  if (unique.length === 0) return map;

  const placeholders = unique.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT phone, tag FROM chat_tags WHERE phone IN (${placeholders})`)
    .bind(...unique)
    .all<{ phone: string; tag: string }>();

  for (const row of results ?? []) {
    const list = map.get(row.phone) ?? [];
    list.push(row.tag);
    map.set(row.phone, list);
  }
  return map;
}

export async function resolveChatPhone(
  db: D1Database,
  phone: string,
): Promise<string> {
  const trimmed = phone.trim();
  if (!trimmed) return trimmed;
  const lid = parseLid(trimmed);
  const byPhone = await db
    .prepare("SELECT phone FROM chats WHERE phone = ?")
    .bind(trimmed)
    .first<{ phone: string }>();
  if (byPhone?.phone) return byPhone.phone;
  if (!lid) return trimmed;
  const byLid = await db
    .prepare("SELECT phone FROM chats WHERE lid = ?")
    .bind(lid)
    .first<{ phone: string }>();
  return byLid?.phone ?? trimmed;
}

export async function refreshChatSnapshot(
  env: Env,
  phone: string,
): Promise<void> {
  const trimmed = phone.trim();
  if (!trimmed) return;

  try {
    const raw = await requestZapi(env, {
      method: "GET",
      path: `/chats/${encodeURIComponent(trimmed)}`,
    });
    const snapshot = chatSnapshotFromResponse(raw, trimmed);
    if (snapshot) await upsertChatSnapshot(env.DB, snapshot);
  } catch {
    // Webhook 200 must not depend on GET /chats/{phone}.
  }
}

export async function syncChatsFromZapi(
  env: Env,
): Promise<{ chats: number; pages: number }> {
  let chats = 0;
  let pages = 0;
  const pageSize = 50;

  for (let page = 1; page <= 20; page++) {
    const raw = await requestZapi(env, {
      method: "GET",
      path: "/chats",
      query: { page, pageSize },
    });
    const rows = Array.isArray(raw) ? raw : [];
    if (rows.length === 0) break;
    pages += 1;
    for (const row of rows) {
      const snapshot = chatSnapshotFromResponse(row);
      if (!snapshot) continue;
      await upsertChatSnapshot(env.DB, snapshot);
      chats += 1;
    }
    if (rows.length < pageSize) break;
  }

  return { chats, pages };
}
