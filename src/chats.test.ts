import { describe, expect, test } from "bun:test";
import { parseChatSnapshot, parseTags, upsertChatSnapshot } from "./chats";
import { createMemoryD1, inboxTestSchema } from "./memory-d1";

const SCHEMA = await inboxTestSchema();

describe("parseTags", () => {
  test("accepts string and numeric ids", () => {
    expect(parseTags(["1", "2"])).toEqual(["1", "2"]);
    expect(parseTags([1, 2])).toEqual(["1", "2"]);
    expect(parseTags("1")).toEqual([]);
  });
});

describe("parseChatSnapshot", () => {
  test("reads /chats object fields including optional tags", () => {
    const chat = parseChatSnapshot({
      phone: "5544999999999",
      name: "Bacteria",
      tags: ["1", "3"],
      messagesUnread: 4,
      pinned: true,
      archived: false,
      isMuted: true,
      isMarkedSpam: false,
      isGroup: false,
    });
    expect(chat).toMatchObject({
      phone: "5544999999999",
      name: "Bacteria",
      tags: ["1", "3"],
      unread: 4,
      pinned: true,
      archived: false,
      muted: true,
      isSpam: false,
      isGroup: false,
    });
  });

  test("falls back to chatName and unread", () => {
    const chat = parseChatSnapshot({
      phone: 5544999999999,
      chatName: "Fallback",
      unread: "2",
    });
    expect(chat?.phone).toBe("5544999999999");
    expect(chat?.name).toBe("Fallback");
    expect(chat?.unread).toBe(2);
    expect(chat?.tags).toEqual([]);
  });

  test("rejects objects without a phone", () => {
    expect(parseChatSnapshot({ name: "Nope" })).toBeNull();
  });
});

describe("upsertChatSnapshot", () => {
  test("replaces tags on restamp", async () => {
    const db = createMemoryD1(SCHEMA);
    const first = parseChatSnapshot({
      phone: "5544999999999",
      name: "Bacteria",
      tags: ["1", "2"],
    });
    const second = parseChatSnapshot({
      phone: "5544999999999",
      name: "Bacteria",
      tags: ["3"],
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    await upsertChatSnapshot(db, first!);
    await upsertChatSnapshot(db, second!);

    const tags = await db
      .prepare("SELECT tag FROM chat_tags WHERE phone = ? ORDER BY tag")
      .bind("5544999999999")
      .all<{ tag: string }>();
    expect((tags.results ?? []).map((row) => row.tag)).toEqual(["3"]);
  });
});
