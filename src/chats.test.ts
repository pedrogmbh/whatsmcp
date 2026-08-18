import { describe, expect, test } from "bun:test";
import {
  chatSnapshotFromResponse,
  parseChatSnapshot,
  parseLid,
  parseTags,
  upsertChatSnapshot,
} from "./chats";
import { createMemoryD1, inboxTestSchema } from "./memory-d1";

const SCHEMA = await inboxTestSchema();

describe("parseTags", () => {
  test("accepts string and numeric ids", () => {
    expect(parseTags(["1", "2"])).toEqual(["1", "2"]);
    expect(parseTags([1, 2])).toEqual(["1", "2"]);
    expect(parseTags("1")).toEqual([]);
    expect(parseTags("5,6")).toEqual(["5", "6"]);
    expect(parseTags([{ id: "5" }, { tag: 6 }])).toEqual(["5", "6"]);
  });
});

describe("parseLid", () => {
  test("strips the @lid suffix", () => {
    expect(parseLid("27741764198600@lid")).toBe("27741764198600");
    expect(parseLid("27741764198600")).toBe("27741764198600");
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
      lid: "",
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

  test("reads lid and rejects error bodies", () => {
    const chat = parseChatSnapshot({
      phone: "555391643188",
      name: "Augusto Viana",
      lid: "27741764198600@lid",
      tags: ["5", "6"],
    });
    expect(chat?.lid).toBe("27741764198600");
    expect(chat?.tags).toEqual(["5", "6"]);
    expect(
      parseChatSnapshot({
        message: "Phone not exists",
        error: "Bad Request",
        statusCode: 400,
        phone: "240818984087766",
      }),
    ).toBeNull();
    expect(parseChatSnapshot({ phone: "0", name: "Nope" })).toBeNull();
  });

  test("rejects objects without a phone", () => {
    expect(parseChatSnapshot({ name: "Nope" })).toBeNull();
  });
});

describe("chatSnapshotFromResponse", () => {
  test("does not invent a chat from an error body plus fallback phone", () => {
    expect(
      chatSnapshotFromResponse(
        { message: "Phone not exists", error: "Bad Request" },
        "240818984087766",
      ),
    ).toBeNull();
    expect(chatSnapshotFromResponse({ phone: "240818984087766" })).toBeNull();
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

  test("keeps multiple tags on one chat", async () => {
    const db = createMemoryD1(SCHEMA);
    const chat = parseChatSnapshot({
      phone: "555391643188",
      name: "Augusto Viana",
      lid: "27741764198600@lid",
      tags: ["5", "7"],
    });
    await upsertChatSnapshot(db, chat!);
    const tags = await db
      .prepare("SELECT tag FROM chat_tags WHERE phone = ? ORDER BY tag")
      .bind("555391643188")
      .all<{ tag: string }>();
    expect((tags.results ?? []).map((row) => row.tag)).toEqual(["5", "7"]);
    const stored = await db
      .prepare("SELECT lid FROM chats WHERE phone = ?")
      .bind("555391643188")
      .first<{ lid: string }>();
    expect(stored?.lid).toBe("27741764198600");
  });
});
